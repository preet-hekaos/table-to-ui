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
    # Preview as another role: what the builder may do caps what the previewed role may do.
    ceiling: frozenset[str] | None = None
    preview_role: str | None = None
    app_env: str = "live"  # which release the app runs: live, or test while previewing

    def require(self, permission: str) -> None:
        if not self.allows(permission):
            raise PermissionDenied(f"Your role does not allow this ({permission}).")

    def allows(self, permission: str) -> bool:
        """Exact match or a wildcard grant such as ``*`` or ``record.*.read``."""
        if not _matches(self.permissions, permission):
            return False
        return self.ceiling is None or _matches(self.ceiling, permission)

    def scope_for(self, table: str) -> str:
        return self.scopes.get(table, self.scopes.get("*", "all"))


def _matches(grants: frozenset[str], permission: str) -> bool:
    if permission in grants:
        return True
    return any("*" in grant and fnmatchcase(permission, grant) for grant in grants)


_STRICTNESS = {"all": 0, "own_team": 1, "own": 2}


def stricter(a: str, b: str) -> str:
    return a if _STRICTNESS.get(a, 0) >= _STRICTNESS.get(b, 0) else b
