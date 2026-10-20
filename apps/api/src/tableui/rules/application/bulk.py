"""The same rules over many rows at once (R-01 extended to imports).

Instead of a query per row, each context loader prefetches what it needs for the whole file in one
query, and also matches rows against earlier rows of the same file. Then every row is evaluated with
the ordinary engine, so a file row and a form get the same answer.
"""

from typing import Any

from rapidfuzz import fuzz, process
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tableui.metadata.public import RuleDef, TableDef, shadow_columns
from tableui.rules.domain.engine import compile_rule, evaluate


def _label(table: TableDef, data: dict[str, Any]) -> Any:
    return data.get(table.title_field)


async def bulk_outcomes(
    s: AsyncSession, table: TableDef, rules: list[RuleDef], rows: list[dict[str, Any] | None]
) -> list[list[dict[str, Any]]]:
    """For each row (None = skip it), the rule outcomes a create would get, including clashes with
    earlier rows of the same file (their link carries ``row`` instead of ``id``)."""
    active = [r for r in rules if r.table == table.key and "create" in r.applies_to]
    shadows = [shadow_columns(table, r) if r is not None else {} for r in rows]
    out: list[list[dict[str, Any]]] = [[] for _ in rows]
    for rule in active:
        checks = compile_rule(rule)
        pre: dict[str, Any] = {}
        for name, loader in rule.context.items():
            if loader.kind == "normalised_match":
                col = f"{loader.field}_norm"
                vals = sorted({v for sh in shadows if (v := sh.get(col))})
                found: dict[str, dict[str, Any]] = {}
                for i in range(0, len(vals), 5000):
                    res = await s.execute(
                        text(
                            f'SELECT id, data, "{col}" AS v FROM "{table.key}" WHERE "{col}" = ANY(:vals)'  # noqa: S608 - identifiers are validated metadata keys
                        ),
                        {"vals": vals[i : i + 5000]},
                    )
                    for r in res:
                        found.setdefault(
                            r.v,
                            {"table": table.key, "id": str(r.id), "label": _label(table, r.data)},
                        )
                pre[name] = found
            elif loader.kind == "fuzzy_match":
                ecol, zcol = f"{loader.exact_field}_norm", f"{loader.fuzzy_field}_norm"
                exacts = sorted({v for sh in shadows if (v := sh.get(ecol))})
                by_exact: dict[str, list[tuple[str, dict[str, Any]]]] = {}
                for i in range(0, len(exacts), 2000):
                    res = await s.execute(
                        text(
                            f'SELECT id, data, "{ecol}" AS e, "{zcol}" AS z FROM "{table.key}" '  # noqa: S608 - identifiers are validated metadata keys
                            f'WHERE "{ecol}" = ANY(:vals) AND "{zcol}" IS NOT NULL'
                        ),
                        {"vals": exacts[i : i + 2000]},
                    )
                    for r in res:
                        by_exact.setdefault(r.e, []).append(
                            (
                                r.z,
                                {
                                    "table": table.key,
                                    "id": str(r.id),
                                    "label": _label(table, r.data),
                                },
                            )
                        )
                pre[name] = by_exact
            elif loader.kind == "lookup":
                ref = table.field(loader.ref_field or "")
                ids = sorted(
                    {
                        str(r.get(loader.ref_field or ""))
                        for r in rows
                        if r and r.get(loader.ref_field or "")
                    }
                )
                values: dict[str, Any] = {}
                if ref and ref.ref_table and ids:
                    res = await s.execute(
                        text(
                            f'SELECT id::text AS id, data FROM "{ref.ref_table}" WHERE id::text = ANY(:ids)'  # noqa: S608 - identifiers are validated metadata keys
                        ),
                        {"ids": ids},
                    )
                    values = {r.id: (r.data or {}).get(loader.field or "") for r in res}
                pre[name] = values
        seen: dict[str, dict[str, Any]] = {name: {} for name in rule.context}
        for idx, row in enumerate(rows):
            if row is None:
                continue
            sh = shadows[idx]
            ctx: dict[str, Any] = {}
            for name, loader in rule.context.items():
                if loader.kind == "normalised_match":
                    v = sh.get(f"{loader.field}_norm")
                    ctx[name] = (pre[name].get(v) or seen[name].get(v)) if v else None
                    if v and v not in seen[name]:
                        seen[name][v] = {
                            "table": table.key,
                            "id": None,
                            "row": idx,
                            "label": _label(table, row),
                        }
                elif loader.kind == "fuzzy_match":
                    e, z = (
                        sh.get(f"{loader.exact_field}_norm"),
                        sh.get(f"{loader.fuzzy_field}_norm"),
                    )
                    best = None
                    if e and z:
                        pool = [*pre[name].get(e, []), *seen[name].get(e, [])]
                        if pool:
                            # One vectorised pass (rapidfuzz): same scorer and threshold as a single save.
                            hit = process.extractOne(
                                z,
                                [p[0] for p in pool],
                                scorer=fuzz.token_sort_ratio,
                                score_cutoff=loader.threshold,
                            )
                            if hit is not None:
                                best = pool[hit[2]][1]
                        seen[name].setdefault(e, []).append(
                            (
                                z,
                                {
                                    "table": table.key,
                                    "id": None,
                                    "row": idx,
                                    "label": _label(table, row),
                                },
                            )
                        )
                    ctx[name] = best
                else:
                    ctx[name] = pre[name].get(str(row.get(loader.ref_field or "")))
            out[idx] += [o.as_dict() for o in evaluate(checks, row, ctx)]
    return out
