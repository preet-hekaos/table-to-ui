"""M5 gates: AI adds nothing to a save, and the plumbing around a model call (permission checks, context
building, the call log, the cache) costs under 50 ms at p95 when the model answers instantly.

    uv run python scripts/bench_m5.py --api http://127.0.0.1:8000      (the API must run with AI_PROVIDER=fake)

Results go to docs/benchmarks/m5.json. Real model time is the provider's and is not measured here.
"""

import argparse
import asyncio
import json
import random
import uuid
from pathlib import Path

import httpx
from bench_m1 import summary, timed, workspace


async def candidate(c: httpx.AsyncClient, h: dict[str, str], tag: str, i: int) -> dict[str, object]:
    r = await c.post(
        "/v1/records/candidate",
        headers=h,
        json={"data": {"full_name": f"Bench {tag} {i}", "email": f"b-{tag}-{i}-{uuid.uuid4().hex[:6]}@gmail.com",
                       "phone": f"+91 9{random.randint(100000000, 999999999)}", "status": "Active", "current_title": "Engineer",
                       "skills": ["Java", "SQL"], "location": "Pune"}},
    )  # fmt: skip
    r.raise_for_status()
    return r.json()  # type: ignore[no-any-return]


async def main(api: str, samples: int) -> dict[str, object]:
    async with httpx.AsyncClient(base_url=api, timeout=120) as c:
        h = await workspace(c)
        rel = (await c.post("/v1/apps/current/releases", headers=h)).json()["version"]
        (await c.post(f"/v1/apps/current/releases/{rel}/promote", headers=h)).raise_for_status()
        off = []
        for i in range(samples):
            ms, r = await timed(c, "POST", "/v1/records/candidate", headers=h, json={"data": {"full_name": f"Off {i}", "email": f"o{i}-{uuid.uuid4().hex[:6]}@gmail.com", "phone": f"+91 9{random.randint(100000000, 999999999)}", "status": "Active"}})  # fmt: skip
            r.raise_for_status()
            off.append(ms)
        (
            await c.put(
                "/v1/ai/settings", headers=h, json={"enabled": True, "tables": ["candidate"]}
            )
        ).raise_for_status()
        on = []
        recs = []
        for i in range(samples):
            ms, r = await timed(c, "POST", "/v1/records/candidate", headers=h, json={"data": {"full_name": f"On {i}", "email": f"n{i}-{uuid.uuid4().hex[:6]}@gmail.com", "phone": f"+91 9{random.randint(100000000, 999999999)}", "status": "Active"}})  # fmt: skip
            r.raise_for_status()
            on.append(ms)
            recs.append(r.json()["id"])
        reads = []
        for rid in recs:
            ms, r = await timed(c, "GET", f"/v1/records/candidate/{rid}", headers=h)
            r.raise_for_status()
            reads.append(ms)
        fresh, cached = [], []
        for rid in recs:
            ms, r = await timed(
                c, "POST", "/v1/ai/summary", headers=h, json={"table": "candidate", "id": rid}
            )
            r.raise_for_status()
            assert r.json()["cached"] is False
            fresh.append(ms)
        for rid in recs:
            ms, r = await timed(
                c, "POST", "/v1/ai/summary", headers=h, json={"table": "candidate", "id": rid}
            )
            r.raise_for_status()
            assert r.json()["cached"] is True
            cached.append(ms)
        s_off, s_on, s_fresh, s_cached = summary(off), summary(on), summary(fresh), summary(cached)
        return {
            "samples": samples,
            "save_ai_off": s_off,
            "save_ai_on": s_on,
            "added_to_a_save_p95_ms": round(s_on["p95_ms"] - s_off["p95_ms"], 1),
            "record_read_for_comparison": summary(reads),
            "summary_uncached_instant_model": s_fresh,
            "summary_cached": s_cached,
        }


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://127.0.0.1:8000")
    ap.add_argument("--samples", type=int, default=100)
    a = ap.parse_args()
    res = asyncio.run(main(a.api, a.samples))
    out = Path(__file__).resolve().parents[3] / "docs" / "benchmarks" / "m5.json"
    out.write_text(json.dumps(res, indent=2) + "\n")
    print(json.dumps(res, indent=2))
