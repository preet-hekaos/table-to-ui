"""Numbered pages (R2): `page` and `page_size` give a page and the total; the cursor path is unchanged."""

import httpx

from tests.conftest import Agency, candidate


async def _make(a: Agency, n: int) -> None:
    for i in range(n):
        r = await a.create_candidate(
            candidate(full_name=f"Pg{i:02d}", phone=f"+91 98450 6{i:04d}", status="Active")
        )
        assert r.status_code == 201, r.text


async def _names(client: httpx.AsyncClient, a: Agency, **params: object) -> dict:
    r = await client.get("/v1/records/candidate", headers=a.h(), params=params)  # type: ignore[arg-type]
    assert r.status_code == 200, r.text
    return r.json()


async def test_pages_cover_every_record_once_and_report_the_total(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    await _make(agency, 7)
    seen: list[str] = []
    for n in (1, 2, 3):
        body = await _names(client, agency, page=n, page_size=3, sort="full_name", direction="asc")
        assert body["total"] == 7 and body["page"] == n and body["page_size"] == 3
        assert body["next_cursor"] is None
        seen += [i["data"]["full_name"] for i in body["items"]]
    assert seen == [f"Pg{i:02d}" for i in range(7)]  # no gaps, no repeats


async def test_a_page_past_the_end_shows_the_last_page_and_zero_matches_is_page_one(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    await _make(agency, 4)
    body = await _names(client, agency, page=99, page_size=3, sort="full_name", direction="asc")
    assert body["page"] == 2 and len(body["items"]) == 1
    none = await _names(
        client, agency, page=1, page_size=3, **{"c.full_name": "no-such-person-anywhere"}
    )
    assert none["total"] == 0 and none["items"] == [] and none["page"] == 1


async def test_total_follows_the_search_and_page_size_is_capped(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    await _make(agency, 5)
    body = await _names(client, agency, page=1, page_size=2, **{"c.full_name": "Pg03"})
    assert body["total"] == 1 and len(body["items"]) == 1
    big = await _names(client, agency, page=1, page_size=100000)
    assert big["page_size"] <= 200


async def test_equal_sort_values_do_not_repeat_across_pages(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    await _make(agency, 6)  # every record has the same status
    ids: list[str] = []
    for n in (1, 2, 3):
        body = await _names(client, agency, page=n, page_size=2, sort="status", direction="asc")
        ids += [i["id"] for i in body["items"]]
    assert len(ids) == len(set(ids)) == 6


async def test_without_page_the_answer_is_the_old_cursor_shape(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    await _make(agency, 3)
    body = await _names(client, agency, limit=2)
    assert set(body) == {"items", "next_cursor"} and body["next_cursor"]
