"""Transformation rules (S5): "if this, then that" steps that clean a value before it is checked and saved.

One function, `apply_field_rules`, serves forms, inline edit, bulk edit, import, the API and Studio's Try-a-value,
so what the preview says is what happens live. Rules run top to bottom on the incoming value; a rule that matches
applies its action; with Stop on, later rules are skipped. "Copy another field" reads that field's incoming value,
so rules never depend on each other.
"""

import datetime as dt
import re
from dataclasses import dataclass, field
from typing import Any

from tableui.metadata.domain.models import FieldDef, TransformRule

STANDARD = {
    "today": "Today's date",
    "now": "Today's date",
    "user": "The person who saves",
    "zero": "Zero",
    "empty": "Empty text",
    "not_provided": "Not provided",
    "first_choice": "The first choice",
}
CONDITIONS = (
    "blank", "equals_any", "contains", "starts_with", "ends_with", "matches", "above", "below", "field_is",
)  # fmt: skip
ACTIONS = (
    "set",
    "set_standard",
    "copy_field",
    "keep_match",
    "trim",
    "case",
    "remove_chars",
    "clear",
)


@dataclass
class Step:
    index: int
    matched: bool
    before: Any = None
    after: Any = None
    stopped: bool = False


@dataclass
class Outcome:
    value: Any
    steps: list[Step] = field(default_factory=list)

    @property
    def changed(self) -> bool:
        return any(s.matched for s in self.steps)


def is_blank(v: Any) -> bool:
    return v is None or (isinstance(v, str) and not v.strip()) or (isinstance(v, list) and not v)


def _text(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, list):
        return ", ".join(str(x) for x in v)
    return str(v)


def _number(v: Any) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, int | float):
        return float(v)
    try:
        return float(str(v).strip().replace(",", ""))
    except ValueError:
        return None


def _matches(rule: TransformRule, value: Any, others: dict[str, Any]) -> bool:
    c, a = rule.when, rule.args
    if c == "blank":
        return is_blank(value)
    if c == "field_is":
        if len(a) < 2:
            return False
        other = others.get(a[0])
        return _text(other).strip().casefold() == a[1].strip().casefold()
    if is_blank(value):
        return False
    t = _text(value).strip()
    if c == "equals_any":
        return t.casefold() in {x.strip().casefold() for x in a}
    if c == "contains":
        return bool(a) and a[0].casefold() in t.casefold()
    if c == "starts_with":
        return bool(a) and t.casefold().startswith(a[0].casefold())
    if c == "ends_with":
        return bool(a) and t.casefold().endswith(a[0].casefold())
    if c == "matches":
        return bool(a) and re.search(a[0], t, re.I) is not None
    n = _number(value)
    lim = _number(a[0]) if a else None
    if n is None or lim is None:
        return False
    return n > lim if c == "above" else n < lim
    # unreachable for unknown conditions: the model only allows CONDITIONS


def standard_value(key: str, f: FieldDef, actor: str) -> Any:
    if key in ("today", "now"):
        return dt.date.today().isoformat()
    if key == "user":
        return actor
    if key == "zero":
        return 0
    if key == "empty":
        return ""
    if key == "not_provided":
        return "Not provided"
    if key == "first_choice":
        return f.options[0] if f.options else None
    return None


def _title(s: str) -> str:
    return re.sub(r"[A-Za-z]+('[A-Za-z]+)?", lambda m: m.group(0).capitalize(), s.lower())


def _apply(rule: TransformRule, value: Any, f: FieldDef, others: dict[str, Any], actor: str) -> Any:
    d = rule.do
    if d == "set":
        return rule.value
    if d == "set_standard":
        v = standard_value(rule.value, f, actor)
        numeric = f.type in ("integer", "decimal", "money", "months")
        return str(v) if isinstance(v, int) and not isinstance(v, bool) and not numeric else v
    if d == "copy_field":
        return others.get(rule.value)
    if d == "clear":
        return None
    if d == "keep_match":
        m = (
            re.search(rule.value or r"\d+(?:\.\d+)?", _text(value), re.I)
            if rule.when != "matches"
            else None
        )
        if rule.when == "matches" and rule.args:
            m = re.search(rule.args[0], _text(value).strip(), re.I)
        if m is None:
            return value
        return m.group(1) if m.groups() else m.group(0)
    if d == "trim":
        return re.sub(r"\s+", " ", value.strip()) if isinstance(value, str) else value
    if d == "case":
        s = _text(value)
        return {"lower": s.lower(), "upper": s.upper(), "title": _title(s)}.get(rule.value, s)
    if d == "remove_chars":
        s = _text(value)
        return "".join(ch for ch in s if ch not in rule.value)
    return value


def to_type(f: FieldDef, v: Any) -> Any:
    """Bring a text result to the type the field stores, so a rule that says '30' fills a number field."""
    if not isinstance(v, str):
        return v
    s = v.strip()
    if f.type in ("integer", "months") and re.fullmatch(r"-?\d+", s):
        return int(s)
    if f.type in ("decimal", "money") and re.fullmatch(r"-?\d+(\.\d+)?", s.replace(",", "")):
        return float(s.replace(",", ""))
    if f.type == "boolean" and s.lower() in ("true", "false"):
        return s.lower() == "true"
    if f.type == "tags":
        return [p.strip() for p in s.split(",") if p.strip()]
    return v


def apply_field_rules(f: FieldDef, value: Any, others: dict[str, Any], actor: str = "") -> Outcome:
    out = Outcome(value)
    for i, rule in enumerate(f.transforms):
        if not rule.enabled:
            continue
        hit = _matches(rule, out.value, others)
        step = Step(i, hit, out.value)
        if hit:
            out.value = to_type(f, _apply(rule, out.value, f, others, actor))
            step.after = out.value
            step.stopped = rule.stop
        out.steps.append(step)
        if hit and rule.stop:
            break
    return out


def transform_payload(
    table_fields: list[FieldDef], payload: dict[str, Any], *, partial: bool, actor: str = ""
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Run every field's rules on the incoming record. Returns the new payload and the original value of each
    field a rule changed (so an error can say what the value became). A field left out of an update is never touched."""
    new = dict(payload)
    changed: dict[str, Any] = {}
    for f in table_fields:
        if not f.transforms or not any(r.enabled for r in f.transforms):
            continue
        if partial and f.key not in payload:
            continue
        before = payload.get(f.key)
        res = apply_field_rules(f, before, payload, actor)
        if res.changed and res.value != before:
            changed[f.key] = before
            if res.value is None and f.key not in payload:
                continue
            new[f.key] = res.value
    return new, changed
