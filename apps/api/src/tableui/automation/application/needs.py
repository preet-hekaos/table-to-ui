"""What needs me, the first-steps guide for each role, and the sample data a workspace can try."""

import json
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tableui.commands.public import (
    BatchOp,
    CommandContext,
    apply_batch,
    create_record,
    update_record,
)
from tableui.identity.public import Principal
from tableui.metadata.public import GuideDef, Pack, RuntimeApp, SampleRecord
from tableui.platform.db import Database
from tableui.platform.errors import NotFound, ValidationFailed
from tableui.platform.ids import new_id


def _todo(app: RuntimeApp) -> Any:
    return next((t for t in app.tables.values() if t.todo is not None), None)


async def _subtitles(
    db: Database, p: Principal, app: RuntimeApp, todo: Any, rows: Any
) -> dict[str, str]:
    """For each to-do, the names of what it is about (the records its reference fields point at)."""
    assert p.tenant_id
    refs = [f for f in todo.fields if f.type == "reference" and f.ref_table in app.tables]
    refs = [f for f in refs if p.allows(f"record.{f.ref_table}.read")][:2]
    out: dict[str, list[str]] = {str(r.id): [] for r in rows}
    for f in refs:
        target = app.tables[f.ref_table]
        ids = sorted({str(r.data.get(f.key)) for r in rows if r.data.get(f.key)})
        if not ids:
            continue
        async with db.tenant(p.tenant_id) as s:
            found = (
                await s.execute(
                    text(
                        f"SELECT id::text AS id, data ->> '{target.title_field}' AS label FROM \"{target.key}\" "  # noqa: S608 - validated metadata keys
                        "WHERE id::text = ANY(CAST(:ids AS text[]))"
                    ),
                    {"ids": ids},
                )
            ).all()
        names: dict[str, str] = {str(x.id): str(x.label) for x in found if x.label}
        for r in rows:
            n = names.get(str(r.data.get(f.key)))
            if n:
                out[str(r.id)].append(n)
    return {k: ", ".join(v) for k, v in out.items() if v}


async def needs_me(db: Database, p: Principal, app: RuntimeApp) -> dict[str, Any]:
    """My open to-dos (soonest first), changes waiting for my decision, and what I have not read."""
    assert p.tenant_id
    todo = _todo(app)
    tasks: dict[str, Any] | None = None
    if todo is not None and p.allows(f"record.{todo.key}.read"):
        d = todo.todo
        due = f"NULLIF(data ->> '{d.due_field}', '')" if d.due_field else "NULL"
        async with db.tenant(p.tenant_id) as s:
            rows = (
                await s.execute(
                    text(
                        f'SELECT id, version, data, {due}::date AS due FROM "{todo.key}" '  # noqa: S608 - validated metadata keys
                        f"WHERE owner_id = :me AND COALESCE(data ->> '{d.status_field}', '') <> :done "
                        f"ORDER BY {due}::date NULLS LAST, created_at LIMIT 8"
                    ),
                    {"me": p.user_id, "done": d.done_value},
                )
            ).all()
            total = (
                await s.execute(
                    text(
                        f'SELECT count(*) FROM "{todo.key}" WHERE owner_id = :me '  # noqa: S608 - validated metadata keys
                        f"AND COALESCE(data ->> '{d.status_field}', '') <> :done"
                    ),
                    {"me": p.user_id, "done": d.done_value},
                )
            ).scalar_one()
        today = datetime.now(UTC).date()
        subtitles = await _subtitles(db, p, app, todo, rows)
        tasks = {
            "table": todo.key,
            "label": todo.plural_label,
            "total": int(total),
            "items": [
                {
                    "id": str(r.id),
                    "title": r.data.get(todo.title_field, ""),
                    "due_on": r.due.isoformat() if r.due else None,
                    "subtitle": subtitles.get(str(r.id)),
                    "overdue": bool(r.due and r.due < today),
                    "can_finish": p.allows(f"record.{todo.key}.update"),
                }
                for r in rows
            ],
        }
    approvals = 0
    async with db.control() as c:
        if p.allows("approval.decide"):
            approvals = int(
                (
                    await c.execute(
                        text(
                            "SELECT count(*) FROM control.approval WHERE tenant_id = :t "
                            "AND status = 'pending' AND requested_by <> :u"
                        ),
                        {"t": p.tenant_id, "u": p.user_id},
                    )
                ).scalar_one()
            )
        unread = int(
            (
                await c.execute(
                    text(
                        "SELECT count(*) FROM control.notification WHERE tenant_id = :t "
                        "AND user_id = :u AND read_at IS NULL"
                    ),
                    {"t": p.tenant_id, "u": p.user_id},
                )
            ).scalar_one()
        )
    return {"tasks": tasks, "approvals": approvals, "unread": unread}


async def finish_task(
    db: Database, ctx: CommandContext, table: str, record_id: uuid.UUID
) -> dict[str, Any]:
    """Tick off one of my to-dos."""
    t = ctx.app.table(table)
    if t.todo is None:
        raise NotFound("That is not a to-do list.")
    assert ctx.principal.tenant_id
    async with db.tenant(ctx.principal.tenant_id) as s:
        row = (
            await s.execute(
                text(f'SELECT version, owner_id FROM "{table}" WHERE id = :i'),  # noqa: S608 - validated metadata key
                {"i": record_id},
            )
        ).first()
    if row is None or row.owner_id != ctx.principal.user_id:
        raise NotFound("That to-do is not yours.")
    res = await update_record(
        db, ctx, table, record_id, {t.todo.status_field: t.todo.done_value}, row.version
    )
    return res.body


# ---- first steps -----------------------------------------------------------------------------


async def _pack_id(db: Database, tenant_id: uuid.UUID) -> str | None:
    async with db.tenant(tenant_id) as s:
        return (
            await s.execute(
                text("SELECT definition ->> 'id' FROM metadata_object WHERE kind = 'pack'")
            )
        ).scalar_one_or_none()


async def guide(db: Database, p: Principal, packs: Any) -> dict[str, Any] | None:
    """My role's first steps. A step ticks itself once I have added something to its table."""
    assert p.tenant_id
    pid = await _pack_id(db, p.tenant_id)
    if pid is None or pid not in packs.packs:
        return None
    pack: Pack = packs.get(pid)
    g: GuideDef | None = next((x for x in pack.guides if x.role == p.role_key), None)
    if g is None:
        return None
    async with db.control() as c:
        dismissed = bool(
            (
                await c.execute(
                    text(
                        "SELECT dismissed FROM control.guide_state WHERE tenant_id = :t AND user_id = :u"
                    ),
                    {"t": p.tenant_id, "u": p.user_id},
                )
            ).scalar_one_or_none()
        )
    steps = []
    async with db.tenant(p.tenant_id) as s:
        for st in g.steps:
            done = False
            if st.done_when:
                done = (
                    await s.execute(
                        text(f'SELECT 1 FROM "{st.done_when}" WHERE created_by = :u LIMIT 1'),  # noqa: S608 - validated pack key
                        {"u": p.user_id},
                    )
                ).first() is not None
            steps.append({**st.model_dump(mode="json", exclude={"done_when"}), "done": done})
    return {
        "title": g.title,
        "steps": steps,
        "done": sum(1 for x in steps if x["done"]),
        "total": len(steps),
        "dismissed": dismissed,
    }


async def set_guide_dismissed(c: AsyncSession, p: Principal, dismissed: bool) -> None:
    await c.execute(
        text(
            "INSERT INTO control.guide_state (tenant_id, user_id, dismissed) VALUES (:t, :u, :d) "
            "ON CONFLICT (tenant_id, user_id) DO UPDATE SET dismissed = EXCLUDED.dismissed, updated_at = now()"
        ),
        {"t": p.tenant_id, "u": p.user_id, "d": dismissed},
    )


# ---- sample data -----------------------------------------------------------------------------


async def sample_status(db: Database, p: Principal, packs: Any) -> dict[str, Any]:
    assert p.tenant_id
    pid = await _pack_id(db, p.tenant_id)
    available = bool(pid and pid in packs.packs and packs.get(pid).samples)
    async with db.control() as c:
        row = (
            await c.execute(
                text(
                    "SELECT jsonb_array_length(records) AS n FROM control.sample_batch "
                    "WHERE tenant_id = :t AND removed_at IS NULL ORDER BY loaded_at DESC LIMIT 1"
                ),
                {"t": p.tenant_id},
            )
        ).first()
    return {"available": available, "loaded": row is not None, "count": int(row.n) if row else 0}


def _resolve(value: Any, made: dict[str, str]) -> Any:
    if isinstance(value, str) and value.startswith("@"):
        return made[value[1:]]
    return value


async def load_samples(db: Database, ctx: CommandContext, packs: Any) -> dict[str, Any]:
    """Create the pack's sample records, all or nothing. They go through the same rules as anything else."""
    p = ctx.principal
    assert p.tenant_id
    pid = await _pack_id(db, p.tenant_id)
    samples: list[SampleRecord] = packs.get(pid).samples if pid and pid in packs.packs else []
    if not samples:
        raise NotFound("This app has no sample data.")
    if (await sample_status(db, p, packs))["loaded"]:
        raise ValidationFailed("Sample data is already loaded. Remove it first to load it again.")
    made: dict[str, str] = {}
    created: list[dict[str, str]] = []
    try:
        for sm in samples:
            data = {k: _resolve(v, made) for k, v in sm.data.items()}
            res = await create_record(db, ctx, sm.table, data)
            made[sm.alias] = res.body["id"]
            created.append({"table": sm.table, "id": res.body["id"]})
    except Exception:
        await _delete(db, ctx, created)
        raise
    async with db.control() as c:
        await c.execute(
            text(
                "INSERT INTO control.sample_batch (id, tenant_id, records, loaded_by) "
                "VALUES (:i, :t, CAST(:r AS jsonb), :u)"
            ),
            {"i": new_id(), "t": p.tenant_id, "r": json.dumps(created), "u": p.user_id},
        )
    return {"loaded": True, "count": len(created)}


async def _delete(db: Database, ctx: CommandContext, records: list[dict[str, str]]) -> int:
    n = 0
    for table in dict.fromkeys(r["table"] for r in reversed(records)):
        ops = [
            BatchOp("delete", record_id=uuid.UUID(r["id"]))
            for r in reversed(records)
            if r["table"] == table
        ]
        results = await apply_batch(db, ctx, table, ops, audit_action="sample.remove")
        n += sum(1 for r in results if r.ok)
    return n


async def remove_samples(db: Database, ctx: CommandContext) -> dict[str, Any]:
    p = ctx.principal
    assert p.tenant_id
    async with db.control() as c:
        row = (
            await c.execute(
                text(
                    "SELECT id, records FROM control.sample_batch "
                    "WHERE tenant_id = :t AND removed_at IS NULL ORDER BY loaded_at DESC LIMIT 1"
                ),
                {"t": p.tenant_id},
            )
        ).first()
    if row is None:
        raise NotFound("No sample data is loaded.")
    removed = await _delete(db, ctx, list(row.records))
    async with db.control() as c:
        await c.execute(
            text("UPDATE control.sample_batch SET removed_at = now() WHERE id = :i"), {"i": row.id}
        )
    return {"loaded": False, "removed": removed}
