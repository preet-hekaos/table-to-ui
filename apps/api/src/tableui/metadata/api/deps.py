from typing import Annotated

from fastapi import Depends

from tableui.identity.api.deps import PrincipalDep
from tableui.metadata.application.runtime import RuntimeApp, live_app
from tableui.platform.db import Database
from tableui.platform.errors import NotFound
from tableui.platform.web import get_db


async def get_live_app(
    principal: PrincipalDep, db: Annotated[Database, Depends(get_db)]
) -> RuntimeApp:
    if principal.tenant_id is None:
        raise NotFound("No workspace.")
    async with db.control() as s:
        return await live_app(s, principal.tenant_id)


LiveAppDep = Annotated[RuntimeApp, Depends(get_live_app)]
