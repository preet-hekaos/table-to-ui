"""Sessions: opaque tokens, 30-minute idle timeout, MFA state."""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tableui.identity.domain.principal import Principal
from tableui.platform.config import Settings
from tableui.platform.errors import Unauthenticated
from tableui.platform.security import new_token, token_hash


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
                "u.email, u.full_name, u.mfa_enabled, u.active, t.name AS tenant_name, m.role_key "
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
        t = row.tenant_id
        perms = frozenset(
            r.permission
            for r in (
                await s.execute(
                    text(
                        "SELECT permission FROM control.tenant_role_grant "
                        "WHERE tenant_id = :t AND role_key = :r"
                    ),
                    {"t": t, "r": role_key},
                )
            ).all()
        )
        scopes = {
            r.table_key: r.scope
            for r in (
                await s.execute(
                    text(
                        "SELECT table_key, scope FROM control.tenant_role_scope "
                        "WHERE tenant_id = :t AND role_key = :r"
                    ),
                    {"t": t, "r": role_key},
                )
            ).all()
        }
        denies = frozenset(
            (r.table_key, r.field_key)
            for r in (
                await s.execute(
                    text(
                        "SELECT table_key, field_key FROM control.tenant_field_deny "
                        "WHERE tenant_id = :t AND role_key = :r"
                    ),
                    {"t": t, "r": role_key},
                )
            ).all()
        )
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


async def revoke(s: AsyncSession, session_hash: str) -> None:
    await s.execute(
        text("UPDATE control.session SET revoked = true WHERE token_hash = :h"), {"h": session_hash}
    )
