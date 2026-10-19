import re
import uuid

_UUID_HEX = re.compile(r"^[0-9a-f]{32}$")


def new_id() -> uuid.UUID:
    return uuid.uuid4()


def schema_name(tenant_id: uuid.UUID) -> str:
    """Schema name for a tenant. Derived from the UUID only, so it is safe to inline."""
    name = f"t_{tenant_id.hex}"
    if not _UUID_HEX.match(name[2:]):  # pragma: no cover - defensive
        raise ValueError("invalid tenant id")
    return name
