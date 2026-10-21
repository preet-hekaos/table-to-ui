import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from tableui.approvals.application import service
from tableui.identity.api.deps import PrincipalDep
from tableui.metadata.api.deps import LiveAppDep
from tableui.platform.config import Settings
from tableui.platform.db import Database
from tableui.platform.web import get_db, get_request_id, get_settings_dep

router = APIRouter(prefix="/v1/approvals", tags=["approvals"])
DbDep = Annotated[Database, Depends(get_db)]
SettingsDep = Annotated[Settings, Depends(get_settings_dep)]


class RequestBody(BaseModel):
    table: str
    action: str
    data: dict[str, Any]
    record_id: uuid.UUID | None = None
    version: int | None = None
    note: str = ""


class DecideBody(BaseModel):
    decision: str
    note: str = ""


@router.post("", status_code=201)
async def request(
    body: RequestBody, req: Request, p: PrincipalDep, app: LiveAppDep, db: DbDep, s: SettingsDep
) -> dict[str, Any]:
    """Hold a change that a rule sent for approval. Nothing is saved until it is approved."""
    return await service.request_approval(
        db,
        p,
        app,
        s.app_version,
        get_request_id(req),
        table=body.table,
        action=body.action,
        data=body.data,
        record_id=body.record_id,
        version=body.version,
        note=body.note,
    )


@router.get("")
async def inbox(
    p: PrincipalDep,
    db: DbDep,
    status: str | None = "pending",
    table: str | None = None,
    record_id: uuid.UUID | None = None,
    mine: bool = False,
) -> dict[str, Any]:
    return await service.list_approvals(
        db, p, status=status or None, table=table, record_id=record_id, mine=mine
    )


@router.get("/{approval_id}")
async def one(approval_id: uuid.UUID, p: PrincipalDep, db: DbDep) -> dict[str, Any]:
    return await service.get(db, p, approval_id)


@router.post("/{approval_id}/decision")
async def decide(
    approval_id: uuid.UUID,
    body: DecideBody,
    req: Request,
    p: PrincipalDep,
    app: LiveAppDep,
    db: DbDep,
    s: SettingsDep,
) -> dict[str, Any]:
    approve = body.decision == "approve"
    if body.decision not in ("approve", "reject"):
        from tableui.platform.errors import ValidationFailed

        raise ValidationFailed(
            errors=[{"field": "decision", "code": "invalid", "message": "approve or reject"}]
        )
    return await service.decide(
        db, p, app, s.app_version, get_request_id(req), approval_id, approve=approve, note=body.note
    )


@router.post("/{approval_id}/cancel")
async def cancel(
    approval_id: uuid.UUID, req: Request, p: PrincipalDep, db: DbDep
) -> dict[str, Any]:
    return await service.cancel(db, p, approval_id, get_request_id(req))
