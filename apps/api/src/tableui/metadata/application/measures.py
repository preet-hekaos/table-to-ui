"""The Studio's measure builder: add, change, hide and remove the numbers on the Insights page. Saved to Draft."""

import uuid
from typing import Any

from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tableui.metadata.application import studio
from tableui.metadata.domain.measures import problems
from tableui.metadata.domain.models import MeasureDef, TableDef
from tableui.platform.errors import NotFound

HOME_CAP = 4
PACK_EDITABLE = {"label", "help", "hidden", "order", "home"}


def _fields_used(m: MeasureDef) -> set[str]:
    keys = {f.field for f in m.where}
    keys |= {k for k in (m.field, m.group_by) if k}
    if m.time_field and m.time_field != "created_at":
        keys.add(m.time_field)
    return keys


async def _tables(s: AsyncSession) -> dict[str, TableDef]:
    rows = await s.execute(text("SELECT definition FROM metadata_object WHERE kind = 'table'"))
    return {t.key: t for t in (TableDef.model_validate(r.definition) for r in rows)}


async def list_measures(s: AsyncSession, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
    await studio._enter_tenant(s, tenant_id)
    tables = await _tables(s)
    out = []
    for d in sorted(
        await studio.read_draft(s, tenant_id, "measure"),
        key=lambda x: (x.get("order", 100), x["label"]),
    ):
        m = MeasureDef.model_validate(d)
        t = tables.get(m.table)
        out.append(
            {
                **m.model_dump(mode="json"),
                "table_label": t.label if t else m.table,
                "problems": [msg for _, msg in problems(m, t)]
                if t
                else ["The table no longer exists."],
            }
        )
    return out


def _turn_on(table: TableDef, keys: set[str]) -> tuple[TableDef, list[str]]:
    changed = [f.label for f in table.fields if f.key in keys and not f.analytics]
    if not changed:
        return table, []
    fields = [
        f.model_copy(update={"analytics": True}) if f.key in keys else f for f in table.fields
    ]
    return table.model_copy(update={"fields": fields}), changed


async def save_measure(
    s: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    key: str | None,
    body: dict[str, Any],
    request_id: str | None,
) -> dict[str, Any]:
    """Create a measure (key None) or change one. Pack measures can be renamed, hidden and moved only."""
    await studio._enter_tenant(s, tenant_id)
    current = await studio._draft(s, "measure", key) if key else None
    if key and current is None:
        raise NotFound(f"There is no measure '{key}'.")
    if current and current[1] == "pack":
        extra = set(body) - PACK_EDITABLE - {"key"}
        if extra:
            raise studio._bad(
                sorted(extra)[0],
                "This measure comes with the pack. You can rename it, change its help text, hide it or move it; to change what it counts, make a new measure.",
                "pack_locked",
            )
        merged = {**current[0], **{k: v for k, v in body.items() if k in PACK_EDITABLE}}
    else:
        base = current[0] if current else {}
        merged = {**base, **{k: v for k, v in body.items() if k not in ("source",)}}
        merged["source"] = "agency"
        merged["key"] = key or studio.slug(str(merged.get("label") or ""))
    try:
        m = MeasureDef.model_validate(merged)
    except ValidationError as e:
        raise studio._pydantic_errors(e) from None
    if not m.label.strip():
        raise studio._bad("label", "Give the measure a name.")
    tables = await _tables(s)
    table = tables.get(m.table)
    if table is None:
        raise studio._bad("table", "must be a table in this app")
    if not current and m.key in await studio._keys(s, "measure"):
        raise studio._bad("label", f"There is already a measure called '{m.label}'.", "duplicate")
    turned_on: list[str] = []
    if not (current and current[1] == "pack"):
        table, turned_on = _turn_on(table, _fields_used(m))
        found = problems(m, table)
        if found:
            raise studio._bad(found[0][0], found[0][1])
    if m.home and not (current and current[0].get("home")):
        homes = [
            d
            for d in await studio.read_draft(s, tenant_id, "measure")
            if d.get("home") and d["key"] != m.key
        ]
        if len(homes) >= HOME_CAP:
            raise studio._bad(
                "home",
                f"Home can show {HOME_CAP} numbers. Take one off Home first.",
                "home_full",
            )
    if turned_on:
        src = await studio._draft(s, "table", m.table)
        assert src is not None
        await studio._put(s, tenant_id, "table", m.table, table.model_dump(mode="json"), src[1])
    await studio._put(
        s,
        tenant_id,
        "measure",
        m.key,
        m.model_dump(mode="json"),
        "pack" if current and current[1] == "pack" else "agency",
    )
    await studio._audit(
        s,
        tenant_id,
        user_id,
        "metadata.measure.save",
        m.key,
        {"fields_turned_on": turned_on},
        request_id,
    )
    return {**m.model_dump(mode="json"), "fields_turned_on": turned_on}


async def remove_measure(
    s: AsyncSession, *, tenant_id: uuid.UUID, user_id: uuid.UUID, key: str, request_id: str | None
) -> None:
    await studio._enter_tenant(s, tenant_id)
    current = await studio._draft(s, "measure", key)
    if current is None:
        raise NotFound(f"There is no measure '{key}'.")
    if current[1] == "pack":
        raise studio._bad(
            "key",
            "This measure comes with the pack. Hide it instead of removing it.",
            "pack_locked",
        )
    await s.execute(
        text("DELETE FROM metadata_object WHERE kind = 'measure' AND key = :k"), {"k": key}
    )
    await studio._audit(s, tenant_id, user_id, "metadata.measure.remove", key, {}, request_id)
