"""M2 duplicates: suspected pairs, compare, merge with relinking, undo, permission (R-13)."""

import uuid

import httpx
from sqlalchemy import text

from tableui.platform.db import Database
from tableui.platform.mail import InMemoryMailer
from tests.conftest import Agency
from tests.test_access import _member
from tests.test_workflow import _make


async def _person(
    client: httpx.AsyncClient, a: Agency, name: str, employer: str, **extra: object
) -> str:
    return await _make(
        client,
        a,
        "candidate",
        {
            "full_name": name,
            "email": f"{uuid.uuid4().hex[:8]}@gmail.com",
            "phone": f"+91 9{uuid.uuid4().int % 10**9:09d}",
            "current_employer": employer,
            **extra,
        },
    )


async def test_pairs_compare_merge_relink_and_undo(
    client: httpx.AsyncClient, mailer: InMemoryMailer, db: Database
) -> None:
    boss = Agency(client, "Dup Co", f"d-{uuid.uuid4().hex[:8]}@dups.test")
    await boss.sign_up("recruitment")
    a = await _person(client, boss, "Priya Nair", "Infosys", current_title="Engineer")
    b = await _person(client, boss, "Priya  Nair.", "Infosys", total_experience=60)
    await _person(client, boss, "Rahul Verma", "Infosys")
    pairs = (await client.get("/v1/duplicates/candidate", headers=boss.h())).json()["items"]
    assert len(pairs) == 1 and {pairs[0]["a"]["id"], pairs[0]["b"]["id"]} == {a, b}

    cmp_ = (
        await client.get(f"/v1/duplicates/candidate/compare?a={a}&b={b}", headers=boss.h())
    ).json()
    keys = {f["key"]: f for f in cmp_["fields"]}
    assert keys["email"]["same"] is False and keys["current_employer"]["same"] is True

    # Something points at the record that will be archived.
    client_id = await _make(client, boss, "client", {"name": "Zen", "status": "Active"})
    req = await _make(
        client, boss, "requirement", {"title": "Dev", "client": client_id, "status": "Open"}
    )
    sub = await _make(
        client,
        boss,
        "submission",
        {"summary": "Priya for Dev", "candidate": b, "requirement": req},
    )

    rec = await _member(client, boss, mailer, "recruiter")
    denied = await client.post(
        "/v1/duplicates/candidate/merge", headers=rec.h(), json={"keep": a, "drop": b}
    )
    assert denied.status_code == 403  # R-13

    merged = await client.post(
        "/v1/duplicates/candidate/merge", headers=boss.h(), json={"keep": a, "drop": b}
    )
    assert merged.status_code == 201, merged.text
    assert merged.json()["relinked"] == 1
    assert (await client.get(f"/v1/records/candidate/{b}", headers=boss.h())).status_code == 404
    kept = (await client.get(f"/v1/records/candidate/{a}", headers=boss.h())).json()
    assert kept["data"]["total_experience"] == 60 and kept["data"]["current_title"] == "Engineer"
    s = (await client.get(f"/v1/records/submission/{sub}", headers=boss.h())).json()
    assert s["data"]["candidate"] == a
    assert (await client.get("/v1/duplicates/candidate", headers=boss.h())).json()["items"] == []

    mid = merged.json()["id"]
    listed = (await client.get("/v1/duplicates/candidate/merges", headers=boss.h())).json()
    assert listed[0]["can_undo"] is True
    undone = await client.post(f"/v1/duplicates/candidate/merges/{mid}/undo", headers=boss.h())
    assert undone.status_code == 200, undone.text
    assert (await client.get(f"/v1/records/candidate/{b}", headers=boss.h())).status_code == 200
    s = (await client.get(f"/v1/records/submission/{sub}", headers=boss.h())).json()
    assert s["data"]["candidate"] == b
    again = await client.post(f"/v1/duplicates/candidate/merges/{mid}/undo", headers=boss.h())
    assert again.status_code == 422

    # After seven days it can no longer be undone.
    m2 = await client.post(
        "/v1/duplicates/candidate/merge", headers=boss.h(), json={"keep": a, "drop": b}
    )
    async with db.control() as c:
        await c.execute(
            text(
                "UPDATE control.record_merge SET merged_at = now() - interval '8 days' WHERE id = :i"
            ),
            {"i": uuid.UUID(m2.json()["id"])},
        )
    late = await client.post(
        f"/v1/duplicates/candidate/merges/{m2.json()['id']}/undo", headers=boss.h()
    )
    assert late.status_code == 422


async def test_not_a_duplicate_hides_the_pair(client: httpx.AsyncClient) -> None:
    boss = Agency(client, "Hide Co", f"d-{uuid.uuid4().hex[:8]}@hide.test")
    await boss.sign_up("recruitment")
    a = await _person(client, boss, "Amit Kumar Shah", "TCS")
    b = await _person(client, boss, "Amit Kumar Shaah", "TCS")
    assert (
        len((await client.get("/v1/duplicates/candidate", headers=boss.h())).json()["items"]) == 1
    )
    r = await client.post(
        "/v1/duplicates/candidate/dismiss", headers=boss.h(), json={"a": b, "b": a}
    )
    assert r.status_code == 204
    assert (await client.get("/v1/duplicates/candidate", headers=boss.h())).json()["items"] == []
