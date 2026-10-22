"""Sessions: opaque tokens, 30-minute idle timeout, MFA state."""

import uuid
from dataclasses import replace
from datetime import UTC, datetime, timedelta

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tableui.identity.domain.principal import Principal, stricter
from tableui.platform.config import Settings
from tableui.platform.errors import PermissionDenied, Unauthenticated, WorkspaceSuspended
from tableui.platform.security import new_token, token_hash

SUSPENDED_MESSAGE = "This workspace is not available right now. Contact the service owner."


async def create_session(
    s: AsyncSession,
    *,
    user_id: uuid.UUID,
    tenant_id: uuid.UUID | None,
    realm: str,
    mfa_verified: bool,
) -> str:
    token = new_token()
    await s.execute(
        text(
            "INSERT INTO control.session (token_hash, user_id, tenant_id, realm, mfa_verified) "
            "VALUES (:h, :u, :t, :r, :m)"
        ),
        {"h": token_hash(token), "u": user_id, "t": tenant_id, "r": realm, "m": mfa_verified},
    )
    return token


async def authenticate(
    s: AsyncSession,
    token: str | None,
    *,
    realm: str,
    settings: Settings,
    allow_pending: bool = False,
) -> Principal:
    """Resolve a bearer token to a Principal, enforcing realm, idle timeout and MFA."""
    if not token:
        raise Unauthenticated("Sign in to continue.")
    h = token_hash(token)
    row = (
        await s.execute(
            text(
                "SELECT se.user_id, se.tenant_id, se.realm, se.mfa_verified, se.last_seen_at, se.revoked, "
                "u.email, u.full_name, u.mfa_enabled, u.active, t.name AS tenant_name, t.status AS tenant_status, m.role_key "
                "FROM control.session se JOIN control.app_user u ON u.id = se.user_id "
                "LEFT JOIN control.tenant t ON t.id = se.tenant_id "
                "LEFT JOIN control.membership m ON m.user_id = se.user_id AND m.tenant_id = se.tenant_id "
                "WHERE se.token_hash = :h"
            ),
            {"h": h},
        )
    ).first()
    if row is None or row.revoked or row.realm != realm:
        raise Unauthenticated("Your session is not valid. Sign in again.")
    idle = datetime.now(UTC) - row.last_seen_at
    if idle > timedelta(minutes=settings.session_idle_minutes):
        await s.execute(
            text("UPDATE control.session SET revoked = true WHERE token_hash = :h"), {"h": h}
        )
        raise Unauthenticated("Your session timed out after inactivity. Sign in again.")
    if realm == "tenant" and row.tenant_status in ("suspended", "scheduled_deletion"):
        raise WorkspaceSuspended(SUSPENDED_MESSAGE)
    if not row.active:
        raise Unauthenticated("This account has been deactivated. Ask an administrator.")
    needs_mfa = realm == "operator" or row.mfa_enabled
    if needs_mfa and not row.mfa_verified and not allow_pending:
        raise Unauthenticated("Finish the second sign-in step to continue.")
    await s.execute(
        text("UPDATE control.session SET last_seen_at = now() WHERE token_hash = :h"), {"h": h}
    )
    role_key = row.role_key if realm == "tenant" else "platform_operator"
    perms: frozenset[str] = frozenset()
    scopes: dict[str, str] = {}
    denies: frozenset[tuple[str, str]] = frozenset()
    team_ids: frozenset[uuid.UUID] = frozenset()
    if role_key and realm == "tenant":
        perms, scopes, denies = await role_access(s, row.tenant_id, role_key)
        team_ids = frozenset(
            r.team_id
            for r in (
                await s.execute(
                    text("SELECT team_id FROM control.team_member WHERE user_id = :u"),
                    {"u": row.user_id},
                )
            ).all()
        )
    elif role_key:
        perms = frozenset(
            r.permission
            for r in (
                await s.execute(
                    text("SELECT permission FROM control.role_grant WHERE role_key = :r"),
                    {"r": role_key},
                )
            ).all()
        )
    return Principal(
        user_id=row.user_id,
        email=row.email,
        full_name=row.full_name,
        realm=realm,
        tenant_id=row.tenant_id,
        tenant_name=row.tenant_name,
        role_key=role_key,
        permissions=perms,
        mfa_enabled=row.mfa_enabled,
        mfa_verified=row.mfa_verified,
        session_hash=h,
        scopes=scopes,
        field_denies=denies,
        team_ids=team_ids,
    )


async def role_access(
    s: AsyncSession, tenant_id: uuid.UUID, role_key: str
) -> tuple[frozenset[str], dict[str, str], frozenset[tuple[str, str]]]:
    """A workspace role's grants, row scopes and hidden fields."""
    perms = frozenset(
        r.permission
        for r in await s.execute(
            text(
                "SELECT permission FROM control.tenant_role_grant WHERE tenant_id = :t AND role_key = :r"
            ),
            {"t": tenant_id, "r": role_key},
        )
    )
    scopes = {
        r.table_key: r.scope
        for r in await s.execute(
            text(
                "SELECT table_key, scope FROM control.tenant_role_scope WHERE tenant_id = :t AND role_key = :r"
            ),
            {"t": tenant_id, "r": role_key},
        )
    }
    denies = frozenset(
        (r.table_key, r.field_key)
        for r in await s.execute(
            text(
                "SELECT table_key, field_key FROM control.tenant_field_deny WHERE tenant_id = :t AND role_key = :r"
            ),
            {"t": tenant_id, "r": role_key},
        )
    )
    return perms, scopes, denies


async def preview_as(s: AsyncSession, p: Principal, role_key: str, env: str) -> Principal:
    """The builder seen through another role: never more than either of them may see or do."""
    if not p.allows("metadata.read"):
        raise PermissionDenied("Only builders can preview the app as another role.")
    if env not in ("live", "test"):
        raise PermissionDenied("Preview runs against Live or Test.")
    assert p.tenant_id
    exists = (
        await s.execute(
            text("SELECT 1 FROM control.tenant_role WHERE tenant_id = :t AND key = :k"),
            {"t": p.tenant_id, "k": role_key},
        )
    ).first()
    if exists is None:
        raise PermissionDenied(f"There is no role '{role_key}' to preview.")
    perms, scopes, denies = await role_access(s, p.tenant_id, role_key)
    merged = dict(scopes)
    for table, scope in p.scopes.items():
        merged[table] = stricter(merged.get(table, merged.get("*", "all")), scope)
    return replace(
        p,
        role_key=role_key,
        permissions=perms,
        ceiling=p.permissions if p.ceiling is None else p.ceiling,
        scopes=merged,
        field_denies=denies | p.field_denies,
        preview_role=role_key,
        app_env=env,
    )


async def revoke(s: AsyncSession, session_hash: str) -> None:
    await s.execute(
        text("UPDATE control.session SET revoked = true WHERE token_hash = :h"), {"h": session_hash}
    )
