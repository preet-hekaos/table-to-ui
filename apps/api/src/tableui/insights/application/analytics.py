"""Analytics store (a separate database) fed only by outbox events. Measures never read live tables."""

import json
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import text

from tableui.metadata.public import TableDef
from tableui.platform.db import Database
from tableui.platform.sql import split_statements

SCHEMA = """
CREATE TABLE IF NOT EXISTS fact_record (
  tenant_id uuid NOT NULL,
  table_key text NOT NULL,
  record_id uuid NOT NULL,
  version integer NOT NULL,
  fields jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, table_key, record_id)
);
ALTER TABLE fact_record ADD COLUMN IF NOT EXISTS owner_id uuid;
ALTER TABLE fact_record ADD COLUMN IF NOT EXISTS created_at timestamptz;
CREATE TABLE IF NOT EXISTS projection_state (
  tenant_id uuid PRIMARY KEY,
  manifest_id uuid NOT NULL,
  rebuilt_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fact_record_tenant_table ON fact_record (tenant_id, table_key);
CREATE TABLE IF NOT EXISTS processed_event (
  event_id uuid PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);
"""


async def ensure_schema(analytics: Database) -> None:
    async with analytics.control() as s:
        for stmt in split_statements(SCHEMA):
            await s.execute(text(stmt))


async def handle_event(analytics: Database, event: dict[str, Any]) -> None:
    """Idempotent consumer: processing the same event twice has no extra effect."""
    async with analytics.control() as s:
        fresh = (
            await s.execute(
                text(
                    "INSERT INTO processed_event (event_id) VALUES (:e) ON CONFLICT DO NOTHING RETURNING event_id"
                ),
                {"e": uuid.UUID(event["event_id"])},
            )
        ).first()
        if not fresh:
            return
        if str(event.get("topic", "")).endswith(".deleted"):
            await s.execute(
                text(
                    "DELETE FROM fact_record WHERE tenant_id = :t AND table_key = :tb AND record_id = :r"
                ),
                {
                    "t": uuid.UUID(event["tenant_id"]),
                    "tb": event["table"],
                    "r": uuid.UUID(event["record_id"]),
                },
            )
            return
        owner = event.get("owner_id")
        created = event.get("created_at")
        await s.execute(
            text(
                "INSERT INTO fact_record (tenant_id, table_key, record_id, version, fields, occurred_at, owner_id, created_at) "
                "VALUES (:t, :tb, :r, :v, CAST(:f AS jsonb), CAST(:at AS timestamptz), CAST(:o AS uuid), COALESCE(CAST(:c AS timestamptz), CAST(:at AS timestamptz))) "
                "ON CONFLICT (tenant_id, table_key, record_id) DO UPDATE SET version = EXCLUDED.version, "
                "fields = EXCLUDED.fields, occurred_at = EXCLUDED.occurred_at, "
                "owner_id = COALESCE(EXCLUDED.owner_id, fact_record.owner_id), "
                "created_at = COALESCE(fact_record.created_at, EXCLUDED.created_at) "
                "WHERE fact_record.version < EXCLUDED.version"
            ),
            {
                "t": uuid.UUID(event["tenant_id"]),
                "tb": event["table"],
                "r": uuid.UUID(event["record_id"]),
                "v": event["version"],
                "f": json.dumps(event["fields"]),
                "at": datetime.fromisoformat(event["occurred_at"]),
                "o": uuid.UUID(owner) if owner else None,
                "c": datetime.fromisoformat(created) if created else None,
            },
        )


async def rebuild(
    analytics: Database,
    db: Database,
    tenant_id: uuid.UUID,
    tables: list[TableDef],
    manifest_id: uuid.UUID | None = None,
) -> dict[str, int]:
    """Re-project every record of a workspace into the analytics store from the live tables.

    Used after a new field becomes available to measures, and to prove the numbers are reproducible.
    """
    counts: dict[str, int] = {}
    fresh: list[dict[str, Any]] = []
    async with db.tenant(tenant_id) as s:
        for t in tables:
            keys = [f.key for f in t.fields if f.analytics]
            rows = (
                await s.execute(
                    text(
                        f'SELECT id, version, data, owner_id, created_at, updated_at FROM "{t.key}"'  # noqa: S608 - identifiers are validated metadata keys
                    )
                )
            ).all()
            counts[t.key] = len(rows)
            fresh += [
                {
                    "t": tenant_id,
                    "tb": t.key,
                    "r": r.id,
                    "v": r.version,
                    "f": json.dumps({k: r.data.get(k) for k in keys}),
                    "at": r.updated_at,
                    "o": r.owner_id,
                    "c": r.created_at,
                }
                for r in rows
            ]
    async with analytics.control() as s:
        await s.execute(text("DELETE FROM fact_record WHERE tenant_id = :t"), {"t": tenant_id})
        for n in range(0, len(fresh), 1000):
            await s.execute(
                text(
                    "INSERT INTO fact_record (tenant_id, table_key, record_id, version, fields, occurred_at, owner_id, created_at) "
                    "VALUES (:t, :tb, :r, :v, CAST(:f AS jsonb), :at, :o, :c)"
                ),
                fresh[n : n + 1000],
            )
        if manifest_id is not None:
            await s.execute(
                text(
                    "INSERT INTO projection_state (tenant_id, manifest_id) VALUES (:t, :m) "
                    "ON CONFLICT (tenant_id) DO UPDATE SET manifest_id = EXCLUDED.manifest_id, rebuilt_at = now()"
                ),
                {"t": tenant_id, "m": manifest_id},
            )
    return counts


async def refresh_if_stale(
    analytics: Database,
    db: Database,
    tenant_id: uuid.UUID,
    tables: list[TableDef],
    manifest_id: uuid.UUID,
) -> bool:
    """After a new version goes Live, re-read records once so new measures cover what already exists."""
    async with analytics.control() as s:
        seen = (
            await s.execute(
                text("SELECT manifest_id FROM projection_state WHERE tenant_id = :t"),
                {"t": tenant_id},
            )
        ).scalar_one_or_none()
    if seen == manifest_id:
        return False
    await rebuild(analytics, db, tenant_id, tables, manifest_id)
    return True
