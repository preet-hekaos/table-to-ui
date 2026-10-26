"""Column profiles and mapping suggestions with a confidence mark."""

import hashlib
import re
from typing import Any

from rapidfuzz import fuzz

from tableui.metadata.public import FieldDef, TableDef

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")
_PHONE = re.compile(r"^\+?[\d\s()-]{8,16}$")
_DATE = re.compile(
    r"^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{1,2}[ -][A-Za-z]{3,9}[ -]\d{2,4})$"
)
_INT = re.compile(r"^-?\d{1,12}$")
_DEC = re.compile(r"^-?\d+[.,]\d+$")
_MONEY = re.compile(
    r"(\blpa\b|\blakh|\blac\b|\bcr\b|\bcrore|₹|\brs\.?(?=\s*\d)|\binr\b|\d+\s*k$)", re.I
)
_MONTHS = re.compile(r"\d\s*(years?|yrs?|months?|mos?)\b", re.I)
_BOOL = {"yes", "no", "y", "n", "true", "false", "1", "0"}

COMPATIBLE: dict[str, set[str]] = {
    "email": {"email"},
    "phone": {"phone", "integer"},
    "date": {"date"},
    "integer": {"integer", "decimal", "money", "months", "reference"},
    "decimal": {"decimal", "money", "months"},
    "money": {"money", "decimal"},
    "months": {"months", "integer", "decimal"},
    "boolean": {"boolean"},
    "select": {"select", "text", "reference", "tags", "boolean"},
    "text": {"text", "long_text", "select", "tags", "reference", "url"},
}


def detect(values: list[str]) -> str:
    vals = [v for v in values if v][:1000]
    if not vals:
        return "text"

    def share(pred: Any) -> float:
        return sum(1 for v in vals if pred(v)) / len(vals)

    if share(lambda v: _EMAIL.match(v)) >= 0.7:
        return "email"
    if share(lambda v: _DATE.match(v)) >= 0.8:
        return "date"
    if share(lambda v: v.lower() in _BOOL) >= 0.9 and len({v.lower() for v in vals}) <= 4:
        return "boolean"
    if share(lambda v: _MONTHS.search(v)) >= 0.6:
        return "months"
    if share(lambda v: _MONEY.search(v)) >= 0.6:
        return "money"
    if share(lambda v: _PHONE.match(v) and len(re.sub(r"\D", "", v)) >= 10) >= 0.8:
        return "phone"
    if share(lambda v: _INT.match(v)) >= 0.9:
        return "integer"
    if share(lambda v: _INT.match(v) or _DEC.match(v)) >= 0.9:
        return "decimal"
    distinct = {v.lower() for v in vals}
    if len(vals) >= 20 and len(distinct) <= 12:
        return "select"
    return "text"


def profile_columns(header: list[str], rows: list[list[str]]) -> list[dict[str, Any]]:
    out = []
    for i, h in enumerate(header):
        col = [r[i] for r in rows]
        filled = [v for v in col if v]
        samples: list[str] = []
        for v in filled:
            if v not in samples:
                samples.append(v)
            if len(samples) == 5:
                break
        out.append(
            {
                "header": h,
                "samples": samples,
                "blanks": len(col) - len(filled),
                "distinct": len(set(filled[:5000])),
                "detected": detect(filled),
            }
        )
    return out


def header_hash(header: list[str]) -> str:
    norm = "|".join(sorted(_norm(h) for h in header))
    return hashlib.sha256(norm.encode()).hexdigest()[:32]


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def _names(f: FieldDef) -> list[str]:
    return [_norm(f.label), _norm(f.key.replace("_", " ")), *(_norm(a) for a in f.aliases)]


def mark(conf: float) -> str:
    return "high" if conf >= 0.85 else "medium" if conf >= 0.6 else "low"


def suggest(profiles: list[dict[str, Any]], table: TableDef) -> list[dict[str, Any]]:
    """Each column's best field, one field per column, best scores first. Low scores stay unmapped."""
    fields = [f for f in table.fields if not f.hidden]
    scored: list[tuple[float, int, str]] = []
    for i, p in enumerate(profiles):
        h = _norm(p["header"])
        for f in fields:
            # token_set gives 100 when one name is part of the other; plain ratio breaks such ties.
            name = (
                max(
                    (0.7 * fuzz.token_set_ratio(h, n) + 0.3 * fuzz.ratio(h, n)) if n else 0
                    for n in _names(f)
                )
                / 100
            )
            exact = h in _names(f)
            fits = f.type in COMPATIBLE.get(p["detected"], set())
            # An exact name or alias is trusted even when a few values look wrong (they fail validation later).
            fit = 0.05 if fits else (-0.1 if exact else -0.25)
            if exact:
                name = 0.95
            scored.append((min(1.0, name + fit), i, f.key))
    scored.sort(reverse=True)
    taken_cols: set[int] = set()
    taken_fields: set[str] = set()
    choice: dict[int, tuple[str, float]] = {}
    for conf, i, key in scored:
        if i in taken_cols or key in taken_fields or conf < 0.55:
            continue
        choice[i] = (key, conf)
        taken_cols.add(i)
        taken_fields.add(key)
    return [
        {
            "header": p["header"],
            "field": choice[i][0] if i in choice else None,
            "confidence": round(choice[i][1], 2) if i in choice else 0.0,
            "mark": mark(choice[i][1]) if i in choice else "none",
        }
        for i, p in enumerate(profiles)
    ]
