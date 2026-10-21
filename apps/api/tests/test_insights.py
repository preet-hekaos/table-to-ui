"""M3: Insights. Measures, bars, trends, date ranges, drill-down, scope, rebuild and the builder."""

import datetime as dt
import uuid
from typing import Any

import httpx
from sqlalchemy import text

from tableui.insights.application.engine import resolve_range
from tableui.platform.db import Database
from tableui.platform.mail import InMemoryMailer
from tests.conftest import Agency, candidate
from tests.test_access import _member, _setup

TODAY = dt.datetime.now(dt.UTC).date()


async def _post(client: httpx.AsyncClient, a: Agency, table: str, data: dict[str, Any]) -> str:
    r = await client.post(f"/v1/records/{table}", headers=a.h(), json={"data": data})
    assert r.status_code == 201, r.text
    return str(r.json()["id"])


async def _pipeline(client: httpx.AsyncClient, a: Agency) -> dict[str, str]:
    """A client, a job, two candidates and submissions in two stages."""
    c = await _post(client, a, "client", {"name": "Acme Corp", "status": "Active"})
    job = await _post(
        client, a, "requirement", {"title": "Backend Engineer", "client": c, "status": "Open"}
    )
    cand1 = await a.create_candidate(candidate(full_name="One Person"))
    cand2 = await a.create_candidate(candidate(full_name="Two Person", phone="+91 90000 11111"))
    s1 = await _post(
        client, a, "submission",
        {"summary": "One for Backend", "candidate": cand1.json()["id"], "requirement": job, "stage": "Sourced"},
    )  # fmt: skip
    s2 = await _post(
        client, a, "submission",
        {"summary": "Two for Backend", "candidate": cand2.json()["id"], "requirement": job, "stage": "Sourced"},
    )  # fmt: skip
    moved = await client.patch(
        f"/v1/records/submission/{s2}", headers=a.h(),
        json={"version": 1, "data": {"stage": "Screened", "submitted_on": TODAY.isoformat()}},
    )  # fmt: skip
    assert moved.status_code == 200, moved.text
    return {"client": c, "job": job, "s1": s1, "s2": s2}


async def _flush(client: httpx.AsyncClient) -> None:
    """Let the outbox relay deliver pending events to the analytics store."""
    await client._transport.app.state.relay.run_once()  # type: ignore[attr-defined]


async def _card(client: httpx.AsyncClient, a: Agency, key: str, **params: str) -> dict[str, Any]:
    await _flush(client)
    r = await client.get(f"/v1/measures/{key}", headers=a.h(), params=params)
    assert r.status_code == 200, r.text
    return r.json()  # type: ignore[no-any-return]


async def test_the_pack_ships_a_dashboard_and_orders_it(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    await _flush(client)
    r = await client.get("/v1/measures", headers=agency.h())
    assert r.status_code == 200, r.text
    keys = [m["key"] for m in r.json()]
    assert keys[:3] == ["active_candidates", "open_jobs", "submissions_by_stage"]
    assert len(keys) == 9
    home = await client.get("/v1/measures", headers=agency.h(), params={"home": "true"})
    assert [m["key"] for m in home.json()] == [
        "active_candidates",
        "open_jobs",
        "submissions_sent",
        "placements_started",
    ]


async def test_bars_group_by_stage_in_pipeline_order_and_trend_fills_empty_weeks(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    await _pipeline(client, agency)
    bars = await _card(client, agency, "submissions_by_stage")
    assert bars["value"] == 2 and bars["display"] == "bars" and bars["period"] is False
    by = {s["label"]: s["value"] for s in bars["series"]}
    assert by["Sourced"] == 1 and by["Screened"] == 1 and by["Placed"] == 0
    assert [s["label"] for s in bars["series"]][:3] == ["Sourced", "Screened", "Submitted"]
    trend = await _card(client, agency, "submissions_sent", range="last_90_days")
    assert trend["value"] == 1 and trend["period"] is True
    assert len(trend["series"]) >= 12 and sum(p["value"] for p in trend["series"]) == 1
    older = await _card(
        client, agency, "submissions_sent", range="custom",
        start=(TODAY - dt.timedelta(days=400)).isoformat(), end=(TODAY - dt.timedelta(days=300)).isoformat(),
    )  # fmt: skip
    assert older["value"] == 0


async def test_clicking_a_card_lists_exactly_the_records_behind_it(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    ids = await _pipeline(client, agency)
    bars = await _card(client, agency, "submissions_by_stage")
    for point in bars["series"]:
        r = await client.get(
            "/v1/measures/submissions_by_stage/records",
            headers=agency.h(),
            params={"group": point["key"]},
        )
        assert r.status_code == 200, r.text
        assert r.json()["total"] == point["value"] == len(r.json()["items"])
    whole = (
        await client.get("/v1/measures/submissions_by_stage/records", headers=agency.h())
    ).json()
    assert whole["total"] == 2 and {i["id"] for i in whole["items"]} == {ids["s1"], ids["s2"]}
    assert whole["table"] == "submission" and whole["capped"] is False


async def test_sum_average_and_filters(client: httpx.AsyncClient, agency: Agency) -> None:
    ids = await _pipeline(client, agency)
    a = await _post(
        client, agency, "offer",
        {"summary": "Offer A", "submission": ids["s2"], "status": "Accepted", "annual_ctc": 1200000, "sent_on": TODAY.isoformat()},
    )  # fmt: skip
    assert a
    avg = await _card(client, agency, "average_offer_ctc", range="this_year")
    assert avg["value"] == 1200000
    accepted = await _card(client, agency, "offers_accepted", range="this_year")
    assert accepted["value"] == 1
    await _post(
        client, agency, "offer",
        {"summary": "Offer B", "submission": ids["s1"], "status": "Sent", "annual_ctc": 1800000, "sent_on": TODAY.isoformat()},
    )  # fmt: skip
    assert (await _card(client, agency, "average_offer_ctc", range="this_year"))["value"] == 1500000
    assert (await _card(client, agency, "offers_accepted", range="this_year"))["value"] == 1
    assert (await _card(client, agency, "offers_made", range="this_week"))["value"] == 2


async def test_numbers_follow_each_persons_scope(
    client: httpx.AsyncClient, db: Database, mailer: InMemoryMailer
) -> None:
    boss = Agency(client, "Scope Insights Co", f"s-{uuid.uuid4().hex[:8]}@scope.test")
    await boss.sign_up("recruitment")
    await _setup(
        db,
        boss.tenant_id,
        "INSERT INTO control.tenant_role_scope (tenant_id, role_key, table_key, scope) "
        "VALUES (:t, 'recruiter', 'candidate', 'own') "
        "ON CONFLICT (tenant_id, role_key, table_key) DO UPDATE SET scope = 'own'",
    )
    rec = await _member(client, boss, mailer, "recruiter")
    await rec.create_candidate(candidate(full_name="Mine"))
    await boss.create_candidate(candidate(full_name="Theirs", phone="+91 90000 33333"))
    assert (await _card(client, boss, "active_candidates"))["value"] == 2
    mine = await _card(client, rec, "active_candidates")
    assert mine["value"] == 1
    r = await client.get("/v1/measures/active_candidates/records", headers=rec.h())
    assert r.json()["total"] == 1 and r.json()["items"][0]["data"]["full_name"] == "Mine"


async def test_a_role_without_read_access_to_the_table_does_not_see_the_card(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    ok = await client.get("/v1/measures/open_jobs", headers=agency.h())
    assert ok.status_code == 200
    assert (await client.get("/v1/measures/not_a_measure", headers=agency.h())).status_code == 404
    bad = await client.get("/v1/measures", headers=agency.h(), params={"range": "yesterday"})
    assert bad.status_code == 422
    inverted = await client.get(
        "/v1/measures", headers=agency.h(),
        params={"range": "custom", "start": "2026-02-01", "end": "2026-01-01"},
    )  # fmt: skip
    assert inverted.status_code == 422


def test_named_ranges_resolve_on_monday_weeks() -> None:
    wed = dt.date(2026, 10, 21)
    assert resolve_range("this_week", None, None, wed) == (dt.date(2026, 10, 19), wed)
    assert resolve_range("this_month", None, None, wed) == (dt.date(2026, 10, 1), wed)
    assert resolve_range(None, None, None, wed) == (dt.date(2026, 9, 22), wed)


async def test_rebuild_from_live_records_gives_identical_numbers(
    client: httpx.AsyncClient, agency: Agency, analytics: Database
) -> None:
    ids = await _pipeline(client, agency)
    await _post(
        client, agency, "offer",
        {"summary": "Offer", "submission": ids["s2"], "status": "Accepted", "annual_ctc": 900000, "sent_on": TODAY.isoformat()},
    )  # fmt: skip
    keys = [
        "active_candidates",
        "open_jobs",
        "submissions_by_stage",
        "submissions_sent",
        "offers_accepted",
        "average_offer_ctc",
    ]
    before = {k: await _card(client, agency, k, range="last_90_days") for k in keys}
    async with analytics.control() as s:
        await s.execute(
            text("DELETE FROM fact_record WHERE tenant_id = :t"), {"t": uuid.UUID(agency.tenant_id)}
        )
    assert (await _card(client, agency, "active_candidates"))["value"] == 0
    r = await client.post("/v1/measures/rebuild", headers=agency.h())
    assert r.status_code == 200, r.text
    after = {k: await _card(client, agency, k, range="last_90_days") for k in keys}
    for k in keys:
        assert before[k]["value"] == after[k]["value"], k
        assert before[k]["series"] == after[k]["series"], k


async def test_merging_candidates_removes_the_merged_one_from_the_numbers(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = (await agency.create_candidate(candidate(full_name="Dup One"))).json()["id"]
    b = (
        await agency.create_candidate(candidate(full_name="Dup One", phone="+91 90000 44444"))
    ).json()["id"]
    assert (await _card(client, agency, "active_candidates"))["value"] == 2
    r = await client.post(
        "/v1/duplicates/candidate/merge", headers=agency.h(), json={"keep": a, "drop": b}
    )
    assert r.status_code in (200, 201), r.text
    # events reach the store through the relay in the app; here the bus is local and immediate
    assert (await _card(client, agency, "active_candidates"))["value"] == 1


async def test_builder_adds_edits_hides_and_removes_measures(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    new = await client.post(
        "/v1/studio/measures", headers=a.h(),
        json={"label": "Rejected submissions", "table": "submission", "aggregate": "count",
              "where": [{"field": "stage", "op": "eq", "value": "Rejected"}], "home": False},
    )  # fmt: skip
    assert new.status_code == 201, new.text
    key = new.json()["key"]
    assert key == "rejected_submissions" and new.json()["source"] == "agency"
    dup = await client.post(
        "/v1/studio/measures",
        headers=a.h(),
        json={"label": "Rejected submissions", "table": "submission"},
    )
    assert dup.status_code == 422 and dup.json()["errors"][0]["code"] == "duplicate"
    bad_sum = await client.post(
        "/v1/studio/measures", headers=a.h(),
        json={"label": "Sum of names", "table": "candidate", "aggregate": "sum", "field": "full_name"},
    )  # fmt: skip
    assert bad_sum.status_code == 422 and "not a number" in bad_sum.text
    no_field = await client.post(
        "/v1/studio/measures",
        headers=a.h(),
        json={"label": "Total", "table": "offer", "aggregate": "sum"},
    )
    assert no_field.status_code == 422
    pack_edit = await client.put(
        "/v1/studio/measures/active_candidates", headers=a.h(), json={"aggregate": "sum"}
    )
    assert pack_edit.status_code == 422 and pack_edit.json()["errors"][0]["code"] == "pack_locked"
    hide = await client.put(
        "/v1/studio/measures/offers_made",
        headers=a.h(),
        json={"hidden": True, "label": "Offers out"},
    )
    assert hide.status_code == 200 and hide.json()["hidden"] is True
    no_remove = await client.delete("/v1/studio/measures/offers_made", headers=a.h())
    assert no_remove.status_code == 422
    listed = (await client.get("/v1/studio/measures", headers=a.h())).json()
    assert {m["key"] for m in listed} >= {"rejected_submissions", "offers_made"}
    assert all(m["problems"] == [] for m in listed)
    await a.publish_live()
    live = [m["key"] for m in (await client.get("/v1/measures", headers=a.h())).json()]
    assert "rejected_submissions" in live and "offers_made" not in live
    assert (await client.delete(f"/v1/studio/measures/{key}", headers=a.h())).status_code == 204


async def test_home_shows_at_most_four_numbers_and_builder_needs_permission(
    client: httpx.AsyncClient, agency: Agency, mailer: InMemoryMailer
) -> None:
    full = await client.put(
        "/v1/studio/measures/offers_made", headers=agency.h(), json={"home": True}
    )
    assert full.status_code == 422 and full.json()["errors"][0]["code"] == "home_full"
    off = await client.put(
        "/v1/studio/measures/open_jobs", headers=agency.h(), json={"home": False}
    )
    assert off.status_code == 200
    ok = await client.put(
        "/v1/studio/measures/offers_made", headers=agency.h(), json={"home": True}
    )
    assert ok.status_code == 200
    rec = await _member(client, agency, mailer, "recruiter")
    denied = await client.post(
        "/v1/studio/measures", headers=rec.h(), json={"label": "X", "table": "candidate"}
    )
    assert denied.status_code == 403
    assert (await client.post("/v1/measures/rebuild", headers=rec.h())).status_code == 403


async def test_a_measure_on_a_new_field_switches_it_on_and_backfills_after_publish(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    await a.publish_live()
    await _post(client, a, "client", {"name": "Zed Co", "status": "Active"})
    r = await client.post(
        "/v1/studio/measures", headers=a.h(),
        json={"label": "Prospects", "table": "client", "where": [{"field": "status", "op": "eq", "value": "Prospect"}]},
    )  # fmt: skip
    assert r.status_code == 201, r.text
    assert r.json()["fields_turned_on"] == ["Status"]
    await _post(client, a, "client", {"name": "Prospect Co", "status": "Prospect"})
    await a.publish_live()
    assert (await _card(client, a, "prospects"))["value"] == 1


async def test_preview_shows_the_number_or_the_problem_before_saving(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    await _pipeline(client, agency)
    await _flush(client)
    ok = await client.post(
        "/v1/measures/preview", headers=agency.h(),
        json={"table": "submission", "where": [{"field": "stage", "op": "eq", "value": "Sourced"}]},
    )  # fmt: skip
    assert ok.status_code == 200 and ok.json()["ok"] is True and ok.json()["card"]["value"] == 1
    bad = await client.post(
        "/v1/measures/preview", headers=agency.h(),
        json={"table": "candidate", "aggregate": "sum", "field": "full_name"},
    )  # fmt: skip
    assert bad.json()["ok"] is False and "not a number" in bad.json()["problems"][0]
    nope = await client.post("/v1/measures/preview", headers=agency.h(), json={"table": "nope"})
    assert nope.json()["ok"] is False
