import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request

from tableui.identity.api.deps import PrincipalDep
from tableui.metadata.api.deps import LiveAppDep
from tableui.platform.db import Database
from tableui.platform.web import get_db
from tableui.workflow.application import board

router = APIRouter(prefix="/v1/workflow", tags=["workflow"])
DbDep = Annotated[Database, Depends(get_db)]


@router.get("/{table}/board")
async def get_board(
    table: str, request: Request, p: PrincipalDep, app: LiveAppDep, db: DbDep, q: str | None = None
) -> dict[str, Any]:
    """Stages as columns. ``f.<field>=<value>`` narrows the board, for example to one parent record."""
    filters = {k[2:]: v for k, v in request.query_params.items() if k.startswith("f.") and v != ""}
    return await board.board(db, p, app, table, filters, q)


@router.get("/{table}/{record_id}/stages")
async def stages(
    table: str, record_id: uuid.UUID, p: PrincipalDep, app: LiveAppDep, db: DbDep
) -> list[dict[str, Any]]:
    return await board.stage_history(db, p, app, table, record_id)
