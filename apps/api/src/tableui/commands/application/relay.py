"""Outbox relay: publish unpublished events at least once, in order per tenant."""

import uuid
from collections.abc import Awaitable, Callable

from sqlalchemy import text

from tableui.platform.db import Database
from tableui.platform.messaging import Publisher


class OutboxRelay:
    def __init__(
        self,
        db: Database,
        publisher: Publisher,
        list_tenants: Callable[[], Awaitable[list[uuid.UUID]]],
    ) -> None:
        self._db, self._publisher, self._list_tenants = db, publisher, list_tenants

    async def run_once(self, batch: int = 100) -> int:
        sent = 0
        for tenant_id in await self._list_tenants():
            sent += await self._drain(tenant_id, batch)
        return sent

    async def _drain(self, tenant_id: uuid.UUID, batch: int) -> int:
        async with self._db.tenant(tenant_id) as s:
            rows = (
                await s.execute(
                    text(
                        "SELECT id, payload FROM outbox WHERE published_at IS NULL "
                        "ORDER BY id LIMIT :n FOR UPDATE SKIP LOCKED"
                    ),
                    {"n": batch},
                )
            ).all()
            for r in rows:
                # Publish first, then mark: a crash in between re-publishes (at-least-once).
                await self._publisher.publish(r.payload)
                await s.execute(
                    text("UPDATE outbox SET published_at = now() WHERE id = :i"), {"i": r.id}
                )
            return len(rows)
