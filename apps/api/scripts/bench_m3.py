"""M3 gate: the Insights dashboard (9 measures) over 100,000 records loads in under 1 second p95.

    ANALYTICS_DATABASE_URL=postgresql+asyncpg://... uv run python scripts/bench_m3.py --api http://127.0.0.1:8000

It signs up a workspace, makes the app live, loads facts straight into the analytics store (the API's
event path is measured elsewhere), then times the dashboard, one drill-down and a rebuild-free refresh.
Results go to docs/benchmarks/m3.json.
"""

import argparse
import asyncio
import datetime as dt
import json
import os
import random
import uuid
from pathlib import Path

import asyncpg
import httpx
from bench_m1 import summary, timed, workspace

STAGES = [
    "Sourced",
    "Screened",
    "Submitted",
    "Client shortlisted",
    "Interview",
    "Offer",
    "Placed",
    "Rejected",
]


async def main(api: str, records: int, samples: int) -> dict[str, object]:
    dsn = os.environ["ANALYTICS_DATABASE_URL"].replace("+asyncpg", "")
    async with httpx.AsyncClient(base_url=api, timeout=600) as c:
        h = await workspace(c)
        rel = (await c.post("/v1/apps/current/releases", headers=h)).json()["version"]
        (await c.post(f"/v1/apps/current/releases/{rel}/promote", headers=h)).raise_for_status()
        tenant = uuid.UUID((await c.get("/v1/me", headers=h)).json()["tenant_id"])
        (
            await c.get("/v1/measures", headers=h)
        ).raise_for_status()  # first call settles the projection
        rnd = random.Random(7)
        today = dt.datetime.now(dt.UTC).date()
        rows = []
        for _ in range(records):
            kind = rnd.random()
            day = today - dt.timedelta(days=rnd.randint(0, 89))
            if kind < 0.5:
                table, f = (
                    "candidate",
                    {"status": rnd.choice(["Active", "Active", "Placed", "Archived"])},
                )
            elif kind < 0.9:
                table, f = (
                    "submission",
                    {"stage": rnd.choice(STAGES), "submitted_on": day.isoformat()},
                )
            elif kind < 0.95:
                table, f = (
                    "offer",
                    {
                        "status": rnd.choice(["Sent", "Accepted", "Declined"]),
                        "sent_on": day.isoformat(),
                        "annual_ctc": rnd.randint(500000, 4000000),
                    },
                )
            else:
                table, f = (
                    "placement",
                    {"start_on": day.isoformat(), "fee": rnd.randint(50000, 400000)},
                )
            rows.append(
                (
                    tenant,
                    table,
                    uuid.uuid4(),
                    1,
                    json.dumps(f),
                    dt.datetime.now(dt.UTC),
                    None,
                    dt.datetime.now(dt.UTC),
                )
            )
        conn = await asyncpg.connect(dsn)
        try:
            await conn.executemany(
                "INSERT INTO fact_record (tenant_id, table_key, record_id, version, fields, occurred_at, owner_id, created_at) "
                "VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)",
                rows,
            )
            await conn.execute("ANALYZE fact_record")
        finally:
            await conn.close()
        dash, one, drill = [], [], []
        for _ in range(samples):
            ms, r = await timed(
                c, "GET", "/v1/measures", headers=h, params={"range": "last_90_days"}
            )
            r.raise_for_status()
            dash.append(ms)
            ms, r = await timed(c, "GET", "/v1/measures/submissions_by_stage", headers=h)
            r.raise_for_status()
            one.append(ms)
            ms, r = await timed(
                c,
                "GET",
                "/v1/measures/submissions_by_stage/records",
                headers=h,
                params={"group": "Sourced"},
            )
            r.raise_for_status()
            drill.append(ms)
        return {
            "records": records,
            "cards": 9,
            "dashboard": summary(dash),
            "one_card": summary(one),
            "drill_down": summary(drill),
        }


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://127.0.0.1:8000")
    ap.add_argument("--records", type=int, default=100_000)
    ap.add_argument("--samples", type=int, default=30)
    a = ap.parse_args()
    res = asyncio.run(main(a.api, a.records, a.samples))
    out = Path(__file__).resolve().parents[3] / "docs" / "benchmarks" / "m3.json"
    out.write_text(json.dumps(res, indent=2) + "\n")
    print(json.dumps(res, indent=2))
