"""M0-S08 Draft/Test/Live and rollback, M0-S09 tables and fields."""

import httpx
from sqlalchemy import text

from tableui.platform.db import Database
from tests.conftest import Agency, candidate


async def test_studio_shows_candidate_table_with_fields(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    tables = (await client.get("/v1/studio/tables", headers=agency.h())).json()
    cand = next(t for t in tables if t["key"] == "candidate")
    email = next(f for f in cand["fields"] if f["key"] == "email")
    assert email == {
        "key": "email",
        "label": "Email",
        "type": "email",
        "required": True,
        "source": "pack",
    }


async def test_publish_creates_immutable_versions_with_pinning_manifest(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    releases = (await client.get("/v1/apps/current/releases", headers=agency.h())).json()
    assert [r["version"] for r in releases] == [1]
    r = releases[0]
    assert r["is_live"] and r["is_test"]
    m = r["manifest"]
    assert m["pack"]["id"] == "recruitment"
    assert "candidate" in m["tables"] and len(m["tables"]["candidate"]["hash"]) == 64
    assert "R-01" in m["rules"] and "active_candidates" in m["measures"]


async def test_cannot_go_live_without_test(client: httpx.AsyncClient, agency: Agency) -> None:
    r = await client.post("/v1/apps/current/releases/99/promote", headers=agency.h())
    assert r.status_code == 404


async def test_rollback_restores_previous_live_version_and_is_audited(
    client: httpx.AsyncClient, agency: Agency, db: Database
) -> None:
    assert (await agency.publish_live()) == 2
    live = lambda rs: next(r["version"] for r in rs if r["is_live"])  # noqa: E731
    assert live((await client.get("/v1/apps/current/releases", headers=agency.h())).json()) == 2
    rb = await client.post("/v1/apps/current/rollback", headers=agency.h())
    assert rb.status_code == 200 and rb.json()["version"] == 1
    assert live((await client.get("/v1/apps/current/releases", headers=agency.h())).json()) == 1
    # The live app serves immediately (no waiting period).
    assert (await agency.create_candidate(candidate())).status_code == 201
    async with db.control() as s:
        n = (
            await s.execute(
                text(
                    "SELECT count(*) FROM control.audit_event WHERE action = 'release.rollback' AND tenant_id = :t"
                ),
                {"t": agency.tenant_id},
            )
        ).scalar_one()
    assert n == 1
    # Rolling back again returns to what was live before (a rollback is itself reversible).
    again = await client.post("/v1/apps/current/rollback", headers=agency.h())
    assert again.status_code == 200 and again.json()["version"] == 2


async def test_first_live_version_has_nothing_to_roll_back_to(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    nothing = await client.post("/v1/apps/current/rollback", headers=agency.h())
    assert nothing.status_code == 422


async def test_unpublished_app_is_not_usable(client: httpx.AsyncClient) -> None:
    a = Agency(client, "Fresh", "fresh-x@n.test")
    await a.sign_up()
    r = await a.create_candidate(candidate())
    assert r.status_code == 404 and "published" in r.json()["detail"]
