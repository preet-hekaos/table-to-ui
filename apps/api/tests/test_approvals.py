"""M2 approvals: a change a rule holds is stored, a different person decides, and approval applies it."""

import uuid
from typing import Any

import httpx

from tableui.platform.mail import InMemoryMailer
from tests.conftest import Agency
from tests.test_access import _member
from tests.test_workflow import _make, _offer_ready


async def _over_budget(
    client: httpx.AsyncClient, a: Agency
) -> tuple[dict[str, str], dict[str, Any]]:
    w, entry = await _offer_ready(client, a)
    req = (await client.get(f"/v1/records/requirement/{w['requirement']}", headers=a.h())).json()
    await client.patch(
        f"/v1/records/requirement/{w['requirement']}",
        headers=a.h(),
        json={"version": req["version"], "data": {"budget_max": 3_000_000}},
    )
    return w, entry


def _offer_body(entry: dict[str, Any], ctc: int) -> dict[str, Any]:
    return {
        "table": "offer",
        "action": "create",
        "data": {"summary": "Offer for Arjun", "submission": entry["id"], "annual_ctc": ctc},
        "note": "Strong profile, client agreed verbally",
    }


async def test_request_decide_and_apply(
    client: httpx.AsyncClient, mailer: InMemoryMailer, db: Any
) -> None:
    boss = Agency(client, "Appr Co", f"a-{uuid.uuid4().hex[:8]}@appr.test")
    await boss.sign_up("recruitment")
    rec = await _member(client, boss, mailer, "recruiter")
    mgr = await _member(client, boss, mailer, "manager")
    _, entry = await _over_budget(client, boss)

    direct = await client.post(
        "/v1/records/offer",
        headers=rec.h(),
        json={"data": _offer_body(entry, 3_500_000)["data"]},
    )
    assert direct.status_code == 409 and direct.json()["type"].endswith("approval-required")

    # A change that needs no approval cannot be held.
    fine = await client.post("/v1/approvals", headers=rec.h(), json=_offer_body(entry, 2_000_000))
    assert fine.status_code == 422

    held = await client.post("/v1/approvals", headers=rec.h(), json=_offer_body(entry, 3_500_000))
    assert held.status_code == 201, held.text
    appr = held.json()
    assert appr["status"] == "pending" and appr["checks"][0]["check"] == "R-07.budget"
    assert (await client.get("/v1/records/offer", headers=boss.h())).json()["items"] == []

    # The requester cannot decide it; the recruiter has no approval permission at all.
    assert (
        await client.post(
            f"/v1/approvals/{appr['id']}/decision", headers=rec.h(), json={"decision": "approve"}
        )
    ).status_code == 403
    inbox = (await client.get("/v1/approvals", headers=mgr.h())).json()
    assert inbox["pending"] == 1 and inbox["items"][0]["id"] == appr["id"]

    done = await client.post(
        f"/v1/approvals/{appr['id']}/decision",
        headers=mgr.h(),
        json={"decision": "approve", "note": "Within what we can recover"},
    )
    assert done.status_code == 200, done.text
    assert done.json()["status"] == "approved" and done.json()["result_record_id"]
    offers = (await client.get("/v1/records/offer", headers=boss.h())).json()["items"]
    assert offers[0]["data"]["annual_ctc"] == 3_500_000
    again = await client.post(
        f"/v1/approvals/{appr['id']}/decision", headers=mgr.h(), json={"decision": "approve"}
    )
    assert again.status_code == 422


async def test_reject_needs_a_reason_and_cancel_is_the_requesters(
    client: httpx.AsyncClient, mailer: InMemoryMailer
) -> None:
    boss = Agency(client, "Rej Co", f"a-{uuid.uuid4().hex[:8]}@rej.test")
    await boss.sign_up("recruitment")
    rec = await _member(client, boss, mailer, "recruiter")
    _, entry = await _over_budget(client, boss)
    a1 = (
        await client.post("/v1/approvals", headers=rec.h(), json=_offer_body(entry, 3_900_000))
    ).json()
    no_reason = await client.post(
        f"/v1/approvals/{a1['id']}/decision", headers=boss.h(), json={"decision": "reject"}
    )
    assert no_reason.status_code == 422
    rej = await client.post(
        f"/v1/approvals/{a1['id']}/decision",
        headers=boss.h(),
        json={"decision": "reject", "note": "Too high"},
    )
    assert rej.json()["status"] == "rejected" and rej.json()["decision_note"] == "Too high"
    assert (await client.get("/v1/records/offer", headers=boss.h())).json()["items"] == []

    a2 = (
        await client.post("/v1/approvals", headers=rec.h(), json=_offer_body(entry, 3_800_000))
    ).json()
    assert (
        await client.post(f"/v1/approvals/{a2['id']}/cancel", headers=boss.h())
    ).status_code == 422
    c = await client.post(f"/v1/approvals/{a2['id']}/cancel", headers=rec.h())
    assert c.json()["status"] == "cancelled"
    mine = (await client.get("/v1/approvals?status=", headers=rec.h())).json()
    assert {x["status"] for x in mine["items"]} == {"rejected", "cancelled"}


async def test_a_stale_update_fails_cleanly_when_approved(
    client: httpx.AsyncClient, mailer: InMemoryMailer
) -> None:
    boss = Agency(client, "Stale Co", f"a-{uuid.uuid4().hex[:8]}@stale.test")
    await boss.sign_up("recruitment")
    rec = await _member(client, boss, mailer, "recruiter")
    _, entry = await _over_budget(client, boss)
    offer_id = await _make(
        client,
        boss,
        "offer",
        {"summary": "Offer", "submission": entry["id"], "annual_ctc": 2_000_000},
    )
    o = (await client.get(f"/v1/records/offer/{offer_id}", headers=boss.h())).json()
    held = await client.post(
        "/v1/approvals",
        headers=rec.h(),
        json={
            "table": "offer",
            "action": "update",
            "record_id": offer_id,
            "version": o["version"],
            "data": {"annual_ctc": 3_600_000},
        },
    )
    assert held.status_code == 201, held.text
    # Someone else edits the offer meanwhile.
    await client.patch(
        f"/v1/records/offer/{offer_id}",
        headers=boss.h(),
        json={"version": o["version"], "data": {"status": "Sent"}},
    )
    r = await client.post(
        f"/v1/approvals/{held.json()['id']}/decision",
        headers=boss.h(),
        json={"decision": "approve"},
    )
    assert r.status_code == 409 and r.json()["type"].endswith("version-conflict")
    got = (await client.get(f"/v1/approvals/{held.json()['id']}", headers=boss.h())).json()
    assert got["status"] == "failed" and "changed" in got["error"]
