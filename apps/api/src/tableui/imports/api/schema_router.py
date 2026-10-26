from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Request, UploadFile
from pydantic import BaseModel

from tableui.identity.api.deps import PrincipalDep
from tableui.imports.application import schema_import
from tableui.imports.domain.schema_read import MAX_BYTES
from tableui.platform.db import Database
from tableui.platform.errors import ValidationFailed
from tableui.platform.web import get_db, get_request_id

router = APIRouter(prefix="/v1/studio/schema-import", tags=["studio"])
DbDep = Annotated[Database, Depends(get_db)]


class ApplyIn(BaseModel):
    tables: list[dict[str, Any]]


@router.post("/preview")
async def preview(
    p: PrincipalDep, db: DbDep, files: Annotated[list[UploadFile], File()]
) -> dict[str, Any]:
    """Read the files and say which tables they would make. Nothing is saved."""
    p.require("metadata.write")
    assert p.tenant_id
    if not files:
        raise ValidationFailed(
            errors=[{"field": "files", "code": "invalid", "message": "Add at least one file."}]
        )
    loaded = []
    for f in files[:10]:
        data = await f.read(MAX_BYTES + 1)
        loaded.append((f.filename or "file", f.content_type or "", data))
    async with db.control() as s:
        return await schema_import.preview(s, p.tenant_id, loaded)


@router.post("/apply", status_code=201)
async def apply(body: ApplyIn, p: PrincipalDep, db: DbDep, request: Request) -> dict[str, Any]:
    """Create the confirmed tables in the Draft, all or none."""
    p.require("metadata.write")
    assert p.tenant_id
    async with db.control() as s:
        return await schema_import.apply(
            s,
            tenant_id=p.tenant_id,
            user_id=p.user_id,
            tables=body.tables,
            request_id=get_request_id(request),
        )
