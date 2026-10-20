"""Stage moves as rule outcomes: a table's workflow says which moves are allowed (R-05)."""

from typing import Any

from tableui.metadata.public import TableDef
from tableui.rules.domain.engine import Outcome

RULE_ID = "R-05"


def full(table: TableDef, data: dict[str, Any] | None) -> dict[str, Any]:
    """A record with every field present (None when empty), so rules can read any field safely."""
    return {**{f.key: None for f in table.fields}, **(data or {})}


def transition_outcomes(
    table: TableDef, before: dict[str, Any] | None, after: dict[str, Any], creating: bool
) -> list[Outcome]:
    """A new record starts at the first stage; an existing one may only take an allowed move."""
    wf = table.workflow
    if wf is None:
        return []
    new = after.get(wf.field)
    if creating:
        if new is not None and new != wf.first:
            return [
                Outcome(
                    RULE_ID,
                    f"{RULE_ID}.start",
                    "block",
                    f"A new entry starts at {_label(table, wf.first)}, not {_label(table, new)}.",
                    None,
                    True,
                )
            ]
        return []
    old = (before or {}).get(wf.field)
    if old == new or old is None:
        return []
    current = wf.stage(old)
    if current is not None and current.end:
        return [
            Outcome(
                RULE_ID,
                f"{RULE_ID}.ended",
                "block",
                f"{_label(table, old)} is an end state. Reopen the entry before moving it on.",
                None,
                True,
            )
        ]
    if new not in wf.transitions.get(old, []):
        return [
            Outcome(
                RULE_ID,
                f"{RULE_ID}.transition",
                "block",
                f"An entry cannot move from {_label(table, old)} to {_label(table, new)}. "
                f"Allowed next steps: {', '.join(_label(table, t) for t in wf.transitions.get(old, [])) or 'none'}.",
                None,
                True,
            )
        ]
    return []


def _label(table: TableDef, key: Any) -> str:
    wf = table.workflow
    st = wf.stage(key) if wf else None
    return (st.label or st.key) if st else str(key)
