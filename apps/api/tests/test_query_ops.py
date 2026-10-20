"""M0-S15 list paging and sorting, M0-S16 detail, M0-S18 measure, M0-S20 operator console."""

import time
import uuid

import httpx
import pyotp
import pytest
from sqlalchemy import text

from tableui.ops.public import create_operator
from tableui.platform.db import Database
from tests.conftest import PASSWORD, Agency, candidate


async def _bulk(db: Database, agency: Agency, n: int) -> None:
    """Insert n candidates directly (fast) for list performance tests."""
    t = uuid.UUID(agency.tenant_id)
    async with db.tenant(t) as s:
        user = (await s.execute(text("SELECT gen_random_uuid()"))).scalar_one()
        await s.execute(
            text(
                "INSERT INTO candidate (id, tenant_id, data, full_name_norm, email_norm, created_by, updated_by, updated_at) "
                "SELECT gen_random_uuid(), :t, jsonb_build_object('full_name', 'Person ' || g, 'email', 'p' || g || '@bulk.test', 'status', 'Active', 'notice_period_days', g % 90), "
                "'person ' || g, 'p' || g || '@bulk.test', :u, :u, now() - (g || ' seconds')::interval FROM generate_series(1, :n) g"
            ),
            {"t": t, "u": user, "n": n},
        )


async def test_list_pages_with_cursor_and_sorts_on_the_server(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    for i in range(7):
        await agency.create_candidate(
            candidate(
                full_name=f"Name {i:02d}",
                email=f"n{i}@x.test",
                phone=None,
                current_employer=f"E{i}",
                notice_period_days=70 - i,
            )
        )
    seen: list[str] = []
    cursor = None
    while True:
        params = {
            "limit": 3,
            "sort": "full_name",
            "direction": "asc",
            **({"cursor": cursor} if cursor else {}),
        }
        page = (await client.get("/v1/records/candidate", headers=agency.h(), params=params)).json()
        seen += [i["data"]["full_name"] for i in page["items"]]
        cursor = page["next_cursor"]
        if not cursor:
            break
    assert seen == [f"Name {i:02d}" for i in range(7)]
    by_notice = (
        await client.get(
            "/v1/records/candidate",
            headers=agency.h(),
            params={"sort": "notice_period_days", "direction": "desc"},
        )
    ).json()
    assert [i["data"]["notice_period_days"] for i in by_notice["items"]] == sorted(
        [70 - i for i in range(7)], reverse=True
    )
    bad = await client.get("/v1/records/candidate", headers=agency.h(), params={"sort": "nope"})
    assert bad.status_code == 422
    assert (
        await client.get("/v1/records/candidate", headers=agency.h(), params={"cursor": "garbage"})
    ).status_code == 422


async def test_default_order_is_last_updated_first_and_empty_list_is_empty(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    assert (await client.get("/v1/records/candidate", headers=agency.h())).json() == {
        "items": [],
        "next_cursor": None,
    }
    a = (await agency.create_candidate(candidate(email="a@x.test", phone=None))).json()
    b = (
        await agency.create_candidate(
            candidate(email="b@x.test", phone=None, current_employer="Z", full_name="B")
        )
    ).json()
    ids = [
        i["id"]
        for i in (await client.get("/v1/records/candidate", headers=agency.h())).json()["items"]
    ]
    assert ids == [b["id"], a["id"]]


async def test_first_page_of_10000_candidates_is_fast(
    client: httpx.AsyncClient, agency: Agency, db: Database
) -> None:
    await _bulk(db, agency, 10_000)
    times = []
    for _ in range(20):
        t0 = time.perf_counter()
        r = await client.get("/v1/records/candidate", headers=agency.h(), params={"limit": 50})
        times.append((time.perf_counter() - t0) * 1000)
        assert r.status_code == 200 and len(r.json()["items"]) == 50
    times.sort()
    assert times[int(len(times) * 0.95) - 1] < 800, times


async def test_detail_of_other_tenants_id_is_not_found(
    client: httpx.AsyncClient, agency: Agency, other_agency: Agency
) -> None:
    theirs = (await other_agency.create_candidate(candidate(email="t@x.test", phone=None))).json()
    assert (
        await client.get(f"/v1/records/candidate/{theirs['id']}", headers=agency.h())
    ).status_code == 404
    assert (
        await client.get(f"/v1/records/candidate/{uuid.uuid4()}", headers=agency.h())
    ).status_code == 404


async def test_activity_log_shows_who_created_the_candidate(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    rid = (await agency.create_candidate(candidate())).json()["id"]
    log = (await client.get("/v1/activity", headers=agency.h())).json()
    entry = next(e for e in log if e["subject_id"] == rid)
    assert entry["action"] == "candidate.create" and entry["actor"].startswith("Owner")


async def test_measure_counts_active_candidates_via_outbox_not_live_tables(
    client: httpx.AsyncClient, agency: Agency, app
) -> None:  # type: ignore[no-untyped-def]
    assert (await client.get("/v1/measures/active_candidates", headers=agency.h())).json()[
        "value"
    ] == 0
    rid = (await agency.create_candidate(candidate())).json()["id"]
    # Not visible until the event flows through the outbox: the measure never reads live tables.
    assert (await client.get("/v1/measures/active_candidates", headers=agency.h())).json()[
        "value"
    ] == 0
    await app.state.relay.run_once()
    assert (await client.get("/v1/measures/active_candidates", headers=agency.h())).json()[
        "value"
    ] == 1
    await client.patch(
        f"/v1/records/candidate/{rid}",
        headers=agency.h(),
        json={"version": 1, "data": {"status": "Placed"}},
    )
    await app.state.relay.run_once()
    assert (await client.get("/v1/measures/active_candidates", headers=agency.h())).json()[
        "value"
    ] == 0
    assert (await client.get("/v1/measures/nope", headers=agency.h())).status_code == 404


async def test_viewer_cannot_create_candidates(
    client: httpx.AsyncClient, agency: Agency, mailer
) -> None:  # type: ignore[no-untyped-def]
    email = f"v-{uuid.uuid4().hex[:6]}@n.test"
    await client.post(
        "/v1/invitations", headers=agency.h(), json={"email": email, "role": "viewer"}
    )
    token = mailer.sent[-1]["body"].split("token=")[1].split()[0]
    viewer = (
        await client.post(
            f"/v1/invitations/{token}/accept", json={"full_name": "V W", "password": PASSWORD}
        )
    ).json()["token"]
    v = Agency(client, agency.name, email)
    v.token = viewer
    await v.enrol_mfa(viewer)
    r = await agency.create_candidate(candidate(), token=viewer)
    assert r.status_code == 403
    assert (await client.get("/v1/records/candidate", headers=v.h())).status_code == 200


@pytest.fixture
async def operator(db: Database) -> dict[str, str]:
    email = f"ops-{uuid.uuid4().hex[:6]}@platform.test"
    async with db.control() as s:
        out = await create_operator(s, email=email, full_name="Ops One", password=PASSWORD)
    return {"email": email, **out}


async def test_operator_signs_in_with_mfa_and_sees_tenant_directory_only(
    client: httpx.AsyncClient, operator: dict[str, str], agency: Agency, db: Database
) -> None:
    await agency.create_candidate(candidate())
    r = await client.post(
        "/v1/ops/auth/sign-in", json={"email": operator["email"], "password": PASSWORD}
    )
    token = r.json()["token"]
    assert (
        await client.get("/v1/ops/tenants", headers={"Authorization": f"Bearer {token}"})
    ).status_code == 401  # MFA pending
    ok = await client.post(
        "/v1/ops/auth/mfa/verify",
        headers={"Authorization": f"Bearer {token}"},
        json={"code": pyotp.TOTP(operator["secret"]).now()},
    )
    assert ok.status_code == 204
    tenants = (
        await client.get("/v1/ops/tenants", headers={"Authorization": f"Bearer {token}"})
    ).json()
    mine = next(t for t in tenants if t["id"] == agency.tenant_id)
    assert set(mine) >= {"name", "plan", "cluster", "schema", "created_at", "health"}
    assert "Arjun" not in str(tenants)
    # Operators cannot use tenant routes, tenant users cannot use operator routes.
    assert (
        await client.get("/v1/records/candidate", headers={"Authorization": f"Bearer {token}"})
    ).status_code == 401
    assert (await client.get("/v1/ops/tenants", headers=agency.h())).status_code == 401
    async with db.control() as s:
        actions = (
            (
                await s.execute(
                    text(
                        "SELECT action FROM control.audit_event WHERE scope = 'platform' AND actor_id = (SELECT id FROM control.app_user WHERE email = :e)"
                    ),
                    {"e": operator["email"]},
                )
            )
            .scalars()
            .all()
        )
    assert {"operator.sign_in", "operator.tenants.list"} <= set(actions)
