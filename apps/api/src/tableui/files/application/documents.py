"""Reading a document into a record: parse (only after a clean scan, R-14), review, confirm.

What the document becomes is metadata: a ``document_review`` screen names the table to create, the
document table that keeps the file, and how the parser's fields map onto the table's fields.
"""

import json
import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tableui.audit.public import write_audit
from tableui.commands.public import CommandContext, create_record
from tableui.files.application.files import read_clean
from tableui.files.domain.parser import DocumentParser, ParserUnavailable
from tableui.files.domain.store import FileStore
from tableui.platform.db import Database
from tableui.platform.errors import NotFound, ValidationFailed

LOW_CONFIDENCE = 0.8


async def _state(
    s: AsyncSession, tenant_id: uuid.UUID, file_id: uuid.UUID
) -> dict[str, Any] | None:
    r = (
        await s.execute(
            text(
                "SELECT parser, status, attempts, result, error, confirmed_record_id, updated_at "
                "FROM control.document_parse WHERE file_id = :f AND tenant_id = :t"
            ),
            {"f": file_id, "t": tenant_id},
        )
    ).first()
    if r is None:
        return None
    fields = (r.result or {}).get("fields", {})
    return {
        "file_id": str(file_id),
        "parser": r.parser,
        "status": r.status,
        "attempts": r.attempts,
        "error": r.error,
        "fields": fields,
        "review": sorted(k for k, v in fields.items() if v.get("confidence", 0) < LOW_CONFIDENCE),
        "has_text": bool((r.result or {}).get("text")),
        "text_preview": ((r.result or {}).get("text") or "")[:4000],
        "confirmed_record_id": str(r.confirmed_record_id) if r.confirmed_record_id else None,
        "updated_at": r.updated_at.isoformat(),
    }


async def get_parse(s: AsyncSession, tenant_id: uuid.UUID, file_id: uuid.UUID) -> dict[str, Any]:
    st = await _state(s, tenant_id, file_id)
    if st is None:
        raise NotFound("This document has not been read yet.")
    return st


async def parse(
    s: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    file_id: uuid.UUID,
    store: FileStore,
    parser: DocumentParser,
    request_id: str | None,
) -> dict[str, Any]:
    """Read the document. If the parser is down, keep it queued; the person can type the fields."""
    meta, data = await read_clean(
        s, tenant_id, file_id, store
    )  # R-14: refuses unless scanned clean
    status, result, error = "parsed", {}, None
    try:
        result = await parser.parse(meta["content_type"], data)
    except ParserUnavailable as e:
        status, error = "queued", str(e)[:500]
    await s.execute(
        text(
            "INSERT INTO control.document_parse (file_id, tenant_id, parser, status, attempts, result, error) "
            "VALUES (:f, :t, :p, :st, 1, CAST(:r AS jsonb), :e) "
            "ON CONFLICT (file_id) DO UPDATE SET parser = EXCLUDED.parser, status = EXCLUDED.status, "
            "attempts = control.document_parse.attempts + 1, result = EXCLUDED.result, error = EXCLUDED.error, "
            "updated_at = now()"
        ),
        {
            "f": file_id,
            "t": tenant_id,
            "p": parser.name,
            "st": status,
            "r": json.dumps(result),
            "e": error,
        },
    )
    await write_audit(
        s,
        tenant_id=tenant_id,
        scope="tenant",
        actor_id=user_id,
        action="document.parse",
        subject_type="file",
        subject_id=str(file_id),
        detail={"status": status, "parser": parser.name},
        request_id=request_id,
    )
    st = await _state(s, tenant_id, file_id)
    assert st is not None
    return st


def mapped_values(config: dict[str, Any], fields: dict[str, Any]) -> dict[str, Any]:
    """Parser fields renamed to the table's fields, as the screen's mapping says."""
    mapping: dict[str, str] = config.get("mapping", {})
    return {target: fields[src]["value"] for src, target in mapping.items() if src in fields}


async def confirm(
    db: Database,
    ctx: CommandContext,
    *,
    screen: Any,
    file_id: uuid.UUID,
    data: dict[str, Any],
    existing_id: uuid.UUID | None,
    store: FileStore,
) -> dict[str, Any]:
    """document.confirm_parse: create the record (rules apply as for any create), then file the document."""
    tenant_id = ctx.principal.tenant_id
    assert tenant_id is not None
    cfg = screen.config
    for key in ("document_table", "link_field", "file_field"):
        if not cfg.get(key):
            raise ValidationFailed(f"The screen is missing '{key}' in its configuration.")
    async with db.control() as s:
        meta, _ = await read_clean(s, tenant_id, file_id, store)
        st = await _state(s, tenant_id, file_id)
    record_id: uuid.UUID
    created = None
    if existing_id is not None:
        record_id = existing_id
    else:
        created = await create_record(db, ctx, screen.table, data)
        record_id = uuid.UUID(created.body["id"])
    doc: dict[str, Any] = {
        cfg["link_field"]: str(record_id),
        cfg["file_field"]: str(file_id),
        **cfg.get("defaults", {}),
    }
    if cfg.get("name_field"):
        doc[cfg["name_field"]] = meta["name"]
    if cfg.get("scan_field"):
        doc[cfg["scan_field"]] = "clean"
    if cfg.get("text_field") and st is not None:
        async with db.control() as s:
            raw = (
                await s.execute(
                    text("SELECT result->>'text' FROM control.document_parse WHERE file_id = :f"),
                    {"f": file_id},
                )
            ).scalar_one_or_none()
        if raw:
            doc[cfg["text_field"]] = raw[:100_000]
    document = await create_record(db, ctx, cfg["document_table"], doc)
    async with db.control() as s:
        await s.execute(
            text(
                "UPDATE control.document_parse SET confirmed_record_id = :r, updated_at = now() "
                "WHERE file_id = :f AND tenant_id = :t"
            ),
            {"r": record_id, "f": file_id, "t": tenant_id},
        )
        await write_audit(
            s,
            tenant_id=tenant_id,
            scope="tenant",
            actor_id=ctx.principal.user_id,
            action="document.confirm_parse",
            subject_type=screen.table,
            subject_id=str(record_id),
            detail={"file_id": str(file_id), "attached_to_existing": existing_id is not None},
            request_id=ctx.request_id,
        )
    return {
        "record": {"table": screen.table, "id": str(record_id)},
        "document": {"table": cfg["document_table"], "id": document.body["id"]},
        "warnings": created.warnings if created else [],
    }
