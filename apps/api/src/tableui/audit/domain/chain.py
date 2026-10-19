"""Tamper-evident history: every entry's hash covers the previous entry's hash."""

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any

GENESIS = "0" * 64


def _canonical(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def entry_hash(
    prev_hash: str,
    *,
    table_key: str,
    record_id: str,
    seq: int,
    action: str,
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
    actor_id: str,
    app_version: str,
    at: datetime,
) -> str:
    body = _canonical(
        {
            "t": table_key,
            "r": record_id,
            "n": seq,
            "a": action,
            "b": before,
            "f": after,
            "u": actor_id,
            "v": app_version,
            "at": at.isoformat(),
        }
    )
    return hashlib.sha256((prev_hash + body).encode()).hexdigest()


@dataclass(frozen=True)
class HistoryEntry:
    seq: int
    action: str
    before: dict[str, Any] | None
    after: dict[str, Any] | None
    actor_id: str
    app_version: str
    at: datetime
    prev_hash: str
    hash: str


def verify_chain(table_key: str, record_id: str, entries: list[HistoryEntry]) -> bool:
    prev = GENESIS
    for e in sorted(entries, key=lambda x: x.seq):
        expected = entry_hash(
            prev,
            table_key=table_key,
            record_id=record_id,
            seq=e.seq,
            action=e.action,
            before=e.before,
            after=e.after,
            actor_id=e.actor_id,
            app_version=e.app_version,
            at=e.at,
        )
        if e.prev_hash != prev or e.hash != expected:
            return False
        prev = e.hash
    return True
