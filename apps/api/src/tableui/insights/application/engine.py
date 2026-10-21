"""Measures to SQL on the analytics store. Field and table keys are validated metadata keys; values are bound."""

import datetime as dt
import uuid
from typing import Any

from sqlalchemy import text

from tableui.metadata.public import MeasureDef, TableDef
from tableui.platform.db import Database
from tableui.platform.errors import ValidationFailed

NUMERIC = {"integer", "decimal", "money", "months"}
PRESETS = ("this_week", "this_month", "last_30_days", "last_90_days", "this_year", "custom")
DRILL_CAP = 500
MAX_POINTS = 400


def resolve_range(
    preset: str | None, start: dt.date | None, end: dt.date | None, today: dt.date | None = None
) -> tuple[dt.date, dt.date]:
    """Inclusive first and last day for a named range. Weeks start on Monday."""
    today = today or dt.datetime.now(dt.UTC).date()
    preset = preset or "last_30_days"
    if preset == "this_week":
        return today - dt.timedelta(days=today.weekday()), today
    if preset == "this_month":
        return today.replace(day=1), today
    if preset == "last_30_days":
        return today - dt.timedelta(days=29), today
    if preset == "last_90_days":
        return today - dt.timedelta(days=89), today
    if preset == "this_year":
        return today.replace(month=1, day=1), today
    if preset == "custom":
        if start is None or end is None or start > end:
            raise ValidationFailed("Pick a start date that is on or before the end date.")
        if (end - start).days > 3660:
            raise ValidationFailed("That range is longer than ten years.")
        return start, end
    raise ValidationFailed(f"'{preset}' is not a date range. Use one of: {', '.join(PRESETS)}.")


def _time_expr(m: MeasureDef) -> str:
    if m.time_field == "created_at":
        return "CAST(created_at AS date)"
    return f"CAST(NULLIF(fields->>'{m.time_field}', '') AS date)"


def _conditions(
    m: MeasureDef,
    table: TableDef,
    *,
    tenant_id: uuid.UUID,
    scope_sql: str,
    scope_params: dict[str, Any],
    start: dt.date | None,
    end: dt.date | None,
) -> tuple[list[str], dict[str, Any]]:
    clauses = ["tenant_id = :t", "table_key = :tb"]
    params: dict[str, Any] = {"t": tenant_id, "tb": m.table, **scope_params}
    if scope_sql:
        clauses.append(scope_sql)
    for i, f in enumerate(m.where):
        col = f"fields->>'{f.field}'"
        fld = table.field(f.field)
        numeric = fld is not None and fld.type in NUMERIC
        lhs = f"CAST({col} AS numeric)" if numeric and f.op in ("gt", "gte", "lt", "lte") else col
        p = f"v{i}"
        if f.op == "eq":
            clauses.append(f"{col} = :{p}")
            params[p] = str(f.value).lower() if isinstance(f.value, bool) else str(f.value)
        elif f.op == "neq":
            clauses.append(f"({col} IS NULL OR {col} <> :{p})")
            params[p] = str(f.value).lower() if isinstance(f.value, bool) else str(f.value)
        elif f.op in ("gt", "gte", "lt", "lte"):
            sym = {"gt": ">", "gte": ">=", "lt": "<", "lte": "<="}[f.op]
            clauses.append(f"{lhs} {sym} {'CAST(:' + p + ' AS numeric)' if numeric else ':' + p}")
            params[p] = f.value if numeric else str(f.value)
        elif f.op == "in":
            clauses.append(f"{col} = ANY(CAST(:{p} AS text[]))")
            params[p] = [str(x) for x in (f.value if isinstance(f.value, list) else [f.value])]
        elif f.op == "empty":
            clauses.append(f"({col} IS NULL OR {col} = '')")
        elif f.op == "not_empty":
            clauses.append(f"({col} IS NOT NULL AND {col} <> '')")
    if m.time_field and start and end:
        clauses.append(f"{_time_expr(m)} BETWEEN :d_start AND :d_end")
        params |= {"d_start": start, "d_end": end}
    return clauses, params


def _aggregate(m: MeasureDef) -> str:
    if m.aggregate == "count":
        return "count(*)"
    if m.aggregate == "distinct":
        return f"count(DISTINCT fields->>'{m.field}')"
    num = f"CAST(NULLIF(fields->>'{m.field}', '') AS numeric)"
    return f"COALESCE(sum({num}), 0)" if m.aggregate == "sum" else f"avg({num})"


def _number(v: Any) -> float | int | None:
    if v is None:
        return None
    f = float(v)
    return int(f) if f == int(f) else round(f, 2)


def _buckets(start: dt.date, end: dt.date, unit: str) -> list[dt.date]:
    out: list[dt.date] = []
    cur = start
    if unit == "week":
        cur = start - dt.timedelta(days=start.weekday())
    elif unit == "month":
        cur = start.replace(day=1)
    while cur <= end and len(out) < MAX_POINTS:
        out.append(cur)
        if unit == "day":
            cur += dt.timedelta(days=1)
        elif unit == "week":
            cur += dt.timedelta(days=7)
        else:
            cur = (cur.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
    return out


async def run_measure(
    analytics: Database,
    tenant_id: uuid.UUID,
    m: MeasureDef,
    table: TableDef,
    *,
    scope_sql: str,
    scope_params: dict[str, Any],
    start: dt.date,
    end: dt.date,
) -> dict[str, Any]:
    rng = (start, end) if m.time_field else (None, None)
    where, params = _conditions(
        m,
        table,
        tenant_id=tenant_id,
        scope_sql=scope_sql,
        scope_params=scope_params,
        start=rng[0],
        end=rng[1],
    )
    cond = " AND ".join(where)
    agg = _aggregate(m)
    out: dict[str, Any] = {
        "key": m.key,
        "label": m.label,
        "help": m.help,
        "display": m.display,
        "table": m.table,
        "aggregate": m.aggregate,
        "period": bool(m.time_field),
        "source": m.source,
        "home": m.home,
        "series": None,
    }
    async with analytics.control() as s:
        total = (
            await s.execute(text(f"SELECT {agg} FROM fact_record WHERE {cond}"), params)
        ).scalar_one()
        latest = (
            await s.execute(
                text(
                    "SELECT max(occurred_at) FROM fact_record WHERE tenant_id = :t AND table_key = :tb"
                ),
                {"t": tenant_id, "tb": m.table},
            )
        ).scalar_one()
        out["value"] = _number(total)
        out["as_of"] = latest.isoformat() if latest else None
        if m.by_time and m.time_field:
            rows = (
                await s.execute(
                    text(
                        f"SELECT CAST(date_trunc('{m.by_time}', {_time_expr(m)}) AS date) AS b, {agg} AS v "
                        f"FROM fact_record WHERE {cond} GROUP BY 1 ORDER BY 1"
                    ),
                    params,
                )
            ).all()
            got = {r.b: _number(r.v) for r in rows if r.b}
            out["series"] = [
                {"label": b.isoformat(), "value": got.get(b, 0)}
                for b in _buckets(start, end, m.by_time)
            ]
        elif m.group_by:
            rows = (
                await s.execute(
                    text(
                        f"SELECT fields->>'{m.group_by}' AS g, {agg} AS v FROM fact_record "
                        f"WHERE {cond} GROUP BY 1"
                    ),
                    params,
                )
            ).all()
            got = {(r.g or ""): _number(r.v) for r in rows}
            order = list(table.field(m.group_by).options if table.field(m.group_by) else [])  # type: ignore[union-attr]
            known = [{"label": o, "key": o, "value": got.pop(o, 0)} for o in order]
            rest = sorted(got.items(), key=lambda kv: -(kv[1] or 0))
            known += [{"label": k or "(none)", "key": k, "value": v} for k, v in rest]
            out["series"] = known
    return out


async def matching_ids(
    analytics: Database,
    tenant_id: uuid.UUID,
    m: MeasureDef,
    table: TableDef,
    *,
    scope_sql: str,
    scope_params: dict[str, Any],
    start: dt.date,
    end: dt.date,
    group: str | None = None,
    bucket: dt.date | None = None,
) -> tuple[int, list[uuid.UUID]]:
    """The records behind a number: how many, and up to DRILL_CAP of them."""
    rng = (start, end) if m.time_field else (None, None)
    where, params = _conditions(
        m,
        table,
        tenant_id=tenant_id,
        scope_sql=scope_sql,
        scope_params=scope_params,
        start=rng[0],
        end=rng[1],
    )
    if group is not None and m.group_by:
        where.append(f"COALESCE(fields->>'{m.group_by}', '') = :grp")
        params["grp"] = group
    if bucket is not None and m.by_time and m.time_field:
        where.append(f"CAST(date_trunc('{m.by_time}', {_time_expr(m)}) AS date) = :bkt")
        params["bkt"] = bucket
    cond = " AND ".join(where)
    async with analytics.control() as s:
        total = (
            await s.execute(text(f"SELECT count(*) FROM fact_record WHERE {cond}"), params)
        ).scalar_one()
        rows = (
            await s.execute(
                text(
                    f"SELECT record_id FROM fact_record WHERE {cond} ORDER BY occurred_at DESC, record_id LIMIT {DRILL_CAP}"
                ),
                params,
            )
        ).all()
    return int(total), [r.record_id for r in rows]
