"""Workspace record limit, set by the service operator. Checked before a record is created."""

from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tableui.platform.db import Database
from tableui.platform.limits import get_limits, reached


async def record_limit(db: Database, tenant_id: Any) -> int | None:
    async with db.control() as c:
        return (await get_limits(c, tenant_id)).max_records


async def check_record_limit(s: AsyncSession, tables: list[str], limit: int | None, adding: int = 1) -> None:  # fmt: skip
    """Count only when a limit is set, so workspaces without one pay nothing."""
    if limit is None:
        return
    used = 0
    for key in tables:
        used += int((await s.execute(text(f'SELECT count(*) FROM "{key}"'))).scalar_one())  # noqa: S608 - keys are validated metadata
    if used + adding > limit:
        raise reached("records", limit)
