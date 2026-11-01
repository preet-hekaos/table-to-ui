"""S0 audit: what a setting does once published, checked through the real API.

Tests without a mark pass today and stay as regression guards. Tests marked `xfail(strict=True)` state the
behaviour the redesign promises and fail today; when a stage fixes one, the strict mark turns the run red until
the mark and the matching register entry are removed. Each reason names the stage that closes the gap.
"""

import httpx
import pytest

from tests.conftest import Agency, candidate


async def _add(client: httpx.AsyncClient, a: Agency, **body: object) -> dict:
    r = await client.post("/v1/studio/tables/candidate/fields", headers=a.h(), json=body)
    assert r.status_code == 201, r.text
    return r.json()


async def _patch(client: httpx.AsyncClient, a: Agency, key: str, **body: object) -> httpx.Response:
    return await client.patch(f"/v1/studio/tables/candidate/fields/{key}", headers=a.h(), json=body)


async def test_a_length_set_in_studio_stops_longer_text_after_publish(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    f = await _add(client, a, label="Badge", type="text")
    assert (await _patch(client, a, f["key"], max_length=5)).status_code == 200
    await a.publish_live()
    ok = await a.create_candidate(
        candidate(badge="ABCDE", phone="+91 98450 10001", email="l1@x.test")
    )
    assert ok.status_code == 201, ok.text
    long = await a.create_candidate(
        candidate(badge="ABCDEF", phone="+91 98450 10002", email="l2@x.test")
    )
    assert long.status_code == 422


async def test_a_length_set_in_studio_stops_longer_web_addresses_too(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    f = await _add(client, a, label="Site", type="url")
    assert (await _patch(client, a, f["key"], max_length=20)).status_code == 200
    await a.publish_live()
    long = await a.create_candidate(
        candidate(
            site="https://example.com/a/very/long/path", phone="+91 98450 10003", email="l3@x.test"
        )
    )
    assert long.status_code == 422


async def test_a_minimum_set_in_studio_stops_smaller_decimals(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    f = await _add(client, a, label="Rating", type="decimal")
    assert (await _patch(client, a, f["key"], min=1.5)).status_code == 200
    await a.publish_live()
    low = await a.create_candidate(
        candidate(rating=1.2, phone="+91 98450 10005", email="l5@x.test")
    )
    assert low.status_code == 422
    ok = await a.create_candidate(candidate(rating=1.5, phone="+91 98450 10006", email="l6@x.test"))
    assert ok.status_code == 201, ok.text


async def test_a_maximum_set_in_studio_stops_larger_decimals(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    f = await _add(client, a, label="Rating", type="decimal")
    assert (await _patch(client, a, f["key"], max=5)).status_code == 200
    await a.publish_live()
    big = await a.create_candidate(
        candidate(rating=9.5, phone="+91 98450 10004", email="l4@x.test")
    )
    assert big.status_code == 422


@pytest.mark.xfail(
    strict=True,
    reason="S5: a default can only come from a pack; Studio cannot set one and it applies on create only",
)
async def test_a_default_can_be_set_in_studio(client: httpx.AsyncClient, agency: Agency) -> None:
    a = agency
    r = await client.post(
        "/v1/studio/tables/candidate/fields",
        headers=a.h(),
        json={"label": "Notice", "type": "integer", "default": 30},
    )
    assert r.status_code == 201 and r.json()["default"] == 30


@pytest.mark.parametrize("setting", ["unique", "searchable", "filterable"])
async def test_unique_searchable_and_filterable_can_be_changed_after_the_field_exists(
    client: httpx.AsyncClient, agency: Agency, setting: str
) -> None:
    a = agency
    f = await _add(client, a, label="Code", type="text")
    r = await _patch(client, a, f["key"], **{setting: setting != "filterable"})
    assert r.status_code == 200, r.text


async def test_a_new_text_field_is_found_by_keyword_search_after_publish(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    """Guard. The switch-later scenario (an old record found after the switch) is in test_field_switches.py."""
    a = agency
    await _add(client, a, label="Nickname", type="text")
    await a.publish_live()
    assert (
        await a.create_candidate(
            candidate(nickname="zebracorn", phone="+91 98450 10005", email="l5@x.test")
        )
    ).status_code == 201
    hit = (
        await client.get("/v1/records/candidate", headers=a.h(), params={"q": "zebracorn"})
    ).json()["items"]
    assert len(hit) == 1


async def test_a_label_already_used_by_another_field_is_refused(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    f = await _add(client, a, label="Badge", type="text")
    clash = await _patch(client, a, f["key"], label="full name")
    assert clash.status_code == 422 and "already called" in clash.text, clash.text
    ok = await _patch(client, a, f["key"], label="Badge number")
    assert ok.status_code == 200


async def test_a_pack_field_can_be_made_required_and_optional_again(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    base = "/v1/studio/tables/candidate/fields/current_employer"
    on = await client.patch(base, headers=a.h(), json={"required": True})
    assert on.status_code == 200 and on.json()["required"] is True, on.text
    off = await client.patch(base, headers=a.h(), json={"required": False})
    assert off.status_code == 200 and off.json()["required"] is False


async def test_field_order_saved_in_studio_is_the_order_the_live_table_lists_fields(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    draft = (await client.get("/v1/studio/tables", headers=a.h())).json()
    keys = [f["key"] for f in next(t for t in draft if t["key"] == "candidate")["fields"]]
    wanted = [keys[1], keys[0], *keys[2:]]
    put = await client.put(
        "/v1/studio/tables/candidate/field-order", headers=a.h(), json={"order": wanted}
    )
    assert put.status_code == 200, put.text
    bad = await client.put(
        "/v1/studio/tables/candidate/field-order", headers=a.h(), json={"order": keys[1:]}
    )
    assert bad.status_code == 422 and bad.json()["errors"][0]["code"] == "bad_order"
    await a.publish_live()
    live = (await client.get("/v1/app/tables/candidate", headers=a.h())).json()["table"]
    assert [f["key"] for f in live["fields"]] == wanted


async def test_a_pan_type_chosen_in_studio_saves_capitals_and_stops_longer_values_after_publish(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    r = await client.post(
        "/v1/studio/tables/candidate/fields",
        headers=a.h(),
        json={"label": "PAN", "preset": "pan_in"},
    )
    assert r.status_code == 201, r.text
    await a.publish_live()
    ok = await a.create_candidate(
        candidate(pan="abcde1234f", phone="+91 98450 10006", email="p1@x.test")
    )
    assert ok.status_code == 201, ok.text
    assert ok.json()["data"]["pan"] == "ABCDE1234F"
    long = await a.create_candidate(
        candidate(pan="ABCDE1234FG", phone="+91 98450 10007", email="p2@x.test")
    )
    assert long.status_code == 422
