"""M2.5 gate: the Relationships list for 100 tables and 500 links, p95 under 600 ms.

    uv run python scripts/bench_m25.py --api http://127.0.0.1:8000
Results go to docs/benchmarks/m25.json.
"""

import argparse
import asyncio
import json
import time
from pathlib import Path

import httpx
from bench_m1 import summary, timed, workspace


async def main(api: str, tables: int, links: int, samples: int) -> dict[str, object]:
    async with httpx.AsyncClient(base_url=api, timeout=600) as c:
        h = await workspace(c)
        t0 = time.perf_counter()
        keys = []
        for i in range(tables):
            r = await c.post("/v1/studio/tables", headers=h, json={"label": f"Bench table {i}"})
            r.raise_for_status()
            keys.append(r.json()["key"])
        made = 0
        i = 0
        while made < links:
            a, b = keys[i % tables], keys[(i * 7 + 3) % tables]
            i += 1
            if a == b:
                continue
            r = await c.post(
                "/v1/studio/relationships",
                headers=h,
                json={"table": a, "to": b, "label": f"Link {made}"},
            )
            r.raise_for_status()
            made += 1
        seeded = round(time.perf_counter() - t0, 1)
        times = []
        for _ in range(samples):
            ms, r = await timed(c, "GET", "/v1/studio/relationships", headers=h)
            r.raise_for_status()
            times.append(ms)
        return {
            "tables": tables,
            "links_added": links,
            "seed_seconds": seeded,
            "links_listed": len(r.json()),
            "list": summary(times),
        }


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://127.0.0.1:8000")
    ap.add_argument("--tables", type=int, default=100)
    ap.add_argument("--links", type=int, default=500)
    ap.add_argument("--samples", type=int, default=50)
    a = ap.parse_args()
    res = asyncio.run(main(a.api, a.tables, a.links, a.samples))
    out = Path(__file__).resolve().parents[3] / "docs" / "benchmarks" / "m25.json"
    out.write_text(json.dumps(res, indent=2) + "\n")
    print(json.dumps(res, indent=2))
