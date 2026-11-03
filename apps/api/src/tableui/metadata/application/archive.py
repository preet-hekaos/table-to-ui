"""Archive a Studio item instead of deleting it: take it out of the Draft, hand back a snapshot, put it back on restore.

The archive module keeps the snapshot and the clock. Here live the Draft-side steps for fields, links, measures and
automations, so every rule about what may be taken out (pack items, the name field, rules that use a field) stays in one place.
"""

import json
import re
import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tableui.metadata.application import automations, measures, relationships, studio
from tableui.metadata.application.releases import environment_manifest
from tableui.metadata.domain.models import TableDef
from tableui.platform.errors import NotFound

KINDS = ("field", "link", "measure", "automation")


async def _table(s: AsyncSession, table_key: str) -> tuple[TableDef, dict[str, Any], str]:
    found = await studio._draft(s, "table", table_key)
    if found is None:
        raise NotFound(f"There is no table '{table_key}'.")
    return TableDef.model_validate(found[0]), found[0], found[1]


async def impact(
    s: AsyncSession, *, tenant_id: uuid.UUID, kind: str, table_key: str | None, key: str
) -> dict[str, Any]:
    """What archiving would stop, in plain words. ``blockers`` must be cleared first; ``effects`` happen on their own."""
    schema = await studio._enter_tenant(s, tenant_id)
    if kind in ("field", "link"):
        assert table_key
        table, _, _ = await _table(s, table_key)
        f = table.field(key)
        if f is None or (kind == "link" and f.type != "reference"):
            raise NotFound(f"There is no {kind} '{key}' on '{table_key}'.")
        blockers: list[str] = []
        effects: list[str] = []
        if key == table.title_field:
            blockers.append("It is the record's name field, so it cannot be archived.")
        for r in await s.execute(
            text("SELECT key, definition FROM metadata_object WHERE kind = 'rule'")
        ):
            if r.definition.get("table") == table_key and re.search(
                rf"\b{re.escape(key)}\b", json.dumps(r.definition)
            ):
                blockers.append(
                    f"The rule “{r.definition.get('label') or r.key}” uses it. Change or remove the rule first."
                )
        for sc in await s.execute(
            text("SELECT key, definition FROM metadata_object WHERE kind = 'screen'")
        ):
            d = sc.definition
            if d.get("table") == table_key and f'"{key}"' in json.dumps(d.get("config", {}) or {}):
                effects.append(f"It leaves the screen “{d.get('label') or sc.key}”.")
        if kind == "link":
            for t in await s.execute(
                text("SELECT key, definition FROM metadata_object WHERE kind = 'table'")
            ):
                if relationships._refers("table", t.definition, table_key, key):
                    blockers.append(
                        f"The table “{t.definition.get('label') or t.key}” shows records through this link."
                    )
        exists = (
            await s.execute(text("SELECT to_regclass(:n)"), {"n": f'"{schema}"."{table_key}"'})
        ).scalar_one()
        filled = 0
        if exists is not None:
            filled = int(
                (
                    await s.execute(
                        text(
                            f'SELECT count(*) FROM "{schema}"."{table_key}" WHERE data->>:f IS NOT NULL'  # noqa: S608 - identifiers are validated metadata keys
                        ),
                        {"f": key},
                    )
                ).scalar_one()
            )
        return {
            "label": f.label,
            "where": table.label,
            "blockers": blockers,
            "effects": effects,
            "kept": filled,
        }
    obj_kind = kind
    found = await studio._draft(s, obj_kind, key)
    if found is None:
        raise NotFound(f"There is no {kind} '{key}'.")
    blockers = []
    if found[1] == "pack":
        blockers.append(
            "It comes with the pack. Hide it instead."
            if kind == "measure"
            else "It comes with the pack. Switch it off instead."
        )
    return {
        "label": found[0].get("label") or key,
        "where": None,
        "blockers": blockers,
        "effects": [],
        "kept": 0,
    }


async def take_out(
    s: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    kind: str,
    table_key: str | None,
    key: str,
    request_id: str | None,
) -> dict[str, Any]:
    """Remove the item from the Draft and return what is needed to put it back: ``label``, ``detail``, ``payload``."""
    info = await impact(s, tenant_id=tenant_id, kind=kind, table_key=table_key, key=key)
    if info["blockers"]:
        raise studio._bad("key", info["blockers"][0], "in_use")
    if kind in ("field", "link"):
        assert table_key
        table, _, _ = await _table(s, table_key)
        f = table.field(key)
        assert f is not None
        index = [x.key for x in table.fields].index(key)
        await studio.remove_field(
            s,
            tenant_id=tenant_id,
            user_id=user_id,
            table_key=table_key,
            field_key=key,
            request_id=request_id,
        )
        return {
            "label": f.label,
            "detail": f"{'Link' if kind == 'link' else 'Field'} on {table.label}",
            "payload": {"field": f.model_dump(mode="json"), "index": index},
        }
    current = await studio._draft(s, kind, key)
    assert current is not None
    if kind == "measure":
        await measures.remove_measure(
            s, tenant_id=tenant_id, user_id=user_id, key=key, request_id=request_id
        )
    else:
        await automations.remove_automation(
            s, tenant_id=tenant_id, user_id=user_id, key=key, request_id=request_id
        )
    return {
        "label": current[0].get("label") or key,
        "detail": kind.capitalize(),
        "payload": {"definition": current[0], "source": current[1]},
    }


async def put_back(
    s: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    kind: str,
    table_key: str | None,
    key: str,
    payload: dict[str, Any],
    request_id: str | None,
) -> None:
    await studio._enter_tenant(s, tenant_id)
    if kind in ("field", "link"):
        assert table_key
        found = await studio._draft(s, "table", table_key)
        if found is None:
            raise studio._bad(
                "table", "Its table is gone or archived. Bring the table back first.", "table_gone"
            )
        definition, source = found
        fields = list(definition["fields"])
        if any(x["key"] == key for x in fields):
            raise studio._bad(
                "key", f"There is already a field called '{key}' on this table.", "duplicate"
            )
        fields.insert(min(int(payload.get("index", len(fields))), len(fields)), payload["field"])
        updated = {**definition, "fields": fields, "version": int(definition.get("version", 1)) + 1}
        TableDef.model_validate(updated)
        await studio._put(s, tenant_id, "table", table_key, updated, source)
        await studio._audit(
            s, tenant_id, user_id, "metadata.field.restore", f"{table_key}.{key}", {}, request_id
        )
        return
    if await studio._draft(s, kind, key) is not None:
        raise studio._bad("key", f"There is already a {kind} called '{key}'.", "duplicate")
    await studio._put(
        s, tenant_id, kind, key, payload["definition"], payload.get("source", "agency")
    )
    await studio._audit(s, tenant_id, user_id, f"metadata.{kind}.restore", key, {}, request_id)


async def strip_field_values(
    s: AsyncSession, control: AsyncSession, *, tenant_id: uuid.UUID, table_key: str, key: str
) -> int:
    """After a field is deleted for good: remove its values from the records, unless Live still shows the field."""
    live = await environment_manifest(control, tenant_id, "live")
    if live is not None:
        tdef = ((live[1].get("tables") or {}).get(table_key) or {}).get("definition") or {}
        if any(f.get("key") == key for f in tdef.get("fields", [])):
            return 0
    schema = await studio._enter_tenant(s, tenant_id)
    exists = (
        await s.execute(text("SELECT to_regclass(:n)"), {"n": f'"{schema}"."{table_key}"'})
    ).scalar_one()
    if exists is None:
        return 0
    res = await s.execute(
        text(f'UPDATE "{schema}"."{table_key}" SET data = data - :k WHERE data ? :k'),  # noqa: S608 - identifiers are validated metadata keys
        {"k": key},
    )
    return int(res.rowcount or 0)  # type: ignore[attr-defined]
