"""M0-S21 benchmark: 1,000 compiled rules, 100,000 evaluations; reports p50/p99/max per evaluation."""

import json
import platform
import random
import statistics
import sys
import time

from tableui.metadata.domain.models import RuleCheck, RuleDef
from tableui.rules.domain.engine import compile_rule, evaluate

RULES, EVALS = 1000, 100_000


def make_rules() -> list[RuleDef]:
    out = []
    for i in range(RULES):
        when = [
            f"record.score > {i % 90} && record.status == 'open' && ctx.email_match == null",
            f"size(record.name) > {i % 20} || record.notice_days >= {i % 60}",
            f"record.status in ['open', 'hold'] && (record.score + {i}) % 7 == 0",
        ][i % 3]
        out.append(
            RuleDef(
                id=f"B-{i}",
                title="bench",
                table="candidate",
                applies_to=["create"],
                checks=[
                    RuleCheck(id=f"B-{i}.a", severity="warn", when=when, message="m", link=None)
                ],
            )
        )
    return out


def pct(sorted_us: list[float], p: float) -> float:
    return sorted_us[min(len(sorted_us) - 1, int(len(sorted_us) * p))]


def main() -> None:
    rules = make_rules()
    t0 = time.perf_counter()
    compiled = [compile_rule(r) for r in rules]
    compile_ms = (time.perf_counter() - t0) * 1000
    rnd = random.Random(7)
    recs = [
        {
            "score": rnd.randint(0, 100),
            "status": rnd.choice(["open", "hold", "closed"]),
            "name": "x" * rnd.randint(1, 30),
            "notice_days": rnd.randint(0, 90),
        }
        for _ in range(512)
    ]
    ctx = {"email_match": None}
    for _ in range(2000):  # warm-up
        evaluate(compiled[rnd.randrange(RULES)], recs[0], ctx)
    single: list[float] = []
    for i in range(EVALS):
        c = compiled[i % RULES]
        r = recs[i % len(recs)]
        a = time.perf_counter()
        evaluate(c, r, ctx)
        single.append((time.perf_counter() - a) * 1e6)
    single.sort()
    # all 1,000 rules against one record: the worst realistic command (a table with 1,000 rules)
    sweep: list[float] = []
    for i in range(200):
        r = recs[i % len(recs)]
        a = time.perf_counter()
        for c in compiled:
            evaluate(c, r, ctx)
        sweep.append((time.perf_counter() - a) * 1000)
    sweep.sort()
    result = {
        "rules": RULES,
        "evaluations": EVALS,
        "compile_all_ms": round(compile_ms, 1),
        "single_rule_us": {
            "p50": round(statistics.median(single), 1),
            "p99": round(pct(single, 0.99), 1),
            "max": round(single[-1], 1),
        },
        "all_1000_rules_per_record_ms": {
            "p50": round(statistics.median(sweep), 2),
            "p99": round(pct(sweep, 0.99), 2),
        },
        "target_p99_ms": 1.0,
        "passes": pct(single, 0.99) <= 1000,
        "python": platform.python_version(),
        "machine": platform.machine(),
        "platform": platform.platform(),
    }
    print(json.dumps(result, indent=2))
    sys.exit(0 if result["passes"] else 1)


if __name__ == "__main__":
    main()
