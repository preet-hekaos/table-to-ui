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
from tableui.rules.domain.workflow import full, transition_outcomes


def _label(table: TableDef, data: dict[str, Any]) -> Any:
    return data.get(table.title_field)


def _count_key(loader: Any, row: dict[str, Any]) -> tuple[str, ...] | None:
    """The values a row must share with counted records; None when one is missing (then the count is 0)."""
    vals: list[str] = []
    for mine in loader.match.values():
        v = None if mine == "$id" else row.get(mine)
        if v is None or v == "":
            return None
        vals.append(str(v))
    return tuple(vals)


def _fits(loader: Any, row: dict[str, Any]) -> bool:
    """Would this row itself be counted by the loader's fixed ``where`` values."""
    return all(
        str(row.get(k)).lower() == (str(w).lower() if isinstance(w, bool) else str(w).lower())
        for k, w in loader.where.items()
    )


async def _prefetch_counts(
    s: AsyncSession, loader: Any, rows: list[dict[str, Any] | None]
) -> dict[tuple[str, ...], int]:
    """How many saved records match each row's values, for the whole file in one grouped query."""
    keys = {k for r in rows if r and (k := _count_key(loader, r)) is not None}
    if not keys:
        return {}
    others = list(loader.match.keys())
    conds = [f"data ->> '{others[0]}' = ANY(:first)"]
    params: dict[str, Any] = {"first": sorted({k[0] for k in keys})}
    for j, (key, wanted) in enumerate(loader.where.items()):
        conds.append(f"data ->> '{key}' = :w{j}")
        params[f"w{j}"] = str(wanted).lower() if isinstance(wanted, bool) else str(wanted)
    cols = ", ".join(f"data ->> '{o}'" for o in others)
    res = await s.execute(
        text(
            f'SELECT {cols}, count(*) AS n FROM "{loader.table}" '  # noqa: S608 - identifiers are validated metadata keys
            f"WHERE {' AND '.join(conds)} GROUP BY {cols}"
        ),
        params,
    )
    out: dict[tuple[str, ...], int] = {}
    for r in res:
        key = tuple(str(v) for v in r[:-1])
        if key in keys:
            out[key] = int(r[-1])
    return out


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
            elif loader.kind == "count":
                pre[name] = await _prefetch_counts(s, loader, rows)
        seen: dict[str, dict[Any, Any]] = {name: {} for name in rule.context}
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
                elif loader.kind == "count":
                    key = _count_key(loader, row)
                    earlier = seen[name].get(key, 0) if key is not None else 0
                    ctx[name] = (pre[name].get(key, 0) if key is not None else 0) + earlier
                    if key is not None and loader.table == table.key and _fits(loader, row):
                        seen[name][key] = earlier + 1
                else:
                    ctx[name] = pre[name].get(str(row.get(loader.ref_field or "")))
            out[idx] += [
                o.as_dict() for o in evaluate(checks, full(table, row), ctx, full(table, None))
            ]
    if (
        table.workflow is not None
    ):  # a new record may only start at the first stage, as when saved one by one
        for idx, row in enumerate(rows):
            if row is not None:
                out[idx] += [
                    o.as_dict() for o in transition_outcomes(table, None, full(table, row), True)
                ]
    return out
