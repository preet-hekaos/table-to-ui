"""M2 stages and guard rules: moves follow the workflow, rules block with reasons, overrides are audited."""

import uuid
from typing import Any

import httpx
from sqlalchemy import text

from tableui.platform.db import Database
from tableui.platform.mail import InMemoryMailer
from tests.conftest import PASSWORD, Agency


async def _make(client: httpx.AsyncClient, a: Agency, table: str, data: dict[str, Any]) -> str:
    r = await client.post(f"/v1/records/{table}", headers=a.h(), json={"data": data})
    assert r.status_code == 201, r.text
    return str(r.json()["id"])


async def _world(client: httpx.AsyncClient, a: Agency) -> dict[str, str]:
    cand = await _make(
        client,
        a,
        "candidate",
        {
            "full_name": "Arjun Menon",
            "email": f"arjun.{uuid.uuid4().hex[:6]}@gmail.com",
            "phone": f"+91 98{uuid.uuid4().int % 10**8:08d}",
            "status": "Active",
        },
    )
    client_id = await _make(client, a, "client", {"name": "Aurora", "status": "Active"})
    req = await _make(
        client, a, "requirement", {"title": "Java lead", "client": client_id, "status": "Open"}
    )
    return {"candidate": cand, "client": client_id, "requirement": req}


async def _entry(client: httpx.AsyncClient, a: Agency, w: dict[str, str]) -> dict[str, Any]:
    r = await client.post(
        "/v1/records/submission",
        headers=a.h(),
        json={
            "data": {
                "summary": "Arjun for Java lead",
                "candidate": w["candidate"],
                "requirement": w["requirement"],
            }
        },
    )
    assert r.status_code == 201, r.text
    return r.json()  # type: ignore[no-any-return]


async def _move(
    client: httpx.AsyncClient,
    a: Agency,
    entry: dict[str, Any],
    to: str,
    extra: dict[str, Any] | None = None,
    token: str | None = None,
) -> httpx.Response:
    r = await client.patch(
        f"/v1/records/submission/{entry['id']}",
        headers=a.h(token),
        json={"version": entry["version"], "data": {"stage": to, **(extra or {})}},
    )
    if r.status_code == 200:
        entry["version"] = r.json()["version"]
    return r


async def test_new_entries_start_at_the_first_stage(client: httpx.AsyncClient) -> None:
    a = Agency(client, "Flow Co", f"w-{uuid.uuid4().hex[:8]}@flow.test")
    await a.sign_up("recruitment")
    w = await _world(client, a)
    entry = await _entry(client, a, w)
    assert entry["data"]["stage"] == "Sourced"
    skip = await client.post(
        "/v1/records/submission",
        headers=a.h(),
        json={
            "data": {
                "summary": "x",
                "candidate": w["candidate"],
                "requirement": await _make(
                    client,
                    a,
                    "requirement",
                    {"title": "Other", "client": w["client"], "status": "Open"},
                ),
                "stage": "Offer",
            }
        },
    )
    assert skip.status_code == 409 and skip.json()["rule"]["check"] == "R-05.start"


async def test_skipping_a_stage_is_refused_with_the_reason(client: httpx.AsyncClient) -> None:
    a = Agency(client, "Skip Co", f"w-{uuid.uuid4().hex[:8]}@skip.test")
    await a.sign_up("recruitment")
    entry = await _entry(client, a, await _world(client, a))
    r = await _move(client, a, entry, "Interview")
    assert r.status_code == 409
    body = r.json()
    assert body["rule"]["check"] == "R-05.transition" and "Allowed next steps" in body["detail"]
    ok = await _move(client, a, entry, "Screened")
    assert ok.status_code == 200 and ok.json()["data"]["stage"] == "Screened"


async def test_guard_rules_along_the_whole_pipeline(client: httpx.AsyncClient) -> None:
    a = Agency(client, "Pipe Co", f"w-{uuid.uuid4().hex[:8]}@pipe.test")
    await a.sign_up("recruitment")
    w = await _world(client, a)
    entry = await _entry(client, a, w)
    assert (await _move(client, a, entry, "Screened")).status_code == 200

    # R-02: no consent, no submission.
    r = await _move(client, a, entry, "Submitted")
    assert r.status_code == 409 and r.json()["rule"]["check"] == "R-02.consent"
    await _make(
        client,
        a,
        "consent_record",
        {"candidate": w["candidate"], "purpose": "Share with clients", "status": "Given"},
    )
    for stage in ("Submitted", "Client shortlisted", "Interview"):
        assert (await _move(client, a, entry, stage)).status_code == 200, stage

    # R-06: an offer needs a passed interview.
    r = await _move(client, a, entry, "Offer")
    assert r.status_code == 409 and r.json()["rule"]["check"] == "R-06.interview"
    await _make(
        client,
        a,
        "interview",
        {"summary": "Round 1", "submission": entry["id"], "status": "Done", "outcome": "Pass"},
    )
    assert (await _move(client, a, entry, "Offer")).status_code == 200

    # R-08: a placement needs an accepted offer.
    r = await _move(client, a, entry, "Placed")
    assert r.status_code == 409 and r.json()["rule"]["check"] == "R-08.offer"
    await _make(
        client, a, "offer", {"summary": "Offer", "submission": entry["id"], "status": "Accepted"}
    )
    assert (await _move(client, a, entry, "Placed")).status_code == 200

    # An end state cannot move on.
    r = await _move(client, a, entry, "Offer")
    assert r.status_code == 409 and r.json()["rule"]["check"] == "R-05.ended"


async def test_one_entry_per_candidate_and_reason_for_rejection(
    client: httpx.AsyncClient,
) -> None:
    a = Agency(client, "Dup Co", f"w-{uuid.uuid4().hex[:8]}@dup.test")
    await a.sign_up("recruitment")
    w = await _world(client, a)
    entry = await _entry(client, a, w)
    again = await client.post(
        "/v1/records/submission",
        headers=a.h(),
        json={
            "data": {
                "summary": "again",
                "candidate": w["candidate"],
                "requirement": w["requirement"],
            }
        },
    )
    assert again.status_code == 409 and again.json()["rule"]["check"] == "R-03.duplicate"
    r = await _move(client, a, entry, "Rejected")
    assert r.status_code == 409 and r.json()["rule"]["check"] == "R-12.reason"
    ok = await _move(client, a, entry, "Rejected", {"rejection_reason": "Skills mismatch"})
    assert ok.status_code == 200


async def test_a_filled_requirement_takes_no_new_candidates(client: httpx.AsyncClient) -> None:
    a = Agency(client, "Full Co", f"w-{uuid.uuid4().hex[:8]}@full.test")
    await a.sign_up("recruitment")
    w = await _world(client, a)
    req = (await client.get(f"/v1/records/requirement/{w['requirement']}", headers=a.h())).json()
    r = await client.patch(
        f"/v1/records/requirement/{w['requirement']}",
        headers=a.h(),
        json={"version": req["version"], "data": {"status": "Filled"}},
    )
    assert r.status_code == 200
    blocked = await client.post(
        "/v1/records/submission",
        headers=a.h(),
        json={
            "data": {"summary": "x", "candidate": w["candidate"], "requirement": w["requirement"]}
        },
    )
    assert blocked.status_code == 409 and blocked.json()["rule"]["check"] == "R-09.closed"


async def test_fit_warnings_do_not_block(client: httpx.AsyncClient) -> None:
    a = Agency(client, "Fit Co", f"w-{uuid.uuid4().hex[:8]}@fit.test")
    await a.sign_up("recruitment")
    cand = await _make(
        client,
        a,
        "candidate",
        {
            "full_name": "Late Joiner",
            "email": f"l.{uuid.uuid4().hex[:6]}@gmail.com",
            "phone": f"+91 97{uuid.uuid4().int % 10**8:08d}",
            "notice_period_days": 90,
        },
    )
    client_id = await _make(client, a, "client", {"name": "Zen", "status": "Active"})
    req = await _make(
        client,
        a,
        "requirement",
        {"title": "Fast hire", "client": client_id, "status": "Open", "max_notice_days": 30},
    )
    r = await client.post(
        "/v1/records/submission",
        headers=a.h(),
        json={"data": {"summary": "x", "candidate": cand, "requirement": req}},
    )
    assert r.status_code == 201
    assert [x["check"] for x in r.json()["warnings"]] == ["R-04.notice"]


async def test_override_needs_permission_and_a_reason_and_is_audited(
    client: httpx.AsyncClient, db: Database, mailer: InMemoryMailer
) -> None:
    boss = Agency(client, "Over Co", f"w-{uuid.uuid4().hex[:8]}@over.test")
    await boss.sign_up("recruitment")
    w = await _world(client, boss)
    await _make(
        client,
        boss,
        "consent_record",
        {"candidate": w["candidate"], "purpose": "Share with clients", "status": "Given"},
    )
    entry = await _entry(client, boss, w)

    # A recruiter has no override permission, even when asking for one.
    email = f"rec-{uuid.uuid4().hex[:8]}@over.test"
    r = await client.post(
        "/v1/invitations", headers=boss.h(), json={"email": email, "role": "recruiter"}
    )
    token = mailer.sent[-1]["body"].split("token=")[1].split()[0]
    r = await client.post(
        f"/v1/invitations/{token}/accept", json={"full_name": "Rec", "password": PASSWORD}
    )
    rec = Agency(client, boss.name, email)
    rec.token = r.json()["token"]
    await rec.enrol_mfa(rec.token)
    body = {
        "version": entry["version"],
        "data": {"stage": "Interview"},
        "override": {"checks": ["R-05.transition"], "reason": "Client asked"},
    }
    denied = await client.patch(f"/v1/records/submission/{entry['id']}", headers=rec.h(), json=body)
    assert denied.status_code == 403

    # The admin can, but only with a reason.
    no_reason = await client.patch(
        f"/v1/records/submission/{entry['id']}",
        headers=boss.h(),
        json={**body, "override": {"checks": ["R-05.transition"], "reason": " "}},
    )
    assert no_reason.status_code == 422
    ok = await client.patch(f"/v1/records/submission/{entry['id']}", headers=boss.h(), json=body)
    assert ok.status_code == 200 and ok.json()["data"]["stage"] == "Interview"
    async with db.control() as s:
        detail = (
            await s.execute(
                text(
                    "SELECT detail FROM control.audit_event WHERE subject_id = :i "
                    "AND action = 'submission.update' ORDER BY id DESC LIMIT 1"
                ),
                {"i": entry["id"]},
            )
        ).scalar_one()
    assert detail["override_reason"] == "Client asked"
    assert detail["overrides"][0]["check"] == "R-05.transition"


async def test_two_people_moving_one_entry_exactly_one_wins(client: httpx.AsyncClient) -> None:
    a = Agency(client, "Race Co", f"w-{uuid.uuid4().hex[:8]}@race.test")
    await a.sign_up("recruitment")
    entry = await _entry(client, a, await _world(client, a))
    first = await _move(client, a, dict(entry), "Screened")
    second = await _move(client, a, dict(entry), "Rejected", {"rejection_reason": "Other"})
    assert first.status_code == 200
    assert second.status_code == 409 and second.json()["type"].endswith("version-conflict")


async def test_board_counts_and_stage_history(client: httpx.AsyncClient) -> None:
    a = Agency(client, "Board Co", f"w-{uuid.uuid4().hex[:8]}@board.test")
    await a.sign_up("recruitment")
    w = await _world(client, a)
    entry = await _entry(client, a, w)
    assert (await _move(client, a, entry, "Screened")).status_code == 200
    b = await client.get(
        f"/v1/workflow/submission/board?f.requirement={w['requirement']}", headers=a.h()
    )
    assert b.status_code == 200, b.text
    cols = {c["stage"]: c for c in b.json()["columns"]}
    assert cols["Screened"]["count"] == 1 and cols["Sourced"]["count"] == 0
    assert cols["Screened"]["cards"][0]["id"] == entry["id"]
    assert "Submitted" in cols["Screened"]["next"]
    h = await client.get(f"/v1/workflow/submission/{entry['id']}/stages", headers=a.h())
    assert [(x["from"], x["to"]) for x in h.json()][-1] == ("Sourced", "Screened")
    none = await client.get("/v1/workflow/candidate/board", headers=a.h())
    assert none.status_code == 404


async def _offer_ready(
    client: httpx.AsyncClient, a: Agency, extra_client: dict[str, Any] | None = None
) -> tuple[dict[str, str], dict[str, Any]]:
    """A world whose entry stands at Offer, with consent and a passed interview."""
    w = await _world(client, a)
    if extra_client:
        c = (await client.get(f"/v1/records/client/{w['client']}", headers=a.h())).json()
        r = await client.patch(
            f"/v1/records/client/{w['client']}",
            headers=a.h(),
            json={"version": c["version"], "data": extra_client},
        )
        assert r.status_code == 200, r.text
    await _make(
        client,
        a,
        "consent_record",
        {"candidate": w["candidate"], "purpose": "Share with clients", "status": "Given"},
    )
    entry = await _entry(client, a, w)
    for stage in ("Screened", "Submitted", "Client shortlisted", "Interview"):
        assert (await _move(client, a, entry, stage)).status_code == 200, stage
    await _make(
        client,
        a,
        "interview",
        {"summary": "Round 1", "submission": entry["id"], "status": "Done", "outcome": "Pass"},
    )
    assert (await _move(client, a, entry, "Offer")).status_code == 200
    return w, entry


async def test_offer_above_budget_waits_for_approval_and_within_budget_passes(
    client: httpx.AsyncClient,
) -> None:
    a = Agency(client, "Budget Co", f"w-{uuid.uuid4().hex[:8]}@budget.test")
    await a.sign_up("recruitment")
    w, entry = await _offer_ready(client, a)
    req = (await client.get(f"/v1/records/requirement/{w['requirement']}", headers=a.h())).json()
    await client.patch(
        f"/v1/records/requirement/{w['requirement']}",
        headers=a.h(),
        json={"version": req["version"], "data": {"budget_max": 3_000_000}},
    )
    over = await client.post(
        "/v1/records/offer",
        headers=a.h(),
        json={"data": {"summary": "Offer", "submission": entry["id"], "annual_ctc": 3_500_000}},
    )
    assert over.status_code == 409 and over.json()["type"].endswith("approval-required")
    assert over.json()["approval"]["checks"][0]["check"] == "R-07.budget"
    ok = await client.post(
        "/v1/records/offer",
        headers=a.h(),
        json={"data": {"summary": "Offer", "submission": entry["id"], "annual_ctc": 2_800_000}},
    )
    assert ok.status_code == 201


async def test_placement_fills_the_requirement_and_closes_it(client: httpx.AsyncClient) -> None:
    a = Agency(client, "Fill Co", f"w-{uuid.uuid4().hex[:8]}@fill.test")
    await a.sign_up("recruitment")
    w, entry = await _offer_ready(client, a, {"min_fee": 300_000})
    no_offer = await client.post(
        "/v1/records/placement",
        headers=a.h(),
        json={
            "data": {
                "summary": "Arjun at Aurora",
                "candidate": w["candidate"],
                "client": w["client"],
                "requirement": w["requirement"],
                "submission": entry["id"],
                "fee": 360_000,
            }
        },
    )
    assert no_offer.status_code == 409 and no_offer.json()["rule"]["check"] == "R-14.offer"
    offer = await _make(
        client, a, "offer", {"summary": "Offer", "submission": entry["id"], "status": "Accepted"}
    )
    assert offer
    low = await client.post(
        "/v1/records/placement",
        headers=a.h(),
        json={
            "data": {
                "summary": "Arjun at Aurora",
                "candidate": w["candidate"],
                "client": w["client"],
                "requirement": w["requirement"],
                "submission": entry["id"],
                "fee": 200_000,
            }
        },
    )
    assert low.status_code == 409 and low.json()["type"].endswith("approval-required")
    assert low.json()["approval"]["checks"][0]["check"] == "R-10.fee"
    placed = await client.post(
        "/v1/records/placement",
        headers=a.h(),
        json={
            "data": {
                "summary": "Arjun at Aurora",
                "candidate": w["candidate"],
                "client": w["client"],
                "requirement": w["requirement"],
                "submission": entry["id"],
                "fee": 360_000,
                "status": "Joined",
            }
        },
    )
    assert placed.status_code == 201, placed.text
    req = (await client.get(f"/v1/records/requirement/{w['requirement']}", headers=a.h())).json()
    assert req["data"]["filled"] == 1 and req["data"]["status"] == "Filled"
    sub = (await client.get(f"/v1/records/submission/{entry['id']}", headers=a.h())).json()
    assert sub["data"]["stage"] == "Placed"
    hist = (
        await client.get(f"/v1/records/requirement/{w['requirement']}/history", headers=a.h())
    ).json()
    assert any(h["action"].startswith("effect:") for h in hist)


async def test_declined_offer_sends_the_candidate_back_to_interview(
    client: httpx.AsyncClient,
) -> None:
    a = Agency(client, "Decl Co", f"w-{uuid.uuid4().hex[:8]}@decl.test")
    await a.sign_up("recruitment")
    _, entry = await _offer_ready(client, a)
    offer_id = await _make(
        client, a, "offer", {"summary": "Offer", "submission": entry["id"], "status": "Sent"}
    )
    o = (await client.get(f"/v1/records/offer/{offer_id}", headers=a.h())).json()
    r = await client.patch(
        f"/v1/records/offer/{offer_id}",
        headers=a.h(),
        json={
            "version": o["version"],
            "data": {"status": "Declined", "decline_reason": "Counter-offer"},
        },
    )
    assert r.status_code == 200, r.text
    sub = (await client.get(f"/v1/records/submission/{entry['id']}", headers=a.h())).json()
    assert sub["data"]["stage"] == "Interview"


async def test_a_policy_changed_in_the_studio_changes_what_happens_once_live(
    client: httpx.AsyncClient,
) -> None:
    a = Agency(client, "Policy Co", f"w-{uuid.uuid4().hex[:8]}@pol.test")
    await a.sign_up("recruitment")
    cand = await _make(
        client,
        a,
        "candidate",
        {
            "full_name": "Late Joiner",
            "email": f"l.{uuid.uuid4().hex[:6]}@gmail.com",
            "phone": f"+91 97{uuid.uuid4().int % 10**8:08d}",
            "notice_period_days": 90,
        },
    )
    client_id = await _make(client, a, "client", {"name": "Zen", "status": "Active"})
    req = await _make(
        client,
        a,
        "requirement",
        {"title": "Fast hire", "client": client_id, "status": "Open", "max_notice_days": 30},
    )
    body = {"data": {"summary": "x", "candidate": cand, "requirement": req}}

    async def severity(value: str) -> None:
        r = await client.put(
            "/v1/studio/rules/R-04/checks/R-04.notice", headers=a.h(), json={"severity": value}
        )
        assert r.status_code == 200, r.text
        await a.publish_live()

    await severity("block")
    blocked = await client.post("/v1/records/submission", headers=a.h(), json=body)
    assert blocked.status_code == 409 and blocked.json()["rule"]["check"] == "R-04.notice"

    await severity("warn")
    warned = await client.post("/v1/records/submission", headers=a.h(), json=body)
    assert warned.status_code == 201
    assert [x["check"] for x in warned.json()["warnings"]] == ["R-04.notice"]
