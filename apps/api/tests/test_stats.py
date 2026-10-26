"""Numbers above the table (N5g): totals follow the search, hidden fields stay hidden, switches hold."""

import uuid

import httpx

from tableui.platform.db import Database
from tableui.platform.mail import InMemoryMailer
from tests.conftest import Agency, candidate
from tests.test_access import _member, _setup


async def _people(a: Agency) -> None:
    rows = [
        ("Asha", "Active", 24, 900000),
        ("Bala", "Active", 60, 1500000),
        ("Chitra", "Archived", 12, 700000),
        ("Dev", "Active", 36, None),
    ]
    for i, (name, status, months, ctc) in enumerate(rows):
        extra = {"expected_ctc": ctc} if ctc else {}
        r = await a.create_candidate(
            candidate(
                full_name=name,
                status=status,
                total_experience=months,
                phone=f"+91 98450 4{i}000",
                **extra,
            )
        )
        assert r.status_code == 201, r.text


def _by_key(body: dict) -> dict:  # type: ignore[type-arg]
    return {f["key"]: f for f in body["fields"]}


async def test_totals_and_averages_cover_every_match_and_follow_filters(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    await _people(agency)
    r = await client.get(
        "/v1/records/candidate/stats",
        headers=agency.h(),
        params={"fields": "expected_ctc,total_experience"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    f = _by_key(body)
    assert body["total"] == 4
    assert f["expected_ctc"]["count"] == 3 and f["expected_ctc"]["sum"] == 3100000
    assert f["expected_ctc"]["min"] == 700000 and f["expected_ctc"]["max"] == 1500000
    assert f["total_experience"]["avg"] == 33
    active = await client.get(
        "/v1/records/candidate/stats",
        headers=agency.h(),
        params={"fields": "expected_ctc", "f.status": "Active"},
    )
    assert active.json()["total"] == 3 and _by_key(active.json())["expected_ctc"]["sum"] == 2400000
    auto = await client.get("/v1/records/candidate/stats", headers=agency.h())
    assert 1 <= len(auto.json()["fields"]) <= 3
    bad = await client.get(
        "/v1/records/candidate/stats", headers=agency.h(), params={"fields": "full_name"}
    )
    assert bad.status_code == 422


async def test_a_hidden_number_is_never_summarised(
    client: httpx.AsyncClient, db: Database, mailer: InMemoryMailer
) -> None:
    boss = Agency(client, "Stats Co", f"s-{uuid.uuid4().hex[:8]}@stats.test")
    await boss.sign_up("recruitment")
    await _setup(
        db, boss.tenant_id,
        "INSERT INTO control.tenant_field_deny (tenant_id, role_key, table_key, field_key) "
        "VALUES (:t, 'recruiter', 'candidate', 'expected_ctc') ON CONFLICT DO NOTHING",
    )  # fmt: skip
    await _setup(
        db,
        boss.tenant_id,
        "UPDATE control.tenant_role_scope SET scope = 'all' WHERE tenant_id = :t AND role_key = 'recruiter'",
    )
    rec = await _member(client, boss, mailer, "recruiter")
    await _people(boss)
    ok = await client.get(
        "/v1/records/candidate/stats", headers=boss.h(), params={"fields": "expected_ctc"}
    )
    assert ok.status_code == 200
    no = await client.get(
        "/v1/records/candidate/stats", headers=rec.h(), params={"fields": "expected_ctc"}
    )
    assert no.status_code == 422
    auto = await client.get("/v1/records/candidate/stats", headers=rec.h())
    assert "expected_ctc" not in {f["key"] for f in auto.json()["fields"]}


async def test_chosen_fields_are_checked_and_the_switch_is_enforced(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    await _people(agency)

    async def put(body: dict) -> httpx.Response:  # type: ignore[type-arg]
        return await client.put(
            "/v1/studio/tables/candidate/features", headers=agency.h(), json=body
        )

    assert (await put({"stat_fields": ["full_name"]})).status_code == 422
    assert (await put({"stat_fields": ["expected_ctc"]})).status_code == 200
    await agency.publish_live()
    got = await client.get("/v1/records/candidate/stats", headers=agency.h())
    assert [f["key"] for f in got.json()["fields"]] == ["expected_ctc"]
    assert (await put({"stat_fields": []})).status_code == 200
    await agency.publish_live()
    assert (await client.get("/v1/records/candidate/stats", headers=agency.h())).json()[
        "fields"
    ] == []
    assert (await put({"statistics": False})).status_code == 200
    await agency.publish_live()
    assert (await client.get("/v1/records/candidate/stats", headers=agency.h())).status_code == 403
