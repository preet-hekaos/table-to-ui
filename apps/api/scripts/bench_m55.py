"""M5.5 gates: a 20-step plan is tried (dry run) in under 2 s and applied in under 3 s at p95, with the
model answering instantly. Real model time is the provider's and is not measured here.

    uv run python scripts/bench_m55.py --api http://127.0.0.1:8000      (the API must run with AI_PROVIDER=fake)

Results go to docs/benchmarks/m55.json.
"""

import argparse
import asyncio
import json
import random
import string
from pathlib import Path

import httpx
from bench_m1 import summary, timed, workspace


def word() -> str:
    return "".join(random.choices(string.ascii_lowercase, k=9)) + "x"


async def main(api: str, samples: int) -> dict[str, object]:
    async with httpx.AsyncClient(base_url=api, timeout=120) as c:
        h = await workspace(c)
        (
            await c.put("/v1/ai/settings", headers=h, json={"enabled": True, "tables": []})
        ).raise_for_status()
        dry, apply, undo = [], [], []
        for _ in range(samples):
            ms, r = await timed(
                c, "POST", "/v1/ai/setup/messages", headers=h,
                json={"message": f"track {word()}s with 18 fields"},
            )  # fmt: skip
            r.raise_for_status()
            plan = r.json()["plan"]
            assert len(plan["steps"]) == 20 and all(s["ok"] for s in plan["steps"]), plan["steps"]
            dry.append(ms)
            ms, r = await timed(
                c, "POST", f"/v1/ai/setup/plans/{plan['id']}/apply", headers=h,
                json={"steps": list(range(20))},
            )  # fmt: skip
            r.raise_for_status()
            apply.append(ms)
            ms, r = await timed(c, "POST", f"/v1/ai/setup/plans/{plan['id']}/undo", headers=h)
            r.raise_for_status()
            undo.append(ms)
        return {
            "samples": samples,
            "steps_per_plan": 20,
            "dry_run_20_steps": summary(dry),
            "apply_20_steps": summary(apply),
            "undo_20_steps": summary(undo),
        }


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://127.0.0.1:8000")
    ap.add_argument("--samples", type=int, default=30)
    a = ap.parse_args()
    res = asyncio.run(main(a.api, a.samples))
    out = Path(__file__).resolve().parents[3] / "docs" / "benchmarks" / "m55.json"
    out.write_text(json.dumps(res, indent=2) + "\n")
    print(json.dumps(res, indent=2))
