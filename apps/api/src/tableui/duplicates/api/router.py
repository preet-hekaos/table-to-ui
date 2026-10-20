import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from tableui.duplicates.application import service
from tableui.identity.api.deps import PrincipalDep
from tableui.metadata.api.deps import LiveAppDep
from tableui.platform.config import Settings
from tableui.platform.db import Database
from tableui.platform.web import get_db, get_request_id, get_settings_dep

router = APIRouter(prefix="/v1/duplicates", tags=["duplicates"])
DbDep = Annotated[Database, Depends(get_db)]
SettingsDep = Annotated[Settings, Depends(get_settings_dep)]


class PairBody(BaseModel):
    a: uuid.UUID
    b: uuid.UUID


class MergeBody(BaseModel):
    keep: uuid.UUID
    drop: uuid.UUID
    take: dict[str, str] = {}


@router.get("/{table}")
async def suspected(
    table: str, p: PrincipalDep, app: LiveAppDep, db: DbDep, limit: int = 50
) -> dict[str, Any]:
    return await service.suspected(db, p, app, table, max(1, min(limit, 200)))


@router.get("/{table}/compare")
async def compare(
    table: str, a: uuid.UUID, b: uuid.UUID, p: PrincipalDep, app: LiveAppDep, db: DbDep
) -> dict[str, Any]:
    return await service.compare(db, p, app, table, a, b)


@router.post("/{table}/dismiss", status_code=204)
async def dismiss(table: str, body: PairBody, p: PrincipalDep, app: LiveAppDep, db: DbDep) -> None:
    await service.dismiss(db, p, app, table, body.a, body.b)


@router.get("/{table}/merges")
async def merges(table: str, p: PrincipalDep, app: LiveAppDep, db: DbDep) -> list[dict[str, Any]]:
    return await service.list_merges(db, p, app, table)


@router.post("/{table}/merge", status_code=201)
async def merge(
    table: str,
    body: MergeBody,
    req: Request,
    p: PrincipalDep,
    app: LiveAppDep,
    db: DbDep,
    s: SettingsDep,
) -> dict[str, Any]:
    return await service.merge(
        db,
        p,
        app,
        s.app_version,
        get_request_id(req),
        table,
        keep=body.keep,
        drop=body.drop,
        take=body.take,
    )


@router.post("/{table}/merges/{merge_id}/undo")
async def undo(
    table: str,
    merge_id: uuid.UUID,
    req: Request,
    p: PrincipalDep,
    app: LiveAppDep,
    db: DbDep,
    s: SettingsDep,
) -> dict[str, Any]:
    return await service.undo(db, p, app, s.app_version, get_request_id(req), table, merge_id)
