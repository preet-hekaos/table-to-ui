"""saved_search.save: a person's named searches, reopened from the side menu."""

import json
import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tableui.platform.errors import NotFound, ValidationFailed

ALLOWED_KEYS = {"q", "filters", "ranges", "owner", "has", "sort", "direction"}


async def save(
    s: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    table: str,
    screen: str | None,
    name: str,
    query: dict[str, Any],
) -> dict[str, Any]:
    name = name.strip()
    if not name or len(name) > 80:
        raise ValidationFailed(
            errors=[{"field": "name", "code": "invalid", "message": "must be 1 to 80 characters"}]
        )
    unknown = set(query) - ALLOWED_KEYS
    if unknown:
        raise ValidationFailed(
            errors=[
                {
                    "field": "query",
                    "code": "invalid",
                    "message": f"unknown parts: {', '.join(sorted(unknown))}",
                }
            ]
        )
    sid = uuid.uuid4()
    await s.execute(
        text(
            "INSERT INTO control.saved_search (id, tenant_id, user_id, table_key, name, query) "
            "VALUES (:i, :t, :u, :k, :n, CAST(:q AS jsonb))"
        ),
        {
            "i": sid,
            "t": tenant_id,
            "u": user_id,
            "k": table,
            "n": name,
            "q": json.dumps({**query, "screen": screen}),
        },
    )
    return {"id": str(sid), "table": table, "name": name, "query": {**query, "screen": screen}}


async def mine(s: AsyncSession, tenant_id: uuid.UUID, user_id: uuid.UUID) -> list[dict[str, Any]]:
    rows = await s.execute(
        text(
            "SELECT id, table_key, name, query FROM control.saved_search WHERE tenant_id = :t AND user_id = :u "
            "ORDER BY name"
        ),
        {"t": tenant_id, "u": user_id},
    )
    return [{"id": str(r.id), "table": r.table_key, "name": r.name, "query": r.query} for r in rows]


async def remove(s: AsyncSession, tenant_id: uuid.UUID, user_id: uuid.UUID, sid: uuid.UUID) -> None:
    gone = (
        await s.execute(
            text(
                "DELETE FROM control.saved_search WHERE id = :i AND tenant_id = :t AND user_id = :u RETURNING id"
            ),
            {"i": sid, "t": tenant_id, "u": user_id},
        )
    ).first()
    if gone is None:
        raise NotFound("There is no such saved search.")
