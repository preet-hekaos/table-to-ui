import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from tableui.commands.public import CommandContext
from tableui.files.application import documents, files
from tableui.identity.api.deps import PrincipalDep
from tableui.metadata.api.deps import LiveAppDep
from tableui.platform.db import Database
from tableui.platform.errors import NotFound
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


documents_router = APIRouter(prefix="/v1/documents", tags=["files"])


@documents_router.post("/{file_id}/parse")
async def parse_document(
    file_id: uuid.UUID, request: Request, p: PrincipalDep, db: DbDep
) -> dict[str, Any]:
    """Read an uploaded document into fields. Refused unless it was scanned clean (R-14)."""
    p.require("document.upload")
    assert p.tenant_id
    async with db.control() as s:
        return await documents.parse(
            s,
            tenant_id=p.tenant_id,
            user_id=p.user_id,
            file_id=file_id,
            store=request.app.state.file_store,
            parser=request.app.state.document_parser,
            request_id=get_request_id(request),
        )


@documents_router.get("/{file_id}/parse")
async def parse_state(file_id: uuid.UUID, p: PrincipalDep, db: DbDep) -> dict[str, Any]:
    assert p.tenant_id
    async with db.control() as s:
        return await documents.get_parse(s, p.tenant_id, file_id)


class ConfirmIn(BaseModel):
    screen: str
    data: dict[str, Any] = {}
    existing_id: uuid.UUID | None = None


@documents_router.post("/{file_id}/confirm", status_code=201)
async def confirm_document(
    file_id: uuid.UUID,
    body: ConfirmIn,
    request: Request,
    p: PrincipalDep,
    db: DbDep,
    app: LiveAppDep,
) -> dict[str, Any]:
    """document.confirm_parse: create the record from the reviewed fields and file the document."""
    p.require("document.upload")
    screen = app.screens.get(body.screen)
    if screen is None or screen.pattern != "document_review":
        raise NotFound(f"There is no document screen '{body.screen}'.")
    ctx = CommandContext(
        principal=p,
        app=app,
        app_version=request.app.state.settings.app_version,
        request_id=get_request_id(request),
    )
    return await documents.confirm(
        db,
        ctx,
        screen=screen,
        file_id=file_id,
        data=body.data,
        existing_id=body.existing_id,
        store=request.app.state.file_store,
    )
