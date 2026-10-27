"""Export records as CSV, JSON or Excel, and the signed link that emails one.

An export is the list itself, read again: the same scope, filters and hidden fields apply, so it can
never hold more than the person could see on screen. The table's ``features`` decide whether it is
allowed and in which formats. Every export is written to the audit trail.
"""

import base64
import csv
import hashlib
import hmac
import io
import json
import time
import uuid
from dataclasses import dataclass
from typing import Any

from tableui.audit.public import write_audit
from tableui.identity.public import Principal
from tableui.metadata.public import FieldDef, RuntimeApp, features_of
from tableui.platform.db import Database
from tableui.platform.errors import PermissionDenied, ValidationFailed
from tableui.query.application.records import list_records

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
MEDIA = {"csv": "text/csv; charset=utf-8", "json": "application/json", "xlsx": XLSX}
MAX_ROWS = {"csv": 100_000, "json": 100_000, "xlsx": 50_000}
LINK_DAYS = 7


@dataclass
class ExportFile:
    body: bytes
    media_type: str
    filename: str
    rows: int


def _bad(field: str, message: str) -> ValidationFailed:
    return ValidationFailed(errors=[{"field": field, "code": "invalid", "message": message}])


def _safe(v: Any) -> Any:
    """A text cell that starts like a formula would run as one in a spreadsheet; keep it text."""
    if isinstance(v, str) and v[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + v
    return v


def _plain(f: FieldDef, v: Any, label: str | None) -> Any:
    if label is not None:
        return label
    if v is None:
        return ""
    if isinstance(v, bool):
        return "Yes" if v else "No"
    if isinstance(v, list):
        return "; ".join(str(x) for x in v)
    return v


def _allowed(table: Any, principal: Principal, fmt: str) -> None:
    feat = features_of(table)
    if not feat.export_data:
        raise PermissionDenied("Exporting is switched off for this table.")
    if fmt not in feat.export_formats:
        raise PermissionDenied(f"This table does not allow {fmt.upper()} exports.")
    principal.require(f"record.{table.key}.read")


async def export_records(
    db: Database,
    principal: Principal,
    app: RuntimeApp,
    table_key: str,
    *,
    fmt: str,
    fields: list[str] | None = None,
    ids: list[uuid.UUID] | None = None,
    search: dict[str, Any] | None = None,
    sort: str = "updated_at",
    direction: str = "desc",
    request_id: str | None = None,
    via: str = "download",
) -> ExportFile:
    if fmt not in MEDIA:
        raise _bad("format", "choose csv, json or xlsx")
    table = app.table(table_key)
    _allowed(table, principal, fmt)
    denied = {f for (t, f) in principal.field_denies if t == table.key}
    left_out = set(features_of(table).unexported)  # the owner keeps these out of every export
    visible = [
        f for f in table.fields if not f.hidden and f.key not in denied and f.key not in left_out
    ]
    if fields:
        by_key = {f.key: f for f in visible}
        unknown = [k for k in fields if k not in by_key]
        if unknown:
            raise _bad("fields", f"not a field you can export: {unknown[0]}")
        columns = [by_key[k] for k in fields]
    else:
        columns = visible
    cap = MAX_ROWS[fmt]
    items: list[dict[str, Any]] = []
    cursor: str | None = None
    while True:
        page = await list_records(
            db, principal, app, table_key, sort=sort, direction=direction, cursor=cursor,
            limit=200, ids=ids, **(search or {}),
        )  # fmt: skip
        items += page["items"]
        if len(items) > cap:
            hint = (
                " Use CSV or JSON, or narrow the search."
                if fmt == "xlsx"
                else " Narrow the search."
            )
            raise _bad("format", f"More than {cap:,} records match.{hint}")
        cursor = page["next_cursor"]
        if not cursor:
            break
    refs = [(i, (i.get("refs") or {})) for i in items]
    if fmt == "json":
        out = [
            {
                "id": i["id"],
                **{f.key: i["data"].get(f.key) for f in columns},
            }
            for i, _ in refs
        ]
        body = json.dumps(out, ensure_ascii=False, indent=2, default=str).encode()
    else:
        head = [f.label for f in columns]
        grid = [
            [
                _safe(_plain(f, i["data"].get(f.key), (r.get(f.key) or {}).get("label")))
                for f in columns
            ]
            for i, r in refs
        ]
        if fmt == "csv":
            buf = io.StringIO()
            w = csv.writer(buf)
            w.writerow(head)
            w.writerows(grid)
            body = ("﻿" + buf.getvalue()).encode()  # the mark lets Excel read UTF-8
        else:
            from openpyxl import Workbook  # type: ignore[import-untyped]

            wb = Workbook(write_only=True)
            ws = wb.create_sheet(table.plural_label[:31])
            ws.append(head)
            for row in grid:
                ws.append(row)
            out_io = io.BytesIO()
            wb.save(out_io)
            body = out_io.getvalue()
    assert principal.tenant_id is not None
    async with db.control() as s:
        await write_audit(
            s,
            tenant_id=principal.tenant_id,
            scope="tenant",
            actor_id=principal.user_id,
            action="record.export",
            subject_type=table_key,
            subject_id=table_key,
            detail={
                "format": fmt,
                "rows": len(items),
                "fields": [f.key for f in columns],
                "via": via,
            },
            request_id=request_id,
        )
    name = table.plural_label.lower().replace(" ", "-")
    return ExportFile(body, MEDIA[fmt], f"{name}.{fmt}", len(items))


def sign_link(key: str, principal: Principal, payload: dict[str, Any]) -> str:
    data = {
        **payload,
        "u": str(principal.user_id),
        "t": str(principal.tenant_id),
        "exp": int(time.time()) + LINK_DAYS * 86400,
    }
    raw = (
        base64.urlsafe_b64encode(json.dumps(data, separators=(",", ":")).encode())
        .decode()
        .rstrip("=")
    )
    sig = hmac.new(key.encode(), raw.encode(), hashlib.sha256).hexdigest()[:40]
    return f"{raw}.{sig}"


def open_link(key: str, principal: Principal, token: str) -> dict[str, Any]:
    """The saved export request, if the link is genuine, unexpired and was sent to this person."""
    raw, _, sig = token.partition(".")
    good = hmac.new(key.encode(), raw.encode(), hashlib.sha256).hexdigest()[:40]
    if not sig or not hmac.compare_digest(sig, good):
        raise _bad("token", "this link is not valid")
    try:
        data: dict[str, Any] = json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
    except ValueError:
        raise _bad("token", "this link is not valid") from None
    if data.get("exp", 0) < time.time():
        raise _bad("token", "this link has expired; ask for a new one")
    if data.get("u") != str(principal.user_id) or data.get("t") != str(principal.tenant_id):
        raise PermissionDenied("This link was sent to someone else.")
    return data
