"""Drag to reorder (N5h): one shared order per table, kept apart from the data."""

import uuid

import httpx

from tableui.platform.db import Database
from tableui.platform.mail import InMemoryMailer
from tests.conftest import Agency, candidate
from tests.test_access import _member, _setup


async def _make(a: Agency, n: int) -> list[str]:
    ids = []
    for i in range(n):
        r = await a.create_candidate(
            candidate(full_name=f"P{i}", phone=f"+91 98450 5{i}000", status="Active")
        )
        assert r.status_code == 201, r.text
        ids.append(r.json()["id"])
    return ids


async def _order(client: httpx.AsyncClient, a: Agency) -> list[str]:
    r = await client.get(
        "/v1/records/candidate", headers=a.h(), params={"sort": "manual", "direction": "asc"}
    )
    assert r.status_code == 200, r.text
    return [i["data"]["full_name"] for i in r.json()["items"]]


async def _move(
    client: httpx.AsyncClient, a: Agency, rid: str, before: str | None
) -> httpx.Response:
    return await client.post(
        "/v1/records/candidate/order", headers=a.h(), json={"id": rid, "before": before}
    )


async def test_a_record_moves_before_another_or_to_the_end_and_data_is_untouched(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    ids = await _make(agency, 4)
    start = await _order(client, agency)
    assert sorted(start) == ["P0", "P1", "P2", "P3"]
    by_name = dict(zip(["P0", "P1", "P2", "P3"], ids, strict=True))
    before = (await client.get(f"/v1/records/candidate/{ids[0]}", headers=agency.h())).json()
    r = await _move(client, agency, by_name[start[3]], by_name[start[0]])
    assert r.status_code == 200, r.text
    assert await _order(client, agency) == [start[3], start[0], start[1], start[2]]
    r = await _move(client, agency, by_name[start[3]], None)
    assert await _order(client, agency) == [start[0], start[1], start[2], start[3]]
    after = (await client.get(f"/v1/records/candidate/{ids[0]}", headers=agency.h())).json()
    assert after["version"] == before["version"]  # the order is not a change to the record
    new = await agency.create_candidate(candidate(full_name="Newest", phone="+91 98450 59999"))
    shown = await _order(client, agency)
    assert shown[0] == "Newest"  # never placed: on top, like any new record
    r = await _move(client, agency, by_name[start[0]], None)  # a move keeps what the list showed
    assert r.status_code == 200
    assert await _order(client, agency) == [n for n in shown if n != start[0]] + [start[0]]
    bad = await _move(client, agency, ids[0], ids[0])
    assert bad.status_code == 422
    gone = await _move(client, agency, str(uuid.uuid4()), None)
    assert gone.status_code == 404
    assert new.status_code == 201


async def test_many_moves_into_the_same_gap_keep_the_order_correct(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    ids = await _make(agency, 3)
    first = await _order(client, agency)
    by_name = {n: i for n, i in zip(["P0", "P1", "P2"], ids, strict=True)}
    a, x, y = (by_name[n] for n in first)
    for _ in range(45):  # each move halves the gap next to the first record
        assert (await _move(client, agency, y, x)).status_code == 200
        assert (await _move(client, agency, x, y)).status_code == 200
    now = await _order(client, agency)
    assert now[0] == first[0] and now[1:] == [first[1], first[2]]
    assert a and now


async def test_switch_permission_and_scope_are_enforced(
    client: httpx.AsyncClient, db: Database, mailer: InMemoryMailer
) -> None:
    boss = Agency(client, "Order Co", f"o-{uuid.uuid4().hex[:8]}@order.test")
    await boss.sign_up("recruitment")
    await _setup(
        db, boss.tenant_id,
        "INSERT INTO control.tenant_role_scope (tenant_id, role_key, table_key, scope) "
        "VALUES (:t, 'recruiter', 'candidate', 'own') "
        "ON CONFLICT (tenant_id, role_key, table_key) DO UPDATE SET scope = 'own'",
    )  # fmt: skip
    rec = await _member(client, boss, mailer, "recruiter")
    theirs = await _make(boss, 2)
    mine = (
        await rec.create_candidate(candidate(full_name="Mine", phone="+91 91111 22222"))
    ).json()["id"]
    assert (await _move(client, rec, theirs[0], mine)).status_code == 404  # not visible to them
    assert (await _move(client, rec, mine, None)).status_code == 200
    viewer = await _member(client, boss, mailer, "viewer")
    assert (await _move(client, viewer, theirs[0], None)).status_code == 403
    await client.put(
        "/v1/studio/tables/candidate/features", headers=boss.h(), json={"row_order": False}
    )
    await boss.publish_live()
    assert (await _move(client, boss, theirs[0], theirs[1])).status_code == 403


async def test_ten_thousand_records_list_stats_and_move_stay_quick(
    client: httpx.AsyncClient, db: Database, agency: Agency
) -> None:
    import json
    import time

    from sqlalchemy import text

    me = (await client.get("/v1/me", headers=agency.h())).json()
    tenant = uuid.UUID(agency.tenant_id)
    async with db.tenant(tenant) as s:
        await s.execute(
            text(
                "INSERT INTO candidate (id, tenant_id, data, owner_id, created_by, updated_by, search_doc) "
                "SELECT gen_random_uuid(), :t, jsonb_build_object('full_name', 'Bulk ' || g, 'status', 'Active', "
                "'total_experience', g % 120), :u, :u, :u, 'bulk ' || g FROM generate_series(1, 10000) g"
            ),
            {"t": tenant, "u": uuid.UUID(me["user_id"] if "user_id" in me else me["id"])},
        )
    t0 = time.perf_counter()
    page = await client.get(
        "/v1/records/candidate",
        headers=agency.h(),
        params={"sort": "manual", "direction": "asc", "limit": 50},
    )
    t_list = time.perf_counter() - t0
    items = page.json()["items"]
    assert len(items) == 50 and page.json()["next_cursor"]
    t0 = time.perf_counter()
    st = await client.get(
        "/v1/records/candidate/stats", headers=agency.h(), params={"fields": "total_experience"}
    )
    t_stats = time.perf_counter() - t0
    assert st.json()["total"] == 10000
    t0 = time.perf_counter()
    mv = await _move(
        client, agency, items[10]["id"], items[0]["id"]
    )  # first move numbers every record
    t_move = time.perf_counter() - t0
    assert mv.status_code == 200, mv.text
    t0 = time.perf_counter()
    mv2 = await _move(client, agency, items[20]["id"], items[1]["id"])
    t_move2 = time.perf_counter() - t0
    assert mv2.status_code == 200
    again = await client.get(
        "/v1/records/candidate",
        headers=agency.h(),
        params={"sort": "manual", "direction": "asc", "limit": 3},
    )
    assert again.json()["items"][0]["id"] == items[10]["id"]
    print(
        json.dumps({"list": t_list, "stats": t_stats, "first_move": t_move, "next_move": t_move2})
    )
    assert t_list < 2 and t_stats < 2 and t_move < 5 and t_move2 < 2
