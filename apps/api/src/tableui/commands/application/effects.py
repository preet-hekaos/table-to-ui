"""Follow-on changes declared in metadata (``TableDef.effects``), made in the writer's transaction."""

import json
import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tableui.audit.public import append_history, write_audit
from tableui.metadata.public import EffectDef, TableDef, search_document, shadow_columns


def _matches(record: dict[str, Any], want: dict[str, Any]) -> bool:
    return all(record.get(k) == v for k, v in want.items())


def _applies(
    e: EffectDef, action: str, before: dict[str, Any] | None, after: dict[str, Any]
) -> bool:
    if action not in e.actions or not _matches(after, e.when_is):
        return False
    return all(after.get(k) == v and (before or {}).get(k) != v for k, v in e.when_changed.items())


async def _count(
    s: AsyncSession, table: str, ref: str, target: uuid.UUID, where: dict[str, Any]
) -> int:
    conds = [f"data->>'{ref}' = :t"]
    params: dict[str, Any] = {"t": str(target)}
    for i, (k, v) in enumerate(where.items()):
        conds.append(f"data->>'{k}' = :w{i}")
        params[f"w{i}"] = str(v).lower() if isinstance(v, bool) else str(v)
    sql = f'SELECT count(*) FROM "{table}" WHERE {" AND ".join(conds)}'  # noqa: S608 - identifiers are validated metadata keys
    return int((await s.execute(text(sql), params)).scalar_one())


async def apply_effects(
    s: AsyncSession,
    ctx: Any,
    table: TableDef,
    action: str,
    before: dict[str, Any] | None,
    after: dict[str, Any],
) -> None:
    """Change the records this write points at, as declared by the table's effects."""
    for e in table.effects:
        if not _applies(e, action, before, after):
            continue
        target_id = after.get(e.ref)
        ref_field = table.field(e.ref)
        target_def = ctx.app.tables.get(ref_field.ref_table or "") if ref_field else None
        if not target_id or target_def is None:
            continue
        row = (
            await s.execute(
                text(f'SELECT data FROM "{target_def.key}" WHERE id = :i FOR UPDATE'),  # noqa: S608 - identifiers are validated metadata keys
                {"i": uuid.UUID(str(target_id))},
            )
        ).first()
        if row is None:
            continue
        old: dict[str, Any] = row.data
        new = {**old, **e.set}
        if e.rollup is not None:
            new[e.rollup.field] = await _count(
                s, table.key, e.ref, uuid.UUID(str(target_id)), e.rollup.where
            )
        if e.then is not None:
            have, need = new.get(e.then.field), new.get(e.then.at_least)
            if isinstance(have, int | float) and isinstance(need, int | float) and have >= need:
                new |= e.then.set
        if new == old:
            continue
        shadow = shadow_columns(target_def, new)
        sets = ", ".join(f'"{k}" = :n_{i}' for i, k in enumerate(shadow))
        res = (
            await s.execute(
                text(
                    f'UPDATE "{target_def.key}" SET data = CAST(:d AS jsonb), search_doc = :sd, version = version + 1, '  # noqa: S608 - identifiers are validated metadata keys
                    f"updated_at = now(), updated_by = :u{', ' + sets if sets else ''} WHERE id = :id RETURNING version"
                ),
                {
                    "d": json.dumps(new),
                    "sd": search_document(target_def, new),
                    "u": ctx.principal.user_id,
                    "id": uuid.UUID(str(target_id)),
                    **{f"n_{i}": v for i, v in enumerate(shadow.values())},
                },
            )
        ).one()
        await append_history(
            s,
            tenant_id=ctx.principal.tenant_id,
            table_key=target_def.key,
            record_id=uuid.UUID(str(target_id)),
            action=f"effect:{e.id}",
            before=old,
            after=new,
            actor_id=ctx.principal.user_id,
            app_version=ctx.app_version,
        )
        await write_audit(
            s,
            tenant_id=ctx.principal.tenant_id,
            scope="tenant",
            actor_id=ctx.principal.user_id,
            action=f"{target_def.key}.effect",
            subject_type=target_def.key,
            subject_id=str(target_id),
            detail={"effect": e.id, "from": table.key, "version": res.version},
            request_id=ctx.request_id,
        )
