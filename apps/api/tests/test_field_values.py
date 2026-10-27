"""Excel-style column filter (R3): the values a column holds with counts, and filtering by ticked values."""

import httpx

from tests.conftest import Agency, candidate


async def _seed(a: Agency) -> None:
    rows = [
        ("Asha", "Infosys", "Active", ["Java", "SQL"]),
        ("Bimal", "infosys", "Active", ["Java"]),
        ("Chitra", "Wipro", "Placed", ["Kafka"]),
        ("Dev", "TCS", "Active", []),
    ]
    for i, (name, employer, status, skills) in enumerate(rows):
        r = await a.create_candidate(
            candidate(
                full_name=name,
                phone=f"+91 98450 7{i:04d}",
                current_employer=employer,
                status=status,
                skills=skills,
            )
        )
        assert r.status_code == 201, r.text


async def _values(client: httpx.AsyncClient, a: Agency, field: str, **params: object) -> dict:
    r = await client.get(f"/v1/records/candidate/values/{field}", headers=a.h(), params=params)  # type: ignore[arg-type]
    assert r.status_code == 200, r.text
    return r.json()


async def test_a_column_lists_its_values_with_counts_alphabetically(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    await _seed(agency)
    body = await _values(client, agency, "status")
    assert [(v["value"], v["count"]) for v in body["values"]] == [("Active", 3), ("Placed", 1)]
    assert body["truncated"] is False
    tags = await _values(client, agency, "skills")
    assert {v["value"]: v["count"] for v in tags["values"]} == {"Java": 2, "SQL": 1, "Kafka": 1}


async def test_values_follow_the_rest_of_the_search_and_a_typed_word(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    await _seed(agency)
    only_active = await _values(client, agency, "current_employer", **{"f.status": "Active"})
    assert sorted(v["value"].lower() for v in only_active["values"]) == ["infosys", "infosys", "tcs"]
    typed = await _values(client, agency, "current_employer", search="wip")
    assert [v["value"] for v in typed["values"]] == ["Wipro"]
    nothing = await _values(client, agency, "current_employer", search="zzz")
    assert nothing["values"] == []


async def test_the_list_is_capped_and_says_when_more_exist(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    await _seed(agency)
    body = await _values(client, agency, "current_employer", limit=2)
    assert len(body["values"]) == 2 and body["truncated"] is True


async def test_ticked_values_filter_text_columns_ignoring_case(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    await _seed(agency)
    r = await client.get(
        "/v1/records/candidate",
        headers=agency.h(),
        params={"in.current_employer": "infosys,TCS", "page": 1, "sort": "full_name", "direction": "asc"},
    )
    assert r.status_code == 200, r.text
    assert [i["data"]["full_name"] for i in r.json()["items"]] == ["Asha", "Bimal", "Dev"]
    assert r.json()["total"] == 3


async def test_columns_without_a_value_list_and_unknown_ones_are_refused(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    for field in ("total_experience", "no_such_field"):
        r = await client.get(f"/v1/records/candidate/values/{field}", headers=agency.h())
        assert r.status_code == 422, (field, r.text)
