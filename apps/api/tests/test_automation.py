"""M4: automations, the notification centre, what needs me, first steps and sample data."""

import datetime as dt
import uuid
from typing import Any

import httpx
import pytest
from sqlalchemy import text

from tableui.automation.application import engine, notifications
from tableui.platform.config import Settings
from tableui.platform.db import Database
from tableui.platform.mail import InMemoryMailer
from tests.conftest import Agency, candidate
from tests.test_access import _member
from tests.test_approvals import _offer_body, _over_budget

TODAY = dt.datetime.now(dt.UTC).date()


async def _flush(client: httpx.AsyncClient, times: int = 1) -> None:
    for _ in range(times):
        await client._transport.app.state.relay.run_once()  # type: ignore[attr-defined]


async def _records(client: httpx.AsyncClient, a: Agency, table: str) -> list[dict[str, Any]]:
    r = await client.get(f"/v1/records/{table}", headers=a.h(), params={"limit": 200})
    assert r.status_code == 200, r.text
    return r.json()["items"]  # type: ignore[no-any-return]


async def _runs(client: httpx.AsyncClient, a: Agency, **params: str) -> list[dict[str, Any]]:
    r = await client.get("/v1/automations/runs", headers=a.h(), params=params)
    assert r.status_code == 200, r.text
    return r.json()  # type: ignore[no-any-return]


async def _build(client: httpx.AsyncClient, a: Agency, body: dict[str, Any]) -> dict[str, Any]:
    r = await client.post("/v1/studio/automations", headers=a.h(), json=body)
    assert r.status_code == 201, r.text
    await a.publish_live()
    return r.json()  # type: ignore[no-any-return]


async def _only_mine(client: httpx.AsyncClient, a: Agency, keep: str) -> None:
    """Switch off the pack's starters except one, so a test sees only what it is about."""
    for au in (await client.get("/v1/studio/automations", headers=a.h())).json():
        if au["source"] == "pack" and au["key"] != keep and au["enabled"]:
            r = await client.put(
                f"/v1/studio/automations/{au['key']}", headers=a.h(), json={"enabled": False}
            )
            assert r.status_code == 200, r.text
    await a.publish_live()


async def _inbox(client: httpx.AsyncClient, a: Agency) -> dict[str, Any]:
    r = await client.get("/v1/notifications", headers=a.h())
    assert r.status_code == 200, r.text
    return r.json()  # type: ignore[no-any-return]


def _settings(client: httpx.AsyncClient) -> Settings:
    return client._transport.app.state.settings  # type: ignore[attr-defined,no-any-return]


# ---- the builder and the pack -----------------------------------------------------------------


async def test_the_pack_ships_five_starters_that_can_be_switched_off_but_not_rewritten(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    listed = (await client.get("/v1/studio/automations", headers=agency.h())).json()
    assert [a["key"] for a in listed] == [
        "screening_task_new_candidate",
        "follow_up_submission",
        "chase_offer",
        "interview_reminder",
        "stuck_sourced",
    ]
    assert all(a["problems"] == [] and a["enabled"] for a in listed)
    off = await client.put(
        "/v1/studio/automations/chase_offer", headers=agency.h(), json={"enabled": False}
    )
    assert off.status_code == 200 and off.json()["enabled"] is False
    locked = await client.put(
        "/v1/studio/automations/chase_offer", headers=agency.h(), json={"actions": []}
    )
    assert locked.status_code == 422 and locked.json()["errors"][0]["code"] == "pack_locked"
    gone = await client.delete("/v1/studio/automations/chase_offer", headers=agency.h())
    assert gone.status_code == 422


async def test_the_builder_explains_what_is_wrong_in_plain_words(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    async def bad(body: dict[str, Any], needle: str) -> None:
        r = await client.post("/v1/studio/automations", headers=agency.h(), json=body)
        assert r.status_code == 422, r.text
        assert needle in r.text, r.text

    base = {
        "label": "Test",
        "trigger": {"kind": "created", "table": "task"},
        "actions": [{"kind": "notify", "to": "owner", "message": "Hi"}],
    }
    await bad({**base, "trigger": {"kind": "date", "table": "task"}}, "Pick the field to watch")
    await bad(
        {**base, "trigger": {"kind": "date", "table": "task", "field": "title"}},
        "not a date field",
    )
    await bad(
        {
            **base,
            "trigger": {"kind": "changed", "table": "task", "field": "status", "value": "Nope"},
        },
        "not a choice",
    )
    await bad({**base, "actions": []}, "at least one")
    await bad(
        {**base, "actions": [{"kind": "notify", "to": "owner", "message": "About {nothing}"}]},
        "not a field of Task",
    )
    await bad(
        {**base, "actions": [{"kind": "notify", "to": "role", "role": "wizard", "message": "x"}]},
        "no role 'wizard'",
    )
    await bad(
        {**base, "actions": [{"kind": "create", "table": "task", "values": {"status": "Open"}}]},
        "'Title' is required",
    )
    await bad(
        {
            **base,
            "trigger": {"kind": "changed", "table": "task", "field": "status", "value": "Done"},
            "actions": [{"kind": "set_field", "field": "status", "value": "Open"}],
        },
        "same automation again",
    )


async def test_preview_says_how_many_records_it_would_have_matched(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    for name in ("Open one", "Open two"):
        await client.post(
            "/v1/records/task", headers=agency.h(), json={"data": {"title": name, "status": "Open"}}
        )
    done = await client.post(
        "/v1/records/task", headers=agency.h(), json={"data": {"title": "Shut", "status": "Done"}}
    )
    assert done.status_code == 201
    r = await client.post(
        "/v1/automations/preview",
        headers=agency.h(),
        json={
            "trigger": {"kind": "updated", "table": "task"},
            "where": [{"field": "status", "op": "eq", "value": "Open"}],
            "actions": [{"kind": "notify", "to": "owner", "message": "x"}],
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["count"] == 2 and r.json()["complete"] is True
    assert set(r.json()["examples"]) == {"Open one", "Open two"}


# ---- event triggers ---------------------------------------------------------------------------


async def test_a_new_candidate_gets_a_screening_task_for_the_person_who_added_them(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    res = await agency.create_candidate(candidate(full_name="Neha Iyer"))
    assert res.status_code == 201, res.text  # the save never waits for automations
    assert await _records(client, agency, "task") == []
    await _flush(client)
    tasks = await _records(client, agency, "task")
    assert len(tasks) == 1
    t = tasks[0]["data"]
    assert t["title"] == "Screen Neha Iyer" and t["status"] == "Open"
    assert t["candidate"] == res.json()["id"]
    assert t["due_on"] == (TODAY + dt.timedelta(days=2)).isoformat()
    inbox = await _inbox(client, agency)
    assert inbox["unread"] == 1 and inbox["items"][0]["title"] == "New task: Screen Neha Iyer"
    runs = await _runs(client, agency, automation="screening_task_new_candidate")
    assert runs[0]["status"] == "done" and runs[0]["did"] == ["Created 1 task"]


async def test_five_redeliveries_of_one_event_run_the_automation_once(
    client: httpx.AsyncClient, agency: Agency, db: Database
) -> None:
    res = await agency.create_candidate(candidate(full_name="Once Only"))
    event = {
        "event_id": str(uuid.uuid4()),
        "topic": "candidate.created",
        "tenant_id": agency.tenant_id,
        "table": "candidate",
        "record_id": res.json()["id"],
        "changed": [],
        "depth": 0,
    }
    app = client._transport.app  # type: ignore[attr-defined]
    for _ in range(5):
        await engine.handle_event(app.state.db, app.state.mailer, app.state.settings, event)
    tasks = [t for t in await _records(client, agency, "task") if "Once Only" in t["data"]["title"]]
    assert len(tasks) == 1


async def test_a_change_to_a_value_fires_only_when_the_field_has_just_become_that_value(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    await _only_mine(client, agency, "none")
    await _build(
        client,
        agency,
        {
            "label": "Tell me when a task is done",
            "trigger": {"kind": "changed", "table": "task", "field": "status", "value": "Done"},
            "actions": [{"kind": "notify", "to": "owner", "message": "Finished: {title}"}],
        },
    )
    made = await client.post(
        "/v1/records/task",
        headers=agency.h(),
        json={"data": {"title": "Ring Ravi", "status": "Open"}},
    )
    await _flush(client)
    assert (await _inbox(client, agency))["unread"] == 0
    other = await client.patch(
        f"/v1/records/task/{made.json()['id']}",
        headers=agency.h(),
        json={"version": 1, "data": {"due_on": TODAY.isoformat()}},
    )
    assert other.status_code == 200
    await _flush(client)
    assert (await _inbox(client, agency))["unread"] == 0
    done = await client.patch(
        f"/v1/records/task/{made.json()['id']}",
        headers=agency.h(),
        json={"version": 2, "data": {"status": "Done"}},
    )
    assert done.status_code == 200
    await _flush(client)
    inbox = await _inbox(client, agency)
    assert [i["title"] for i in inbox["items"]] == ["Finished: Ring Ravi"]


async def test_conditions_decide_whether_it_runs(client: httpx.AsyncClient, agency: Agency) -> None:
    await _only_mine(client, agency, "none")
    await _build(
        client,
        agency,
        {
            "label": "Only open tasks",
            "trigger": {"kind": "created", "table": "task"},
            "where": [{"field": "status", "op": "eq", "value": "Open"}],
            "actions": [{"kind": "notify", "to": "owner", "message": "Open: {title}"}],
        },
    )
    for title, status in (("A", "Open"), ("B", "Done")):
        await client.post(
            "/v1/records/task",
            headers=agency.h(),
            json={"data": {"title": title, "status": status}},
        )
    await _flush(client)
    assert [i["title"] for i in (await _inbox(client, agency))["items"]] == ["Open: A"]


async def test_an_automation_can_set_a_field_and_talk_to_a_whole_role(
    client: httpx.AsyncClient, agency: Agency, mailer: InMemoryMailer
) -> None:
    await _only_mine(client, agency, "none")
    boss_mate = await _member(client, agency, mailer, "manager")
    await _build(
        client,
        agency,
        {
            "label": "Tell managers about big offers",
            "trigger": {"kind": "created", "table": "task"},
            "actions": [
                {"kind": "notify", "to": "role", "role": "manager", "message": "Task: {title}"},
                {"kind": "set_field", "field": "status", "value": "Open"},
            ],
        },
    )
    await client.post(
        "/v1/records/task", headers=agency.h(), json={"data": {"title": "Big", "status": "Open"}}
    )
    await _flush(client)
    assert [i["title"] for i in (await _inbox(client, boss_mate))["items"]] == ["Task: Big"]
    assert (await _inbox(client, agency))["unread"] == 0


async def test_automations_trigger_at_most_one_more_level(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    await _only_mine(client, agency, "none")
    await _build(
        client,
        agency,
        {
            "label": "Every task makes a task",
            "trigger": {"kind": "created", "table": "task"},
            "actions": [
                {"kind": "create", "to": "owner", "table": "task", "values": {"title": "Again"}}
            ],
        },
    )
    await client.post(
        "/v1/records/task", headers=agency.h(), json={"data": {"title": "Start", "status": "Open"}}
    )
    await _flush(client, 6)
    titles = sorted(t["data"]["title"] for t in await _records(client, agency, "task"))
    assert titles == ["Again", "Again", "Start"]


# ---- date triggers ----------------------------------------------------------------------------


async def test_a_date_trigger_fires_once_even_when_the_check_runs_twice(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    await _only_mine(client, agency, "none")
    await _build(
        client,
        agency,
        {
            "label": "Due today",
            "trigger": {"kind": "date", "table": "task", "field": "due_on", "days": 0},
            "where": [{"field": "status", "op": "eq", "value": "Open"}],
            "actions": [{"kind": "notify", "to": "owner", "message": "Due: {title}"}],
        },
    )
    for title, due in (("Today", TODAY), ("Yesterday", TODAY - dt.timedelta(days=1)),
                       ("Next week", TODAY + dt.timedelta(days=7)),
                       ("Long ago", TODAY - dt.timedelta(days=40))):  # fmt: skip
        await client.post(
            "/v1/records/task",
            headers=agency.h(),
            json={"data": {"title": title, "status": "Open", "due_on": due.isoformat()}},
        )
    await _flush(client)
    app = client._transport.app  # type: ignore[attr-defined]
    args = (app.state.db, app.state.mailer, app.state.settings, uuid.UUID(agency.tenant_id))
    assert await engine.check_dates(*args) == 2
    assert await engine.check_dates(*args) == 0
    titles = sorted(i["title"] for i in (await _inbox(client, agency))["items"])
    assert titles == ["Due: Today", "Due: Yesterday"]  # not next week, not 40 days ago


async def test_a_reminder_before_a_date_does_not_fire_for_a_date_already_past(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    await _only_mine(client, agency, "none")
    await _build(
        client,
        agency,
        {
            "label": "Day before",
            "trigger": {"kind": "date", "table": "task", "field": "due_on", "days": -1},
            "actions": [{"kind": "notify", "to": "owner", "message": "Tomorrow: {title}"}],
        },
    )
    for title, due in (("Tomorrow", TODAY + dt.timedelta(days=1)),
                       ("Past", TODAY - dt.timedelta(days=2)),
                       ("Far", TODAY + dt.timedelta(days=9))):  # fmt: skip
        await client.post(
            "/v1/records/task",
            headers=agency.h(),
            json={"data": {"title": title, "status": "Open", "due_on": due.isoformat()}},
        )
    await _flush(client)
    app = client._transport.app  # type: ignore[attr-defined]
    started = await engine.check_dates(
        app.state.db, app.state.mailer, app.state.settings, uuid.UUID(agency.tenant_id)
    )
    assert started == 1
    assert [i["title"] for i in (await _inbox(client, agency))["items"]] == ["Tomorrow: Tomorrow"]


async def test_the_hourly_tick_checks_dates_once_an_hour(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    app = client._transport.app  # type: ignore[attr-defined]
    tid = uuid.UUID(agency.tenant_id)
    first = await engine.tick(app.state.db, app.state.mailer, app.state.settings, [tid])
    second = await engine.tick(app.state.db, app.state.mailer, app.state.settings, [tid])
    assert first["retried"] >= 0 and second["started"] == 0
    async with app.state.db.control() as c:
        n = (
            await c.execute(
                text("SELECT count(*) FROM control.automation_clock WHERE tenant_id = :t"),
                {"t": tid},
            )
        ).scalar_one()
    assert n == 1


# ---- failures, retries, limits ----------------------------------------------------------------


class _Flaky:
    def __init__(self, fail: int) -> None:
        self.fail, self.sent = fail, 0

    async def send(self, *, to: str, subject: str, body: str) -> None:
        if self.fail > 0:
            self.fail -= 1
            raise ConnectionError("mail server is down")
        self.sent += 1


async def test_a_failing_action_never_undoes_the_save_and_is_retried_without_repeating_work(
    client: httpx.AsyncClient, agency: Agency, db: Database
) -> None:
    await _only_mine(client, agency, "none")
    await _build(
        client,
        agency,
        {
            "label": "Task then email",
            "trigger": {"kind": "created", "table": "candidate"},
            "actions": [
                {
                    "kind": "create",
                    "to": "owner",
                    "table": "task",
                    "values": {"title": "Call {title}"},
                },
                {"kind": "notify", "to": "owner", "message": "Added {title}", "also_email": True},
            ],
        },
    )
    app = client._transport.app  # type: ignore[attr-defined]
    real = app.state.mailer
    flaky = _Flaky(fail=1)
    app.state.mailer = flaky
    try:
        res = await agency.create_candidate(candidate(full_name="Flaky Case"))
        assert res.status_code == 201
        await _flush(client)
    finally:
        app.state.mailer = real
    run = (await _runs(client, agency, automation="task_then_email"))[0]
    assert run["status"] == "retrying" and run["attempts"] == 1
    assert "mail server is down" in run["error"]
    assert len(await _records(client, agency, "task")) == 1  # the first action is not repeated
    async with db.control() as c:
        await c.execute(
            text("UPDATE control.automation_run SET next_try_at = now() - interval '1 minute'")
        )
    app.state.mailer = flaky
    try:
        assert await engine.retry_due(app.state.db, flaky, app.state.settings) == 1
    finally:
        app.state.mailer = real
    run = (await _runs(client, agency, automation="task_then_email"))[0]
    assert run["status"] == "done" and flaky.sent == 1
    assert len(await _records(client, agency, "task")) == 1
    titles = [i["title"] for i in (await _inbox(client, agency))["items"]]
    assert titles.count("Added Flaky Case") == 1


async def test_after_three_tries_the_failure_is_visible_and_can_be_retried(
    client: httpx.AsyncClient, agency: Agency, db: Database
) -> None:
    await _only_mine(client, agency, "none")
    await _build(
        client,
        agency,
        {
            "label": "Email always fails",
            "trigger": {"kind": "created", "table": "candidate"},
            "actions": [
                {"kind": "notify", "to": "owner", "message": "x {title}", "also_email": True}
            ],
        },
    )
    app = client._transport.app  # type: ignore[attr-defined]
    real = app.state.mailer
    app.state.mailer = _Flaky(fail=99)
    try:
        await agency.create_candidate(candidate(full_name="Never Sent"))
        await _flush(client)
        for _ in range(3):
            async with db.control() as c:
                await c.execute(text("UPDATE control.automation_run SET next_try_at = now()"))
            await engine.retry_due(app.state.db, app.state.mailer, app.state.settings)
        run = (await _runs(client, agency, status="failed"))[0]
        assert run["attempts"] == 3 and "mail server is down" in run["error"]
    finally:
        app.state.mailer = real
    again = await client.post(f"/v1/automations/runs/{run['id']}/retry", headers=agency.h())
    assert again.status_code == 200 and again.json()["status"] == "done"
    nope = await client.post(f"/v1/automations/runs/{run['id']}/retry", headers=agency.h())
    assert nope.status_code == 404


async def test_a_rule_that_blocks_the_action_fails_at_once_with_the_reason(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    await _only_mine(client, agency, "none")
    await _build(
        client,
        agency,
        {
            "label": "Makes an empty task",
            "trigger": {"kind": "created", "table": "candidate"},
            "actions": [
                {"kind": "create", "to": "owner", "table": "task", "values": {"title": "{phone}"}}
            ],
        },
    )
    res = await agency.create_candidate(candidate(phone=None))  # type: ignore[arg-type]
    assert res.status_code == 201
    await _flush(client)
    run = (await _runs(client, agency, automation="makes_an_empty_task"))[0]
    assert run["status"] == "failed" and run["attempts"] == 1 and run["error"]


async def test_a_workspace_that_hits_its_daily_limit_stops_and_its_admins_are_told_once(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    s = _settings(client)
    old = s.automation_daily_cap
    s.automation_daily_cap = 2
    try:
        for i in range(4):
            await agency.create_candidate(
                candidate(full_name=f"Cap {i}", phone=f"+91 9000{i} 00000")
            )
        await _flush(client)
    finally:
        s.automation_daily_cap = old
    assert len(await _records(client, agency, "task")) == 2
    titles = [i["title"] for i in (await _inbox(client, agency))["items"] if "limit" in i["title"]]
    assert len(titles) == 1


# ---- the notification centre ------------------------------------------------------------------


async def test_the_bell_counts_unread_and_marks_read(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    for i in range(3):
        await agency.create_candidate(candidate(full_name=f"Bell {i}", phone=f"+91 8000{i} 00000"))
    await _flush(client)
    inbox = await _inbox(client, agency)
    assert inbox["unread"] == 3 and len(inbox["items"]) == 3
    one = await client.post(
        "/v1/notifications/read", headers=agency.h(), json={"ids": [inbox["items"][0]["id"]]}
    )
    assert one.json() == {"marked": 1, "unread": 2}
    allr = await client.post("/v1/notifications/read", headers=agency.h(), json={})
    assert allr.json() == {"marked": 2, "unread": 0}


async def test_people_only_see_their_own_notifications(
    client: httpx.AsyncClient, agency: Agency, mailer: InMemoryMailer
) -> None:
    other = await _member(client, agency, mailer, "recruiter")
    await agency.create_candidate(candidate(full_name="Private Bell"))
    await _flush(client)
    assert (await _inbox(client, agency))["unread"] == 1
    assert (await _inbox(client, other))["unread"] == 0


async def test_preferences_off_in_app_or_with_email(
    client: httpx.AsyncClient, agency: Agency, mailer: InMemoryMailer
) -> None:
    prefs = (await client.get("/v1/notifications/preferences", headers=agency.h())).json()
    assert {k["kind"]: k["channel"] for k in prefs["kinds"]} == {
        "automation": "in_app",
        "task": "in_app",
        "approval": "in_app",
    }
    assert prefs["digest"] is True
    bad = await client.put(
        "/v1/notifications/preferences", headers=agency.h(), json={"channels": {"task": "sms"}}
    )
    assert bad.status_code == 422
    await client.put(
        "/v1/notifications/preferences", headers=agency.h(), json={"channels": {"task": "off"}}
    )
    await agency.create_candidate(candidate(full_name="Quiet One"))
    await _flush(client)
    assert (await _inbox(client, agency))["unread"] == 0
    assert (await _records(client, agency, "task"))[0]["data"]["title"] == "Screen Quiet One"
    before = len(mailer.sent)
    await client.put(
        "/v1/notifications/preferences",
        headers=agency.h(),
        json={"channels": {"task": "in_app_email"}},
    )
    await agency.create_candidate(candidate(full_name="Loud One", phone="+91 70000 00000"))
    await _flush(client)
    assert (await _inbox(client, agency))["unread"] == 1
    assert len(mailer.sent) == before + 1 and mailer.sent[-1]["to"] == agency.email


async def test_the_daily_summary_is_one_email_with_a_working_unsubscribe_link(
    client: httpx.AsyncClient, agency: Agency, mailer: InMemoryMailer
) -> None:
    app = client._transport.app  # type: ignore[attr-defined]
    s = _settings(client)
    tid = uuid.UUID(agency.tenant_id)
    for i in range(2):
        await agency.create_candidate(
            candidate(full_name=f"Digest {i}", phone=f"+91 7100{i} 00000")
        )
    await _flush(client)
    noon = dt.datetime.now(dt.UTC).replace(hour=12)
    before = len(mailer.sent)
    async with app.state.db.control() as c:
        early = await notifications.send_digests(
            c, mailer, tenant_id=tid, secret=s.signing_key, base_url="http://web.test",
            hour_utc=13, now=noon,
        )  # fmt: skip
        sent = await notifications.send_digests(
            c, mailer, tenant_id=tid, secret=s.signing_key, base_url="http://web.test",
            hour_utc=3, now=noon,
        )  # fmt: skip
        again = await notifications.send_digests(
            c, mailer, tenant_id=tid, secret=s.signing_key, base_url="http://web.test",
            hour_utc=3, now=noon,
        )  # fmt: skip
    assert (early, sent, again) == (0, 1, 0)
    mail = mailer.sent[before:]
    assert len(mail) == 1 and "2 updates" in mail[0]["body"] and "Digest 0" in mail[0]["body"]
    link = mail[0]["body"].split("Stop these daily emails: ")[1].split()[0]
    token = link.split("token=")[1]
    assert link.startswith("http://web.test/unsubscribe?token=")
    bad = await client.post("/v1/notifications/unsubscribe", json={"token": token[:-2] + "00"})
    assert bad.status_code == 422
    ok = await client.post("/v1/notifications/unsubscribe", json={"token": token})
    assert ok.status_code == 200
    assert (await client.get("/v1/notifications/preferences", headers=agency.h())).json()[
        "digest"
    ] is False


# ---- what needs me, first steps, sample data --------------------------------------------------


async def test_what_needs_me_lists_my_open_tasks_soonest_first_and_lets_me_tick_one_off(
    client: httpx.AsyncClient, agency: Agency, mailer: InMemoryMailer
) -> None:
    other = await _member(client, agency, mailer, "recruiter")
    for title, due in (("Later", TODAY + dt.timedelta(days=5)), ("Overdue", TODAY - dt.timedelta(days=2)),
                       ("No date", None)):  # fmt: skip
        data = {"title": title, "status": "Open", **({"due_on": due.isoformat()} if due else {})}
        await client.post("/v1/records/task", headers=agency.h(), json={"data": data})
    await client.post(
        "/v1/records/task", headers=other.h(), json={"data": {"title": "Theirs", "status": "Open"}}
    )
    needs = (await client.get("/v1/me/needs", headers=agency.h())).json()
    assert needs["tasks"]["total"] == 3
    assert [t["title"] for t in needs["tasks"]["items"]] == ["Overdue", "Later", "No date"]
    assert [t["overdue"] for t in needs["tasks"]["items"]] == [True, False, False]
    tid = needs["tasks"]["items"][0]["id"]
    done = await client.post(f"/v1/me/tasks/task/{tid}/done", headers=agency.h())
    assert done.status_code == 200 and done.json()["data"]["status"] == "Done"
    after = (await client.get("/v1/me/needs", headers=agency.h())).json()
    assert after["tasks"]["total"] == 2
    theirs = (await client.get("/v1/me/needs", headers=other.h())).json()
    assert [t["title"] for t in theirs["tasks"]["items"]] == ["Theirs"]
    notmine = await client.post(
        f"/v1/me/tasks/task/{theirs['tasks']['items'][0]['id']}/done", headers=agency.h()
    )
    assert notmine.status_code == 404


async def test_what_needs_me_counts_approvals_for_those_who_can_decide(
    client: httpx.AsyncClient, agency: Agency, mailer: InMemoryMailer
) -> None:
    rec = await _member(client, agency, mailer, "recruiter")
    assert (await client.get("/v1/me/needs", headers=rec.h())).json()["approvals"] == 0
    assert (await client.get("/v1/me/needs", headers=agency.h())).json()["approvals"] == 0


async def test_first_steps_tick_themselves_and_can_be_dismissed(
    client: httpx.AsyncClient, agency: Agency, mailer: InMemoryMailer
) -> None:
    rec = await _member(client, agency, mailer, "recruiter")
    g = (await client.get("/v1/me/guide", headers=rec.h())).json()
    assert g["title"] == "Your first steps" and g["total"] == 4 and g["done"] == 0
    assert g["steps"][0]["path"] == "/records/candidate/new" and g["dismissed"] is False
    await rec.create_candidate(candidate())
    g = (await client.get("/v1/me/guide", headers=rec.h())).json()
    assert g["done"] == 1 and g["steps"][0]["done"] is True
    owner_view = (await client.get("/v1/me/guide", headers=agency.h())).json()
    assert owner_view is None  # an owner has the workspace set-up checklist instead
    await client.put("/v1/me/guide", headers=rec.h(), json={"dismissed": True})
    assert (await client.get("/v1/me/guide", headers=rec.h())).json()["dismissed"] is True
    await client.put("/v1/me/guide", headers=rec.h(), json={"dismissed": False})
    assert (await client.get("/v1/me/guide", headers=rec.h())).json()["dismissed"] is False


async def test_sample_data_loads_in_one_step_and_goes_in_one_step(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    st = (await client.get("/v1/workspace/sample", headers=agency.h())).json()
    assert st == {"available": True, "loaded": False, "count": 0}
    r = await client.post("/v1/workspace/sample", headers=agency.h())
    assert r.status_code == 201 and r.json() == {"loaded": True, "count": 8}
    cands = await _records(client, agency, "candidate")
    assert {c["data"]["full_name"] for c in cands} == {
        "Sample - Aarav Shah", "Sample - Meera Nair", "Sample - Kabir Rao",
    }  # fmt: skip
    sub = (await _records(client, agency, "submission"))[0]["data"]
    assert sub["candidate"] in {c["id"] for c in cands}
    twice = await client.post("/v1/workspace/sample", headers=agency.h())
    assert twice.status_code == 422
    mine = await agency.create_candidate(candidate(full_name="Real Person"))
    gone = await client.delete("/v1/workspace/sample", headers=agency.h())
    assert gone.status_code == 200 and gone.json()["removed"] == 8
    left = await _records(client, agency, "candidate")
    assert [c["data"]["full_name"] for c in left] == ["Real Person"]
    assert left[0]["id"] == mine.json()["id"]
    assert (await client.get("/v1/workspace/sample", headers=agency.h())).json()["loaded"] is False
    again = await client.post("/v1/workspace/sample", headers=agency.h())
    assert again.status_code == 201


async def test_people_who_can_decide_hear_about_a_change_waiting_but_the_requester_does_not(
    client: httpx.AsyncClient, mailer: InMemoryMailer
) -> None:
    boss = Agency(client, "Hear Co", f"h-{uuid.uuid4().hex[:8]}@hear.test")
    await boss.sign_up("recruitment")
    rec = await _member(client, boss, mailer, "recruiter")
    mgr = await _member(client, boss, mailer, "manager")
    _, entry = await _over_budget(client, boss)
    held = await client.post("/v1/approvals", headers=rec.h(), json=_offer_body(entry, 3_500_000))
    assert held.status_code == 201, held.text
    for who in (mgr, boss):
        titles = [i["title"] for i in (await _inbox(client, who))["items"]]
        assert "A change to offer is waiting for your decision" in titles
        needs = (await client.get("/v1/me/needs", headers=who.h())).json()
        assert needs["approvals"] == 1
    assert [i for i in (await _inbox(client, rec))["items"] if i["kind"] == "approval"] == []


async def test_only_people_who_can_import_may_load_sample_data(
    client: httpx.AsyncClient, agency: Agency, mailer: InMemoryMailer
) -> None:
    rec = await _member(client, agency, mailer, "recruiter")
    assert (await client.post("/v1/workspace/sample", headers=rec.h())).status_code == 403


async def test_the_release_diff_shows_automation_changes(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    v1 = await agency.publish_live()
    await client.put(
        "/v1/studio/automations/chase_offer", headers=agency.h(), json={"enabled": False}
    )
    v2 = await agency.publish_live()
    r = await client.get(
        "/v1/apps/current/compare", headers=agency.h(), params={"from": str(v1), "to": str(v2)}
    )
    assert r.status_code == 200, r.text
    assert [(i["key"], i["change"]) for i in r.json()["automations"]] == [
        ("chase_offer", "changed")
    ]


@pytest.mark.parametrize("path", ["/v1/notifications", "/v1/me/needs", "/v1/me/guide"])
async def test_sign_in_is_required(client: httpx.AsyncClient, path: str) -> None:
    assert (await client.get(path)).status_code == 401
