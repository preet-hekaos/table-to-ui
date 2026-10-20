from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request

from tableui.catalog.application import publishing
from tableui.catalog.application.catalog import PackCatalog
from tableui.identity.api.deps import OperatorDep, PrincipalDep
from tableui.platform.db import Database
from tableui.platform.errors import PermissionDenied
from tableui.platform.web import get_db, get_request_id

router = APIRouter(prefix="/v1", tags=["catalog"])
DbDep = Annotated[Database, Depends(get_db)]


def _catalog(request: Request) -> PackCatalog:
    c: PackCatalog = request.app.state.catalog
    return c


@router.get("/ops/packs")
async def packs(op: OperatorDep, db: DbDep, request: Request) -> list[dict[str, Any]]:
    async with db.control() as s:
        return await publishing.overview(s, _catalog(request))


@router.post("/ops/packs/{pack_id}/publish", status_code=201)
async def publish(pack_id: str, op: OperatorDep, db: DbDep, request: Request) -> dict[str, Any]:
    """Publish the pack version on disk; blocked unless every fixture passes and its range is valid."""
    async with db.control() as s:
        return await publishing.publish(
            s,
            _catalog(request),
            operator_id=op.user_id,
            pack_id=pack_id,
            request_id=get_request_id(request),
        )


@router.get("/workspace/pack/updates")
async def updates(p: PrincipalDep, db: DbDep) -> list[dict[str, Any]]:
    assert p.tenant_id
    async with db.control() as s:
        return await publishing.available_updates(s, p.tenant_id)


@router.post("/workspace/pack/updates/{version}/accept")
async def accept(version: str, p: PrincipalDep, db: DbDep, request: Request) -> dict[str, Any]:
    """Only an owner takes a pack update. It lands in the Draft, to publish like any change."""
    if "*" not in p.permissions:
        raise PermissionDenied("Only a workspace owner can accept a pack update.")
    assert p.tenant_id
    async with db.control() as s:
        return await publishing.accept_update(
            s,
            tenant_id=p.tenant_id,
            user_id=p.user_id,
            version=version,
            request_id=get_request_id(request),
        )
