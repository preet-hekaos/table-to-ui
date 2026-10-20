"""Platform operators live in their own realm and always use MFA. Created from the command line."""

import pyotp
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tableui.identity.public import ISSUER_NAME
from tableui.platform.ids import new_id
from tableui.platform.security import hash_password


async def create_operator(
    s: AsyncSession, *, email: str, full_name: str, password: str
) -> dict[str, str]:
    secret = pyotp.random_base32()
    await s.execute(
        text(
            "INSERT INTO control.app_user (id, email, full_name, password_hash, mfa_secret, mfa_enabled, realm) "
            "VALUES (:i, :e, :n, :p, :s, true, 'operator')"
        ),
        {
            "i": new_id(),
            "e": email.strip().lower(),
            "n": full_name,
            "p": hash_password(password),
            "s": secret,
        },
    )
    return {
        "secret": secret,
        "otpauth_uri": pyotp.TOTP(secret).provisioning_uri(email, issuer_name=ISSUER_NAME),
    }
