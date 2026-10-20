"""import.start, import.resolve_duplicates, import.undo: a spreadsheet into a table, safely.

upload -> profile and suggest a mapping -> validate, clean and find duplicates (the table's rules) ->
resolve duplicates -> load in batches through the command pipeline (background, with progress) ->
reconcile -> undo within 7 days.
"""

import asyncio
import csv
import io
import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tableui.audit.public import write_audit
from tableui.commands.public import BatchOp, CommandContext, apply_batch
from tableui.files.public import FileStore, read_clean
from tableui.imports.domain.clean import clean_cell
from tableui.imports.domain.profile import header_hash, profile_columns, suggest
from tableui.imports.domain.reader import FileUnreadable, read_table
from tableui.metadata.public import (
    RuntimeApp,
    TableDef,
    add_field,
    build_manifest,
    promote_to_live,
    publish_to_test,
    validate_record,
)
from tableui.platform.db import Database
from tableui.platform.errors import NotFound, ProblemError, ValidationFailed
from tableui.rules.public import bulk_outcomes

BATCH = 500
UNDO_DAYS = 7
DUPLICATE_LIST_CAP = 2000
_running = asyncio.Semaphore(2)  # bounded concurrency across workspaces
_tasks: set[asyncio.Task[None]] = set()


class ImportBusy(ProblemError):
    status = 409
    type_slug = "import-busy"
    title = "Another import is running"


_JOB = "SELECT * FROM control.import_job WHERE id = :i AND tenant_id = :t"
_JOB_LOCK = _JOB + " FOR UPDATE"


async def _job(s: AsyncSession, tenant_id: uuid.UUID, job_id: uuid.UUID, lock: bool = False) -> Any:
    row = (
        await s.execute(
            text(_JOB_LOCK if lock else _JOB),
            {"i": job_id, "t": tenant_id},
        )
    ).first()
    if row is None:
        raise NotFound("There is no such import.")
    return row


def _out(row: Any) -> dict[str, Any]:
    undo_until = row.finished_at + timedelta(days=UNDO_DAYS) if row.finished_at else None
    return {
        "id": str(row.id),
        "table": row.table_key,
        "file_id": str(row.file_id),
        "state": row.state,
        "mapping": row.mapping,
        "resolutions": row.resolutions,
        "profile": row.profile,
        "report": row.report,
        "counts": {
            "read": row.rows_read,
            "loaded": row.rows_loaded,
            "updated": row.rows_updated,
            "skipped": row.rows_skipped,
            "failed": row.rows_failed,
        },
        "created_at": row.created_at.isoformat(),
        "started_at": row.started_at.isoformat() if row.started_at else None,
        "finished_at": row.finished_at.isoformat() if row.finished_at else None,
        "undone_at": row.undone_at.isoformat() if row.undone_at else None,
        "can_undo": row.state == "done"
        and undo_until is not None
        and datetime.now(UTC) < undo_until,
    }


async def _read(
    s: AsyncSession, tenant_id: uuid.UUID, file_id: uuid.UUID, store: FileStore
) -> tuple[list[str], list[list[str]]]:
    meta, data = await read_clean(s, tenant_id, file_id, store)
    try:
        return read_table(meta["content_type"], data)
    except FileUnreadable as e:
        raise ValidationFailed(str(e)) from None


async def create(
    s: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    app: RuntimeApp,
    table_key: str,
    file_id: uuid.UUID,
    store: FileStore,
) -> dict[str, Any]:
    """S08: profile every column and suggest a field for it (or reuse the saved mapping)."""
    table = app.table(table_key)
    header, rows = await _read(s, tenant_id, file_id, store)
    profiles = profile_columns(header, rows)
    suggestions = suggest(profiles, table)
    hh = header_hash(header)
    saved = (
        await s.execute(
            text(
                "SELECT mapping FROM control.mapping_profile WHERE tenant_id = :t AND table_key = :k AND header_hash = :h"
            ),
            {"t": tenant_id, "k": table_key, "h": hh},
        )
    ).scalar_one_or_none()
    known = {f.key for f in table.fields}
    mapping = (
        {h: (v if v in known else None) for h, v in saved.items() if h in header}
        if saved
        else {x["header"]: x["field"] for x in suggestions}
    )
    job_id = uuid.uuid4()
    profile = {
        "header": header,
        "rows": len(rows),
        "columns": profiles,
        "suggestions": suggestions,
        "header_hash": hh,
        "reused_mapping": saved is not None,
    }
    await s.execute(
        text(
            "INSERT INTO control.import_job (id, tenant_id, table_key, file_id, mapping, profile, rows_read, created_by) "
            "VALUES (:i, :t, :k, :f, CAST(:m AS jsonb), CAST(:p AS jsonb), :n, :u)"
        ),
        {
            "i": job_id,
            "t": tenant_id,
            "k": table_key,
            "f": file_id,
            "m": json.dumps(mapping),
            "p": json.dumps(profile),
            "n": len(rows),
            "u": user_id,
        },
    )
    return _out(await _job(s, tenant_id, job_id))


async def save_mapping(
    s: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    app: RuntimeApp,
    job_id: uuid.UUID,
    mapping: dict[str, str | None],
) -> dict[str, Any]:
    """Map by hand or skip a column (None). The mapping is remembered for files with the same columns."""
    job = await _job(s, tenant_id, job_id, lock=True)
    if job.state not in ("uploaded", "mapped", "validated"):
        raise ValidationFailed("This import has already started.")
    table = app.table(job.table_key)
    header = job.profile["header"]
    known = {f.key for f in table.fields if not f.hidden}
    errors = [
        {"field": h, "code": "unknown", "message": "is not a column of this file"}
        for h in mapping
        if h not in header
    ]
    errors += [
        {"field": h, "code": "unknown_field", "message": f"'{v}' is not a field"}
        for h, v in mapping.items()
        if v and v not in known
    ]
    used = [v for v in mapping.values() if v]
    errors += [
        {"field": v, "code": "duplicate", "message": "is mapped from two columns"}
        for v in {x for x in used if used.count(x) > 1}
    ]
    if errors:
        raise ValidationFailed(errors=errors)
    full = {h: mapping.get(h) for h in header}
    await s.execute(
        text(
            "UPDATE control.import_job SET mapping = CAST(:m AS jsonb), state = 'mapped', report = '{}'::jsonb WHERE id = :i"
        ),
        {"m": json.dumps(full), "i": job_id},
    )
    await s.execute(
        text(
            "INSERT INTO control.mapping_profile (id, tenant_id, table_key, header_hash, mapping) VALUES (:id, :t, :k, :h, CAST(:m AS jsonb)) "
            "ON CONFLICT (tenant_id, table_key, header_hash) DO UPDATE SET mapping = EXCLUDED.mapping, updated_at = now()"
        ),
        {
            "id": uuid.uuid4(),
            "t": tenant_id,
            "k": job.table_key,
            "h": job.profile["header_hash"],
            "m": json.dumps(full),
        },
    )
    return _out(await _job(s, tenant_id, job_id))


async def _references(
    s: AsyncSession,
    app: RuntimeApp,
    table: TableDef,
    mapping: dict[str, str | None],
    header: list[str],
    rows: list[list[str]],
) -> dict[str, dict[str, str]]:
    """Reference columns may hold names: resolve each name to the id of the record with that title."""
    out: dict[str, dict[str, str]] = {}
    for h, key in mapping.items():
        f = table.field(key) if key else None
        if f is None or f.type != "reference" or not f.ref_table:
            continue
        i = header.index(h)
        names = sorted({r[i].strip().casefold() for r in rows if r[i].strip()})
        target = app.tables.get(f.ref_table)
        title = target.title_field if target else "name"
        found: dict[str, str] = {}
        for j in range(0, len(names), 5000):
            res = await s.execute(
                text(
                    f"SELECT id::text AS id, lower(data->>'{title}') AS n FROM \"{f.ref_table}\" "  # noqa: S608 - identifiers are validated metadata keys
                    f"WHERE lower(data->>'{title}') = ANY(:n) OR id::text = ANY(:n)"
                ),
                {"n": names[j : j + 5000]},
            )
            for r in res:
                found.setdefault(r.n or r.id, r.id)
                found.setdefault(r.id, r.id)
        out[f.key] = found
    return out


def _row_payload(
    table: TableDef,
    mapping: dict[str, str | None],
    header: list[str],
    row: list[str],
    refs: dict[str, dict[str, str]],
) -> tuple[dict[str, Any] | None, list[str]]:
    payload: dict[str, Any] = {}
    reasons: list[str] = []
    for i, h in enumerate(header):
        key = mapping.get(h)
        f = table.field(key) if key else None
        if f is None:
            continue
        value, err = clean_cell(f, row[i])
        if err:
            reasons.append(f"{f.label} {err}")
            continue
        if f.type == "reference" and value:
            rid = refs.get(f.key, {}).get(str(value).casefold())
            if rid is None:
                reasons.append(f"{f.label}: no {f.ref_table} called '{value}'")
                continue
            value = rid
        if value is not None:
            payload[f.key] = value
    if reasons:
        return None, reasons
    clean, errors = validate_record(table, payload, partial=False)
    if errors:
        labels = {f.key: f.label for f in table.fields}
        return None, [f"{labels.get(e['field'], e['field'])} {e['message']}" for e in errors]
    return clean, []


async def _prepare(
    db: Database, tenant_id: uuid.UUID, job: Any, table: TableDef, app: RuntimeApp, store: FileStore
) -> tuple[
    list[str],
    list[list[str]],
    list[dict[str, Any] | None],
    list[list[str]],
    list[list[dict[str, Any]]],
]:
    async with db.control() as s:
        header, rows = await _read(s, tenant_id, job.file_id, store)
    async with db.tenant(tenant_id) as ts:
        refs = await _references(ts, app, table, job.mapping, header, rows)
        prepared = [_row_payload(table, job.mapping, header, r, refs) for r in rows]
        payloads = [p for p, _ in prepared]
        outcomes = await bulk_outcomes(ts, table, app.rules, payloads)
    return header, rows, payloads, [r for _, r in prepared], outcomes


async def validate(
    db: Database, *, tenant_id: uuid.UUID, app: RuntimeApp, job_id: uuid.UUID, store: FileStore
) -> dict[str, Any]:
    """S09: clean every row, count problems by reason, and list duplicates found by the table's rules."""
    async with db.control() as s:
        job = await _job(s, tenant_id, job_id)
    if job.state not in ("uploaded", "mapped", "validated"):
        raise ValidationFailed("This import has already started.")
    if not any(job.mapping.values()):
        raise ValidationFailed("Map at least one column to a field first.")
    table = app.table(job.table_key)
    header, rows, payloads, reasons, outcomes = await _prepare(
        db, tenant_id, job, table, app, store
    )
    by_reason: dict[str, int] = {}
    errors = []
    for n, rs in enumerate(reasons):
        for r in rs:
            key = r.split(" '")[0] if " called '" in r else r
            by_reason[key] = by_reason.get(key, 0) + 1
        if rs:
            errors.append(
                {
                    "row": n + 2,
                    "reason": "; ".join(rs),
                    "raw": dict(zip(header, rows[n], strict=False)),
                }
            )
    duplicates = []
    for n, outs in enumerate(outcomes):
        if not outs or payloads[n] is None:
            continue
        block = any(o["severity"] == "block" for o in outs)
        duplicates.append(
            {
                "row": n + 2,
                "label": payloads[n].get(table.title_field),  # type: ignore[union-attr]
                "severity": "block" if block else "warn",
                "outcomes": [
                    {
                        "check": o["check"],
                        "message": o["message"],
                        "link": {**o["link"], "row": o["link"]["row"] + 2}
                        if o.get("link") and o["link"].get("row") is not None
                        else o.get("link"),
                    }
                    for o in outs
                ],
                "default": "skip" if block else "create",
            }
        )
    valid = sum(1 for p in payloads if p is not None)
    report = {
        "rows": len(rows),
        "valid": valid,
        "invalid": len(rows) - valid,
        "by_reason": dict(sorted(by_reason.items(), key=lambda kv: -kv[1])),
        "duplicates_total": len(duplicates),
        "duplicates_blocking": sum(1 for d in duplicates if d["severity"] == "block"),
        "duplicates": duplicates[:DUPLICATE_LIST_CAP],
    }
    async with db.control() as s:
        await s.execute(
            text("DELETE FROM control.import_row_error WHERE job_id = :j"), {"j": job_id}
        )
        for i in range(0, len(errors), 1000):
            await s.execute(
                text(
                    "INSERT INTO control.import_row_error (job_id, row_number, reason, raw) VALUES (:j, :n, :r, CAST(:w AS jsonb))"
                ),
                [
                    {"j": job_id, "n": e["row"], "r": e["reason"], "w": json.dumps(e["raw"])}
                    for e in errors[i : i + 1000]
                ],
            )
        await s.execute(
            text(
                "UPDATE control.import_job SET state = 'validated', report = CAST(:r AS jsonb), rows_read = :n WHERE id = :j"
            ),
            {"r": json.dumps(report), "n": len(rows), "j": job_id},
        )
        return _out(await _job(s, tenant_id, job_id))


async def resolve(
    s: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    job_id: uuid.UUID,
    rows: dict[str, dict[str, Any]],
    request_id: str | None,
) -> dict[str, Any]:
    """import.resolve_duplicates: per row skip, update the existing record, or create anyway with a reason."""
    job = await _job(s, tenant_id, job_id, lock=True)
    if job.state != "validated":
        raise ValidationFailed("Check the file before resolving duplicates.")
    dups = {str(d["row"]): d for d in job.report.get("duplicates", [])}
    errors = []
    clean: dict[str, dict[str, Any]] = dict(job.resolutions or {})
    for row, r in rows.items():
        d = dups.get(str(row))
        action = r.get("action")
        if d is None:
            errors.append(
                {"field": f"rows.{row}", "code": "unknown", "message": "is not a duplicate row"}
            )
        elif action not in ("skip", "update", "create"):
            errors.append(
                {
                    "field": f"rows.{row}.action",
                    "code": "invalid",
                    "message": "must be skip, update or create",
                }
            )
        elif action == "update" and not any(
            o.get("link") and o["link"].get("id") for o in d["outcomes"]
        ):
            errors.append(
                {
                    "field": f"rows.{row}.action",
                    "code": "invalid",
                    "message": "matches only another row of the file, so there is nothing to update",
                }
            )
        elif (
            action == "create"
            and d["severity"] == "block"
            and not str(r.get("reason") or "").strip()
        ):
            errors.append(
                {
                    "field": f"rows.{row}.reason",
                    "code": "required",
                    "message": "is needed to create a record that matches an existing one",
                }
            )
        else:
            clean[str(row)] = {
                "action": action,
                "reason": str(r.get("reason") or "").strip() or None,
            }
    if errors:
        raise ValidationFailed(errors=errors)
    await s.execute(
        text("UPDATE control.import_job SET resolutions = CAST(:r AS jsonb) WHERE id = :j"),
        {"r": json.dumps(clean), "j": job_id},
    )
    await write_audit(
        s,
        tenant_id=tenant_id,
        scope="tenant",
        actor_id=user_id,
        action="import.resolve_duplicates",
        subject_type="import",
        subject_id=str(job_id),
        detail={"rows": len(rows)},
        request_id=request_id,
    )
    return _out(await _job(s, tenant_id, job_id))


async def start(
    db: Database, ctx: CommandContext, *, job_id: uuid.UUID, store: FileStore
) -> dict[str, Any]:
    """import.start: load in the background. One import at a time per workspace."""
    tenant_id = ctx.principal.tenant_id
    assert tenant_id is not None
    async with db.control() as s:
        await s.execute(
            text("SELECT id FROM control.tenant WHERE id = :t FOR UPDATE"), {"t": tenant_id}
        )
        busy = (
            await s.execute(
                text(
                    "SELECT 1 FROM control.import_job WHERE tenant_id = :t AND state = 'loading' AND id <> :j"
                ),
                {"t": tenant_id, "j": job_id},
            )
        ).first()
        if busy:
            raise ImportBusy(
                "Another import is loading in this workspace. Try again when it finishes."
            )
        job = await _job(s, tenant_id, job_id, lock=True)
        if job.state != "validated":
            raise ValidationFailed("Check the file before loading it.")
        await s.execute(
            text(
                "UPDATE control.import_job SET state = 'loading', started_at = now(), rows_loaded = 0, rows_updated = 0, rows_skipped = 0, rows_failed = 0 WHERE id = :j"
            ),
            {"j": job_id},
        )
        await write_audit(
            s,
            tenant_id=tenant_id,
            scope="tenant",
            actor_id=ctx.principal.user_id,
            action="import.start",
            subject_type="import",
            subject_id=str(job_id),
            detail={"rows": job.rows_read, "table": job.table_key},
            request_id=ctx.request_id,
        )
    task = asyncio.create_task(_load(db, ctx, job_id, store))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    async with db.control() as s:
        return _out(await _job(s, tenant_id, job_id))


async def wait_all() -> None:
    """For tests and shutdown: let running loads finish."""
    while _tasks:
        await asyncio.gather(*list(_tasks), return_exceptions=True)


async def _load(db: Database, ctx: CommandContext, job_id: uuid.UUID, store: FileStore) -> None:
    tenant_id = ctx.principal.tenant_id
    assert tenant_id is not None
    async with _running:
        try:
            async with db.control() as s:
                job = await _job(s, tenant_id, job_id)
            table = ctx.app.table(job.table_key)
            header, rows, payloads, reasons, outcomes = await _prepare(
                db, tenant_id, job, table, ctx.app, store
            )
            res = job.resolutions or {}
            ops: list[BatchOp] = []
            skipped = 0
            failed = sum(1 for p in payloads if p is None)
            for n, p in enumerate(payloads):
                if p is None:
                    continue
                outs = outcomes[n]
                blocks = [o for o in outs if o["severity"] == "block"]
                choice = res.get(str(n + 2), {}).get("action") or ("skip" if blocks else "create")
                if choice == "skip":
                    skipped += 1
                    continue
                if choice == "update":
                    target = next(
                        (o["link"]["id"] for o in outs if o.get("link") and o["link"].get("id")),
                        None,
                    )
                    ops.append(
                        BatchOp("update", p, uuid.UUID(target), tag=n + 2)
                        if target
                        else BatchOp("create", p, tag=n + 2)
                    )
                    continue
                ops.append(
                    BatchOp(
                        "create",
                        p,
                        overrides=frozenset(o["check"] for o in blocks),
                        reason=res.get(str(n + 2), {}).get("reason"),
                        tag=n + 2,
                    )
                )
            async with db.control() as s:
                await s.execute(
                    text(
                        "UPDATE control.import_job SET rows_skipped = :k, rows_failed = :f WHERE id = :j"
                    ),
                    {"k": skipped, "f": failed, "j": job_id},
                )
            for i in range(0, len(ops), BATCH):
                chunk = ops[i : i + BATCH]
                results = await apply_batch(db, ctx, table.key, chunk, audit_action="import.load")
                created = [r for r in results if r.ok and r.op.kind == "create"]
                updated = [r for r in results if r.ok and r.op.kind == "update"]
                bad = [r for r in results if not r.ok]
                async with db.control() as s:
                    if created or updated:
                        await s.execute(
                            text(
                                "INSERT INTO control.import_change (job_id, record_id, action, before) VALUES (:j, :r, :a, CAST(:b AS jsonb))"
                            ),
                            [
                                {
                                    "j": job_id,
                                    "r": r.record_id,
                                    "a": r.op.kind,
                                    "b": json.dumps(r.before) if r.before is not None else None,
                                }
                                for r in created + updated
                            ],
                        )
                    if bad:
                        await s.execute(
                            text(
                                "INSERT INTO control.import_row_error (job_id, row_number, reason, raw) VALUES (:j, :n, :r, CAST(:w AS jsonb))"
                            ),
                            [
                                {
                                    "j": job_id,
                                    "n": r.op.tag,
                                    "r": r.error,
                                    "w": json.dumps(
                                        dict(zip(header, rows[r.op.tag - 2], strict=False))
                                    ),
                                }
                                for r in bad
                            ],
                        )
                    await s.execute(
                        text(
                            "UPDATE control.import_job SET rows_loaded = rows_loaded + :c, rows_updated = rows_updated + :u, rows_failed = rows_failed + :f WHERE id = :j"
                        ),
                        {"c": len(created), "u": len(updated), "f": len(bad), "j": job_id},
                    )
            async with db.control() as s:
                await s.execute(
                    text(
                        "UPDATE control.import_job SET state = 'done', finished_at = now() WHERE id = :j"
                    ),
                    {"j": job_id},
                )
        except Exception as e:  # the job records the failure; nothing half-applied is hidden
            async with db.control() as s:
                await s.execute(
                    text(
                        "UPDATE control.import_job SET state = 'failed', finished_at = now(), report = report || CAST(:r AS jsonb) WHERE id = :j"
                    ),
                    {"r": json.dumps({"failure": str(e)[:500]}), "j": job_id},
                )


async def undo(db: Database, ctx: CommandContext, *, job_id: uuid.UUID) -> dict[str, Any]:
    """import.undo: remove exactly the records the import created; put back what it updated."""
    tenant_id = ctx.principal.tenant_id
    assert tenant_id is not None
    async with db.control() as s:
        job = await _job(s, tenant_id, job_id, lock=True)
        if not _out(job)["can_undo"]:
            raise ValidationFailed(
                f"Only a finished import from the last {UNDO_DAYS} days can be undone."
            )
        changes = (
            await s.execute(
                text(
                    "SELECT record_id, action, before FROM control.import_change WHERE job_id = :j ORDER BY id DESC"
                ),
                {"j": job_id},
            )
        ).all()
    ops = [
        BatchOp("delete", record_id=c.record_id)
        if c.action == "create"
        else BatchOp("replace", c.before or {}, c.record_id)
        for c in changes
    ]
    failed = 0
    for i in range(0, len(ops), BATCH):
        results = await apply_batch(
            db, ctx, job.table_key, ops[i : i + BATCH], audit_action="import.undo"
        )
        failed += sum(1 for r in results if not r.ok and r.code != "gone")
    async with db.control() as s:
        await s.execute(
            text(
                "UPDATE control.import_job SET state = 'undone', undone_at = now(), report = report || CAST(:r AS jsonb) WHERE id = :j"
            ),
            {"r": json.dumps({"undo": {"changes": len(ops), "failed": failed}}), "j": job_id},
        )
        await write_audit(
            s,
            tenant_id=tenant_id,
            scope="tenant",
            actor_id=ctx.principal.user_id,
            action="import.undo",
            subject_type="import",
            subject_id=str(job_id),
            detail={"changes": len(ops), "failed": failed},
            request_id=ctx.request_id,
        )
        return _out(await _job(s, tenant_id, job_id))


async def get(s: AsyncSession, tenant_id: uuid.UUID, job_id: uuid.UUID) -> dict[str, Any]:
    return _out(await _job(s, tenant_id, job_id))


async def history(s: AsyncSession, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
    rows = await s.execute(
        text(
            "SELECT j.*, f.name AS file_name, u.full_name AS by_name FROM control.import_job j "
            "JOIN control.file f ON f.id = j.file_id JOIN control.app_user u ON u.id = j.created_by "
            "WHERE j.tenant_id = :t ORDER BY j.created_at DESC LIMIT 100"
        ),
        {"t": tenant_id},
    )
    out = []
    for r in rows:
        d = _out(r)
        d.pop("profile")
        d.pop("report")
        d.pop("mapping")
        out.append({**d, "file_name": r.file_name, "by": r.by_name})
    return out


async def error_file(s: AsyncSession, tenant_id: uuid.UUID, job_id: uuid.UUID) -> str:
    """The rows that were not loaded, as they were in the file, with a Reason column."""
    job = await _job(s, tenant_id, job_id)
    header: list[str] = job.profile.get("header", [])
    rows = await s.execute(
        text(
            "SELECT row_number, reason, raw FROM control.import_row_error WHERE job_id = :j ORDER BY row_number"
        ),
        {"j": job_id},
    )
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Row", *header, "Reason"])
    for r in rows:
        w.writerow([r.row_number, *[(r.raw or {}).get(h, "") for h in header], r.reason])
    return buf.getvalue()


async def add_field_for_column(
    db: Database,
    *,
    principal: Any,
    job_id: uuid.UUID,
    header: str,
    label: str,
    ftype: str,
    options: list[str],
    request_id: str | None,
) -> dict[str, Any]:
    """S08: a column with no good match becomes a new workspace field. Owners publish it at once
    (the Draft goes Live, so other unpublished Studio changes go with it); others wait for an owner."""
    tenant_id = principal.tenant_id
    async with db.control() as s:
        job = await _job(s, tenant_id, job_id, lock=True)
        if job.state not in ("uploaded", "mapped", "validated"):
            raise ValidationFailed("This import has already started.")
        if header not in job.profile["header"]:
            raise ValidationFailed(
                errors=[
                    {
                        "field": "header",
                        "code": "unknown",
                        "message": "is not a column of this file",
                    }
                ]
            )
        f = await add_field(
            s, tenant_id=tenant_id, user_id=principal.user_id, table_key=job.table_key,
            body={"label": label, "type": ftype, "options": options}, request_id=request_id,
        )  # fmt: skip
    live = False
    if "*" in principal.permissions:
        async with db.tenant(tenant_id) as ts:
            manifest = await build_manifest(ts)
        async with db.control() as s:
            rel = await publish_to_test(
                s,
                tenant_id=tenant_id,
                user_id=principal.user_id,
                manifest=manifest,
                request_id=request_id,
            )
            await promote_to_live(
                s,
                tenant_id=tenant_id,
                user_id=principal.user_id,
                version=rel["version"],
                request_id=request_id,
            )
        live = True
    async with db.control() as s:
        mapping = {**job.mapping, header: f["key"] if live else None}
        await s.execute(
            text(
                "UPDATE control.import_job SET mapping = CAST(:m AS jsonb), state = 'mapped' WHERE id = :j"
            ),
            {"m": json.dumps(mapping), "j": job_id},
        )
        out = _out(await _job(s, tenant_id, job_id))
    return {"field": f, "live": live, "job": out}
