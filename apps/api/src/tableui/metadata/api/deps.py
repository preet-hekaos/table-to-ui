import uuid
from typing import Annotated

from fastapi import Depends

from tableui.identity.api.deps import PrincipalDep
from tableui.metadata.application import draft
from tableui.metadata.application.runtime import RuntimeApp, _from_manifest, live_app
from tableui.platform.db import Database
from tableui.platform.errors import NotFound
from tableui.platform.web import get_db


async def get_live_app(
    principal: PrincipalDep, db: Annotated[Database, Depends(get_db)]
) -> RuntimeApp:
    if principal.tenant_id is None:
        raise NotFound("No workspace.")
    if principal.app_env == "draft":
        # The builder's own preview of work not yet sent to Test: built fresh each time, never cached.
        async with db.tenant(principal.tenant_id) as ts:
            content = await draft.build_manifest(ts)
        zero = uuid.UUID(int=0)
        return _from_manifest(zero, 0, zero, content)
    async with db.control() as s:
        return await live_app(s, principal.tenant_id, principal.app_env)


LiveAppDep = Annotated[RuntimeApp, Depends(get_live_app)]
