"""Pure rules for automations: texts with {field} slots, conditions, and the date arithmetic."""

import re
from datetime import date, timedelta
from typing import Any

from tableui.metadata.public import TableDef

TOKEN = re.compile(r"\{([a-z_][a-z0-9_]*)(?:\+(\d+))?\}")
WINDOW_DAYS = 7  # a date trigger only catches up this far, so switching one on never floods


def shown(table: TableDef, key: str, value: Any, titles: dict[str, str]) -> str:
    """How a value reads inside a sentence. Reference ids read as the title of what they point at."""
    if value is None:
        return ""
    f = table.field(key)
    if f is not None and f.type == "reference":
        return titles.get(str(value), "")
    if isinstance(value, bool):
        return "yes" if value else "no"
    return str(value)


def render(
    template: str,
    table: TableDef,
    record_id: str,
    data: dict[str, Any],
    titles: dict[str, str],
    today: date,
) -> Any:
    """A whole-template single slot returns the raw value (an id stays an id); otherwise it is text."""
    whole = TOKEN.fullmatch(template.strip())
    if whole:
        name, plus = whole.group(1), whole.group(2)
        if name == "today":
            return (today + timedelta(days=int(plus or 0))).isoformat()
        if name == "id":
            return record_id
        if name == "title":
            return shown(table, table.title_field, data.get(table.title_field), titles)
        return data.get(name)

    def one(m: re.Match[str]) -> str:
        name, plus = m.group(1), m.group(2)
        if name == "today":
            return (today + timedelta(days=int(plus or 0))).isoformat()
        if name == "id":
            return record_id
        if name == "title":
            return shown(table, table.title_field, data.get(table.title_field), titles)
        return shown(table, name, data.get(name), titles)

    return TOKEN.sub(one, template)


def referenced_ids(table: TableDef, texts: list[str], data: dict[str, Any]) -> set[str]:
    """Reference values a set of texts will print, so their titles can be loaded in one go."""
    ids: set[str] = set()
    for t in texts:
        for m in TOKEN.finditer(t):
            name = m.group(1)
            if name == "title":
                name = table.title_field
            f = table.field(name)
            if f is not None and f.type == "reference" and data.get(name):
                ids.add(str(data[name]))
    return ids


def holds(table: TableDef, data: dict[str, Any], where: list[Any]) -> bool:
    """Every condition is true for the record."""
    for c in where:
        v = data.get(c.field)
        f = table.field(c.field)
        empty = v is None or v == "" or v == []
        want = c.value
        if c.op == "empty":
            ok = empty
        elif c.op == "not_empty":
            ok = not empty
        elif empty:
            ok = c.op == "neq"
        elif c.op == "eq":
            ok = str(v) == str(want)
        elif c.op == "neq":
            ok = str(v) != str(want)
        elif c.op == "in":
            ok = str(v) in {str(x) for x in (want if isinstance(want, list) else [want])}
        else:
            try:
                a, b = (str(v), str(want)) if f and f.type == "date" else (float(v), float(want))  # type: ignore[arg-type]
            except (TypeError, ValueError):
                ok = False
            else:
                ok = {"gt": a > b, "gte": a >= b, "lt": a < b, "lte": a <= b}[c.op]  # type: ignore[operator]
        if not ok:
            return False
    return True


def date_window(days: int, today: date) -> tuple[date, date]:
    """The field values whose trigger moment (value + days) fell within the catch-up window."""
    return (
        today - timedelta(days=WINDOW_DAYS + days),
        today - timedelta(days=days),
    )
