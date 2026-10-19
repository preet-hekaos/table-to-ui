"""Normalisation and validation of record values, driven entirely by field metadata."""

import datetime as dt
import re
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
