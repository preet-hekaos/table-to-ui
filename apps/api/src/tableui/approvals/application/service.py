"""Approvals: a change a rule holds for a manager. Request, list, decide, and apply on approval."""

import json
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import text

from tableui.audit.public import write_audit
from tableui.commands.public import CommandContext, check_record, create_record, update_record
from tableui.identity.public import Principal
from tableui.metadata.public import RuntimeApp
from tableui.platform.db import Database
from tableui.platform.errors import NotFound, PermissionDenied, ProblemError, ValidationFailed
from tableui.platform.ids import new_id

COLS = (
    "id, table_key, action, record_id, expected_version, payload, checks, title, note, status, "
    "requested_by, requested_at, decided_by, decided_at, decision_note, result_record_id, error"
)


def _iso(v: datetime | None) -> str | None:
    return v.isoformat() if v else None


async def _names(db: Database, ids: set[uuid.UUID | None]) -> dict[str, str]:
    wanted = [i for i in ids if i]
    if not wanted:
        return {}
    async with db.control() as c:
        rows = (
            await c.execute(
                text(
                    "SELECT id, full_name FROM control.app_user WHERE id = ANY(CAST(:i AS uuid[]))"
                ),
                {"i": wanted},
            )
        ).all()
    return {str(r.id): r.full_name for r in rows}


async def _shape(db: Database, rows: list[Any]) -> list[dict[str, Any]]:
    names = await _names(db, {r.requested_by for r in rows} | {r.decided_by for r in rows})
    return [
        {
            "id": str(r.id),
            "table": r.table_key,
            "action": r.action,
            "record_id": str(r.record_id) if r.record_id else None,
            "payload": r.payload,
            "checks": r.checks,
            "title": r.title,
            "note": r.note,
            "status": r.status,
            "requested_by": str(r.requested_by),
            "requested_by_name": names.get(str(r.requested_by)),
            "requested_at": _iso(r.requested_at),
            "decided_by": str(r.decided_by) if r.decided_by else None,
            "decided_by_name": names.get(str(r.decided_by)) if r.decided_by else None,
            "decided_at": _iso(r.decided_at),
            "decision_note": r.decision_note,
            "result_record_id": str(r.result_record_id) if r.result_record_id else None,
            "error": r.error,
        }
        for r in rows
    ]


def _ctx(p: Principal, app: RuntimeApp, version: str, request_id: str | None) -> CommandContext:
    return CommandContext(principal=p, app=app, app_version=version, request_id=request_id)


async def request_approval(
    db: Database,
    p: Principal,
    app: RuntimeApp,
    app_version: str,
    request_id: str | None,
    *,
    table: str,
    action: str,
    data: dict[str, Any],
    record_id: uuid.UUID | None,
    version: int | None,
    note: str,
) -> dict[str, Any]:
    """Hold a change for a decision. Only changes that really need approval can be held."""
    if action not in ("create", "update"):
        raise ValidationFailed(
            errors=[{"field": "action", "code": "invalid", "message": "must be create or update"}]
        )
    t = app.table(table)
    p.require(f"record.{table}.{action}")
    if action == "update" and (record_id is None or version is None):
        raise ValidationFailed(
            errors=[
                {"field": "record_id", "code": "required", "message": "name the record and version"}
            ]
        )
    outcomes = await check_record(
        db,
        _ctx(p, app, app_version, request_id),
        table,
        data,
        record_id if action == "update" else None,
    )
    blocking = [o for o in outcomes if o["severity"] == "block"]
    if blocking:
        raise ValidationFailed(blocking[0]["message"])
    needs = [o for o in outcomes if o["severity"] == "approval"]
    if not needs:
        raise ValidationFailed("This change does not need approval. Save it directly.")
    title = str(data.get(t.title_field) or t.label)
    if action == "update" and record_id is not None:
        async with db.tenant(p.tenant_id) as s:
            row = (
                await s.execute(
                    text(f'SELECT data FROM "{table}" WHERE id = :i'),  # noqa: S608 - identifiers are validated metadata keys
                    {"i": record_id},
                )
            ).first()
        if row is None:
            raise NotFound("That record does not exist.")
        title = str((row.data or {}).get(t.title_field) or t.label)
    aid = new_id()
    async with db.control() as c:
        await c.execute(
            text(
                "INSERT INTO control.approval (id, tenant_id, table_key, action, record_id, expected_version, "
                "payload, checks, check_ids, title, note, status, requested_by) VALUES (:id, :t, :tb, :ac, :ri, :ev, "
                "CAST(:pl AS jsonb), CAST(:ck AS jsonb), :ids, :ti, :no, 'pending', :u)"
            ),
            {
                "id": aid,
                "t": p.tenant_id,
                "tb": table,
                "ac": action,
                "ri": record_id,
                "ev": version,
                "pl": json.dumps(data),
                "ck": json.dumps(needs),
                "ids": [o["check"] for o in needs],
                "ti": title,
                "no": note,
                "u": p.user_id,
            },
        )
        await write_audit(
            c,
            tenant_id=p.tenant_id,
            scope="tenant",
            actor_id=p.user_id,
            action="approval.request",
            subject_type=table,
            subject_id=str(record_id) if record_id else str(aid),
            detail={"approval_id": str(aid), "checks": [o["check"] for o in needs], "note": note},
            request_id=request_id,
        )
    return await get(db, p, aid)


async def list_approvals(
    db: Database,
    p: Principal,
    *,
    status: str | None,
    table: str | None = None,
    record_id: uuid.UUID | None = None,
    mine: bool = False,
) -> dict[str, Any]:
    """Approvers see everything in the workspace; everyone else sees what they asked for."""
    conds = ["tenant_id = :t"]
    params: dict[str, Any] = {"t": p.tenant_id}
    if mine or not p.allows("approval.decide"):
        conds.append("requested_by = :u")
        params["u"] = p.user_id
    if status:
        conds.append("status = :s")
        params["s"] = status
    if table:
        conds.append("table_key = :tb")
        params["tb"] = table
    if record_id:
        conds.append("record_id = :r")
        params["r"] = record_id
    async with db.control() as c:
        rows = (
            await c.execute(
                text(
                    f"SELECT {COLS} FROM control.approval WHERE {' AND '.join(conds)} "  # noqa: S608 - fixed column list
                    "ORDER BY requested_at DESC LIMIT 200"
                ),
                params,
            )
        ).all()
        mine_only = "" if p.allows("approval.decide") else " AND requested_by = :u"
        pending = (
            await c.execute(
                text(
                    "SELECT count(*) FROM control.approval WHERE tenant_id = :t AND status = 'pending'"  # noqa: S608 - fixed fragments
                    + mine_only
                ),
                {"t": p.tenant_id, "u": p.user_id},
            )
        ).scalar_one()
    return {"items": await _shape(db, list(rows)), "pending": pending}


async def get(db: Database, p: Principal, approval_id: uuid.UUID) -> dict[str, Any]:
    async with db.control() as c:
        row = (
            await c.execute(
                text(f"SELECT {COLS} FROM control.approval WHERE id = :i AND tenant_id = :t"),  # noqa: S608 - fixed column list
                {"i": approval_id, "t": p.tenant_id},
            )
        ).first()
    if row is None or (row.requested_by != p.user_id and not p.allows("approval.decide")):
        raise NotFound("That approval does not exist.")
    return (await _shape(db, [row]))[0]


async def cancel(
    db: Database, p: Principal, approval_id: uuid.UUID, request_id: str | None
) -> dict[str, Any]:
    async with db.control() as c:
        res = await c.execute(
            text(
                "UPDATE control.approval SET status = 'cancelled', decided_by = :u, decided_at = now() "
                "WHERE id = :i AND tenant_id = :t AND requested_by = :u AND status = 'pending' RETURNING table_key"
            ),
            {"i": approval_id, "t": p.tenant_id, "u": p.user_id},
        )
        got = res.first()
        if got is None:
            raise ValidationFailed("Only your own pending requests can be cancelled.")
        await write_audit(
            c,
            tenant_id=p.tenant_id,
            scope="tenant",
            actor_id=p.user_id,
            action="approval.cancel",
            subject_type=got.table_key,
            subject_id=str(approval_id),
            detail={"approval_id": str(approval_id)},
            request_id=request_id,
        )
    return await get(db, p, approval_id)


async def decide(
    db: Database,
    p: Principal,
    app: RuntimeApp,
    app_version: str,
    request_id: str | None,
    approval_id: uuid.UUID,
    *,
    approve: bool,
    note: str,
) -> dict[str, Any]:
    """Approve (and apply the held change) or reject. Nobody decides their own request."""
    p.require("approval.decide")
    if not approve and not note.strip():
        raise ValidationFailed(
            errors=[{"field": "note", "code": "required", "message": "say why it was rejected"}]
        )
    async with db.control() as c:
        row = (
            await c.execute(
                text(
                    f"SELECT {COLS}, check_ids FROM control.approval WHERE id = :i AND tenant_id = :t FOR UPDATE"  # noqa: S608 - fixed column list
                ),
                {"i": approval_id, "t": p.tenant_id},
            )
        ).first()
        if row is None:
            raise NotFound("That approval does not exist.")
        if row.requested_by == p.user_id:
            raise PermissionDenied("You cannot decide your own request.")
        if row.status != "pending":
            raise ValidationFailed(f"This request is already {row.status}.")
        await c.execute(
            text(
                "UPDATE control.approval SET status = :s, decided_by = :u, decided_at = now(), decision_note = :n "
                "WHERE id = :i"
            ),
            {
                "s": "approved" if approve else "rejected",
                "u": p.user_id,
                "n": note,
                "i": approval_id,
            },
        )
        await write_audit(
            c,
            tenant_id=p.tenant_id,
            scope="tenant",
            actor_id=p.user_id,
            action="approval.approve" if approve else "approval.reject",
            subject_type=row.table_key,
            subject_id=str(row.record_id) if row.record_id else str(approval_id),
            detail={"approval_id": str(approval_id), "note": note, "checks": list(row.check_ids)},
            request_id=request_id,
        )
    if approve:
        ctx = CommandContext(
            principal=p,
            app=app,
            app_version=app_version,
            request_id=request_id,
            approved_checks=frozenset(row.check_ids),
            approval_id=str(approval_id),
        )
        try:
            if row.action == "create":
                result = await create_record(db, ctx, row.table_key, row.payload)
            else:
                result = await update_record(
                    db, ctx, row.table_key, row.record_id, row.payload, row.expected_version
                )
        except ProblemError as e:
            async with db.control() as c:
                await c.execute(
                    text("UPDATE control.approval SET status = 'failed', error = :e WHERE id = :i"),
                    {"e": e.detail or e.title, "i": approval_id},
                )
            raise
        async with db.control() as c:
            await c.execute(
                text("UPDATE control.approval SET result_record_id = :r WHERE id = :i"),
                {"r": uuid.UUID(result.body["id"]), "i": approval_id},
            )
    return await get(db, p, approval_id)
