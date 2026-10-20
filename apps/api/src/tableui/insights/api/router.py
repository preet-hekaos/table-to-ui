from typing import Annotated, Any

from fastapi import APIRouter, Depends

from tableui.identity.api.deps import PrincipalDep
from tableui.insights.application.analytics import measure_value
from tableui.metadata.api.deps import LiveAppDep
from tableui.platform.db import Database
from tableui.platform.errors import NotFound
from tableui.platform.web import get_analytics

router = APIRouter(prefix="/v1/measures", tags=["measures"])
AnalyticsDep = Annotated[Database, Depends(get_analytics)]


@router.get("")
async def list_measures(
    p: PrincipalDep, app: LiveAppDep, analytics: AnalyticsDep
) -> list[dict[str, Any]]:
    p.require("measure.read")
    assert p.tenant_id
    return [await measure_value(analytics, p.tenant_id, app.measures, m.key) for m in app.measures]


@router.get("/{key}")
async def get_measure(
    key: str, p: PrincipalDep, app: LiveAppDep, analytics: AnalyticsDep
) -> dict[str, Any]:
    p.require("measure.read")
    assert p.tenant_id
    if not any(m.key == key for m in app.measures):
        raise NotFound(f"There is no measure '{key}'.")
    return await measure_value(analytics, p.tenant_id, app.measures, key)
