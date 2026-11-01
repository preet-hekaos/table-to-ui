"""Compare two manifests: every changed table, field, screen, menu item, rule and measure."""

from typing import Any

KINDS = ("tables", "screens", "navs", "rules", "measures", "automations")
_FIELD_ATTRS = (
    "label",
    "type",
    "required",
    "hidden",
    "options",
    "help",
    "unique",
    "searchable",
    "filterable",
    "ref_table",
    "max_length",
    "min",
    "max",
    "type_name",
    "save_as",
    "rules",
    "transforms",
    "default",
)


def _defs(manifest: dict[str, Any], kind: str) -> dict[str, dict[str, Any]]:
    return {k: v["definition"] for k, v in (manifest.get(kind) or {}).items()}


def _field_changes(before: dict[str, Any], after: dict[str, Any]) -> list[dict[str, Any]]:
    b = {f["key"]: f for f in before.get("fields", [])}
    a = {f["key"]: f for f in after.get("fields", [])}
    out: list[dict[str, Any]] = []
    for k in sorted(a.keys() - b.keys()):
        out.append({"field": k, "change": "added", "label": a[k]["label"]})
    for k in sorted(b.keys() - a.keys()):
        out.append({"field": k, "change": "removed", "label": b[k]["label"]})
    for k in sorted(a.keys() & b.keys()):
        attrs = [x for x in _FIELD_ATTRS if a[k].get(x) != b[k].get(x)]
        if attrs:
            out.append(
                {
                    "field": k,
                    "change": "changed",
                    "label": a[k]["label"],
                    "attributes": {x: {"from": b[k].get(x), "to": a[k].get(x)} for x in attrs},
                }
            )
    return out


def diff_manifests(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for kind in KINDS:
        b, a = _defs(before, kind), _defs(after, kind)
        items: list[dict[str, Any]] = []
        for k in sorted(a.keys() - b.keys()):
            items.append({"key": k, "change": "added"})
        for k in sorted(b.keys() - a.keys()):
            items.append({"key": k, "change": "removed"})
        for k in sorted(a.keys() & b.keys()):
            if a[k] == b[k]:
                continue
            entry: dict[str, Any] = {"key": k, "change": "changed"}
            if kind == "tables":
                entry["fields"] = _field_changes(b[k], a[k])
                other = sorted(
                    x
                    for x in (a[k].keys() | b[k].keys()) - {"fields", "version"}
                    if a[k].get(x) != b[k].get(x)
                )
                if other:
                    entry["attributes"] = other
            else:
                entry["attributes"] = sorted(
                    x
                    for x in (a[k].keys() | b[k].keys()) - {"version"}
                    if a[k].get(x) != b[k].get(x)
                )
            items.append(entry)
        result[kind] = items
    result["pack"] = {"from": before.get("pack"), "to": after.get("pack")}
    result["changed"] = any(result[k] for k in KINDS)
    return result
