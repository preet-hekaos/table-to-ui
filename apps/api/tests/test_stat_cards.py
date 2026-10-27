"""Summary strip setup (R4): cards chosen in Studio, and numbers that can ignore the search."""

import httpx

from tests.conftest import Agency
from tests.test_stats import _people


async def _put(client: httpx.AsyncClient, a: Agency, body: dict) -> httpx.Response:  # type: ignore[type-arg]
    return await client.put("/v1/studio/tables/candidate/features", headers=a.h(), json=body)


async def _stats(client: httpx.AsyncClient, a: Agency, **params: str) -> dict:  # type: ignore[type-arg]
    r = await client.get("/v1/records/candidate/stats", headers=a.h(), params=params)
    assert r.status_code == 200, r.text
    return r.json()


CARDS = [
    {"kind": "count"},
    {"kind": "number", "field": "expected_ctc", "measure": "sum"},
    {
        "kind": "number",
        "field": "total_experience",
        "measure": "max",
        "label": "Longest experience",
    },
    {"kind": "value", "field": "status", "value": "Active"},
]


async def test_chosen_cards_are_computed_over_the_matches(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    await _people(agency)
    assert (await _put(client, agency, {"stat_cards": CARDS})).status_code == 200
    await agency.publish_live()
    body = await _stats(client, agency)
    cards = body["cards"]
    assert [c["label"] for c in cards] == [
        "Matching",
        "Total Expected CTC",
        "Longest experience",
        "Status: Active",
    ]
    assert [c["number"] for c in cards] == [4, 3100000, 60, 3]
    assert body["scope"] == "search"
    narrowed = await _stats(client, agency, **{"f.status": "Archived"})
    assert [c["number"] for c in narrowed["cards"]] == [1, 700000, 12, 0]


async def test_whole_table_numbers_ignore_the_search(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    await _people(agency)
    assert (
        await _put(client, agency, {"stat_cards": CARDS, "stat_scope": "table"})
    ).status_code == 200
    await agency.publish_live()
    body = await _stats(client, agency, **{"f.status": "Archived"})
    assert body["scope"] == "table"
    assert [c["number"] for c in body["cards"]] == [4, 3100000, 60, 3]
    assert body["cards"][0]["label"] == "Total"


async def test_cards_must_fit_the_table_and_keep_automatic_mode_when_unset(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    await _people(agency)
    for bad in (
        [{"kind": "number", "field": "full_name", "measure": "sum"}],  # not a number field
        [{"kind": "number", "field": "expected_ctc"}],  # no measure
        [{"kind": "value", "field": "no_such", "value": "x"}],
        [{"kind": "count"}] * 7,  # at most six
    ):
        assert (await _put(client, agency, {"stat_cards": bad})).status_code == 422, bad
    assert (await _put(client, agency, {"stat_cards": None})).status_code == 200
    await agency.publish_live()
    auto = await _stats(client, agency)
    assert auto["cards"] is None and 1 <= len(auto["fields"]) <= 3
