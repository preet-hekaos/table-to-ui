import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Header, Request, Response
from pydantic import BaseModel

from tableui.commands.application.bulk import bulk_change, bulk_undo
from tableui.commands.application.pipeline import (
    CommandContext,
    Overrides,
    check_record,
    create_record,
    update_record,
)
from tableui.identity.api.deps import PrincipalDep
from tableui.metadata.api.deps import LiveAppDep
from tableui.platform.config import Settings
from tableui.platform.db import Database
from tableui.platform.errors import ValidationFailed, VersionConflict
from tableui.platform.web import get_db, get_request_id, get_settings_dep
from tableui.query.public import matching_ids

router = APIRouter(prefix="/v1/records", tags=["records"])
DbDep = Annotated[Database, Depends(get_db)]
SettingsDep = Annotated[Settings, Depends(get_settings_dep)]


class OverrideBody(BaseModel):
    checks: list[str]
    reason: str


class CreateBody(BaseModel):
    data: dict[str, Any]
    override: OverrideBody | None = None


class UpdateBody(BaseModel):
    version: int
    data: dict[str, Any]
    override: OverrideBody | None = None


def _ctx(
    p: PrincipalDep,
    app: LiveAppDep,
    settings: Settings,
    request: Request,
    key: str | None,
    override: OverrideBody | None = None,
) -> CommandContext:
    return CommandContext(
        principal=p,
        app=app,
        app_version=settings.app_version,
        request_id=get_request_id(request),
        idempotency_key=key,
        overrides=Overrides(frozenset(override.checks), override.reason) if override else None,
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
        db, _ctx(p, app, settings, request, idempotency_key, body.override), table, body.data
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
        _ctx(p, app, settings, request, idempotency_key, body.override),
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


MAX_BULK = 10_000


class Matching(BaseModel):
    """Every record that matches the list's current search, instead of a hand-picked set."""

    q: str | None = None
    filters: dict[str, str] = {}
    ranges: dict[str, str] = {}
    contains: dict[str, str] = {}
    anyof: dict[str, str] = {}
    has: dict[str, str] = {}
    owner: str | None = None
    expected_count: int


class Undo(BaseModel):
    kind: Literal["update", "delete"]
    ids: list[uuid.UUID]


class BulkBody(BaseModel):
    action: Literal["update", "delete", "undo"]
    ids: list[uuid.UUID] | None = None
    matching: Matching | None = None
    field: str | None = None
    value: Any = None
    undo: Undo | None = None


@router.post("/{table}/bulk")
async def bulk(
    table: str,
    body: BulkBody,
    request: Request,
    p: PrincipalDep,
    app: LiveAppDep,
    db: DbDep,
    settings: SettingsDep,
) -> dict[str, Any]:
    """Change one field on, or delete, many records at once; or undo the last such change."""
    ctx = _ctx(p, app, settings, request, None)
    if body.action == "undo":
        if body.undo is None or len(body.undo.ids) > MAX_BULK:
            raise ValidationFailed(
                errors=[{"field": "undo", "code": "invalid", "message": "say what to undo"}]
            )
        return await bulk_undo(db, ctx, table, kind=body.undo.kind, ids=body.undo.ids)
    if (body.ids is None) == (body.matching is None):
        raise ValidationFailed(
            errors=[{"field": "ids", "code": "invalid", "message": "give ids or a matching search"}]
        )
    if body.matching is not None:
        m = body.matching
        ids, more = await matching_ids(
            db, p, app, table, q=m.q, filters=m.filters, ranges=m.ranges, contains=m.contains,
            anyof=m.anyof, has=m.has, owner=m.owner, limit=MAX_BULK,
        )  # fmt: skip
        if more:
            raise ValidationFailed(
                errors=[
                    {
                        "field": "matching",
                        "code": "invalid",
                        "message": f"more than {MAX_BULK:,} records match; narrow the search",
                    }
                ]
            )
        if len(ids) != m.expected_count:
            raise VersionConflict(
                f"The search now matches {len(ids):,} records, not {m.expected_count:,}. Review and try again."
            )
    else:
        assert body.ids is not None
        if len(body.ids) > MAX_BULK:
            raise ValidationFailed(
                errors=[
                    {
                        "field": "ids",
                        "code": "invalid",
                        "message": f"at most {MAX_BULK:,} at a time",
                    }
                ]
            )
        ids, _ = await matching_ids(db, p, app, table, ids=body.ids, limit=MAX_BULK)
    return await bulk_change(
        db, ctx, table, action=body.action, ids=ids, field=body.field, value=body.value
    )
