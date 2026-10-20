"""Row scopes, hidden fields and reference checks, enforced on the server."""

import uuid

import httpx
from sqlalchemy import text

from tableui.platform.db import Database
from tableui.platform.mail import InMemoryMailer
from tests.conftest import PASSWORD, Agency, candidate


async def _member(
    client: httpx.AsyncClient, boss: Agency, mailer: InMemoryMailer, role: str
) -> Agency:
    email = f"m-{uuid.uuid4().hex[:8]}@access.test"
    r = await client.post("/v1/invitations", headers=boss.h(), json={"email": email, "role": role})
    assert r.status_code == 201, r.text
    token = mailer.sent[-1]["body"].split("token=")[1].split()[0]
    r = await client.post(
        f"/v1/invitations/{token}/accept", json={"full_name": "Member", "password": PASSWORD}
    )
    m = Agency(client, boss.name, email)
    m.token, m.tenant_id = r.json()["token"], r.json()["tenant_id"]
    await m.enrol_mfa(m.token)
    return m


async def _setup(db: Database, tenant_id: str, sql: str) -> None:
    async with db.control() as s:
        await s.execute(text(sql), {"t": uuid.UUID(tenant_id)})


async def test_own_scope_hides_other_peoples_records(
    client: httpx.AsyncClient, db: Database, mailer: InMemoryMailer
) -> None:
    boss = Agency(client, "Scope Co", f"s-{uuid.uuid4().hex[:8]}@scope.test")
    await boss.sign_up("recruitment")
    await _setup(
        db,
        boss.tenant_id,
        "INSERT INTO control.tenant_role_scope (tenant_id, role_key, table_key, scope) "
        "VALUES (:t, 'recruiter', 'candidate', 'own') "
        "ON CONFLICT (tenant_id, role_key, table_key) DO UPDATE SET scope = 'own'",
    )
    rec = await _member(client, boss, mailer, "recruiter")
    mine = await rec.create_candidate(candidate(full_name="Mine One", status="Active"))
    theirs = await boss.create_candidate(
        candidate(full_name="Theirs Two", status="Active", phone="+91 90000 22222")
    )
    names = {
        i["data"]["full_name"]
        for i in (await client.get("/v1/records/candidate", headers=rec.h())).json()["items"]
    }
    assert names == {"Mine One"}
    other = await client.get(f"/v1/records/candidate/{theirs.json()['id']}", headers=rec.h())
    assert other.status_code == 404
    upd = await client.patch(
        f"/v1/records/candidate/{theirs.json()['id']}",
        headers=rec.h(),
        json={"data": {"status": "Placed"}, "version": 1},
    )
    assert upd.status_code == 404
    assert (
        await client.get(f"/v1/records/candidate/{mine.json()['id']}", headers=rec.h())
    ).status_code == 200
    # Admin still sees both.
    all_names = {
        i["data"]["full_name"]
        for i in (await client.get("/v1/records/candidate", headers=boss.h())).json()["items"]
    }
    assert all_names == {"Mine One", "Theirs Two"}


async def test_denied_field_is_hidden_and_unwritable(
    client: httpx.AsyncClient, db: Database, mailer: InMemoryMailer
) -> None:
    boss = Agency(client, "Deny Co", f"d-{uuid.uuid4().hex[:8]}@deny.test")
    await boss.sign_up("recruitment")
    await _setup(
        db,
        boss.tenant_id,
        "INSERT INTO control.tenant_field_deny (tenant_id, role_key, table_key, field_key) "
        "VALUES (:t, 'recruiter', 'candidate', 'phone') ON CONFLICT DO NOTHING",
    )
    await _setup(
        db,
        boss.tenant_id,
        "UPDATE control.tenant_role_scope SET scope = 'all' WHERE tenant_id = :t AND role_key = 'recruiter'",
    )
    rec = await _member(client, boss, mailer, "recruiter")
    made = await boss.create_candidate(
        candidate(full_name="Has Phone", status="Active", phone="+91 98450 12345")
    )
    got = (await client.get(f"/v1/records/candidate/{made.json()['id']}", headers=rec.h())).json()
    assert "phone" not in got["data"] and "full_name" in got["data"]
    hist = (
        await client.get(f"/v1/records/candidate/{made.json()['id']}/history", headers=rec.h())
    ).json()
    assert all("phone" not in (h["after"] or {}) for h in hist)
    bad = await rec.create_candidate(
        candidate(full_name="Writes Phone", status="Active", phone="+91 99999 11111")
    )
    assert bad.status_code == 422 and bad.json()["errors"][0]["code"] == "not_allowed"


async def test_reference_must_point_at_an_existing_record(client: httpx.AsyncClient) -> None:
    a = Agency(client, "Ref Co", f"r-{uuid.uuid4().hex[:8]}@ref.test")
    await a.sign_up("field_services")
    r = await client.post(
        "/v1/records/job",
        headers=a.h(),
        json={"data": {"title": "Fix", "customer": str(uuid.uuid4()), "status": "Booked"}},
    )
    assert r.status_code == 422 and r.json()["errors"][0]["code"] == "unknown_reference"
