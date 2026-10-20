"""Deterministic weighted matching (ADR-17). No AI: the same inputs always give the same order.

A profile (from a ranked_list screen's configuration) names hard filters and scored parts. Each
part gives a fraction 0..1, multiplied by its weight; the total is shown out of 100 with every part.
"""

from dataclasses import dataclass
from typing import Any

UNKNOWN = 0.5  # credit when the record does not say (shown as "not given")


@dataclass(frozen=True)
class Part:
    key: str
    label: str
    weight: float
    kind: str  # overlap | within | same | at_most
    target: str
    source: str | None = None
    source_min: str | None = None
    source_max: str | None = None
    tolerance: float = 0
    tolerance_pct: float = 0


def parts_from(config: dict[str, Any], weights: dict[str, float] | None = None) -> list[Part]:
    out = []
    for p in config.get("parts", []):
        w = float((weights or {}).get(p["key"], p.get("weight", 0)))
        out.append(
            Part(
                key=p["key"],
                label=p.get("label", p["key"]),
                weight=max(0.0, w),
                kind=p["kind"],
                target=p["target"],
                source=p.get("source"),
                source_min=p.get("source_min"),
                source_max=p.get("source_max"),
                tolerance=float(p.get("tolerance", 0)),
                tolerance_pct=float(p.get("tolerance_pct", 0)),
            )  # fmt: skip
        )
    return out


def _num(v: Any) -> float | None:
    if isinstance(v, bool) or v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _part(p: Part, src: dict[str, Any], tgt: dict[str, Any]) -> tuple[float, str]:
    t = tgt.get(p.target)
    if p.kind == "overlap":
        want = {str(x).strip().lower() for x in (src.get(p.source or "") or [])}
        if not want:
            return 1.0, "nothing asked"
        have = {str(x).strip().lower() for x in (t or [])}
        hit = sorted(want & have)
        return len(hit) / len(want), f"{len(hit)} of {len(want)}" + (
            f": {', '.join(hit)}" if hit else ""
        )
    if p.kind == "same":
        a, b = str(src.get(p.source or "") or "").strip().lower(), str(t or "").strip().lower()
        if not a:
            return 1.0, "nothing asked"
        if not b:
            return UNKNOWN, "not given"
        return (1.0, "same") if a == b or a in b or b in a else (0.0, "different")
    if p.kind == "within":
        lo, hi, v = _num(src.get(p.source_min or "")), _num(src.get(p.source_max or "")), _num(t)
        if lo is None and hi is None:
            return 1.0, "nothing asked"
        if v is None:
            return UNKNOWN, "not given"
        gap = (
            (lo - v)
            if lo is not None and v < lo
            else (v - hi)
            if hi is not None and v > hi
            else 0.0
        )
        if gap <= 0:
            return 1.0, "in range"
        frac = max(0.0, 1 - gap / p.tolerance) if p.tolerance else 0.0
        return frac, "below range" if lo is not None and v < lo else "above range"
    if p.kind == "at_most":
        limit, v = _num(src.get(p.source or "")), _num(t)
        if limit is None:
            return 1.0, "nothing asked"
        if v is None:
            return UNKNOWN, "not given"
        if v <= limit:
            return 1.0, "within"
        slack = p.tolerance if p.tolerance else limit * p.tolerance_pct / 100
        return (max(0.0, 1 - (v - limit) / slack) if slack else 0.0), "over"
    return 0.0, "unknown kind"


def score_one(
    parts: list[Part], src: dict[str, Any], tgt: dict[str, Any]
) -> tuple[float, dict[str, Any]]:
    total_w = sum(p.weight for p in parts) or 1.0
    detail = {}
    total = 0.0
    for p in parts:
        frac, why = _part(p, src, tgt)
        points = p.weight * frac
        total += points
        detail[p.key] = {
            "label": p.label,
            "weight": p.weight,
            "fraction": round(frac, 4),
            "points": round(points, 2),
            "why": why,
        }
    return round(100 * total / total_w, 2), detail


def rank(
    parts: list[Part],
    src: dict[str, Any],
    pool: list[tuple[str, dict[str, Any]]],
    title_field: str,
) -> list[dict[str, Any]]:
    scored: list[tuple[float, str, str, dict[str, Any]]] = []
    for cid, data in pool:
        s, detail = score_one(parts, src, data)
        scored.append(
            (
                -s,
                str(data.get(title_field) or "").lower(),
                cid,
                {"id": cid, "score": s, "parts": detail, "data": data},
            )
        )
    scored.sort(key=lambda x: (x[0], x[1], x[2]))
    return [x[3] for x in scored]
