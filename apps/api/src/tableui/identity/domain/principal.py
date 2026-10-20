import uuid
from dataclasses import dataclass, field
from fnmatch import fnmatchcase

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
    scopes: dict[str, str] = field(default_factory=dict)  # table -> all|own_team|own
    field_denies: frozenset[tuple[str, str]] = frozenset()  # (table, field)
    team_ids: frozenset[uuid.UUID] = frozenset()

    def require(self, permission: str) -> None:
        if not self.allows(permission):
            raise PermissionDenied(f"Your role does not allow this ({permission}).")

    def allows(self, permission: str) -> bool:
        """Exact match or a wildcard grant such as ``*`` or ``record.*.read``."""
        if permission in self.permissions:
            return True
        return any("*" in grant and fnmatchcase(permission, grant) for grant in self.permissions)

    def scope_for(self, table: str) -> str:
        return self.scopes.get(table, self.scopes.get("*", "all"))
