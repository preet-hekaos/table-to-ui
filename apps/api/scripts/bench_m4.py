"""M4 gates: the hourly date check over 100,000 records finishes in under 30 s, and automations add
under 50 ms to a save.

    DATABASE_URL=postgresql+asyncpg://... uv run python scripts/bench_m4.py --api http://127.0.0.1:8000

It signs up a workspace on the running API, makes the app live, writes 100,000 submissions straight into
the tenant's table (the API's write path is measured elsewhere), then times the date check in this
process: the first sweep (which catches up the last seven days and runs every automation that is due)
and a second sweep (the steady state every hour). It also times saving a candidate with the starter
automations on and with all of them off. Results go to docs/benchmarks/m4.json.
"""

import argparse
import asyncio
import datetime as dt
import json
import os
import random
import time
import uuid
from pathlib import Path

import asyncpg
import httpx
from bench_m1 import summary, timed, workspace

from tableui.automation.public import check_dates
from tableui.platform.config import Settings
from tableui.platform.db import Database
from tableui.platform.ids import schema_name
from tableui.platform.mail import LogMailer

STAGES = ["Sourced", "Screened", "Submitted", "Client shortlisted", "Interview", "Rejected"]


async def saves(c: httpx.AsyncClient, h: dict[str, str], n: int, tag: str) -> list[float]:
    out = []
    for i in range(n):
        ms, r = await timed(
            c,
            "POST",
            "/v1/records/candidate",
            headers=h,
            json={
                "data": {
                    "full_name": f"Bench {tag} {i}",
                    "email": f"bench-{tag}-{i}-{uuid.uuid4().hex[:6]}@gmail.com",
                    "phone": f"+91 9{random.randint(100000000, 999999999)}",
                    "status": "Active",
                }
            },
        )
        r.raise_for_status()
        out.append(ms)
    return out


async def main(api: str, records: int, samples: int) -> dict[str, object]:
    dsn = os.environ["DATABASE_URL"]
    async with httpx.AsyncClient(base_url=api, timeout=600) as c:
        h = await workspace(c)
        rel = (await c.post("/v1/apps/current/releases", headers=h)).json()["version"]
        (await c.post(f"/v1/apps/current/releases/{rel}/promote", headers=h)).raise_for_status()
        tenant = uuid.UUID((await c.get("/v1/me", headers=h)).json()["tenant_id"])
        owner = uuid.UUID((await c.get("/v1/me", headers=h)).json()["user_id"])

        on = await saves(c, h, samples, "on")  # starter automations switched on

        rnd = random.Random(11)
        today = dt.datetime.now(dt.UTC).date()
        rows = []
        for i in range(records):
            day = today - dt.timedelta(days=rnd.randint(0, 89))
            data = {
                "summary": f"Bench submission {i}",
                "candidate": str(uuid.uuid4()),
                "requirement": str(uuid.uuid4()),
                "stage": rnd.choice(STAGES),
                "submitted_on": day.isoformat(),
            }
            rows.append((uuid.uuid4(), tenant, json.dumps(data), owner))
        conn = await asyncpg.connect(dsn.replace("+asyncpg", ""))
        schema = schema_name(tenant)
        try:
            await conn.executemany(
                f'INSERT INTO "{schema}"."submission" (id, tenant_id, data, owner_id, search_doc, '  # noqa: S608 - schema name is generated, not user input
                "created_by, updated_by) VALUES ($1,$2,$3::jsonb,$4,'',$4,$4)",
                rows,
            )
            await conn.execute(f'ANALYZE "{schema}"."submission"')
        finally:
            await conn.close()

        settings = Settings(database_url=dsn, run_outbox_relay=False)
        db = Database(dsn)
        try:
            t0 = time.perf_counter()
            first = await check_dates(db, LogMailer(), settings, tenant)
            first_s = time.perf_counter() - t0
            t0 = time.perf_counter()
            again = await check_dates(db, LogMailer(), settings, tenant)
            again_s = time.perf_counter() - t0
        finally:
            await db.dispose()

        # Same saves with every starter switched off, to see what the automations add.
        for a in (await c.get("/v1/studio/automations", headers=h)).json():
            (
                await c.put(
                    f"/v1/studio/automations/{a['key']}", headers=h, json={"enabled": False}
                )
            ).raise_for_status()
        rel = (await c.post("/v1/apps/current/releases", headers=h)).json()["version"]
        (await c.post(f"/v1/apps/current/releases/{rel}/promote", headers=h)).raise_for_status()
        off = await saves(c, h, samples, "off")
        s_on, s_off = summary(on), summary(off)
        return {
            "records": records,
            "first_sweep": {"runs_started": first, "seconds": round(first_s, 2)},
            "steady_sweep": {"runs_started": again, "seconds": round(again_s, 2)},
            "save_with_automations": s_on,
            "save_without_automations": s_off,
            "added_to_a_save_p95_ms": round(s_on["p95_ms"] - s_off["p95_ms"], 1),
        }


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://127.0.0.1:8000")
    ap.add_argument("--records", type=int, default=100_000)
    ap.add_argument("--samples", type=int, default=100)
    a = ap.parse_args()
    res = asyncio.run(main(a.api, a.records, a.samples))
    out = Path(__file__).resolve().parents[3] / "docs" / "benchmarks" / "m4.json"
    out.write_text(json.dumps(res, indent=2) + "\n")
    print(json.dumps(res, indent=2))
