"""Rule engine: CEL expressions compiled once and evaluated against a record and its context."""

from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

import cel

from tableui.metadata.public import RuleDef


@dataclass(frozen=True)
class Outcome:
    rule_id: str
    check_id: str
    severity: str
    message: str
    link: dict[str, Any] | None = None
    overridable: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "rule": self.rule_id,
            "check": self.check_id,
            "severity": self.severity,
            "message": self.message,
            "link": self.link,
            "overridable": self.overridable,
        }


@dataclass(frozen=True)
class CompiledCheck:
    rule_id: str
    check_id: str
    severity: str
    message: str
    link_key: str | None
    overridable: bool
    program: Any = field(repr=False)


@lru_cache(maxsize=4096)
def _compile(expression: str) -> Any:
    return cel.compile(expression)


def compile_rule(rule: RuleDef) -> list[CompiledCheck]:
    return [
        CompiledCheck(rule.id, c.id, c.severity, c.message, c.link, c.overridable, _compile(c.when))
        for c in rule.checks
    ]


def evaluate(
    checks: list[CompiledCheck],
    record: dict[str, Any],
    ctx: dict[str, Any],
    before: dict[str, Any] | None = None,
) -> list[Outcome]:
    """Return an Outcome for each check whose condition holds. Pure: no I/O.

    ``before`` is the record as it was (every field present, empty on create), so a rule can look at
    what is changing, for example ``before.stage != record.stage``.
    """
    scope = {"record": record, "ctx": ctx, "before": before or {}}
    out: list[Outcome] = []
    for c in checks:
        if c.program.execute(scope) is True:
            link = ctx.get(c.link_key) if c.link_key else None
            out.append(Outcome(c.rule_id, c.check_id, c.severity, c.message, link, c.overridable))
    return out
