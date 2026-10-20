import uuid


class LocalOrganisationProvider:
    """Stand-in used until a WorkOS account is connected. Creates ids only."""

    async def create(self, name: str) -> str:
        return f"local_org_{uuid.uuid4().hex[:12]}"

    async def delete(self, org_id: str) -> None:
        return None
