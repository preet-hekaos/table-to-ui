"""Sort and filter (N5b): contains, choices, date and number ranges, and what a role may not see."""

import uuid
from typing import Any

import httpx

from tableui.platform.db import Database
from tableui.platform.mail import InMemoryMailer
from tests.conftest import Agency, candidate
from tests.test_access import _member, _setup


async def _people(a: Agency) -> None:
    rows = [
        ("Asha Rao", "Pune", "Active", ["Python", "SQL"], 24, 900000),
        ("Bala Iyer", "Chennai", "Active", ["Java"], 60, 1500000),
        ("Chitra Nair", "Pune", "Archived", ["Python"], 12, 700000),
        ("Dev Patel", "Surat", "Active", [], 36, 1100000),
    ]
    for i, (name, city, status, skills, months, ctc) in enumerate(rows):
        r = await a.create_candidate(
            candidate(
                full_name=name,
                location=city,
                status=status,
                skills=skills,
                total_experience=months,
                expected_ctc=ctc,
                phone=f"+91 98450 1{i}000",
            )
        )
        assert r.status_code == 201, r.text


async def _names(client: httpx.AsyncClient, a: Agency, **params: Any) -> list[str]:
    r = await client.get(
        "/v1/records/candidate",
        headers=a.h(),
        params={"sort": "full_name", "direction": "asc", **params},
    )
    assert r.status_code == 200, r.text
    return [i["data"]["full_name"] for i in r.json()["items"]]


async def test_contains_matches_part_of_a_text_and_ignores_case(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    await _people(agency)
    assert await _names(client, agency, **{"c.full_name": "RA"}) == [
        "Asha Rao",
        "Chitra Nair",
    ]
    assert await _names(client, agency, **{"c.location": "pun"}) == ["Asha Rao", "Chitra Nair"]
    # A percent sign is just a character, never a wildcard.
    assert await _names(client, agency, **{"c.full_name": "%"}) == []


async def test_choices_match_any_of_a_list_and_work_for_tags(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    await _people(agency)
    assert await _names(client, agency, **{"in.status": "Archived"}) == ["Chitra Nair"]
    assert await _names(client, agency, **{"in.skills": "Java,SQL"}) == ["Asha Rao", "Bala Iyer"]
    assert await _names(client, agency, **{"in.status": "Active,Archived"}) == [
        "Asha Rao",
        "Bala Iyer",
        "Chitra Nair",
        "Dev Patel",
    ]


async def test_number_and_date_ranges_and_combining_filters(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    await _people(a)
    assert await _names(client, a, **{"r.total_experience": "24..61"}) == [
        "Asha Rao",
        "Bala Iyer",
        "Dev Patel",
    ]
    assert await _names(client, a, **{"r.total_experience": "24..61", "c.location": "pun"}) == [
        "Asha Rao"
    ]
    for day in ("2026-01-05", "2026-02-10", "2026-03-15"):
        r = await client.post(
            "/v1/records/interaction",
            headers=a.h(),
            json={"data": {"summary": f"Call {day}", "kind": "Call", "occurred_on": day}},
        )
        assert r.status_code == 201, r.text

    async def days(rng: str) -> list[str]:
        r = await client.get(
            "/v1/records/interaction",
            headers=a.h(),
            params={"sort": "occurred_on", "direction": "asc", "r.occurred_on": rng},
        )
        assert r.status_code == 200, r.text
        return [i["data"]["occurred_on"] for i in r.json()["items"]]

    assert await days("2026-02-01..2026-03-15") == ["2026-02-10", "2026-03-15"]
    assert await days("..2026-01-31") == ["2026-01-05"]
    bad = await client.get(
        "/v1/records/interaction", headers=a.h(), params={"r.occurred_on": "yesterday.."}
    )
    assert bad.status_code == 422


async def test_wrong_kind_of_filter_for_a_field_is_refused(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    h = agency.h()
    for params in (
        {"c.total_experience": "2"},
        {"in.full_name": "a"},
        {"c.nope": "a"},
        {"r.full_name": "1..2"},
    ):
        r = await client.get("/v1/records/candidate", headers=h, params=params)
        assert r.status_code == 422, params


async def test_a_role_cannot_sort_or_filter_by_a_field_it_may_not_see(
    client: httpx.AsyncClient, db: Database, mailer: InMemoryMailer
) -> None:
    boss = Agency(client, "Hidden Co", f"h-{uuid.uuid4().hex[:8]}@hidden.test")
    await boss.sign_up("recruitment")
    await _setup(
        db,
        boss.tenant_id,
        "INSERT INTO control.tenant_field_deny (tenant_id, role_key, table_key, field_key) "
        "VALUES (:t, 'recruiter', 'candidate', 'expected_ctc') ON CONFLICT DO NOTHING",
    )
    await _setup(
        db,
        boss.tenant_id,
        "UPDATE control.tenant_role_scope SET scope = 'all' WHERE tenant_id = :t AND role_key = 'recruiter'",
    )
    rec = await _member(client, boss, mailer, "recruiter")
    await _people(boss)
    # The admin may; the recruiter gets the same refusal as for a field that does not exist.
    ok = await client.get(
        "/v1/records/candidate", headers=boss.h(), params={"sort": "expected_ctc"}
    )
    assert ok.status_code == 200
    for params in (
        {"sort": "expected_ctc"},
        {"r.expected_ctc": "1..2000000"},
        {"f.expected_ctc": "900000"},
    ):
        r = await client.get("/v1/records/candidate", headers=rec.h(), params=params)
        assert r.status_code == 422, params
    visible = await client.get(
        "/v1/records/candidate", headers=rec.h(), params={"sort": "total_experience"}
    )
    assert visible.status_code == 200


async def test_switching_sort_and_filter_off_refuses_the_new_filters(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    await _people(a)
    r = await client.put(
        "/v1/studio/tables/candidate/features", headers=a.h(), json={"sort_filter": False}
    )
    assert r.status_code == 200
    await a.publish_live()
    for params in ({"c.full_name": "a"}, {"in.status": "Active"}):
        assert (
            await client.get("/v1/records/candidate", headers=a.h(), params=params)
        ).status_code == 422
    assert len(await _names(client, a)) == 4


async def test_per_field_settings_and_default_sort_are_checked(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    ok = await client.put(
        "/v1/studio/tables/candidate/features",
        headers=a.h(),
        json={
            "unsortable": ["phone"],
            "unfilterable": ["email"],
            "default_sort": {"field": "full_name", "direction": "asc"},
        },
    )
    assert ok.status_code == 200, ok.text
    bad = await client.put(
        "/v1/studio/tables/candidate/features", headers=a.h(), json={"unsortable": ["nope"]}
    )
    assert bad.status_code == 422
    # The same settings for every table drop names a table does not have.
    every = await client.put(
        "/v1/studio/features",
        headers=a.h(),
        json={"unsortable": ["phone"], "default_sort": {"field": "full_name"}},
    )
    assert every.status_code == 200
    tables = {t["key"]: t for t in (await client.get("/v1/studio/tables", headers=a.h())).json()}
    assert tables["client"]["features"] is None  # nothing left to set, so no Draft change
    assert tables["candidate"]["features"]["default_sort"]["field"] == "full_name"
