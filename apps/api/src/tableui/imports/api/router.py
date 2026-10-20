import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from pydantic import BaseModel

from tableui.commands.public import CommandContext
from tableui.identity.api.deps import PrincipalDep
from tableui.imports.application import jobs
from tableui.metadata.api.deps import LiveAppDep
from tableui.platform.db import Database
from tableui.platform.web import get_db, get_request_id

router = APIRouter(prefix="/v1/imports", tags=["imports"])
DbDep = Annotated[Database, Depends(get_db)]


class CreateIn(BaseModel):
    file_id: uuid.UUID
    table: str


class MappingIn(BaseModel):
    mapping: dict[str, str | None]


class ResolveIn(BaseModel):
    rows: dict[str, dict[str, Any]]


def _ctx(p: Any, app: Any, request: Request) -> CommandContext:
    return CommandContext(
        principal=p,
        app=app,
        app_version=request.app.state.settings.app_version,
        request_id=get_request_id(request),
    )


@router.post("", status_code=201)
async def create(
    body: CreateIn, request: Request, p: PrincipalDep, db: DbDep, app: LiveAppDep
) -> dict[str, Any]:
    p.require("import.run")
    p.require(f"record.{body.table}.create")
    assert p.tenant_id
    async with db.control() as s:
        return await jobs.create(
            s,
            tenant_id=p.tenant_id,
            user_id=p.user_id,
            app=app,
            table_key=body.table,
            file_id=body.file_id,
            store=request.app.state.file_store,
        )


@router.get("")
async def history(p: PrincipalDep, db: DbDep) -> list[dict[str, Any]]:
    p.require("import.run")
    assert p.tenant_id
    async with db.control() as s:
        return await jobs.history(s, p.tenant_id)


@router.get("/{job_id}")
async def get(job_id: uuid.UUID, p: PrincipalDep, db: DbDep) -> dict[str, Any]:
    p.require("import.run")
    assert p.tenant_id
    async with db.control() as s:
        return await jobs.get(s, p.tenant_id, job_id)


@router.put("/{job_id}/mapping")
async def mapping(
    job_id: uuid.UUID, body: MappingIn, p: PrincipalDep, db: DbDep, app: LiveAppDep
) -> dict[str, Any]:
    p.require("import.run")
    assert p.tenant_id
    async with db.control() as s:
        return await jobs.save_mapping(
            s, tenant_id=p.tenant_id, app=app, job_id=job_id, mapping=body.mapping
        )


@router.post("/{job_id}/validate")
async def validate(
    job_id: uuid.UUID, request: Request, p: PrincipalDep, db: DbDep, app: LiveAppDep
) -> dict[str, Any]:
    p.require("import.run")
    assert p.tenant_id
    return await jobs.validate(
        db, tenant_id=p.tenant_id, app=app, job_id=job_id, store=request.app.state.file_store
    )


@router.put("/{job_id}/resolutions")
async def resolve(
    job_id: uuid.UUID, body: ResolveIn, request: Request, p: PrincipalDep, db: DbDep
) -> dict[str, Any]:
    p.require("import.run")
    assert p.tenant_id
    async with db.control() as s:
        return await jobs.resolve(
            s,
            tenant_id=p.tenant_id,
            user_id=p.user_id,
            job_id=job_id,
            rows=body.rows,
            request_id=get_request_id(request),
        )


@router.post("/{job_id}/start", status_code=202)
async def start(
    job_id: uuid.UUID, request: Request, p: PrincipalDep, db: DbDep, app: LiveAppDep
) -> dict[str, Any]:
    p.require("import.run")
    return await jobs.start(
        db, _ctx(p, app, request), job_id=job_id, store=request.app.state.file_store
    )


class NewFieldIn(BaseModel):
    header: str
    label: str
    type: str
    options: list[str] = []


@router.post("/{job_id}/fields", status_code=201)
async def new_field(
    job_id: uuid.UUID, body: NewFieldIn, request: Request, p: PrincipalDep, db: DbDep
) -> dict[str, Any]:
    """Create a workspace field for an unmatched column and publish it so the import can use it."""
    p.require("import.run")
    p.require("metadata.write")
    p.require("release.publish")
    assert p.tenant_id
    return await jobs.add_field_for_column(
        db, principal=p, job_id=job_id, header=body.header, label=body.label, ftype=body.type,
        options=body.options, request_id=get_request_id(request),
    )  # fmt: skip


@router.post("/{job_id}/undo")
async def undo(
    job_id: uuid.UUID, request: Request, p: PrincipalDep, db: DbDep, app: LiveAppDep
) -> dict[str, Any]:
    p.require("import.run")
    return await jobs.undo(db, _ctx(p, app, request), job_id=job_id)


@router.get("/{job_id}/errors.csv")
async def errors(job_id: uuid.UUID, p: PrincipalDep, db: DbDep) -> Response:
    p.require("import.run")
    assert p.tenant_id
    async with db.control() as s:
        body = await jobs.error_file(s, p.tenant_id, job_id)
    return Response(
        body,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="import-{job_id}-errors.csv"'},
    )
