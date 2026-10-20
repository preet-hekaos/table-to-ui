"""Turn spreadsheet text into a field's value: dates, phones, numbers, yes/no, choices, labels."""

import datetime as dt
import re
from typing import Any

from tableui.metadata.public import FieldDef, normalise

_MONTHS = {
    m: i
    for i, m in enumerate(
        ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1
    )
}


def _date(v: str) -> str | None:
    v = v.strip()
    try:
        return dt.date.fromisoformat(v[:10]).isoformat()
    except ValueError:
        pass
    m = re.fullmatch(r"(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})", v)
    if m:  # Indian order: day first
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        y += 2000 if y < 100 else 0
        try:
            return dt.date(y, mo, d).isoformat()
        except ValueError:
            return None
    m = re.fullmatch(r"(\d{1,2})[ -]([A-Za-z]{3,9})[ -](\d{2,4})", v)
    if m and m.group(2)[:3].lower() in _MONTHS:
        y = int(m.group(3))
        y += 2000 if y < 100 else 0
        try:
            return dt.date(y, _MONTHS[m.group(2)[:3].lower()], int(m.group(1))).isoformat()
        except ValueError:
            return None
    return None


def clean_cell(f: FieldDef, raw: str) -> tuple[Any, str | None]:
    """The value to store (still checked by the table's own validation afterwards), or an error."""
    v = raw.strip()
    if v == "":
        return None, None
    t = f.type
    if t == "phone":
        e164 = normalise("phone", v)
        return (e164, None) if e164 else (None, "is not a valid phone number")
    if t == "date":
        d = _date(v)
        return (
            (d, None) if d else (None, "is not a date we can read (use 2026-10-19 or 19/10/2026)")
        )
    if t == "integer":
        s = v.replace(",", "")
        if re.fullmatch(r"-?\d+(\.0+)?", s):
            return int(float(s)), None
        m = re.fullmatch(r"(\d+)\s*(days?|d)", s, re.I)
        return (int(m.group(1)), None) if m else (None, "is not a whole number")
    if t == "decimal":
        try:
            return float(v.replace(",", "")), None
        except ValueError:
            return None, "is not a number"
    if t == "boolean":
        low = v.lower()
        if low in ("yes", "y", "true", "1"):
            return True, None
        if low in ("no", "n", "false", "0"):
            return False, None
        return None, "is not yes or no"
    if t == "select":
        hit = next((o for o in f.options if o.lower() == v.lower()), None)
        return (hit, None) if hit else (None, f"is not one of: {', '.join(f.options)}")
    if t == "tags":
        return [x.strip() for x in re.split(r"[,;|]", v) if x.strip()], None
    return v, None  # text, email, url, money, months, reference: the table's validation decides
