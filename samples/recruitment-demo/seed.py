"""Fills a Recruitment workspace with the demo data, going through the app's own API.

Why a script and not Import for everything: a new submission must start at "Sourced" and move
stage by stage, an offer needs a passed interview first, and a placement closes its submission.
This script follows those rules in order, so the records look exactly like real use (with stage
history, audit trail, filled positions). Import is fine for the simple tables, not for the pipeline.

Usage (the API must be running; the workspace should be new and have the Recruitment pack):

    cd apps/api
    uv run python ../../samples/recruitment-demo/seed.py --email you@company.com --password '...'

Add --code 123456 if your account has two-step sign-in turned on. Add --api to point elsewhere
(default http://127.0.0.1:8000).
"""

import argparse
import csv
import pathlib
import sys
from typing import Any

import httpx

HERE = pathlib.Path(__file__).parent
STEPS = ["Sourced", "Screened", "Submitted", "Client shortlisted", "Interview", "Offer"]


def rows(name: str) -> list[dict[str, str]]:
    with open(HERE / name, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


class Seeder:
    def __init__(self, api: str, email: str, password: str, code: str | None) -> None:
        self.http = httpx.Client(base_url=api, timeout=60)
        r = self.http.post("/v1/auth/sign-in", json={"email": email, "password": password})
        if r.status_code != 200:
            sys.exit(f"Sign-in failed ({r.status_code}): {r.text}")
        self.http.headers["Authorization"] = f"Bearer {r.json()['token']}"
        if r.json().get("mfa_required"):
            if not code:
                sys.exit("This account uses two-step sign-in: run again with --code <6 digits>.")
            v = self.http.post("/v1/auth/mfa/verify", json={"code": code})
            if v.status_code != 204:
                sys.exit(f"The code was not accepted ({v.status_code}): {v.text}")
        self.defs: dict[str, dict[str, Any]] = {}
        self.ids: dict[str, dict[str, str]] = {}  # table -> lower-cased title -> id
        self.failures: list[str] = []
        self.counts: dict[str, int] = {}

    # -- plumbing ---------------------------------------------------------------
    def fields(self, table: str) -> dict[str, dict[str, Any]]:
        if table not in self.defs:
            r = self.http.get(f"/v1/app/tables/{table}")
            r.raise_for_status()
            self.defs[table] = {f["key"]: f for f in r.json()["table"]["fields"]}
        return self.defs[table]

    def convert(self, table: str, key: str, text: str) -> Any:
        f = self.fields(table).get(key)
        if f is None:
            sys.exit(f"{table} has no field '{key}'. Is this a Recruitment workspace?")
        t = f["type"]
        if t == "reference":
            found = self.ids.get(f["ref_table"], {}).get(text.casefold())
            if found is None:
                raise LookupError(f"no {f['ref_table']} called '{text}'")
            return found
        if t == "tags":
            return [x.strip() for x in text.split(",") if x.strip()]
        if t == "boolean":
            return text.strip().lower() in ("yes", "true", "1")
        if t in ("integer", "money", "months"):
            return int(float(text))
        if t == "decimal":
            return float(text)
        return text

    def data(self, table: str, row: dict[str, str], labels: dict[str, str]) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for label, key in labels.items():
            if row.get(label, "") != "":
                out[key] = self.convert(table, key, row[label])
        return out

    def create(self, table: str, body: dict[str, Any], title: str) -> str | None:
        r = self.http.post(f"/v1/records/{table}", json={"data": body})
        if r.status_code != 201:
            self.failures.append(f"{table} '{title}': {r.status_code} {r.json().get('message', r.text)[:160]}")
            return None
        rid = r.json()["id"]
        self.ids.setdefault(table, {}).setdefault(title.casefold(), rid)
        self.counts[table] = self.counts.get(table, 0) + 1
        return str(rid)

    def move(self, sub: str, to: str, extra: dict[str, Any]) -> bool:
        cur = self.http.get(f"/v1/records/submission/{sub}").json()
        r = self.http.patch(
            f"/v1/records/submission/{sub}", json={"version": cur["version"], "data": {"stage": to, **extra}}
        )
        if r.status_code != 200:
            self.failures.append(f"submission {sub} -> {to}: {r.status_code} {r.json().get('message', r.text)[:160]}")
            return False
        return True

    # -- the data ---------------------------------------------------------------
    def write_rows(self, table: str, items: list[dict[str, str]], labels: dict[str, str], title_label: str) -> None:
        for row in items:
            try:
                self.create(table, self.data(table, row, labels), row[title_label])
            except LookupError as e:
                self.failures.append(f"{table} '{row[title_label]}': {e}")

    def reopen(self, later: dict[str, dict[str, str]]) -> None:
        """Requirements loaded earlier with Filled or Closed status are opened again while the pipeline is built."""
        for title in later:
            rid = self.ids.get("requirement", {}).get(title.casefold())
            if rid is None:
                continue
            cur = self.http.get(f"/v1/records/requirement/{rid}").json()
            if cur["data"].get("status") != "Open":
                self.http.patch(f"/v1/records/requirement/{rid}", json={"version": cur["version"], "data": {"status": "Open"}})

    def settle(self, later: dict[str, dict[str, str]]) -> None:
        """Mark requirements On hold, Filled or Closed now that their submissions exist."""
        for title, row in later.items():
            rid = self.ids["requirement"][title.casefold()]
            cur = self.http.get(f"/v1/records/requirement/{rid}").json()
            body = {"status": row["Status"], "filled": int(row["Filled"] or 0)}
            if cur["data"].get("filled"):
                body["filled"] = max(body["filled"], int(cur["data"]["filled"]))
            r = self.http.patch(f"/v1/records/requirement/{rid}", json={"version": cur["version"], "data": body})
            if r.status_code != 200:
                self.failures.append(f"requirement '{title}' -> {row['Status']}: {r.status_code} {r.text[:160]}")

    def have(self, table: str) -> bool:
        """True when the table already has records (loaded by hand earlier); their ids are kept for links."""
        title = self.http.get(f"/v1/app/tables/{table}").json()["table"]["title_field"]
        page, seen = 1, 0
        oldest: dict[str, str] = {}
        while True:
            r = self.http.get(f"/v1/records/{table}", params={"page": page, "page_size": 100})
            items = r.json().get("items", [])
            for it in items:
                t = (it["data"].get(title) or "").casefold()
                if t and it["created_at"] < oldest.get(t, "~"):  # a name used twice means the first one made
                    oldest[t] = it["created_at"]
                    self.ids.setdefault(table, {})[t] = it["id"]
            seen += len(items)
            if len(items) < 100:
                break
            page += 1
        if seen:
            print(f"{table}: {seen} records already there, left as they are")
        return seen > 0

    def simple(self, table: str, file: str, labels: dict[str, str], title_label: str) -> None:
        if self.have(table):
            return
        for row in rows(file):
            try:
                self.create(table, self.data(table, row, labels), row[title_label])
            except LookupError as e:
                self.failures.append(f"{table} '{row[title_label]}': {e}")

    def run(self) -> None:
        L = lambda *pairs: dict(pairs)  # noqa: E731
        self.simple("skill", "01-skills.csv", L(("Name", "name"), ("Category", "category")), "Name")
        self.simple("client", "02-clients.csv", L(("Name", "name"), ("Status", "status"), ("Industry", "industry"), ("City", "city"), ("Website", "website"), ("Fee (% of annual CTC)", "fee_percent"), ("Minimum fee", "min_fee"), ("Payment terms (days)", "payment_terms_days"), ("Terms and notes", "terms_notes")), "Name")
        self.simple("contact", "03-contacts.csv", L(("Name", "name"), ("Client", "client"), ("Designation", "designation"), ("Email", "email"), ("Phone", "phone"), ("Primary contact", "is_primary")), "Name")
        reqs = rows("04-requirements.csv")
        later = {r["Title"]: r for r in reqs if r["Status"] != "Open"}
        for r in reqs:  # everything starts Open: a filled or closed requirement takes no new submissions
            r["Status"] = "Open"
        if not self.have("requirement"):
            self.write_rows("requirement", reqs, L(("Title", "title"), ("Client", "client"), ("Client contact", "contact"), ("Status", "status"), ("Positions", "positions"), ("Skills", "skills"), ("Location", "location"), ("Minimum experience", "min_experience"), ("Maximum experience", "max_experience"), ("Maximum notice (days)", "max_notice_days"), ("Budget from", "budget_min"), ("Budget up to", "budget_max"), ("Target date", "target_date"), ("Brief", "brief")), "Title")
        self.simple("candidate", "05-candidates.csv", L(("Full name", "full_name"), ("Email", "email"), ("Phone", "phone"), ("Current title", "current_title"), ("Current employer", "current_employer"), ("Location", "location"), ("Notice period (days)", "notice_period_days"), ("Status", "status"), ("Skills", "skills"), ("Total experience", "total_experience"), ("Source", "source"), ("Current CTC", "current_ctc"), ("Expected CTC", "expected_ctc")), "Full name")
        self.simple("consent_record", "06-consent-records.csv", L(("Candidate", "candidate"), ("Purpose", "purpose"), ("Status", "status"), ("Date", "given_on")), "Purpose")
        self.reopen(later)
        if not self.have("submission"):
            self.pipeline()
        self.settle(later)
        self.simple("task", "12-tasks.csv", L(("Title", "title"), ("Status", "status"), ("Due date", "due_on"), ("Candidate", "candidate"), ("Requirement", "requirement")), "Title")
        self.simple("interaction", "13-interactions.csv", L(("Summary", "summary"), ("Kind", "kind"), ("Candidate", "candidate"), ("Client", "client"), ("Date", "occurred_on"), ("Details", "details")), "Summary")

    def pipeline(self) -> None:
        interviews: dict[str, list[dict[str, str]]] = {}
        for r in rows("09-interviews.csv"):
            interviews.setdefault(r["Submission"], []).append(r)
        offers = {r["Submission"]: r for r in rows("10-offers.csv")}
        places = {r["Submission"]: r for r in rows("11-placements.csv")}
        # Placed last: a placement fills its requirement, and a filled requirement takes no more submissions.
        for r in sorted(rows("08-submissions.csv"), key=lambda x: x["Stage"] == "Placed"):
            summary, target = r["Summary"], r["Stage"]
            try:
                body = self.data("submission", r, {"Summary": "summary", "Candidate": "candidate", "Requirement": "requirement", "Note": "note"})
            except LookupError as e:
                self.failures.append(f"submission '{summary}': {e}")
                continue
            sub = self.create("submission", {**body, "stage": "Sourced"}, summary)
            if sub is None:
                continue
            path = self.path_to(target, summary in interviews)
            for to in path:
                extra: dict[str, Any] = {}
                if to == "Submitted":
                    contact = r["Client contact"] or self.contact_of(r)
                    extra = {"contact": self.convert("submission", "contact", contact)}
                    if r["Submitted on"]:
                        extra["submitted_on"] = r["Submitted on"]
                if to == "Client shortlisted":
                    extra = {"client_feedback": r["Client feedback"] or "Profile shortlisted by the client."}
                if to == "Rejected":
                    extra = {"rejection_reason": r["Reason for rejection"] or "Other"}
                if to == "Interview":
                    self.add_interviews(sub, interviews.get(summary, []))
                if not self.move(sub, to, extra):
                    break
            if target in ("Offer", "Placed") and summary in offers:
                o = offers[summary]
                self.create("offer", self.data("offer", o, {"Summary": "summary", "Submission": "submission", "Annual CTC": "annual_ctc", "Joining date": "joining_on", "Status": "status", "Sent on": "sent_on"}), o["Summary"])
            if target == "Placed" and summary in places:
                p = places[summary]
                self.create("placement", self.data("placement", p, {"Summary": "summary", "Candidate": "candidate", "Client": "client", "Requirement": "requirement", "Submission": "submission", "Start date": "start_on", "Annual CTC": "annual_ctc", "Fee": "fee", "Status": "status"}), p["Summary"])

    @staticmethod
    def path_to(target: str, had_interviews: bool) -> list[str]:
        """The stages a new submission passes through, in the order the workflow allows."""
        if target == "Sourced":
            return []
        if target in STEPS:
            return STEPS[1 : STEPS.index(target) + 1]
        if target == "Placed":
            return STEPS[1:]  # a placement then closes it
        if target == "Rejected":
            return [*(STEPS[1:5] if had_interviews else STEPS[1:3]), "Rejected"]
        return ["Screened", target]  # Withdrawn, On hold

    def contact_of(self, sub_row: dict[str, str]) -> str:
        req = next(x for x in rows("04-requirements.csv") if x["Title"] == sub_row["Requirement"])
        return req["Client contact"]

    def add_interviews(self, sub: str, items: list[dict[str, str]]) -> None:
        for i in items:
            body = self.data("interview", i, {"Summary": "summary", "Scheduled on": "scheduled_on", "Mode": "mode", "Status": "status", "Feedback": "feedback", "Outcome": "outcome", "Panel (client side)": "panel"})
            body["submission"] = sub
            self.create("interview", body, i["Summary"])

    def report(self) -> None:
        print("Created:", ", ".join(f"{n} {t}" for t, n in self.counts.items()))
        if self.failures:
            print(f"\n{len(self.failures)} problems:")
            for f in self.failures[:40]:
                print(" -", f)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://127.0.0.1:8000")
    ap.add_argument("--email", required=True)
    ap.add_argument("--password", required=True)
    ap.add_argument("--code")
    a = ap.parse_args()
    s = Seeder(a.api, a.email, a.password, a.code)
    s.run()
    s.report()
