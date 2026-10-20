"""People, teams, roles grid, branding, regional settings (M1-S02..S07)."""

import uuid

import httpx

from tests.conftest import PASSWORD, Agency
from tableui.platform.mail import InMemoryMailer


async def _team_mate(
    client: httpx.AsyncClient, boss: Agency, mailer: InMemoryMailer, role: str
) -> tuple[Agency, str]:
    email = f"w-{uuid.uuid4().hex[:8]}@admin.test"
    r = await client.post("/v1/invitations", headers=boss.h(), json={"email": email, "role": role})
    assert r.status_code == 201, r.text
    token = mailer.sent[-1]["body"].split("token=")[1].split()[0]
    r = await client.post(
        f"/v1/invitations/{token}/accept", json={"full_name": "Mate", "password": PASSWORD}
    )
    m = Agency(client, boss.name, email)
    m.token, m.tenant_id = r.json()["token"], r.json()["tenant_id"]
    await m.enrol_mfa(m.token)
    people = (await client.get("/v1/workspace/people", headers=boss.h())).json()
    return m, next(p["id"] for p in people if p["email"] == email)


async def _boss(client: httpx.AsyncClient) -> Agency:
    a = Agency(client, "Admin Co", f"b-{uuid.uuid4().hex[:8]}@admin.test")
    await a.sign_up("recruitment")
    return a


async def test_home_shows_checklist_and_marks_roles_done(client: httpx.AsyncClient) -> None:
    a = await _boss(client)
    home = (await client.get("/v1/workspace/home", headers=a.h())).json()
    assert home["pack_id"] == "recruitment" and home["release_version"] == 1
    assert [c["done"] for c in home["checklist"]] == [False, False, False, False]
    r = await client.post(
        "/v1/workspace/roles",
        headers=a.h(),
        json={"key": "intern", "name": "Intern", "grants": ["record.candidate.read"]},
    )
    assert r.status_code == 201
    home = (await client.get("/v1/workspace/home", headers=a.h())).json()
    assert next(c for c in home["checklist"] if c["key"] == "roles")["done"] is True


async def test_deactivated_user_loses_access_at_once_and_last_admin_is_protected(
    client: httpx.AsyncClient, mailer: InMemoryMailer
) -> None:
    a = await _boss(client)
    mate, mate_id = await _team_mate(client, a, mailer, "recruiter")
    assert (await client.get("/v1/me", headers=mate.h())).status_code == 200
    r = await client.post(f"/v1/workspace/people/{mate_id}/deactivate", headers=a.h())
    assert r.status_code == 204
    assert (await client.get("/v1/me", headers=mate.h())).status_code == 401
    me = (await client.get("/v1/me", headers=a.h())).json()
    last = await client.post(f"/v1/workspace/people/{me['user_id']}/deactivate", headers=a.h())
    assert last.status_code == 422 and "last administrator" in last.json()["detail"]
    lose = await client.put(
        f"/v1/workspace/people/{me['user_id']}/role", headers=a.h(), json={"role": "viewer"}
    )
    assert lose.status_code == 422


async def test_role_change_applies_to_next_request(
    client: httpx.AsyncClient, mailer: InMemoryMailer
) -> None:
    a = await _boss(client)
    mate, mate_id = await _team_mate(client, a, mailer, "viewer")
    assert (
        await mate.create_candidate({"full_name": "X Y", "email": "x@y.test", "status": "Active"})
    ).status_code == 403
    roles = {r["key"]: r for r in (await client.get("/v1/workspace/roles", headers=a.h())).json()}
    v = roles["viewer"]
    r = await client.put(
        "/v1/workspace/roles/viewer",
        headers=a.h(),
        json={
            "name": v["name"],
            "grants": v["grants"] + ["record.candidate.create"],
            "scopes": v["scopes"],
            "field_deny": v["field_deny"],
        },
    )
    assert r.status_code == 204, r.text
    created = await mate.create_candidate(
        {"full_name": "X Y", "email": "x@y.test", "status": "Active"}
    )
    assert created.status_code == 201, created.text


async def test_teams_and_own_team_scope(client: httpx.AsyncClient, mailer: InMemoryMailer) -> None:
    a = await _boss(client)
    m1, id1 = await _team_mate(client, a, mailer, "recruiter")
    m2, id2 = await _team_mate(client, a, mailer, "recruiter")
    m3, _ = await _team_mate(client, a, mailer, "recruiter")
    team = (await client.post("/v1/workspace/teams", headers=a.h(), json={"name": "Pune"})).json()
    assert (
        await client.put(
            f"/v1/workspace/teams/{team['id']}/members",
            headers=a.h(),
            json={"user_ids": [id1, id2]},
        )
    ).status_code == 204
    c1 = await m1.create_candidate(
        {"full_name": "One", "email": "one@t.test", "status": "Active", "phone": "+91 91111 11111"}
    )
    await m3.create_candidate(
        {
            "full_name": "Three",
            "email": "three@t.test",
            "status": "Active",
            "phone": "+91 93333 33333",
        }
    )
    names = {
        i["data"]["full_name"]
        for i in (await client.get("/v1/records/candidate", headers=m2.h())).json()["items"]
    }
    assert names == {"One"}
    assert (
        await client.get(f"/v1/records/candidate/{c1.json()['id']}", headers=m2.h())
    ).status_code == 200


async def test_branding_rejects_low_contrast_with_a_suggestion(client: httpx.AsyncClient) -> None:
    a = await _boss(client)
    bad = await client.put(
        "/v1/workspace/settings/brand",
        headers=a.h(),
        json={"app_name": "Northstar", "accent": "#ffd400"},
    )
    assert bad.status_code == 422 and bad.json()["suggestion"].startswith("#")
    ok = await client.put(
        "/v1/workspace/settings/brand",
        headers=a.h(),
        json={"app_name": "Northstar", "accent": bad.json()["suggestion"]},
    )
    assert ok.status_code == 200 and ok.json()["app_name"] == "Northstar"
    assert (await client.get("/v1/workspace/settings", headers=a.h())).json()["brand"][
        "accent"
    ] == bad.json()["suggestion"]


async def test_regional_defaults_are_india(client: httpx.AsyncClient) -> None:
    a = await _boss(client)
    s = (await client.get("/v1/workspace/settings", headers=a.h())).json()["regional"]
    assert s["currency"] == "INR" and s["week_start"] == "monday" and s["phone_region"] == "IN"
