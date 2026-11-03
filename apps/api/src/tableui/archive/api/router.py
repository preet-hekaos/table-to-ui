import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from tableui.archive.application import service
from tableui.commands.public import CommandContext
from tableui.identity.api.deps import PrincipalDep
from tableui.metadata.api.deps import LiveAppDep
from tableui.platform.config import Settings
from tableui.platform.db import Database
from tableui.platform.errors import ValidationFailed
from tableui.platform.web import get_db, get_request_id, get_settings_dep

router = APIRouter(prefix="/v1/archive", tags=["archive"])
DbDep = Annotated[Database, Depends(get_db)]
SettingsDep = Annotated[Settings, Depends(get_settings_dep)]
MAX = 10_000


class AddBody(BaseModel):
    kind: Literal["field", "link", "measure", "automation"]
    table: str | None = None
    key: str


class Matching(BaseModel):
    q: str = ""
    filters: dict[str, str] = {}
    ranges: dict[str, str] = {}
    contains: dict[str, str] = {}
    anyof: dict[str, str] = {}
    has: dict[str, str] = {}
    owner: str | None = None
    expected_count: int


class RecordsBody(BaseModel):
    table: str
    ids: list[uuid.UUID] | None = None
    matching: Matching | None = None


class IdsBody(BaseModel):
    ids: list[uuid.UUID]


class SettingBody(BaseModel):
    auto_delete: bool | None = None
    days: int | None = None
    per_kind: dict[str, int] | None = None
    warn_days: int | None = None
    confirm: bool = False


@router.get("")
async def items(p: PrincipalDep, db: DbDep) -> dict[str, Any]:
    p.require("workspace.manage")
    assert p.tenant_id
    return await service.list_items(db, p.tenant_id)


@router.get("/count")
async def count(p: PrincipalDep, db: DbDep) -> dict[str, int]:
    p.require("workspace.manage")
    assert p.tenant_id
    return {"count": await service.count_items(db, p.tenant_id)}


@router.get("/impact")
async def impact(
    kind: str, key: str, p: PrincipalDep, db: DbDep, table: str | None = None
) -> dict[str, Any]:
    """What archiving would stop, so the confirm window can say it before anyone clicks."""
    p.require("workspace.manage")
    assert p.tenant_id
    return await service.impact(db, p.tenant_id, kind, table, key)


@router.post("", status_code=201)
async def add(body: AddBody, request: Request, p: PrincipalDep, db: DbDep) -> dict[str, Any]:
    p.require("workspace.manage")
    p.require("metadata.write")
    return await service.archive_metadata(
        db, p, kind=body.kind, table=body.table, key=body.key, request_id=get_request_id(request)
    )


def _ctx(p: PrincipalDep, app: LiveAppDep, settings: Settings, request: Request) -> CommandContext:
    return CommandContext(
        principal=p, app=app, app_version=settings.app_version, request_id=get_request_id(request)
    )


@router.post("/records", status_code=201)
async def add_records(
    body: RecordsBody,
    request: Request,
    p: PrincipalDep,
    app: LiveAppDep,
    db: DbDep,
    settings: SettingsDep,
) -> dict[str, Any]:
    p.require("workspace.manage")
    if not body.ids or len(body.ids) > MAX:
        raise ValidationFailed(
            errors=[
                {
                    "field": "ids",
                    "code": "invalid",
                    "message": f"Choose between 1 and {MAX} records.",
                }
            ]
        )
    return await service.archive_records(db, _ctx(p, app, settings, request), body.table, body.ids)


@router.post("/restore")
async def restore(
    body: IdsBody,
    request: Request,
    p: PrincipalDep,
    app: LiveAppDep,
    db: DbDep,
    settings: SettingsDep,
) -> dict[str, Any]:
    p.require("workspace.manage")
    return await service.restore(
        db, _ctx(p, app, settings, request), p, body.ids[:MAX], get_request_id(request)
    )


@router.post("/delete")
async def delete_forever(
    body: IdsBody, request: Request, p: PrincipalDep, db: DbDep
) -> dict[str, Any]:
    p.require("workspace.manage")
    return await service.purge(db, p, body.ids[:MAX], get_request_id(request))


@router.get("/settings")
async def get_settings(p: PrincipalDep, db: DbDep) -> dict[str, Any]:
    p.require("workspace.manage")
    assert p.tenant_id
    async with db.control() as s:
        return await service.get_setting(s, p.tenant_id)


@router.put("/settings")
async def put_settings(
    body: SettingBody, request: Request, p: PrincipalDep, db: DbDep
) -> dict[str, Any]:
    p.require("workspace.manage")
    assert p.tenant_id
    return await service.set_setting(
        db, tenant_id=p.tenant_id, user_id=p.user_id,
        body=body.model_dump(exclude={"confirm"}, exclude_unset=True), confirm=body.confirm, request_id=get_request_id(request),
    )  # fmt: skip
