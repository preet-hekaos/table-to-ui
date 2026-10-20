"""Measure the built-in CV reader on the synthetic corpus. Writes docs/benchmarks/parser-m1.json.

Run: uv run python -m tools.parser_accuracy
"""

import asyncio
import json
import sys
from pathlib import Path

from tableui.files.public import RuleParser, sniff
from tools.cv_corpus import corpus, score


async def main(n: int = 200) -> dict:
    parser = RuleParser()
    samples = corpus(n)
    per_field: dict[str, list[bool]] = {}
    per_cv = []
    hindi_ok = []
    misses: list[dict] = []
    for s in samples:
        got = await parser.parse(sniff(s.data, s.name) or "", s.data)
        res = score(s.truth, got["fields"])
        for k, ok in res.items():
            per_field.setdefault(k, []).append(ok)
            if not ok and len(misses) < 40:
                misses.append(
                    {
                        "cv": s.name,
                        "field": k,
                        "want": s.truth[k],
                        "got": (got["fields"].get(k) or {}).get("value"),
                    }
                )
        frac = sum(res.values()) / len(res)
        per_cv.append(frac)
        if s.hindi:
            hindi_ok.append(frac)
    fields = {k: round(100 * sum(v) / len(v), 1) for k, v in per_field.items()}
    total = sum(sum(v) for v in per_field.values()) / sum(len(v) for v in per_field.values())
    report = {
        "corpus": f"{n} synthetic CVs (half PDF, half DOCX, one in ten partly in Hindi); real sample set pending",
        "parser": parser.name,
        "field_accuracy_pct": fields,
        "overall_field_accuracy_pct": round(100 * total, 1),
        "cvs_fully_correct_pct": round(100 * sum(1 for f in per_cv if f == 1) / n, 1),
        "partly_hindi_field_accuracy_pct": round(100 * sum(hindi_ok) / max(1, len(hindi_ok)), 1),
        "sample_misses": misses[:15],
    }
    return report


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 200
    rep = asyncio.run(main(n))
    out = Path(__file__).resolve().parents[3] / "docs" / "benchmarks" / "parser-m1.json"
    out.write_text(json.dumps(rep, indent=2, ensure_ascii=False) + "\n")
    print(
        json.dumps(
            {k: v for k, v in rep.items() if k != "sample_misses"}, indent=2, ensure_ascii=False
        )
    )
    for m in rep["sample_misses"][:15]:
        print(m)
