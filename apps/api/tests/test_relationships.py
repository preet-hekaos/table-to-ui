"""M2.5: the relationship builder (M25-S01 to S08)."""

import httpx

from tests.conftest import Agency, candidate


async def _tag_table(client: httpx.AsyncClient, a: Agency) -> str:
    r = await client.post("/v1/studio/tables", headers=a.h(), json={"label": "Tag"})
    assert r.status_code == 201, r.text
    return str(r.json()["key"])


async def _links(client: httpx.AsyncClient, a: Agency) -> list[dict[str, object]]:
    r = await client.get("/v1/studio/relationships", headers=a.h())
    assert r.status_code == 200, r.text
    return r.json()  # type: ignore[no-any-return]


async def test_every_link_is_listed_with_its_source_and_use(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    links = await _links(client, agency)
    by_id = {x["id"]: x for x in links}
    entry = by_id["submission.candidate"]
    assert entry["source"] == "pack" and entry["to"] == "candidate" and entry["used"] == 0
    assert entry["required"] is True and entry["table_label"]


async def test_add_a_link_refuse_a_duplicate_and_show_it_on_the_parent_after_publish(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    tag = await _tag_table(client, a)
    r = await client.post(
        "/v1/studio/relationships",
        headers=a.h(),
        json={"table": "candidate", "to": tag, "label": "Favourite tag"},
    )
    assert r.status_code == 201, r.text
    link = r.json()
    assert link["id"] == "candidate.favourite_tag" and link["source"] == "agency"
    dup = await client.post(
        "/v1/studio/relationships",
        headers=a.h(),
        json={"table": "candidate", "to": tag, "label": "favourite tag"},
    )
    assert dup.status_code == 422 and dup.json()["errors"][0]["code"] == "duplicate"
    bad = await client.post(
        "/v1/studio/relationships", headers=a.h(), json={"table": "candidate", "to": "nope"}
    )
    assert bad.status_code == 422
    await a.publish_live()
    t = (
        await client.post(f"/v1/records/{tag}", headers=a.h(), json={"data": {"name": "Hot"}})
    ).json()
    made = await a.create_candidate(candidate(favourite_tag=t["id"]))
    assert made.status_code == 201, made.text
    rel = (await client.get(f"/v1/app/tables/{tag}/relations", headers=a.h())).json()
    assert any(x["table"] == "candidate" and x["field"] == "favourite_tag" for x in rel)
    shown = {x["id"]: x for x in await _links(client, a)}
    assert shown["candidate.favourite_tag"]["used"] == 1


async def test_many_to_many_makes_a_linking_table_with_two_required_links(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    tag = await _tag_table(client, a)
    r = await client.post(
        "/v1/studio/relationships/many-to-many", headers=a.h(), json={"a": "candidate", "b": tag}
    )
    assert r.status_code == 201, r.text
    key = r.json()["table"]
    mine = [x for x in await _links(client, a) if x["table"] == key]
    assert {x["to"] for x in mine} == {"candidate", tag} and all(x["required"] for x in mine)
    same = await client.post(
        "/v1/studio/relationships/many-to-many", headers=a.h(), json={"a": tag, "b": tag}
    )
    assert same.status_code == 422
    await a.publish_live()
    cand = (await a.create_candidate(candidate())).json()
    t = (
        await client.post(f"/v1/records/{tag}", headers=a.h(), json={"data": {"name": "Java"}})
    ).json()
    row = await client.post(
        f"/v1/records/{key}", headers=a.h(), json={"data": {"candidate": cand["id"], tag: t["id"]}}
    )
    assert row.status_code == 201, row.text
    missing = await client.post(
        f"/v1/records/{key}", headers=a.h(), json={"data": {"candidate": cand["id"]}}
    )
    assert missing.status_code == 422


async def test_a_link_can_be_relabelled_but_not_pointed_elsewhere(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    tag = await _tag_table(client, a)
    await client.post(
        "/v1/studio/relationships", headers=a.h(), json={"table": "candidate", "to": tag}
    )
    ok = await client.patch(
        f"/v1/studio/tables/candidate/fields/{tag}",
        headers=a.h(),
        json={"label": "Main tag", "required": True},
    )
    assert ok.status_code == 200 and ok.json()["label"] == "Main tag"
    moved = await client.patch(
        f"/v1/studio/tables/candidate/fields/{tag}", headers=a.h(), json={"ref_table": "client"}
    )
    assert moved.status_code == 422


async def test_remove_only_an_unused_agency_link(client: httpx.AsyncClient, agency: Agency) -> None:
    a = agency
    tag = await _tag_table(client, a)
    await client.post(
        "/v1/studio/relationships", headers=a.h(), json={"table": "candidate", "to": tag}
    )
    await a.publish_live()
    t = (
        await client.post(f"/v1/records/{tag}", headers=a.h(), json={"data": {"name": "Hot"}})
    ).json()
    assert (await a.create_candidate(candidate(**{tag: t["id"]}))).status_code == 201
    used = await client.delete(f"/v1/studio/relationships/candidate/{tag}", headers=a.h())
    assert used.status_code == 422 and used.json()["errors"][0]["code"] == "in_use"
    pack = await client.delete("/v1/studio/relationships/submission/candidate", headers=a.h())
    assert pack.status_code == 422
    fresh = await client.post(
        "/v1/studio/relationships",
        headers=a.h(),
        json={"table": "client", "to": tag, "label": "Segment"},
    )
    assert fresh.status_code == 201
    gone = await client.delete("/v1/studio/relationships/client/segment", headers=a.h())
    assert gone.status_code == 204
    assert "client.segment" not in {x["id"] for x in await _links(client, a)}


async def test_relationships_need_studio_permission(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    r = await client.get("/v1/studio/relationships")
    assert r.status_code in (401, 403)


async def test_table_box_positions_are_remembered_per_workspace(
    client: httpx.AsyncClient, agency: Agency, other_agency: Agency
) -> None:
    a = agency
    assert (await client.get("/v1/studio/layout", headers=a.h())).json() == {"positions": {}}
    r = await client.put(
        "/v1/studio/layout",
        headers=a.h(),
        json={"positions": {"candidate": {"x": 10.26, "y": 20}, "nope": {"x": 1, "y": 1}}},
    )
    assert r.status_code == 200 and r.json()["positions"] == {"candidate": {"x": 10.3, "y": 20.0}}
    again = (await client.get("/v1/studio/layout", headers=a.h())).json()
    assert again["positions"]["candidate"]["x"] == 10.3
    other = (await client.get("/v1/studio/layout", headers=other_agency.h())).json()
    assert other == {"positions": {}}
    bad = await client.put(
        "/v1/studio/layout", headers=a.h(), json={"positions": {"candidate": {"x": "left"}}}
    )
    assert bad.status_code == 422


async def _health(client: httpx.AsyncClient, a: Agency) -> list[dict[str, object]]:
    r = await client.get("/v1/studio/relationships/health", headers=a.h())
    assert r.status_code == 200, r.text
    return r.json()  # type: ignore[no-any-return]


async def test_required_loop_is_refused_in_plain_words(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    tag = await _tag_table(client, a)
    ok = await client.post(
        "/v1/studio/relationships",
        headers=a.h(),
        json={"table": tag, "to": "candidate", "label": "Main person", "required": True},
    )
    assert ok.status_code == 201, ok.text
    loop = await client.post(
        "/v1/studio/relationships",
        headers=a.h(),
        json={"table": "candidate", "to": tag, "label": "Main tag", "required": True},
    )
    assert loop.status_code == 422, loop.text
    err = loop.json()["errors"][0]
    assert err["code"] == "circular_required" and "first" in err["message"]
    optional = await client.post(
        "/v1/studio/relationships",
        headers=a.h(),
        json={"table": "candidate", "to": tag, "label": "Main tag"},
    )
    assert optional.status_code == 201
    flip = await client.patch(
        "/v1/studio/tables/candidate/fields/main_tag", headers=a.h(), json={"required": True}
    )
    assert flip.status_code == 422 and flip.json()["errors"][0]["code"] == "circular_required"


async def test_health_reports_empty_required_self_links_and_repeated_pairs(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    assert not [i for i in await _health(client, a) if i["severity"] != "note"]
    tag = await _tag_table(client, a)
    r = await client.post(
        "/v1/studio/relationships",
        headers=a.h(),
        json={"table": "candidate", "to": tag, "label": "Favourite tag"},
    )
    assert r.status_code == 201
    await a.publish_live()
    assert (await a.create_candidate(candidate())).status_code == 201
    flip = await client.patch(
        "/v1/studio/tables/candidate/fields/favourite_tag", headers=a.h(), json={"required": True}
    )
    assert flip.status_code == 200, flip.text
    issues = await _health(client, a)
    empty = [i for i in issues if i["kind"] == "required_empty"]
    assert empty and "have no Favourite tag" in str(empty[0]["message"])
    selfie = await client.post(
        "/v1/studio/relationships",
        headers=a.h(),
        json={"table": "candidate", "to": "candidate", "label": "Referred by"},
    )
    assert selfie.status_code == 201, selfie.text
    assert any(i["kind"] == "self_link" for i in await _health(client, a))
