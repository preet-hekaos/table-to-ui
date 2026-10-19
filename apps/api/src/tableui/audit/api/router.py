from typing import Annotated, Any

from fastapi import APIRouter, Depends
from sqlalchemy import text

from tableui.identity.api.deps import PrincipalDep
from tableui.platform.db import Database
from tableui.platform.web import get_db

router = APIRouter(prefix="/v1", tags=["audit"])


@router.get("/activity")
async def activity(
    p: PrincipalDep, db: Annotated[Database, Depends(get_db)], limit: int = 100
) -> list[dict[str, Any]]:
    """The agency's activity log: who did what, newest first."""
    p.require("audit.read")
    async with db.control() as s:
        rows = (
            await s.execute(
                text(
                    "SELECT a.id, a.action, a.subject_type, a.subject_id, a.detail, a.at, u.full_name "
                    "FROM control.audit_event a LEFT JOIN control.app_user u ON u.id = a.actor_id "
                    "WHERE a.tenant_id = :t AND a.scope = 'tenant' ORDER BY a.id DESC LIMIT :n"
                ),
                {"t": p.tenant_id, "n": max(1, min(limit, 500))},
            )
        ).all()
    return [
        {
            "id": r.id,
            "action": r.action,
            "subject_type": r.subject_type,
            "subject_id": r.subject_id,
            "detail": r.detail,
            "at": r.at.isoformat(),
            "actor": r.full_name,
        }
        for r in rows
    ]
