import uuid
from dataclasses import dataclass

from tableui.platform.errors import PermissionDenied


@dataclass(frozen=True)
class Principal:
    user_id: uuid.UUID
    email: str
    full_name: str
    realm: str
    tenant_id: uuid.UUID | None
    tenant_name: str | None
    role_key: str | None
    permissions: frozenset[str]
    mfa_enabled: bool
    mfa_verified: bool
    session_hash: str

    def require(self, permission: str) -> None:
        if permission not in self.permissions:
            raise PermissionDenied(f"Your role does not allow this ({permission}).")
