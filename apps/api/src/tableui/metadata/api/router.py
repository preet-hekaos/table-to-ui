from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from tableui.identity.api.deps import PrincipalDep
from tableui.metadata.api.deps import LiveAppDep
from tableui.metadata.application import draft, releases
from tableui.platform.db import Database
from tableui.platform.errors import NotFound
from tableui.platform.web import get_db, get_request_id

router = APIRouter(prefix="/v1", tags=["studio"])
DbDep = Annotated[Database, Depends(get_db)]


class ReleaseOut(BaseModel):
    version: int
    release_id: str


@router.get("/studio/tables")
async def studio_tables(p: PrincipalDep, db: DbDep) -> list[dict[str, Any]]:
    """The Draft: tables and fields as the builder sees them."""
    p.require("metadata.read")
    async with db.tenant(p.tenant_id) as s:
        tables = await draft.read_draft_tables(s)
    return [
        {
            "key": t["key"],
            "label": t["definition"]["label"],
            "fields": [
                {
                    "key": f["key"],
                    "label": f["label"],
                    "type": f["type"],
                    "required": f["required"],
                    "source": f.get("source", "pack"),
                }
                for f in t["definition"]["fields"]
            ],
        }
        for t in tables
    ]


@router.get("/apps/current/releases")
async def list_releases(p: PrincipalDep, db: DbDep) -> list[dict[str, Any]]:
    p.require("metadata.read")
    assert p.tenant_id
    async with db.control() as s:
        return await releases.list_releases(s, p.tenant_id)


@router.post("/apps/current/releases", status_code=201, response_model=ReleaseOut)
async def publish_test(p: PrincipalDep, db: DbDep, request: Request) -> dict[str, Any]:
    p.require("release.publish")
    assert p.tenant_id
    async with db.tenant(p.tenant_id) as ts:
        manifest = await draft.build_manifest(ts)
    async with db.control() as s:
        return await releases.publish_to_test(
            s,
            tenant_id=p.tenant_id,
            user_id=p.user_id,
            manifest=manifest,
            request_id=get_request_id(request),
        )


@router.post("/apps/current/releases/{version}/promote", response_model=ReleaseOut)
async def promote(version: int, p: PrincipalDep, db: DbDep, request: Request) -> dict[str, Any]:
    p.require("release.publish")
    assert p.tenant_id
    async with db.control() as s:
        return await releases.promote_to_live(
            s,
            tenant_id=p.tenant_id,
            user_id=p.user_id,
            version=version,
            request_id=get_request_id(request),
        )


@router.post("/apps/current/rollback", response_model=ReleaseOut)
async def rollback(p: PrincipalDep, db: DbDep, request: Request) -> dict[str, Any]:
    p.require("release.publish")
    assert p.tenant_id
    async with db.control() as s:
        return await releases.rollback_live(
            s, tenant_id=p.tenant_id, user_id=p.user_id, request_id=get_request_id(request)
        )


@router.get("/app/tables/{table}")
async def live_table(table: str, app: LiveAppDep) -> dict[str, Any]:
    """A table of the live app: drives forms, lists and detail pages."""
    t = app.tables.get(table)
    if t is None:
        raise NotFound(f"There is no table '{table}'.")
    return {"release_version": app.release_version, "table": t.model_dump(mode="json")}


@router.get("/app/tables/{table}/relations")
async def live_relations(table: str, p: PrincipalDep, app: LiveAppDep) -> list[dict[str, Any]]:
    """Tables that point at this one: they become related lists on its profile page."""
    app.table(table)
    return [
        {
            "table": t.key,
            "label": t.plural_label,
            "field": f.key,
            "title_field": t.title_field,
            "columns": [x.key for x in t.fields if not x.hidden and x.type != "long_text"][:5],
        }
        for t in app.tables.values()
        for f in t.fields
        if f.type == "reference" and f.ref_table == table and p.allows(f"record.{t.key}.read")
    ]


@router.get("/app/tables")
async def live_tables(app: LiveAppDep) -> dict[str, Any]:
    return {
        "release_version": app.release_version,
        "tables": [
            {"key": t.key, "label": t.label, "plural_label": t.plural_label}
            for t in app.tables.values()
        ],
    }


def _visible(roles: list[str], role_key: str | None) -> bool:
    return not roles or (role_key in roles)


@router.get("/app/navigation")
async def live_navigation(p: PrincipalDep, app: LiveAppDep) -> dict[str, Any]:
    """Menu items for the signed-in user's role. Items whose table the user cannot read are left out."""
    items = []
    for n in app.navigation:
        sc = app.screens.get(n.screen)
        if sc is None or not _visible(n.roles, p.role_key) or not _visible(sc.roles, p.role_key):
            continue
        if not p.allows(f"record.{sc.table}.read"):
            continue
        items.append(
            {
                "key": n.key,
                "label": n.label,
                "icon": n.icon,
                "section": n.section,
                "screen": sc.key,
                "pattern": sc.pattern,
                "table": sc.table,
            }
        )
    return {"release_version": app.release_version, "items": items}


@router.get("/app/screens/{screen}")
async def live_screen(screen: str, p: PrincipalDep, app: LiveAppDep) -> dict[str, Any]:
    sc = app.screens.get(screen)
    if sc is None or not _visible(sc.roles, p.role_key):
        raise NotFound(f"There is no screen '{screen}'.")
    return {"release_version": app.release_version, "screen": sc.model_dump(mode="json")}
