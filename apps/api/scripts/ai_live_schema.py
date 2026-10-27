"""Try schema-from-document on a real provider (not part of CI). Needs GROQ_API_KEY and/or GOOGLE_API_KEY
in apps/api/.env.local and the API running without AI_PROVIDER=fake.

    uv run python scripts/ai_live_schema.py --api http://127.0.0.1:8001

Each document is read on a fresh workspace; prints the proposed tables and how many items were dropped
for lacking a quote. Nothing is created."""

import argparse
import asyncio

import httpx
from bench_m1 import workspace

DOCUMENTS = {
    "memo.txt": (
        "Staffing agency data notes\n\n"
        "We keep a list of Clients: company name, industry, city, website and the payment terms in days.\n"
        "Each Client has Contacts: full name, email, phone and job title. A contact belongs to one client.\n"
        "We also track Job Orders: title, the client it is for, number of openings, salary range per year, "
        "status (Open, On hold, Filled, Cancelled) and the date it was opened.\n"
        "Candidates: full name, email, phone, current city, total experience in months, notice period in days.\n"
    ),
    "dictionary.txt": (
        "DATA DICTIONARY\n"
        "Table: supplier\n"
        "  name (text, required), country (text), rating (1-5), onboarded_on (date)\n"
        "Table: purchase_order\n"
        "  po_number (text, required, unique), supplier (links to supplier), total_amount (money), "
        "status: Draft | Sent | Received | Paid\n"
    ),
    "unrelated.txt": (
        "Dear team, the office will be closed on Friday for the holiday. Please finish your timesheets "
        "before then and remember to switch off your monitors. Thanks, Priya.\n"
    ),
}


async def main(api: str) -> None:
    async with httpx.AsyncClient(base_url=api, timeout=120) as c:
        h = await workspace(c)
        (
            await c.put("/v1/ai/settings", headers=h, json={"enabled": True, "tables": []})
        ).raise_for_status()
        for name, text in DOCUMENTS.items():
            r = await c.post(
                "/v1/ai/schema-from-document", headers=h, files={"file": (name, text.encode())}
            )
            print(f"\n> {name}: HTTP {r.status_code}")
            if r.status_code != 200:
                print("  ", r.json().get("detail") or r.json())
                continue
            out = r.json()
            print(f"  {out['tables']} tables, {out['fields']} fields, {out['dropped']} dropped")
            for t in out["schema"]["$defs"].values():
                print(
                    f"  - {t['title']}: "
                    + ", ".join(
                        f"{p['title']} [{p.get('x-field-type') or 'select' if 'enum' in p else 'link' if '$ref' in p else '?'}]"
                        for p in t["properties"].values()
                    )
                )


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://127.0.0.1:8000")
    asyncio.run(main(ap.parse_args().api))
