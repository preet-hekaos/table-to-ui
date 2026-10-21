# ruff: noqa: S608
"""M6: the service owner's console. Create, suspend, limit, export and delete client workspaces."""

import io
import json
import uuid
import zipfile
from typing import Any

import httpx
from sqlalchemy import text

from tableui.platform.db import Database
from tableui.platform.mail import InMemoryMailer
from tests.conftest import PASSWORD, Agency
from tests.conftest import candidate as _candidate
from tests.test_access import _member
from tests.test_catalog import _operator
from tools.cv_corpus import corpus

SAMPLE = corpus(2)[0]


def candidate(**over: Any) -> dict[str, Any]:
    n = uuid.uuid4().int % 90_000_000
    return _candidate(phone=f"+91 9{n:08d}", **over)


async def _client_workspace(
    client: httpx.AsyncClient,
    ops: dict[str, str],
    pack: str | None = "recruitment",
    name: str | None = None,
) -> tuple[Agency, dict[str, Any]]:
    email = f"owner-{uuid.uuid4().hex[:8]}@client.test"
    r = await client.post(
        "/v1/ops/workspaces",
        headers=ops,
        json={
            "name": name or f"Client {uuid.uuid4().hex[:6]}",
            "owner_email": email,
            "pack_id": pack,
        },
    )
    assert r.status_code == 201, r.text
    made = r.json()
    token = made["invite_link"].split("token=")[1]
    r = await client.post(f"/v1/invitations/{token}/accept", json={"full_name": "Client Owner", "password": PASSWORD})  # fmt: skip
    assert r.status_code == 201, r.text
    owner = Agency(client, made["name"], email)
    owner.token, owner.tenant_id = r.json()["token"], r.json()["tenant_id"]
    await owner.enrol_mfa(owner.token)
    return owner, made


async def test_operator_creates_a_client_workspace_and_the_owner_gets_full_access(
    client: httpx.AsyncClient, db: Database, mailer: InMemoryMailer
) -> None:
    ops = await _operator(client, db)
    owner, made = await _client_workspace(client, ops)
    assert any(m["to"] == owner.email and "workspace" in m["subject"] for m in mailer.sent)
    me = (await client.get("/v1/me", headers=owner.h())).json()
    assert "*" in me["permissions"] and me["tenant_name"] == made["name"]
    r = await owner.create_candidate(candidate(full_name="Marker Person"))
    assert r.status_code == 201, r.text  # the pack was installed and published for them
    rows = (await client.get("/v1/ops/workspaces", headers=ops)).json()
    mine = next(w for w in rows if w["id"] == made["id"])
    assert mine["status"] == "active" and mine["records"] == 1 and mine["people"] == 1
    assert mine["owner_email"] == owner.email and mine["pack"] == "recruitment"
    assert "Marker Person" not in json.dumps(rows)  # counts only, never contents


async def test_a_blank_workspace_and_an_unknown_pack(
    client: httpx.AsyncClient, db: Database
) -> None:
    ops = await _operator(client, db)
    owner, _ = await _client_workspace(client, ops, pack=None)
    assert (await client.get("/v1/workspace/onboarding", headers=owner.h())).status_code == 200
    r = await client.post("/v1/ops/workspaces", headers=ops, json={"name": "X", "owner_email": "a@b.test", "pack_id": "nope"})  # fmt: skip
    assert r.status_code >= 400
    dup = await client.post(
        "/v1/ops/workspaces", headers=ops, json={"name": "Dup", "owner_email": owner.email}
    )
    assert dup.status_code == 422


async def test_only_operators_reach_the_console(client: httpx.AsyncClient, agency: Agency) -> None:
    for method, path in (("GET", "/v1/ops/workspaces"), ("POST", f"/v1/ops/workspaces/{agency.tenant_id}/suspend"), ("POST", "/v1/ops/maintenance/purge-due")):  # fmt: skip
        r = await client.request(method, path, headers=agency.h(), json={})
        assert r.status_code in (401, 403), (path, r.status_code)
        assert (await client.request(method, path, json={})).status_code in (401, 403)


async def test_suspend_stops_everyone_at_once_and_resume_brings_them_back(
    client: httpx.AsyncClient, db: Database, mailer: InMemoryMailer
) -> None:
    ops = await _operator(client, db)
    owner, made = await _client_workspace(client, ops)
    teammate = await _member(client, owner, mailer, "recruiter")
    bystander, _ = await _client_workspace(client, ops)
    assert (await client.get("/v1/me", headers=teammate.h())).status_code == 200
    r = await client.post(f"/v1/ops/workspaces/{made['id']}/suspend", headers=ops, json={})
    assert r.status_code == 422  # a reason is required
    r = await client.post(f"/v1/ops/workspaces/{made['id']}/suspend", headers=ops, json={"reason": "unpaid invoice"})  # fmt: skip
    assert r.status_code == 200
    for who in (owner, teammate):
        r = await client.get("/v1/me", headers=who.h())
        assert r.status_code == 403 and r.json()["type"].endswith("workspace-suspended")
    r = await client.post("/v1/auth/sign-in", json={"email": owner.email, "password": PASSWORD})
    assert r.status_code == 403 and "not available" in r.json()["detail"]
    assert (await client.get("/v1/me", headers=bystander.h())).status_code == 200
    r = await client.post(f"/v1/ops/workspaces/{made['id']}/resume", headers=ops)
    assert r.status_code == 200
    assert (await client.get("/v1/me", headers=owner.h())).status_code == 200
    async with db.control() as s:
        actions = [x.action for x in await s.execute(text("SELECT action FROM control.audit_event WHERE tenant_id = :t AND scope = 'platform'"), {"t": uuid.UUID(made["id"])})]  # fmt: skip
    assert {"operator.workspace.suspend", "operator.workspace.resume"} <= set(actions)


async def _table_rows(db: Database, tenant_id: str) -> dict[str, int]:
    """Every control table that has a tenant_id column, with how many rows still belong to the workspace."""
    out: dict[str, int] = {}
    async with db.control() as s:
        tables = [r.table_name for r in await s.execute(text("SELECT table_name FROM information_schema.columns WHERE table_schema = 'control' AND column_name = 'tenant_id'"))]  # fmt: skip
        for t in tables:
            q = "id" if t == "tenant" else "tenant_id"
            n = (
                await s.execute(
                    text(f"SELECT count(*) FROM control.{t} WHERE {q} = :t"),
                    {"t": uuid.UUID(tenant_id)},
                )
            ).scalar_one()  # noqa: S608
            out[t] = n
    return out


async def test_deleting_a_workspace_is_two_steps_and_leaves_nothing_behind(
    client: httpx.AsyncClient, db: Database, analytics: Database
) -> None:
    ops = await _operator(client, db)
    owner, made = await _client_workspace(client, ops)
    keep, kept = await _client_workspace(client, ops)
    assert (await owner.create_candidate(candidate())).status_code == 201
    assert (await keep.create_candidate(candidate())).status_code == 201
    up = await client.post("/v1/files", headers=owner.h(), data={"kind": "cv"}, files={"file": (SAMPLE.name, SAMPLE.data)})  # fmt: skip
    del_url = f"/v1/ops/workspaces/{made['id']}/delete"
    body = {"confirm_name": made["name"], "reason": "client left", "grace_days": 0}
    r = await client.post(del_url, headers=ops, json=body)
    assert r.status_code == 422 and "Suspend" in r.json()["detail"]  # second, separate step
    await client.post(
        f"/v1/ops/workspaces/{made['id']}/suspend", headers=ops, json={"reason": "leaving"}
    )
    r = await client.post(del_url, headers=ops, json={**body, "confirm_name": "wrong"})
    assert r.status_code == 422
    r = await client.post(del_url, headers=ops, json=body)
    assert r.status_code == 200 and r.json()["status"] == "scheduled_deletion"
    r = await client.post(f"/v1/ops/workspaces/{made['id']}/cancel-deletion", headers=ops)  # grace: can be cancelled  # fmt: skip
    assert r.status_code == 200 and r.json()["status"] == "suspended"
    await client.post(del_url, headers=ops, json=body)
    async with analytics.control() as s:
        before = (await s.execute(text("SELECT count(*) FROM fact_record WHERE tenant_id = :t"), {"t": uuid.UUID(made["id"])})).scalar_one()  # fmt: skip
    assert before >= 0
    r = await client.post("/v1/ops/maintenance/purge-due", headers=ops)
    assert made["id"] in r.json()["purged"] and kept["id"] not in r.json()["purged"]
    left = await _table_rows(db, made["id"])
    assert all(n == 0 for n in left.values()), {k: n for k, n in left.items() if n}
    async with db.control() as s:
        schema = (await s.execute(text("SELECT count(*) FROM information_schema.schemata WHERE schema_name = :s"), {"s": f"t_{made['id'].replace('-', '')}"})).scalar_one()  # fmt: skip
        users = (await s.execute(text("SELECT count(*) FROM control.app_user WHERE email = :e"), {"e": owner.email})).scalar_one()  # fmt: skip
        line = (await s.execute(text("SELECT detail FROM control.audit_event WHERE action = 'operator.workspace.purge' AND subject_id = :i"), {"i": made["id"]})).scalar_one()  # fmt: skip
    assert schema == 0 and users == 0 and line["name"] == made["name"]
    async with analytics.control() as s:
        gone = (await s.execute(text("SELECT count(*) FROM fact_record WHERE tenant_id = :t"), {"t": uuid.UUID(made["id"])})).scalar_one()  # fmt: skip
    assert gone == 0
    assert (await client.get("/v1/me", headers=owner.h())).status_code == 401
    assert (
        await client.get("/v1/me", headers=keep.h())
    ).status_code == 200  # the other client is untouched
    assert len((await client.get("/v1/records/candidate", headers=keep.h())).json()["items"]) == 1
    assert up.status_code == 201, up.text


async def test_export_goes_to_the_owner_and_holds_records_definition_and_files(
    client: httpx.AsyncClient, db: Database, mailer: InMemoryMailer
) -> None:
    ops = await _operator(client, db)
    owner, made = await _client_workspace(client, ops)
    assert (await owner.create_candidate(candidate(full_name="Priya Nair"))).status_code == 201
    up = await client.post("/v1/files", headers=owner.h(), data={"kind": "cv"}, files={"file": (SAMPLE.name, SAMPLE.data)})  # fmt: skip
    assert up.status_code == 201, up.text
    r = await client.post(f"/v1/ops/workspaces/{made['id']}/export", headers=ops, json={})
    assert r.status_code == 422
    r = await client.post(f"/v1/ops/workspaces/{made['id']}/export", headers=ops, json={"reason": "client asked"})  # fmt: skip
    assert r.status_code == 200, r.text
    got = r.json()
    assert got["sent_to"] == owner.email
    assert any(m["to"] == owner.email and "export" in m["subject"] for m in mailer.sent)
    token = got["download_link"].split("/exports/")[1]
    z = await client.get(f"/v1/ops/exports/{token}")  # no sign-in: the link is the credential
    assert z.status_code == 200 and z.headers["content-type"] == "application/zip"
    zf = zipfile.ZipFile(io.BytesIO(z.content))
    names = zf.namelist()
    assert "app-definition.json" in names and "tables/candidate.csv" in names
    assert any(n.startswith("files/") and n.endswith(SAMPLE.name) for n in names)
    assert "Priya Nair" in zf.read("tables/candidate.csv").decode()
    assert any(d["kind"] == "table" and d["key"] == "candidate" for d in json.loads(zf.read("app-definition.json")))  # fmt: skip
    assert (await client.get("/v1/ops/exports/not-a-real-token")).status_code == 404
    async with db.control() as s:
        await s.execute(text("UPDATE control.export_job SET expires_at = now() - interval '1 minute' WHERE tenant_id = :t"), {"t": uuid.UUID(made["id"])})  # fmt: skip
    assert (await client.get(f"/v1/ops/exports/{token}")).status_code == 404  # expired


async def test_limits_block_only_the_new_thing(
    client: httpx.AsyncClient, db: Database, mailer: InMemoryMailer
) -> None:
    ops = await _operator(client, db)
    owner, made = await _client_workspace(client, ops)
    r = await client.put(f"/v1/ops/workspaces/{made['id']}/limits", headers=ops, json={"max_records": 2, "max_people": 2})  # fmt: skip
    assert r.status_code == 200, r.text
    first = await owner.create_candidate(candidate())
    assert first.status_code == 201
    assert (await owner.create_candidate(candidate())).status_code == 201
    third = await owner.create_candidate(candidate())
    assert third.status_code == 409 and third.json()["type"].endswith("limit-reached")
    assert "2 records" in third.json()["detail"]
    upd = await client.patch(f"/v1/records/candidate/{first.json()['id']}", headers=owner.h(), json={"data": {"current_title": "Lead"}, "version": first.json()["version"]})  # fmt: skip
    assert upd.status_code == 200, upd.text  # changing existing records still works
    assert (await client.get("/v1/records/candidate", headers=owner.h())).status_code == 200
    await _member(client, owner, mailer, "recruiter")  # the second person fits
    over = await client.post("/v1/invitations", headers=owner.h(), json={"email": f"x-{uuid.uuid4().hex[:6]}@client.test", "role": "recruiter"})  # fmt: skip
    assert over.status_code == 409 and "people" in over.json()["detail"]
    r = await client.put(
        f"/v1/ops/workspaces/{made['id']}/limits", headers=ops, json={"max_storage_mb": 0}
    )
    assert r.status_code == 200
    full = await client.post("/v1/files", headers=owner.h(), data={"kind": "cv"}, files={"file": (SAMPLE.name, SAMPLE.data)})  # fmt: skip
    assert full.status_code == 409 and "MB of files" in full.json()["detail"]
    r = await client.put(f"/v1/ops/workspaces/{made['id']}/limits", headers=ops, json={"max_storage_mb": None, "max_records": None})  # fmt: skip
    assert r.status_code == 200
    assert (await owner.create_candidate(candidate())).status_code == 201  # raised: works again
    bad = await client.put(
        f"/v1/ops/workspaces/{made['id']}/limits", headers=ops, json={"max_records": -1}
    )
    assert bad.status_code == 422
    rows = (await client.get("/v1/ops/workspaces", headers=ops)).json()
    assert next(w for w in rows if w["id"] == made["id"])["limits"]["max_people"] == 2


async def test_an_owner_can_remove_a_person_but_never_the_last_owner(
    client: httpx.AsyncClient, db: Database, mailer: InMemoryMailer
) -> None:
    ops = await _operator(client, db)
    owner, _ = await _client_workspace(client, ops)
    member = await _member(client, owner, mailer, "recruiter")
    made = await member.create_candidate(candidate(full_name="Added By Member"))
    assert made.status_code == 201
    people = (await client.get("/v1/workspace/people", headers=owner.h())).json()
    mine = next(p for p in people if p["email"] == owner.email)["id"]
    theirs = next(p for p in people if p["email"] == member.email)["id"]
    assert (
        await client.delete(f"/v1/workspace/people/{mine}", headers=owner.h())
    ).status_code == 422
    assert (
        await client.delete(f"/v1/workspace/people/{theirs}", headers=owner.h())
    ).status_code == 204
    assert (await client.get("/v1/me", headers=member.h())).status_code == 401  # sessions end
    r = await client.post("/v1/auth/sign-in", json={"email": member.email, "password": PASSWORD})
    assert r.status_code == 401
    now = (await client.get("/v1/workspace/people", headers=owner.h())).json()
    assert [p["email"] for p in now] == [owner.email]
    rec = await client.get(f"/v1/records/candidate/{made.json()['id']}", headers=owner.h())
    assert (
        rec.status_code == 200 and rec.json()["data"]["full_name"] == "Added By Member"
    )  # history stays
    again = await client.post("/v1/invitations", headers=owner.h(), json={"email": member.email, "role": "recruiter"})  # fmt: skip
    assert again.status_code == 201  # the email is free again
