import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Request, UploadFile
from pydantic import BaseModel

from tableui.ai.application import features, gateway, schema_doc, setup
from tableui.ai.application import settings as store
from tableui.identity.api.deps import PrincipalDep
from tableui.metadata.api.deps import LiveAppDep
from tableui.metadata.public import Pack, outline
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


async def _draft_tables(db: Database, tenant_id: uuid.UUID) -> list[str]:
    """Table keys from the Draft, so a workspace with nothing published yet can still set AI up."""
    async with db.control() as s:
        return sorted(t["key"] for t in (await outline(s, tenant_id))["tables"])


@router.get("/settings")
async def get_settings(p: PrincipalDep, db: DbDep, req: Request) -> dict[str, Any]:
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
            "all_tables": await _draft_tables(db, p.tenant_id),
            "recent": await store.recent_calls(db, p.tenant_id),
        }
    return out


@router.put("/settings")
async def put_settings(
    body: SettingsBody, req: Request, p: PrincipalDep, db: DbDep
) -> dict[str, Any]:
    p.require("ai.configure")
    assert p.tenant_id
    await store.set_setting(
        db, tenant_id=p.tenant_id, user_id=p.user_id, known_tables=set(await _draft_tables(db, p.tenant_id)), enabled=body.enabled,
        tables=body.tables, cap=body.monthly_token_cap, request_id=get_request_id(req),
    )  # fmt: skip
    return await get_settings(p, db, req)


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


class PatternBody(BaseModel):
    description: str


@router.post("/pattern")
async def pattern(
    body: PatternBody, req: Request, p: PrincipalDep, db: DbDep, an: AnalyticsDep, s: SettingsDep
) -> dict[str, Any]:
    """A suggested validation pattern from a description. Nothing is saved; the builder presses Use as rule."""
    return await features.pattern_from_words(await _ctx(req, p, db, an, s), p, body.description)


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


# ---- setup by chat -----------------------------------------------------------------------------------
# These never need a Live app: a new workspace with no pack builds its first tables this way.


class SetupMessage(BaseModel):
    message: str


class ApplyBody(BaseModel):
    steps: list[int]


@router.get("/setup")
async def setup_state(p: PrincipalDep, db: DbDep, req: Request) -> dict[str, Any]:
    p.require("ai.setup")
    assert p.tenant_id
    cur = await gateway.get_setting(db, p.tenant_id)
    prov = req.app.state.ai_provider
    return {
        **await setup.current(db, p.tenant_id),
        "enabled": cur["enabled"],
        "available": prov is not None,
        "can_apply": p.allows("metadata.write"),
    }


@router.post("/setup/messages")
async def setup_message(
    body: SetupMessage, req: Request, p: PrincipalDep, db: DbDep, an: AnalyticsDep, s: SettingsDep
) -> dict[str, Any]:
    return await setup.propose(await _ctx(req, p, db, an, s), p, body.message, get_request_id(req))


@router.post("/setup/plans/{plan_id}/apply")
async def setup_apply(
    plan_id: uuid.UUID, body: ApplyBody, req: Request, p: PrincipalDep, db: DbDep
) -> dict[str, Any]:
    p.require("ai.setup")
    p.require("metadata.write")
    return await setup.apply(db, p, plan_id, body.steps, get_request_id(req))


@router.post("/setup/plans/{plan_id}/undo")
async def setup_undo(
    plan_id: uuid.UUID, req: Request, p: PrincipalDep, db: DbDep
) -> dict[str, Any]:
    p.require("ai.setup")
    p.require("metadata.write")
    return await setup.undo(db, p, plan_id, get_request_id(req))


@router.post("/setup/plans/{plan_id}/discard", status_code=204)
async def setup_discard(plan_id: uuid.UUID, p: PrincipalDep, db: DbDep) -> None:
    p.require("ai.setup")
    await setup.discard(db, p, plan_id)


@router.post("/schema-from-document")
async def schema_from_document(
    req: Request,
    p: PrincipalDep,
    db: DbDep,
    an: AnalyticsDep,
    s: SettingsDep,
    file: Annotated[UploadFile, File()],
) -> dict[str, Any]:
    """Read a PDF, Word or text file and propose tables as a JSON Schema. Nothing is saved: the
    schema goes through the Import schema preview, where the person checks it."""
    p.require("metadata.write")
    data = await file.read(schema_doc.MAX_BYTES + 1)
    return await schema_doc.propose(
        await _ctx(req, p, db, an, s), p, file.filename or "document", data
    )
