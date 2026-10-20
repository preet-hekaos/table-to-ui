import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel

from tableui.identity.api.deps import PrincipalDep
from tableui.metadata.api.deps import LiveAppDep
from tableui.platform.db import Database
from tableui.platform.web import get_db
from tableui.query.public import quick_search
from tableui.search.application import saved

router = APIRouter(prefix="/v1/search", tags=["search"])
DbDep = Annotated[Database, Depends(get_db)]


@router.get("")
async def command_bar(q: str, p: PrincipalDep, app: LiveAppDep, db: DbDep) -> dict[str, Any]:
    """Ctrl K: screens and records by name, only what the person may see (S24)."""
    needle = q.strip().lower()
    screens = []
    for n in app.navigation:
        sc = app.screens.get(n.screen)
        if (
            sc is None
            or (n.roles and p.role_key not in n.roles)
            or not p.allows(f"record.{sc.table}.read")
        ):
            continue
        if needle and needle in n.label.lower():
            screens.append({"kind": "screen", "screen": sc.key, "label": n.label})
    return {"q": q, "screens": screens[:8], "records": await quick_search(db, p, app, q)}


class SavedIn(BaseModel):
    table: str
    name: str
    screen: str | None = None
    query: dict[str, Any] = {}


@router.get("/saved")
async def list_saved(p: PrincipalDep, db: DbDep) -> list[dict[str, Any]]:
    assert p.tenant_id
    async with db.control() as s:
        return [
            x
            for x in await saved.mine(s, p.tenant_id, p.user_id)
            if p.allows(f"record.{x['table']}.read")
        ]


@router.post("/saved", status_code=201)
async def save_search(body: SavedIn, p: PrincipalDep, db: DbDep, app: LiveAppDep) -> dict[str, Any]:
    p.require(f"record.{body.table}.read")
    app.table(body.table)
    assert p.tenant_id
    async with db.control() as s:
        return await saved.save(
            s,
            tenant_id=p.tenant_id,
            user_id=p.user_id,
            table=body.table,
            screen=body.screen,
            name=body.name,
            query=body.query,
        )


@router.delete("/saved/{sid}", status_code=204)
async def delete_saved(sid: uuid.UUID, p: PrincipalDep, db: DbDep) -> Response:
    assert p.tenant_id
    async with db.control() as s:
        await saved.remove(s, p.tenant_id, p.user_id, sid)
    return Response(status_code=204)
