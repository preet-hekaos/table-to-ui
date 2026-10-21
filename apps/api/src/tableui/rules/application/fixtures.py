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
from tableui.rules.domain.workflow import full, transition_outcomes


def _link(table: TableDef, rid: str, data: dict[str, Any]) -> dict[str, Any]:
    return {"table": table.key, "id": rid, "label": data.get(table.title_field)}


def _count(loader: Any, fx: FixtureDef, table: TableDef, record: dict[str, Any]) -> int:
    def matches(d: dict[str, Any]) -> bool:
        for other, own in loader.match.items():
            want = fx.record_id if own == "$id" else record.get(own)
            if want is None or str(d.get(other)) != str(want):
                return False
        return all(str(d.get(k)) == str(v) for k, v in loader.where.items())

    return sum(
        1
        for g in fx.given
        if g.table == loader.table
        and not (g.table == table.key and g.id == fx.record_id)
        and matches(g.data)
    )


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
            cur_table, cur = table, record
            value = None
            hops = (loader.ref_field or "").split(".")
            for n, hop in enumerate(hops):
                ref = cur_table.field(hop)
                target = cur.get(hop)
                step = (
                    next(
                        (g.data for g in fx.given if g.table == ref.ref_table and g.id == target),
                        None,
                    )
                    if ref and ref.ref_table and target
                    else None
                )
                if step is None:
                    break
                cur = step
                cur_table = tables.get(ref.ref_table or "", cur_table) if ref else cur_table
                if n == len(hops) - 1:
                    value = cur.get(loader.field or "")
        elif loader.kind == "count":
            value = _count(loader, fx, table, record)
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
        merged = full(table, {**base, **clean})
        before = full(table, base) if fx.op == "update" else full(table, {})
        outcomes = transition_outcomes(table, before, merged, fx.op == "create")
        for rule in rules:
            if rule.table != table.key or fx.op not in rule.applies_to:
                continue
            ctx = _context(tables, table, rule, fx, merged)
            outcomes += evaluate(compile_rule(rule), merged, ctx, before)
        fired = [o.check_id for o in outcomes]
        if any(o.severity == "block" for o in outcomes):
            outcome = "blocked"
        elif any(o.severity == "approval" for o in outcomes):
            outcome = "approval"
        elif outcomes:
            outcome = "warned"
        else:
            outcome = "allowed"
    missing = [c for c in fx.checks if c not in fired]
    passed = outcome == fx.expect and not missing
    edited = {c.id for r in rules for c in r.checks if c.edited}
    if not passed and edited & (set(fired) | set(fx.checks)):
        # The agency changed this policy on purpose, so the pack's expectation is not theirs.
        return {
            **result,
            "outcome": outcome,
            "fired": fired,
            "passed": True,
            "skipped": True,
            "detail": "Skipped: your agency changed the policy for "
            + ", ".join(sorted(edited & (set(fired) | set(fx.checks)))),
        }
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
