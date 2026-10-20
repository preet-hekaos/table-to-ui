import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends

from tableui.identity.api.deps import PrincipalDep
from tableui.metadata.api.deps import LiveAppDep
from tableui.platform.db import Database
from tableui.platform.web import get_db
from tableui.query.application import records

router = APIRouter(prefix="/v1/records", tags=["records"])
DbDep = Annotated[Database, Depends(get_db)]


@router.get("/{table}")
async def list_(
    table: str,
    p: PrincipalDep,
    app: LiveAppDep,
    db: DbDep,
    sort: str = "updated_at",
    direction: str = "desc",
    cursor: str | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    return await records.list_records(
        db, p, app, table, sort=sort, direction=direction, cursor=cursor, limit=limit
    )


@router.get("/{table}/{record_id}")
async def get(
    table: str, record_id: uuid.UUID, p: PrincipalDep, app: LiveAppDep, db: DbDep
) -> dict[str, Any]:
    return await records.get_record(db, p, app, table, record_id)


@router.get("/{table}/{record_id}/history")
async def history(
    table: str, record_id: uuid.UUID, p: PrincipalDep, app: LiveAppDep, db: DbDep
) -> list[dict[str, Any]]:
    return await records.get_history(db, p, app, table, record_id)
