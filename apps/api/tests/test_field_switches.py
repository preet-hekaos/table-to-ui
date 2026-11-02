"""S4: Unique, Searchable and Filterable can be changed after a field exists, and records already stored follow."""

import httpx

from tests.conftest import Agency, candidate


async def _add(client: httpx.AsyncClient, a: Agency, **body: object) -> dict:
    r = await client.post("/v1/studio/tables/candidate/fields", headers=a.h(), json=body)
    assert r.status_code == 201, r.text
    return r.json()


async def _patch(client: httpx.AsyncClient, a: Agency, key: str, **body: object) -> httpx.Response:
    return await client.patch(f"/v1/studio/tables/candidate/fields/{key}", headers=a.h(), json=body)


async def _make(a: Agency, n: int, **data: object) -> list[dict]:
    out = []
    for i in range(n):
        r = await a.create_candidate(
            candidate(phone=f"+91 98450 2{i:04d}", email=f"s4-{i}@x.test", **data)
        )
        assert r.status_code == 201, r.text
        out.append(r.json())
    return out


async def test_unique_is_blocked_while_records_hold_duplicates_then_holds_everywhere(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    f = await _add(client, a, label="Badge", type="text")
    await a.publish_live()
    recs = await _make(a, 3)
    for r in recs[:2]:
        up = await client.patch(
            f"/v1/records/candidate/{r['id']}",
            headers=a.h(),
            json={"version": r["version"], "data": {f["key"]: "AB-1"}},
        )
        assert up.status_code == 200, up.text
    assert (await _patch(client, a, f["key"], unique=True)).status_code == 200

    status = (await client.get("/v1/studio/status", headers=a.h())).json()
    assert status["unique_blockers"][0]["field"] == f["key"]
    assert status["unique_blockers"][0]["values"] == [{"value": "AB-1", "count": 2}]
    blocked = await client.post("/v1/apps/current/releases", headers=a.h())
    assert blocked.status_code == 422 and "AB-1" in blocked.text

    fix = await client.patch(
        f"/v1/records/candidate/{recs[1]['id']}",
        headers=a.h(),
        json={"version": 2, "data": {f["key"]: "AB-2"}},
    )
    assert fix.status_code == 200, fix.text
    await a.publish_live()

    dup = await a.create_candidate(
        candidate(phone="+91 98450 29999", email="s4-new@x.test", **{f["key"]: "ab-1"})
    )
    assert dup.status_code == 422, dup.text
    assert dup.json()["errors"][0]["field"] == f["key"]
    assert "already used" in dup.text
    bulk = await client.post(
        "/v1/records/candidate/bulk",
        headers=a.h(),
        json={"action": "update", "ids": [recs[2]["id"]], "field": f["key"], "value": "AB-1"},
    )
    assert bulk.json()["applied"] == 0 and "already used" in bulk.text


async def test_switching_unique_off_allows_duplicates_again(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    f = await _add(client, a, label="Badge", type="text", unique=True)
    await a.publish_live()
    one = await a.create_candidate(
        candidate(phone="+91 98450 20001", email="u1@x.test", **{f["key"]: "X1"})
    )
    assert one.status_code == 201
    again = candidate(phone="+91 98450 20002", email="u2@x.test", **{f["key"]: "X1"})
    assert (await a.create_candidate(again)).status_code == 422
    assert (await _patch(client, a, f["key"], unique=False)).status_code == 200
    await a.publish_live()
    assert (await a.create_candidate(again)).status_code == 201


async def test_unique_is_refused_for_types_it_cannot_compare(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    f = await _add(client, agency, label="Notes", type="long_text")
    assert (await _patch(client, agency, f["key"], unique=True)).status_code == 422


async def test_searchable_rebuilds_the_search_text_of_records_saved_before(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    f = await _add(client, a, label="Nickname", type="text", searchable=False)
    await a.publish_live()
    await _make(a, 1, **{f["key"]: "zebracorn"})
    find = lambda: client.get("/v1/records/candidate", headers=a.h(), params={"q": "zebracorn"})  # noqa: E731
    assert (await find()).json()["items"] == []
    assert (await _patch(client, a, f["key"], searchable=True)).status_code == 200
    assert (await find()).json()["items"] == []  # nothing changes before publish
    await a.publish_live()
    assert len((await find()).json()["items"]) == 1  # an old record is found
    assert (await _patch(client, a, f["key"], searchable=False)).status_code == 200
    await a.publish_live()
    assert (await find()).json()["items"] == []


async def test_filterable_sets_the_field_flag_and_the_table_list_together(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    f = await _add(client, a, label="Region", type="text")
    key = f["key"]
    off = await _patch(client, a, key, filterable=False)
    assert off.status_code == 200 and off.json()["filterable"] is False
    tables = {t["key"]: t for t in (await client.get("/v1/studio/tables", headers=a.h())).json()}
    assert key in tables["candidate"]["features"]["unfilterable"]
    await a.publish_live()
    refused = await client.get(f"/v1/records/candidate?c.{key}=x", headers=a.h())
    assert refused.status_code == 422, refused.text
    assert (await _patch(client, a, key, filterable=True)).status_code == 200
    tables = {t["key"]: t for t in (await client.get("/v1/studio/tables", headers=a.h())).json()}
    assert key not in (tables["candidate"]["features"] or {}).get("unfilterable", [])
    await a.publish_live()
    ok = await client.get(f"/v1/records/candidate?c.{key}=x", headers=a.h())
    assert ok.status_code == 200, ok.text


async def test_a_field_added_then_made_unique_in_one_draft_works_once_live(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    f = await _add(client, a, label="Badge no", type="text")
    assert (await _patch(client, a, f["key"], unique=True)).status_code == 200
    await a.publish_live()
    first = await a.create_candidate(
        candidate(phone="+91 98450 20001", email="n1@x.test", **{f["key"]: "AB-1"})
    )
    assert first.status_code == 201, first.text
    older = await a.create_candidate(candidate(phone="+91 98450 20002", email="n2@x.test"))
    ok = await client.patch(
        f"/v1/records/candidate/{older.json()['id']}",
        headers=a.h(),
        json={"version": 1, "data": {f["key"]: "AB-2"}},
    )
    assert ok.status_code == 200, ok.text
    dup = await a.create_candidate(
        candidate(phone="+91 98450 20003", email="n3@x.test", **{f["key"]: "ab-1"})
    )
    assert dup.status_code in (409, 422), dup.text
