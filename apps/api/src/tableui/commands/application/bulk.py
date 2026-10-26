"""Bulk actions on ticked rows: change one field, delete, and undo either.

Every record goes through the same steps as a single command (see ``batch``). The owner's
``features`` switches are enforced here, not only in the screen. Undo reads what the record held from
its history, so a caller can only restore values the system itself recorded, and only its own
recent change.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from sqlalchemy import text

from tableui.commands.application.batch import BatchOp, BatchResult, apply_batch
from tableui.commands.application.pipeline import CommandContext
from tableui.metadata.public import features_of
from tableui.platform.db import Database
from tableui.platform.errors import PermissionDenied, ValidationFailed

UNDO_WINDOW = timedelta(minutes=15)
Action = Literal["update", "delete"]


def _bad(field: str, message: str) -> ValidationFailed:
    return ValidationFailed(errors=[{"field": field, "code": "invalid", "message": message}])


def _outcome(results: list[BatchResult], undo_kind: Action) -> dict[str, Any]:
    done = [r for r in results if r.ok]
    return {
        "applied": len(done),
        "failed": [
            {"id": str(r.record_id), "message": r.error, "code": r.code}
            for r in results
            if not r.ok
        ],
        "undo": {"kind": undo_kind, "ids": [str(r.record_id) for r in done]} if done else None,
    }


async def bulk_change(
    db: Database,
    ctx: CommandContext,
    table_key: str,
    *,
    action: Action,
    ids: list[uuid.UUID],
    field: str | None = None,
    value: Any = None,
) -> dict[str, Any]:
    table = ctx.app.table(table_key)
    feat = features_of(table)
    wanted = "edit" if action == "update" else "delete"
    if not feat.select_bulk or wanted not in feat.bulk_actions:
        raise PermissionDenied("This table does not allow that bulk action.")
    ctx.principal.require(f"record.{table_key}.{action}")
    if action == "update":
        if not field or field not in {f.key for f in table.fields}:
            raise _bad("field", "choose a field of this table")
        payload: dict[str, Any] = {field: value}
        ops = [BatchOp("update", dict(payload), record_id=i) for i in ids]
    else:
        ops = [BatchOp("delete", record_id=i) for i in ids]
    results = await apply_batch(db, ctx, table_key, ops, audit_action=f"record.bulk_{action}")
    return _outcome(results, action)


async def bulk_undo(
    db: Database, ctx: CommandContext, table_key: str, *, kind: Action, ids: list[uuid.UUID]
) -> dict[str, Any]:
    """Put back what the caller's own last change took away or overwrote, within 15 minutes."""
    ctx.app.table(table_key)
    ctx.principal.require(f"record.{table_key}.{'create' if kind == 'delete' else 'update'}")
    assert ctx.principal.tenant_id is not None
    async with db.tenant(ctx.principal.tenant_id) as s:
        rows = (
            await s.execute(
                text(
                    "SELECT DISTINCT ON (record_id) record_id, action, before, actor_id, at "
                    "FROM record_history WHERE table_key = :t AND record_id = ANY(CAST(:ids AS uuid[])) "
                    "ORDER BY record_id, seq DESC"
                ),
                {"t": table_key, "ids": ids},
            )
        ).all()
    cutoff = datetime.now(UTC) - UNDO_WINDOW
    ops = [
        BatchOp("create" if kind == "delete" else "replace", dict(r.before), record_id=r.record_id)
        for r in rows
        if r.action == kind
        and r.actor_id == ctx.principal.user_id
        and r.at >= cutoff
        and r.before is not None
    ]
    if not ops:
        raise _bad("ids", "nothing to undo: it was changed again, by someone else, or too long ago")
    results = await apply_batch(db, ctx, table_key, ops, audit_action="record.bulk_undo")
    out = _outcome(results, kind)
    out["undo"] = None
    return out
