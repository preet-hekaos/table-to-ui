"""Builder edits to the Draft: tables, fields, screens and navigation.

Every edit runs in one control-plane transaction: the additive DDL a change needs (a new record
table, a shadow column or an index; never a table rewrite) and the Draft row change commit together.
Nothing reaches the live app until the Draft is published to Test and promoted to Live.
"""

import json
import re
import uuid
from typing import Any

from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tableui.audit.public import write_audit
from tableui.metadata.domain.ddl import add_field_index_sql, add_shadow_column_sql, table_ddl_sql
from tableui.metadata.domain.models import FieldDef, NavItem, ScreenDef, TableDef
from tableui.platform.errors import NotFound, ValidationFailed
from tableui.platform.ids import schema_name
from tableui.platform.sql import split_statements

# Names the workspace schema already uses, and record-table columns a field may not shadow.
RESERVED_TABLES = {
    "metadata_object",
    "record_history",
    "outbox",
    "idempotency_key",
    "schema_migration",
}
RESERVED_FIELDS = {
    "id",
    "tenant_id",
    "version",
    "data",
    "owner_id",
    "owner",
    "search_doc",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
}
TEXTUAL = {"text", "long_text", "email", "phone", "url", "select", "tags"}
NORMALIZER = {"email": "email", "phone": "phone"}
# What a builder may change on a field that came with the pack.
PACK_FIELD_EDITABLE = {"label", "help", "hidden"}
AGENCY_FIELD_EDITABLE = PACK_FIELD_EDITABLE | {
    "required",
    "options",
    "group",
    "min",
    "max",
    "max_length",
}


def slug(label: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", label.strip().lower()).strip("_")
    if not s or not s[0].isalpha():
        s = f"x_{s}" if s else "x"
    return s[:50]


def _bad(field: str, message: str, code: str = "invalid") -> ValidationFailed:
    return ValidationFailed(errors=[{"field": field, "code": code, "message": message}])


def _pydantic_errors(e: ValidationError) -> ValidationFailed:
    return ValidationFailed(
        errors=[
            {
                "field": ".".join(str(x) for x in err["loc"]) or "definition",
                "code": "invalid",
                "message": err["msg"].removeprefix("Value error, "),
            }
            for err in e.errors()
        ]
    )


async def _enter_tenant(s: AsyncSession, tenant_id: uuid.UUID) -> str:
    schema = schema_name(tenant_id)
    await s.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": str(tenant_id)})
    await s.execute(text(f'SET LOCAL search_path TO "{schema}", public, pg_catalog'))
    return schema


async def _draft(s: AsyncSession, kind: str, key: str) -> tuple[dict[str, Any], str] | None:
    row = (
        await s.execute(
            text("SELECT definition, source FROM metadata_object WHERE kind = :k AND key = :key"),
            {"k": kind, "key": key},
        )
    ).first()
    return (row.definition, row.source) if row else None


async def _keys(s: AsyncSession, kind: str) -> set[str]:
    rows = await s.execute(text("SELECT key FROM metadata_object WHERE kind = :k"), {"k": kind})
    return {r.key for r in rows}


async def _put(
    s: AsyncSession,
    tenant_id: uuid.UUID,
    kind: str,
    key: str,
    definition: dict[str, Any],
    source: str,
) -> None:
    await s.execute(
        text(
            "INSERT INTO metadata_object (tenant_id, kind, key, definition, source) "
            "VALUES (:t, :k, :key, CAST(:d AS jsonb), :src) "
            "ON CONFLICT (kind, key) DO UPDATE SET definition = EXCLUDED.definition, updated_at = now()"
        ),
        {"t": tenant_id, "k": kind, "key": key, "d": json.dumps(definition), "src": source},
    )


async def _audit(
    s: AsyncSession,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    action: str,
    subject: str,
    detail: dict[str, Any],
    request_id: str | None,
) -> None:
    await s.execute(text("RESET search_path"))
    await write_audit(
        s,
        tenant_id=tenant_id,
        scope="tenant",
        actor_id=user_id,
        action=action,
        subject_type="metadata",
        subject_id=subject,
        detail=detail,
        request_id=request_id,
    )


def _field_ddl(schema: str, table_key: str, f: FieldDef) -> str:
    out = []
    if f.normalize:
        out.append(add_shadow_column_sql(schema, table_key, f.key, f.unique))
    if f.filterable or f.type == "reference":
        out.append(add_field_index_sql(schema, table_key, f.key))
    return "\n".join(out)


def _new_field(body: dict[str, Any], existing: set[str], tables: set[str]) -> FieldDef:
    label = str(body.get("label") or "").strip()
    if not label:
        raise _bad("label", "is required", "required")
    ftype = body.get("type")
    key = body.get("key") or slug(label)
    if key in RESERVED_FIELDS or key.endswith("_norm"):
        raise _bad("key", f"'{key}' is reserved; choose another name")
    if key in existing:
        raise _bad("key", f"a field called '{key}' already exists", "duplicate")
    if ftype == "reference" and body.get("ref_table") not in tables:
        raise _bad("ref_table", "must be a table in this app")
    unique = bool(body.get("unique"))
    normalize = NORMALIZER.get(str(ftype)) or ("text" if unique else None)
    try:
        return FieldDef.model_validate(
            {
                "key": key,
                "label": label,
                "type": ftype,
                "required": bool(body.get("required")),
                "options": body.get("options") or [],
                "help": body.get("help") or None,
                "group": body.get("group") or None,
                "ref_table": body.get("ref_table") if ftype == "reference" else None,
                "unique": unique,
                "normalize": normalize,
                "source": "agency",
                "searchable": ftype in TEXTUAL,
                "filterable": True,
            }
        )
    except ValidationError as e:
        raise _pydantic_errors(e) from None


async def create_table(
    s: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    body: dict[str, Any],
    request_id: str | None,
) -> dict[str, Any]:
    """A new agency table with a name field, a list screen and a menu entry (all in Draft)."""
    schema = await _enter_tenant(s, tenant_id)
    label = str(body.get("label") or "").strip()
    if not label:
        raise _bad("label", "is required", "required")
    plural = str(body.get("plural_label") or "").strip() or f"{label}s"
    key = body.get("key") or slug(label)
    tables = await _keys(s, "table")
    if key in RESERVED_TABLES or key in tables:
        raise _bad("key", f"a table called '{key}' already exists", "duplicate")
    title_label = str(body.get("title_label") or "Name").strip()
    try:
        table = TableDef.model_validate(
            {
                "key": key,
                "label": label,
                "plural_label": plural,
                "title_field": "name",
                "description": str(body.get("description") or ""),
                "source": "agency",
                "fields": [
                    {
                        "key": "name",
                        "label": title_label,
                        "type": "text",
                        "required": True,
                        "source": "agency",
                        "searchable": True,
                        "filterable": True,
                    }
                ],
            }
        )
    except ValidationError as e:
        raise _pydantic_errors(e) from None
    # The physical table is created now; it stays empty and unseen until the Draft goes Live.
    for stmt in split_statements(table_ddl_sql(schema, table)):
        await s.execute(text(stmt))
    await _put(s, tenant_id, "table", key, table.model_dump(mode="json"), "agency")
    screen = ScreenDef(key=f"{key}_list"[:63], title=plural, pattern="searchable_table", table=key)
    if screen.key not in await _keys(s, "screen"):
        await _put(s, tenant_id, "screen", screen.key, screen.model_dump(mode="json"), "agency")
        nav = NavItem(
            key=f"nav_{key}"[:63], label=plural, screen=screen.key, section="more", order=200
        )
        await _put(s, tenant_id, "nav", nav.key, nav.model_dump(mode="json"), "agency")
    await _audit(s, tenant_id, user_id, "metadata.table.create", key, {"label": label}, request_id)
    return table.model_dump(mode="json")


async def add_field(
    s: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    table_key: str,
    body: dict[str, Any],
    request_id: str | None,
) -> dict[str, Any]:
    """field.create: an agency field on any table. Stored in the record's JSON, so no rewrite."""
    schema = await _enter_tenant(s, tenant_id)
    found = await _draft(s, "table", table_key)
    if found is None:
        raise NotFound(f"There is no table '{table_key}'.")
    definition, source = found
    table = TableDef.model_validate(definition)
    f = _new_field(body, {x.key for x in table.fields}, await _keys(s, "table"))
    try:
        updated = TableDef.model_validate(
            {
                **definition,
                "fields": [*definition["fields"], f.model_dump(mode="json")],
                "version": table.version + 1,
            }
        )
    except ValidationError as e:
        raise _pydantic_errors(e) from None
    ddl = _field_ddl(schema, table_key, f)
    for stmt in split_statements(ddl):
        await s.execute(text(stmt))
    await _put(s, tenant_id, "table", table_key, updated.model_dump(mode="json"), source)
    await _audit(
        s,
        tenant_id,
        user_id,
        "metadata.field.create",
        f"{table_key}.{f.key}",
        {"type": f.type},
        request_id,
    )
    return f.model_dump(mode="json")


async def update_field(
    s: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    table_key: str,
    field_key: str,
    body: dict[str, Any],
    request_id: str | None,
) -> dict[str, Any]:
    """Relabel, hide or tune a field. Pack fields only take label, help and hidden."""
    await _enter_tenant(s, tenant_id)
    found = await _draft(s, "table", table_key)
    if found is None:
        raise NotFound(f"There is no table '{table_key}'.")
    definition, source = found
    table = TableDef.model_validate(definition)
    f = table.field(field_key)
    if f is None:
        raise NotFound(f"There is no field '{field_key}' on '{table_key}'.")
    allowed = PACK_FIELD_EDITABLE if f.source == "pack" else AGENCY_FIELD_EDITABLE
    refused = sorted(set(body) - allowed)
    if refused:
        raise _bad(
            refused[0],
            "cannot be changed on a field that comes with the pack"
            if f.source == "pack"
            else "cannot be changed",
            "not_editable",
        )
    changes = {k: v for k, v in body.items() if k in allowed}
    if "label" in changes and not str(changes["label"]).strip():
        raise _bad("label", "is required", "required")
    new = {**f.model_dump(mode="json"), **changes}
    if new.get("hidden") and (new.get("required") or field_key == table.title_field):
        raise _bad("hidden", "a required field or the record's name cannot be hidden")
    try:
        nf = FieldDef.model_validate(new)
        updated = TableDef.model_validate(
            {
                **definition,
                "fields": [
                    nf.model_dump(mode="json") if x["key"] == field_key else x
                    for x in definition["fields"]
                ],
                "version": table.version + 1,
            }
        )
    except ValidationError as e:
        raise _pydantic_errors(e) from None
    await _put(s, tenant_id, "table", table_key, updated.model_dump(mode="json"), source)
    await _audit(
        s,
        tenant_id,
        user_id,
        "metadata.field.update",
        f"{table_key}.{field_key}",
        {"changed": sorted(changes)},
        request_id,
    )
    return nf.model_dump(mode="json")


async def remove_field(
    s: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    table_key: str,
    field_key: str,
    request_id: str | None,
) -> None:
    """Agency fields can be removed from the Draft; the values stay in each record's history."""
    await _enter_tenant(s, tenant_id)
    found = await _draft(s, "table", table_key)
    if found is None:
        raise NotFound(f"There is no table '{table_key}'.")
    definition, source = found
    table = TableDef.model_validate(definition)
    f = table.field(field_key)
    if f is None:
        raise NotFound(f"There is no field '{field_key}' on '{table_key}'.")
    if f.source == "pack":
        raise _bad(
            "field", "a field that comes with the pack can be hidden but not deleted", "pack_field"
        )
    if field_key == table.title_field:
        raise _bad("field", "the record's name field cannot be deleted", "title_field")
    rules = await s.execute(text("SELECT key, definition FROM metadata_object WHERE kind = 'rule'"))
    for r in rules:
        if r.definition.get("table") == table_key and re.search(
            rf"\b{re.escape(field_key)}\b", json.dumps(r.definition)
        ):
            raise _bad("field", f"rule {r.key} uses this field", "in_use")
    updated = {
        **definition,
        "fields": [x for x in definition["fields"] if x["key"] != field_key],
        "version": table.version + 1,
    }
    await _put(s, tenant_id, "table", table_key, updated, source)
    await _audit(
        s, tenant_id, user_id, "metadata.field.delete", f"{table_key}.{field_key}", {}, request_id
    )


async def save_screen(
    s: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    body: dict[str, Any],
    request_id: str | None,
) -> dict[str, Any]:
    """screen.save: create or change a screen (a pattern on a table, plus its configuration)."""
    await _enter_tenant(s, tenant_id)
    key = body.get("key") or slug(str(body.get("title") or ""))
    current = await _draft(s, "screen", key)
    version = (current[0].get("version", 1) + 1) if current else 1
    try:
        body = {k: v for k, v in body.items() if k != "source"}
        screen = ScreenDef.model_validate({**body, "key": key, "version": version})
    except ValidationError as e:
        raise _pydantic_errors(e) from None
    tables = await _keys(s, "table")
    if screen.table not in tables:
        raise _bad("table", "must be a table in this app")
    found = await _draft(s, "table", screen.table)
    assert found is not None
    table = TableDef.model_validate(found[0])
    _check_screen_config(screen, table)
    await _put(
        s,
        tenant_id,
        "screen",
        key,
        screen.model_dump(mode="json"),
        current[1] if current else "agency",
    )
    await _audit(
        s, tenant_id, user_id, "metadata.screen.save", key, {"pattern": screen.pattern}, request_id
    )
    return screen.model_dump(mode="json")


def _check_screen_config(screen: ScreenDef, table: TableDef) -> None:
    fields = {f.key for f in table.fields}
    cfg = screen.config
    for name in ("columns", "filters", "fields"):
        for k in cfg.get(name, []) or []:
            if k not in fields:
                raise _bad(f"config.{name}", f"'{k}' is not a field of {table.label}")
    g = cfg.get("group_by")
    if g and g not in fields:
        raise _bad("config.group_by", f"'{g}' is not a field of {table.label}")
    if "empty_text" in cfg and len(str(cfg["empty_text"])) > 200:
        raise _bad("config.empty_text", "must be 200 characters or fewer")
    for a in cfg.get("actions", []) or []:
        if a not in {"create", "edit", "export", "import"}:
            raise _bad("config.actions", f"'{a}' is not an action")


async def save_navigation(
    s: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    items: list[dict[str, Any]],
    request_id: str | None,
) -> list[dict[str, Any]]:
    """Replace the whole menu in the Draft: order, sections, labels and which roles see each item."""
    await _enter_tenant(s, tenant_id)
    screens = await _keys(s, "screen")
    current = {
        r.key: r
        for r in await s.execute(
            text("SELECT key, definition, source FROM metadata_object WHERE kind = 'nav'")
        )
    }
    out: list[NavItem] = []
    seen: set[str] = set()
    for i, raw in enumerate(items):
        key = raw.get("key") or f"nav_{slug(str(raw.get('label') or 'item'))}"
        if key in seen:
            raise _bad(f"items.{i}.key", "appears twice", "duplicate")
        seen.add(key)
        prev = current.get(key)
        raw = {k: v for k, v in raw.items() if k != "source"}
        try:
            n = NavItem.model_validate(
                {
                    **raw,
                    "key": key,
                    "order": raw.get("order", (i + 1) * 10),
                    "version": (prev.definition.get("version", 1) + 1) if prev else 1,
                }
            )
        except ValidationError as e:
            raise _pydantic_errors(e) from None
        if n.screen not in screens:
            raise _bad(f"items.{i}.screen", "must be a screen in this app")
        if n.section not in {"main", "more"}:
            raise _bad(f"items.{i}.section", "must be main or more")
        out.append(n)
    await s.execute(text("DELETE FROM metadata_object WHERE kind = 'nav'"))
    for n in out:
        prev = current.get(n.key)
        await _put(
            s, tenant_id, "nav", n.key, n.model_dump(mode="json"), prev.source if prev else "agency"
        )
    await _audit(
        s,
        tenant_id,
        user_id,
        "metadata.navigation.save",
        "navigation",
        {"items": len(out)},
        request_id,
    )
    return [n.model_dump(mode="json") for n in out]


async def read_draft(s: AsyncSession, tenant_id: uuid.UUID, kind: str) -> list[dict[str, Any]]:
    await _enter_tenant(s, tenant_id)
    rows = await s.execute(
        text("SELECT key, definition, source FROM metadata_object WHERE kind = :k ORDER BY key"),
        {"k": kind},
    )
    return [{**r.definition, "source": r.definition.get("source", r.source)} for r in rows]
