"""Run automations: react to saved records, check dates, retry what failed, keep within limits.

An automation never blocks or undoes a save: it runs afterwards, from the outbox. Every run is
keyed by (automation, record, trigger), so a redelivered event or a repeated date check does
nothing twice.
"""

import json
import logging
import uuid
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tableui.automation.application import notifications
from tableui.automation.domain.render import (
    WINDOW_DAYS,
    date_window,
    holds,
    referenced_ids,
    render,
)
from tableui.commands.public import CommandContext, create_record, update_record
from tableui.identity.public import Principal
from tableui.metadata.public import AutomationDef, RuntimeApp, TableDef, live_app
from tableui.platform.config import Settings
from tableui.platform.db import Database
from tableui.platform.errors import (
    ApprovalRequired,
    NotFound,
    ProblemError,
    RuleBlocked,
    ValidationFailed,
    VersionConflict,
)
from tableui.platform.ids import new_id
from tableui.platform.mail import Mailer

log = logging.getLogger(__name__)
SYSTEM_USER = uuid.UUID("00000000-0000-0000-0000-00000000a070")
MAX_DEPTH = 1  # a person's save may set off automations, and theirs one level more
BACKOFF_MINUTES = (1, 5, 30)
MAX_ATTEMPTS = 3
SCAN_LIMIT = 5000
PERMANENT = (RuleBlocked, ApprovalRequired, ValidationFailed, NotFound)


def system_principal(tenant_id: uuid.UUID) -> Principal:
    return Principal(
        user_id=SYSTEM_USER,
        email="automation@system",
        full_name="Automation",
        realm="tenant",
        tenant_id=tenant_id,
        tenant_name=None,
        role_key=None,
        permissions=frozenset({"*"}),
        mfa_enabled=False,
        mfa_verified=False,
        session_hash="automation",
    )


def _context(
    app: RuntimeApp, tenant_id: uuid.UUID, settings: Settings, depth: int, owner: uuid.UUID | None
) -> CommandContext:
    return CommandContext(
        principal=system_principal(tenant_id),
        app=app,
        app_version=settings.app_version,
        request_id=f"automation-{new_id()}",
        owner_id=owner,
        automation_depth=depth + 1,
    )


# ---- reading --------------------------------------------------------------------------------


async def _record(db: Database, tenant_id: uuid.UUID, table: str, rid: uuid.UUID) -> Any:
    async with db.tenant(tenant_id) as s:
        return (
            await s.execute(
                text(
                    f'SELECT id, data, version, owner_id FROM "{table}" WHERE id = :i'  # noqa: S608 - validated metadata key
                ),
                {"i": rid},
            )
        ).first()


async def _titles(
    db: Database, tenant_id: uuid.UUID, app: RuntimeApp, table: TableDef, ids: set[str]
) -> dict[str, str]:
    """Titles of the records a text will name (a person's name, a job's title)."""
    if not ids:
        return {}
    out: dict[str, str] = {}
    async with db.tenant(tenant_id) as s:
        for f in table.fields:
            target = app.tables.get(f.ref_table or "") if f.type == "reference" else None
            if target is None:
                continue
            rows = await s.execute(
                text(
                    f'SELECT id, data ->> :tf AS title FROM "{target.key}" WHERE id = ANY(:ids)'  # noqa: S608 - validated metadata keys
                ),
                {"tf": target.title_field, "ids": [uuid.UUID(i) for i in ids]},
            )
            out |= {str(r.id): r.title or "" for r in rows}
    return out


async def _people(
    c: AsyncSession, tenant_id: uuid.UUID, to: str, role: str | None, owner: uuid.UUID | None
) -> list[uuid.UUID]:
    if to == "owner":
        return [owner] if owner and owner != SYSTEM_USER else []
    rows = await c.execute(
        text(
            "SELECT u.id FROM control.membership m JOIN control.app_user u ON u.id = m.user_id "
            "WHERE m.tenant_id = :t AND m.role_key = :r AND u.active ORDER BY u.full_name"
        ),
        {"t": tenant_id, "r": role},
    )
    return [r.id for r in rows]


# ---- one run --------------------------------------------------------------------------------


def _scrub(e: Exception) -> str:
    return str(e)[:300] or e.__class__.__name__


async def _actions(
    db: Database,
    mailer: Mailer,
    settings: Settings,
    app: RuntimeApp,
    tenant_id: uuid.UUID,
    a: AutomationDef,
    table: TableDef,
    rec: Any,
    depth: int,
    done: set[int],
    save: Any,
) -> list[dict[str, Any]]:
    """Do each action once. ``save`` records progress so a retry resumes after the last one that worked."""
    data = rec.data
    today = datetime.now(UTC).date()
    texts = [t for act in a.actions for t in (act.message, act.value or "", *act.values.values())]
    titles = await _titles(db, tenant_id, app, table, referenced_ids(table, texts, data))
    outcome: list[dict[str, Any]] = []

    def say(t: str) -> str:
        return str(render(t, table, str(rec.id), data, titles, today))

    for i, act in enumerate(a.actions):
        if i in done:
            continue
        async with db.control() as c:
            people = await _people(c, tenant_id, act.to, act.role, rec.owner_id)
        if act.kind == "notify":
            async with db.control() as c:
                await notifications.notify(
                    c,
                    mailer,
                    tenant_id=tenant_id,
                    user_ids=people,
                    kind="automation",
                    title=say(act.message),
                    link=f"/records/{table.key}/{rec.id}",
                    table_key=table.key,
                    record_id=rec.id,
                    source=a.key,
                    dedupe_key=f"{a.key}:{rec.id}:{i}:{today}",
                    also_email=act.also_email,
                )
            line = f"Told {len(people)} {'person' if len(people) == 1 else 'people'}"
        elif act.kind == "create":
            target = app.table(act.table or "")
            made = 0
            for uid in people or [None]:  # type: ignore[list-item]
                values = {
                    k: render(v, table, str(rec.id), data, titles, today)
                    for k, v in act.values.items()
                }
                values = {k: v for k, v in values.items() if v not in (None, "")}
                ctx = _context(app, tenant_id, settings, depth, uid)
                result = await create_record(db, ctx, target.key, values)
                made += 1
                if uid and target.todo is not None:
                    async with db.control() as c:
                        await notifications.notify(
                            c,
                            mailer,
                            tenant_id=tenant_id,
                            user_ids=[uid],
                            kind="task",
                            title=f"New {target.label.lower()}: "
                            f"{values.get(target.title_field, target.label)}",
                            link=f"/records/{target.key}/{result.body['id']}",
                            table_key=target.key,
                            record_id=uuid.UUID(result.body["id"]),
                            source=a.key,
                        )
            line = f"Created {made} {target.label.lower() if made == 1 else target.plural_label.lower()}"
        else:
            value = render(act.value or "", table, str(rec.id), data, titles, today)
            version = rec.version
            for attempt in range(2):
                try:
                    await update_record(
                        db,
                        _context(app, tenant_id, settings, depth, None),
                        table.key,
                        rec.id,
                        {act.field or "": value},
                        version,
                    )
                    break
                except VersionConflict:
                    fresh = await _record(db, tenant_id, table.key, rec.id)
                    if attempt or fresh is None:
                        raise
                    version = fresh.version
            line = f"Set {act.field} to {value}"
        outcome.append({"i": i, "kind": act.kind, "text": line})
        done.add(i)
        await save(outcome)
    return outcome


async def execute(
    db: Database, mailer: Mailer, settings: Settings, tenant_id: uuid.UUID, run_id: uuid.UUID
) -> str:
    """Do (or finish) a run. Returns its status. Failures are recorded, never raised."""
    async with db.control() as c:
        run = (
            await c.execute(
                text(
                    "SELECT * FROM control.automation_run WHERE id = :i AND tenant_id = :t "
                    "AND status = 'retrying' FOR UPDATE SKIP LOCKED"
                ),
                {"i": run_id, "t": tenant_id},
            )
        ).first()
        if run is None:
            return "skipped"
        app = await live_app(c, tenant_id)
    auto = next((x for x in app.automations if x.key == run.automation_key), None)
    done = {o["i"] for o in run.outcome}
    base: list[dict[str, Any]] = list(run.outcome)

    async def progress(o: list[dict[str, Any]]) -> None:
        async with db.control() as c2:
            await c2.execute(
                text("UPDATE control.automation_run SET outcome = CAST(:o AS jsonb) WHERE id = :i"),
                {"o": json.dumps([*base, *o]), "i": run_id},
            )

    error: str | None = None
    permanent = False
    try:
        if auto is None:
            raise NotFound("This automation is no longer part of the live app.")
        table = app.table(auto.trigger.table)
        rec = await _record(db, tenant_id, table.key, run.record_id)
        if rec is None:
            raise NotFound("The record is gone.")
        await _actions(
            db, mailer, settings, app, tenant_id, auto, table, rec, run.depth, done, progress
        )
    except PERMANENT as e:
        error, permanent = _scrub(e), True
    except Exception as e:  # a mail or database hiccup: try again later
        log.exception("automation %s failed", run.automation_key)
        error = _scrub(e)
    attempts = run.attempts + 1
    if error is None:
        status, nxt = "done", None
    elif permanent or attempts >= MAX_ATTEMPTS:
        status, nxt = "failed", None
    else:
        status, nxt = "retrying", BACKOFF_MINUTES[min(attempts - 1, len(BACKOFF_MINUTES) - 1)]
    async with db.control() as c:
        await c.execute(
            text(
                "UPDATE control.automation_run SET status = :s, attempts = :a, error = :e, "
                "next_try_at = CASE WHEN CAST(:n AS integer) IS NULL THEN NULL ELSE now() + make_interval(mins => CAST(:n AS integer)) END, "
                "finished_at = CASE WHEN CAST(:s AS text) = 'retrying' THEN NULL ELSE now() END WHERE id = :i"
            ),
            {"s": status, "a": attempts, "e": error, "n": nxt, "i": run_id},
        )
    return status


async def _begin(
    db: Database,
    settings: Settings,
    tenant_id: uuid.UUID,
    a: AutomationDef,
    table: str,
    record_id: uuid.UUID,
    trigger_key: str,
    depth: int,
) -> uuid.UUID | None:
    """Claim the run (at most once) unless the workspace is over its daily limit."""
    async with db.control() as c:
        used = (
            await c.execute(
                text(
                    "SELECT count(*) FROM control.automation_run "
                    "WHERE tenant_id = :t AND created_at > now() - interval '1 day'"
                ),
                {"t": tenant_id},
            )
        ).scalar_one()
        if used >= settings.automation_daily_cap:
            admins = await _admins(c, tenant_id)
            await notifications.notify(
                c,
                _NoMail(),
                tenant_id=tenant_id,
                user_ids=admins,
                kind="automation",
                title="Automations paused for today: this workspace reached its daily limit "
                f"of {settings.automation_daily_cap} runs.",
                source="cap",
                dedupe_key=f"cap:{datetime.now(UTC).date()}",
            )
            return None
        return (
            await c.execute(
                text(
                    "INSERT INTO control.automation_run (id, tenant_id, automation_key, label, table_key, "
                    "record_id, trigger_key, depth, status, next_try_at) "
                    "VALUES (:i, :t, :k, :l, :tb, :r, :tk, :d, 'retrying', now()) "
                    "ON CONFLICT (tenant_id, automation_key, record_id, trigger_key) DO NOTHING RETURNING id"
                ),
                {
                    "i": new_id(),
                    "t": tenant_id,
                    "k": a.key,
                    "l": a.label,
                    "tb": table,
                    "r": record_id,
                    "tk": trigger_key,
                    "d": depth,
                },
            )
        ).scalar_one_or_none()


class _NoMail:
    async def send(self, *, to: str, subject: str, body: str) -> None:
        return None


async def _admins(c: AsyncSession, tenant_id: uuid.UUID) -> list[uuid.UUID]:
    rows = await c.execute(
        text(
            "SELECT DISTINCT u.id FROM control.membership m JOIN control.app_user u ON u.id = m.user_id "
            "JOIN control.tenant_role_grant g ON g.tenant_id = m.tenant_id AND g.role_key = m.role_key "
            "WHERE m.tenant_id = :t AND u.active AND g.permission = '*'"
        ),
        {"t": tenant_id},
    )
    return [r.id for r in rows]


async def fire(
    db: Database,
    mailer: Mailer,
    settings: Settings,
    app: RuntimeApp,
    tenant_id: uuid.UUID,
    a: AutomationDef,
    table: str,
    rec: Any,
    trigger_key: str,
    depth: int,
) -> str | None:
    """Start a run for one record if its conditions hold. Returns the run's status, or None if nothing ran."""
    if not holds(app.table(table), rec.data, a.where):
        return None
    run_id = await _begin(db, settings, tenant_id, a, table, rec.id, trigger_key, depth)
    if run_id is None:
        return None
    return await execute(db, mailer, settings, tenant_id, run_id)


# ---- triggers -------------------------------------------------------------------------------


async def handle_event(
    db: Database, mailer: Mailer, settings: Settings, event: dict[str, Any]
) -> None:
    """A record was saved. Run the automations waiting for that."""
    topic = str(event.get("topic", ""))
    created, updated = topic.endswith(".created"), topic.endswith(".updated")
    if not (created or updated) or int(event.get("depth", 0)) > MAX_DEPTH:
        return
    tenant_id = uuid.UUID(event["tenant_id"])
    table, rid = event["table"], uuid.UUID(event["record_id"])
    async with db.control() as c:
        try:
            app = await live_app(c, tenant_id)
        except NotFound:
            return
    mine = [x for x in app.automations if x.enabled and x.trigger.table == table]
    if not mine:
        return
    rec = await _record(db, tenant_id, table, rid)
    if rec is None:
        return
    depth = int(event.get("depth", 0))
    for a in mine:
        t = a.trigger
        if t.kind == "created" and not created:
            continue
        if t.kind == "updated" and not updated:
            continue
        if t.kind == "changed" and not (
            updated
            and t.field in event.get("changed", [])
            and str(rec.data.get(t.field)) == str(t.value)
        ):
            continue
        if t.kind == "date":
            continue
        try:
            await fire(
                db,
                mailer,
                settings,
                app,
                tenant_id,
                a,
                table,
                rec,
                f"event:{event['event_id']}",
                depth,
            )
        except Exception:
            log.exception("automation %s could not start", a.key)


def _date_sql(field: str) -> str:
    if field in ("created_at", "updated_at"):
        return f"{field}::date"
    return "NULLIF(data ->> :f, '')::date"


async def due_records(
    db: Database, tenant_id: uuid.UUID, a: AutomationDef, today: date, *, window: bool = True
) -> list[Any]:
    """Records whose date trigger has arrived (within the catch-up window) and not yet fired."""
    t = a.trigger
    assert t.field
    lo, hi = date_window(t.days, today)
    expr = _date_sql(t.field)
    params: dict[str, Any] = {"lo": lo, "hi": hi, "n": SCAN_LIMIT}
    if t.field not in ("created_at", "updated_at"):
        params["f"] = t.field
    extra = " AND " + expr + " >= :today" if t.days < 0 else ""
    if t.days < 0:
        params["today"] = today
    async with db.tenant(tenant_id) as s:
        rows = (
            await s.execute(
                text(
                    f'SELECT id, data, version, owner_id, {expr} AS due FROM "{t.table}" '  # noqa: S608 - validated metadata keys
                    f"WHERE {expr} BETWEEN :lo AND :hi{extra} ORDER BY id LIMIT :n"
                ),
                params,
            )
        ).all()
    return list(rows)


async def check_dates(
    db: Database,
    mailer: Mailer,
    settings: Settings,
    tenant_id: uuid.UUID,
    today: date | None = None,
) -> int:
    """The hourly sweep: fire date triggers that have arrived. Safe to run twice."""
    today = today or datetime.now(UTC).date()
    async with db.control() as c:
        try:
            app = await live_app(c, tenant_id)
        except NotFound:
            return 0
    started = 0
    for a in app.automations:
        if not (a.enabled and a.trigger.kind == "date" and a.trigger.field):
            continue
        table = app.table(a.trigger.table)
        for rec in await due_records(db, tenant_id, a, today):
            if not holds(table, rec.data, a.where):
                continue
            key = f"date:{rec.due.isoformat()}"
            try:
                if await fire(db, mailer, settings, app, tenant_id, a, table.key, rec, key, 0):
                    started += 1
            except Exception:
                log.exception("automation %s could not start", a.key)
    return started


async def retry_due(db: Database, mailer: Mailer, settings: Settings) -> int:
    """Pick up runs whose retry time has come."""
    async with db.control() as c:
        rows = (
            await c.execute(
                text(
                    "SELECT id, tenant_id FROM control.automation_run WHERE status = 'retrying' "
                    "AND next_try_at <= now() ORDER BY next_try_at LIMIT 100"
                )
            )
        ).all()
    for r in rows:
        await execute(db, mailer, settings, r.tenant_id, r.id)
    return len(rows)


async def retry_now(
    db: Database, mailer: Mailer, settings: Settings, tenant_id: uuid.UUID, run_id: uuid.UUID
) -> str:
    """The Retry button: a failed run gets three fresh attempts."""
    async with db.control() as c:
        n = (
            await c.execute(
                text(
                    "UPDATE control.automation_run SET status = 'retrying', attempts = 0, error = NULL, "
                    "next_try_at = now(), finished_at = NULL "
                    "WHERE id = :i AND tenant_id = :t AND status = 'failed' RETURNING id"
                ),
                {"i": run_id, "t": tenant_id},
            )
        ).first()
    if not n:
        raise NotFound("That run is not waiting for a retry.")
    return await execute(db, mailer, settings, tenant_id, run_id)


async def tick(
    db: Database, mailer: Mailer, settings: Settings, tenants: list[uuid.UUID]
) -> dict[str, int]:
    """Called every minute: retries now, date triggers and digests when their time has come."""
    out = {"retried": await retry_due(db, mailer, settings), "started": 0, "digests": 0}
    for tenant_id in tenants:
        async with db.control() as c:
            claimed = (
                await c.execute(
                    text(
                        "INSERT INTO control.automation_clock (tenant_id, date_checked_at) VALUES (:t, now()) "
                        "ON CONFLICT (tenant_id) DO UPDATE SET date_checked_at = now() "
                        "WHERE control.automation_clock.date_checked_at < now() - make_interval(mins => CAST(:m AS integer)) "
                        "RETURNING tenant_id"
                    ),
                    {"t": tenant_id, "m": settings.automation_check_minutes},
                )
            ).first()
        if claimed:
            out["started"] += await check_dates(db, mailer, settings, tenant_id)
        async with db.control() as c:
            out["digests"] += await notifications.send_digests(
                c,
                mailer,
                tenant_id=tenant_id,
                secret=settings.signing_key,
                base_url=settings.web_base_url,
                hour_utc=settings.digest_hour_utc,
            )
    return out


__all__ = ["WINDOW_DAYS", "ProblemError"]


async def preview(
    db: Database, tenant_id: uuid.UUID, app: RuntimeApp, a: AutomationDef
) -> dict[str, Any]:
    """How many existing records this would have matched, with a few examples."""
    table = app.table(a.trigger.table)
    t = a.trigger
    today = datetime.now(UTC).date()
    if t.kind == "date" and t.field:
        rows = await due_records(db, tenant_id, a, today)
    else:
        async with db.tenant(tenant_id) as s:
            rows = list(
                (
                    await s.execute(
                        text(
                            f'SELECT id, data FROM "{table.key}" ORDER BY created_at DESC LIMIT :n'  # noqa: S608 - validated metadata key
                        ),
                        {"n": SCAN_LIMIT},
                    )
                ).all()
            )
        if t.kind == "changed" and t.field:
            rows = [r for r in rows if str(r.data.get(t.field)) == str(t.value)]
    hits = [r for r in rows if holds(table, r.data, a.where)]
    return {
        "count": len(hits),
        "examples": [str(r.data.get(table.title_field, "")) for r in hits[:5]],
        "complete": len(rows) < SCAN_LIMIT,
    }


async def recent_runs(
    c: AsyncSession,
    tenant_id: uuid.UUID,
    *,
    automation: str | None = None,
    status: str | None = None,
    limit: int = 30,
) -> list[dict[str, Any]]:
    rows = (
        await c.execute(
            text(
                "SELECT id, automation_key, label, table_key, record_id, status, attempts, error, "
                "outcome, created_at, finished_at FROM control.automation_run "
                "WHERE tenant_id = :t AND (CAST(:k AS text) IS NULL OR automation_key = :k) "
                "AND (CAST(:s AS text) IS NULL OR status = :s) ORDER BY created_at DESC LIMIT :n"
            ),
            {"t": tenant_id, "k": automation, "s": status, "n": min(limit, 200)},
        )
    ).all()
    return [
        {
            "id": str(r.id),
            "automation": r.automation_key,
            "label": r.label,
            "table": r.table_key,
            "record_id": str(r.record_id),
            "status": r.status,
            "attempts": r.attempts,
            "error": r.error,
            "did": [o["text"] for o in r.outcome],
            "at": r.created_at.isoformat(),
        }
        for r in rows
    ]
