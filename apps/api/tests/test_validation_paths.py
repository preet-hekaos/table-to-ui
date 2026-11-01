"""S3: one rule, set in Studio, holds on every way a value can arrive (form/API, inline, bulk, import)."""

import httpx

from tableui.imports.public import wait_all
from tests.conftest import Agency, candidate
from tests.test_imports import _csv, _job

PAN = "^[A-Z]{5}[0-9]{4}[A-Z]$"
MSG = "Enter a PAN like ABCDE1234F."


async def _publish_rule(
    client: httpx.AsyncClient, a: Agency, message: str = MSG, field: str = "current_employer"
) -> None:
    r = await client.patch(
        f"/v1/studio/tables/candidate/fields/{field}",
        headers=a.h(),
        json={"rules": [{"name": "PAN", "pattern": PAN, "message": message}]},
    )
    assert r.status_code == 200, r.text
    await a.publish_live()


def _messages(r: httpx.Response) -> list[str]:
    return [e["message"] for e in r.json().get("errors", [])]


async def test_a_published_rule_holds_on_create_edit_and_bulk(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    ok = (await a.create_candidate(candidate(current_employer="ABCDE1234F"))).json()
    await _publish_rule(client, a)
    bad = await a.create_candidate(candidate(current_employer="nope"))
    assert bad.status_code == 422 and MSG in _messages(bad)
    inline = await client.patch(
        f"/v1/records/candidate/{ok['id']}",
        headers=a.h(),
        json={"version": ok["version"], "data": {"current_employer": "nope"}},
    )
    assert inline.status_code == 422 and MSG in _messages(inline)
    bulk = await client.post(
        "/v1/records/candidate/bulk",
        headers=a.h(),
        json={
            "action": "update", "ids": [ok["id"]], "field": "current_employer", "value": "nope",
        },
    )  # fmt: skip
    assert bulk.status_code == 200 and bulk.json()["applied"] == 0
    assert MSG in bulk.text  # each refused row carries the rule's message
    still = (await client.get(f"/v1/records/candidate/{ok['id']}", headers=a.h())).json()
    assert still["data"]["current_employer"] == "ABCDE1234F"


async def test_import_lists_the_rows_that_break_the_rule_with_the_message(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    await _publish_rule(client, a)
    rows = [
        f"P{i},p{i}@gmail.com,98450110{i:02d},{'ABCDE1234F' if i < 3 else 'bad'},1 yr,5 LPA,0,Go,"
        for i in range(8)
    ]
    job = await _job(client, a, _csv(rows))
    await client.put(
        f"/v1/imports/{job['id']}/mapping",
        headers=a.h(),
        json={"mapping": {**job["mapping"], "Joined": None}},
    )
    r = await client.post(f"/v1/imports/{job['id']}/validate", headers=a.h())
    await wait_all()
    rep = r.json()["report"]
    assert rep["rows"] == 8 and rep["invalid"] == 5 and rep["valid"] == 3
    assert any(MSG in k for k in rep["by_reason"]), rep["by_reason"]
    errs = (await client.get(f"/v1/imports/{job['id']}/errors.csv", headers=a.h())).text
    assert errs.count(MSG) == 5


async def test_editing_the_message_changes_it_everywhere(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    await _publish_rule(client, a)
    new = "That is not a PAN."
    await _publish_rule(client, a, message=new)
    bad = await a.create_candidate(candidate(current_employer="nope"))
    assert new in _messages(bad) and MSG not in _messages(bad)
    form = await client.post(
        "/v1/records/candidate/validate-field",
        headers=a.h(),
        json={"field": "current_employer", "value": "nope"},
    )
    assert form.json()["message"] == new


async def test_every_library_rule_is_enforced_on_a_live_record(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    lib = (await client.get("/v1/studio/validation-library", headers=a.h())).json()
    for item in lib:
        if item["kind"] == "not_future":
            continue  # date rule: covered by its own test
        r = await client.post(
            "/v1/studio/tables/candidate/fields",
            headers=a.h(),
            json={"label": f"L {item['key']}", "type": "text",
                  "rules": [{"name": item["key"], "kind": item["kind"], "pattern": item["pattern"], "message": "m-" + item["key"]}]},
        )  # fmt: skip
        assert r.status_code == 201, r.text
    await a.publish_live()
    for item in lib:
        if item["kind"] == "not_future":
            continue
        key = "l_" + item["key"]
        for values, ok in ((item["good"], True), (item["bad"], False)):
            for v in values:
                res = await client.post(
                    "/v1/records/candidate/validate-field",
                    headers=a.h(),
                    json={"field": key, "value": v},
                )
                assert res.status_code == 200, res.text
                assert (res.json()["message"] is None) is ok, (item["key"], v)
