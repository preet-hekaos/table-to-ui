"""Run the workspace's pack fixtures against the version in Test (or Live)."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import text

from tableui.catalog.public import PackCatalog
from tableui.identity.api.deps import PrincipalDep
from tableui.metadata.public import live_app
from tableui.platform.db import Database
from tableui.platform.web import get_db
from tableui.rules.application.fixtures import run_fixtures

router = APIRouter(prefix="/v1", tags=["studio"])
DbDep = Annotated[Database, Depends(get_db)]


@router.post("/apps/current/fixtures/run")
async def run_pack_fixtures(
    p: PrincipalDep,
    db: DbDep,
    request: Request,
    env: Annotated[str, Query(pattern="^(test|live)$")] = "test",
) -> dict[str, Any]:
    """Every fixture of the workspace's pack, run against that environment's tables and rules."""
    p.require("metadata.read")
    assert p.tenant_id
    async with db.control() as s:
        pack_id = (
            await s.execute(
                text("SELECT pack_id FROM control.tenant WHERE id = :t"), {"t": p.tenant_id}
            )
        ).scalar_one_or_none()
        app = await live_app(s, p.tenant_id, env)
    catalog: PackCatalog = request.app.state.catalog
    fixtures = catalog.packs[pack_id].fixtures if pack_id in catalog.packs else []
    out = run_fixtures(app.tables, app.rules, fixtures)
    return {"environment": env, "release_version": app.release_version, "pack_id": pack_id, **out}
