import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import text

from tableui.catalog.public import PackCatalog
from tableui.identity.api.deps import PrincipalDep
from tableui.platform.db import Database
from tableui.platform.web import get_db, get_request_id
from tableui.workspace.application import admin, install

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


class RoleBody(BaseModel):
    name: str
    description: str = ""
    grants: list[str] = []
    scopes: dict[str, str] = {}
    field_deny: list[str] = []


class NewRoleBody(RoleBody):
    key: str


class RoleChange(BaseModel):
    role: str


class TeamBody(BaseModel):
    name: str


class MembersBody(BaseModel):
    user_ids: list[uuid.UUID]


class BrandBody(BaseModel):
    app_name: str
    accent: str
    logo_file_id: str | None = None


def _manage(p: PrincipalDep) -> uuid.UUID:
    p.require("workspace.manage")
    assert p.tenant_id
    return p.tenant_id


@router.get("/home")
async def home(p: PrincipalDep, db: DbDep) -> dict[str, Any]:
    assert p.tenant_id
    async with db.control() as s:
        t = (
            await s.execute(
                text(
                    "SELECT name, pack_id, pack_version, onboarding_step, settings FROM control.tenant WHERE id = :t"
                ),
                {"t": p.tenant_id},
            )
        ).one()
        live = (
            await s.execute(
                text(
                    "SELECT r.version FROM control.release_deployment d JOIN control.release r ON r.id = d.release_id "
                    "WHERE d.tenant_id = :t AND d.environment = 'live' ORDER BY d.id DESC LIMIT 1"
                ),
                {"t": p.tenant_id},
            )
        ).scalar_one_or_none()
        people = (
            await s.execute(
                text("SELECT count(*) FROM control.membership WHERE tenant_id = :t"),
                {"t": p.tenant_id},
            )
        ).scalar_one()
        invites = (
            await s.execute(
                text("SELECT count(*) FROM control.invitation WHERE tenant_id = :t"),
                {"t": p.tenant_id},
            )
        ).scalar_one()
        did = {
            r.action
            for r in (
                await s.execute(
                    text(
                        "SELECT DISTINCT action FROM control.audit_event WHERE tenant_id = :t AND action IN ('role.save', 'import.start')"
                    ),
                    {"t": p.tenant_id},
                )
            ).all()
        }
    settings = t.settings or {}
    checklist = [
        {
            "key": "import",
            "label": "Import your data",
            "done": "import.start" in did,
            "to": "/import",
        },
        {
            "key": "invite",
            "label": "Invite your team",
            "done": people > 1 or invites > 0,
            "to": "/team",
        },
        {
            "key": "roles",
            "label": "Set roles and permissions",
            "done": "role.save" in did,
            "to": "/settings/roles",
        },
        {
            "key": "brand",
            "label": "Brand the app",
            "done": "brand" in settings,
            "to": "/settings/brand",
        },
    ]
    return {
        "workspace": t.name,
        "pack_id": t.pack_id,
        "pack_version": t.pack_version,
        "release_version": live,
        "step": t.onboarding_step,
        "checklist": checklist,
        "pack_updates": [],
    }


@router.get("/people")
async def people(p: PrincipalDep, db: DbDep) -> list[dict[str, Any]]:
    tid = _manage(p)
    async with db.control() as s:
        return await admin.list_people(s, tid)


@router.post("/people/{user_id}/deactivate", status_code=204)
async def deactivate(user_id: uuid.UUID, p: PrincipalDep, db: DbDep, request: Request) -> None:
    tid = _manage(p)
    async with db.control() as s:
        await admin.set_active(
            s,
            tenant_id=tid,
            actor_id=p.user_id,
            user_id=user_id,
            active=False,
            request_id=get_request_id(request),
        )


@router.post("/people/{user_id}/activate", status_code=204)
async def activate(user_id: uuid.UUID, p: PrincipalDep, db: DbDep, request: Request) -> None:
    tid = _manage(p)
    async with db.control() as s:
        await admin.set_active(
            s,
            tenant_id=tid,
            actor_id=p.user_id,
            user_id=user_id,
            active=True,
            request_id=get_request_id(request),
        )


@router.put("/people/{user_id}/role", status_code=204)
async def change_role(
    user_id: uuid.UUID, body: RoleChange, p: PrincipalDep, db: DbDep, request: Request
) -> None:
    tid = _manage(p)
    async with db.control() as s:
        await admin.set_member_role(
            s,
            tenant_id=tid,
            actor_id=p.user_id,
            user_id=user_id,
            role_key=body.role,
            request_id=get_request_id(request),
        )


@router.get("/teams")
async def teams(p: PrincipalDep, db: DbDep) -> list[dict[str, Any]]:
    tid = _manage(p)
    async with db.control() as s:
        return await admin.list_teams(s, tid)


@router.post("/teams", status_code=201)
async def new_team(body: TeamBody, p: PrincipalDep, db: DbDep) -> dict[str, Any]:
    tid = _manage(p)
    async with db.control() as s:
        return await admin.create_team(s, tid, body.name)


@router.put("/teams/{team_id}/members", status_code=204)
async def team_members(team_id: uuid.UUID, body: MembersBody, p: PrincipalDep, db: DbDep) -> None:
    tid = _manage(p)
    async with db.control() as s:
        await admin.set_team_members(s, tid, team_id, body.user_ids)


@router.get("/roles")
async def roles(p: PrincipalDep, db: DbDep) -> list[dict[str, Any]]:
    tid = _manage(p)
    async with db.control() as s:
        return await admin.list_roles(s, tid)


@router.post("/roles", status_code=201)
async def new_role(
    body: NewRoleBody, p: PrincipalDep, db: DbDep, request: Request
) -> dict[str, str]:
    tid = _manage(p)
    async with db.control() as s:
        await admin.save_role(
            s,
            tenant_id=tid,
            actor_id=p.user_id,
            key=body.key,
            name=body.name,
            description=body.description,
            grants=body.grants,
            scopes=body.scopes,
            field_deny=body.field_deny,
            request_id=get_request_id(request),
        )
    return {"key": body.key}


@router.put("/roles/{key}", status_code=204)
async def edit_role(key: str, body: RoleBody, p: PrincipalDep, db: DbDep, request: Request) -> None:
    tid = _manage(p)
    async with db.control() as s:
        await admin.save_role(
            s,
            tenant_id=tid,
            actor_id=p.user_id,
            key=key,
            name=body.name,
            description=body.description,
            grants=body.grants,
            scopes=body.scopes,
            field_deny=body.field_deny,
            request_id=get_request_id(request),
        )


@router.delete("/roles/{key}", status_code=204)
async def remove_role(key: str, p: PrincipalDep, db: DbDep) -> None:
    tid = _manage(p)
    async with db.control() as s:
        await admin.delete_role(s, tid, key)


@router.get("/settings")
async def settings(p: PrincipalDep, db: DbDep) -> dict[str, Any]:
    assert p.tenant_id
    async with db.control() as s:
        return await admin.get_settings(s, p.tenant_id)


@router.put("/settings/brand")
async def brand(body: BrandBody, p: PrincipalDep, db: DbDep, request: Request) -> dict[str, Any]:
    tid = _manage(p)
    async with db.control() as s:
        return await admin.save_brand(
            s,
            tenant_id=tid,
            actor_id=p.user_id,
            app_name=body.app_name,
            accent=body.accent,
            logo_file_id=body.logo_file_id,
            request_id=get_request_id(request),
        )


@router.put("/settings/regional")
async def regional(
    body: dict[str, str], p: PrincipalDep, db: DbDep, request: Request
) -> dict[str, Any]:
    tid = _manage(p)
    async with db.control() as s:
        return await admin.save_regional(
            s, tenant_id=tid, actor_id=p.user_id, values=body, request_id=get_request_id(request)
        )
