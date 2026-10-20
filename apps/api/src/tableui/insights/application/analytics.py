"""Analytics store (a separate database) fed only by outbox events. Measures never read live tables."""

import json
import uuid
from typing import Any

from sqlalchemy import text

from tableui.metadata.public import MeasureDef
from tableui.platform.db import Database
from tableui.platform.errors import NotFound
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
        await s.execute(
            text(
                "INSERT INTO fact_record (tenant_id, table_key, record_id, version, fields, occurred_at) "
                "VALUES (:t, :tb, :r, :v, CAST(:f AS jsonb), :at) "
                "ON CONFLICT (tenant_id, table_key, record_id) DO UPDATE SET version = EXCLUDED.version, "
                "fields = EXCLUDED.fields, occurred_at = EXCLUDED.occurred_at "
                "WHERE fact_record.version < EXCLUDED.version"
            ),
            {
                "t": uuid.UUID(event["tenant_id"]),
                "tb": event["table"],
                "r": uuid.UUID(event["record_id"]),
                "v": event["version"],
                "f": json.dumps(event["fields"]),
                "at": __import__("datetime").datetime.fromisoformat(event["occurred_at"]),
            },
        )


async def measure_value(
    analytics: Database, tenant_id: uuid.UUID, measures: list[MeasureDef], key: str
) -> dict[str, Any]:
    m = next((x for x in measures if x.key == key), None)
    if m is None:
        raise NotFound(f"There is no measure '{key}'.")
    clauses = ["tenant_id = :t", "table_key = :tb"]
    params: dict[str, Any] = {"t": tenant_id, "tb": m.table}
    for i, f in enumerate(m.where):
        op = "=" if f.op == "eq" else "<>"
        clauses.append(f"fields->>'{f.field}' {op} :v{i}")
        params[f"v{i}"] = str(f.value)
    async with analytics.control() as s:
        value = (
            await s.execute(
                text(f"SELECT count(*) FROM fact_record WHERE {' AND '.join(clauses)}"),  # noqa: S608 - field keys are validated metadata keys
                params,
            )
        ).scalar_one()
        latest = (
            await s.execute(
                text(
                    "SELECT max(occurred_at) FROM fact_record WHERE tenant_id = :t AND table_key = :tb"
                ),
                {"t": tenant_id, "tb": m.table},
            )
        ).scalar_one()
    return {
        "key": m.key,
        "label": m.label,
        "value": int(value),
        "as_of": latest.isoformat() if latest else None,
    }
