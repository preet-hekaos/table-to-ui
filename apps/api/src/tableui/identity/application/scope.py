"""Row visibility and field hiding derived from the user's role in this workspace."""

import uuid
from typing import Any

from sqlalchemy import text

from tableui.identity.domain.principal import Principal
from tableui.platform.db import Database


async def scope_predicate(
    db: Database, principal: Principal, table_key: str
) -> tuple[str, dict[str, Any]]:
    """SQL fragment (no leading AND) limiting rows to what the role may see, and its parameters."""
    scope = principal.scope_for(table_key)
    if scope == "all":
        return "", {}
    if scope == "own":
        return "owner_id = :scope_uid", {"scope_uid": principal.user_id}
    users: set[uuid.UUID] = {principal.user_id}
    if principal.team_ids:
        async with db.control() as c:
            rows = await c.execute(
                text("SELECT DISTINCT user_id FROM control.team_member WHERE team_id = ANY(:t)"),
                {"t": list(principal.team_ids)},
            )
            users |= {r.user_id for r in rows}
    return "owner_id = ANY(CAST(:scope_uids AS uuid[]))", {"scope_uids": list(users)}


def hidden_fields(principal: Principal, table_key: str) -> set[str]:
    return {f for (t, f) in principal.field_denies if t == table_key}


def strip_hidden(principal: Principal, table_key: str, data: dict[str, Any] | None) -> Any:
    if data is None:
        return None
    hide = hidden_fields(principal, table_key)
    return {k: v for k, v in data.items() if k not in hide} if hide else data
