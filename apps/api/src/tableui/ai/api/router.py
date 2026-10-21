import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from tableui.ai.application import features, gateway
from tableui.ai.application import settings as store
from tableui.identity.api.deps import PrincipalDep
from tableui.metadata.api.deps import LiveAppDep
from tableui.metadata.public import Pack
from tableui.platform.config import Settings
from tableui.platform.db import Database
from tableui.platform.web import get_analytics, get_db, get_request_id, get_settings_dep

router = APIRouter(prefix="/v1/ai", tags=["ai"])
DbDep = Annotated[Database, Depends(get_db)]
AnalyticsDep = Annotated[Database, Depends(get_analytics)]
SettingsDep = Annotated[Settings, Depends(get_settings_dep)]


class SettingsBody(BaseModel):
    enabled: bool | None = None
    tables: list[str] | None = None
    monthly_token_cap: int | None = None


class ExtractBody(BaseModel):
    screen: str
    file_id: uuid.UUID


class SummaryBody(BaseModel):
    table: str
    id: uuid.UUID


class ExplainBody(BaseModel):
    screen: str
    source_id: uuid.UUID
    target_id: uuid.UUID


class AskBody(BaseModel):
    table: str
    question: str


class DraftBody(BaseModel):
    table: str
    id: uuid.UUID
    intent: str


class NumberBody(BaseModel):
    measure: str
    range: str | None = None


async def _pack(db: Database, req: Request, tenant_id: uuid.UUID) -> Pack | None:
    from sqlalchemy import text

    async with db.tenant(tenant_id) as s:
        pid = (await s.execute(text("SELECT definition ->> 'id' FROM metadata_object WHERE kind = 'pack'"))).scalar_one_or_none()  # fmt: skip
    cat = req.app.state.catalog
    return cat.get(pid) if pid and pid in cat.packs else None


async def _ctx(
    req: Request, p: Any, db: Database, analytics: Database, s: Settings
) -> features.Ctx:
    assert p.tenant_id
    return features.Ctx(
        db, analytics, req.app.state.ai_provider, await _pack(db, req, p.tenant_id), s
    )


@router.get("/settings")
async def get_settings(p: PrincipalDep, app: LiveAppDep, db: DbDep, req: Request) -> dict[str, Any]:
    """Anyone can ask whether AI is on (so buttons show or hide); the usage detail is for those who configure it."""
    assert p.tenant_id
    cur = await gateway.get_setting(db, p.tenant_id)
    prov = req.app.state.ai_provider
    out: dict[str, Any] = {
        "enabled": cur["enabled"] and p.allows("ai.use"),
        "tables": cur["tables"],
        "available": prov is not None,
        "provider": prov.name if prov else None,
    }
    if p.allows("ai.configure"):
        out |= {
            "monthly_token_cap": cur["monthly_token_cap"],
            "used_tokens": cur["used_tokens"],
            "all_tables": sorted(app.tables),
            "recent": await store.recent_calls(db, p.tenant_id),
        }
    return out


@router.put("/settings")
async def put_settings(
    body: SettingsBody, req: Request, p: PrincipalDep, app: LiveAppDep, db: DbDep
) -> dict[str, Any]:
    p.require("ai.configure")
    assert p.tenant_id
    await store.set_setting(
        db, tenant_id=p.tenant_id, user_id=p.user_id, known_tables=set(app.tables), enabled=body.enabled,
        tables=body.tables, cap=body.monthly_token_cap, request_id=get_request_id(req),
    )  # fmt: skip
    return await get_settings(p, app, db, req)


@router.post("/extract")
async def extract(
    body: ExtractBody,
    req: Request,
    p: PrincipalDep,
    app: LiveAppDep,
    db: DbDep,
    an: AnalyticsDep,
    s: SettingsDep,
) -> dict[str, Any]:
    return await features.extract_fields(
        await _ctx(req, p, db, an, s), p, app, body.screen, body.file_id
    )


@router.post("/summary")
async def summary(
    body: SummaryBody,
    req: Request,
    p: PrincipalDep,
    app: LiveAppDep,
    db: DbDep,
    an: AnalyticsDep,
    s: SettingsDep,
) -> dict[str, Any]:
    return await features.record_summary(await _ctx(req, p, db, an, s), p, app, body.table, body.id)


@router.post("/explain-match")
async def explain_match(
    body: ExplainBody,
    req: Request,
    p: PrincipalDep,
    app: LiveAppDep,
    db: DbDep,
    an: AnalyticsDep,
    s: SettingsDep,
) -> dict[str, Any]:
    return await features.explain_match(
        await _ctx(req, p, db, an, s), p, app, body.screen, body.source_id, body.target_id
    )


@router.post("/ask")
async def ask(
    body: AskBody,
    req: Request,
    p: PrincipalDep,
    app: LiveAppDep,
    db: DbDep,
    an: AnalyticsDep,
    s: SettingsDep,
) -> dict[str, Any]:
    return await features.ask_filter(
        await _ctx(req, p, db, an, s), p, app, body.table, body.question
    )


@router.post("/draft")
async def draft(
    body: DraftBody,
    req: Request,
    p: PrincipalDep,
    app: LiveAppDep,
    db: DbDep,
    an: AnalyticsDep,
    s: SettingsDep,
) -> dict[str, Any]:
    return await features.draft_message(
        await _ctx(req, p, db, an, s), p, app, body.table, body.id, body.intent
    )


@router.post("/explain-number")
async def explain_number(
    body: NumberBody,
    req: Request,
    p: PrincipalDep,
    app: LiveAppDep,
    db: DbDep,
    an: AnalyticsDep,
    s: SettingsDep,
) -> dict[str, Any]:
    return await features.explain_number(
        await _ctx(req, p, db, an, s), p, app, body.measure, body.range
    )
