"""Load the facts a rule needs (for example 'is there already a record with this email?')."""

import uuid
from typing import Any

from rapidfuzz import fuzz
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tableui.metadata.public import RuleDef, TableDef


async def load_context(
    session: AsyncSession,
    table: TableDef,
    rule: RuleDef,
    shadow: dict[str, str | None],
    exclude_id: uuid.UUID | None,
) -> dict[str, Any]:
    ctx: dict[str, Any] = {}
    for name, loader in rule.context.items():
        if loader.kind == "normalised_match":
            ctx[name] = await _normalised(session, table, loader.field or "", shadow, exclude_id)
        else:
            ctx[name] = await _fuzzy(
                session,
                table,
                loader.exact_field or "",
                loader.fuzzy_field or "",
                loader.threshold,
                shadow,
                exclude_id,
            )
    return ctx


def _link(table: TableDef, row: Any) -> dict[str, Any]:
    return {
        "table": table.key,
        "id": str(row.id),
        "label": (row.data or {}).get(table.title_field),
    }


async def _normalised(
    session: AsyncSession,
    table: TableDef,
    field: str,
    shadow: dict[str, str | None],
    exclude_id: uuid.UUID | None,
) -> dict[str, Any] | None:
    value = shadow.get(f"{field}_norm")
    if value is None:
        return None
    row = (
        await session.execute(
            text(
                f'SELECT id, data FROM "{table.key}" WHERE "{field}_norm" = :v '  # noqa: S608 - identifiers are validated metadata keys
                "AND (CAST(:ex AS uuid) IS NULL OR id <> CAST(:ex AS uuid)) LIMIT 1"
            ),
            {"v": value, "ex": exclude_id},
        )
    ).first()
    return _link(table, row) if row else None


async def _fuzzy(
    session: AsyncSession,
    table: TableDef,
    exact: str,
    fuzzy: str,
    threshold: int,
    shadow: dict[str, str | None],
    exclude_id: uuid.UUID | None,
) -> dict[str, Any] | None:
    exact_v, fuzzy_v = shadow.get(f"{exact}_norm"), shadow.get(f"{fuzzy}_norm")
    if exact_v is None or fuzzy_v is None:
        return None
    rows = (
        await session.execute(
            text(
                f'SELECT id, data, "{fuzzy}_norm" AS fz FROM "{table.key}" WHERE "{exact}_norm" = :e '  # noqa: S608 - identifiers are validated metadata keys
                "AND (CAST(:ex AS uuid) IS NULL OR id <> CAST(:ex AS uuid)) LIMIT 200"
            ),
            {"e": exact_v, "ex": exclude_id},
        )
    ).all()
    best = None
    best_score = 0.0
    for r in rows:
        if r.fz is None:
            continue
        score = fuzz.token_sort_ratio(fuzzy_v, r.fz)
        if score >= threshold and score > best_score:
            best, best_score = r, score
    return _link(table, best) if best else None
