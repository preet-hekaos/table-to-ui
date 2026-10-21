# ruff: noqa: S608 - table and schema names are workspace metadata keys validated at creation, never user text
"""The service owner's view of client workspaces: create, suspend, export, limit, delete.

Counts and settings only. The console never returns record contents; an export is data leaving for the
client owner's email, requested by the operator with a reason.
"""

import asyncio
import csv
import io
import json
import time
import uuid
import zipfile
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from tableui.audit.public import write_audit
from tableui.files.public import FileStore
from tableui.identity.public import Principal
from tableui.insights.public import purge_tenant as purge_analytics
from tableui.platform.config import Settings
from tableui.platform.db import Database
from tableui.platform.errors import NotFound, ValidationFailed
from tableui.platform.ids import new_id, schema_name
from tableui.platform.mail import Mailer
from tableui.platform.security import new_token, token_hash
from tableui.workspace.public import BLANK, install_pack

GRACE_DAYS = 7
EXPORT_HOURS = 24
Provision = Callable[..., Awaitable[Any]]


def _need(value: str, field: str, message: str) -> str:
    v = (value or "").strip()
    if not v:
        raise ValidationFailed(errors=[{"field": field, "code": "required", "message": message}])
    return v


async def _tenant(s: AsyncSession, tenant_id: uuid.UUID) -> Any:
    row = (
        await s.execute(
            text(
                "SELECT id, name, schema_name, status, delete_after FROM control.tenant WHERE id = :t FOR UPDATE"
            ),  # fmt: skip
            {"t": tenant_id},
        )
    ).first()
    if row is None:
        raise NotFound("There is no such workspace.")
    return row


async def _audit(s: AsyncSession, op: Principal, tenant_id: uuid.UUID | None, action: str, detail: dict[str, Any], request_id: str | None) -> None:  # fmt: skip
    await write_audit(
        s, tenant_id=tenant_id, scope="platform", actor_id=op.user_id, action=action,
        subject_type="tenant", subject_id=str(tenant_id) if tenant_id else None, detail=detail, request_id=request_id,
    )  # fmt: skip


async def _enter(s: AsyncSession, tenant_id: uuid.UUID) -> str:
    schema = schema_name(tenant_id)
    await s.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": str(tenant_id)})
    await s.execute(text(f'SET LOCAL search_path TO "{schema}", public, pg_catalog'))
    return schema


async def _table_keys(s: AsyncSession) -> list[str]:
    rows = await s.execute(text("SELECT key FROM metadata_object WHERE kind = 'table' ORDER BY key"))  # fmt: skip
    return [r.key for r in rows]


_COUNT_SQL = (
    "SELECT COALESCE(sum((xpath('/row/c/text()', query_to_xml("
    "format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint), 0) "
    "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
    "WHERE n.nspname = :schema AND c.relkind = 'r' AND EXISTS ("
    "SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'search_doc' AND NOT a.attisdropped)"
)


COUNT_TTL_SECONDS = 30.0
# Counting every table of a workspace costs about 4 ms of database time, so the console reuses a count for
# half a minute. Limits and exports count exactly; only this overview figure can trail a write.
_counts: dict[uuid.UUID, tuple[float, int]] = {}


async def _count_for(db: Database, sem: asyncio.Semaphore, tenant_id: uuid.UUID) -> None:
    async with sem:
        try:
            async with db.control() as s:
                await s.execute(
                    text("SELECT set_config('app.tenant_id', :t, true)"), {"t": str(tenant_id)}
                )
                n = int(
                    (
                        await s.execute(text(_COUNT_SQL), {"schema": schema_name(tenant_id)})
                    ).scalar_one()
                )
        except DBAPIError:
            n = 0
    _counts[tenant_id] = (time.monotonic(), n)


async def _record_counts(db: Database, ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    now = time.monotonic()
    stale = [t for t in ids if t not in _counts or now - _counts[t][0] > COUNT_TTL_SECONDS]
    sem = asyncio.Semaphore(8)
    await asyncio.gather(*[_count_for(db, sem, t) for t in stale])
    return {t: _counts[t][1] for t in ids}


# ---- the list ----------------------------------------------------------------------------------------


async def directory(db: Database) -> list[dict[str, Any]]:
    async with db.control() as s:
        # The planner prices the per-workspace subqueries high enough to trigger JIT compilation, which costs
        # far more than the query itself.
        await s.execute(text("SET LOCAL jit = off"))
        rows = (
            await s.execute(
                text(
                    "SELECT t.id, t.name, t.pack_id, t.status, t.status_reason, t.delete_after, t.created_at, "
                    "(SELECT count(*) FROM control.membership m JOIN control.app_user u ON u.id = m.user_id WHERE m.tenant_id = t.id AND u.active) AS people, "
                    "(SELECT COALESCE(sum(size_bytes), 0) FROM control.file f WHERE f.tenant_id = t.id) AS storage_bytes, "
                    "(SELECT max(at) FROM control.audit_event a WHERE a.tenant_id = t.id) AS last_activity, "
                    "(SELECT u.email FROM control.membership m JOIN control.app_user u ON u.id = m.user_id "
                    "   WHERE m.tenant_id = t.id AND m.role_key = 'admin' AND u.active ORDER BY u.created_at LIMIT 1) AS owner_email, "
                    "(SELECT i.email FROM control.invitation i WHERE i.tenant_id = t.id AND i.role_key = 'admin' AND i.accepted_at IS NULL ORDER BY i.created_at LIMIT 1) AS invited_email, "
                    "l.max_people, l.max_records, l.max_storage_mb, a.monthly_token_cap, "
                    "(SELECT COALESCE(sum(tokens_in + tokens_out), 0) FROM control.ai_call c WHERE c.tenant_id = t.id "
                    "   AND c.created_at >= date_trunc('month', now())) AS ai_tokens "
                    "FROM control.tenant t LEFT JOIN control.tenant_limit l ON l.tenant_id = t.id "
                    "LEFT JOIN control.ai_setting a ON a.tenant_id = t.id ORDER BY t.created_at DESC"
                )
            )
        ).all()
    counts = await _record_counts(db, [r.id for r in rows if r.status != "provisioning"])
    out = []
    for r in rows:
        records = 0 if r.status == "provisioning" else counts.get(r.id, 0)
        out.append({
            "id": str(r.id), "name": r.name, "pack": r.pack_id, "status": r.status,
            "reason": r.status_reason, "delete_after": r.delete_after.isoformat() if r.delete_after else None,
            "created_at": r.created_at.isoformat(), "owner_email": r.owner_email or r.invited_email, "people": r.people, "records": records,
            "storage_mb": round(r.storage_bytes / 1_048_576, 2),
            "last_activity": r.last_activity.isoformat() if r.last_activity else None,
            "limits": {"max_people": r.max_people, "max_records": r.max_records, "max_storage_mb": r.max_storage_mb, "ai_monthly_tokens": r.monthly_token_cap},  # fmt: skip
            "ai_tokens_this_month": int(r.ai_tokens),
        })  # fmt: skip
    return out


# ---- create ------------------------------------------------------------------------------------------


async def create_workspace(
    db: Database, *, op: Principal, name: str, owner_email: str, pack_id: str | None, catalog: Any,
    org: Any, provision: Provision, mailer: Mailer, settings: Settings, request_id: str | None,
) -> dict[str, Any]:  # fmt: skip
    name = _need(name, "name", "Give the workspace a name.")
    email = _need(owner_email, "owner_email", "Enter the client owner's email.").lower()
    if "@" not in email:
        raise ValidationFailed(errors=[{"field": "owner_email", "code": "invalid", "message": "must be a valid email address"}])  # fmt: skip
    if pack_id and pack_id != BLANK:
        catalog.get(pack_id)  # unknown pack fails before anything is created
    async with db.control() as s:
        taken = (await s.execute(text("SELECT 1 FROM control.app_user WHERE realm = 'tenant' AND email = :e"), {"e": email})).first()  # fmt: skip
        if taken:
            raise ValidationFailed(errors=[{"field": "owner_email", "code": "taken", "message": "already has an account in another workspace"}])  # fmt: skip
    org_id = await org.create(name)
    token = new_token()
    try:
        async with db.control() as s:
            tenant = await provision(s, name=name, workos_org_id=org_id)
            await s.execute(text("INSERT INTO control.tenant_role (tenant_id, key, name, description) VALUES (:t, 'admin', 'Administrator', 'Full access to everything in the workspace.')"), {"t": tenant.id})  # fmt: skip
            await s.execute(text("INSERT INTO control.tenant_role_grant (tenant_id, role_key, permission) VALUES (:t, 'admin', '*')"), {"t": tenant.id})  # fmt: skip
            await s.execute(
                text(
                    "INSERT INTO control.invitation (id, tenant_id, email, role_key, token_hash, expires_at, created_by) VALUES (:i, :t, :e, 'admin', :h, :x, :u)"
                ),  # fmt: skip
                {
                    "i": new_id(),
                    "t": tenant.id,
                    "e": email,
                    "h": token_hash(token),
                    "x": datetime.now(UTC) + timedelta(days=settings.invitation_ttl_days),
                    "u": op.user_id,
                },  # fmt: skip
            )
            await _audit(s, op, tenant.id, "operator.workspace.create", {"name": name, "owner_email": email, "pack": pack_id}, request_id)  # fmt: skip
    except BaseException:
        await org.delete(org_id)
        raise
    if pack_id:
        await install_pack(db, catalog, tenant_id=tenant.id, user_id=op.user_id, pack_id=pack_id, request_id=request_id)  # fmt: skip
    link = f"{settings.web_base_url}/accept-invitation?token={token}"
    await mailer.send(
        to=email,
        subject=f"Your {name} workspace is ready",
        body=f"Your workspace {name} has been set up for you.\n\nCreate your sign-in (valid for {settings.invitation_ttl_days} days):\n{link}\n",  # fmt: skip
    )
    out: dict[str, Any] = {
        "id": str(tenant.id),
        "name": name,
        "owner_email": email,
        "pack": pack_id,
    }
    if settings.environment in ("local", "test"):
        out["invite_link"] = link
    return out


# ---- suspend, resume, delete -------------------------------------------------------------------------


async def suspend(db: Database, *, op: Principal, tenant_id: uuid.UUID, reason: str, request_id: str | None) -> dict[str, Any]:  # fmt: skip
    why = _need(reason, "reason", "Say why.")
    async with db.control() as s:
        t = await _tenant(s, tenant_id)
        if t.status != "active":
            raise ValidationFailed(f"This workspace is {t.status.replace('_', ' ')}, so it cannot be suspended.")  # fmt: skip
        await s.execute(text("UPDATE control.tenant SET status = 'suspended', status_reason = :r, status_changed_at = now() WHERE id = :t"), {"r": why, "t": tenant_id})  # fmt: skip
        await _audit(s, op, tenant_id, "operator.workspace.suspend", {"reason": why}, request_id)
    return {"id": str(tenant_id), "status": "suspended"}


async def resume(db: Database, *, op: Principal, tenant_id: uuid.UUID, request_id: str | None) -> dict[str, Any]:  # fmt: skip
    async with db.control() as s:
        t = await _tenant(s, tenant_id)
        if t.status != "suspended":
            raise ValidationFailed("Only a suspended workspace can be resumed. Cancel the deletion first if one is scheduled.")  # fmt: skip
        await s.execute(text("UPDATE control.tenant SET status = 'active', status_reason = NULL, status_changed_at = now() WHERE id = :t"), {"t": tenant_id})  # fmt: skip
        await _audit(s, op, tenant_id, "operator.workspace.resume", {}, request_id)
    return {"id": str(tenant_id), "status": "active"}


async def schedule_deletion(db: Database, *, op: Principal, tenant_id: uuid.UUID, confirm_name: str, reason: str, grace_days: int, request_id: str | None) -> dict[str, Any]:  # fmt: skip
    why = _need(reason, "reason", "Say why.")
    if not 0 <= grace_days <= 90:
        raise ValidationFailed(errors=[{"field": "grace_days", "code": "range", "message": "must be between 0 and 90"}])  # fmt: skip
    async with db.control() as s:
        t = await _tenant(s, tenant_id)
        if t.status != "suspended":
            raise ValidationFailed("Suspend the workspace first. Deletion is a second, separate step.")  # fmt: skip
        if confirm_name != t.name:
            raise ValidationFailed(errors=[{"field": "confirm_name", "code": "mismatch", "message": "type the workspace name exactly"}])  # fmt: skip
        after = datetime.now(UTC) + timedelta(days=grace_days)
        await s.execute(text("UPDATE control.tenant SET status = 'scheduled_deletion', status_reason = :r, delete_after = :a, status_changed_at = now() WHERE id = :t"), {"r": why, "a": after, "t": tenant_id})  # fmt: skip
        await _audit(s, op, tenant_id, "operator.workspace.schedule_deletion", {"reason": why, "delete_after": after.isoformat()}, request_id)  # fmt: skip
    return {"id": str(tenant_id), "status": "scheduled_deletion", "delete_after": after.isoformat()}


async def cancel_deletion(db: Database, *, op: Principal, tenant_id: uuid.UUID, request_id: str | None) -> dict[str, Any]:  # fmt: skip
    async with db.control() as s:
        t = await _tenant(s, tenant_id)
        if t.status != "scheduled_deletion":
            raise ValidationFailed("No deletion is scheduled for this workspace.")
        await s.execute(text("UPDATE control.tenant SET status = 'suspended', delete_after = NULL, status_changed_at = now() WHERE id = :t"), {"t": tenant_id})  # fmt: skip
        await _audit(s, op, tenant_id, "operator.workspace.cancel_deletion", {}, request_id)
    return {"id": str(tenant_id), "status": "suspended"}


async def _fk_columns(s: AsyncSession, referenced: str) -> list[tuple[str, str]]:
    rows = await s.execute(
        text(
            "SELECT cl.relname AS tbl, a.attname AS col FROM pg_constraint c "
            "JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_namespace n ON n.oid = cl.relnamespace "
            "JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey) "
            "WHERE c.contype = 'f' AND n.nspname = 'control' AND c.confrelid = CAST(:r AS regclass)"
        ),
        {"r": f"control.{referenced}"},
    )
    return [(r.tbl, r.col) for r in rows]


async def _delete_until_done(s: AsyncSession, jobs: list[tuple[str, str, Any]]) -> None:
    """DELETE FROM control.<table> WHERE <col> = ANY(:v), retrying later what a foreign key still holds."""
    pending = list(jobs)
    while pending:
        left: list[tuple[str, str, Any]] = []
        for table, col, val in pending:
            try:
                async with s.begin_nested():
                    await s.execute(
                        text(f'DELETE FROM control."{table}" WHERE "{col}" = ANY(:v)'), {"v": val}
                    )
            except DBAPIError:
                left.append((table, col, val))
        if len(left) == len(pending):
            raise RuntimeError(f"could not remove rows from {left[0][0]}")
        pending = left


async def purge_tenant(db: Database, analytics: Database, store: FileStore, *, tenant_id: uuid.UUID, actor: uuid.UUID | None, request_id: str | None) -> None:  # fmt: skip
    """Remove a workspace and everything that belongs to it. Only ever runs for a workspace scheduled for deletion."""
    _counts.pop(tenant_id, None)
    async with db.control() as s:
        t = await _tenant(s, tenant_id)
        if t.status != "scheduled_deletion":
            raise ValidationFailed("This workspace is not scheduled for deletion.")
        keys = [r.storage_key for r in await s.execute(text("SELECT storage_key FROM control.file WHERE tenant_id = :t UNION SELECT storage_key FROM control.export_job WHERE tenant_id = :t"), {"t": tenant_id})]  # fmt: skip
        users = [r.user_id for r in await s.execute(text("SELECT user_id FROM control.membership WHERE tenant_id = :t"), {"t": tenant_id})]  # fmt: skip
        owned = [str(r.email) for r in await s.execute(text("SELECT email FROM control.app_user WHERE id = ANY(:u)"), {"u": users})]  # fmt: skip
        await s.execute(text(f'DROP SCHEMA IF EXISTS "{t.schema_name}" CASCADE'))
        await s.execute(text("DELETE FROM control.team_member WHERE team_id IN (SELECT id FROM control.team WHERE tenant_id = :t)"), {"t": tenant_id})  # fmt: skip
        by_tenant = [r.table_name for r in await s.execute(text("SELECT table_name FROM information_schema.columns WHERE table_schema = 'control' AND column_name = 'tenant_id' AND table_name <> 'tenant'"))]  # fmt: skip
        await _delete_until_done(s, [(tbl, "tenant_id", [tenant_id]) for tbl in by_tenant])
        user_cols = await _fk_columns(s, "app_user")
        await _delete_until_done(s, [(tbl, col, users) for tbl, col in user_cols if tbl != "membership"] + [("app_user", "id", users)])  # fmt: skip
        if owned:
            await s.execute(text("DELETE FROM control.login_attempt WHERE realm = 'tenant' AND email = ANY(:e)"), {"e": owned})  # fmt: skip
        await s.execute(text("DELETE FROM control.tenant WHERE id = :t"), {"t": tenant_id})
        await write_audit(
            s, tenant_id=None, scope="platform", actor_id=actor, action="operator.workspace.purge",
            subject_type="tenant", subject_id=str(tenant_id),
            detail={"name": t.name, "people_removed": len(users), "files_removed": len(keys)}, request_id=request_id,
        )  # fmt: skip
    await purge_analytics(analytics, tenant_id)
    for k in keys:
        await store.delete(k)


async def purge_due(db: Database, analytics: Database, store: FileStore, request_id: str | None = None) -> list[str]:  # fmt: skip
    async with db.control() as s:
        due = [r.id for r in await s.execute(text("SELECT id FROM control.tenant WHERE status = 'scheduled_deletion' AND delete_after <= now()"))]  # fmt: skip
    for tid in due:
        await purge_tenant(db, analytics, store, tenant_id=tid, actor=None, request_id=request_id)
    return [str(t) for t in due]


# ---- limits ------------------------------------------------------------------------------------------


async def set_limits(db: Database, *, op: Principal, tenant_id: uuid.UUID, body: dict[str, Any], request_id: str | None) -> dict[str, Any]:  # fmt: skip
    keys = {"max_people", "max_records", "max_storage_mb", "ai_monthly_tokens"}
    extra = sorted(set(body) - keys)
    if extra:
        raise ValidationFailed(errors=[{"field": extra[0], "code": "unknown", "message": "is not a limit"}])  # fmt: skip
    for k, v in body.items():
        if v is not None and (not isinstance(v, int) or isinstance(v, bool) or v < 0 or (k == "max_people" and v < 1)):  # fmt: skip
            raise ValidationFailed(errors=[{"field": k, "code": "range", "message": "must be a whole number, or empty for no limit"}])  # fmt: skip
    async with db.control() as s:
        await _tenant(s, tenant_id)
        cur = (await s.execute(text("SELECT max_people, max_records, max_storage_mb FROM control.tenant_limit WHERE tenant_id = :t"), {"t": tenant_id})).first()  # fmt: skip
        new = {k: (body[k] if k in body else (getattr(cur, k) if cur else None)) for k in ("max_people", "max_records", "max_storage_mb")}  # fmt: skip
        await s.execute(
            text("INSERT INTO control.tenant_limit (tenant_id, max_people, max_records, max_storage_mb, updated_by) VALUES (:t, :p, :r, :m, :u) "
                 "ON CONFLICT (tenant_id) DO UPDATE SET max_people = EXCLUDED.max_people, max_records = EXCLUDED.max_records, "
                 "max_storage_mb = EXCLUDED.max_storage_mb, updated_by = EXCLUDED.updated_by, updated_at = now()"),
            {"t": tenant_id, "p": new["max_people"], "r": new["max_records"], "m": new["max_storage_mb"], "u": op.user_id},
        )  # fmt: skip
        if body.get("ai_monthly_tokens") is not None:
            await s.execute(
                text("INSERT INTO control.ai_setting (tenant_id, monthly_token_cap, updated_by) VALUES (:t, :c, :u) "
                     "ON CONFLICT (tenant_id) DO UPDATE SET monthly_token_cap = EXCLUDED.monthly_token_cap, updated_by = EXCLUDED.updated_by, updated_at = now()"),
                {"t": tenant_id, "c": body["ai_monthly_tokens"], "u": op.user_id},
            )  # fmt: skip
        await _audit(s, op, tenant_id, "operator.workspace.limits", body, request_id)
    return {"id": str(tenant_id), **new, "ai_monthly_tokens": body.get("ai_monthly_tokens")}


# ---- export ------------------------------------------------------------------------------------------


def _cell(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, (list, dict)):
        return json.dumps(v, ensure_ascii=False)
    return str(v)


async def build_export(db: Database, store: FileStore, tenant_id: uuid.UUID) -> bytes:
    buf = io.BytesIO()
    async with db.control() as s:
        schema = await _enter(s, tenant_id)
        definitions = [{"kind": r.kind, "key": r.key, "source": r.source, "definition": r.definition} for r in await s.execute(text("SELECT kind, key, source, definition FROM metadata_object ORDER BY kind, key"))]  # fmt: skip
        files = [(r.name, r.storage_key) for r in await s.execute(text("SELECT name, storage_key FROM control.file WHERE tenant_id = :t AND scan_status = 'clean'"), {"t": tenant_id})]  # fmt: skip
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr(
                "app-definition.json",
                json.dumps(definitions, indent=2, ensure_ascii=False, default=str),
            )
            for d in definitions:
                if d["kind"] != "table":
                    continue
                fields = [f["key"] for f in d["definition"].get("fields", [])]
                out = io.StringIO()
                w = csv.writer(out)
                w.writerow(["id", *fields, "created_at", "updated_at"])
                rows = await s.execute(
                    text(
                        f'SELECT id, data, created_at, updated_at FROM "{schema}"."{d["key"]}" ORDER BY created_at, id'
                    )
                )
                for r in rows:
                    w.writerow([r.id, *[_cell(r.data.get(k)) for k in fields], r.created_at.isoformat(), r.updated_at.isoformat()])  # fmt: skip
                z.writestr(f"tables/{d['key']}.csv", out.getvalue())
            for i, (name, key) in enumerate(files):
                z.writestr(f"files/{i + 1}-{name}", await store.get(key))
        await s.execute(text("RESET search_path"))
    return buf.getvalue()


async def export_workspace(db: Database, store: FileStore, mailer: Mailer, settings: Settings, *, op: Principal, tenant_id: uuid.UUID, reason: str, request_id: str | None) -> dict[str, Any]:  # fmt: skip
    why = _need(reason, "reason", "Say why.")
    async with db.control() as s:
        t = await _tenant(s, tenant_id)
        owner = (await s.execute(text("SELECT u.email FROM control.membership m JOIN control.app_user u ON u.id = m.user_id WHERE m.tenant_id = :t AND m.role_key = 'admin' AND u.active ORDER BY u.created_at LIMIT 1"), {"t": tenant_id})).scalar_one_or_none()  # fmt: skip
    if owner is None:
        raise ValidationFailed("This workspace has no active owner to send the export to.")
    data = await build_export(db, store, tenant_id)
    job, token = new_id(), new_token()
    key = f"exports/{tenant_id}/{job}.zip"
    await store.put(key, data)
    expires = datetime.now(UTC) + timedelta(hours=EXPORT_HOURS)
    async with db.control() as s:
        await s.execute(
            text(
                "INSERT INTO control.export_job (id, tenant_id, requested_by, sent_to, token_hash, storage_key, size_bytes, expires_at) VALUES (:i, :t, :u, :e, :h, :k, :n, :x)"
            ),  # fmt: skip
            {
                "i": job,
                "t": tenant_id,
                "u": op.user_id,
                "e": owner,
                "h": token_hash(token),
                "k": key,
                "n": len(data),
                "x": expires,
            },  # fmt: skip
        )
        await _audit(s, op, tenant_id, "operator.workspace.export", {"reason": why, "sent_to": owner, "bytes": len(data)}, request_id)  # fmt: skip
    link = f"{settings.web_base_url}/v1/ops/exports/{token}"
    await mailer.send(to=owner, subject=f"Your {t.name} data export", body=f"Your export is ready. The link works for {EXPORT_HOURS} hours:\n{link}\n")  # fmt: skip
    out: dict[str, Any] = {
        "sent_to": owner,
        "expires_at": expires.isoformat(),
        "size_bytes": len(data),
    }
    if settings.environment in ("local", "test"):
        out["download_link"] = link
    return out


async def read_export(db: Database, store: FileStore, token: str) -> tuple[bytes, str]:
    async with db.control() as s:
        r = (await s.execute(text("SELECT e.storage_key, t.name FROM control.export_job e JOIN control.tenant t ON t.id = e.tenant_id WHERE e.token_hash = :h AND e.expires_at > now()"), {"h": token_hash(token)})).first()  # fmt: skip
    if r is None:
        raise NotFound("This export link has expired or is not valid.")
    return await store.get(r.storage_key), r.name
