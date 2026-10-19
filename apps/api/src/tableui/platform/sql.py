"""Helpers for running multi-statement SQL through asyncpg (one statement per call)."""


def split_statements(sql: str) -> list[str]:
    """Split on semicolons at line end that are outside $$ ... $$ blocks."""
    out: list[str] = []
    buf: list[str] = []
    in_dollar = False
    for line in sql.splitlines():
        if line.lstrip().startswith("--"):
            continue
        buf.append(line)
        in_dollar ^= line.count("$$") % 2 == 1
        if not in_dollar and line.rstrip().endswith(";"):
            out.append("\n".join(buf).strip())
            buf = []
    tail = "\n".join(buf).strip()
    if tail:
        out.append(tail)
    return [s for s in out if s and not s.startswith("--")]
