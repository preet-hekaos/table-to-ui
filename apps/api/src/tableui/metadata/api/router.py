import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel

from tableui.identity.api.deps import PrincipalDep
from tableui.metadata.api.deps import LiveAppDep
from tableui.metadata.application import automations as automation_builder
from tableui.metadata.application import draft, releases, schema_changes, studio
from tableui.metadata.application import measures as measure_builder
from tableui.metadata.application import relationships as rel
from tableui.metadata.domain.diff import diff_manifests
from tableui.metadata.domain.models import menu_sorted
from tableui.metadata.domain.patterns import LIBRARY
from tableui.metadata.domain.stages import item_stages
from tableui.platform.db import Database
from tableui.platform.errors import NotFound, PermissionDenied
from tableui.platform.web import get_db, get_request_id

router = APIRouter(prefix="/v1", tags=["studio"])
DbDep = Annotated[Database, Depends(get_db)]


class ReleaseOut(BaseModel):
    version: int
    release_id: str


def _owner(p: Any) -> bool:
    return "*" in p.permissions


@router.get("/studio/tables")
async def studio_tables(p: PrincipalDep, db: DbDep) -> list[dict[str, Any]]:
    """The Draft: tables and fields as the builder sees them, with where each came from."""
    p.require("metadata.read")
    assert p.tenant_id
    async with db.control() as s:
        tables = await studio.read_draft(s, p.tenant_id, "table")
    return tables


@router.post("/studio/tables", status_code=201)
async def create_table(
    body: dict[str, Any], p: PrincipalDep, db: DbDep, request: Request
) -> dict[str, Any]:
    p.require("metadata.write")
    assert p.tenant_id
    async with db.control() as s:
        return await studio.create_table(
            s,
            tenant_id=p.tenant_id,
            user_id=p.user_id,
            body=body,
            request_id=get_request_id(request),
        )


@router.post("/studio/tables/{table}/fields", status_code=201)
async def add_field(
    table: str, body: dict[str, Any], p: PrincipalDep, db: DbDep, request: Request
) -> dict[str, Any]:
    p.require("metadata.write")
    assert p.tenant_id
    async with db.control() as s:
        return await studio.add_field(
            s,
            tenant_id=p.tenant_id,
            user_id=p.user_id,
            table_key=table,
            body=body,
            request_id=get_request_id(request),
        )


@router.patch("/studio/tables/{table}/fields/{field}")
async def update_field(
    table: str, field: str, body: dict[str, Any], p: PrincipalDep, db: DbDep, request: Request
) -> dict[str, Any]:
    p.require("metadata.write")
    assert p.tenant_id
    async with db.control() as s:
        return await studio.update_field(
            s,
            tenant_id=p.tenant_id,
            user_id=p.user_id,
            table_key=table,
            field_key=field,
            body=body,
            request_id=get_request_id(request),
        )


@router.get("/studio/tables/{table}/fields/{field}/length-impact")
async def length_impact(
    table: str, field: str, p: PrincipalDep, db: DbDep, max_length: Annotated[int, Query(ge=1)]
) -> dict[str, int]:
    p.require("metadata.write")
    assert p.tenant_id
    async with db.control() as s:
        return await studio.length_impact(
            s, tenant_id=p.tenant_id, table_key=table, field_key=field, max_length=max_length
        )


@router.get("/studio/tables/{table}/fields/{field}/value-count")
async def value_count(table: str, field: str, p: PrincipalDep, db: DbDep) -> dict[str, int]:
    p.require("metadata.write")
    assert p.tenant_id
    async with db.control() as s:
        return await studio.value_count(s, tenant_id=p.tenant_id, table_key=table, field_key=field)


@router.get("/studio/validation-library")
async def validation_library(p: PrincipalDep) -> list[dict[str, Any]]:
    p.require("metadata.write")
    return [
        {
            "key": i.key,
            "name": i.name,
            "kind": i.kind,
            "pattern": i.pattern,
            "message": i.message,
            "good": list(i.good),
            "bad": list(i.bad),
        }
        for i in LIBRARY
    ]


@router.post("/studio/validation-preview")
async def validation_preview(body: dict[str, Any], p: PrincipalDep) -> dict[str, Any]:
    """Runs one rule over sample values with the same engine the live app uses. Saves nothing."""
    p.require("metadata.write")
    rule = body.get("rule")
    values = body.get("values")
    if not isinstance(rule, dict) or not isinstance(values, list):
        raise HTTPException(422, "send a rule and a list of values")
    return {"results": studio.rule_preview(rule, [str(v) for v in values])}


@router.post("/studio/tables/{table}/fields/{field}/transform-preview")
async def transform_preview(
    table: str, field: str, body: dict[str, Any], p: PrincipalDep, db: DbDep
) -> dict[str, Any]:
    """Try a value: what the drafted transformation rules do to sample values, and whether the result is then valid."""
    p.require("metadata.write")
    assert p.tenant_id
    transforms, samples = body.get("transforms"), body.get("samples")
    if not isinstance(transforms, list) or not isinstance(samples, list):
        raise HTTPException(422, "send the rules and a list of samples")
    async with db.control() as s:
        return {
            "results": await studio.transform_preview(
                s, p.tenant_id, table, field, transforms, samples
            )
        }


@router.get("/studio/standard-values")
async def standard_values(p: PrincipalDep) -> list[dict[str, str]]:
    p.require("metadata.write")
    from tableui.metadata.domain.transforms import STANDARD

    return [{"key": k, "label": v} for k, v in STANDARD.items() if k != "now"]


@router.post("/studio/tables/{table}/fields/{field}/rules/check-existing")
async def rules_check_existing(
    table: str, field: str, body: dict[str, Any], p: PrincipalDep, db: DbDep
) -> dict[str, int]:
    p.require("metadata.write")
    assert p.tenant_id
    async with db.control() as s:
        return await studio.rules_check_existing(
            s,
            tenant_id=p.tenant_id,
            table_key=table,
            field_key=field,
            rules=body.get("rules"),
        )


@router.put("/studio/tables/{table}/field-order")
async def reorder_fields(
    table: str, body: dict[str, Any], p: PrincipalDep, db: DbDep, request: Request
) -> dict[str, Any]:
    p.require("metadata.write")
    assert p.tenant_id
    order = body.get("order")
    if not isinstance(order, list) or not all(isinstance(k, str) for k in order):
        raise HTTPException(422, "order must be a list of field keys")
    async with db.control() as s:
        return await studio.reorder_fields(
            s,
            tenant_id=p.tenant_id,
            user_id=p.user_id,
            table_key=table,
            order=order,
            request_id=get_request_id(request),
        )


@router.delete("/studio/tables/{table}/fields/{field}", status_code=204)
async def remove_field(
    table: str, field: str, p: PrincipalDep, db: DbDep, request: Request
) -> Response:
    p.require("metadata.write")
    assert p.tenant_id
    async with db.control() as s:
        await studio.remove_field(
            s,
            tenant_id=p.tenant_id,
            user_id=p.user_id,
            table_key=table,
            field_key=field,
            request_id=get_request_id(request),
        )
    return Response(status_code=204)


@router.get("/studio/type-presets")
async def type_presets(p: PrincipalDep, db: DbDep) -> dict[str, Any]:
    """The types a builder can pick (real-world names over core types), ranked by use, with the allowed type changes."""
    p.require("metadata.read")
    assert p.tenant_id
    async with db.control() as s:
        tables = await studio.read_draft(s, p.tenant_id, "table")
    used: dict[str, int] = {}
    for t in tables:
        for f in t.get("fields", []):
            if f.get("type_name"):
                used[f["type_name"]] = used.get(f["type_name"], 0) + 1
    from tableui.metadata.domain.presets import COMPATIBLE, PRESETS

    ranked = sorted(PRESETS, key=lambda x: (-used.get(x.name, 0), PRESETS.index(x)))
    return {
        "presets": [
            {
                "key": x.key,
                "name": x.name,
                "core": x.core,
                "area": x.area,
                "description": x.description,
                "example": x.example,
                "max_length": x.max_length,
                "save_as": x.save_as,
                "min": x.min,
                "max": x.max,
                "used": used.get(x.name, 0),
            }
            for x in ranked
        ],
        "compatible": {k: sorted(v) for k, v in COMPATIBLE.items()},
    }


@router.post("/studio/tables/{table}/fields/{field}/restore")
async def restore_field(
    table: str, field: str, p: PrincipalDep, db: DbDep, request: Request
) -> dict[str, Any]:
    """Undo a field deletion that has not been published yet."""
    p.require("metadata.write")
    assert p.tenant_id
    async with db.control() as s:
        test = await releases.environment_manifest(s, p.tenant_id, "test")
        live = await releases.environment_manifest(s, p.tenant_id, "live")
    async with db.control() as s:
        return await studio.restore_field(
            s,
            tenant_id=p.tenant_id,
            user_id=p.user_id,
            table_key=table,
            field_key=field,
            earlier=[test[1] if test else None, live[1] if live else None],
            request_id=get_request_id(request),
        )


@router.get("/studio/relationships")
async def relationships(p: PrincipalDep, db: DbDep) -> list[dict[str, Any]]:
    p.require("metadata.read")
    assert p.tenant_id
    async with db.control() as s:
        return await rel.list_links(s, p.tenant_id)


@router.get("/studio/relationships/health")
async def relationship_health(p: PrincipalDep, db: DbDep) -> list[dict[str, Any]]:
    p.require("metadata.read")
    assert p.tenant_id
    async with db.control() as s:
        return await rel.health(s, p.tenant_id)


@router.post("/studio/relationships", status_code=201)
async def add_relationship(
    body: dict[str, Any], p: PrincipalDep, db: DbDep, request: Request
) -> dict[str, Any]:
    p.require("metadata.write")
    assert p.tenant_id
    async with db.control() as s:
        return await rel.add_link(
            s,
            tenant_id=p.tenant_id,
            user_id=p.user_id,
            body=body,
            request_id=get_request_id(request),
        )


@router.post("/studio/relationships/many-to-many", status_code=201)
async def add_many_to_many(
    body: dict[str, Any], p: PrincipalDep, db: DbDep, request: Request
) -> dict[str, Any]:
    p.require("metadata.write")
    assert p.tenant_id
    async with db.control() as s:
        return await rel.add_many_to_many(
            s,
            tenant_id=p.tenant_id,
            user_id=p.user_id,
            body=body,
            request_id=get_request_id(request),
        )


@router.delete("/studio/relationships/{table}/{field}", status_code=204)
async def remove_relationship(
    table: str, field: str, p: PrincipalDep, db: DbDep, request: Request
) -> Response:
    p.require("metadata.write")
    assert p.tenant_id
    async with db.control() as s:
        await rel.remove_link(
            s,
            tenant_id=p.tenant_id,
            user_id=p.user_id,
            table_key=table,
            field_key=field,
            request_id=get_request_id(request),
        )
    return Response(status_code=204)


@router.get("/studio/layout")
async def studio_layout(p: PrincipalDep, db: DbDep) -> dict[str, Any]:
    p.require("metadata.read")
    assert p.tenant_id
    async with db.control() as s:
        return {"positions": await rel.get_layout(s, p.tenant_id)}


@router.put("/studio/layout")
async def save_studio_layout(body: dict[str, Any], p: PrincipalDep, db: DbDep) -> dict[str, Any]:
    p.require("metadata.write")
    assert p.tenant_id
    async with db.control() as s:
        return {
            "positions": await rel.save_layout(
                s, tenant_id=p.tenant_id, user_id=p.user_id, positions=body.get("positions") or {}
            )
        }


@router.get("/studio/screens")
async def studio_screens(p: PrincipalDep, db: DbDep) -> list[dict[str, Any]]:
    p.require("metadata.read")
    assert p.tenant_id
    async with db.control() as s:
        return await studio.read_draft(s, p.tenant_id, "screen")


@router.put("/studio/screens/{screen}")
async def save_screen(
    screen: str, body: dict[str, Any], p: PrincipalDep, db: DbDep, request: Request
) -> dict[str, Any]:
    p.require("metadata.write")
    assert p.tenant_id
    async with db.control() as s:
        return await studio.save_screen(
            s,
            tenant_id=p.tenant_id,
            user_id=p.user_id,
            body={**body, "key": screen},
            request_id=get_request_id(request),
        )


@router.get("/studio/navigation")
async def studio_navigation(p: PrincipalDep, db: DbDep) -> list[dict[str, Any]]:
    p.require("metadata.read")
    assert p.tenant_id
    async with db.control() as s:
        items = await studio.read_draft(s, p.tenant_id, "nav")
    return menu_sorted(items, lambda n: n.get("section", "main"), lambda n: n.get("order", 100))


class NavIn(BaseModel):
    items: list[dict[str, Any]]


@router.put("/studio/navigation")
async def save_navigation(
    body: NavIn, p: PrincipalDep, db: DbDep, request: Request
) -> list[dict[str, Any]]:
    p.require("metadata.write")
    assert p.tenant_id
    async with db.control() as s:
        return await studio.save_navigation(
            s,
            tenant_id=p.tenant_id,
            user_id=p.user_id,
            items=body.items,
            request_id=get_request_id(request),
        )


async def _draft_manifest(db: Database, tenant_id: Any) -> dict[str, Any]:
    async with db.tenant(tenant_id) as ts:
        return await draft.build_manifest(ts)


@router.get("/studio/status")
async def studio_status(p: PrincipalDep, db: DbDep) -> dict[str, Any]:
    """Whether the Draft differs from Live, and how."""
    p.require("metadata.read")
    assert p.tenant_id
    d = await _draft_manifest(db, p.tenant_id)
    async with db.control() as s:
        live = await releases.environment_manifest(s, p.tenant_id, "live")
    changes = diff_manifests(live[1] if live else {}, d)
    async with db.control() as s:
        warnings = await studio.draft_rule_warnings(s, p.tenant_id, changes, d)
    async with db.control() as s:
        blockers = await schema_changes.unique_blockers(
            s, p.tenant_id, live[1] if live else None, d
        )
    return {
        "live_version": live[0] if live else None,
        "draft_changed": changes["changed"],
        "changes": changes,
        "rule_warnings": warnings,
        "unique_blockers": blockers,
    }


@router.get("/studio/stages")
async def studio_stages(p: PrincipalDep, db: DbDep) -> dict[str, Any]:
    """The stage (Draft, Test, Live or removed) of every table, field, screen, menu item, rule, measure and automation."""
    p.require("metadata.read")
    assert p.tenant_id
    d = await _draft_manifest(db, p.tenant_id)
    async with db.control() as s:
        test = await releases.environment_manifest(s, p.tenant_id, "test")
        live = await releases.environment_manifest(s, p.tenant_id, "live")
    return {
        "test_version": test[0] if test else None,
        "live_version": live[0] if live else None,
        **item_stages(d, test[1] if test else None, live[1] if live else None),
    }


@router.get("/apps/current/compare")
async def compare(
    p: PrincipalDep, db: DbDep, from_: Annotated[str, Query(alias="from")], to: str = "draft"
) -> dict[str, Any]:
    """Every changed table, field, screen, menu item and rule between two versions (or the Draft)."""
    p.require("metadata.read")
    assert p.tenant_id

    async def load(v: str) -> dict[str, Any]:
        if v == "draft":
            return await _draft_manifest(db, p.tenant_id)
        if not v.isdigit():
            raise NotFound(f"There is no version {v}.")
        async with db.control() as s:
            return await releases.manifest_of(s, p.tenant_id, int(v))  # type: ignore[arg-type]

    return {"from": from_, "to": to, **diff_manifests(await load(from_), await load(to))}


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
    manifest = await _draft_manifest(db, p.tenant_id)
    async with db.control() as s:
        return await releases.publish_to_test(
            s,
            tenant_id=p.tenant_id,
            user_id=p.user_id,
            manifest=manifest,
            request_id=get_request_id(request),
        )


@router.post("/apps/current/releases/{version}/promote")
async def promote(
    version: int, p: PrincipalDep, db: DbDep, request: Request, response: Response
) -> dict[str, Any]:
    """Owners make a version Live at once; other builders ask an owner to approve it."""
    p.require("release.publish")
    assert p.tenant_id
    async with db.control() as s:
        if not _owner(p):
            response.status_code = 202
            return await releases.request_live(
                s,
                tenant_id=p.tenant_id,
                user_id=p.user_id,
                version=version,
                request_id=get_request_id(request),
            )
        out = await releases.promote_to_live(
            s,
            tenant_id=p.tenant_id,
            user_id=p.user_id,
            version=version,
            request_id=get_request_id(request),
        )
    return {**out, "status": "live"}


@router.get("/apps/current/approvals")
async def approvals(p: PrincipalDep, db: DbDep) -> list[dict[str, Any]]:
    p.require("metadata.read")
    assert p.tenant_id
    async with db.control() as s:
        return await releases.list_approvals(s, p.tenant_id)


class DecisionIn(BaseModel):
    approve: bool


@router.post("/apps/current/approvals/{approval_id}")
async def decide(
    approval_id: uuid.UUID, body: DecisionIn, p: PrincipalDep, db: DbDep, request: Request
) -> dict[str, Any]:
    if not _owner(p):
        raise PermissionDenied("Only a workspace owner can approve a version for Live.")
    assert p.tenant_id
    async with db.control() as s:
        return await releases.decide_live(
            s,
            tenant_id=p.tenant_id,
            user_id=p.user_id,
            approval_id=approval_id,
            approve=body.approve,
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
async def live_table(table: str, p: PrincipalDep, app: LiveAppDep) -> dict[str, Any]:
    """A table of the live app: drives forms, lists and detail pages."""
    t = app.tables.get(table)
    if t is None:
        raise NotFound(f"There is no table '{table}'.")
    out = t.model_dump(mode="json")
    if t.workflow is not None:
        # Stages can be renamed in the Studio; every screen shows the name, the record keeps the stored value.
        names = {st.key: (st.label or st.key) for st in t.workflow.stages}
        for f in out["fields"]:
            if f["key"] == t.workflow.field:
                f["option_labels"] = names
    denied = {f for (tk, f) in p.field_denies if tk == table}
    if denied:
        # A role that may not see a field is not shown its label either: screens treat it as hidden.
        for f in out["fields"]:
            if f["key"] in denied:
                f["hidden"] = True
    return {"release_version": app.release_version, "table": out}


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
    return not roles or role_key == "admin" or (role_key in roles)


def _pattern_ok(p: Any, sc: Any) -> bool:
    """Screens whose whole purpose is an action are left out for roles that could not do it."""
    if sc.pattern == "document_review":
        return bool(p.allows("document.upload"))
    if sc.pattern == "duplicate_review":
        return bool(p.allows(f"record.{sc.table}.merge"))
    return True


@router.get("/app/navigation")
async def live_navigation(p: PrincipalDep, app: LiveAppDep) -> dict[str, Any]:
    """Menu items for the signed-in user's role. Items whose table the user cannot read are left out."""
    items = []
    for n in app.navigation:
        sc = app.screens.get(n.screen)
        if sc is None or not _visible(n.roles, p.role_key) or not _visible(sc.roles, p.role_key):
            continue
        if not p.allows(f"record.{sc.table}.read") or not _pattern_ok(p, sc):
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


@router.get("/app/screens")
async def live_screens(
    p: PrincipalDep,
    app: LiveAppDep,
    table: str | None = None,
    pattern: str | None = None,
    source_table: str | None = None,
) -> list[dict[str, Any]]:
    """Screens of the live app (for example the profile of a table, or matches for a source table)."""
    out = []
    for sc in app.screens.values():
        if not _visible(sc.roles, p.role_key) or not p.allows(f"record.{sc.table}.read"):
            continue
        if not _pattern_ok(p, sc):
            continue
        if (table and sc.table != table) or (pattern and sc.pattern != pattern):
            continue
        if source_table and sc.config.get("source_table") != source_table:
            continue
        out.append(sc.model_dump(mode="json"))
    return out


@router.get("/app/screens/{screen}")
async def live_screen(screen: str, p: PrincipalDep, app: LiveAppDep) -> dict[str, Any]:
    sc = app.screens.get(screen)
    if sc is None or not _visible(sc.roles, p.role_key):
        raise NotFound(f"There is no screen '{screen}'.")
    return {"release_version": app.release_version, "screen": sc.model_dump(mode="json")}


@router.put("/studio/tables/{table}/stages")
async def update_stages(
    table: str, body: dict[str, Any], p: PrincipalDep, db: DbDep, request: Request
) -> dict[str, Any]:
    p.require("metadata.write")
    assert p.tenant_id
    async with db.control() as s:
        return await studio.update_stages(
            s,
            tenant_id=p.tenant_id,
            user_id=p.user_id,
            table_key=table,
            body=body,
            request_id=get_request_id(request),
        )


@router.put("/studio/tables/{table}/features")
async def set_table_features(
    table: str, body: dict[str, Any], p: PrincipalDep, db: DbDep, request: Request
) -> dict[str, Any]:
    p.require("metadata.write")
    assert p.tenant_id
    async with db.control() as s:
        return await studio.set_features(
            s,
            tenant_id=p.tenant_id,
            user_id=p.user_id,
            table_keys=[table],
            body=body,
            request_id=get_request_id(request),
        )


@router.put("/studio/features")
async def set_all_features(
    body: dict[str, Any], p: PrincipalDep, db: DbDep, request: Request
) -> dict[str, Any]:
    """Apply the same features to every table."""
    p.require("metadata.write")
    assert p.tenant_id
    async with db.control() as s:
        return await studio.set_features(
            s,
            tenant_id=p.tenant_id,
            user_id=p.user_id,
            table_keys=None,
            body=body,
            request_id=get_request_id(request),
        )


@router.put("/studio/rules/{rule}/checks/{check}")
async def set_check_severity(
    rule: str, check: str, body: dict[str, Any], p: PrincipalDep, db: DbDep, request: Request
) -> dict[str, Any]:
    p.require("metadata.write")
    assert p.tenant_id
    async with db.control() as s:
        return await studio.set_check_severity(
            s,
            tenant_id=p.tenant_id,
            user_id=p.user_id,
            rule_id=rule,
            check_id=check,
            severity=str(body.get("severity", "")),
            request_id=get_request_id(request),
        )


@router.get("/studio/rules")
async def studio_rules(p: PrincipalDep, db: DbDep) -> list[dict[str, Any]]:
    p.require("metadata.read")
    assert p.tenant_id
    async with db.control() as s:
        return await studio.read_draft(s, p.tenant_id, "rule")


@router.get("/studio/measures")
async def studio_measures(p: PrincipalDep, db: DbDep) -> list[dict[str, Any]]:
    p.require("metadata.read")
    assert p.tenant_id
    async with db.control() as s:
        return await measure_builder.list_measures(s, p.tenant_id)


@router.post("/studio/measures", status_code=201)
async def add_measure(
    body: dict[str, Any], p: PrincipalDep, db: DbDep, request: Request
) -> dict[str, Any]:
    p.require("metadata.write")
    assert p.tenant_id
    async with db.control() as s:
        return await measure_builder.save_measure(
            s,
            tenant_id=p.tenant_id,
            user_id=p.user_id,
            key=None,
            body=body,
            request_id=get_request_id(request),
        )


@router.put("/studio/measures/{key}")
async def change_measure(
    key: str, body: dict[str, Any], p: PrincipalDep, db: DbDep, request: Request
) -> dict[str, Any]:
    p.require("metadata.write")
    assert p.tenant_id
    async with db.control() as s:
        return await measure_builder.save_measure(
            s,
            tenant_id=p.tenant_id,
            user_id=p.user_id,
            key=key,
            body=body,
            request_id=get_request_id(request),
        )


@router.delete("/studio/measures/{key}", status_code=204)
async def delete_measure(key: str, p: PrincipalDep, db: DbDep, request: Request) -> None:
    p.require("metadata.write")
    assert p.tenant_id
    async with db.control() as s:
        await measure_builder.remove_measure(
            s, tenant_id=p.tenant_id, user_id=p.user_id, key=key, request_id=get_request_id(request)
        )


@router.get("/studio/automations")
async def studio_automations(p: PrincipalDep, db: DbDep) -> list[dict[str, Any]]:
    p.require("metadata.read")
    assert p.tenant_id
    async with db.control() as s:
        return await automation_builder.list_automations(s, p.tenant_id)


@router.post("/studio/automations", status_code=201)
async def add_automation(
    body: dict[str, Any], p: PrincipalDep, db: DbDep, request: Request
) -> dict[str, Any]:
    p.require("metadata.write")
    assert p.tenant_id
    async with db.control() as s:
        return await automation_builder.save_automation(
            s,
            tenant_id=p.tenant_id,
            user_id=p.user_id,
            key=None,
            body=body,
            request_id=get_request_id(request),
        )


@router.put("/studio/automations/{key}")
async def change_automation(
    key: str, body: dict[str, Any], p: PrincipalDep, db: DbDep, request: Request
) -> dict[str, Any]:
    p.require("metadata.write")
    assert p.tenant_id
    async with db.control() as s:
        return await automation_builder.save_automation(
            s,
            tenant_id=p.tenant_id,
            user_id=p.user_id,
            key=key,
            body=body,
            request_id=get_request_id(request),
        )


@router.delete("/studio/automations/{key}", status_code=204)
async def delete_automation(key: str, p: PrincipalDep, db: DbDep, request: Request) -> None:
    p.require("metadata.write")
    assert p.tenant_id
    async with db.control() as s:
        await automation_builder.remove_automation(
            s, tenant_id=p.tenant_id, user_id=p.user_id, key=key, request_id=get_request_id(request)
        )
