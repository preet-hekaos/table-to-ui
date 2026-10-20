"""M2 gates (M2 PRD section 5): pipeline board, stage moves, approvals inbox, duplicates, merge.

Run against a running API:
    uv run python scripts/bench_m2.py --api http://127.0.0.1:8000 --rows 50000

A fresh workspace gets 500 submissions for the board, stage-move and inbox samples, then the
50,000-candidate import from bench_m1 for the duplicate list, then a 100-link merge.
Results go to docs/benchmarks/m2.json.
"""

import argparse
import asyncio
import json
import time
import uuid
from pathlib import Path
from typing import Any

import httpx

import bench_m1 as b


async def make(c: httpx.AsyncClient, h: dict[str, str], table: str, data: dict[str, Any]) -> dict[str, Any]:
    r = await c.post(f"/v1/records/{table}", headers=h, json={"data": data})
    r.raise_for_status()
    return r.json()  # type: ignore[no-any-return]


async def main(api: str, rows: int, samples: int) -> dict[str, Any]:
    async with httpx.AsyncClient(base_url=api, timeout=1800) as c:
        h = await b.workspace(c)
        out: dict[str, Any] = {}
        client = await make(c, h, "client", {"name": "Bench Client", "status": "Active"})
        reqs = [
            await make(c, h, "requirement", {"title": f"Role {i}", "client": client["id"], "status": "Open"})
            for i in range(5)
        ]
        entries: list[dict[str, Any]] = []
        t0 = time.perf_counter()
        for i in range(500):
            cand = await make(c, h, "candidate", {
                "full_name": f"Pipeline Person {i} {uuid.uuid4().hex[:4]}", "email": f"pp.{i}.{uuid.uuid4().hex[:6]}@example.in",
                "phone": f"+91 7{(i * 7919 + 12345) % 10**9:09d}", "skills": ["Java"], "status": "Active"})  # fmt: skip
            entries.append(await make(c, h, "submission", {
                "summary": f"Person {i}", "candidate": cand["id"], "requirement": reqs[i % 5]["id"]}))  # fmt: skip
        out["seeded_submissions"] = {"n": len(entries), "seconds": round(time.perf_counter() - t0, 1)}

        board = []
        for _ in range(samples):
            ms, r = await b.timed(c, "GET", "/v1/workflow/submission/board", headers=h)
            r.raise_for_status()
            board.append(ms)
        out["board_500_cards"] = {**b.summary(board), "cards": sum(len(x["cards"]) for x in r.json()["columns"]), "note": "25 cards per column are sent; counts cover all 500"}  # fmt: skip

        moves = []
        for e in entries[: min(samples, len(entries))]:
            ms, r = await b.timed(c, "PATCH", f"/v1/records/submission/{e['id']}", headers=h, json={"version": e["version"], "data": {"stage": "Screened"}})  # fmt: skip
            r.raise_for_status()
            moves.append(ms)
        out["stage_move"] = b.summary(moves)

        inbox = []
        for _ in range(samples):
            ms, r = await b.timed(c, "GET", "/v1/approvals", headers=h, params={"status": "pending"})
            r.raise_for_status()
            inbox.append(ms)
        out["approvals_inbox"] = b.summary(inbox)
        summary = []
        for _ in range(samples):
            ms, r = await b.timed(c, "GET", "/v1/workflow/submission/board", headers=h, params={"f.requirement": reqs[0]["id"]})  # fmt: skip
            r.raise_for_status()
            summary.append(ms)
        out["pipeline_for_one_requirement"] = b.summary(summary)

        out["import_candidates"] = await b.import_file(c, h, b.dataset(rows), load=True)
        dups = []
        for _ in range(max(10, samples // 10)):
            ms, r = await b.timed(c, "GET", "/v1/duplicates/candidate", headers=h)
            r.raise_for_status()
            dups.append(ms)
        out["duplicates_list"] = {**b.summary(dups), "pairs": len(r.json().get("pairs", r.json().get("items", [])))}  # fmt: skip

        keep = await make(c, h, "candidate", {"full_name": "Merge Keep", "email": "keep@example.in", "phone": "+91 70000 00001", "status": "Active"})  # fmt: skip
        drop = await make(c, h, "candidate", {"full_name": "Merge Keep", "email": "drop@example.in", "phone": "+91 70000 00002", "status": "Active"})  # fmt: skip
        for i in range(100):
            rq = await make(c, h, "requirement", {"title": f"Merge role {i}", "client": client["id"], "status": "Open"})  # fmt: skip
            await make(c, h, "submission", {"summary": f"Link {i}", "candidate": drop["id"], "requirement": rq["id"]})  # fmt: skip
        ms, r = await b.timed(c, "POST", "/v1/duplicates/candidate/merge", headers=h, json={"keep": keep["id"], "drop": drop["id"]})  # fmt: skip
        out["merge_100_links"] = {"status": r.status_code, "seconds": round(ms / 1000, 2)}
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://127.0.0.1:8000")
    ap.add_argument("--rows", type=int, default=50_000)
    ap.add_argument("--samples", type=int, default=100)
    args = ap.parse_args()
    res = asyncio.run(main(args.api, args.rows, args.samples))
    path = Path(__file__).resolve().parents[3] / "docs" / "benchmarks" / "m2.json"
    path.write_text(json.dumps(res, indent=2) + "\n")
    print(json.dumps(res, indent=2))
