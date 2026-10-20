import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import Response

from tableui.files.application import files
from tableui.identity.api.deps import PrincipalDep
from tableui.platform.db import Database
from tableui.platform.web import get_db, get_request_id

router = APIRouter(prefix="/v1/files", tags=["files"])
DbDep = Annotated[Database, Depends(get_db)]
PERMISSION = {
    "logo": "workspace.manage",
    "import": "import.run",
    "cv": "document.upload",
}


@router.post("", status_code=201)
async def upload(
    request: Request,
    p: PrincipalDep,
    db: DbDep,
    kind: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
) -> dict[str, Any]:
    p.require(PERMISSION.get(kind, "workspace.manage"))
    assert p.tenant_id
    data = await file.read()
    async with db.control() as s:
        return await files.upload(
            s,
            tenant_id=p.tenant_id,
            user_id=p.user_id,
            kind=kind,
            name=file.filename or "file",
            data=data,
            store=request.app.state.file_store,
            scanner=request.app.state.scanner,
            request_id=get_request_id(request),
        )


@router.get("/{file_id}")
async def describe(file_id: uuid.UUID, p: PrincipalDep, db: DbDep) -> dict[str, Any]:
    assert p.tenant_id
    async with db.control() as s:
        return await files.describe(s, p.tenant_id, file_id)


@router.get("/{file_id}/content")
async def content(file_id: uuid.UUID, request: Request, p: PrincipalDep, db: DbDep) -> Response:
    assert p.tenant_id
    async with db.control() as s:
        meta, data = await files.read_clean(s, p.tenant_id, file_id, request.app.state.file_store)
    return Response(
        data,
        media_type=meta["content_type"],
        headers={
            "Content-Disposition": f'inline; filename="{meta["name"]}"',
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, max-age=3600",
        },
    )
