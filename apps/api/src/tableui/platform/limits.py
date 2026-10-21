"""Per-workspace limits set by the service operator. Empty means no limit."""

import uuid
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tableui.platform.errors import LimitReached


@dataclass(frozen=True)
class Limits:
    max_people: int | None = None
    max_records: int | None = None
    max_storage_mb: int | None = None


async def get_limits(s: AsyncSession, tenant_id: uuid.UUID) -> Limits:
    r = (
        await s.execute(
            text(
                "SELECT max_people, max_records, max_storage_mb FROM control.tenant_limit WHERE tenant_id = :t"
            ),  # fmt: skip
            {"t": tenant_id},
        )
    ).first()
    return Limits(r.max_people, r.max_records, r.max_storage_mb) if r else Limits()


def reached(what: str, limit: int) -> LimitReached:
    return LimitReached(
        f"This workspace has reached its limit of {limit:,} {what}. "
        "Ask the service owner to raise it; nothing else is affected."
    )
