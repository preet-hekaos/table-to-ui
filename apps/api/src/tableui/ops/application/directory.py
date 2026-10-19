"""Operator view of tenants: metadata only, never business records."""

from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def tenant_directory(s: AsyncSession) -> list[dict[str, Any]]:
    rows = (
        await s.execute(
            text(
                "SELECT t.id, t.name, t.plan, t.cluster, t.schema_name, t.status, t.created_at, "
                "(SELECT count(*) FROM control.membership m WHERE m.tenant_id = t.id) AS members "
                "FROM control.tenant t ORDER BY t.created_at DESC"
            )
        )
    ).all()
    return [
        {
            "id": str(r.id),
            "name": r.name,
            "plan": r.plan,
            "cluster": r.cluster,
            "schema": r.schema_name,
            "created_at": r.created_at.isoformat(),
            "health": "healthy" if r.status == "active" else r.status,
            "members": r.members,
        }
        for r in rows
    ]
