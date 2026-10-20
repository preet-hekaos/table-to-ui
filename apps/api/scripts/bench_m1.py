"""M1 latency and import gates on a 50,000-candidate workspace (PRD section 5).

Run against a running API (the same one the e2e tests use):
    uv run python scripts/bench_m1.py --api http://127.0.0.1:8000 --rows 50000

It signs up a fresh workspace, imports a synthetic 50,000-row spreadsheet through the import API
(the S10 gate), then measures each latency gate with sequential requests, and checks that a
200,000-row file is accepted (profiled and validated). Results go to docs/benchmarks/m1.json.
"""

import argparse
import asyncio
import csv
import io
import json
import random
import statistics
import time
import uuid
from pathlib import Path
from typing import Any

import httpx
import pyotp

FIRST = ["Arjun", "Priya", "Rohan", "Ananya", "Vikram", "Kavya", "Rahul", "Sneha", "Aditya", "Meera", "Karthik", "Divya",
         "Siddharth", "Pooja", "Nikhil", "Lakshmi", "Amit", "Neha", "Suresh", "Isha", "Farhan", "Zoya", "Joseph", "Tanvi"]  # fmt: skip
LAST = ["Menon", "Sharma", "Iyer", "Patel", "Reddy", "Nair", "Gupta", "Rao", "Kulkarni", "Singh", "Das", "Joshi", "Pillai",
        "Verma", "Bose", "Shetty", "Chopra", "Mehta", "Banerjee", "Krishnan", "Khan", "DSouza", "Ghosh", "Agarwal"]  # fmt: skip
CITIES = ["Bengaluru", "Pune", "Hyderabad", "Chennai", "Mumbai", "Gurugram", "Noida", "Kochi", "Kolkata", "Ahmedabad", "Jaipur", "Indore"]
EMPLOYERS = ["Infosys", "TCS", "Wipro", "HCL", "Tech Mahindra", "Zoho", "Freshworks", "Razorpay", "Flipkart", "Accenture", "Cognizant", "Capgemini"]
SKILLS = ["Java", "Spring Boot", "Python", "SQL", "AWS", "React", "Node.js", "Docker", "Kubernetes", "Kafka", "PostgreSQL",
          "TypeScript", "Angular", "Selenium", "Power BI", "Excel", "Django", "Terraform", "Go", "Azure", "GCP", "Spark"]  # fmt: skip
TITLES = ["Software Engineer", "Senior Engineer", "Data Analyst", "QA Engineer", "Product Manager", "DevOps Engineer", "Tech Lead"]
PASSWORD = "correct-horse-battery"
HEADER = ["Name", "Email", "Mobile", "Company", "Title", "City", "Experience", "Expected CTC", "Notice", "Key Skills", "Status"]


def dataset(n: int, seed: int = 50_000) -> bytes:
    r = random.Random(seed)  # noqa: S311 - test data
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(HEADER)
    for i in range(n):
        first, last = r.choice(FIRST), r.choice(LAST)
        years = r.randrange(0, 20)
        months = r.choice([0, 3, 6, 9])
        w.writerow(
            [
                f"{first} {last}",
                f"{first.lower()}.{last.lower()}.{i}@example.in",
                f"9{(i * 7919) % 10**9:09d}",  # unique 10-digit mobile numbers
                r.choice(EMPLOYERS),
                r.choice(TITLES),
                r.choice(CITIES),
                f"{years} yrs {months} mo" if months else f"{years} yrs",
                f"{r.randrange(3, 60)} LPA",
                r.choice([0, 15, 30, 45, 60, 90]),
                ", ".join(r.sample(SKILLS, r.randrange(2, 7))),
                r.choice(["Active"] * 8 + ["Placed", "Archived"]),
            ]
        )
    return buf.getvalue().encode()


def pct(samples: list[float], p: float) -> float:
    s = sorted(samples)
    return round(s[min(len(s) - 1, int(round(p / 100 * (len(s) - 1))))], 1)


def summary(samples: list[float]) -> dict[str, float]:
    return {"n": len(samples), "p50_ms": pct(samples, 50), "p95_ms": pct(samples, 95), "p99_ms": pct(samples, 99), "mean_ms": round(statistics.mean(samples), 1)}


async def timed(c: httpx.AsyncClient, method: str, url: str, **kw: Any) -> tuple[float, httpx.Response]:
    t0 = time.perf_counter()
    r = await c.request(method, url, **kw)
    return (time.perf_counter() - t0) * 1000, r


async def workspace(c: httpx.AsyncClient) -> dict[str, str]:
    email = f"bench-{uuid.uuid4().hex[:8]}@bench.test"
    r = await c.post("/v1/auth/signup", json={"agency_name": "Bench Agency", "full_name": "Bench Owner", "email": email, "password": PASSWORD})
    r.raise_for_status()
    h = {"Authorization": f"Bearer {r.json()['token']}"}
    secret = (await c.post("/v1/auth/mfa/enroll", headers=h)).json()["secret"]
    (await c.post("/v1/auth/mfa/confirm", headers=h, json={"code": pyotp.TOTP(secret).now()})).raise_for_status()
    (await c.post("/v1/workspace/pack", headers=h, json={"pack_id": "recruitment"})).raise_for_status()
    return h


async def import_file(c: httpx.AsyncClient, h: dict[str, str], data: bytes, load: bool) -> dict[str, Any]:
    out: dict[str, Any] = {"rows": data.count(b"\n") - 1, "bytes": len(data)}
    t0 = time.perf_counter()
    f = (await c.post("/v1/files", headers=h, data={"kind": "import"}, files={"file": ("bench.csv", data)})).json()
    job = (await c.post("/v1/imports", headers=h, json={"file_id": f["id"], "table": "candidate"})).json()
    out["upload_and_profile_s"] = round(time.perf_counter() - t0, 1)
    mapping = {**job["mapping"], "Status": "status", "Title": "current_title", "City": "location"}
    (await c.put(f"/v1/imports/{job['id']}/mapping", headers=h, json={"mapping": mapping})).raise_for_status()
    t1 = time.perf_counter()
    v = await c.post(f"/v1/imports/{job['id']}/validate", headers=h)
    v.raise_for_status()
    out["validate_s"] = round(time.perf_counter() - t1, 1)
    out["valid"] = v.json()["report"]["valid"]
    out["duplicates"] = v.json()["report"]["duplicates_total"]
    if not load:
        return out
    t2 = time.perf_counter()
    (await c.post(f"/v1/imports/{job['id']}/start", headers=h)).raise_for_status()
    while True:
        await asyncio.sleep(5)
        j = (await c.get(f"/v1/imports/{job['id']}", headers=h)).json()
        if j["state"] in ("done", "failed"):
            break
    out["load_s"] = round(time.perf_counter() - t2, 1)
    out["total_s"] = round(time.perf_counter() - t0, 1)
    out["counts"] = j["counts"]
    out["state"] = j["state"]
    return out


async def main(api: str, rows: int, big: int, samples: int) -> dict[str, Any]:
    async with httpx.AsyncClient(base_url=api, timeout=1800) as c:
        h = await workspace(c)
        result: dict[str, Any] = {"dataset_rows": rows}
        result["import_50k"] = await import_file(c, h, dataset(rows), load=True)
        r = random.Random(7)  # noqa: S311 - test data

        screen: list[float] = []
        for _ in range(samples):
            t0 = time.perf_counter()
            await asyncio.gather(
                c.get("/v1/app/navigation", headers=h),
                c.get("/v1/app/screens/candidates", headers=h),
                c.get("/v1/app/tables/candidate", headers=h),
                c.get("/v1/records/candidate", headers=h, params={"limit": 50}),
                c.get("/v1/records/candidate/facets", headers=h, params={"fields": "skills,location,total_experience,notice_period_days,expected_ctc"}),
            )
            screen.append((time.perf_counter() - t0) * 1000)
        result["screen_load"] = summary(screen)

        saves = []
        for i in range(samples):
            ms, resp = await timed(c, "POST", "/v1/records/candidate", headers=h, json={"data": {
                "full_name": f"Bench Person {i}", "email": f"bench.{i}.{uuid.uuid4().hex[:6]}@example.in",
                "phone": f"+91 8{r.randrange(10**8, 10**9)}", "skills": ["Java"], "status": "Active"}})  # fmt: skip
            if resp.status_code == 201:
                saves.append(ms)
        result["save"] = summary(saves)

        lists = []
        for _ in range(samples):
            params = r.choice(
                [
                    {"limit": 50},
                    {"limit": 50, "sort": "full_name", "direction": "asc"},
                    {"limit": 50, "f.location": r.choice(CITIES)},
                    {"limit": 50, "f.skills": r.choice(SKILLS)},
                    {"limit": 50, "f.status": "Active", "r.total_experience": "60..120"},
                    {"limit": 50, "f.location": r.choice(CITIES), "f.skills": r.choice(SKILLS), "sort": "updated_at"},
                ]
            )
            ms, _ = await timed(c, "GET", "/v1/records/candidate", headers=h, params=params)
            lists.append(ms)
        result["lists_and_filters"] = summary(lists)

        searches = []
        words = [*FIRST, *LAST, *SKILLS, *EMPLOYERS, "arjn", "menn", "kubernets", "pythn"]
        for _ in range(samples):
            ms, _ = await timed(c, "GET", "/v1/records/candidate", headers=h, params={"limit": 50, "q": r.choice(words)})
            searches.append(ms)
        result["keyword_search"] = summary(searches)

        bar = []
        for _ in range(samples):
            ms, _ = await timed(c, "GET", "/v1/search", headers=h, params={"q": r.choice(FIRST)[:4]})
            bar.append(ms)
        result["command_bar"] = summary(bar)

        req = (await c.post("/v1/records/client", headers=h, json={"data": {"name": "Bench Client"}})).json()
        rq = (await c.post("/v1/records/requirement", headers=h, json={"data": {"title": "Java lead", "client": req["id"],
              "skills": ["Java", "Kafka", "SQL"], "location": "Pune", "min_experience": 48, "max_experience": 120, "budget_max": 3000000, "max_notice_days": 60}})).json()  # fmt: skip
        matches = []
        for _ in range(max(10, samples // 10)):
            ms, resp = await timed(c, "GET", f"/v1/matching/requirement_matches/{rq['id']}", headers=h)
            matches.append(ms)
        result["ranked_matches"] = {**summary(matches), "considered": resp.json()["considered"]}

        if big:
            result["accept_200k"] = await import_file(c, h, dataset(big, seed=200_000), load=False)
    return result


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://127.0.0.1:8000")
    ap.add_argument("--rows", type=int, default=50_000)
    ap.add_argument("--big", type=int, default=200_000)
    ap.add_argument("--samples", type=int, default=200)
    args = ap.parse_args()
    res = asyncio.run(main(args.api, args.rows, args.big, args.samples))
    out = Path(__file__).resolve().parents[3] / "docs" / "benchmarks" / "m1.json"
    out.write_text(json.dumps(res, indent=2) + "\n")
    print(json.dumps(res, indent=2))
