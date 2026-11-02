"""S6: the publish review names every new kind of change, and reverting a release restores the stored definition."""

import httpx

from tests.conftest import Agency, candidate


async def _patch(client: httpx.AsyncClient, a: Agency, key: str, **body: object) -> None:
    r = await client.patch(f"/v1/studio/tables/candidate/fields/{key}", headers=a.h(), json=body)
    assert r.status_code == 200, r.text


async def _status(client: httpx.AsyncClient, a: Agency) -> dict:
    return (await client.get("/v1/studio/status", headers=a.h())).json()


async def test_the_review_lists_label_length_rules_transformations_features_group_and_order(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    await _patch(client, a, "current_title", label="Job title", max_length=60, group="profile")
    await _patch(
        client,
        a,
        "location",
        transforms=[{"when": "blank", "do": "set", "value": "Remote", "stop": True}],
        rules=[{"name": "Letters", "kind": "pattern", "pattern": "^[A-Za-z ]+$", "message": "No"}],
    )
    await client.put(
        "/v1/studio/tables/candidate/features", headers=a.h(), json={"density": "comfortable"}
    )
    tables = (await client.get("/v1/studio/tables", headers=a.h())).json()
    order = [f["key"] for f in next(t for t in tables if t["key"] == "candidate")["fields"]]
    order.insert(0, order.pop())
    r = await client.put(
        "/v1/studio/tables/candidate/field-order", headers=a.h(), json={"order": order}
    )
    assert r.status_code == 200, r.text
    change = next(
        c for c in (await _status(client, a))["changes"]["tables"] if c["key"] == "candidate"
    )
    by = {f["field"]: f for f in change["fields"]}
    assert set(by["current_title"]["attributes"]) >= {"label", "max_length", "group"}
    assert set(by["location"]["attributes"]) >= {"rules", "transforms"}
    assert "features" in change["attributes"] and "field order" in change["attributes"]


async def test_reverting_a_release_restores_rules_transformations_and_labels(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    await _patch(
        client,
        a,
        "current_employer",
        label="Employer",
        transforms=[{"when": "blank", "do": "set", "value": "Not given", "stop": True}],
        max_length=12,
    )
    await a.publish_live()
    long_name = candidate(
        current_employer="Infosys Technologies", phone="+91 98450 70001", email="rv1@x.test"
    )
    assert (await a.create_candidate(long_name)).status_code == 422  # the new length is live
    blank = candidate(current_employer=None, phone="+91 98450 70002", email="rv2@x.test")
    made = await a.create_candidate(blank)
    assert made.status_code == 201 and made.json()["data"]["current_employer"] == "Not given"
    assert (await client.post("/v1/apps/current/rollback", headers=a.h())).status_code == 200
    again = await a.create_candidate(
        candidate(
            current_employer="Infosys Technologies", phone="+91 98450 70003", email="rv3@x.test"
        )
    )
    assert again.status_code == 201  # the old behaviour is back
    empty = await a.create_candidate(
        candidate(current_employer=None, phone="+91 98450 70004", email="rv4@x.test")
    )
    assert empty.status_code == 201 and empty.json()["data"].get("current_employer") in (None, "")
    assert (await client.post("/v1/apps/current/rollback", headers=a.h())).status_code == 200
    forward = await a.create_candidate(
        candidate(current_employer=None, phone="+91 98450 70005", email="rv5@x.test")
    )
    assert forward.json()["data"]["current_employer"] == "Not given"
