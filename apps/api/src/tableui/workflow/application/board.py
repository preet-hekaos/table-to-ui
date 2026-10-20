"""Board and stage history for any table that has a workflow."""

import uuid
from typing import Any

from tableui.identity.public import Principal
from tableui.metadata.public import RuntimeApp, TableDef, WorkflowDef
from tableui.platform.db import Database
from tableui.platform.errors import NotFound
from tableui.query.public import facet_counts, get_history, list_records

CARDS_PER_STAGE = 25


def _workflow(app: RuntimeApp, table_key: str) -> tuple[TableDef, WorkflowDef]:
    table = app.table(table_key)
    if table.workflow is None:
        raise NotFound(f"'{table.label}' has no stages.")
    return table, table.workflow


async def board(
    db: Database,
    principal: Principal,
    app: RuntimeApp,
    table_key: str,
    filters: dict[str, str],
    q: str | None = None,
) -> dict[str, Any]:
    """Each stage with its true count and its newest cards. Filters narrow every column alike."""
    table, wf = _workflow(app, table_key)
    counted = await facet_counts(
        db, principal, app, table_key, fields=[wf.field], filters=filters, q=q
    )
    counts = {v["value"]: v["count"] for v in counted["facets"].get(wf.field, {}).get("values", [])}
    columns = []
    for stage in wf.stages:
        page = await list_records(
            db,
            principal,
            app,
            table_key,
            filters={**filters, wf.field: stage.key},
            q=q,
            limit=CARDS_PER_STAGE,
        )
        columns.append(
            {
                "stage": stage.key,
                "label": stage.label or stage.key,
                "end": stage.end,
                "count": counts.get(stage.key, 0),
                "cards": page["items"],
                "next": wf.transitions.get(stage.key, []),
            }
        )
    return {
        "table": table.key,
        "field": wf.field,
        "total": counted["total"],
        "columns": columns,
    }


async def stage_history(
    db: Database, principal: Principal, app: RuntimeApp, table_key: str, record_id: uuid.UUID
) -> list[dict[str, Any]]:
    """Every stage change of one record: from, to, who, when, and the reason when one was given."""
    _, wf = _workflow(app, table_key)
    out: list[dict[str, Any]] = []
    for e in await get_history(db, principal, app, table_key, record_id):
        before = (e["before"] or {}).get(wf.field)
        after = (e["after"] or {}).get(wf.field)
        if after is not None and after != before:
            out.append(
                {
                    "from": before,
                    "to": after,
                    "at": e["at"],
                    "actor_id": e["actor_id"],
                    "actor_name": e["actor_name"],
                    "action": e["action"],
                }
            )
    return out
