"""Stage colour coding (N1): which of Draft, Test or Live each item is in."""

from typing import Any

import httpx

from tableui.metadata.domain.stages import item_stages, stage_of
from tests.conftest import Agency


def _manifest(label: str = "Name", extra: bool = False) -> dict[str, Any]:
    fields = [{"key": "name", "label": label, "type": "text"}]
    if extra:
        fields.append({"key": "city", "label": "City", "type": "text"})
    return {
        "tables": {"person": {"definition": {"key": "person", "fields": fields}}},
        "screens": {},
        "navs": {},
        "rules": {},
        "measures": {},
        "automations": {},
    }


def test_stage_of_covers_every_combination() -> None:
    assert stage_of({"a": 1}, {"a": 1}, {"a": 1}) == "live"
    assert stage_of({"a": 1}, {"a": 1}, {"a": 0}) == "test"
    assert stage_of({"a": 2}, {"a": 1}, {"a": 0}) == "draft"
    assert stage_of({"a": 1}, None, None) == "draft"
    assert stage_of(None, {"a": 1}, {"a": 1}) == "removed"
    assert stage_of({"a": 1}, None, {"a": 1}) == "live"


def test_nothing_published_means_everything_is_draft_and_new() -> None:
    r = item_stages(_manifest(), None, None)
    assert r["items"]["tables"]["person"] == {
        "stage": "draft",
        "is_new": True,
        "fields": {"name": "draft"},
        "removed_fields": [],
    }
    assert r["counts"]["draft"] == 1


def test_a_changed_field_makes_its_table_draft_but_other_fields_stay_live() -> None:
    live = _manifest(extra=True)
    draft = _manifest(label="Full name", extra=True)
    r = item_stages(draft, live, live)
    t = r["items"]["tables"]["person"]
    assert t["stage"] == "draft" and t["is_new"] is False
    assert t["fields"] == {"name": "draft", "city": "live"}


def test_item_in_test_but_not_live_is_test_and_a_deleted_one_is_removed() -> None:
    live = _manifest()
    test = _manifest(extra=True)
    r = item_stages(test, test, live)
    assert r["items"]["tables"]["person"]["fields"] == {"name": "live", "city": "test"}
    gone = item_stages(_manifest(), test, test)["items"]["tables"]["person"]
    assert gone["fields"] == {"name": "live", "city": "removed"}
    assert gone["removed_fields"] == [{"key": "city", "label": "City"}]
    # A removed table keeps its name so it can still be listed
    no_tables = {k: {} for k in _manifest()}
    assert item_stages(no_tables, _manifest(), _manifest())["items"]["tables"]["person"] == {
        "stage": "removed",
        "label": "person",
        "fields": {},
    }


async def test_endpoint_follows_a_field_from_draft_to_test_to_live(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    await a.publish_live()
    base = (await client.get("/v1/studio/stages", headers=a.h())).json()
    assert base["items"]["tables"]["candidate"]["stage"] == "live"

    r = await client.post(
        "/v1/studio/tables/candidate/fields",
        headers=a.h(),
        json={"label": "Preferred shift", "type": "select", "options": ["Day", "Night"]},
    )
    assert r.status_code == 201, r.text
    s = (await client.get("/v1/studio/stages", headers=a.h())).json()
    cand = s["items"]["tables"]["candidate"]
    assert cand["stage"] == "draft" and cand["fields"]["preferred_shift"] == "draft"
    assert cand["fields"]["current_employer"] == "live"

    r = await client.post("/v1/apps/current/releases", headers=a.h())
    v = r.json()["version"]
    assert r.status_code == 201
    s = (await client.get("/v1/studio/stages", headers=a.h())).json()
    assert s["items"]["tables"]["candidate"]["fields"]["preferred_shift"] == "test"
    assert s["test_version"] == v and s["items"]["tables"]["candidate"]["stage"] == "test"
    r = await client.post(f"/v1/apps/current/releases/{v}/promote", headers=a.h())
    assert r.status_code == 200, r.text
    s = (await client.get("/v1/studio/stages", headers=a.h())).json()
    assert s["items"]["tables"]["candidate"]["fields"]["preferred_shift"] == "live"
    assert s["live_version"] == v


async def test_stages_need_read_permission(client: httpx.AsyncClient) -> None:
    r = await client.get("/v1/studio/stages")
    assert r.status_code in (401, 403)
