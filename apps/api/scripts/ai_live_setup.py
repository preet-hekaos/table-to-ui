"""Try setup by chat on a real provider (not part of CI). Needs GROQ_API_KEY and/or GOOGLE_API_KEY in the
API's environment (apps/api/.env.local), and the API running without AI_PROVIDER=fake.

    uv run python scripts/ai_live_setup.py --api http://127.0.0.1:8000

Each description is planned on a fresh recruitment workspace and tried (dry run) but never applied.
Prints how many steps the model proposed and how many of them would work.
"""

import argparse
import asyncio

import httpx
from bench_m1 import workspace

DESCRIPTIONS = [
    "We also work with suppliers. Track suppliers and the purchase orders we raise with each of them.",
    "Add a field for notice period in days to candidates.",
    "Show a number on Insights for how many candidates are Active.",
]


async def main(api: str) -> int:
    bad = 0
    async with httpx.AsyncClient(base_url=api, timeout=120) as c:
        for text in DESCRIPTIONS:
            h = await workspace(c)
            (
                await c.put("/v1/ai/settings", headers=h, json={"enabled": True, "tables": []})
            ).raise_for_status()
            r = await c.post("/v1/ai/setup/messages", headers=h, json={"message": text})
            print(f"\n> {text}")
            if r.status_code != 200:
                print(f"  FAILED {r.status_code}: {r.json().get('detail')}")
                bad += 1
                continue
            body = r.json()
            print(f"  {body['reply']}")
            steps = body["plan"]["steps"] if body["plan"] else []
            for s in steps:
                print(f"  [{'ok' if s['ok'] else 'FAIL'}] {s['op']} {s['args']}" + ("" if s["ok"] else f"  -> {s['error']}"))  # fmt: skip
            if not steps or not all(s["ok"] for s in steps):
                bad += 1
    print(
        f"\n{len(DESCRIPTIONS) - bad} of {len(DESCRIPTIONS)} descriptions gave a plan that fully works."
    )
    return bad


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://127.0.0.1:8000")
    raise SystemExit(1 if asyncio.run(main(ap.parse_args().api)) else 0)
