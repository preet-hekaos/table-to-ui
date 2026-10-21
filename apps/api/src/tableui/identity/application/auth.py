"""Sign-up, sign-in with MFA, lockout. The vendor identity (WorkOS) is swapped in behind this API."""

import uuid
from dataclasses import dataclass

import pyotp
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tableui.audit.public import write_audit
from tableui.identity.application.sessions import SUSPENDED_MESSAGE, create_session
from tableui.identity.domain.ports import OrganisationProvider, TenantProvisioner
from tableui.platform.config import Settings
from tableui.platform.db import Database
from tableui.platform.errors import (
    TooManyAttempts,
    Unauthenticated,
    ValidationFailed,
    WorkspaceSuspended,
)
from tableui.platform.ids import new_id
from tableui.platform.security import hash_password, token_hash, verify_password

ISSUER = "Table to UI"
ISSUER_NAME = ISSUER


@dataclass(frozen=True)
class SignInResult:
    token: str
    mfa_required: bool
    mfa_enrolled: bool
    tenant_id: uuid.UUID | None


def _validate_password(password: str) -> None:
    if len(password) < 12:
        raise ValidationFailed(
            "Choose a stronger password.",
            errors=[
                {
                    "field": "password",
                    "code": "too_short",
                    "message": "must be at least 12 characters",
                }
            ],
        )


async def sign_up(
    db: Database,
    *,
    agency_name: str,
    email: str,
    full_name: str,
    password: str,
    provision: TenantProvisioner,
    org: OrganisationProvider,
    request_id: str | None,
) -> tuple[uuid.UUID, uuid.UUID, str]:
    """Create tenant, schema, owner (admin) and a WorkOS organisation in one operation."""
    errors = []
    if not agency_name.strip():
        errors.append({"field": "agency_name", "code": "required", "message": "is required"})
    if "@" not in email:
        errors.append(
            {"field": "email", "code": "invalid", "message": "must be a valid email address"}
        )
    if not full_name.strip():
        errors.append({"field": "full_name", "code": "required", "message": "is required"})
    if errors:
        raise ValidationFailed(errors=errors)
    _validate_password(password)
    email = email.strip().lower()
    org_id = await org.create(agency_name.strip())
    try:
        async with db.control() as s:
            existing = (
                await s.execute(
                    text("SELECT 1 FROM control.app_user WHERE realm = 'tenant' AND email = :e"),
                    {"e": email},
                )
            ).first()
            if existing:
                raise ValidationFailed(
                    "An account with this email already exists. Sign in instead.",
                    errors=[
                        {"field": "email", "code": "taken", "message": "already has an account"}
                    ],
                )
            tenant = await provision(s, name=agency_name.strip(), workos_org_id=org_id)
            user_id = new_id()
            await s.execute(
                text(
                    "INSERT INTO control.app_user (id, email, full_name, password_hash, realm) "
                    "VALUES (:i, :e, :n, :p, 'tenant')"
                ),
                {"i": user_id, "e": email, "n": full_name.strip(), "p": hash_password(password)},
            )
            await s.execute(
                text(
                    "INSERT INTO control.tenant_role (tenant_id, key, name, description) "
                    "VALUES (:t, 'admin', 'Administrator', 'Full access to everything in the workspace.')"
                ),
                {"t": tenant.id},
            )
            await s.execute(
                text(
                    "INSERT INTO control.tenant_role_grant (tenant_id, role_key, permission) "
                    "VALUES (:t, 'admin', '*')"
                ),
                {"t": tenant.id},
            )
            await s.execute(
                text(
                    "INSERT INTO control.membership (user_id, tenant_id, role_key) VALUES (:u, :t, 'admin')"
                ),
                {"u": user_id, "t": tenant.id},
            )
            await write_audit(
                s,
                tenant_id=tenant.id,
                scope="platform",
                actor_id=user_id,
                action="tenant.provision",
                subject_type="tenant",
                subject_id=str(tenant.id),
                detail={"name": tenant.name},
                request_id=request_id,
            )
            token = await create_session(
                s, user_id=user_id, tenant_id=tenant.id, realm="tenant", mfa_verified=False
            )
    except BaseException:
        await org.delete(org_id)
        raise
    return tenant.id, user_id, token


async def _recent_failures(s: AsyncSession, realm: str, email: str, settings: Settings) -> int:
    return int(
        (
            await s.execute(
                text(
                    "SELECT count(*) FROM control.login_attempt WHERE realm = :r AND email = :e "
                    "AND NOT succeeded AND at > now() - make_interval(mins => :w) "
                    "AND at > COALESCE((SELECT max(at) FROM control.login_attempt WHERE realm = :r "
                    "AND email = :e AND succeeded), '-infinity')"
                ),
                {"r": realm, "e": email, "w": settings.lockout_window_minutes},
            )
        ).scalar_one()
    )


async def _locked(
    s: AsyncSession, realm: str, email: str, settings: Settings, request_id: str | None
) -> bool:
    """True when sign-in is paused. The lock is logged; the caller raises after commit."""
    if await _recent_failures(s, realm, email, settings) < settings.max_failed_logins:
        return False
    await write_audit(
        s,
        tenant_id=None,
        scope="platform",
        actor_id=None,
        action="auth.locked",
        subject_type="user",
        subject_id=email,
        detail={"realm": realm},
        request_id=request_id,
    )
    return True


def _lock_error(settings: Settings) -> TooManyAttempts:
    return TooManyAttempts(
        f"Sign-in is paused for {settings.lockout_window_minutes} minutes after "
        f"{settings.max_failed_logins} failed attempts."
    )


async def _record_attempt(s: AsyncSession, realm: str, email: str, ok: bool) -> None:
    await s.execute(
        text("INSERT INTO control.login_attempt (email, realm, succeeded) VALUES (:e, :r, :ok)"),
        {"e": email, "r": realm, "ok": ok},
    )


async def sign_in(
    db: Database,
    *,
    email: str,
    password: str,
    realm: str,
    settings: Settings,
    request_id: str | None,
) -> SignInResult:
    email = email.strip().lower()
    result: SignInResult | None = None
    locked = False
    unavailable = False
    async with db.control() as s:
        locked = await _locked(s, realm, email, settings, request_id)
        if not locked:
            user = (
                await s.execute(
                    text(
                        "SELECT u.id, u.password_hash, u.mfa_enabled, m.tenant_id, t.status AS tenant_status FROM control.app_user u "
                        "LEFT JOIN control.membership m ON m.user_id = u.id "
                        "LEFT JOIN control.tenant t ON t.id = m.tenant_id "
                        "WHERE u.realm = :r AND u.email = :e ORDER BY m.created_at LIMIT 1"
                    ),
                    {"r": realm, "e": email},
                )
            ).first()
            ok = verify_password(password, user.password_hash if user else "scrypt$00$00")
            if user is None or not ok:
                await _record_attempt(s, realm, email, False)
                await write_audit(
                    s,
                    tenant_id=None,
                    scope="platform",
                    actor_id=None,
                    action="auth.failed",
                    subject_type="user",
                    subject_id=email,
                    detail={"realm": realm},
                    request_id=request_id,
                )
            elif realm == "tenant" and user.tenant_status not in (None, "active", "provisioning"):
                unavailable = True
            else:
                needs_mfa = realm == "operator" or user.mfa_enabled
                token = await create_session(
                    s,
                    user_id=user.id,
                    tenant_id=user.tenant_id,
                    realm=realm,
                    mfa_verified=not needs_mfa,
                )
                if not needs_mfa:
                    await _record_attempt(s, realm, email, True)
                result = SignInResult(
                    token=token,
                    mfa_required=needs_mfa,
                    mfa_enrolled=bool(user.mfa_enabled),
                    tenant_id=user.tenant_id,
                )
    # Raise only after the transaction committed, so failed attempts and locks stay on record.
    if locked:
        raise _lock_error(settings)
    if unavailable:
        raise WorkspaceSuspended(SUSPENDED_MESSAGE)
    if result is None:
        raise Unauthenticated("The email or password is not right.")
    return result


async def verify_mfa(
    db: Database, *, token: str, code: str, realm: str, settings: Settings, request_id: str | None
) -> None:
    h = token_hash(token)
    async with db.control() as s:
        row = (
            await s.execute(
                text(
                    "SELECT se.user_id, se.realm, se.revoked, u.email, u.mfa_secret, u.mfa_enabled "
                    "FROM control.session se JOIN control.app_user u ON u.id = se.user_id "
                    "WHERE se.token_hash = :h"
                ),
                {"h": h},
            )
        ).first()
        if row is None or row.revoked or row.realm != realm or not row.mfa_secret:
            raise Unauthenticated("Your sign-in expired. Start again.")
        locked = await _locked(s, realm, row.email, settings, request_id)
        ok = (not locked) and pyotp.TOTP(row.mfa_secret).verify(code.strip(), valid_window=1)
        if ok:
            await s.execute(
                text(
                    "UPDATE control.session SET mfa_verified = true, last_seen_at = now() WHERE token_hash = :h"
                ),
                {"h": h},
            )
            await _record_attempt(s, realm, row.email, True)
            if realm == "operator":
                await write_audit(
                    s,
                    tenant_id=None,
                    scope="platform",
                    actor_id=row.user_id,
                    action="operator.sign_in",
                    request_id=request_id,
                )
        elif not locked:
            await _record_attempt(s, realm, row.email, False)
    if locked:
        raise _lock_error(settings)
    if not ok:
        raise Unauthenticated("That code is not right.")


async def start_mfa_enrolment(s: AsyncSession, *, user_id: uuid.UUID, email: str) -> dict[str, str]:
    secret = pyotp.random_base32()
    await s.execute(
        text("UPDATE control.app_user SET mfa_secret = :s, mfa_enabled = false WHERE id = :u"),
        {"s": secret, "u": user_id},
    )
    return {
        "secret": secret,
        "otpauth_uri": pyotp.TOTP(secret).provisioning_uri(email, issuer_name=ISSUER),
    }


async def confirm_mfa_enrolment(
    s: AsyncSession, *, user_id: uuid.UUID, session_hash: str, code: str
) -> None:
    secret = (
        await s.execute(
            text("SELECT mfa_secret FROM control.app_user WHERE id = :u"), {"u": user_id}
        )
    ).scalar_one_or_none()
    if not secret or not pyotp.TOTP(secret).verify(code.strip(), valid_window=1):
        raise ValidationFailed(
            "That code is not right.",
            errors=[{"field": "code", "code": "invalid", "message": "is not right"}],
        )
    await s.execute(
        text("UPDATE control.app_user SET mfa_enabled = true WHERE id = :u"), {"u": user_id}
    )
    await s.execute(
        text("UPDATE control.session SET mfa_verified = true WHERE token_hash = :h"),
        {"h": session_hash},
    )
