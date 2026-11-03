"""Archive: take a thing out of use, keep it for a while, bring it back, or delete it for good."""

import contextlib
import json
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tableui.archive.domain import policy
from tableui.audit.public import write_audit
from tableui.commands.public import BatchOp, CommandContext, apply_batch
from tableui.identity.public import Principal
from tableui.metadata.public import archive_steps
from tableui.platform.db import Database
from tableui.platform.errors import NotFound, ValidationFailed
from tableui.platform.ids import new_id

METADATA_KINDS = ("field", "link", "measure", "automation")


def _bad(field: str, message: str, code: str = "invalid") -> ValidationFailed:
    return ValidationFailed(errors=[{"field": field, "code": code, "message": message}])


async def get_setting(s: AsyncSession, tenant_id: uuid.UUID) -> dict[str, Any]:
    row = (
        await s.execute(
            text(
                "SELECT auto_delete, days, per_kind, warn_days FROM control.archive_setting WHERE tenant_id = :t"
            ),
            {"t": tenant_id},
        )
    ).first()
    if row is None:
        return dict(policy.DEFAULT)
    return {
        "auto_delete": row.auto_delete,
        "days": row.days,
        "per_kind": dict(row.per_kind),
        "warn_days": row.warn_days,
    }


async def set_setting(
    db: Database,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    body: dict[str, Any],
    confirm: bool,
    request_id: str | None,
) -> dict[str, Any]:
    found = policy.problems(body)
    if found:
        raise _bad(found[0][0], found[0][1])
    async with db.control() as s:
        cur = await get_setting(s, tenant_id)
        new = {
            "auto_delete": cur["auto_delete"]
            if body.get("auto_delete") is None
            else bool(body["auto_delete"]),
            "days": cur["days"] if body.get("days") is None else int(body["days"]),
            "per_kind": cur["per_kind"]
            if body.get("per_kind") is None
            else {k: int(v) for k, v in body["per_kind"].items()},
            "warn_days": cur["warn_days"]
            if body.get("warn_days") is None
            else int(body["warn_days"]),
        }
        rows = (
            await s.execute(
                text(
                    "SELECT id, kind, archived_at, delete_after FROM control.archive_item WHERE tenant_id = :t"
                ),
                {"t": tenant_id},
            )
        ).all()
        now = datetime.now(UTC)
        changes: list[tuple[uuid.UUID, datetime | None]] = []
        sooner = 0
        for r in rows:
            after = policy.delete_after(new, r.kind, r.archived_at)
            changes.append((r.id, after))
            if (
                after is not None
                and (r.delete_after is None or after < r.delete_after)
                and after <= now + timedelta(days=1)
            ):
                sooner += 1
        if sooner and not confirm:
            raise ValidationFailed(
                errors=[
                    {
                        "field": "days",
                        "code": "confirm",
                        "message": f"{sooner} item{'s' if sooner != 1 else ''} will now be deleted for good at the next clean-up.",
                        "count": sooner,
                    }
                ]
            )
        await s.execute(
            text(
                "INSERT INTO control.archive_setting (tenant_id, auto_delete, days, per_kind, warn_days, updated_by, updated_at) "
                "VALUES (:t, :a, :d, CAST(:p AS jsonb), :w, :u, now()) ON CONFLICT (tenant_id) DO UPDATE SET "
                "auto_delete = EXCLUDED.auto_delete, days = EXCLUDED.days, per_kind = EXCLUDED.per_kind, "
                "warn_days = EXCLUDED.warn_days, updated_by = EXCLUDED.updated_by, updated_at = now()"
            ),
            {
                "t": tenant_id,
                "a": new["auto_delete"],
                "d": new["days"],
                "p": json.dumps(new["per_kind"]),
                "w": new["warn_days"],
                "u": user_id,
            },
        )
        for rid, after in changes:
            await s.execute(
                text(
                    "UPDATE control.archive_item SET delete_after = :a, warned_at = NULL WHERE id = :i"
                ),
                {"a": after, "i": rid},
            )
        await write_audit(
            s, tenant_id=tenant_id, scope="tenant", actor_id=user_id, action="archive.settings",
            subject_type="workspace", subject_id=str(tenant_id), detail=new, request_id=request_id,
        )  # fmt: skip
    return new


def _shape(r: Any, now: datetime) -> dict[str, Any]:
    left = None if r.delete_after is None else max(0, (r.delete_after - now).days)
    return {
        "id": str(r.id),
        "kind": r.kind,
        "table": r.table_key,
        "key": r.item_key,
        "label": r.label,
        "detail": r.detail,
        "archived_at": r.archived_at.isoformat(),
        "archived_by": r.by_name,
        "delete_after": r.delete_after.isoformat() if r.delete_after else None,
        "days_left": left,
    }


async def list_items(db: Database, tenant_id: uuid.UUID) -> dict[str, Any]:
    await sweep(db, tenant_id)
    now = datetime.now(UTC)
    async with db.control() as s:
        rows = (
            await s.execute(
                text(
                    "SELECT a.*, u.full_name AS by_name FROM control.archive_item a "
                    "LEFT JOIN control.app_user u ON u.id = a.archived_by WHERE a.tenant_id = :t "
                    "ORDER BY a.delete_after NULLS LAST, a.archived_at DESC"
                ),
                {"t": tenant_id},
            )
        ).all()
        setting = await get_setting(s, tenant_id)
    return {"items": [_shape(r, now) for r in rows], "setting": setting}


async def count_items(db: Database, tenant_id: uuid.UUID) -> int:
    async with db.control() as s:
        return int(
            (
                await s.execute(
                    text("SELECT count(*) FROM control.archive_item WHERE tenant_id = :t"),
                    {"t": tenant_id},
                )
            ).scalar_one()
        )


async def impact(
    db: Database, tenant_id: uuid.UUID, kind: str, table: str | None, key: str
) -> dict[str, Any]:
    if kind not in METADATA_KINDS:
        raise _bad("kind", "Records are archived from their list.")
    async with db.control() as s:
        out = await archive_steps.impact(
            s, tenant_id=tenant_id, kind=kind, table_key=table, key=key
        )
        setting = await get_setting(s, tenant_id)
    days = policy.days_for(setting, kind)
    out["days"] = days
    out["delete_on"] = (
        None if days is None else (datetime.now(UTC) + timedelta(days=days)).date().isoformat()
    )
    return out


async def _insert(
    s: AsyncSession, *, tenant_id: uuid.UUID, user_id: uuid.UUID, kind: str, table: str | None, key: str,
    label: str, detail: str, payload: dict[str, Any], setting: dict[str, Any],
) -> uuid.UUID:  # fmt: skip
    now = datetime.now(UTC)
    rid = new_id()
    await s.execute(
        text(
            "INSERT INTO control.archive_item (id, tenant_id, kind, table_key, item_key, label, detail, payload, archived_by, archived_at, delete_after) "
            "VALUES (:i, :t, :k, :tb, :key, :l, :d, CAST(:p AS jsonb), :u, :at, :da)"
        ),
        {
            "i": rid, "t": tenant_id, "k": kind, "tb": table, "key": key, "l": label, "d": detail,
            "p": json.dumps(payload, default=str), "u": user_id, "at": now,
            "da": policy.delete_after(setting, kind, now),
        },
    )  # fmt: skip
    return rid


async def archive_metadata(
    db: Database, p: Principal, *, kind: str, table: str | None, key: str, request_id: str | None
) -> dict[str, Any]:
    if kind not in METADATA_KINDS:
        raise _bad("kind", "That cannot be archived here.")
    assert p.tenant_id
    async with db.control() as s:
        out = await archive_steps.take_out(
            s,
            tenant_id=p.tenant_id,
            user_id=p.user_id,
            kind=kind,
            table_key=table,
            key=key,
            request_id=request_id,
        )
        setting = await get_setting(s, p.tenant_id)
        rid = await _insert(
            s, tenant_id=p.tenant_id, user_id=p.user_id, kind=kind, table=table, key=key,
            label=out["label"], detail=out["detail"], payload=out["payload"], setting=setting,
        )  # fmt: skip
        await write_audit(
            s, tenant_id=p.tenant_id, scope="tenant", actor_id=p.user_id, action="archive.add",
            subject_type=kind, subject_id=f"{table + '.' if table else ''}{key}", detail={}, request_id=request_id,
        )  # fmt: skip
        row = (
            await s.execute(
                text(
                    "SELECT a.*, u.full_name AS by_name FROM control.archive_item a LEFT JOIN control.app_user u ON u.id = a.archived_by WHERE a.id = :i"
                ),
                {"i": rid},
            )
        ).one()
    return _shape(row, datetime.now(UTC))


async def archive_records(
    db: Database, ctx: CommandContext, table: str, ids: list[uuid.UUID]
) -> dict[str, Any]:
    p = ctx.principal
    assert p.tenant_id
    p.require(f"record.{table}.delete")
    tdef = ctx.app.table(table)
    results = await apply_batch(
        db, ctx, table, [BatchOp("delete", record_id=i) for i in ids], audit_action="record.archive"
    )
    done = [r for r in results if r.ok and r.before is not None]
    async with db.control() as s:
        setting = await get_setting(s, p.tenant_id)
        for r in done:
            assert r.record_id is not None and r.before is not None
            label = str(r.before.get(tdef.title_field) or r.record_id)
            await _insert(
                s, tenant_id=p.tenant_id, user_id=p.user_id, kind="record", table=table, key=str(r.record_id),
                label=label, detail=f"{tdef.label} record", payload={"data": r.before}, setting=setting,
            )  # fmt: skip
    return {
        "archived": len(done),
        "failed": [{"id": str(r.record_id), "message": r.error} for r in results if not r.ok],
    }


async def restore(
    db: Database,
    ctx: CommandContext | None,
    p: Principal,
    ids: list[uuid.UUID],
    request_id: str | None,
) -> dict[str, Any]:
    assert p.tenant_id
    restored: list[str] = []
    failed: list[dict[str, str]] = []
    for item_id in ids:
        async with db.control() as s:
            row = (
                await s.execute(
                    text("SELECT * FROM control.archive_item WHERE id = :i AND tenant_id = :t"),
                    {"i": item_id, "t": p.tenant_id},
                )
            ).first()
        if row is None:
            failed.append({"id": str(item_id), "message": "It is not in the archive any more."})
            continue
        try:
            if row.kind == "record":
                if ctx is None:
                    raise _bad("kind", "Records are restored from the Archive page.")
                res = await apply_batch(
                    db,
                    ctx,
                    row.table_key,
                    [
                        BatchOp(
                            "create", dict(row.payload["data"]), record_id=uuid.UUID(row.item_key)
                        )
                    ],
                    audit_action="record.restore",
                )
                if not res[0].ok:
                    raise _bad("record", res[0].error or "It could not be restored.")
                async with db.control() as s:
                    await s.execute(
                        text("DELETE FROM control.archive_item WHERE id = :i"), {"i": item_id}
                    )
            else:
                async with db.control() as s:
                    await archive_steps.put_back(
                        s, tenant_id=p.tenant_id, user_id=p.user_id, kind=row.kind, table_key=row.table_key,
                        key=row.item_key, payload=row.payload, request_id=request_id,
                    )  # fmt: skip
                    await s.execute(
                        text("DELETE FROM control.archive_item WHERE id = :i"), {"i": item_id}
                    )
                    await write_audit(
                        s, tenant_id=p.tenant_id, scope="tenant", actor_id=p.user_id, action="archive.restore",
                        subject_type=row.kind, subject_id=row.item_key, detail={}, request_id=request_id,
                    )  # fmt: skip
            restored.append(str(item_id))
        except ValidationFailed as e:
            failed.append(
                {
                    "id": str(item_id),
                    "message": e.errors[0]["message"] if e.errors else "It could not be restored.",
                }
            )
    return {"restored": restored, "failed": failed}


async def _purge_rows(
    s: AsyncSession,
    tenant_id: uuid.UUID,
    rows: Sequence[Any],
    actor: uuid.UUID | None,
    request_id: str | None,
    why: str,
) -> int:
    n = 0
    for r in rows:
        if r.kind in ("field", "link") and r.table_key:
            with contextlib.suppress(
                Exception
            ):  # a table that is already gone has no values to strip
                async with s.begin_nested():
                    await archive_steps.strip_field_values(
                        s, s, tenant_id=tenant_id, table_key=r.table_key, key=r.item_key
                    )
        await s.execute(text("DELETE FROM control.archive_item WHERE id = :i"), {"i": r.id})
        await write_audit(
            s, tenant_id=tenant_id, scope="tenant", actor_id=actor, action="archive.purge",
            subject_type=r.kind, subject_id=f"{r.table_key + '.' if r.table_key else ''}{r.item_key}",
            detail={"label": r.label, "why": why}, request_id=request_id,
        )  # fmt: skip
        n += 1
    return n


async def purge(
    db: Database, p: Principal, ids: list[uuid.UUID], request_id: str | None
) -> dict[str, Any]:
    """Delete for good, on purpose. Nothing can bring it back."""
    assert p.tenant_id
    async with db.control() as s:
        rows = (
            await s.execute(
                text(
                    "SELECT * FROM control.archive_item WHERE tenant_id = :t AND id = ANY(CAST(:ids AS uuid[]))"
                ),
                {"t": p.tenant_id, "ids": ids},
            )
        ).all()
        if not rows:
            raise NotFound("Those items are not in the archive.")
        n = await _purge_rows(s, p.tenant_id, rows, p.user_id, request_id, "by an admin")
    return {"deleted": n}


async def sweep(db: Database, tenant_id: uuid.UUID) -> int:
    """The nightly clean-up: delete what has waited long enough."""
    async with db.control() as s:
        rows = (
            await s.execute(
                text(
                    "SELECT * FROM control.archive_item WHERE tenant_id = :t AND delete_after IS NOT NULL AND delete_after <= now()"
                ),
                {"t": tenant_id},
            )
        ).all()
        if not rows:
            return 0
        return await _purge_rows(s, tenant_id, rows, None, None, "auto-delete")
