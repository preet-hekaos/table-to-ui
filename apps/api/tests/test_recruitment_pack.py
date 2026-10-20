"""The full recruitment pack: 13 tables, roles, and rule R-11."""

import uuid

import httpx

from tests.conftest import Agency


async def _make(client: httpx.AsyncClient, a: Agency, table: str, data: dict[str, object]) -> str:
    r = await client.post(f"/v1/records/{table}", headers=a.h(), json={"data": data})
    assert r.status_code == 201, r.text
    return str(r.json()["id"])


async def test_pack_installs_thirteen_tables_and_screens(client: httpx.AsyncClient) -> None:
    a = Agency(client, "Pack Co", f"p-{uuid.uuid4().hex[:8]}@pack.test")
    await a.sign_up("recruitment")
    tables = (await client.get("/v1/app/tables", headers=a.h())).json()["tables"]
    assert len(tables) == 13
    nav = (await client.get("/v1/app/navigation", headers=a.h())).json()["items"]
    assert len(nav) == 13 and nav[0]["label"] == "Candidates"


async def test_r11_contact_must_belong_to_the_requirements_client(
    client: httpx.AsyncClient,
) -> None:
    a = Agency(client, "R11 Co", f"r-{uuid.uuid4().hex[:8]}@r11.test")
    await a.sign_up("recruitment")
    aurora = await _make(client, a, "client", {"name": "Aurora Fintech", "status": "Active"})
    zenith = await _make(client, a, "client", {"name": "Zenith Labs", "status": "Active"})
    meera = await _make(client, a, "contact", {"name": "Meera", "client": zenith})
    bad = await client.post(
        "/v1/records/requirement",
        headers=a.h(),
        json={
            "data": {
                "title": "Senior Backend Engineer",
                "client": aurora,
                "contact": meera,
                "status": "Open",
                "skills": ["Java", "Spring"],
                "budget_max": "30 LPA",
                "min_experience": "5 yrs",
            }
        },
    )
    assert bad.status_code == 409 and bad.json()["rule"]["rule"] == "R-11"
    ok = await client.post(
        "/v1/records/requirement",
        headers=a.h(),
        json={
            "data": {
                "title": "Senior Backend Engineer",
                "client": zenith,
                "contact": meera,
                "status": "Open",
                "min_experience": "5 yrs",
                "budget_max": "30 LPA",
            }
        },
    )
    assert ok.status_code == 201, ok.text
    assert ok.json()["data"]["min_experience"] == 60
    assert ok.json()["data"]["budget_max"] == 3000000.0
