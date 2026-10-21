"""The command pipeline. Every write to business data goes through here:

authorise -> validate -> idempotency -> load context -> evaluate rules -> one transaction
(record + history + audit + outbox) -> response. The server decides; nothing else writes.
"""

import hashlib
import json
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from tableui.audit.public import append_history, write_audit
from tableui.commands.application.effects import apply_effects
from tableui.identity.public import Principal, hidden_fields, scope_predicate, strip_hidden
from tableui.metadata.public import (
    RuntimeApp,
    TableDef,
    search_document,
    shadow_columns,
    validate_record,
)
from tableui.platform.db import Database
from tableui.platform.errors import (
    ApprovalRequired,
    IdempotencyConflict,
    NotFound,
    RuleBlocked,
    ValidationFailed,
    VersionConflict,
)
from tableui.platform.ids import new_id
from tableui.rules.public import (
    Outcome,
    compile_rule,
    evaluate,
    full,
    load_context,
    transition_outcomes,
)


@dataclass(frozen=True)
class Overrides:
    """Block checks a user passes on purpose, with the reason that goes into the audit trail."""

    checks: frozenset[str]
    reason: str


@dataclass(frozen=True)
class CommandContext:
    principal: Principal
    app: RuntimeApp
    app_version: str
    request_id: str | None = None
    idempotency_key: str | None = None
    overrides: Overrides | None = None
    approved_checks: frozenset[str] = frozenset()  # approval checks an approver has already allowed
    approval_id: str | None = None


@dataclass
class CommandResult:
    status: int
    body: dict[str, Any]
    replayed: bool = False
    warnings: list[dict[str, Any]] = field(default_factory=list)


def _hash(command: str, payload: dict[str, Any]) -> str:
    raw = json.dumps({"c": command, "p": payload}, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()


def _record_body(table: TableDef, row: Any, p: Principal) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "table": table.key,
        "version": row.version,
        "data": strip_hidden(p, table.key, row.data),
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
    }


async def _evaluate_rules(
    s: AsyncSession,
    ctx: CommandContext,
    table: TableDef,
    action: str,
    clean: dict[str, Any],
    shadow: dict[str, str | None],
    exclude_id: uuid.UUID | None,
    before: dict[str, Any] | None = None,
) -> list[Outcome]:
    record = full(table, clean)
    was = full(table, before)
    outcomes = transition_outcomes(table, before, record, action == "create")
    for rule in ctx.app.rules:
        if rule.table != table.key or action not in rule.applies_to:
            continue
        rule_ctx = await load_context(s, table, rule, shadow, exclude_id, record, ctx.app.tables)
        outcomes += evaluate(compile_rule(rule), record, rule_ctx, was)
    return outcomes


def _resolve(
    ctx: CommandContext, outcomes: list[Outcome]
) -> tuple[list[dict[str, Any]], list[Outcome]]:
    """Apply overrides and approvals. Returns the warnings to show and the overrides that were used."""
    used: list[Outcome] = []
    left: list[Outcome] = []
    for o in outcomes:
        if (
            o.severity == "block"
            and o.overridable
            and ctx.overrides
            and o.check_id in ctx.overrides.checks
        ):
            ctx.principal.require("rule.override")
            if not ctx.overrides.reason.strip():
                raise ValidationFailed(
                    errors=[
                        {
                            "field": "reason",
                            "code": "required",
                            "message": "give a reason for the override",
                        }
                    ]
                )
            used.append(o)
        elif o.severity == "approval" and o.check_id in ctx.approved_checks:
            continue
        else:
            left.append(o)
    blocks = [o for o in left if o.severity == "block"]
    if blocks:
        first = blocks[0]
        raise RuleBlocked(
            first.message,
            extra={"rule": first.as_dict(), "violations": [o.as_dict() for o in blocks]},
        )
    needs = [o for o in left if o.severity == "approval"]
    if needs:
        raise ApprovalRequired(
            needs[0].message,
            extra={"approval": {"checks": [o.as_dict() for o in needs]}},
        )
    return [o.as_dict() for o in left], used


def _audit_detail(ctx: CommandContext, used: list[Outcome]) -> dict[str, Any]:
    detail: dict[str, Any] = {"release_version": ctx.app.release_version}
    if used and ctx.overrides:
        detail["overrides"] = [{"check": o.check_id, "message": o.message} for o in used]
        detail["override_reason"] = ctx.overrides.reason
    if ctx.approval_id:
        detail["approval_id"] = ctx.approval_id
        detail["approved_checks"] = sorted(ctx.approved_checks)
    return detail


def _reject_hidden_writes(ctx: CommandContext, table: TableDef, payload: dict[str, Any]) -> None:
    denied = sorted(hidden_fields(ctx.principal, table.key) & set(payload))
    if denied:
        raise ValidationFailed(
            errors=[
                {"field": k, "code": "not_allowed", "message": "your role cannot change this field"}
                for k in denied
            ]
        )


async def _check_references(s: AsyncSession, table: TableDef, data: dict[str, Any]) -> None:
    errors = []
    for f in table.fields:
        v = data.get(f.key)
        if f.type != "reference" or not v or not f.ref_table:
            continue
        found = (
            await s.execute(text(f'SELECT 1 FROM "{f.ref_table}" WHERE id = :i'), {"i": v})  # noqa: S608 - identifiers are validated metadata keys
        ).first()
        if found is None:
            errors.append(
                {
                    "field": f.key,
                    "code": "unknown_reference",
                    "message": f"that {f.ref_table} does not exist",
                }
            )
    if errors:
        raise ValidationFailed(errors=errors)


async def _claim_idempotency(
    s: AsyncSession, ctx: CommandContext, request_hash: str
) -> CommandResult | None:
    """Return the stored result if this key was already used; otherwise claim it."""
    if not ctx.idempotency_key:
        return None
    tenant_id = ctx.principal.tenant_id
    claimed = (
        await s.execute(
            text(
                "INSERT INTO idempotency_key (tenant_id, key, request_hash, status, response) "
                "VALUES (:t, :k, :h, 0, '{}'::jsonb) ON CONFLICT DO NOTHING RETURNING key"
            ),
            {"t": tenant_id, "k": ctx.idempotency_key, "h": request_hash},
        )
    ).first()
    if claimed:
        return None
    row = (
        await s.execute(
            text("SELECT request_hash, status, response FROM idempotency_key WHERE key = :k"),
            {"k": ctx.idempotency_key},
        )
    ).one()
    if row.request_hash != request_hash:
        raise IdempotencyConflict(
            "This Idempotency-Key was already used for a different request.",
        )
    return CommandResult(status=row.status, body=row.response, replayed=True)


async def _store_idempotency(s: AsyncSession, ctx: CommandContext, result: CommandResult) -> None:
    if ctx.idempotency_key:
        await s.execute(
            text(
                "UPDATE idempotency_key SET status = :st, response = CAST(:r AS jsonb) WHERE key = :k"
            ),
            {"st": result.status, "r": json.dumps(result.body), "k": ctx.idempotency_key},
        )


async def _emit(
    s: AsyncSession,
    ctx: CommandContext,
    table: TableDef,
    topic: str,
    record_id: uuid.UUID,
    version: int,
    data: dict[str, Any],
    owner_id: uuid.UUID | None = None,
    created_at: datetime | None = None,
) -> None:
    """Outbox row, written in the same transaction as the change it announces."""
    analytics = {f.key: data.get(f.key) for f in table.fields if f.analytics}
    event_id = new_id()
    payload = {
        "event_id": str(event_id),
        "topic": topic,
        "tenant_id": str(ctx.principal.tenant_id),
        "table": table.key,
        "record_id": str(record_id),
        "version": version,
        "occurred_at": datetime.now(UTC).isoformat(),
        "fields": analytics,
        "owner_id": str(owner_id) if owner_id else None,
        "created_at": created_at.isoformat() if created_at else None,
    }
    await s.execute(
        text(
            "INSERT INTO outbox (tenant_id, event_id, topic, payload) "
            "VALUES (:t, :e, :topic, CAST(:p AS jsonb))"
        ),
        {"t": ctx.principal.tenant_id, "e": event_id, "topic": topic, "p": json.dumps(payload)},
    )


async def create_record(
    db: Database, ctx: CommandContext, table_key: str, payload: dict[str, Any]
) -> CommandResult:
    """``<table>.create``. Retries once through rules if the unique-index backstop fires."""
    ctx.principal.require(f"record.{table_key}.create")
    table = ctx.app.table(table_key)
    _reject_hidden_writes(ctx, table, payload)
    clean, errors = validate_record(table, payload, partial=False)
    if errors:
        raise ValidationFailed(errors=errors)
    shadow = shadow_columns(table, clean)
    request_hash = _hash(f"{table_key}.create", payload)
    tenant_id = ctx.principal.tenant_id
    assert tenant_id is not None
    try:
        async with db.tenant(tenant_id) as s:
            replay = await _claim_idempotency(s, ctx, request_hash)
            if replay:
                return replay
            await _check_references(s, table, clean)
            warnings, used = _resolve(
                ctx, await _evaluate_rules(s, ctx, table, "create", clean, shadow, None)
            )
            record_id = new_id()
            cols = ", ".join(f'"{k}"' for k in shadow)
            vals = ", ".join(f":n_{i}" for i in range(len(shadow)))
            row = (
                await s.execute(
                    text(
                        f'INSERT INTO "{table_key}" (id, tenant_id, data, owner_id, search_doc, created_by, updated_by'  # noqa: S608 - identifiers are validated metadata keys
                        f"{', ' + cols if cols else ''}) VALUES (:id, :t, CAST(:d AS jsonb), :u, :sd, :u, :u"
                        f"{', ' + vals if vals else ''}) RETURNING id, version, data, created_at, updated_at"
                    ),
                    {
                        "id": record_id,
                        "t": tenant_id,
                        "d": json.dumps(clean),
                        "sd": search_document(table, clean),
                        "u": ctx.principal.user_id,
                        **{f"n_{i}": v for i, v in enumerate(shadow.values())},
                    },
                )
            ).one()
            await append_history(
                s,
                tenant_id=tenant_id,
                table_key=table_key,
                record_id=record_id,
                action="create",
                before=None,
                after=clean,
                actor_id=ctx.principal.user_id,
                app_version=ctx.app_version,
            )
            await write_audit(
                s,
                tenant_id=tenant_id,
                scope="tenant",
                actor_id=ctx.principal.user_id,
                action=f"{table_key}.create",
                subject_type=table_key,
                subject_id=str(record_id),
                detail=_audit_detail(ctx, used),
                request_id=ctx.request_id,
            )
            await apply_effects(s, ctx, table, "create", None, clean)
            await _emit(
                s,
                ctx,
                table,
                f"{table_key}.created",
                record_id,
                row.version,
                clean,
                ctx.principal.user_id,
                row.created_at,
            )
            result = CommandResult(201, _record_body(table, row, ctx.principal), warnings=warnings)
            result.body["warnings"] = warnings
            await _store_idempotency(s, ctx, result)
            return result
    except IntegrityError:
        # A concurrent create won the unique index. Re-run the rules to give the proper answer.
        async with db.tenant(tenant_id) as s:
            _resolve(ctx, await _evaluate_rules(s, ctx, table, "create", clean, shadow, None))
        raise ValidationFailed("This record conflicts with an existing one.") from None


async def update_record(
    db: Database,
    ctx: CommandContext,
    table_key: str,
    record_id: uuid.UUID,
    payload: dict[str, Any],
    expected_version: int,
) -> CommandResult:
    """``<table>.update`` with optimistic concurrency."""
    ctx.principal.require(f"record.{table_key}.update")
    table = ctx.app.table(table_key)
    _reject_hidden_writes(ctx, table, payload)
    patch, errors = validate_record(table, payload, partial=True)
    if errors:
        raise ValidationFailed(errors=errors)
    tenant_id = ctx.principal.tenant_id
    assert tenant_id is not None
    request_hash = _hash(
        f"{table_key}.update", {"id": str(record_id), "v": expected_version, "p": payload}
    )
    scope_sql, scope_params = await scope_predicate(db, ctx.principal, table_key)
    try:
        async with db.tenant(tenant_id) as s:
            replay = await _claim_idempotency(s, ctx, request_hash)
            if replay:
                return replay
            current = (
                await s.execute(
                    text(
                        f'SELECT id, version, data FROM "{table_key}" WHERE id = :id'  # noqa: S608 - identifiers are validated metadata keys
                        f"{' AND ' + scope_sql if scope_sql else ''} FOR UPDATE"
                    ),
                    {"id": record_id, **scope_params},
                )
            ).first()
            if current is None:
                raise NotFound("That record does not exist.")
            if current.version != expected_version:
                raise VersionConflict(
                    "Someone else changed this record. Reload to see their changes.",
                    extra={"current_version": current.version, "your_version": expected_version},
                )
            before = current.data
            after = {**before, **patch}
            merged_clean, errs = validate_record(table, after, partial=False)
            if errs:
                raise ValidationFailed(errors=errs)
            await _check_references(s, table, merged_clean)
            shadow = shadow_columns(table, merged_clean)
            warnings, used = _resolve(
                ctx,
                await _evaluate_rules(
                    s, ctx, table, "update", merged_clean, shadow, record_id, before
                ),
            )
            sets = ", ".join(f'"{k}" = :n_{i}' for i, k in enumerate(shadow))
            row = (
                await s.execute(
                    text(
                        f'UPDATE "{table_key}" SET data = CAST(:d AS jsonb), search_doc = :sd, version = version + 1, '  # noqa: S608 - identifiers are validated metadata keys
                        f"updated_at = now(), updated_by = :u{', ' + sets if sets else ''} "
                        "WHERE id = :id RETURNING id, version, data, created_at, updated_at, owner_id"
                    ),
                    {
                        "d": json.dumps(merged_clean),
                        "sd": search_document(table, merged_clean),
                        "u": ctx.principal.user_id,
                        "id": record_id,
                        **{f"n_{i}": v for i, v in enumerate(shadow.values())},
                    },
                )
            ).one()
            await append_history(
                s,
                tenant_id=tenant_id,
                table_key=table_key,
                record_id=record_id,
                action="update",
                before=before,
                after=merged_clean,
                actor_id=ctx.principal.user_id,
                app_version=ctx.app_version,
            )
            await write_audit(
                s,
                tenant_id=tenant_id,
                scope="tenant",
                actor_id=ctx.principal.user_id,
                action=f"{table_key}.update",
                subject_type=table_key,
                subject_id=str(record_id),
                detail=_audit_detail(ctx, used),
                request_id=ctx.request_id,
            )
            await apply_effects(s, ctx, table, "update", before, merged_clean)
            await _emit(
                s,
                ctx,
                table,
                f"{table_key}.updated",
                record_id,
                row.version,
                merged_clean,
                row.owner_id,
                row.created_at,
            )
            result = CommandResult(200, _record_body(table, row, ctx.principal), warnings=warnings)
            result.body["warnings"] = warnings
            await _store_idempotency(s, ctx, result)
            return result
    except IntegrityError:
        raise ValidationFailed("This change conflicts with an existing record.") from None


async def check_record(
    db: Database,
    ctx: CommandContext,
    table_key: str,
    payload: dict[str, Any],
    record_id: uuid.UUID | None = None,
) -> list[dict[str, Any]]:
    """Dry-run the rules for the form's instant duplicate check. Writes nothing."""
    ctx.principal.require(f"record.{table_key}.create")
    table = ctx.app.table(table_key)
    clean, _ = validate_record(table, payload, partial=True)
    shadow = shadow_columns(table, clean)
    async with db.tenant(ctx.principal.tenant_id) as s:
        before = None
        if record_id:
            row = (
                await s.execute(
                    text(f'SELECT data FROM "{table_key}" WHERE id = :i'),  # noqa: S608 - identifiers are validated metadata keys
                    {"i": record_id},
                )
            ).first()
            before = row.data if row else None
        merged = {**(before or {}), **clean} if record_id else clean
        outcomes = await _evaluate_rules(
            s, ctx, table, "update" if record_id else "create", merged, shadow, record_id, before
        )
    return [o.as_dict() for o in outcomes]


async def emit_change(
    s: AsyncSession,
    tenant_id: uuid.UUID,
    table: TableDef,
    *,
    kind: str,
    record_id: uuid.UUID,
    version: int,
    data: dict[str, Any],
    owner_id: uuid.UUID | None = None,
    created_at: datetime | None = None,
) -> None:
    """For changes made outside the command pipeline (a merge, an import undone): keep analytics in step."""
    event_id = new_id()
    topic = f"{table.key}.{kind}"
    payload = {
        "event_id": str(event_id),
        "topic": topic,
        "tenant_id": str(tenant_id),
        "table": table.key,
        "record_id": str(record_id),
        "version": version,
        "occurred_at": datetime.now(UTC).isoformat(),
        "fields": {f.key: data.get(f.key) for f in table.fields if f.analytics},
        "owner_id": str(owner_id) if owner_id else None,
        "created_at": created_at.isoformat() if created_at else None,
    }
    await s.execute(
        text(
            "INSERT INTO outbox (tenant_id, event_id, topic, payload) "
            "VALUES (:t, :e, :topic, CAST(:p AS jsonb))"
        ),
        {"t": tenant_id, "e": event_id, "topic": topic, "p": json.dumps(payload)},
    )
