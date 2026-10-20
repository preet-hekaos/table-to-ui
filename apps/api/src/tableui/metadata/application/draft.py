"""The Draft: the mutable working copy of metadata inside a tenant schema."""

import json
import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tableui.metadata.domain.models import Pack


async def seed_draft(session: AsyncSession, tenant_id: uuid.UUID, pack: Pack) -> None:
    """Write a pack into the tenant's Draft. Runs inside the tenant context."""
    rows: list[tuple[str, str, dict[str, Any]]] = [
        ("pack", pack.id, {"id": pack.id, "version": pack.version, "title": pack.title})
    ]
    rows += [("table", t.key, t.model_dump(mode="json")) for t in pack.tables]
    rows += [("rule", r.id, r.model_dump(mode="json")) for r in pack.rules]
    rows += [("measure", m.key, m.model_dump(mode="json")) for m in pack.measures]
    rows += [("screen", sc.key, sc.model_dump(mode="json")) for sc in pack.screens]
    rows += [("nav", n.key, n.model_dump(mode="json")) for n in pack.navigation]
    for kind, key, definition in rows:
        await session.execute(
            text(
                "INSERT INTO metadata_object (tenant_id, kind, key, definition, source) "
                "VALUES (:t, :k, :key, CAST(:d AS jsonb), 'pack')"
            ),
            {"t": tenant_id, "k": kind, "key": key, "d": json.dumps(definition)},
        )


async def read_draft_tables(session: AsyncSession) -> list[dict[str, Any]]:
    rows = (
        await session.execute(
            text(
                "SELECT key, definition, source FROM metadata_object WHERE kind = 'table' ORDER BY key"
            )
        )
    ).all()
    return [{"key": r.key, "definition": r.definition, "source": r.source} for r in rows]


async def build_manifest(session: AsyncSession) -> dict[str, Any]:
    """Snapshot the Draft into a manifest that pins the version of every object."""
    objs = (
        await session.execute(
            text("SELECT kind, key, definition FROM metadata_object ORDER BY kind, key")
        )
    ).all()
    from tableui.metadata.application.runtime import canonical_hash

    manifest: dict[str, Any] = {
        "pack": None,
        "tables": {},
        "rules": {},
        "measures": {},
        "screens": {},
        "navs": {},
    }
    for o in objs:
        entry = {
            "version": o.definition.get("version", 1),
            "hash": canonical_hash(o.definition),
            "definition": o.definition,
        }
        if o.kind == "pack":
            manifest["pack"] = {"id": o.definition["id"], "version": o.definition["version"]}
        else:
            manifest[o.kind + "s"][o.key] = entry
    return manifest
