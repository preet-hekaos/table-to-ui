"""M6 gates: with 100 workspaces the operator list answers in under 500 ms at p95, and a workspace of
10,000 records exports in under 60 s.

    uv run python scripts/bench_m6.py --api http://127.0.0.1:8000 --ops-email E --ops-secret S --database-url URL

Needs an operator account (create one with `python -m tableui.ops.cli create-operator`).
Results go to docs/benchmarks/m6.json.
"""

import argparse
import asyncio
import json
import time
import uuid
from pathlib import Path

import asyncpg
import httpx
import pyotp
from bench_m1 import PASSWORD, summary, timed, workspace


async def ops_headers(c: httpx.AsyncClient, email: str, secret: str) -> dict[str, str]:
    r = await c.post("/v1/ops/auth/sign-in", json={"email": email, "password": PASSWORD})
    r.raise_for_status()
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    (
        await c.post("/v1/ops/auth/mfa/verify", headers=h, json={"code": pyotp.TOTP(secret).now()})
    ).raise_for_status()
    return h


async def seed(url: str, tenant_id: str, n: int) -> None:
    conn = await asyncpg.connect(url.replace("+asyncpg", ""))
    try:
        schema = await conn.fetchval(
            "SELECT schema_name FROM control.tenant WHERE id = $1", uuid.UUID(tenant_id)
        )
        owner = await conn.fetchval("SELECT user_id FROM control.membership WHERE tenant_id = $1 LIMIT 1", uuid.UUID(tenant_id))  # fmt: skip
        async with conn.transaction():
            await conn.execute("SELECT set_config('app.tenant_id', $1, true)", tenant_id)
            rows = [
                (
                    uuid.uuid4(),
                    uuid.UUID(tenant_id),
                    json.dumps(
                        {
                            "full_name": f"Bench Person {i}",
                            "email": f"p{i}@bench.test",
                            "status": "New",
                        }
                    ),
                    owner,
                )  # fmt: skip
                for i in range(n)
            ]
            await conn.executemany(
                f'INSERT INTO "{schema}".candidate (id, tenant_id, data, owner_id, created_by, updated_by) '  # noqa: S608
                "VALUES ($1, $2, $3::jsonb, $4, $4, $4)",
                rows,
            )
    finally:
        await conn.close()


async def main(api: str, email: str, secret: str, url: str, workspaces: int, records: int) -> dict[str, object]:  # fmt: skip
    async with httpx.AsyncClient(base_url=api, timeout=300) as c:
        h = await ops_headers(c, email, secret)
        have = len((await c.get("/v1/ops/workspaces", headers=h)).json())
        for i in range(max(0, workspaces - have)):
            (
                await c.post(
                    "/v1/ops/workspaces",
                    headers=h,
                    json={
                        "name": f"Bench {uuid.uuid4().hex[:6]} {i}",
                        "owner_email": f"o-{uuid.uuid4().hex[:8]}@bench.test",
                    },
                )  # fmt: skip
            ).raise_for_status()
        lst = []
        for _ in range(30):
            ms, r = await timed(c, "GET", "/v1/ops/workspaces", headers=h)
            r.raise_for_status()
            lst.append(ms)
        count = len(r.json())
        # a workspace with records
        uh = await workspace(c)
        me = (await c.get("/v1/me", headers=uh)).json()
        tid = me["tenant_id"]
        await seed(url, tid, records)
        t0 = time.perf_counter()
        r = await c.post(
            f"/v1/ops/workspaces/{tid}/export", headers=h, json={"reason": "benchmark"}
        )
        r.raise_for_status()
        export_s = time.perf_counter() - t0
        return {
            "workspaces_listed": count,
            "list_workspaces_first_call_ms": round(lst[0], 1),
            "list_workspaces_warm": summary(lst[1:]),
            "records_exported": records,
            "export_seconds": round(export_s, 2),
        }


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://127.0.0.1:8000")
    ap.add_argument("--ops-email", required=True)
    ap.add_argument("--ops-secret", required=True)
    ap.add_argument("--database-url", required=True)
    ap.add_argument("--workspaces", type=int, default=100)
    ap.add_argument("--records", type=int, default=10_000)
    a = ap.parse_args()
    res = asyncio.run(
        main(a.api, a.ops_email, a.ops_secret, a.database_url, a.workspaces, a.records)
    )
    out = Path(__file__).resolve().parents[3] / "docs" / "benchmarks" / "m6.json"
    out.write_text(json.dumps(res, indent=2) + "\n")
    print(json.dumps(res, indent=2))
