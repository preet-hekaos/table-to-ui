"""Field grid (R5): what each field does is set per table; export and bulk limits are enforced by the server."""

import json

import httpx

from tests.conftest import Agency, candidate


async def _put(client: httpx.AsyncClient, a: Agency, body: dict) -> httpx.Response:  # type: ignore[type-arg]
    return await client.put("/v1/studio/tables/candidate/features", headers=a.h(), json=body)


async def _one(a: Agency) -> str:
    r = await a.create_candidate(candidate(full_name="Grid Person", status="Active"))
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def test_field_settings_must_name_fields_of_the_table(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    for key in ("uneditable", "ungroupable", "unexported", "nobulk", "default_columns"):
        assert (await _put(client, agency, {key: ["no_such_field"]})).status_code == 422, key
    ok = await _put(
        client,
        agency,
        {
            "default_columns": ["full_name", "status"],
            "density": "comfortable",
            "uneditable": ["status"],
            "ungroupable": ["full_name"],
        },
    )
    assert ok.status_code == 200, ok.text
    assert (await _put(client, agency, {"density": "huge"})).status_code == 422


async def test_a_field_left_out_of_exports_never_leaves(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    await _one(agency)
    assert (await _put(client, agency, {"unexported": ["email"]})).status_code == 200
    await agency.publish_live()
    every = await client.post(
        "/v1/records/candidate/export", headers=agency.h(), json={"format": "json"}
    )
    assert every.status_code == 200, every.text
    rows = json.loads(every.content)
    assert rows and all("email" not in r for r in rows), rows[:1]
    asked = await client.post(
        "/v1/records/candidate/export",
        headers=agency.h(),
        json={"format": "csv", "fields": ["full_name", "email"]},
    )
    assert asked.status_code == 422


async def test_a_field_left_out_of_bulk_change_is_refused_by_the_server(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    rid = await _one(agency)
    assert (await _put(client, agency, {"nobulk": ["status"]})).status_code == 200
    await agency.publish_live()
    r = await client.post(
        "/v1/records/candidate/bulk",
        headers=agency.h(),
        json={"action": "update", "ids": [rid], "field": "status", "value": "Archived"},
    )
    assert r.status_code == 422, r.text
    other = await client.post(
        "/v1/records/candidate/bulk",
        headers=agency.h(),
        json={"action": "update", "ids": [rid], "field": "current_title", "value": "Lead"},
    )
    assert other.status_code == 200, other.text


async def test_filtering_can_be_off_while_sorting_stays_on(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    await _one(agency)
    ok = await client.get("/v1/records/candidate?in.status=Active", headers=agency.h())
    assert ok.status_code == 200, ok.text
    assert (await _put(client, agency, {"filterable": False})).status_code == 200
    await agency.publish_live()
    refused = await client.get("/v1/records/candidate?in.status=Active", headers=agency.h())
    assert refused.status_code == 422
    still = await client.get(
        "/v1/records/candidate?sort=full_name&direction=asc", headers=agency.h()
    )
    assert still.status_code == 200, still.text
