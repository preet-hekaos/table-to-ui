"""The Studio's automation builder: add, change, switch off and remove automations. Saved to Draft."""

import uuid
from typing import Any

from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tableui.metadata.application import studio
from tableui.metadata.application.measures import _tables
from tableui.metadata.domain.automations import problems
from tableui.metadata.domain.models import AutomationDef
from tableui.platform.errors import NotFound

PACK_EDITABLE = {"label", "help", "enabled", "order"}


async def _roles(s: AsyncSession, tenant_id: uuid.UUID) -> set[str]:
    rows = await s.execute(
        text("SELECT DISTINCT role_key FROM control.tenant_role_grant WHERE tenant_id = :t"),
        {"t": tenant_id},
    )
    return {r.role_key for r in rows}


async def list_automations(s: AsyncSession, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
    await studio._enter_tenant(s, tenant_id)
    tables = await _tables(s)
    roles = await _roles(s, tenant_id)
    out = []
    for d in sorted(
        await studio.read_draft(s, tenant_id, "automation"),
        key=lambda x: (x.get("order", 100), x["label"]),
    ):
        a = AutomationDef.model_validate(d)
        out.append(
            {
                **a.model_dump(mode="json"),
                "table_label": tables[a.trigger.table].label
                if a.trigger.table in tables
                else a.trigger.table,
                "problems": [m for _, m in problems(a, tables, roles)],
            }
        )
    return out


async def save_automation(
    s: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    key: str | None,
    body: dict[str, Any],
    request_id: str | None,
) -> dict[str, Any]:
    """Create (key None) or change an automation. Pack ones can be renamed, reordered and switched off."""
    await studio._enter_tenant(s, tenant_id)
    current = await studio._draft(s, "automation", key) if key else None
    if key and current is None:
        raise NotFound(f"There is no automation '{key}'.")
    if current and current[1] == "pack":
        extra = set(body) - PACK_EDITABLE - {"key"}
        if extra:
            raise studio._bad(
                sorted(extra)[0],
                "This automation comes with the pack. You can rename it or switch it off; "
                "to change what it does, make a new one.",
                "pack_locked",
            )
        merged = {**current[0], **{k: v for k, v in body.items() if k in PACK_EDITABLE}}
    else:
        base = current[0] if current else {}
        merged = {**base, **{k: v for k, v in body.items() if k != "source"}}
        merged["source"] = "agency"
        merged["key"] = key or studio.slug(str(merged.get("label") or ""))
    try:
        a = AutomationDef.model_validate(merged)
    except ValidationError as e:
        raise studio._pydantic_errors(e) from None
    if not a.label.strip():
        raise studio._bad("label", "Give the automation a name.")
    if not current and a.key in await studio._keys(s, "automation"):
        raise studio._bad(
            "label", f"There is already an automation called '{a.label}'.", "duplicate"
        )
    if not (current and current[1] == "pack"):
        found = problems(a, await _tables(s), await _roles(s, tenant_id))
        if found:
            raise studio._bad(found[0][0], found[0][1])
    await studio._put(
        s,
        tenant_id,
        "automation",
        a.key,
        a.model_dump(mode="json"),
        "pack" if current and current[1] == "pack" else "agency",
    )
    await studio._audit(s, tenant_id, user_id, "metadata.automation.save", a.key, {}, request_id)
    return a.model_dump(mode="json")


async def remove_automation(
    s: AsyncSession, *, tenant_id: uuid.UUID, user_id: uuid.UUID, key: str, request_id: str | None
) -> None:
    await studio._enter_tenant(s, tenant_id)
    current = await studio._draft(s, "automation", key)
    if current is None:
        raise NotFound(f"There is no automation '{key}'.")
    if current[1] == "pack":
        raise studio._bad(
            "key", "This automation comes with the pack. Switch it off instead.", "pack_locked"
        )
    await s.execute(
        text("DELETE FROM metadata_object WHERE kind = 'automation' AND key = :k"), {"k": key}
    )
    await studio._audit(s, tenant_id, user_id, "metadata.automation.remove", key, {}, request_id)
