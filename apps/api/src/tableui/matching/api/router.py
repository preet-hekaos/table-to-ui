import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from tableui.identity.api.deps import PrincipalDep
from tableui.matching.application import match
from tableui.metadata.api.deps import LiveAppDep
from tableui.platform.db import Database
from tableui.platform.errors import ValidationFailed
from tableui.platform.web import get_db, get_request_id

router = APIRouter(prefix="/v1/matching", tags=["matching"])
DbDep = Annotated[Database, Depends(get_db)]


@router.get("/{screen}/{source_id}")
async def ranked(
    screen: str, source_id: uuid.UUID, request: Request, p: PrincipalDep, app: LiveAppDep, db: DbDep
) -> dict[str, Any]:
    """Ranked matches; ``w.<part>=<weight>`` changes the weights for this view only."""
    try:
        view = {k[2:]: float(v) for k, v in request.query_params.items() if k.startswith("w.")}
    except ValueError:
        raise ValidationFailed(
            errors=[{"field": "weights", "code": "invalid", "message": "must be numbers"}]
        ) from None
    return await match.matches(db, p, app, screen, source_id, view)


class WeightsIn(BaseModel):
    weights: dict[str, float]


@router.put("/{screen}/weights")
async def save_weights(
    screen: str, body: WeightsIn, request: Request, p: PrincipalDep, app: LiveAppDep, db: DbDep
) -> dict[str, float]:
    return await match.save_weights(db, p, app, screen, body.weights, get_request_id(request))
