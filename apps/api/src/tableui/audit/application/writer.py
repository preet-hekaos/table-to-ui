"""Write history and audit rows inside the caller's transaction."""

import json
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tableui.audit.domain.chain import GENESIS, HistoryEntry, entry_hash


async def append_history(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    table_key: str,
    record_id: uuid.UUID,
    action: str,
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
    actor_id: uuid.UUID,
    app_version: str,
) -> None:
    """Append one chained history entry. The caller holds the record row lock for updates."""
    last = (
        await session.execute(
            text(
                "SELECT seq, hash FROM record_history WHERE table_key = :t AND record_id = :r "
                "ORDER BY seq DESC LIMIT 1"
            ),
            {"t": table_key, "r": record_id},
        )
    ).first()
    seq = (last.seq + 1) if last else 1
    prev = last.hash if last else GENESIS
    at = datetime.now(UTC)
    h = entry_hash(
        prev,
        table_key=table_key,
        record_id=str(record_id),
        seq=seq,
        action=action,
        before=before,
        after=after,
        actor_id=str(actor_id),
        app_version=app_version,
        at=at,
    )
    await session.execute(
        text(
            "INSERT INTO record_history (tenant_id, table_key, record_id, seq, action, before, "
            "after, actor_id, app_version, at, prev_hash, hash) VALUES (:tn, :t, :r, :seq, :a, "
            "CAST(:b AS jsonb), CAST(:f AS jsonb), :u, :v, :at, :ph, :h)"
        ),
        {
            "tn": tenant_id,
            "t": table_key,
            "r": record_id,
            "seq": seq,
            "a": action,
            "b": json.dumps(before) if before is not None else None,
            "f": json.dumps(after) if after is not None else None,
            "u": actor_id,
            "v": app_version,
            "at": at,
            "ph": prev,
            "h": h,
        },
    )


async def write_audit(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID | None,
    scope: str,
    actor_id: uuid.UUID | None,
    action: str,
    subject_type: str | None = None,
    subject_id: str | None = None,
    detail: dict[str, Any] | None = None,
    request_id: str | None = None,
) -> None:
    await session.execute(
        text(
            "INSERT INTO control.audit_event (tenant_id, scope, actor_id, action, subject_type, "
            "subject_id, detail, request_id) VALUES (:tn, :sc, :ac, :a, :st, :si, "
            "CAST(:d AS jsonb), :rq)"
        ),
        {
            "tn": tenant_id,
            "sc": scope,
            "ac": actor_id,
            "a": action,
            "st": subject_type,
            "si": subject_id,
            "d": json.dumps(detail or {}),
            "rq": request_id,
        },
    )


async def read_history(
    session: AsyncSession, table_key: str, record_id: uuid.UUID
) -> list[HistoryEntry]:
    rows = (
        await session.execute(
            text(
                "SELECT seq, action, before, after, actor_id, app_version, at, prev_hash, hash "
                "FROM record_history WHERE table_key = :t AND record_id = :r ORDER BY seq"
            ),
            {"t": table_key, "r": record_id},
        )
    ).all()
    return [
        HistoryEntry(
            seq=r.seq,
            action=r.action,
            before=r.before,
            after=r.after,
            actor_id=str(r.actor_id),
            app_version=r.app_version,
            at=r.at,
            prev_hash=r.prev_hash,
            hash=r.hash,
        )
        for r in rows
    ]
