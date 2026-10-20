"""document.upload: check the type by content, scan, store, record. Files are per workspace."""

import hashlib
import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tableui.audit.public import write_audit
from tableui.files.domain.kinds import KINDS, sniff
from tableui.files.domain.scan import Scanner
from tableui.files.domain.store import FileStore
from tableui.platform.errors import NotFound, ValidationFailed


def _bad(message: str, code: str = "invalid") -> ValidationFailed:
    return ValidationFailed(errors=[{"field": "file", "code": code, "message": message}])


async def upload(
    s: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    kind: str,
    name: str,
    data: bytes,
    store: FileStore,
    scanner: Scanner,
    request_id: str | None,
) -> dict[str, Any]:
    k = KINDS.get(kind)
    if k is None:
        raise ValidationFailed(
            errors=[{"field": "kind", "code": "invalid", "message": "is not a kind of file"}]
        )
    if not data:
        raise _bad("is empty", "empty")
    if len(data) > k.max_bytes:
        raise _bad(f"is larger than {k.max_bytes // (1024 * 1024)} MB", "too_large")
    ctype = sniff(data, name)
    if ctype not in k.types:
        raise _bad("is not a type we accept here", "type")
    verdict = await scanner.scan(data)  # R-14: nothing reads a file before this
    file_id = uuid.uuid4()
    key = f"{tenant_id}/{kind}/{file_id}"
    await store.put(key, data)
    safe_name = name.replace("/", "_").replace("\\", "_")[:200] or "file"
    await s.execute(
        text(
            "INSERT INTO control.file (id, tenant_id, kind, name, content_type, size_bytes, sha256, "
            "storage_key, scan_status, created_by) VALUES (:i, :t, :k, :n, :c, :z, :h, :key, :st, :u)"
        ),
        {
            "i": file_id,
            "t": tenant_id,
            "k": kind,
            "n": safe_name,
            "c": ctype,
            "z": len(data),
            "h": hashlib.sha256(data).hexdigest(),
            "key": key,
            "st": verdict,
            "u": user_id,
        },
    )
    await write_audit(
        s,
        tenant_id=tenant_id,
        scope="tenant",
        actor_id=user_id,
        action="document.upload",
        subject_type="file",
        subject_id=str(file_id),
        detail={"kind": kind, "scan": verdict, "bytes": len(data)},
        request_id=request_id,
    )
    return await describe(s, tenant_id, file_id)


async def describe(s: AsyncSession, tenant_id: uuid.UUID, file_id: uuid.UUID) -> dict[str, Any]:
    r = (
        await s.execute(
            text(
                "SELECT id, kind, name, content_type, size_bytes, sha256, scan_status, created_at "
                "FROM control.file WHERE id = :i AND tenant_id = :t"
            ),
            {"i": file_id, "t": tenant_id},
        )
    ).first()
    if r is None:
        raise NotFound("There is no such file.")
    return {
        "id": str(r.id),
        "kind": r.kind,
        "name": r.name,
        "content_type": r.content_type,
        "size_bytes": r.size_bytes,
        "sha256": r.sha256,
        "scan_status": r.scan_status,
        "created_at": r.created_at.isoformat(),
    }


async def read_clean(
    s: AsyncSession, tenant_id: uuid.UUID, file_id: uuid.UUID, store: FileStore
) -> tuple[dict[str, Any], bytes]:
    """The bytes of a file, only if it was scanned clean (R-14)."""
    meta = await describe(s, tenant_id, file_id)
    if meta["scan_status"] != "clean":
        raise ValidationFailed(
            "This file did not pass the virus scan, so it cannot be opened."
            if meta["scan_status"] == "infected"
            else "This file has not been scanned yet."
        )
    key = (
        await s.execute(text("SELECT storage_key FROM control.file WHERE id = :i"), {"i": file_id})
    ).scalar_one()
    return meta, await store.get(key)
