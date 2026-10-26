import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from pydantic import BaseModel

from tableui.identity.api.deps import PrincipalDep
from tableui.metadata.api.deps import LiveAppDep
from tableui.metadata.public import features_of as records_features
from tableui.platform.config import Settings
from tableui.platform.db import Database
from tableui.platform.errors import ValidationFailed
from tableui.platform.mail import Mailer
from tableui.platform.web import get_db, get_mailer, get_request_id, get_settings_dep
from tableui.query.application import export as exports
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


class ExportBody(BaseModel):
    """What to export: a format, the columns, and either ticked ids or the list's own search."""

    format: str
    fields: list[str] | None = None
    ids: list[uuid.UUID] | None = None
    q: str | None = None
    filters: dict[str, str] = {}
    ranges: dict[str, str] = {}
    contains: dict[str, str] = {}
    anyof: dict[str, str] = {}
    has: dict[str, str] = {}
    owner: str | None = None
    sort: str = "updated_at"
    direction: str = "desc"


def _request(body: ExportBody) -> dict[str, Any]:
    return {
        "fmt": body.format,
        "fields": body.fields,
        "ids": [str(i) for i in body.ids] if body.ids else None,
        "search": {
            "q": body.q, "filters": body.filters, "ranges": body.ranges, "contains": body.contains,
            "anyof": body.anyof, "has": body.has, "owner": body.owner,
        },
        "sort": body.sort,
        "direction": body.direction,
    }  # fmt: skip


async def _run(
    db: Database, p: Any, app: Any, table: str, req: dict[str, Any], rid: str | None, via: str
) -> exports.ExportFile:
    return await exports.export_records(
        db, p, app, table, fmt=req["fmt"], fields=req["fields"],
        ids=[uuid.UUID(i) for i in req["ids"]] if req["ids"] else None,
        search=req["search"], sort=req["sort"], direction=req["direction"],
        request_id=rid, via=via,
    )  # fmt: skip


def _file(f: exports.ExportFile) -> Response:
    return Response(
        f.body,
        media_type=f.media_type,
        headers={"Content-Disposition": f'attachment; filename="{f.filename}"'},
    )


@router.post("/{table}/export")
async def export(
    table: str, body: ExportBody, request: Request, p: PrincipalDep, app: LiveAppDep, db: DbDep
) -> Response:
    """Download the list, or the ticked rows, as CSV, JSON or Excel."""
    return _file(await _run(db, p, app, table, _request(body), get_request_id(request), "download"))


@router.post("/{table}/export/email")
async def export_email(
    table: str,
    body: ExportBody,
    request: Request,
    p: PrincipalDep,
    app: LiveAppDep,
    db: DbDep,
    mailer: Annotated[Mailer, Depends(get_mailer)],
    settings: Annotated[Settings, Depends(get_settings_dep)],
) -> dict[str, Any]:
    """Email the signed-in person a link to this export. It goes only to their own address."""
    t = app.table(table)
    feat = records_features(t)
    if not feat.export_email:
        raise ValidationFailed(
            errors=[
                {
                    "field": "email",
                    "code": "invalid",
                    "message": "emailing exports is switched off for this table",
                }
            ]
        )
    if body.ids:
        raise ValidationFailed(
            errors=[
                {
                    "field": "ids",
                    "code": "invalid",
                    "message": "a link covers a search, not ticked rows; download those instead",
                }
            ]
        )
    exports._allowed(t, p, body.format)  # refuse now rather than when the link is opened
    token = exports.sign_link(settings.signing_key, p, {"tb": table, **_request(body)})
    link = f"{settings.web_base_url}/export/{token}"
    await mailer.send(
        to=p.email,
        subject=f"Your {t.plural_label.lower()} export",
        body=(
            f"Hello {p.full_name},\n\nYour export of {t.plural_label.lower()} is ready as {body.format.upper()}.\n"
            f"Open it while signed in: {link}\n\nThe link works for {exports.LINK_DAYS} days and only for you. "
            "It builds the file when you open it, from what you can see at that time.\n"
        ),
    )
    return {"sent_to": p.email}


link_router = APIRouter(prefix="/v1/exports", tags=["records"])


@link_router.get("/{token}")
async def open_export(
    token: str,
    request: Request,
    p: PrincipalDep,
    app: LiveAppDep,
    db: DbDep,
    settings: Annotated[Settings, Depends(get_settings_dep)],
) -> Response:
    data = exports.open_link(settings.signing_key, p, token)
    return _file(await _run(db, p, app, data["tb"], data, get_request_id(request), "email link"))
