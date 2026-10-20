"""M1 slice 1: blank workspaces, pack choice, per-workspace roles."""

import uuid

import httpx

from tableui.identity.public import Principal
from tests.conftest import Agency, candidate


async def _blank(client: httpx.AsyncClient) -> Agency:
    a = Agency(client, "Blank Co", f"b-{uuid.uuid4().hex[:8]}@blank.test")
    await a.sign_up()
    return a


async def test_signup_gives_a_blank_workspace_with_pack_choices(client: httpx.AsyncClient) -> None:
    a = await _blank(client)
    r = await client.get("/v1/workspace/onboarding", headers=a.h())
    body = r.json()
    assert body["step"] == "choose_pack" and body["pack_id"] is None
    assert "recruitment" in {p["id"] for p in body["packs"]}
    # Nothing is live until a starting point is chosen.
    assert (await client.get("/v1/app/tables", headers=a.h())).status_code == 404


async def test_choosing_a_pack_installs_tables_and_roles_once(client: httpx.AsyncClient) -> None:
    a = await _blank(client)
    await a.choose_pack("recruitment")
    tables = (await client.get("/v1/app/tables", headers=a.h())).json()["tables"]
    assert len(tables) == 13
    assert (await a.create_candidate(candidate())).status_code == 201
    again = await client.post("/v1/workspace/pack", headers=a.h(), json={"pack_id": "recruitment"})
    assert again.status_code == 422
    r = await client.post(
        "/v1/invitations",
        headers=a.h(),
        json={"email": f"x-{uuid.uuid4().hex[:6]}@blank.test", "role": "recruiter"},
    )
    assert r.status_code == 201, r.text


async def test_blank_choice_leaves_an_empty_workspace(client: httpx.AsyncClient) -> None:
    a = await _blank(client)
    await a.choose_pack("blank")
    state = (await client.get("/v1/workspace/onboarding", headers=a.h())).json()
    assert state["step"] == "done" and state["pack_id"] == "blank"


def _principal(perms: set[str]) -> Principal:
    return Principal(
        user_id=uuid.uuid4(),
        email="a@b.c",
        full_name="A",
        realm="tenant",
        tenant_id=uuid.uuid4(),
        tenant_name="T",
        role_key="r",
        permissions=frozenset(perms),
        mfa_enabled=True,
        mfa_verified=True,
        session_hash="h",
    )


def test_wildcard_grants() -> None:
    assert _principal({"*"}).allows("record.candidate.update")
    p = _principal({"record.*.read"})
    assert p.allows("record.client.read") and not p.allows("record.client.update")
    assert not _principal({"record.candidate.read"}).allows("record.client.read")


async def test_second_pack_installs_without_recruitment_and_serves_navigation(
    client: httpx.AsyncClient,
) -> None:
    a = await _blank(client)
    await a.choose_pack("field_services")
    nav = (await client.get("/v1/app/navigation", headers=a.h())).json()["items"]
    assert [n["label"] for n in nav] == ["Jobs", "Customers", "Technicians"]
    assert (await client.get("/v1/app/tables/candidate", headers=a.h())).status_code == 404
    c = await client.post(
        "/v1/records/customer", headers=a.h(), json={"data": {"name": "Meera Iyer"}}
    )
    assert c.status_code == 201, c.text
    j = await client.post(
        "/v1/records/job",
        headers=a.h(),
        json={
            "data": {
                "title": "Fix AC",
                "customer": c.json()["id"],
                "status": "Booked",
                "quote": "₹12,500",
            }
        },
    )
    assert j.status_code == 201, j.text
    assert j.json()["data"]["quote"] == 12500.0


async def test_navigation_is_filtered_by_role(client: httpx.AsyncClient) -> None:
    a = await _blank(client)
    await a.choose_pack("recruitment")
    nav = (await client.get("/v1/app/navigation", headers=a.h())).json()["items"]
    assert nav[0]["screen"] == "candidates" and len(nav) == 16
