"""Duplicate review: suspected pairs, side-by-side compare, merge and undo (seven days)."""

import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from rapidfuzz import fuzz
from sqlalchemy import text

from tableui.audit.public import append_history, write_audit
from tableui.identity.public import Principal
from tableui.metadata.public import (
    RuntimeApp,
    TableDef,
    search_document,
    shadow_columns,
    validate_record,
)
from tableui.platform.db import Database
from tableui.platform.errors import NotFound, ValidationFailed
from tableui.platform.ids import new_id
from tableui.query.public import get_record

UNDO_DAYS = 7
SCAN_CAP = 150


def _detector(app: RuntimeApp, table: TableDef) -> tuple[str, str, int]:
    """(exact field, fuzzy field, threshold) from the table's fuzzy-match rule."""
    for rule in app.rules:
        if rule.table != table.key:
            continue
        for loader in rule.context.values():
            if loader.kind == "fuzzy_match":
                return loader.exact_field or "", loader.fuzzy_field or "", loader.threshold
    raise NotFound(f"'{table.label}' has no duplicate check.")


def _pair(a: uuid.UUID, b: uuid.UUID) -> tuple[uuid.UUID, uuid.UUID]:
    return (a, b) if str(a) < str(b) else (b, a)


async def suspected(
    db: Database, p: Principal, app: RuntimeApp, table_key: str, limit: int = 50
) -> dict[str, Any]:
    """Pairs that share the exact field and have near-identical names, best matches first."""
    p.require(f"record.{table_key}.read")
    table = app.table(table_key)
    exact, fuzzy, threshold = _detector(app, table)
    # Each row looks up its near matches through the trigram index; the scan stops at SCAN_CAP.
    sql = (
        f'SELECT a.id AS a_id, m.id AS b_id, a.data AS a_data, m.data AS b_data, a."{fuzzy}_norm" AS an, '  # noqa: S608 - identifiers are validated metadata keys
        f'm."{fuzzy}_norm" AS bn FROM "{table_key}" a CROSS JOIN LATERAL ('
        f'SELECT b.id, b.data, b."{fuzzy}_norm" FROM "{table_key}" b WHERE b.id > a.id '
        f'AND b."{exact}_norm" = a."{exact}_norm" AND b."{fuzzy}_norm" OPERATOR(public.%) a."{fuzzy}_norm" '
        f'AND left(b."{fuzzy}_norm", 1) = left(a."{fuzzy}_norm", 1) '
        f"AND NOT EXISTS (SELECT 1 FROM control.duplicate_dismissal d WHERE d.tenant_id = :t "
        f"AND d.table_key = :k AND d.a_id = a.id AND d.b_id = b.id) LIMIT 3) m "
        f'WHERE a."{exact}_norm" IS NOT NULL AND a."{fuzzy}_norm" IS NOT NULL LIMIT :cap'
    )
    async with db.tenant(p.tenant_id) as s:
        await s.execute(text("SET LOCAL pg_trgm.similarity_threshold = 0.45"))
        rows = (
            await s.execute(text(sql), {"t": p.tenant_id, "k": table_key, "cap": SCAN_CAP})
        ).all()
    rows = sorted(rows, key=lambda r: (-fuzz.token_sort_ratio(r.an, r.bn), r.a_id, r.b_id))
    out: list[dict[str, Any]] = []
    for r in rows:
        score = fuzz.token_sort_ratio(r.an, r.bn)
        if score < threshold:
            continue

        def card(rid: uuid.UUID, data: dict[str, Any]) -> dict[str, Any]:
            return {"id": str(rid), "label": data.get(table.title_field), "data": data}

        out.append(
            {"a": card(r.a_id, r.a_data), "b": card(r.b_id, r.b_data), "score": round(score)}
        )
        if len(out) >= limit:
            break
    return {"items": out, "table": table_key, "exact_field": exact, "fuzzy_field": fuzzy}


def _pointers(app: RuntimeApp, table_key: str) -> list[tuple[str, str]]:
    return [
        (t.key, f.key)
        for t in app.tables.values()
        for f in t.fields
        if f.type == "reference" and f.ref_table == table_key
    ]


async def compare(
    db: Database, p: Principal, app: RuntimeApp, table_key: str, a: uuid.UUID, b: uuid.UUID
) -> dict[str, Any]:
    table = app.table(table_key)
    left = await get_record(db, p, app, table_key, a)
    right = await get_record(db, p, app, table_key, b)
    fields = [
        {
            "key": f.key,
            "label": f.label,
            "a": left["data"].get(f.key),
            "b": right["data"].get(f.key),
            "same": left["data"].get(f.key) == right["data"].get(f.key),
        }
        for f in table.fields
        if not f.hidden and f.key in {*left["data"], *right["data"]}
    ]
    links: list[dict[str, Any]] = []
    async with db.tenant(p.tenant_id) as s:
        for tk, fk in _pointers(app, table_key):
            counts = {}
            for side, rid in (("a", a), ("b", b)):
                counts[side] = (
                    await s.execute(
                        text(f"SELECT count(*) FROM \"{tk}\" WHERE data->>'{fk}' = :i"),  # noqa: S608 - identifiers are validated metadata keys
                        {"i": str(rid)},
                    )
                ).scalar_one()
            if counts["a"] or counts["b"]:
                links.append({"table": tk, "label": app.tables[tk].plural_label, **counts})
    return {"a": left, "b": right, "fields": fields, "links": links}


async def dismiss(
    db: Database, p: Principal, app: RuntimeApp, table_key: str, a: uuid.UUID, b: uuid.UUID
) -> None:
    p.require(f"record.{table_key}.update")
    app.table(table_key)
    x, y = _pair(a, b)
    async with db.control() as c:
        await c.execute(
            text(
                "INSERT INTO control.duplicate_dismissal (tenant_id, table_key, a_id, b_id, dismissed_by) "
                "VALUES (:t, :k, :a, :b, :u) ON CONFLICT DO NOTHING"
            ),
            {"t": p.tenant_id, "k": table_key, "a": x, "b": y, "u": p.user_id},
        )


async def merge(
    db: Database,
    p: Principal,
    app: RuntimeApp,
    app_version: str,
    request_id: str | None,
    table_key: str,
    *,
    keep: uuid.UUID,
    drop: uuid.UUID,
    take: dict[str, str],
) -> dict[str, Any]:
    """Keep one record, fold the other into it, move everything that pointed at it, archive it.

    R-13: only roles with ``record.<table>.merge`` (managers and admins) may merge.
    ``take`` maps a field to ``"drop"`` to use the other record's value; empty fields fill themselves.
    """
    p.require(f"record.{table_key}.merge")
    table = app.table(table_key)
    if keep == drop:
        raise ValidationFailed("Pick two different records to merge.")
    tid = p.tenant_id
    assert tid is not None
    merge_id = new_id()
    async with db.tenant(tid) as s:
        rows = {
            r.id: r
            for r in (
                await s.execute(
                    text(
                        f'SELECT id, version, data, owner_id, created_by, updated_by, created_at FROM "{table_key}" '  # noqa: S608 - identifiers are validated metadata keys
                        "WHERE id = ANY(CAST(:ids AS uuid[])) ORDER BY id FOR UPDATE"
                    ),
                    {"ids": [keep, drop]},
                )
            ).all()
        }
        if keep not in rows or drop not in rows:
            raise NotFound("One of those records does not exist.")
        k, d = rows[keep], rows[drop]
        merged = dict(k.data)
        for f in table.fields:
            mine, theirs = k.data.get(f.key), d.data.get(f.key)
            if theirs not in (None, "", []) and (
                take.get(f.key) == "drop" or mine in (None, "", [])
            ):
                merged[f.key] = theirs
        clean, errs = validate_record(table, merged, partial=False)
        if errs:
            raise ValidationFailed(errors=errs)
        await s.execute(text(f'DELETE FROM "{table_key}" WHERE id = :i'), {"i": drop})  # noqa: S608 - identifiers are validated metadata keys
        shadow = shadow_columns(table, clean)
        sets = ", ".join(f'"{c}" = :n_{i}' for i, c in enumerate(shadow))
        await s.execute(
            text(
                f'UPDATE "{table_key}" SET data = CAST(:d AS jsonb), search_doc = :sd, version = version + 1, '  # noqa: S608 - identifiers are validated metadata keys
                f"updated_at = now(), updated_by = :u{', ' + sets if sets else ''} WHERE id = :id"
            ),
            {
                "d": json.dumps(clean),
                "sd": search_document(table, clean),
                "u": p.user_id,
                "id": keep,
                **{f"n_{i}": v for i, v in enumerate(shadow.values())},
            },
        )
        relinked: list[dict[str, str]] = []
        for tk, fk in _pointers(app, table_key):
            moved = (
                await s.execute(
                    text(
                        f"UPDATE \"{tk}\" SET data = jsonb_set(data, '{{{fk}}}', to_jsonb(CAST(:k AS text))), "  # noqa: S608 - identifiers are validated metadata keys
                        f"version = version + 1, updated_at = now(), updated_by = :u WHERE data->>'{fk}' = :d "
                        "RETURNING id, data"
                    ),
                    {"k": str(keep), "d": str(drop), "u": p.user_id},
                )
            ).all()
            for m in moved:
                relinked.append({"table": tk, "field": fk, "id": str(m.id)})
                await append_history(
                    s,
                    tenant_id=tid,
                    table_key=tk,
                    record_id=m.id,
                    action="merge:relink",
                    before={**m.data, fk: str(drop)},
                    after=m.data,
                    actor_id=p.user_id,
                    app_version=app_version,
                )
        await append_history(
            s,
            tenant_id=tid,
            table_key=table_key,
            record_id=keep,
            action="merge",
            before=k.data,
            after=clean,
            actor_id=p.user_id,
            app_version=app_version,
        )
        await append_history(
            s,
            tenant_id=tid,
            table_key=table_key,
            record_id=drop,
            action="merged-away",
            before=d.data,
            after=None,
            actor_id=p.user_id,
            app_version=app_version,
        )
        snapshot = {
            "kept_before": {"version": k.version, "data": k.data},
            "kept_version_after": k.version + 1,
            "merged": {
                "version": d.version,
                "data": d.data,
                "owner_id": str(d.owner_id),
                "created_by": str(d.created_by),
                "updated_by": str(d.updated_by),
                "created_at": d.created_at.isoformat(),
            },
            "relinked": relinked,
        }
        await s.execute(
            text(
                "INSERT INTO control.record_merge (id, tenant_id, table_key, kept_id, merged_id, snapshot, merged_by) "
                "VALUES (:id, :t, :k, :kept, :drop, CAST(:s AS jsonb), :u)"
            ),
            {
                "id": merge_id,
                "t": tid,
                "k": table_key,
                "kept": keep,
                "drop": drop,
                "s": json.dumps(snapshot),
                "u": p.user_id,
            },
        )
        await write_audit(
            s,
            tenant_id=tid,
            scope="tenant",
            actor_id=p.user_id,
            action=f"{table_key}.merge",
            subject_type=table_key,
            subject_id=str(keep),
            detail={"merge_id": str(merge_id), "merged": str(drop), "relinked": len(relinked)},
            request_id=request_id,
        )
    return {
        "id": str(merge_id),
        "kept": str(keep),
        "merged": str(drop),
        "relinked": len(relinked),
        "undo_until": (datetime.now(UTC) + timedelta(days=UNDO_DAYS)).isoformat(),
    }


async def list_merges(
    db: Database, p: Principal, app: RuntimeApp, table_key: str
) -> list[dict[str, Any]]:
    p.require(f"record.{table_key}.read")
    app.table(table_key)
    async with db.control() as c:
        rows = (
            await c.execute(
                text(
                    "SELECT id, kept_id, merged_id, merged_at, undone_at, merged_by, "
                    "jsonb_array_length(snapshot->'relinked') AS relinked, "
                    "snapshot->'merged'->'data' AS merged_data FROM control.record_merge "
                    "WHERE tenant_id = :t AND table_key = :k ORDER BY merged_at DESC LIMIT 50"
                ),
                {"t": p.tenant_id, "k": table_key},
            )
        ).all()
    now = datetime.now(UTC)
    title = app.table(table_key).title_field
    return [
        {
            "id": str(r.id),
            "kept": str(r.kept_id),
            "merged": str(r.merged_id),
            "merged_label": (r.merged_data or {}).get(title),
            "merged_at": r.merged_at.isoformat(),
            "relinked": r.relinked,
            "undone": r.undone_at is not None,
            "can_undo": r.undone_at is None and now - r.merged_at < timedelta(days=UNDO_DAYS),
        }
        for r in rows
    ]


async def undo(
    db: Database,
    p: Principal,
    app: RuntimeApp,
    app_version: str,
    request_id: str | None,
    table_key: str,
    merge_id: uuid.UUID,
) -> dict[str, Any]:
    p.require(f"record.{table_key}.merge")
    table = app.table(table_key)
    tid = p.tenant_id
    assert tid is not None
    async with db.tenant(tid) as s:
        m = (
            await s.execute(
                text(
                    "SELECT kept_id, merged_id, snapshot, merged_at, undone_at FROM control.record_merge "
                    "WHERE id = :i AND tenant_id = :t AND table_key = :k FOR UPDATE"
                ),
                {"i": merge_id, "t": tid, "k": table_key},
            )
        ).first()
        if m is None:
            raise NotFound("That merge does not exist.")
        if m.undone_at is not None:
            raise ValidationFailed("This merge was already undone.")
        if datetime.now(UTC) - m.merged_at >= timedelta(days=UNDO_DAYS):
            raise ValidationFailed(f"A merge can be undone for {UNDO_DAYS} days only.")
        snap = m.snapshot
        before = snap["kept_before"]
        cur = (
            await s.execute(
                text(f'SELECT data FROM "{table_key}" WHERE id = :i FOR UPDATE'),  # noqa: S608 - identifiers are validated metadata keys
                {"i": m.kept_id},
            )
        ).first()
        if cur is None:
            raise ValidationFailed("The kept record no longer exists, so this cannot be undone.")
        shadow = shadow_columns(table, before["data"])
        sets = ", ".join(f'"{c}" = :n_{i}' for i, c in enumerate(shadow))
        await s.execute(
            text(
                f'UPDATE "{table_key}" SET data = CAST(:d AS jsonb), search_doc = :sd, version = version + 1, '  # noqa: S608 - identifiers are validated metadata keys
                f"updated_at = now(), updated_by = :u{', ' + sets if sets else ''} WHERE id = :id"
            ),
            {
                "d": json.dumps(before["data"]),
                "sd": search_document(table, before["data"]),
                "u": p.user_id,
                "id": m.kept_id,
                **{f"n_{i}": v for i, v in enumerate(shadow.values())},
            },
        )
        gone = snap["merged"]
        gshadow = shadow_columns(table, gone["data"])
        cols = "".join(f', "{c}"' for c in gshadow)
        vals = "".join(f", :n_{i}" for i in range(len(gshadow)))
        await s.execute(
            text(
                f'INSERT INTO "{table_key}" (id, tenant_id, version, data, owner_id, search_doc, created_by, updated_by, created_at{cols}) '  # noqa: S608 - identifiers are validated metadata keys
                "VALUES (:id, :t, :v, CAST(:d AS jsonb), :o, :sd, :cb, :ub, :ca" + vals + ")"
            ),
            {
                "id": m.merged_id,
                "t": tid,
                "v": gone["version"] + 1,
                "d": json.dumps(gone["data"]),
                "o": uuid.UUID(gone["owner_id"]),
                "sd": search_document(table, gone["data"]),
                "cb": uuid.UUID(gone["created_by"]),
                "ub": p.user_id,
                "ca": datetime.fromisoformat(gone["created_at"]),
                **{f"n_{i}": v for i, v in enumerate(gshadow.values())},
            },
        )
        restored = 0
        for link in snap["relinked"]:
            tk, fk = link["table"], link["field"]
            res = await s.execute(
                text(
                    f"UPDATE \"{tk}\" SET data = jsonb_set(data, '{{{fk}}}', to_jsonb(CAST(:d AS text))), "  # noqa: S608 - identifiers are validated metadata keys
                    f"version = version + 1, updated_at = now(), updated_by = :u "
                    f"WHERE id = :i AND data->>'{fk}' = :k RETURNING id"
                ),
                {
                    "d": str(m.merged_id),
                    "k": str(m.kept_id),
                    "i": uuid.UUID(link["id"]),
                    "u": p.user_id,
                },
            )
            restored += len(res.all())
        await append_history(
            s,
            tenant_id=tid,
            table_key=table_key,
            record_id=m.merged_id,
            action="merge-undone",
            before=None,
            after=gone["data"],
            actor_id=p.user_id,
            app_version=app_version,
        )
        await s.execute(
            text("UPDATE control.record_merge SET undone_at = now(), undone_by = :u WHERE id = :i"),
            {"u": p.user_id, "i": merge_id},
        )
        await write_audit(
            s,
            tenant_id=tid,
            scope="tenant",
            actor_id=p.user_id,
            action=f"{table_key}.merge-undo",
            subject_type=table_key,
            subject_id=str(m.kept_id),
            detail={"merge_id": str(merge_id), "restored_links": restored},
            request_id=request_id,
        )
    return {
        "id": str(merge_id),
        "kept": str(m.kept_id),
        "restored": str(m.merged_id),
        "links": restored,
    }
