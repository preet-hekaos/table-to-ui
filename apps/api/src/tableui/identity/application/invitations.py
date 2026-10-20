"""invitation.send and invitation.accept."""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tableui.audit.public import write_audit
from tableui.identity.application.sessions import create_session
from tableui.identity.domain.principal import Principal
from tableui.platform.config import Settings
from tableui.platform.errors import NotFound, ValidationFailed
from tableui.platform.ids import new_id
from tableui.platform.mail import Mailer
from tableui.platform.security import hash_password, new_token, token_hash


@dataclass(frozen=True)
class InvitationInfo:
    state: str  # valid | expired | used
    email: str | None = None
    tenant_name: str | None = None
    role_key: str | None = None


async def send_invitation(
    s: AsyncSession,
    *,
    principal: Principal,
    email: str,
    role_key: str,
    settings: Settings,
    mailer: Mailer,
    request_id: str | None,
) -> tuple[uuid.UUID, str]:
    """Returns (invitation id, accept link). The link is emailed; callers expose it only in local dev."""
    principal.require("invitation.send")
    assert principal.tenant_id is not None
    email = email.strip().lower()
    if "@" not in email:
        raise ValidationFailed(
            errors=[
                {"field": "email", "code": "invalid", "message": "must be a valid email address"}
            ]
        )
    role = (
        await s.execute(
            text("SELECT key FROM control.role WHERE key = :k AND key <> 'platform_operator'"),
            {"k": role_key},
        )
    ).first()
    if role is None:
        raise ValidationFailed(
            errors=[{"field": "role", "code": "unknown", "message": "is not a role"}]
        )
    token = new_token()
    inv_id = new_id()
    await s.execute(
        text(
            "INSERT INTO control.invitation (id, tenant_id, email, role_key, token_hash, expires_at, created_by) "
            "VALUES (:i, :t, :e, :r, :h, :x, :u)"
        ),
        {
            "i": inv_id,
            "t": principal.tenant_id,
            "e": email,
            "r": role_key,
            "h": token_hash(token),
            "x": datetime.now(UTC) + timedelta(days=settings.invitation_ttl_days),
            "u": principal.user_id,
        },
    )
    await write_audit(
        s,
        tenant_id=principal.tenant_id,
        scope="tenant",
        actor_id=principal.user_id,
        action="invitation.send",
        subject_type="invitation",
        subject_id=str(inv_id),
        detail={"email": email, "role": role_key},
        request_id=request_id,
    )
    link = f"{settings.web_base_url}/accept-invitation?token={token}"
    await mailer.send(
        to=email,
        subject=f"{principal.tenant_name} invited you",
        body=(
            f"{principal.full_name} invited you to join {principal.tenant_name}.\n\n"
            f"Accept the invitation (valid for {settings.invitation_ttl_days} days):\n{link}\n"
        ),
    )
    return inv_id, link


async def describe_invitation(s: AsyncSession, token: str) -> InvitationInfo:
    row = (
        await s.execute(
            text(
                "SELECT i.email, i.role_key, i.expires_at, i.accepted_at, t.name FROM control.invitation i "
                "JOIN control.tenant t ON t.id = i.tenant_id WHERE i.token_hash = :h"
            ),
            {"h": token_hash(token)},
        )
    ).first()
    if row is None:
        return InvitationInfo(state="expired")
    if row.accepted_at is not None:
        return InvitationInfo(state="used")
    if row.expires_at < datetime.now(UTC):
        return InvitationInfo(state="expired", tenant_name=row.name)
    return InvitationInfo(
        state="valid", email=row.email, tenant_name=row.name, role_key=row.role_key
    )


async def accept_invitation(
    s: AsyncSession, *, token: str, full_name: str, password: str, request_id: str | None
) -> tuple[str, uuid.UUID]:
    """Create the user in the inviting tenant with the invited role. Returns (session token, tenant)."""
    row = (
        await s.execute(
            text(
                "SELECT id, tenant_id, email, role_key, expires_at, accepted_at FROM control.invitation "
                "WHERE token_hash = :h FOR UPDATE"
            ),
            {"h": token_hash(token)},
        )
    ).first()
    if row is None or row.accepted_at is not None or row.expires_at < datetime.now(UTC):
        raise NotFound("This invitation has expired or was already used. Ask for a new one.")
    if len(password) < 12 or not full_name.strip():
        raise ValidationFailed(
            errors=[
                {
                    "field": "password",
                    "code": "too_short",
                    "message": "must be at least 12 characters",
                }
                if len(password) < 12
                else {"field": "full_name", "code": "required", "message": "is required"}
            ]
        )
    exists = (
        await s.execute(
            text("SELECT 1 FROM control.app_user WHERE realm = 'tenant' AND email = :e"),
            {"e": row.email},
        )
    ).first()
    if exists:
        raise ValidationFailed("An account with this email already exists. Sign in instead.")
    user_id = new_id()
    await s.execute(
        text(
            "INSERT INTO control.app_user (id, email, full_name, password_hash, realm) "
            "VALUES (:i, :e, :n, :p, 'tenant')"
        ),
        {"i": user_id, "e": row.email, "n": full_name.strip(), "p": hash_password(password)},
    )
    await s.execute(
        text("INSERT INTO control.membership (user_id, tenant_id, role_key) VALUES (:u, :t, :r)"),
        {"u": user_id, "t": row.tenant_id, "r": row.role_key},
    )
    await s.execute(
        text("UPDATE control.invitation SET accepted_at = now() WHERE id = :i"), {"i": row.id}
    )
    await write_audit(
        s,
        tenant_id=row.tenant_id,
        scope="tenant",
        actor_id=user_id,
        action="invitation.accept",
        subject_type="invitation",
        subject_id=str(row.id),
        request_id=request_id,
    )
    session_token = await create_session(
        s, user_id=user_id, tenant_id=row.tenant_id, realm="tenant", mfa_verified=False
    )
    return session_token, row.tenant_id
