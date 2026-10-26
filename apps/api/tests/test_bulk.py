"""Bulk actions (N5c): change one field, delete, undo; switches, permissions and scope are enforced."""

import uuid
from typing import Any

import httpx

from tableui.platform.db import Database
from tableui.platform.mail import InMemoryMailer
from tests.conftest import Agency, candidate
from tests.test_access import _member, _setup


async def _make(a: Agency, n: int = 4) -> list[str]:
    ids = []
    for i in range(n):
        r = await a.create_candidate(
            candidate(full_name=f"Person {i}", status="Active", phone=f"+91 98450 2{i}000")
        )
        assert r.status_code == 201, r.text
        ids.append(r.json()["id"])
    return ids


async def _bulk(client: httpx.AsyncClient, a: Agency, **body: Any) -> httpx.Response:
    return await client.post("/v1/records/candidate/bulk", headers=a.h(), json=body)


async def _status(client: httpx.AsyncClient, a: Agency, rid: str) -> str | None:
    r = await client.get(f"/v1/records/candidate/{rid}", headers=a.h())
    return r.json()["data"]["status"] if r.status_code == 200 else None


async def test_change_a_value_on_ticked_rows_then_undo(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    ids = await _make(agency)
    r = await _bulk(client, agency, action="update", ids=ids[:3], field="status", value="Archived")
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["applied"] == 3 and out["failed"] == []
    assert [await _status(client, agency, i) for i in ids] == ["Archived"] * 3 + ["Active"]
    undone = await _bulk(client, agency, action="undo", undo=out["undo"])
    assert undone.status_code == 200, undone.text
    assert undone.json()["applied"] == 3
    assert [await _status(client, agency, i) for i in ids] == ["Active"] * 4


async def test_invalid_value_fails_per_row_and_the_rest_apply(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    ids = await _make(agency, 2)
    r = await _bulk(client, agency, action="update", ids=ids, field="status", value="Nonsense")
    assert r.status_code == 200
    assert r.json()["applied"] == 0 and len(r.json()["failed"]) == 2
    assert r.json()["undo"] is None


async def test_delete_all_matching_keeps_the_id_on_undo(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    ids = await _make(agency)
    await _bulk(client, agency, action="update", ids=ids[:2], field="status", value="Archived")
    matching = {"filters": {"status": "Archived"}, "expected_count": 2}
    stale = await _bulk(client, agency, action="delete", matching={**matching, "expected_count": 5})
    assert stale.status_code == 409
    r = await _bulk(client, agency, action="delete", matching=matching)
    assert r.status_code == 200 and r.json()["applied"] == 2, r.text
    assert await _status(client, agency, ids[0]) is None
    assert await _status(client, agency, ids[3]) == "Active"
    back = await _bulk(client, agency, action="undo", undo=r.json()["undo"])
    assert back.status_code == 200 and back.json()["applied"] == 2, back.text
    assert await _status(client, agency, ids[0]) == "Archived"  # same id, same values


async def test_switches_are_enforced_on_the_server(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    ids = await _make(agency, 2)
    r = await client.put(
        "/v1/studio/tables/candidate/features",
        headers=agency.h(),
        json={"bulk_actions": ["export", "edit"]},
    )
    assert r.status_code == 200, r.text
    await agency.publish_live()
    assert (await _bulk(client, agency, action="delete", ids=ids)).status_code == 403
    ok = await _bulk(client, agency, action="update", ids=ids, field="status", value="Placed")
    assert ok.status_code == 200 and ok.json()["applied"] == 2
    await client.put(
        "/v1/studio/tables/candidate/features", headers=agency.h(), json={"select_bulk": False}
    )
    await agency.publish_live()
    off = await _bulk(client, agency, action="update", ids=ids, field="status", value="Active")
    assert off.status_code == 403


async def test_a_role_without_the_permission_is_refused_and_scope_limits_reach(
    client: httpx.AsyncClient, db: Database, mailer: InMemoryMailer
) -> None:
    boss = Agency(client, "Bulk Co", f"b-{uuid.uuid4().hex[:8]}@bulk.test")
    await boss.sign_up("recruitment")
    await _setup(
        db,
        boss.tenant_id,
        "INSERT INTO control.tenant_role_scope (tenant_id, role_key, table_key, scope) "
        "VALUES (:t, 'recruiter', 'candidate', 'own') "
        "ON CONFLICT (tenant_id, role_key, table_key) DO UPDATE SET scope = 'own'",
    )
    rec = await _member(client, boss, mailer, "recruiter")
    theirs = await _make(boss, 2)
    mine = (
        await rec.create_candidate(
            candidate(full_name="Mine", status="Active", phone="+91 91111 11111")
        )
    ).json()["id"]
    r = await _bulk(
        client, rec, action="update", ids=[*theirs, mine], field="status", value="Placed"
    )
    assert r.status_code == 200, r.text
    assert r.json()["applied"] == 1  # only the row the recruiter may see
    assert await _status(client, boss, theirs[0]) == "Active"
    assert await _status(client, boss, mine) == "Placed"
    # Undo only restores the caller's own change.
    other = await _bulk(client, boss, action="undo", undo={"kind": "update", "ids": [mine]})
    assert other.status_code == 422
