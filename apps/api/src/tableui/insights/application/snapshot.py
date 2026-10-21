"""One measure's number and series for the signed-in person, for other modules to read."""

import datetime as dt
from typing import Any

from tableui.identity.public import Principal, scope_predicate
from tableui.insights.application import analytics as store
from tableui.insights.application import engine
from tableui.metadata.public import RuntimeApp
from tableui.platform.db import Database
from tableui.platform.errors import NotFound


async def snapshot(
    db: Database,
    analytics: Database,
    p: Principal,
    app: RuntimeApp,
    key: str,
    *,
    range: str | None = None,  # noqa: A002 - the public name of the range
    start: dt.date | None = None,
    end: dt.date | None = None,
) -> dict[str, Any]:
    assert p.tenant_id
    p.require("measure.read")
    m = next((x for x in app.measures if x.key == key), None)
    if m is None or not p.allows(f"record.{m.table}.read"):
        raise NotFound(f"There is no measure '{key}'.")
    await store.refresh_if_stale(
        analytics, db, p.tenant_id, list(app.tables.values()), app.manifest_id
    )
    first, last = engine.resolve_range(range, start, end)
    scope_sql, scope_params = await scope_predicate(db, p, m.table)
    return await engine.run_measure(
        analytics, p.tenant_id, m, app.table(m.table),
        scope_sql=scope_sql, scope_params=scope_params, start=first, end=last,
    )  # fmt: skip
