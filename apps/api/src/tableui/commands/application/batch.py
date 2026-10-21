"""Many commands in one transaction, each in its own savepoint: one bad row never spoils the rest.

Used by imports (and their undo). Every row still goes through the same steps as a single command:
permission, validation, references, rules, then record + history + audit + outbox together.
A rule block can be overridden only for named checks, with a reason, and the override is audited.
"""

import json
import uuid
from dataclasses import dataclass, field
from typing import Any, Literal

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from tableui.audit.public import append_history, write_audit
from tableui.commands.application.pipeline import (
    CommandContext,
    _check_references,
    _emit,
    _evaluate_rules,
    _reject_hidden_writes,
)
from tableui.metadata.public import TableDef, search_document, shadow_columns, validate_record
from tableui.platform.db import Database
from tableui.platform.errors import ProblemError, RuleBlocked, ValidationFailed
from tableui.platform.ids import new_id

Kind = Literal["create", "update", "replace", "delete"]


@dataclass
class BatchOp:
    kind: Kind
    payload: dict[str, Any] = field(default_factory=dict)
    record_id: uuid.UUID | None = None
    overrides: frozenset[str] = frozenset()  # rule checks allowed to pass, with a reason
    reason: str | None = None
    tag: Any = None  # the caller's handle, for example the file row number


@dataclass
class BatchResult:
    op: BatchOp
    ok: bool
    record_id: uuid.UUID | None = None
    before: dict[str, Any] | None = None
    error: str | None = None
    code: str | None = None
    warnings: list[dict[str, Any]] = field(default_factory=list)


def _describe(e: Exception) -> tuple[str, str]:
    if isinstance(e, ValidationFailed) and e.errors:
        return "; ".join(f"{x['field']} {x['message']}" for x in e.errors), "invalid"
    if isinstance(e, ProblemError):
        rule = (e.extra or {}).get("rule")
        return str(e), f"rule:{rule['check']}" if rule else e.type_slug
    if isinstance(e, IntegrityError):
        return "conflicts with an existing record", "conflict"
    return str(e), "error"


async def _blocks(
    s: AsyncSession,
    ctx: CommandContext,
    table: TableDef,
    action: str,
    data: dict[str, Any],
    rid: uuid.UUID | None,
    op: BatchOp,
) -> list[dict[str, Any]]:
    outcomes = await _evaluate_rules(s, ctx, table, action, data, shadow_columns(table, data), rid)
    hard = [o for o in outcomes if o.severity == "block" and o.check_id not in op.overrides]
    if hard:
        raise RuleBlocked(
            hard[0].message,
            extra={"rule": hard[0].as_dict(), "violations": [o.as_dict() for o in hard]},
        )
    return [{**o.as_dict(), "overridden": o.severity == "block"} for o in outcomes]


async def _write_row(
    s: AsyncSession, ctx: CommandContext, table: TableDef, op: BatchOp
) -> BatchResult:
    tenant_id = ctx.principal.tenant_id
    assert tenant_id is not None
    tk = table.key
    if op.kind == "create":
        clean, errors = validate_record(table, op.payload, partial=False)
        if errors:
            raise ValidationFailed(errors=errors)
        await _check_references(s, table, clean)
        warnings = await _blocks(s, ctx, table, "create", clean, None, op)
        rid = new_id()
        shadow = shadow_columns(table, clean)
        cols = "".join(f', "{k}"' for k in shadow)
        vals = "".join(f", :n_{i}" for i in range(len(shadow)))
        row = (
            await s.execute(
                text(
                    f'INSERT INTO "{tk}" (id, tenant_id, data, owner_id, search_doc, created_by, updated_by{cols}) '  # noqa: S608 - identifiers are validated metadata keys
                    f"VALUES (:id, :t, CAST(:d AS jsonb), :u, :sd, :u, :u{vals}) RETURNING version, created_at"
                ),
                {
                    "id": rid,
                    "t": tenant_id,
                    "d": json.dumps(clean),
                    "sd": search_document(table, clean),
                    "u": ctx.principal.user_id,
                    **{f"n_{i}": v for i, v in enumerate(shadow.values())},
                },
            )
        ).one()
        await append_history(
            s, tenant_id=tenant_id, table_key=tk, record_id=rid, action="create", before=None,
            after=clean, actor_id=ctx.principal.user_id, app_version=ctx.app_version,
        )  # fmt: skip
        await _emit(
            s,
            ctx,
            table,
            f"{tk}.created",
            rid,
            row.version,
            clean,
            ctx.principal.user_id,
            row.created_at,
        )
        return BatchResult(op, True, rid, None, warnings=warnings)

    assert op.record_id is not None
    current = (
        await s.execute(
            text(f'SELECT id, version, data FROM "{tk}" WHERE id = :id FOR UPDATE'),  # noqa: S608 - identifiers are validated metadata keys
            {"id": op.record_id},
        )
    ).first()
    if current is None:
        return BatchResult(
            op, False, op.record_id, error="the record no longer exists", code="gone"
        )
    before = current.data
    if op.kind == "delete":
        await s.execute(text(f'DELETE FROM "{tk}" WHERE id = :id'), {"id": op.record_id})  # noqa: S608 - identifiers are validated metadata keys
        await append_history(
            s, tenant_id=tenant_id, table_key=tk, record_id=op.record_id, action="delete", before=before,
            after=None, actor_id=ctx.principal.user_id, app_version=ctx.app_version,
        )  # fmt: skip
        await _emit(s, ctx, table, f"{tk}.deleted", op.record_id, current.version + 1, before)
        return BatchResult(op, True, op.record_id, before)
    if op.kind == "replace":
        after, errors = validate_record(table, op.payload, partial=False)
    else:
        patch, errors = validate_record(table, op.payload, partial=True)
        after = {**before, **patch}
        if not errors:
            after, errors = validate_record(table, after, partial=False)
    if errors:
        raise ValidationFailed(errors=errors)
    await _check_references(s, table, after)
    warnings = await _blocks(s, ctx, table, "update", after, op.record_id, op)
    shadow = shadow_columns(table, after)
    sets = "".join(f', "{k}" = :n_{i}' for i, k in enumerate(shadow))
    row = (
        await s.execute(
            text(
                f'UPDATE "{tk}" SET data = CAST(:d AS jsonb), search_doc = :sd, version = version + 1, '  # noqa: S608 - identifiers are validated metadata keys
                f"updated_at = now(), updated_by = :u{sets} WHERE id = :id RETURNING version, owner_id, created_at"
            ),
            {
                "d": json.dumps(after),
                "sd": search_document(table, after),
                "u": ctx.principal.user_id,
                "id": op.record_id,
                **{f"n_{i}": v for i, v in enumerate(shadow.values())},
            },
        )
    ).one()
    await append_history(
        s, tenant_id=tenant_id, table_key=tk, record_id=op.record_id, action="update", before=before,
        after=after, actor_id=ctx.principal.user_id, app_version=ctx.app_version,
    )  # fmt: skip
    await _emit(
        s,
        ctx,
        table,
        f"{tk}.updated",
        op.record_id,
        row.version,
        after,
        row.owner_id,
        row.created_at,
    )
    return BatchResult(op, True, op.record_id, before, warnings=warnings)


async def apply_batch(
    db: Database, ctx: CommandContext, table_key: str, ops: list[BatchOp], *, audit_action: str
) -> list[BatchResult]:
    """Apply ops in one transaction. Failures are reported per op; the rest commit."""
    table = ctx.app.table(table_key)
    kinds = {op.kind for op in ops}
    if "create" in kinds:
        ctx.principal.require(f"record.{table_key}.create")
    if kinds & {"update", "replace"}:
        ctx.principal.require(f"record.{table_key}.update")
    if "delete" in kinds and not ctx.principal.allows(f"record.{table_key}.delete"):
        ctx.principal.require("import.run")  # only an import's undo removes records in bulk
    for op in ops:
        if op.kind in ("create", "update"):
            _reject_hidden_writes(ctx, table, op.payload)
    tenant_id = ctx.principal.tenant_id
    assert tenant_id is not None
    results: list[BatchResult] = []
    async with db.tenant(tenant_id) as s:
        for op in ops:
            try:
                async with s.begin_nested():
                    results.append(await _write_row(s, ctx, table, op))
            except (ProblemError, IntegrityError) as e:
                msg, code = _describe(e)
                results.append(BatchResult(op, False, op.record_id, error=msg, code=code))
        done = [r for r in results if r.ok]
        overridden = [r for r in done if any(w.get("overridden") for w in r.warnings)]
        await write_audit(
            s,
            tenant_id=tenant_id,
            scope="tenant",
            actor_id=ctx.principal.user_id,
            action=audit_action,
            subject_type=table_key,
            subject_id=table_key,
            detail={
                "applied": len(done),
                "failed": len(results) - len(done),
                "overridden": [
                    {
                        "record_id": str(r.record_id),
                        "checks": sorted(r.op.overrides),
                        "reason": r.op.reason,
                    }
                    for r in overridden
                ][:200],
                "release_version": ctx.app.release_version,
            },
            request_id=ctx.request_id,
        )
    return results
