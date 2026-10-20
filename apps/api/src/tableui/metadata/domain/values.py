"""Normalisation and validation of record values, driven entirely by field metadata."""

import datetime as dt
import re
import uuid
from typing import Any

import phonenumbers

from tableui.metadata.domain.models import FieldDef, TableDef

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_URL = re.compile(r"^https?://\S+$")
DEFAULT_REGION = "IN"


def normalise(kind: str, value: Any) -> str | None:
    if value is None or value == "":
        return None
    text = str(value).strip()
    if kind == "email":
        return text.lower()
    if kind == "phone":
        try:
            num = phonenumbers.parse(text, DEFAULT_REGION)
        except phonenumbers.NumberParseException:
            return None
        if not phonenumbers.is_possible_number(num):
            return None
        return phonenumbers.format_number(num, phonenumbers.PhoneNumberFormat.E164)
    return re.sub(r"\s+", " ", text).casefold()


_MONEY = re.compile(r"^\s*(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d+)?)\s*(lpa|l|lac|lakh|lakhs|cr|crore|crores|k|m)?\s*(?:p\.?a\.?|pa)?\s*$", re.I)
_MULT = {None: 1, "k": 1_000, "m": 1_000_000, "l": 100_000, "lac": 100_000, "lakh": 100_000, "lakhs": 100_000,
         "lpa": 100_000, "cr": 10_000_000, "crore": 10_000_000, "crores": 10_000_000}
_DUR = re.compile(r"(\d+(?:\.\d+)?)\s*(years?|yrs?|y|months?|mos?|mo|m)\b", re.I)


def parse_money(value: Any) -> float | None:
    """'12.5 LPA' -> 1250000, '₹12,50,000' -> 1250000, '1.2 Cr' -> 12000000. None when unreadable."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        return float(value)
    m = _MONEY.match(str(value))
    if not m:
        return None
    unit = (m.group(2) or "").lower() or None
    return round(float(m.group(1).replace(",", "")) * _MULT[unit], 2)


def parse_months(value: Any) -> int | None:
    """'5 yrs 3 mo' -> 63, '5.5 years' -> 66, '18 months' -> 18, 24 -> 24. None when unreadable."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return round(value)
    text_ = str(value).strip()
    if re.fullmatch(r"\d+", text_):
        return int(text_)
    parts = _DUR.findall(text_)
    if not parts:
        return None
    total = 0.0
    for num, unit in parts:
        total += float(num) * (12 if unit.lower().startswith("y") else 1)
    return round(total)


def _coerce(field: FieldDef, value: Any) -> tuple[Any, str | None]:
    t = field.type
    if t in ("text", "long_text"):
        if not isinstance(value, str):
            return None, "must be text"
        value = value.strip()
        if field.max_length and len(value) > field.max_length:
            return None, f"must be at most {field.max_length} characters"
        return value, None
    if t == "email":
        if not isinstance(value, str) or not _EMAIL.match(value.strip()):
            return None, "must be a valid email address"
        return value.strip(), None
    if t == "phone":
        if not isinstance(value, str) or normalise("phone", value) is None:
            return None, "must be a valid phone number"
        return value.strip(), None
    if t == "url":
        if not isinstance(value, str) or not _URL.match(value.strip()):
            return None, "must be a web address starting with http:// or https://"
        return value.strip(), None
    if t == "integer":
        if isinstance(value, bool) or not isinstance(value, int):
            return None, "must be a whole number"
        if field.min is not None and value < field.min:
            return None, f"must be at least {field.min:g}"
        if field.max is not None and value > field.max:
            return None, f"must be at most {field.max:g}"
        return value, None
    if t == "decimal":
        if isinstance(value, bool) or not isinstance(value, int | float):
            return None, "must be a number"
        return value, None
    if t == "boolean":
        return (value, None) if isinstance(value, bool) else (None, "must be true or false")
    if t == "date":
        try:
            dt.date.fromisoformat(str(value))
        except ValueError:
            return None, "must be a date like 2026-10-19"
        return str(value), None
    if t == "money":
        amount = parse_money(value)
        if amount is None or amount < 0:
            return None, "must be an amount like 1250000 or 12.5 LPA"
        return amount, None
    if t == "months":
        months = parse_months(value)
        if months is None or months < 0:
            return None, "must be a duration like 63 or 5 yrs 3 mo"
        return months, None
    if t == "tags":
        items = value if isinstance(value, list) else [p for p in str(value).split(",")]
        tags = [str(i).strip() for i in items if str(i).strip()]
        if len(tags) > 100 or any(len(x) > 60 for x in tags):
            return None, "has too many or too long labels"
        return tags, None
    if t == "reference":
        try:
            uuid.UUID(str(value))
        except ValueError:
            return None, "must link to an existing record"
        return str(value), None
    if t == "select":
        if value not in field.options:
            return None, "must be one of: " + ", ".join(field.options)
        return value, None
    return None, "unsupported field type"  # pragma: no cover


def validate_record(
    table: TableDef, payload: dict[str, Any], *, partial: bool
) -> tuple[dict[str, Any], list[dict[str, str]]]:
    """Return (clean data, field errors). ``partial`` is true for updates."""
    errors: list[dict[str, str]] = []
    clean: dict[str, Any] = {}
    known = {f.key for f in table.fields}
    for key in payload:
        if key not in known:
            errors.append({"field": key, "code": "unknown_field", "message": "is not a field"})
    for f in table.fields:
        present = f.key in payload and payload[f.key] not in (None, "")
        if not present:
            if partial and f.key not in payload:
                continue
            if f.default is not None and not partial:
                clean[f.key] = f.default
            elif f.required:
                errors.append({"field": f.key, "code": "required", "message": "is required"})
            elif f.key in payload:
                clean[f.key] = None
            continue
        value, err = _coerce(f, payload[f.key])
        if err:
            errors.append({"field": f.key, "code": "invalid", "message": err})
        else:
            clean[f.key] = value
    return clean, errors


def shadow_columns(table: TableDef, data: dict[str, Any]) -> dict[str, str | None]:
    """The ``<field>_norm`` values stored beside the record for matching and uniqueness."""
    return {
        f"{f.key}_norm": normalise(f.normalize, data.get(f.key))
        for f in table.fields
        if f.normalize
    }


def search_document(table: TableDef, data: dict[str, Any]) -> str:
    """Lower-cased text of the searchable fields, stored beside the record for trigram/FTS search."""
    parts: list[str] = []
    for f in table.fields:
        if not (f.searchable or f.key == table.title_field):
            continue
        v = data.get(f.key)
        if v is None or v == "":
            continue
        if isinstance(v, list):
            parts.extend(str(x) for x in v)
        else:
            parts.append(str(v))
    return " ".join(parts).lower()
