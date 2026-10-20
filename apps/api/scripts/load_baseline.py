"""M0-S21 load baseline: N virtual users for a fixed duration against a running API.

Mix: 70% list candidates, 20% open a candidate, 10% create a candidate (rules run, history/audit/outbox written).
Usage: python scripts/load_baseline.py --base http://localhost:8000 --users 50 --minutes 10
"""

import argparse
import asyncio
import json
import random
import statistics
import time
import uuid

import httpx


async def main(base: str, users: int, minutes: float, out: str | None) -> None:
    tag = uuid.uuid4().hex[:8]
    async with httpx.AsyncClient(base_url=base, timeout=30) as c:
        r = await c.post(
            "/v1/auth/signup",
            json={
                "agency_name": f"Load {tag}",
                "full_name": "Load Tester",
                "email": f"load-{tag}@example.test",
                "password": "load-test-password-1",
            },
        )
        r.raise_for_status()
        token = r.json()["token"]
        h = {"Authorization": f"Bearer {token}"}
        pub = await c.post("/v1/apps/current/releases", headers=h, json={})
        pub.raise_for_status()
        (
            await c.post(
                f"/v1/apps/current/releases/{pub.json()['version']}/promote", headers=h, json={}
            )
        ).raise_for_status()
    lat: dict[str, list[float]] = {"list": [], "open": [], "create": []}
    errors: dict[str, int] = {}
    ids: list[str] = []
    stop = time.monotonic() + minutes * 60

    async def user(i: int, client: httpx.AsyncClient) -> None:
        rnd = random.Random(i)
        while time.monotonic() < stop:
            roll = rnd.random()
            kind = "list" if roll < 0.7 else "open" if roll < 0.9 else "create"
            if kind == "open" and not ids:
                kind = "list"
            t = time.perf_counter()
            if kind == "list":
                resp = await client.get("/v1/records/candidate?limit=50")
            elif kind == "open":
                resp = await client.get(f"/v1/records/candidate/{rnd.choice(ids)}")
            else:
                n = uuid.uuid4().hex[:10]
                resp = await client.post(
                    "/v1/records/candidate",
                    headers={"Idempotency-Key": str(uuid.uuid4())},
                    json={
                        "data": {
                            "full_name": f"Person {n}",
                            "email": f"{n}@load.test",
                            "phone": f"+9198{rnd.randint(10_000_000, 99_999_999)}",
                        }
                    },
                )
                if resp.status_code == 201:
                    ids.append(resp.json()["id"])
            ms = (time.perf_counter() - t) * 1000
            if resp.status_code >= 400 and not (kind == "create" and resp.status_code == 409):
                errors[f"{kind}:{resp.status_code}"] = (
                    errors.get(f"{kind}:{resp.status_code}", 0) + 1
                )
            else:
                lat[kind].append(ms)
            await asyncio.sleep(rnd.uniform(0.05, 0.25))  # think time

    limits = httpx.Limits(max_connections=users)
    async with httpx.AsyncClient(base_url=base, headers=h, timeout=30, limits=limits) as client:
        await asyncio.gather(*(user(i, client) for i in range(users)))

    def summ(v: list[float]) -> dict[str, float]:
        v = sorted(v)
        return (
            {
                "n": len(v),
                "p50_ms": round(statistics.median(v), 1),
                "p95_ms": round(v[int(len(v) * 0.95)], 1),
                "p99_ms": round(v[int(len(v) * 0.99)], 1),
                "max_ms": round(v[-1], 1),
            }
            if v
            else {"n": 0}
        )

    total = sum(len(v) for v in lat.values())
    result = {
        "users": users,
        "minutes": minutes,
        "requests": total,
        "rps": round(total / (minutes * 60), 1),
        "errors": errors,
        "records_created": len(ids),
        **{k: summ(v) for k, v in lat.items()},
    }
    print(json.dumps(result, indent=2))
    if out:
        open(out, "w").write(json.dumps(result, indent=2))


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--base", default="http://localhost:8000")
    p.add_argument("--users", type=int, default=50)
    p.add_argument("--minutes", type=float, default=10)
    p.add_argument("--out")
    a = p.parse_args()
    asyncio.run(main(a.base, a.users, a.minutes, a.out))
