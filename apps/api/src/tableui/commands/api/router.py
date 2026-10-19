import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, Request, Response
from pydantic import BaseModel

from tableui.commands.application.pipeline import (
    CommandContext,
    check_record,
    create_record,
    update_record,
)
from tableui.identity.api.deps import PrincipalDep
from tableui.metadata.api.deps import LiveAppDep
from tableui.platform.config import Settings
from tableui.platform.db import Database
from tableui.platform.web import get_db, get_request_id, get_settings_dep

router = APIRouter(prefix="/v1/records", tags=["records"])
DbDep = Annotated[Database, Depends(get_db)]
SettingsDep = Annotated[Settings, Depends(get_settings_dep)]


class CreateBody(BaseModel):
    data: dict[str, Any]


class UpdateBody(BaseModel):
    version: int
    data: dict[str, Any]


def _ctx(
    p: PrincipalDep, app: LiveAppDep, settings: Settings, request: Request, key: str | None
) -> CommandContext:
    return CommandContext(
        principal=p,
        app=app,
        app_version=settings.app_version,
        request_id=get_request_id(request),
        idempotency_key=key,
    )


@router.post("/{table}", status_code=201)
async def create(
    table: str,
    body: CreateBody,
    request: Request,
    response: Response,
    p: PrincipalDep,
    app: LiveAppDep,
    db: DbDep,
    settings: SettingsDep,
    idempotency_key: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    result = await create_record(
        db, _ctx(p, app, settings, request, idempotency_key), table, body.data
    )
    response.status_code = result.status
    if result.replayed:
        response.headers["Idempotent-Replayed"] = "true"
    return result.body


@router.patch("/{table}/{record_id}")
async def update(
    table: str,
    record_id: uuid.UUID,
    body: UpdateBody,
    request: Request,
    response: Response,
    p: PrincipalDep,
    app: LiveAppDep,
    db: DbDep,
    settings: SettingsDep,
    idempotency_key: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    result = await update_record(
        db,
        _ctx(p, app, settings, request, idempotency_key),
        table,
        record_id,
        body.data,
        body.version,
    )
    response.status_code = result.status
    return result.body


@router.post("/{table}/check")
async def check(
    table: str,
    body: CreateBody,
    request: Request,
    p: PrincipalDep,
    app: LiveAppDep,
    db: DbDep,
    settings: SettingsDep,
) -> dict[str, Any]:
    """Instant duplicate check for forms: runs the rules, writes nothing."""
    outcomes = await check_record(db, _ctx(p, app, settings, request, None), table, body.data)
    return {"outcomes": outcomes}
