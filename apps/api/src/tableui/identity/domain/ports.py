import uuid
from typing import Protocol

from sqlalchemy.ext.asyncio import AsyncSession


class OrganisationProvider(Protocol):
    """The identity vendor's notion of a customer organisation (WorkOS in production)."""

    async def create(self, name: str) -> str: ...
    async def delete(self, org_id: str) -> None: ...


class ProvisionedTenant(Protocol):
    @property
    def id(self) -> uuid.UUID: ...
    @property
    def name(self) -> str: ...


class TenantProvisioner(Protocol):
    """Creates a tenant (row, schema, Draft) inside the caller's transaction."""

    async def __call__(
        self, session: AsyncSession, *, name: str, workos_org_id: str | None
    ) -> ProvisionedTenant: ...
