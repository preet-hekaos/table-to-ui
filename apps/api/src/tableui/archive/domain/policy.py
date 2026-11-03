"""When an archived thing is deleted for good. Pure rules; the clock and the database live elsewhere."""

from datetime import datetime, timedelta
from typing import Any

KINDS = ("field", "link", "measure", "automation", "record")
DAY_CHOICES = (7, 14, 30, 60, 90, 180, 365)
DEFAULT = {"auto_delete": True, "days": 30, "per_kind": {}, "warn_days": 3}


def days_for(setting: dict[str, Any], kind: str) -> int | None:
    """Days an archived item of this kind stays; None means it is never deleted by itself."""
    if not setting.get("auto_delete", True):
        return None
    own = (setting.get("per_kind") or {}).get(kind)
    if own is None:
        return int(setting["days"])
    return None if int(own) == 0 else int(own)


def delete_after(setting: dict[str, Any], kind: str, archived_at: datetime) -> datetime | None:
    n = days_for(setting, kind)
    return None if n is None else archived_at + timedelta(days=n)


def problems(body: dict[str, Any]) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    days = body.get("days")
    if days is not None and days not in DAY_CHOICES:
        out.append(("days", "Choose 7, 14, 30, 60, 90, 180 or 365 days."))
    for k, v in (body.get("per_kind") or {}).items():
        if k not in KINDS:
            out.append(("per_kind", f"'{k}' is not something that can be archived."))
        elif v != 0 and v not in DAY_CHOICES:
            out.append(("per_kind", "Choose a number of days from the list, or 0 for never."))
    warn = body.get("warn_days")
    if warn is not None and not 0 <= warn <= 30:
        out.append(("warn_days", "Warn between 0 and 30 days before."))
    return out
