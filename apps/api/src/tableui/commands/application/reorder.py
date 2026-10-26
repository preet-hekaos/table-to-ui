"""Drag to reorder: one shared hand-made order per table.

Each record carries ``sort_order`` (a number; null (never placed) sorts first, newest first). Moving a record puts it between
two neighbours, so only that record changes. The first move gives every record a number, in the order the
list was showing; if two numbers ever get too close they are spread out again.
"""

import uuid
from typing import Any

from sqlalchemy import text

from tableui.audit.public import write_audit
from tableui.commands.application.pipeline import CommandContext
from tableui.identity.public import scope_predicate
from tableui.metadata.public import features_of
from tableui.platform.db import Database
from tableui.platform.errors import NotFound, PermissionDenied, ValidationFailed

STEP = 1000.0
MIN_GAP = 1e-6


async def _renumber(s: Any, table_key: str) -> None:
    await s.execute(
        text(
            f'UPDATE "{table_key}" t SET sort_order = n.r * :step FROM ('  # noqa: S608 - identifiers are validated metadata keys
            f'SELECT id, row_number() OVER (ORDER BY COALESCE(sort_order, -1e12 - extract(epoch FROM updated_at)), id) AS r FROM "{table_key}") n '
            "WHERE t.id = n.id"
        ),
        {"step": STEP},
    )


async def move_record(
    db: Database,
    ctx: CommandContext,
    table_key: str,
    record_id: uuid.UUID,
    before_id: uuid.UUID | None,
) -> dict[str, Any]:
    """Put ``record_id`` just before ``before_id``, or last when that is None."""
    table = ctx.app.table(table_key)
    if not features_of(table).row_order:
        raise PermissionDenied("Reordering is switched off for this table.")
    ctx.principal.require(f"record.{table_key}.update")
    if before_id == record_id:
        raise ValidationFailed(
            errors=[
                {
                    "field": "before",
                    "code": "invalid",
                    "message": "a record cannot go before itself",
                }
            ]
        )
    tenant_id = ctx.principal.tenant_id
    assert tenant_id is not None
    scope_sql, scope_params = await scope_predicate(db, ctx.principal, table_key)
    async with db.tenant(tenant_id) as s:
        seen = {
            r.id
            for r in (
                await s.execute(
                    text(
                        f'SELECT id FROM "{table_key}" WHERE id = ANY(CAST(:ids AS uuid[]))'  # noqa: S608 - identifiers are validated metadata keys
                        f"{' AND ' + scope_sql if scope_sql else ''}"
                    ),
                    {"ids": [i for i in (record_id, before_id) if i], **scope_params},
                )
            ).all()
        }
        if record_id not in seen or (before_id and before_id not in seen):
            raise NotFound("That record does not exist.")
        await s.execute(text(f'LOCK TABLE "{table_key}" IN SHARE ROW EXCLUSIVE MODE'))  # noqa: S608 - identifiers are validated metadata keys
        unnumbered = (
            await s.execute(
                text(f'SELECT EXISTS (SELECT 1 FROM "{table_key}" WHERE sort_order IS NULL)')  # noqa: S608
            )
        ).scalar_one()
        if unnumbered:
            await _renumber(s, table_key)
        for attempt in (0, 1):
            others = f'FROM "{table_key}" WHERE id <> :me'
            if before_id:
                after = (
                    await s.execute(
                        text(f"SELECT sort_order {others} AND id = :b"),  # noqa: S608 - identifiers are validated metadata keys
                        {"me": record_id, "b": before_id},
                    )
                ).scalar_one()
                prev = (
                    await s.execute(
                        text(f"SELECT max(sort_order) {others} AND sort_order < :a"),  # noqa: S608 - identifiers are validated metadata keys
                        {"me": record_id, "a": after},
                    )
                ).scalar_one()
                low = prev if prev is not None else after - 2 * STEP
                position = (low + after) / 2
                gap = after - low
            else:
                top = (
                    await s.execute(text(f"SELECT max(sort_order) {others}"), {"me": record_id})  # noqa: S608 - identifiers are validated metadata keys
                ).scalar_one()
                position = (top or 0) + STEP
                gap = STEP
            if gap >= 2 * MIN_GAP or attempt == 1:
                break
            await _renumber(s, table_key)  # too close: spread everything out, then try once more
        await s.execute(
            text(f'UPDATE "{table_key}" SET sort_order = :p WHERE id = :id'),  # noqa: S608 - identifiers are validated metadata keys
            {"p": position, "id": record_id},
        )
        await write_audit(
            s,
            tenant_id=tenant_id,
            scope="tenant",
            actor_id=ctx.principal.user_id,
            action="record.reorder",
            subject_type=table_key,
            subject_id=str(record_id),
            detail={"before": str(before_id) if before_id else None},
            request_id=ctx.request_id,
        )
    return {"id": str(record_id), "position": position}
