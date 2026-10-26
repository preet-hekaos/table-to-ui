import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request

from tableui.identity.api.deps import PrincipalDep
from tableui.metadata.api.deps import LiveAppDep
from tableui.platform.db import Database
from tableui.platform.web import get_db
from tableui.query.application import records

router = APIRouter(prefix="/v1/records", tags=["records"])
DbDep = Annotated[Database, Depends(get_db)]


def _query_parts(request: Request) -> dict[str, Any]:
    qp = request.query_params
    return {
        "filters": {k[2:]: v for k, v in qp.items() if k.startswith("f.") and v != ""},
        "ranges": {k[2:]: v for k, v in qp.items() if k.startswith("r.") and v != ""},
        "contains": {k[2:]: v for k, v in qp.items() if k.startswith("c.") and v != ""},
        "anyof": {k[3:]: v for k, v in qp.items() if k.startswith("in.") and v != ""},
        "has": {k[4:]: v for k, v in qp.items() if k.startswith("has.") and v != ""},
        "owner": qp.get("owner") or None,
    }


@router.get("/{table}/facets")
async def facets(
    table: str,
    p: PrincipalDep,
    app: LiveAppDep,
    db: DbDep,
    request: Request,
    q: str | None = None,
    fields: str | None = None,
) -> dict[str, Any]:
    """Counts per facet value under the current search (S23)."""
    return await records.facet_counts(
        db,
        p,
        app,
        table,
        fields=[x for x in (fields or "").split(",") if x] or None,
        q=q,
        **_query_parts(request),
    )


@router.get("/{table}")
async def list_(
    table: str,
    p: PrincipalDep,
    app: LiveAppDep,
    db: DbDep,
    request: Request,
    sort: str = "updated_at",
    direction: str = "desc",
    cursor: str | None = None,
    limit: int = 50,
    q: str | None = None,
) -> dict[str, Any]:
    return await records.list_records(
        db,
        p,
        app,
        table,
        sort=sort,
        direction=direction,
        cursor=cursor,
        limit=limit,
        q=q,
        **_query_parts(request),
    )


@router.get("/{table}/{record_id}")
async def get(
    table: str, record_id: uuid.UUID, p: PrincipalDep, app: LiveAppDep, db: DbDep
) -> dict[str, Any]:
    return await records.get_record(db, p, app, table, record_id)


@router.get("/{table}/{record_id}/history")
async def history(
    table: str, record_id: uuid.UUID, p: PrincipalDep, app: LiveAppDep, db: DbDep
) -> list[dict[str, Any]]:
    return await records.get_history(db, p, app, table, record_id)
