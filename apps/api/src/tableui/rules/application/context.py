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
    record: dict[str, Any] | None = None,
    tables: dict[str, TableDef] | None = None,
) -> dict[str, Any]:
    ctx: dict[str, Any] = {}
    for name, loader in rule.context.items():
        if loader.kind == "lookup":
            ctx[name] = await _lookup(
                session, table, loader.ref_field or "", loader.field or "", record or {}, tables
            )
        elif loader.kind == "count":
            ctx[name] = await _count(session, table, loader, record or {}, exclude_id)
        elif loader.kind == "normalised_match":
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
    # Closest names first (trigram similarity), so a large group sharing the exact value is never cut
    # off arbitrarily; the deterministic scorer below makes the decision.
    rows = (
        await session.execute(
            text(
                f'SELECT id, data, "{fuzzy}_norm" AS fz FROM "{table.key}" WHERE "{exact}_norm" = :e '  # noqa: S608 - identifiers are validated metadata keys
                "AND (CAST(:ex AS uuid) IS NULL OR id <> CAST(:ex AS uuid)) "
                f'ORDER BY public.similarity("{fuzzy}_norm", :z) DESC, id LIMIT 50'
            ),
            {"e": exact_v, "ex": exclude_id, "z": fuzzy_v},
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


async def _lookup(
    session: AsyncSession,
    table: TableDef,
    ref_field: str,
    field: str,
    record: dict[str, Any],
    tables: dict[str, TableDef] | None = None,
) -> Any:
    """The value of ``field`` on the record reached by following ``ref_field`` (a.b follows links)."""
    current_table, data = table, record
    for hop in ref_field.split("."):
        ref = current_table.field(hop)
        target = data.get(hop)
        if ref is None or not ref.ref_table or not target:
            return None
        row = (
            await session.execute(
                text(f'SELECT data FROM "{ref.ref_table}" WHERE id = :i'),  # noqa: S608 - identifiers are validated metadata keys
                {"i": target},
            )
        ).first()
        if row is None:
            return None
        data = row.data or {}
        nxt = (tables or {}).get(ref.ref_table)
        if nxt is None:
            if hop != ref_field.split(".")[-1]:
                return None
        else:
            current_table = nxt
    return data.get(field)


async def _count(
    session: AsyncSession,
    table: TableDef,
    loader: Any,
    record: dict[str, Any],
    exclude_id: uuid.UUID | None,
) -> int:
    """How many records of ``loader.table`` point back at this record (or share its values)."""
    conds: list[str] = []
    params: dict[str, Any] = {}
    for i, (other, mine) in enumerate(loader.match.items()):
        value = (str(exclude_id) if exclude_id else None) if mine == "$id" else record.get(mine)
        if value is None:
            return 0
        conds.append(f"data ->> '{other}' = :m{i}")
        params[f"m{i}"] = str(value)
    for j, (key, wanted) in enumerate(loader.where.items()):
        conds.append(f"data ->> '{key}' = :w{j}")
        params[f"w{j}"] = str(wanted).lower() if isinstance(wanted, bool) else str(wanted)
    if exclude_id is not None and loader.table == table.key and "$id" not in loader.match.values():
        conds.append("id <> CAST(:ex AS uuid)")
        params["ex"] = str(exclude_id)
    return int(
        (
            await session.execute(
                text(f'SELECT count(*) FROM "{loader.table}" WHERE {" AND ".join(conds)}'),  # noqa: S608 - identifiers are validated metadata keys
                params,
            )
        ).scalar_one()
    )
