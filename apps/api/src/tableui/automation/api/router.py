import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ValidationError

from tableui.automation.application import engine, needs, notifications
from tableui.commands.public import CommandContext
from tableui.identity.api.deps import PrincipalDep
from tableui.metadata.api.deps import LiveAppDep
from tableui.metadata.public import AutomationDef, automation_problems
from tableui.platform.config import Settings
from tableui.platform.db import Database
from tableui.platform.errors import ValidationFailed
from tableui.platform.web import get_db, get_request_id, get_settings_dep

router = APIRouter(prefix="/v1", tags=["automation"])
DbDep = Annotated[Database, Depends(get_db)]
SettingsDep = Annotated[Settings, Depends(get_settings_dep)]


class ReadBody(BaseModel):
    ids: list[uuid.UUID] | None = None


class PrefsBody(BaseModel):
    channels: dict[str, str] | None = None
    digest: bool | None = None


class TokenBody(BaseModel):
    token: str


class DismissBody(BaseModel):
    dismissed: bool


def _ctx(req: Request, p: Any, app: Any, s: Settings) -> CommandContext:
    return CommandContext(
        principal=p, app=app, app_version=s.app_version, request_id=get_request_id(req)
    )


# ---- the bell ---------------------------------------------------------------------------------


@router.get("/notifications")
async def inbox(p: PrincipalDep, db: DbDep, limit: int = 30) -> dict[str, Any]:
    assert p.tenant_id
    async with db.control() as c:
        return await notifications.inbox(c, p.tenant_id, p.user_id, limit=min(limit, 100))


@router.post("/notifications/read")
async def read(body: ReadBody, p: PrincipalDep, db: DbDep) -> dict[str, Any]:
    assert p.tenant_id
    async with db.control() as c:
        n = await notifications.mark_read(c, p.tenant_id, p.user_id, body.ids)
        return {"marked": n, "unread": await notifications.unread_count(c, p.tenant_id, p.user_id)}


@router.get("/notifications/preferences")
async def get_preferences(p: PrincipalDep, db: DbDep) -> dict[str, Any]:
    assert p.tenant_id
    async with db.control() as c:
        return await notifications.preferences(c, p.tenant_id, p.user_id)


@router.put("/notifications/preferences")
async def put_preferences(body: PrefsBody, p: PrincipalDep, db: DbDep) -> dict[str, Any]:
    assert p.tenant_id
    async with db.control() as c:
        return await notifications.set_preferences(
            c, p.tenant_id, p.user_id, channels=body.channels, digest=body.digest
        )


@router.post("/notifications/unsubscribe")
async def unsubscribe(body: TokenBody, db: DbDep, s: SettingsDep) -> dict[str, bool]:
    """From the link in the daily summary email. No sign-in: the signed link is the proof."""
    async with db.control() as c:
        ok = await notifications.unsubscribe(c, s.signing_key, body.token)
    if not ok:
        raise ValidationFailed("This link is not valid.")
    return {"ok": True}


# ---- what needs me, first steps, sample data --------------------------------------------------


@router.get("/me/needs")
async def needs_me(p: PrincipalDep, app: LiveAppDep, db: DbDep) -> dict[str, Any]:
    return await needs.needs_me(db, p, app)


@router.post("/me/tasks/{table}/{record_id}/done")
async def finish_task(
    table: str,
    record_id: uuid.UUID,
    req: Request,
    p: PrincipalDep,
    app: LiveAppDep,
    db: DbDep,
    s: SettingsDep,
) -> dict[str, Any]:
    p.require(f"record.{table}.update")
    return await needs.finish_task(db, _ctx(req, p, app, s), table, record_id)


@router.get("/me/guide")
async def my_guide(req: Request, p: PrincipalDep, db: DbDep) -> dict[str, Any] | None:
    return await needs.guide(db, p, req.app.state.catalog)


@router.put("/me/guide")
async def dismiss_guide(body: DismissBody, p: PrincipalDep, db: DbDep) -> dict[str, bool]:
    async with db.control() as c:
        await needs.set_guide_dismissed(c, p, body.dismissed)
    return {"dismissed": body.dismissed}


@router.get("/workspace/sample")
async def sample_status(req: Request, p: PrincipalDep, db: DbDep) -> dict[str, Any]:
    p.require("import.run")
    return await needs.sample_status(db, p, req.app.state.catalog)


@router.post("/workspace/sample", status_code=201)
async def load_sample(
    req: Request, p: PrincipalDep, app: LiveAppDep, db: DbDep, s: SettingsDep
) -> dict[str, Any]:
    p.require("import.run")
    return await needs.load_samples(db, _ctx(req, p, app, s), req.app.state.catalog)


@router.delete("/workspace/sample")
async def remove_sample(
    req: Request, p: PrincipalDep, app: LiveAppDep, db: DbDep, s: SettingsDep
) -> dict[str, Any]:
    p.require("import.run")
    return await needs.remove_samples(db, _ctx(req, p, app, s))


# ---- the automations' own history -------------------------------------------------------------


@router.get("/automations/runs")
async def runs(
    p: PrincipalDep,
    db: DbDep,
    automation: str | None = None,
    status: str | None = None,
    limit: int = 30,
) -> list[dict[str, Any]]:
    p.require("metadata.read")
    assert p.tenant_id
    async with db.control() as c:
        return await engine.recent_runs(
            c, p.tenant_id, automation=automation, status=status, limit=limit
        )


@router.post("/automations/runs/{run_id}/retry")
async def retry(
    run_id: uuid.UUID, req: Request, p: PrincipalDep, db: DbDep, s: SettingsDep
) -> dict[str, str]:
    p.require("metadata.write")
    assert p.tenant_id
    status = await engine.retry_now(db, req.app.state.mailer, s, p.tenant_id, run_id)
    return {"status": status}


@router.post("/automations/preview")
async def preview(
    body: dict[str, Any], p: PrincipalDep, app: LiveAppDep, db: DbDep
) -> dict[str, Any]:
    """Before saving: how many records this would have matched."""
    p.require("metadata.read")
    assert p.tenant_id
    try:
        a = AutomationDef.model_validate({"key": "preview", "label": "Preview", **body})
    except ValidationError as e:
        raise ValidationFailed(
            errors=[
                {
                    "field": ".".join(str(x) for x in err["loc"]),
                    "code": "invalid",
                    "message": err["msg"],
                }
                for err in e.errors()
            ]
        ) from None
    found = automation_problems(a, app.tables)
    if found:
        raise ValidationFailed(
            errors=[{"field": f, "code": "invalid", "message": m} for f, m in found]
        )
    return await engine.preview(db, p.tenant_id, app, a)
