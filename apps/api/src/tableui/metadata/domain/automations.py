"""Checks on an automation against the tables. Shared by the pack loader and the Studio's builder."""

import re

from tableui.metadata.domain.measures import NEEDS_VALUE
from tableui.metadata.domain.models import AutomationDef, TableDef

TOKEN = re.compile(r"\{([a-z_][a-z0-9_]*)(?:\+(\d+))?\}")
SPECIAL = {"title", "id", "today"}
DATE_COLUMNS = ("created_at", "updated_at")


def tokens(text: str) -> list[str]:
    return [m.group(1) for m in TOKEN.finditer(text)]


def problems(
    a: AutomationDef, tables: dict[str, TableDef], roles: set[str] | None = None
) -> list[tuple[str, str]]:
    """(where, plain-words message) for everything wrong with an automation."""
    out: list[tuple[str, str]] = []
    t = tables.get(a.trigger.table)
    if t is None:
        return [("trigger.table", f"There is no table '{a.trigger.table}'.")]
    trig = a.trigger
    if trig.kind in ("changed", "date") and not trig.field:
        out.append(("trigger.field", "Pick the field to watch."))
    if trig.field and not (trig.kind == "date" and trig.field in DATE_COLUMNS):
        f = t.field(trig.field)
        if f is None:
            out.append(("trigger.field", f"{t.label} has no field '{trig.field}'."))
        elif trig.kind == "date" and f.type != "date":
            out.append(("trigger.field", f"'{f.label}' is not a date field."))
        elif trig.kind == "changed":
            if trig.value is None:
                out.append(("trigger.value", "Say what it has to change to."))
            elif f.type == "select" and trig.value not in f.options:
                out.append(("trigger.value", f"'{trig.value}' is not a choice of '{f.label}'."))
    if trig.kind != "date" and trig.days:
        out.append(("trigger.days", "Days only apply to a date trigger."))
    if trig.kind == "date" and not -365 <= trig.days <= 365:
        out.append(("trigger.days", "Use a number of days between -365 and 365."))
    for i, flt in enumerate(a.where):
        f = t.field(flt.field)
        if f is None:
            out.append((f"where.{i}.field", f"{t.label} has no field '{flt.field}'."))
            continue
        if flt.op in NEEDS_VALUE and flt.value is None:
            out.append((f"where.{i}.value", "This condition needs a value."))
        if f.type == "select" and flt.op in ("eq", "neq") and flt.value not in f.options:
            out.append((f"where.{i}.value", f"'{flt.value}' is not a choice of '{f.label}'."))
    if not a.actions:
        out.append(("actions", "Add at least one thing to do."))
    if len(a.actions) > 5:
        out.append(("actions", "Use at most five actions."))
    known = {f.key for f in t.fields} | SPECIAL

    def check_text(path: str, text: str) -> None:
        for name in tokens(text):
            if name not in known:
                out.append((path, f"'{{{name}}}' is not a field of {t.label}."))

    for i, act in enumerate(a.actions):
        p = f"actions.{i}"
        if act.to == "role" and not act.role:
            out.append((f"{p}.role", "Pick the role."))
        elif act.to == "role" and roles is not None and act.role not in roles:
            out.append((f"{p}.role", f"There is no role '{act.role}'."))
        if act.kind == "notify":
            if not act.message.strip():
                out.append((f"{p}.message", "Write what people will read."))
            check_text(f"{p}.message", act.message)
        elif act.kind == "create":
            target = tables.get(act.table or "")
            if target is None:
                out.append((f"{p}.table", "Pick what to create."))
                continue
            if not act.values:
                out.append((f"{p}.values", "Say what goes in the new record."))
            for key, txt in act.values.items():
                tf = target.field(key)
                if tf is None:
                    out.append((f"{p}.values.{key}", f"{target.label} has no field '{key}'."))
                    continue
                check_text(f"{p}.values.{key}", txt)
                if tf.type == "select" and not tokens(txt) and txt not in tf.options:
                    out.append((f"{p}.values.{key}", f"'{txt}' is not a choice of '{tf.label}'."))
            for f in target.fields:
                if f.required and f.key not in act.values and not f.has_fallback:
                    out.append((f"{p}.values", f"'{f.label}' is required but not filled in."))
        else:
            sf = t.field(act.field or "")
            if sf is None:
                out.append((f"{p}.field", "Pick the field to set."))
                continue
            if act.value is None:
                out.append((f"{p}.value", "Say the new value."))
                continue
            check_text(f"{p}.value", act.value)
            if sf.type == "select" and not tokens(act.value) and act.value not in sf.options:
                out.append((f"{p}.value", f"'{act.value}' is not a choice of '{sf.label}'."))
            if trig.kind in ("updated", "changed") and act.field == trig.field:
                out.append((f"{p}.field", "This would set off the same automation again."))
    return out
