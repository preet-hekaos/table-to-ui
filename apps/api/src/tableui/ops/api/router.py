from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel

from tableui.audit.public import write_audit
from tableui.identity.api.deps import OperatorDep
from tableui.identity.public import sign_in, verify_mfa
from tableui.ops.application.directory import tenant_directory
from tableui.platform.config import Settings
from tableui.platform.db import Database
from tableui.platform.web import bearer, get_db, get_request_id, get_settings_dep

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
