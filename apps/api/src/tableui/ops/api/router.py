import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel

from tableui.audit.public import write_audit
from tableui.identity.api.deps import OperatorDep
from tableui.identity.public import sign_in, verify_mfa
from tableui.ops.application import lifecycle
from tableui.ops.application.directory import tenant_directory
from tableui.platform.config import Settings
from tableui.platform.db import Database
from tableui.platform.web import bearer, get_db, get_request_id, get_settings_dep, state_get

router = APIRouter(prefix="/v1/ops", tags=["operations"])
DbDep = Annotated[Database, Depends(get_db)]
SettingsDep = Annotated[Settings, Depends(get_settings_dep)]


class OpsSignIn(BaseModel):
    email: str
    password: str


class OpsCode(BaseModel):
    code: str


@router.post("/auth/sign-in")
async def ops_sign_in(
    body: OpsSignIn, request: Request, db: DbDep, settings: SettingsDep
) -> dict[str, Any]:
    r = await sign_in(
        db,
        email=body.email,
        password=body.password,
        realm="operator",
        settings=settings,
        request_id=get_request_id(request),
    )
    return {"token": r.token, "mfa_required": True}


@router.post("/auth/mfa/verify", status_code=204)
async def ops_mfa(body: OpsCode, request: Request, db: DbDep, settings: SettingsDep) -> Response:
    await verify_mfa(
        db,
        token=bearer(request) or "",
        code=body.code,
        realm="operator",
        settings=settings,
        request_id=get_request_id(request),
    )
    return Response(status_code=204)


@router.get("/tenants")
async def tenants(op: OperatorDep, db: DbDep, request: Request) -> list[dict[str, Any]]:
    async with db.control() as s:
        await write_audit(
            s,
            tenant_id=None,
            scope="platform",
            actor_id=op.user_id,
            action="operator.tenants.list",
            request_id=get_request_id(request),
        )
        return await tenant_directory(s)


# ---- client workspaces ---------------------------------------------------------------------------------


class NewWorkspace(BaseModel):
    name: str
    owner_email: str
    pack_id: str | None = None


class Why(BaseModel):
    reason: str = ""


class DeleteBody(BaseModel):
    confirm_name: str
    reason: str = ""
    grace_days: int = lifecycle.GRACE_DAYS


class ExportBody(BaseModel):
    reason: str = ""


@router.get("/workspaces")
async def workspaces(op: OperatorDep, db: DbDep, request: Request) -> list[dict[str, Any]]:
    async with db.control() as s:
        await write_audit(
            s, tenant_id=None, scope="platform", actor_id=op.user_id,
            action="operator.workspaces.list", request_id=get_request_id(request),
        )  # fmt: skip
    return await lifecycle.directory(db)


@router.post("/workspaces", status_code=201)
async def create_workspace(
    body: NewWorkspace, op: OperatorDep, db: DbDep, request: Request, settings: SettingsDep
) -> dict[str, Any]:
    return await lifecycle.create_workspace(
        db, op=op, name=body.name, owner_email=body.owner_email, pack_id=body.pack_id,
        catalog=state_get(request, "catalog"), org=state_get(request, "org"),
        provision=state_get(request, "provisioner"), mailer=state_get(request, "mailer"),
        settings=settings, request_id=get_request_id(request),
    )  # fmt: skip


@router.post("/workspaces/{tenant_id}/suspend")
async def suspend(tenant_id: uuid.UUID, body: Why, op: OperatorDep, db: DbDep, request: Request) -> dict[str, Any]:  # fmt: skip
    return await lifecycle.suspend(db, op=op, tenant_id=tenant_id, reason=body.reason, request_id=get_request_id(request))  # fmt: skip


@router.post("/workspaces/{tenant_id}/resume")
async def resume(tenant_id: uuid.UUID, op: OperatorDep, db: DbDep, request: Request) -> dict[str, Any]:  # fmt: skip
    return await lifecycle.resume(db, op=op, tenant_id=tenant_id, request_id=get_request_id(request))  # fmt: skip


@router.post("/workspaces/{tenant_id}/delete")
async def schedule_delete(tenant_id: uuid.UUID, body: DeleteBody, op: OperatorDep, db: DbDep, request: Request) -> dict[str, Any]:  # fmt: skip
    return await lifecycle.schedule_deletion(
        db, op=op, tenant_id=tenant_id, confirm_name=body.confirm_name, reason=body.reason,
        grace_days=body.grace_days, request_id=get_request_id(request),
    )  # fmt: skip


@router.post("/workspaces/{tenant_id}/cancel-deletion")
async def cancel_delete(tenant_id: uuid.UUID, op: OperatorDep, db: DbDep, request: Request) -> dict[str, Any]:  # fmt: skip
    return await lifecycle.cancel_deletion(db, op=op, tenant_id=tenant_id, request_id=get_request_id(request))  # fmt: skip


@router.put("/workspaces/{tenant_id}/limits")
async def set_limits(tenant_id: uuid.UUID, body: dict[str, Any], op: OperatorDep, db: DbDep, request: Request) -> dict[str, Any]:  # fmt: skip
    return await lifecycle.set_limits(db, op=op, tenant_id=tenant_id, body=body, request_id=get_request_id(request))  # fmt: skip


@router.post("/workspaces/{tenant_id}/export")
async def export_workspace(
    tenant_id: uuid.UUID,
    body: ExportBody,
    op: OperatorDep,
    db: DbDep,
    request: Request,
    settings: SettingsDep,
) -> dict[str, Any]:
    return await lifecycle.export_workspace(
        db, state_get(request, "file_store"), state_get(request, "mailer"), settings, op=op,
        tenant_id=tenant_id, reason=body.reason, request_id=get_request_id(request),
    )  # fmt: skip


@router.get("/exports/{token}")
async def download_export(token: str, db: DbDep, request: Request) -> Response:
    """The link emailed to the client owner. The token is the credential; it expires after 24 hours."""
    data, name = await lifecycle.read_export(db, state_get(request, "file_store"), token)
    safe = "".join(c if c.isalnum() else "-" for c in name).strip("-").lower() or "workspace"
    return Response(data, media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{safe}-export.zip"'})  # fmt: skip


@router.post("/maintenance/purge-due")
async def purge_due(op: OperatorDep, db: DbDep, request: Request) -> dict[str, Any]:
    """Delete every workspace whose grace period is over. Also run by `tableui-ops purge-due`."""
    gone = await lifecycle.purge_due(db, state_get(request, "analytics"), state_get(request, "file_store"), get_request_id(request))  # fmt: skip
    return {"purged": gone}
