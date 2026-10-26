"""Which stage each item is in: Draft, Test or Live, by comparing the three manifests.

An item is *live* when it matches what Live has, *test* when it matches what Test has (and Live
does not), and *draft* otherwise. An item that exists in Test or Live but no longer in the Draft is
*removed*: it disappears when the Draft is published.
"""

from typing import Any

from tableui.metadata.domain.diff import KINDS

LIVE, TEST, DRAFT, REMOVED = "live", "test", "draft", "removed"


def _defs(manifest: dict[str, Any] | None, kind: str) -> dict[str, dict[str, Any]]:
    if not manifest:
        return {}
    return {k: v["definition"] for k, v in (manifest.get(kind) or {}).items()}


def stage_of(draft: Any, test: Any, live: Any) -> str:
    """The stage of one definition; `None` means the environment does not have it."""
    if draft is None:
        return REMOVED
    if live is not None and draft == live:
        return LIVE
    if test is not None and draft == test:
        return TEST
    return DRAFT


def _name(definition: dict[str, Any] | None, fallback: str) -> str:
    d = definition or {}
    return str(d.get("label") or d.get("title") or d.get("name") or fallback)


def _removed_fields(draft: dict[str, Any], *others: dict[str, Any] | None) -> list[dict[str, str]]:
    """Fields that Test or Live still have but the Draft has deleted."""
    have = {f["key"] for f in draft.get("fields", [])}
    seen: dict[str, str] = {}
    for o in others:
        for f in (o or {}).get("fields", []):
            if f["key"] not in have:
                seen.setdefault(f["key"], f.get("label", f["key"]))
    return [{"key": k, "label": v} for k, v in sorted(seen.items())]


def _field_stages(
    draft: dict[str, Any], test: dict[str, Any] | None, live: dict[str, Any] | None
) -> dict[str, str]:
    def fields(d: dict[str, Any] | None) -> dict[str, Any]:
        return {f["key"]: f for f in (d or {}).get("fields", [])}

    fd, ft, fl = fields(draft), fields(test), fields(live)
    return {
        k: stage_of(fd.get(k), ft.get(k), fl.get(k))
        for k in sorted(fd.keys() | ft.keys() | fl.keys())
    }


def item_stages(
    draft: dict[str, Any], test: dict[str, Any] | None, live: dict[str, Any] | None
) -> dict[str, Any]:
    """Stage of every table (with its fields), screen, menu item, rule, measure and automation."""
    out: dict[str, Any] = {}
    counts = {LIVE: 0, TEST: 0, DRAFT: 0, REMOVED: 0}
    for kind in KINDS:
        d, t, lv = _defs(draft, kind), _defs(test, kind), _defs(live, kind)
        items: dict[str, Any] = {}
        for key in sorted(d.keys() | t.keys() | lv.keys()):
            stage = stage_of(d.get(key), t.get(key), lv.get(key))
            entry: dict[str, Any] = {"stage": stage}
            if stage == DRAFT:
                entry["is_new"] = key not in lv and key not in t
            if stage == REMOVED:
                entry["label"] = _name(t.get(key) or lv.get(key), key)
            if kind == "tables":
                entry["fields"] = (
                    _field_stages(d.get(key, {}), t.get(key), lv.get(key)) if key in d else {}
                )
                if key in d:
                    entry["removed_fields"] = _removed_fields(d[key], t.get(key), lv.get(key))
            counts[entry["stage"]] += 1
            items[key] = entry
        out[kind] = items
    return {"items": out, "counts": counts}
