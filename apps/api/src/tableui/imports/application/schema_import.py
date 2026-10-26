"""Preview and apply a schema import. The preview saves nothing; the apply goes through the same
Studio commands as a hand-made table, so checks, audit and Draft staging are unchanged."""

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from tableui.imports.domain import schema_read as sr
from tableui.metadata.public import add_field, create_table, read_draft
from tableui.platform.errors import ValidationFailed

LINK_FIELD = {"type": "reference"}


async def preview(
    s: AsyncSession, tenant_id: uuid.UUID, files: list[tuple[str, str, bytes]]
) -> dict[str, Any]:
    existing = {t["key"] for t in await read_draft(s, tenant_id, "table")}
    tables: list[dict[str, Any]] = []
    problems: list[dict[str, str]] = []
    for name, content_type, data in files[:10]:
        try:
            tables += sr.read_schema(name, content_type, data)
        except sr.SchemaError as e:
            problems.append({"file": name, "message": str(e)})
    try:
        tables = sr.combine(tables, existing)
    except sr.SchemaError as e:
        problems.append({"file": "", "message": str(e)})
        tables = []
    return {"tables": tables, "problems": problems}


def _check(tables: list[dict[str, Any]]) -> None:
    if not tables:
        raise ValidationFailed(
            errors=[{"field": "tables", "code": "invalid", "message": "Choose at least one table."}]
        )
    if len(tables) > sr.MAX_TABLES:
        raise ValidationFailed(
            errors=[
                {
                    "field": "tables",
                    "code": "invalid",
                    "message": f"At most {sr.MAX_TABLES} tables at a time.",
                }
            ]
        )
    for t in tables:
        if len(t.get("fields") or []) > sr.MAX_COLUMNS:
            raise ValidationFailed(
                errors=[
                    {
                        "field": "fields",
                        "code": "invalid",
                        "message": f"At most {sr.MAX_COLUMNS} fields per table.",
                    }
                ]
            )


async def apply(
    s: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    tables: list[dict[str, Any]],
    request_id: str | None,
) -> dict[str, Any]:
    """Create every table first, then its other fields (so a link can point at any of them)."""
    _check(tables)
    made: list[str] = []
    for t in tables:
        title = next((f for f in t["fields"] if f["key"] == t.get("title_key")), None)
        body: dict[str, Any] = {
            "key": t["key"],
            "label": t["label"],
            "plural_label": t.get("plural_label") or "",
            "description": f"Imported from {t.get('source', 'a file')}",
        }
        if title:
            body |= {"title_key": title["key"], "title_label": title["label"]}
        await create_table(
            s, tenant_id=tenant_id, user_id=user_id, body=body, request_id=request_id
        )
        made.append(t["key"])
    count = 0
    for t in tables:
        for f in t["fields"]:
            if f["key"] == t.get("title_key"):
                continue
            body = {
                "key": f["key"],
                "label": f["label"],
                "type": f["type"],
                "required": bool(f.get("required")) and f["type"] != "reference",
                "options": f.get("options") or [],
                "ref_table": f.get("ref_table"),
            }
            await add_field(
                s,
                tenant_id=tenant_id,
                user_id=user_id,
                table_key=t["key"],
                body=body,
                request_id=request_id,
            )
            count += 1
    return {"tables": made, "fields": count}
