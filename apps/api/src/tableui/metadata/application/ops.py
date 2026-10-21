"""The fixed list of setup operations, the app outline, and the Draft snapshot used for undo.

Each operation is a thin wrapper over an existing Studio edit, so every rule the Studio enforces (pack
protection, naming, validation) holds here too. An operation never takes code or SQL: only plain values.
"""

import hashlib
import json
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tableui.metadata.application import automations, measures, relationships, studio
from tableui.platform.errors import ValidationFailed

Op = Callable[[AsyncSession, uuid.UUID, uuid.UUID, dict[str, Any], str | None], Awaitable[Any]]


def _need(args: dict[str, Any], *keys: str) -> None:
    for k in keys:
        if args.get(k) in (None, ""):
            raise ValidationFailed(errors=[{"field": k, "code": "required", "message": f"'{k}' is required"}])  # fmt: skip


def _only(args: dict[str, Any], allowed: set[str]) -> dict[str, Any]:
    extra = sorted(set(args) - allowed)
    if extra:
        raise ValidationFailed(errors=[{"field": extra[0], "code": "unknown", "message": f"'{extra[0]}' is not something this step can set"}])  # fmt: skip
    return args


async def _table_add(s: AsyncSession, t: uuid.UUID, u: uuid.UUID, a: dict[str, Any], r: str | None) -> Any:  # fmt: skip
    _need(a, "label")
    return await studio.create_table(s, tenant_id=t, user_id=u, request_id=r, body=_only(a, {"label", "plural_label", "key", "title_label", "description"}))  # fmt: skip


async def _field_add(s: AsyncSession, t: uuid.UUID, u: uuid.UUID, a: dict[str, Any], r: str | None) -> Any:  # fmt: skip
    _need(a, "table", "label", "type")
    body = _only(a, {"table", "label", "type", "key", "options", "required", "help", "group", "ref_table", "unique"})  # fmt: skip
    return await studio.add_field(s, tenant_id=t, user_id=u, request_id=r, table_key=str(a["table"]), body={k: v for k, v in body.items() if k != "table"})  # fmt: skip


async def _field_change(s: AsyncSession, t: uuid.UUID, u: uuid.UUID, a: dict[str, Any], r: str | None) -> Any:  # fmt: skip
    _need(a, "table", "field")
    changes = {k: v for k, v in a.items() if k not in ("table", "field")}
    if not changes:
        raise ValidationFailed(errors=[{"field": "field", "code": "required", "message": "say what to change"}])  # fmt: skip
    return await studio.update_field(s, tenant_id=t, user_id=u, request_id=r, table_key=str(a["table"]), field_key=str(a["field"]), body=changes)  # fmt: skip


async def _link_add(s: AsyncSession, t: uuid.UUID, u: uuid.UUID, a: dict[str, Any], r: str | None) -> Any:  # fmt: skip
    _need(a, "table", "to")
    return await relationships.add_link(s, tenant_id=t, user_id=u, request_id=r, body=_only(a, {"table", "to", "label", "required", "help"}))  # fmt: skip


async def _screen_change(s: AsyncSession, t: uuid.UUID, u: uuid.UUID, a: dict[str, Any], r: str | None) -> Any:  # fmt: skip
    _need(a, "key")
    found = await studio._draft(s, "screen", str(a["key"]))
    base = found[0] if found else {}
    merged = {**base, **{k: v for k, v in _only(a, {"key", "title", "pattern", "table", "config", "roles"}).items()}}  # fmt: skip
    if found and isinstance(a.get("config"), dict):
        merged["config"] = {**base.get("config", {}), **a["config"]}
    if not found:
        _need(merged, "title", "pattern", "table")
    return await studio.save_screen(s, tenant_id=t, user_id=u, request_id=r, body=merged)


async def _nav_add(s: AsyncSession, t: uuid.UUID, u: uuid.UUID, a: dict[str, Any], r: str | None) -> Any:  # fmt: skip
    _need(a, "label", "screen")
    _only(a, {"label", "screen", "section", "icon", "order"})
    items = await studio.read_draft(s, t, "nav")
    items.sort(key=lambda n: (n.get("section", "main"), n.get("order", 100)))
    mine = {"label": str(a["label"]).strip(), "screen": a["screen"], "section": a.get("section", "main"), "icon": a.get("icon", "list")}  # fmt: skip
    if "order" in a:
        mine["order"] = a["order"]
    else:
        mine["order"] = max([n.get("order", 100) for n in items if n.get("section") == mine["section"]] + [0]) + 10  # fmt: skip
    mine["key"] = f"nav_{studio.slug(mine['label'])}"[:63]
    if any(n["key"] == mine["key"] for n in items):
        raise ValidationFailed(errors=[{"field": "label", "code": "duplicate", "message": "a menu entry with this name already exists"}])  # fmt: skip
    await studio.save_navigation(s, tenant_id=t, user_id=u, request_id=r, items=[*items, mine])
    return mine


async def _measure_add(s: AsyncSession, t: uuid.UUID, u: uuid.UUID, a: dict[str, Any], r: str | None) -> Any:  # fmt: skip
    return await measures.save_measure(s, tenant_id=t, user_id=u, request_id=r, key=None, body=a)


async def _automation_add(s: AsyncSession, t: uuid.UUID, u: uuid.UUID, a: dict[str, Any], r: str | None) -> Any:  # fmt: skip
    return await automations.save_automation(s, tenant_id=t, user_id=u, request_id=r, key=None, body=a)  # fmt: skip


async def _rule_severity(s: AsyncSession, t: uuid.UUID, u: uuid.UUID, a: dict[str, Any], r: str | None) -> Any:  # fmt: skip
    _need(a, "rule", "check", "severity")
    return await studio.set_check_severity(s, tenant_id=t, user_id=u, request_id=r, rule_id=str(a["rule"]), check_id=str(a["check"]), severity=str(a["severity"]))  # fmt: skip


async def _stage_set(s: AsyncSession, t: uuid.UUID, u: uuid.UUID, a: dict[str, Any], r: str | None) -> Any:  # fmt: skip
    _need(a, "table")
    return await studio.update_stages(s, tenant_id=t, user_id=u, request_id=r, table_key=str(a["table"]), body=_only(a, {"table", "labels", "add"}))  # fmt: skip


# name -> (handler, one-line help the planner is shown)
REGISTRY: dict[str, tuple[Op, str]] = {
    "table.add": (
        _table_add,
        '{"label","plural_label"?,"title_label"?,"description"?}  a new table with a name field, a list screen and a menu entry',
    ),  # fmt: skip
    "field.add": (
        _field_add,
        '{"table","label","type","options"?,"required"?,"help"?,"ref_table"? (for type reference)}  types: text long_text integer decimal money boolean date select tags email phone url months reference',
    ),  # fmt: skip
    "field.change": (
        _field_change,
        '{"table","field","label"?,"help"?,"hidden"?,"required"?,"options"?}  pack fields only take label, help, hidden',
    ),  # fmt: skip
    "link.add": (
        _link_add,
        '{"table","to","label"?,"required"?}  each <table> record belongs to one <to> record',
    ),  # fmt: skip
    "screen.change": (
        _screen_change,
        '{"key","title"?,"pattern"?,"table"?,"config"?}  patterns: searchable_table profile master_detail form ranked_list document_review detail board duplicate_review',
    ),  # fmt: skip
    "nav.add": (
        _nav_add,
        '{"label","screen","section"? main|more}  add a menu entry for an existing screen',
    ),  # fmt: skip
    "measure.add": (
        _measure_add,
        '{"label","table","aggregate" count|sum|avg|distinct,"field"?,"group_by"?}',
    ),  # fmt: skip
    "automation.add": (
        _automation_add,
        '{"label","trigger","effect"} see existing automations for the shape',
    ),  # fmt: skip
    "rule.severity": (
        _rule_severity,
        '{"rule","check","severity" block|warn|approve}  only on checks the pack marks editable',
    ),  # fmt: skip
    "stage.set": (
        _stage_set,
        '{"table","labels"?: {stage: new label},"add"?: {"key","label","after"}}',
    ),  # fmt: skip
}


async def run_op(s: AsyncSession, tenant_id: uuid.UUID, user_id: uuid.UUID, op: str, args: dict[str, Any], request_id: str | None) -> Any:  # fmt: skip
    """Run one operation inside the caller's transaction. Raises ProblemError with a plain message."""
    if op not in REGISTRY:
        raise ValidationFailed(errors=[{"field": "op", "code": "unknown", "message": f"'{op}' is not something setup can do"}])  # fmt: skip
    return await REGISTRY[op][0](s, tenant_id, user_id, args, request_id)


def operations_help() -> str:
    return "\n".join(f"- {name} {help_}" for name, (_, help_) in REGISTRY.items())


async def outline(s: AsyncSession, tenant_id: uuid.UUID) -> dict[str, Any]:
    """A short description of the app definition for the planner. Never contains records."""
    await studio._enter_tenant(s, tenant_id)
    rows = (await s.execute(text("SELECT kind, key, definition, source FROM metadata_object ORDER BY kind, key"))).all()  # fmt: skip
    out: dict[str, Any] = {"tables": [], "screens": [], "menu": [], "measures": [], "automations": [], "rules": []}  # fmt: skip
    for r in rows:
        d = r.definition
        if r.kind == "table":
            out["tables"].append({
                "key": r.key, "label": d.get("label"), "from_pack": r.source == "pack",
                "fields": [{"key": f["key"], "label": f["label"], "type": f["type"], "pack": f.get("source") == "pack", **({"ref": f["ref_table"]} if f.get("ref_table") else {}), **({"options": f["options"]} if f.get("options") else {})} for f in d.get("fields", [])],  # fmt: skip
                **({"stages": [st["key"] for st in d["workflow"]["stages"]]} if d.get("workflow") else {}),  # fmt: skip
            })  # fmt: skip
        elif r.kind == "screen":
            out["screens"].append({"key": r.key, "title": d.get("title"), "pattern": d.get("pattern"), "table": d.get("table")})  # fmt: skip
        elif r.kind == "nav":
            out["menu"].append({"label": d.get("label"), "screen": d.get("screen"), "section": d.get("section")})  # fmt: skip
        elif r.kind == "measure":
            out["measures"].append({"key": r.key, "label": d.get("label"), "table": d.get("table")})  # fmt: skip
        elif r.kind == "automation":
            out["automations"].append({"key": r.key, "label": d.get("label")})
        elif r.kind == "rule":
            out["rules"].append({"id": r.key, "checks": [{"id": c["id"], "severity": c.get("severity")} for c in d.get("checks", [])]})  # fmt: skip
    return out


async def snapshot(s: AsyncSession, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
    await studio._enter_tenant(s, tenant_id)
    rows = (await s.execute(text("SELECT kind, key, definition, source FROM metadata_object ORDER BY kind, key"))).all()  # fmt: skip
    return [{"kind": r.kind, "key": r.key, "definition": r.definition, "source": r.source} for r in rows]  # fmt: skip


def snapshot_hash(snap: list[dict[str, Any]]) -> str:
    return hashlib.sha256(json.dumps(snap, sort_keys=True, default=str).encode()).hexdigest()


async def restore(s: AsyncSession, tenant_id: uuid.UUID, snap: list[dict[str, Any]]) -> list[str]:
    """Put the Draft back as the snapshot had it. Tables the plan created (still empty) are dropped.

    Returns the keys of tables that were dropped."""
    schema = await studio._enter_tenant(s, tenant_id)
    before = {x["key"] for x in snap if x["kind"] == "table"}
    now = {r.key for r in (await s.execute(text("SELECT key FROM metadata_object WHERE kind = 'table'")))}  # fmt: skip
    await s.execute(text("DELETE FROM metadata_object"))
    for x in snap:
        await studio._put(s, tenant_id, x["kind"], x["key"], x["definition"], x["source"])
    dropped: list[str] = []
    for key in sorted(now - before):
        n = (await s.execute(text(f'SELECT count(*) FROM "{schema}"."{key}"'))).scalar_one()  # noqa: S608
        if n == 0:
            await s.execute(text(f'DROP TABLE "{schema}"."{key}"'))
            dropped.append(key)
    return dropped


__all__ = [
    "REGISTRY",
    "operations_help",
    "outline",
    "restore",
    "run_op",
    "snapshot",
    "snapshot_hash",
]
