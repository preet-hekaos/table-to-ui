import datetime as dt
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import ValidationError

from tableui.identity.api.deps import PrincipalDep
from tableui.identity.public import Principal, scope_predicate
from tableui.insights.application import analytics as store
from tableui.insights.application import engine
from tableui.metadata.api.deps import LiveAppDep
from tableui.metadata.public import MeasureDef, measure_problems
from tableui.platform.db import Database
from tableui.platform.errors import NotFound
from tableui.platform.web import get_analytics, get_db
from tableui.query.public import list_records

router = APIRouter(prefix="/v1/measures", tags=["measures"])
AnalyticsDep = Annotated[Database, Depends(get_analytics)]
DbDep = Annotated[Database, Depends(get_db)]


def _readable(p: Principal, m: MeasureDef) -> bool:
    return p.allows(f"record.{m.table}.read")


async def _run(
    p: Principal,
    db: Database,
    analytics: Database,
    app: Any,
    m: MeasureDef,
    start: dt.date,
    end: dt.date,
    *,
    compare: bool = False,
    mine: bool = False,
) -> dict[str, Any]:
    assert p.tenant_id
    scope_sql, scope_params = await scope_predicate(db, p, m.table)
    if mine:  # only the records this person owns
        scope_sql = (
            f"({scope_sql}) AND owner_id = :mine_owner" if scope_sql else "owner_id = :mine_owner"
        )
        scope_params = {**scope_params, "mine_owner": p.user_id}
    table = app.table(m.table)
    out = await engine.run_measure(
        analytics, p.tenant_id, m, table,
        scope_sql=scope_sql, scope_params=scope_params, start=start, end=end,
    )  # fmt: skip
    if compare:
        out |= await engine.compare_and_trend(
            analytics, p.tenant_id, m, table,
            scope_sql=scope_sql, scope_params=scope_params, start=start, end=end,
        )  # fmt: skip
    return out


async def _fresh(p: Principal, db: Database, analytics: Database, app: Any) -> None:
    assert p.tenant_id
    await store.refresh_if_stale(
        analytics, db, p.tenant_id, list(app.tables.values()), app.manifest_id
    )


def _find(app: Any, p: Principal, key: str) -> MeasureDef:
    m: MeasureDef | None = next((x for x in app.measures if x.key == key), None)
    if m is None or not _readable(p, m):
        raise NotFound(f"There is no measure '{key}'.")
    return m


@router.get("")
async def list_measures(
    p: PrincipalDep,
    app: LiveAppDep,
    analytics: AnalyticsDep,
    db: DbDep,
    home: bool = False,
    range: str | None = None,  # noqa: A002 - the public query parameter name
    start: dt.date | None = None,
    end: dt.date | None = None,
    compare: bool = False,  # add the previous period's value and a 12-week trend
    mine: bool = False,  # count only the records I own
) -> list[dict[str, Any]]:
    p.require("measure.read")
    await _fresh(p, db, analytics, app)
    first, last = engine.resolve_range(range, start, end)
    wanted = sorted(
        (m for m in app.measures if not m.hidden and _readable(p, m) and (m.home or not home)),
        key=lambda m: (m.order, m.label),
    )
    return [
        await _run(p, db, analytics, app, m, first, last, compare=compare, mine=mine)
        for m in wanted
    ]


@router.get("/{key}")
async def get_measure(
    key: str,
    p: PrincipalDep,
    app: LiveAppDep,
    analytics: AnalyticsDep,
    db: DbDep,
    range: str | None = None,  # noqa: A002
    start: dt.date | None = None,
    end: dt.date | None = None,
) -> dict[str, Any]:
    p.require("measure.read")
    await _fresh(p, db, analytics, app)
    m = _find(app, p, key)
    first, last = engine.resolve_range(range, start, end)
    return await _run(p, db, analytics, app, m, first, last)


@router.get("/{key}/records")
async def measure_records(
    key: str,
    p: PrincipalDep,
    app: LiveAppDep,
    analytics: AnalyticsDep,
    db: DbDep,
    range: str | None = None,  # noqa: A002
    start: dt.date | None = None,
    end: dt.date | None = None,
    group: str | None = None,
    bucket: dt.date | None = None,
) -> dict[str, Any]:
    """The records behind a number, so anyone can check it."""
    p.require("measure.read")
    m = _find(app, p, key)
    first, last = engine.resolve_range(range, start, end)
    scope_sql, scope_params = await scope_predicate(db, p, m.table)
    assert p.tenant_id
    total, ids = await engine.matching_ids(
        analytics, p.tenant_id, m, app.table(m.table),
        scope_sql=scope_sql, scope_params=scope_params, start=first, end=last,
        group=group, bucket=bucket,
    )  # fmt: skip
    page = await list_records(db, p, app, m.table, limit=100, ids=ids) if ids else {"items": []}
    return {
        "table": m.table,
        "total": total,
        "shown": len(page["items"]),
        "capped": total > len(ids),
        "items": page["items"],
        "next_cursor": page.get("next_cursor"),
    }


@router.post("/preview")
async def preview(
    body: dict[str, Any],
    p: PrincipalDep,
    app: LiveAppDep,
    analytics: AnalyticsDep,
    db: DbDep,
    range: str | None = None,  # noqa: A002
) -> dict[str, Any]:
    """The number a measure would show, before it is saved. Needs its fields to be live and switched on."""
    p.require("metadata.read")
    try:
        m = MeasureDef.model_validate(
            {"key": "preview", "label": "Preview", "source": "agency", **body}
        )
    except ValidationError as e:
        return {
            "ok": False,
            "problems": [f"{'.'.join(map(str, x['loc']))}: {x['msg']}" for x in e.errors()],
        }
    table = app.tables.get(m.table)
    if table is None or not p.allows(f"record.{m.table}.read"):
        return {
            "ok": False,
            "problems": ["That table is not in the live app yet. Publish it first."],
        }
    found = [msg for _, msg in measure_problems(m, table)]
    if found:
        return {
            "ok": False,
            "problems": found,
            "note": "Fields are switched on for Insights when you save; the number fills in once the app goes Live.",
        }
    first, last = engine.resolve_range(range, None, None)
    await _fresh(p, db, analytics, app)
    return {"ok": True, "problems": [], "card": await _run(p, db, analytics, app, m, first, last)}


@router.post("/rebuild")
async def rebuild(
    p: PrincipalDep, app: LiveAppDep, analytics: AnalyticsDep, db: DbDep
) -> dict[str, int]:
    """Re-read every record into the analytics store, so new measures cover records that already exist."""
    p.require("metadata.write")
    assert p.tenant_id
    return await store.rebuild(
        analytics, db, p.tenant_id, list(app.tables.values()), app.manifest_id
    )
