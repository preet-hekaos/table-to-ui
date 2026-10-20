"""Ranked matches for a record (for example people for an opening), with every part shown."""

import json
import uuid
from typing import Any

from sqlalchemy import text

from tableui.audit.public import write_audit
from tableui.identity.public import Principal, hidden_fields, scope_predicate
from tableui.matching.domain.score import parts_from, rank
from tableui.metadata.public import RuntimeApp
from tableui.platform.db import Database
from tableui.platform.errors import NotFound, ValidationFailed
from tableui.query.public import get_record

TOP = 50


def _screen(app: RuntimeApp, key: str) -> Any:
    sc = app.screens.get(key)
    if sc is None or sc.pattern != "ranked_list" or not sc.config.get("source_table"):
        raise NotFound(f"There is no matching screen '{key}'.")
    return sc


async def agency_weights(db: Database, tenant_id: uuid.UUID, screen_key: str) -> dict[str, float]:
    async with db.control() as s:
        settings = (
            await s.execute(
                text("SELECT settings FROM control.tenant WHERE id = :t"), {"t": tenant_id}
            )
        ).scalar_one()
    return {
        k: float(v) for k, v in ((settings or {}).get("matching", {}).get(screen_key, {})).items()
    }


def _check_weights(config: dict[str, Any], weights: dict[str, float]) -> None:
    keys = {p["key"] for p in config.get("parts", [])}
    bad = [k for k in weights if k not in keys]
    if bad:
        raise ValidationFailed(
            errors=[
                {
                    "field": f"w.{bad[0]}",
                    "code": "unknown",
                    "message": "is not a part of this match",
                }
            ]
        )
    if any(v < 0 or v > 100 for v in weights.values()):
        raise ValidationFailed(
            errors=[{"field": "weights", "code": "invalid", "message": "must be between 0 and 100"}]
        )


async def matches(
    db: Database,
    principal: Principal,
    app: RuntimeApp,
    screen_key: str,
    source_id: uuid.UUID,
    view_weights: dict[str, float],
) -> dict[str, Any]:
    sc = _screen(app, screen_key)
    cfg = sc.config
    principal.require(f"record.{sc.table}.read")
    source = await get_record(db, principal, app, cfg["source_table"], source_id)
    target = app.table(sc.table)
    defaults = {p["key"]: float(p.get("weight", 0)) for p in cfg.get("parts", [])}
    agency = await agency_weights(db, principal.tenant_id, screen_key)  # type: ignore[arg-type]
    _check_weights(cfg, view_weights)
    weights = {**defaults, **agency, **view_weights}
    parts = parts_from(cfg, weights)
    known = {f.key for f in target.fields}
    conds: list[str] = []
    params: dict[str, Any] = {}
    for i, h in enumerate(cfg.get("hard_filters", [])):
        t = h["target"]
        if t not in known:
            continue
        if h["op"] == "eq":
            conds.append(f"data->>'{t}' = :h{i}")
            params[f"h{i}"] = str(h["value"])
            continue
        limit = source["data"].get(h.get("source", ""))
        if limit in (None, ""):
            continue  # the source does not ask, so nothing is excluded
        op = "<=" if h["op"] == "lte_source" else ">="
        conds.append(f"(data->>'{t}' IS NULL OR (data->>'{t}')::numeric {op} :h{i})")
        params[f"h{i}"] = float(limit) + float(h.get("tolerance", 0))
    scope_sql, scope_params = await scope_predicate(db, principal, target.key)
    if scope_sql:
        conds.append(scope_sql)
        params |= scope_params
    wanted = sorted({p.target for p in parts} | {target.title_field} | set(cfg.get("columns", [])))
    hidden = hidden_fields(principal, target.key)
    cols = ", ".join(f"'{k}', data->'{k}'" for k in wanted if k in known)
    where = f"WHERE {' AND '.join(conds)}" if conds else ""
    async with db.tenant(principal.tenant_id) as s:
        rows = (
            await s.execute(
                text(
                    f'SELECT id::text AS id, jsonb_build_object({cols}) AS d FROM "{target.key}" {where}'
                ),  # noqa: S608 - identifiers are validated metadata keys
                params,
            )
        ).all()
    pool = [(r.id, {k: v for k, v in (r.d or {}).items() if k not in hidden}) for r in rows]
    ranked = rank(parts, source["data"], pool, target.title_field)
    for r in ranked:
        for key, part in r["parts"].items():
            tgt = next(p.target for p in parts if p.key == key)
            if tgt in hidden:
                part["why"] = "hidden from your role"
    return {
        "screen": sc.key,
        "source": {
            "table": cfg["source_table"],
            "id": str(source_id),
            "label": source["data"].get(app.table(cfg["source_table"]).title_field),
        },
        "weights": weights,
        "defaults": {**defaults, **agency},
        "considered": len(ranked),
        "items": ranked[:TOP],
    }


async def save_weights(
    db: Database,
    principal: Principal,
    app: RuntimeApp,
    screen_key: str,
    weights: dict[str, float],
    request_id: str | None,
) -> dict[str, float]:
    """Changing the workspace default needs the matching-settings permission (S25)."""
    principal.require("matching.configure")
    sc = _screen(app, screen_key)
    _check_weights(sc.config, weights)
    async with db.control() as s:
        await s.execute(
            text(
                "UPDATE control.tenant SET settings = jsonb_set(jsonb_set(settings, '{matching}', "
                "COALESCE(settings->'matching', '{}'::jsonb), true), ARRAY['matching', :k], CAST(:w AS jsonb), true) WHERE id = :t"
            ),
            {"k": screen_key, "w": json.dumps(weights), "t": principal.tenant_id},
        )
        await write_audit(
            s, tenant_id=principal.tenant_id, scope="tenant", actor_id=principal.user_id,
            action="matching.configure", subject_type="screen", subject_id=screen_key, detail={"weights": weights}, request_id=request_id,
        )  # fmt: skip
    return weights
