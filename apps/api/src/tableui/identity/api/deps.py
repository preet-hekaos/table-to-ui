from typing import Annotated

from fastapi import Depends, Request

from tableui.identity.application.sessions import authenticate, preview_as
from tableui.identity.domain.principal import Principal
from tableui.platform.config import Settings
from tableui.platform.db import Database
from tableui.platform.errors import PermissionDenied
from tableui.platform.web import bearer, get_db, get_settings_dep

DbDep = Annotated[Database, Depends(get_db)]
SettingsDep = Annotated[Settings, Depends(get_settings_dep)]


async def _principal(
    request: Request, db: Database, settings: Settings, realm: str, pending: bool
) -> Principal:
    async with db.control() as s:
        return await authenticate(
            s, bearer(request), realm=realm, settings=settings, allow_pending=pending
        )


async def get_principal(request: Request, db: DbDep, settings: SettingsDep) -> Principal:
    p = await _principal(request, db, settings, "tenant", False)
    role = request.headers.get("x-preview-role")
    env = request.headers.get("x-preview-env")
    if not role and not env:
        return p
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        raise PermissionDenied("Preview is read-only. Leave preview to make changes.")
    async with db.control() as s:
        return await preview_as(s, p, role or (p.role_key or ""), env or "live")


async def get_pending_principal(request: Request, db: DbDep, settings: SettingsDep) -> Principal:
    return await _principal(request, db, settings, "tenant", True)


async def get_operator(request: Request, db: DbDep, settings: SettingsDep) -> Principal:
    p = await _principal(request, db, settings, "operator", False)
    p.require("ops.tenants.read")
    return p


PrincipalDep = Annotated[Principal, Depends(get_principal)]
PendingPrincipalDep = Annotated[Principal, Depends(get_pending_principal)]
OperatorDep = Annotated[Principal, Depends(get_operator)]
