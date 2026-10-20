"""Pack versions and compatibility ranges such as ">=1.0,<2.0"."""

import re

_CLAUSE = re.compile(r"^(>=|<=|>|<|==)\s*(\d+(?:\.\d+){0,2})$")


def parse(v: str) -> tuple[int, int, int]:
    parts = [int(x) for x in v.strip().split(".")]
    if not 1 <= len(parts) <= 3:
        raise ValueError(f"'{v}' is not a version")
    while len(parts) < 3:
        parts.append(0)
    return parts[0], parts[1], parts[2]


def valid_range(spec: str) -> bool:
    clauses = [c.strip() for c in spec.split(",") if c.strip()]
    return bool(clauses) and all(_CLAUSE.match(c) for c in clauses)


def satisfies(version: str, spec: str) -> bool:
    v = parse(version)
    for c in (c.strip() for c in spec.split(",") if c.strip()):
        m = _CLAUSE.match(c)
        if not m:
            return False
        op, bound = m.group(1), parse(m.group(2))
        ok = {">=": v >= bound, "<=": v <= bound, ">": v > bound, "<": v < bound, "==": v == bound}[
            op
        ]
        if not ok:
            return False
    return True
