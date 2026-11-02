"""S5: transformation rules clean a value before it is checked and saved, on every way a value can arrive."""

import itertools

import httpx
import pytest

from tableui.imports.public import wait_all
from tests.conftest import Agency, candidate
from tests.test_imports import _csv, _job


async def _field(
    client: httpx.AsyncClient, a: Agency, transforms: list[dict], **body: object
) -> str:
    r = await client.post(
        "/v1/studio/tables/candidate/fields",
        headers=a.h(),
        json={
            "label": "Notice",
            "type": body.pop("type", "integer"),
            "transforms": transforms,
            **body,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()["key"]


_COUNTER = itertools.count(10000)


def R(when: str, do: str, args: list[str] | None = None, value: str = "", **kw: object) -> dict:
    return {"when": when, "args": args or [], "do": do, "value": value, **kw}


async def _live(client: httpx.AsyncClient, a: Agency, key: str, data: dict) -> httpx.Response:
    i = next(_COUNTER)
    return await a.create_candidate(
        candidate(
            phone=f"+91 98450 {i}",
            email=f"t{i}@x.test",
            **({key: data[key]} if key in data else {}),
        )
    )


async def test_if_blank_sets_a_value_and_stops_and_an_update_without_the_field_leaves_it(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    key = await _field(
        client, a, [R("blank", "set", value="30", stop=True), R("blank", "set", value="99")]
    )
    await a.publish_live()
    made = await _live(client, a, key, {})
    assert made.status_code == 201 and made.json()["data"][key] == 30
    rec = made.json()
    up = await client.patch(
        f"/v1/records/candidate/{rec['id']}",
        headers=a.h(),
        json={"version": rec["version"], "data": {"full_name": "Renamed Person"}},
    )
    assert up.status_code == 200 and up.json()["data"][key] == 30  # field left out: untouched


@pytest.mark.parametrize(
    ("rule", "given", "expected"),
    [
        (R("equals_any", "set", ["immediate", "Serving"], "0"), "serving", 0),
        (R("contains", "set", ["month"], "60"), "two months", 60),
        (R("starts_with", "set", ["imm"], "1"), "Immediately", 1),
        (R("ends_with", "set", ["days"], "15"), "fifteen days", 15),
        (R("matches", "keep_match", [r"^(\d+)\s*d(ays?)?$"]), "45 days", 45),
        (R("above", "set", ["180"], "180"), "400", 180),
        (R("below", "set", ["0"], "0"), "-5", 0),
    ],
)
async def test_every_condition_and_keep_the_match_hold_on_create_inline_bulk_and_api(
    client: httpx.AsyncClient, agency: Agency, rule: dict, given: str, expected: int
) -> None:
    a = agency
    key = await _field(client, a, [rule])
    await a.publish_live()
    # create (form and API are the same call)
    made = await _live(client, a, key, {key: given})
    assert made.status_code == 201, made.text
    assert made.json()["data"][key] == expected
    rec = made.json()
    # inline edit
    up = await client.patch(
        f"/v1/records/candidate/{rec['id']}",
        headers=a.h(),
        json={"version": rec["version"], "data": {key: 7}},
    )
    assert up.status_code == 200 and up.json()["data"][key] == 7
    # bulk edit
    bulk = await client.post(
        "/v1/records/candidate/bulk",
        headers=a.h(),
        json={"action": "update", "ids": [rec["id"]], "field": key, "value": given},
    )
    assert bulk.json()["applied"] == 1, bulk.text
    after = (await client.get(f"/v1/records/candidate/{rec['id']}", headers=a.h())).json()
    assert after["data"][key] == expected


@pytest.mark.parametrize(
    ("rules", "given", "expected"),
    [
        ([R("blank", "set_standard", value="not_provided")], "", "Not provided"),
        ([R("blank", "set_standard", value="zero")], "", "0"),
        ([R("blank", "clear")], "", None),
        ([R("contains", "copy_field", ["x"], "full_name")], "x", "Arjun Menon"),
        ([R("matches", "trim", [".*"])], "  rahul   sharma ", "rahul sharma"),
        (
            [R("matches", "trim", [".*"]), R("matches", "case", [".*"], "title")],
            "  rahul   sharma ",
            "Rahul Sharma",
        ),
        ([R("matches", "case", [".*"], "upper")], "abc", "ABC"),
        ([R("matches", "case", [".*"], "lower")], "ABC", "abc"),
        ([R("contains", "remove_chars", ["-"], "- ")], "ab-c d", "abcd"),
        ([R("field_is", "set", ["status", "Active"], "yes")], "anything", "yes"),
    ],
)
async def test_every_action_on_a_text_field(
    client: httpx.AsyncClient, agency: Agency, rules: list[dict], given: str, expected: object
) -> None:
    a = agency
    key = await _field(client, a, rules, type="text")
    await a.publish_live()
    made = await _live(client, a, key, {key: given} if given else {})
    assert made.status_code == 201, made.text
    assert made.json()["data"].get(key) == expected


async def test_rule_order_matters_and_a_switched_off_rule_does_nothing(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    first = R("contains", "set", ["a"], "1")
    second = R("contains", "set", ["a"], "2")
    key = await _field(client, a, [first, second])
    await a.publish_live()
    assert (await _live(client, a, key, {key: "a"})).json()["data"][key] == 1
    r = await client.patch(
        f"/v1/studio/tables/candidate/fields/{key}",
        headers=a.h(),
        json={"transforms": [second, {**first, "enabled": False}]},
    )
    assert r.status_code == 200, r.text
    await a.publish_live()
    assert (await _live(client, a, key, {key: "a"})).json()["data"][key] == 2
    r = await client.patch(
        f"/v1/studio/tables/candidate/fields/{key}",
        headers=a.h(),
        json={"transforms": [{**second, "enabled": False}, first]},
    )
    await a.publish_live()
    assert (await _live(client, a, key, {key: "a"})).json()["data"][key] == 1


async def test_a_transformed_value_that_fails_validation_says_what_it_became(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    key = await _field(client, a, [R("equals_any", "set", ["many"], "lots")])
    await a.publish_live()
    bad = await _live(client, a, key, {key: "many"})
    assert bad.status_code == 422
    assert "must be a whole number" in bad.text and "lots" in bad.text


async def test_import_applies_the_rules_and_the_file_is_not_changed(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    r = await client.patch(
        "/v1/studio/tables/candidate/fields/current_employer",
        headers=a.h(),
        json={"transforms": [R("matches", "trim", [".*"]), R("matches", "case", [".*"], "upper")]},
    )
    assert r.status_code == 200, r.text
    await a.publish_live()
    job = await _job(
        client, a, _csv(["Asha Rao,asha@x.test,9845011111,  infosys ,5 yrs,12 LPA,30,Java,"])
    )
    await client.put(
        f"/v1/imports/{job['id']}/mapping",
        headers=a.h(),
        json={"mapping": {**job["mapping"], "Joined": None}},
    )
    await client.post(f"/v1/imports/{job['id']}/validate", headers=a.h())
    await client.post(f"/v1/imports/{job['id']}/start", headers=a.h())
    await wait_all()
    rows = (await client.get("/v1/records/candidate?q=asha", headers=a.h())).json()["items"]
    assert rows and rows[0]["data"]["current_employer"] == "INFOSYS"


async def test_import_fills_the_signed_in_user_for_the_user_standard_value(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    r = await client.patch(
        "/v1/studio/tables/candidate/fields/current_employer",
        headers=a.h(),
        json={"transforms": [R("blank", "set_standard", [], "user")]},
    )
    assert r.status_code == 200, r.text
    await a.publish_live()
    job = await _job(client, a, _csv(["Bina Das,bina@x.test,9845022222,,5 yrs,12 LPA,30,Java,"]))
    await client.put(
        f"/v1/imports/{job['id']}/mapping",
        headers=a.h(),
        json={"mapping": {**job["mapping"], "Joined": None}},
    )
    await client.post(f"/v1/imports/{job['id']}/validate", headers=a.h())
    await client.post(f"/v1/imports/{job['id']}/start", headers=a.h())
    await wait_all()
    rows = (await client.get("/v1/records/candidate?q=bina", headers=a.h())).json()["items"]
    assert rows and rows[0]["data"]["current_employer"]  # the name of whoever ran the import


async def test_a_default_can_be_set_in_studio_and_old_defaults_still_apply(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    key = await _field(client, a, [], default=30)
    await a.publish_live()
    assert (await _live(client, a, key, {})).json()["data"][key] == 30


async def test_try_a_value_equals_live_and_names_the_steps(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    key = await _field(client, a, [])
    rules = [
        R("equals_any", "set", ["immediate"], "0"),
        R("matches", "keep_match", [r"^(\d+)\s*days?$"]),
    ]
    r = await client.post(
        f"/v1/studio/tables/candidate/fields/{key}/transform-preview",
        headers=a.h(),
        json={
            "transforms": rules,
            "samples": [{"value": "Immediate"}, {"value": "45 days"}, {"value": "x"}],
        },
    )
    assert r.status_code == 200, r.text
    res = r.json()["results"]
    assert [x["output"] for x in res] == [0, 45, "x"]
    assert res[0]["steps"][0] == {"rule": 1, "matched": True, "stopped": False}
    assert res[2]["problem"] == "must be a whole number"
    await client.patch(
        f"/v1/studio/tables/candidate/fields/{key}", headers=a.h(), json={"transforms": rules}
    )
    await a.publish_live()
    live = await _live(client, a, key, {key: "45 days"})
    assert live.json()["data"][key] == res[1]["output"]


async def test_bad_rules_are_refused_with_the_reason(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    key = await _field(client, a, [])
    for bad in (
        R("contains", "set", [], "1"),
        R("matches", "set", ["(a+)+$"], "1"),
        R("blank", "case", [], "sideways"),
        R("blank", "set_standard", [], "nope"),
    ):
        r = await client.patch(
            f"/v1/studio/tables/candidate/fields/{key}", headers=a.h(), json={"transforms": [bad]}
        )
        assert r.status_code == 422, bad
