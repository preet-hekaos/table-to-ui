from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from tableui.catalog.public import PackCatalog
from tableui.identity.api.deps import PrincipalDep
from tableui.platform.db import Database
from tableui.platform.web import get_db, get_request_id
from tableui.workspace.application import install

router = APIRouter(prefix="/v1/workspace", tags=["workspace"])
DbDep = Annotated[Database, Depends(get_db)]


def _catalog(request: Request) -> PackCatalog:
    c: PackCatalog = request.app.state.catalog
    return c


class ChoosePack(BaseModel):
    pack_id: str


@router.get("/onboarding")
async def onboarding(p: PrincipalDep, db: DbDep, request: Request) -> dict[str, Any]:
    assert p.tenant_id
    return await install.onboarding_state(db, p.tenant_id, _catalog(request))


@router.post("/pack", status_code=201)
async def choose_pack(
    body: ChoosePack, p: PrincipalDep, db: DbDep, request: Request
) -> dict[str, Any]:
    p.require("workspace.manage")
    assert p.tenant_id
    return await install.install_pack(
        db,
        _catalog(request),
        tenant_id=p.tenant_id,
        user_id=p.user_id,
        pack_id=body.pack_id,
        request_id=get_request_id(request),
    )
