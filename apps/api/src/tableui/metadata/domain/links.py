"""Checks on how tables link to each other. Pure: no database, so they are cheap to test."""

from tableui.metadata.domain.models import TableDef


def required_cycle(tables: list[TableDef]) -> list[str] | None:
    """A loop of required links, as table keys (first repeated at the end), or None.

    If A must point to B and B must point to A, neither record can be created first.
    """
    edges: dict[str, list[str]] = {t.key: [] for t in tables}
    for t in tables:
        for f in t.fields:
            if f.type == "reference" and f.required and f.ref_table in edges:
                edges[t.key].append(f.ref_table)
    state: dict[str, int] = {}  # 1 = on the current path, 2 = done
    path: list[str] = []

    def visit(k: str) -> list[str] | None:
        state[k] = 1
        path.append(k)
        for nxt in edges[k]:
            if state.get(nxt) == 1:
                return [*path[path.index(nxt) :], nxt]
            if nxt not in state and (found := visit(nxt)):
                return found
        path.pop()
        state[k] = 2
        return None

    for k in edges:
        if k not in state and (found := visit(k)):
            return found
    return None


def describe_cycle(cycle: list[str], labels: dict[str, str]) -> str:
    names = [labels.get(k, k) for k in cycle]
    if len(names) == 2:
        return f"{names[0]} would require a link to itself, so its first record could never be created."
    return " requires ".join(names) + ", so none of them could be created first."
