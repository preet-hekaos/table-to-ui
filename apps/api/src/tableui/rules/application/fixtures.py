"""Run a pack's fixtures against a set of tables and rules, entirely in memory.

The loaders mirror the database ones in ``context.py`` (same normalisers, same fuzzy scorer), so a
fixture that passes here behaves the same way through the command pipeline.
"""

from typing import Any

from rapidfuzz import fuzz

from tableui.metadata.public import (
    FixtureDef,
    RuleDef,
    TableDef,
    shadow_columns,
    validate_record,
)
from tableui.rules.domain.engine import compile_rule, evaluate


def _link(table: TableDef, rid: str, data: dict[str, Any]) -> dict[str, Any]:
    return {"table": table.key, "id": rid, "label": data.get(table.title_field)}


def _context(
    tables: dict[str, TableDef],
    table: TableDef,
    rule: RuleDef,
    fx: FixtureDef,
    record: dict[str, Any],
) -> dict[str, Any]:
    mine = shadow_columns(table, record)
    others = [
        (g.id, g.data, shadow_columns(table, g.data))
        for g in fx.given
        if g.table == table.key and g.id != fx.record_id
    ]
    ctx: dict[str, Any] = {}
    for name, loader in rule.context.items():
        value: Any = None
        if loader.kind == "normalised_match":
            v = mine.get(f"{loader.field}_norm")
            hit = next(
                (o for o in others if v is not None and o[2].get(f"{loader.field}_norm") == v), None
            )
            value = _link(table, hit[0], hit[1]) if hit else None
        elif loader.kind == "fuzzy_match":
            e, z = mine.get(f"{loader.exact_field}_norm"), mine.get(f"{loader.fuzzy_field}_norm")
            best, best_score = None, 0.0
            if e is not None and z is not None:
                for o in others:
                    if (
                        o[2].get(f"{loader.exact_field}_norm") != e
                        or o[2].get(f"{loader.fuzzy_field}_norm") is None
                    ):
                        continue
                    score = fuzz.token_sort_ratio(z, o[2][f"{loader.fuzzy_field}_norm"] or "")
                    if score >= loader.threshold and score > best_score:
                        best, best_score = o, score
            value = _link(table, best[0], best[1]) if best else None
        elif loader.kind == "lookup":
            ref = table.field(loader.ref_field or "")
            target = record.get(loader.ref_field or "")
            if ref and ref.ref_table and target:
                hit_data = next(
                    (g.data for g in fx.given if g.table == ref.ref_table and g.id == target), None
                )
                value = (hit_data or {}).get(loader.field or "") if hit_data else None
        ctx[name] = value
    return ctx


def run_fixture(
    tables: dict[str, TableDef], rules: list[RuleDef], fx: FixtureDef
) -> dict[str, Any]:
    table = tables.get(fx.table)
    result: dict[str, Any] = {"id": fx.id, "title": fx.title, "expected": fx.expect}
    if table is None:
        return {**result, "outcome": "error", "passed": False, "detail": f"no table '{fx.table}'"}
    base: dict[str, Any] = {}
    if fx.op == "update" and fx.record_id:
        base = next((g.data for g in fx.given if g.id == fx.record_id), {})
    clean, errors = validate_record(table, fx.record, partial=fx.op == "update")
    if errors:
        outcome, fired = "invalid", [f"{e['field']}.{e['code']}" for e in errors]
    else:
        merged = {**base, **clean}
        outcomes = []
        for rule in rules:
            if rule.table != table.key or fx.op not in rule.applies_to:
                continue
            ctx = _context(tables, table, rule, fx, merged)
            outcomes += evaluate(compile_rule(rule), merged, ctx)
        fired = [o.check_id for o in outcomes]
        if any(o.severity == "block" for o in outcomes):
            outcome = "blocked"
        elif outcomes:
            outcome = "warned"
        else:
            outcome = "allowed"
    missing = [c for c in fx.checks if c not in fired]
    passed = outcome == fx.expect and not missing
    detail = (
        ""
        if passed
        else f"expected {fx.expect}, got {outcome}"
        + (f"; missing {', '.join(missing)}" if missing else "")
    )
    return {**result, "outcome": outcome, "fired": fired, "passed": passed, "detail": detail}


def run_fixtures(
    tables: dict[str, TableDef], rules: list[RuleDef], fixtures: list[FixtureDef]
) -> dict[str, Any]:
    results = [run_fixture(tables, rules, fx) for fx in fixtures]
    return {
        "total": len(results),
        "passed": sum(1 for r in results if r["passed"]),
        "failed": sum(1 for r in results if not r["passed"]),
        "results": results,
    }
