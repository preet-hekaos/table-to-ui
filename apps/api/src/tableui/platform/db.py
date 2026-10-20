"""Database access. Two kinds of session exist and they are deliberately different:

* ``control()``: platform tables (tenants, users, releases). Runs as the owner role.
* ``tenant(tenant_id)``: one tenant's schema. Drops to the restricted ``tableui_runtime``
  role, pins ``search_path`` to that tenant's schema and sets ``app.tenant_id`` for
  row-level security. Without a tenant id it raises, so data access fails closed.
"""

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from tableui.platform.errors import TenantContextMissing
from tableui.platform.ids import schema_name

RUNTIME_ROLE = "tableui_runtime"


class Database:
    def __init__(self, url: str, *, pool_size: int = 10) -> None:
        self.engine: AsyncEngine = create_async_engine(url, pool_size=pool_size, max_overflow=10)
        self._factory = async_sessionmaker(self.engine, expire_on_commit=False)

    @asynccontextmanager
    async def control(self) -> AsyncIterator[AsyncSession]:
        async with self._factory() as session, session.begin():
            yield session

    @asynccontextmanager
    async def tenant(self, tenant_id: uuid.UUID | None) -> AsyncIterator[AsyncSession]:
        if tenant_id is None:
            raise TenantContextMissing("tenant data requested without a tenant context")
        schema = schema_name(tenant_id)
        async with self._factory() as session, session.begin():
            await session.execute(text(f"SET LOCAL ROLE {RUNTIME_ROLE}"))
            await session.execute(
                text("SELECT set_config('app.tenant_id', :t, true)"), {"t": str(tenant_id)}
            )
            await session.execute(text(f'SET LOCAL search_path TO "{schema}", pg_catalog'))
            yield session

    async def dispose(self) -> None:
        await self.engine.dispose()
