"""What a model may answer. A reply that does not fit its shape is thrown away, never repaired."""

import json
import re
from typing import Any


class BadReply(ValueError):
    """The model's answer did not fit the shape for this feature."""


def parse_json(raw: str) -> Any:
    t = raw.strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t)
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        a, b = t.find("{"), t.rfind("}")
        if a >= 0 and b > a:
            try:
                return json.loads(t[a : b + 1])
            except json.JSONDecodeError:
                pass
    raise BadReply("The answer was not readable.")


def need_object(v: Any) -> dict[str, Any]:
    if not isinstance(v, dict):
        raise BadReply("The answer was not in the expected shape.")
    return v


def need_text(v: Any, key: str, *, limit: int = 4000) -> str:
    s = need_object(v).get(key)
    if not isinstance(s, str) or not s.strip():
        raise BadReply(f"The answer had no '{key}'.")
    return s.strip()[:limit]


def coerce(field: Any, value: Any) -> Any:
    """A model's value for a field, turned into what the field holds, or BadReply."""
    t = field.type
    if value is None or value == "":
        raise BadReply("empty")
    if t in ("text", "long_text", "email", "phone", "url"):
        return str(value).strip()
    if t in ("integer", "months"):
        return int(float(str(value).replace(",", "")))
    if t in ("decimal", "money"):
        return float(str(value).replace(",", ""))
    if t == "boolean":
        if isinstance(value, bool):
            return value
        raise BadReply("not a yes/no")
    if t == "date":
        s = str(value)
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
            raise BadReply("not a date")
        return s
    if t == "select":
        hit = next((o for o in field.options if o.lower() == str(value).strip().lower()), None)
        if hit is None:
            raise BadReply("not one of the choices")
        return hit
    if t == "tags":
        items = value if isinstance(value, list) else str(value).split(",")
        out = [str(x).strip() for x in items if str(x).strip()]
        if not out:
            raise BadReply("empty")
        return out[:30]
    raise BadReply("unsupported")
