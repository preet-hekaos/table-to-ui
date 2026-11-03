"""Archive instead of delete: take out, list, restore, delete for good, and the auto-delete clock."""

import httpx
from sqlalchemy import text

from tableui.platform.db import Database
from tableui.platform.mail import InMemoryMailer
from tests.conftest import Agency, candidate
from tests.test_workspace_admin import _team_mate

FIELDS = "/v1/studio/tables/candidate/fields"


async def _add_field(client: httpx.AsyncClient, a: Agency, label: str = "Preferred shift") -> str:
    r = await client.post(FIELDS, headers=a.h(), json={"label": label, "type": "text"})
    assert r.status_code == 201, r.text
    return str(r.json()["key"])


async def _field_keys(client: httpx.AsyncClient, a: Agency) -> list[str]:
    tables = (await client.get("/v1/studio/tables", headers=a.h())).json()
    t = next(x for x in tables if x["key"] == "candidate")
    return [f["key"] for f in (t.get("definition") or t)["fields"]]


async def test_archive_a_field_hides_it_and_restore_puts_it_back_in_place(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    key = await _add_field(client, a)
    before = await _field_keys(client, a)
    imp = await client.get(
        "/v1/archive/impact",
        headers=a.h(),
        params={"kind": "field", "table": "candidate", "key": key},
    )
    assert imp.status_code == 200, imp.text
    assert imp.json()["blockers"] == [] and imp.json()["days"] == 30 and imp.json()["delete_on"]

    r = await client.post(
        "/v1/archive", headers=a.h(), json={"kind": "field", "table": "candidate", "key": key}
    )
    assert r.status_code == 201, r.text
    item = r.json()
    assert item["label"] == "Preferred shift" and item["detail"].startswith("Field on")
    assert key not in await _field_keys(client, a)

    listing = (await client.get("/v1/archive", headers=a.h())).json()
    assert [i["id"] for i in listing["items"]] == [item["id"]]
    assert listing["setting"]["days"] == 30
    assert (await client.get("/v1/archive/count", headers=a.h())).json() == {"count": 1}

    r = await client.post("/v1/archive/restore", headers=a.h(), json={"ids": [item["id"]]})
    assert r.json()["restored"] == [item["id"]] and r.json()["failed"] == []
    assert await _field_keys(client, a) == before
    assert (await client.get("/v1/archive", headers=a.h())).json()["items"] == []


async def test_name_field_and_pack_measures_cannot_be_archived(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    r = await client.post(
        "/v1/archive",
        headers=a.h(),
        json={"kind": "field", "table": "candidate", "key": "full_name"},
    )
    assert r.status_code == 422 and "name field" in r.text
    meas = (await client.get("/v1/studio/measures", headers=a.h())).json()
    pack = next(m for m in meas if m.get("source") == "pack")
    r = await client.post(
        "/v1/archive", headers=a.h(), json={"kind": "measure", "key": pack["key"]}
    )
    assert r.status_code == 422 and "pack" in r.text


async def test_measure_and_automation_round_trip(client: httpx.AsyncClient, agency: Agency) -> None:
    a = agency
    meas = (await client.get("/v1/studio/measures", headers=a.h())).json()
    body = {"label": "Everyone", "table": "candidate", "aggregate": "count"}
    made = await client.post("/v1/studio/measures", headers=a.h(), json=body)
    assert made.status_code in (200, 201), made.text
    key = made.json()["key"]
    r = await client.post("/v1/archive", headers=a.h(), json={"kind": "measure", "key": key})
    assert r.status_code == 201, r.text
    now = (await client.get("/v1/studio/measures", headers=a.h())).json()
    assert key not in {m["key"] for m in now} and len(now) == len(meas)
    r = await client.post("/v1/archive/restore", headers=a.h(), json={"ids": [r.json()["id"]]})
    assert r.json()["failed"] == []
    assert key in {
        m["key"] for m in (await client.get("/v1/studio/measures", headers=a.h())).json()
    }


async def test_delete_forever_removes_it_for_good_and_strips_the_values(
    client: httpx.AsyncClient, agency: Agency, db: Database
) -> None:
    a = agency
    key = await _add_field(client, a, "Shoe size")
    await a.publish_live()
    r = await a.create_candidate(candidate(full_name="Ann", phone="+91 98450 11111", **{key: "9"}))
    assert r.status_code == 201, r.text
    r = await client.post(
        "/v1/archive", headers=a.h(), json={"kind": "field", "table": "candidate", "key": key}
    )
    item = r.json()
    await a.publish_live()  # Live no longer shows it, so its values may be removed
    r = await client.post("/v1/archive/delete", headers=a.h(), json={"ids": [item["id"]]})
    assert r.status_code == 200 and r.json() == {"deleted": 1}
    assert (await client.get("/v1/archive", headers=a.h())).json()["items"] == []
    again = await client.post("/v1/archive/restore", headers=a.h(), json={"ids": [item["id"]]})
    assert again.json()["restored"] == [] and again.json()["failed"][0]["message"]
    async with db.control() as s:
        n = (
            await s.execute(
                text(
                    f'SELECT count(*) FROM "t_{a.tenant_id.replace("-", "")}".candidate WHERE data ? :k'  # noqa: S608 - the schema name comes from a tenant id
                ),
                {"k": key},
            )
        ).scalar_one()
    assert n == 0


async def test_clock_deletes_old_items_and_a_new_setting_moves_the_date(
    client: httpx.AsyncClient, agency: Agency, db: Database
) -> None:
    import uuid

    from tableui.archive.public import sweep

    a = agency
    key = await _add_field(client, a)
    item = (
        await client.post(
            "/v1/archive", headers=a.h(), json={"kind": "field", "table": "candidate", "key": key}
        )
    ).json()
    r = await client.put("/v1/archive/settings", headers=a.h(), json={"days": 14, "warn_days": 5})
    assert r.status_code == 200 and (r.json()["days"], r.json()["warn_days"]) == (14, 5)
    bad = await client.put("/v1/archive/settings", headers=a.h(), json={"days": 11})
    assert bad.status_code == 422
    async with db.control() as s:
        await s.execute(
            text(
                "UPDATE control.archive_item SET archived_at = now() - interval '20 days' WHERE id = CAST(:i AS uuid)"
            ),
            {"i": item["id"]},
        )
    # Shortening so that something is due now asks first.
    ask = await client.put("/v1/archive/settings", headers=a.h(), json={"days": 7})
    assert (
        ask.status_code == 422
        and ask.json()["errors"][0]["code"] == "confirm"
        and ask.json()["errors"][0]["count"] == 1
    )
    ok = await client.put("/v1/archive/settings", headers=a.h(), json={"days": 7, "confirm": True})
    assert ok.status_code == 200
    assert await sweep(db, uuid.UUID(a.tenant_id)) == 1
    assert (await client.get("/v1/archive", headers=a.h())).json()["items"] == []


async def test_never_setting_keeps_things_and_records_round_trip(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    r = await client.put("/v1/archive/settings", headers=a.h(), json={"auto_delete": False})
    assert r.json()["auto_delete"] is False
    rec = (await a.create_candidate(candidate(full_name="Rahul", phone="+91 98450 22222"))).json()
    rid = rec["id"]
    r = await client.post(
        "/v1/archive/records", headers=a.h(), json={"table": "candidate", "ids": [rid]}
    )
    assert r.status_code == 201 and r.json()["archived"] == 1, r.text
    got = await client.get(f"/v1/records/candidate/{rid}", headers=a.h())
    assert got.status_code == 404
    item = (await client.get("/v1/archive", headers=a.h())).json()["items"][0]
    assert item["kind"] == "record" and item["label"] == "Rahul" and item["delete_after"] is None
    r = await client.post("/v1/archive/restore", headers=a.h(), json={"ids": [item["id"]]})
    assert r.json()["failed"] == [], r.text
    assert (await client.get(f"/v1/records/candidate/{rid}", headers=a.h())).status_code == 200


async def test_only_admins_see_or_use_the_archive(
    client: httpx.AsyncClient, agency: Agency, mailer: InMemoryMailer
) -> None:
    a = agency
    mate, _ = await _team_mate(client, a, mailer, "recruiter")
    assert (await client.get("/v1/archive", headers=mate.h())).status_code == 403
    assert (
        await client.post(
            "/v1/archive",
            headers=mate.h(),
            json={"kind": "field", "table": "candidate", "key": "location"},
        )
    ).status_code == 403
    assert (
        await client.put("/v1/archive/settings", headers=mate.h(), json={"days": 7})
    ).status_code == 403
