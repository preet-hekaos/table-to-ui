"""M0-S10 create, M0-S11 conflicts, M0-S12 rule R-01, M0-S13 history, audit and outbox."""

import asyncio
import uuid

import httpx
from sqlalchemy import text

from tableui.audit.public import HistoryEntry, read_history, verify_chain
from tableui.platform.db import Database
from tests.conftest import Agency, candidate


async def test_create_writes_record_history_audit_and_outbox_atomically(
    client: httpx.AsyncClient, agency: Agency, db: Database
) -> None:
    r = await agency.create_candidate(candidate())
    assert r.status_code == 201
    body = r.json()
    assert body["version"] == 1
    rid = uuid.UUID(body["id"])
    async with db.tenant(uuid.UUID(agency.tenant_id)) as s:
        hist = await read_history(s, "candidate", rid)
        outbox = (
            await s.execute(
                text("SELECT topic, payload FROM outbox WHERE payload->>'record_id' = :r"),
                {"r": str(rid)},
            )
        ).all()
    assert [h.action for h in hist] == ["create"]
    assert [o.topic for o in outbox] == ["candidate.created"]
    async with db.control() as s:
        n = (
            await s.execute(
                text(
                    "SELECT count(*) FROM control.audit_event WHERE subject_id = :r AND action = 'candidate.create'"
                ),
                {"r": str(rid)},
            )
        ).scalar_one()
    assert n == 1


async def test_invalid_input_lists_each_field_error_and_writes_nothing(
    client: httpx.AsyncClient, agency: Agency, db: Database
) -> None:
    r = await agency.create_candidate(
        {
            "full_name": "",
            "email": "not-an-email",
            "notice_period_days": 900,
            "status": "Nope",
            "bogus": 1,
        }
    )
    assert r.status_code == 422
    assert r.headers["content-type"].startswith("application/problem+json")
    fields = {e["field"] for e in r.json()["errors"]}
    assert fields == {"full_name", "email", "notice_period_days", "status", "bogus"}
    assert r.json()["request_id"]
    async with db.tenant(uuid.UUID(agency.tenant_id)) as s:
        assert (await s.execute(text("SELECT count(*) FROM candidate"))).scalar_one() == 0


async def test_same_idempotency_key_returns_first_result_once(
    client: httpx.AsyncClient, agency: Agency, db: Database
) -> None:
    data = candidate()
    first = await agency.create_candidate(data, key="key-1")
    second = await agency.create_candidate(data, key="key-1")
    assert first.status_code == second.status_code == 201
    assert first.json()["id"] == second.json()["id"]
    assert second.headers["idempotent-replayed"] == "true"
    async with db.tenant(uuid.UUID(agency.tenant_id)) as s:
        assert (await s.execute(text("SELECT count(*) FROM candidate"))).scalar_one() == 1
    reuse = await agency.create_candidate(candidate(), key="key-1")
    assert reuse.status_code == 422 and "Idempotency-Key" in reuse.json()["detail"]


async def test_update_with_stale_version_is_refused(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    rid = (await agency.create_candidate(candidate())).json()["id"]
    for expected in (1, 2):  # take the record to version 3
        r = await client.patch(
            f"/v1/records/candidate/{rid}",
            headers=agency.h(),
            json={"version": expected, "data": {"location": f"City {expected}"}},
        )
        assert r.status_code == 200 and r.json()["version"] == expected + 1
    stale = await client.patch(
        f"/v1/records/candidate/{rid}",
        headers=agency.h(),
        json={"version": 2, "data": {"location": "Overwrite"}},
    )
    assert stale.status_code == 409
    assert stale.json()["current_version"] == 3 and stale.json()["type"].endswith(
        "version-conflict"
    )
    got = (await client.get(f"/v1/records/candidate/{rid}", headers=agency.h())).json()
    assert got["data"]["location"] == "City 2"


async def test_r01_blocks_email_in_different_case_and_links_existing(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    first = (
        await agency.create_candidate(candidate(email="arjun.menon@gmail.com", phone=None))
    ).json()
    r = await agency.create_candidate(
        candidate(email="ARJUN.MENON@gmail.com", phone=None, full_name="Someone Else")
    )
    assert r.status_code == 409
    rule = r.json()["rule"]
    assert (
        rule["rule"] == "R-01"
        and rule["link"]["id"] == first["id"]
        and rule["link"]["label"] == "Arjun Menon"
    )


async def test_r01_blocks_phone_in_different_format(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    await agency.create_candidate(candidate(phone="98450 12345"))
    r = await agency.create_candidate(candidate(phone="+91 9845012345"))
    assert r.status_code == 409 and r.json()["rule"]["check"] == "R-01.phone"


async def test_r01_warns_on_same_name_and_employer_but_allows(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    await agency.create_candidate(candidate(full_name="Priya Nair", phone="90000 11111"))
    r = await agency.create_candidate(candidate(full_name="Priya  Nair", phone="90000 22222"))
    assert r.status_code == 201
    assert [w["check"] for w in r.json()["warnings"]] == ["R-01.name-employer"]


async def test_r01_simultaneous_creates_exactly_one_succeeds(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    email = f"race-{uuid.uuid4().hex[:6]}@x.test"
    results = await asyncio.gather(
        *[
            agency.create_candidate(
                candidate(email=email, phone=None, full_name=f"R{i}", current_employer=f"E{i}")
            )
            for i in range(6)
        ]
    )
    codes = sorted(r.status_code for r in results)
    assert codes.count(201) == 1 and codes.count(409) == 5, codes


async def test_form_check_returns_duplicate_warning_without_writing(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    first = (await agency.create_candidate(candidate(email="dup@x.test", phone=None))).json()
    r = await client.post(
        "/v1/records/candidate/check", headers=agency.h(), json={"data": {"email": "DUP@x.test"}}
    )
    outcomes = r.json()["outcomes"]
    assert outcomes[0]["severity"] == "block" and outcomes[0]["link"]["id"] == first["id"]


async def test_history_is_hash_chained_and_tamper_evident(
    client: httpx.AsyncClient, agency: Agency, db: Database
) -> None:
    rid = (await agency.create_candidate(candidate())).json()["id"]
    await client.patch(
        f"/v1/records/candidate/{rid}",
        headers=agency.h(),
        json={"version": 1, "data": {"location": "Pune"}},
    )
    await client.patch(
        f"/v1/records/candidate/{rid}",
        headers=agency.h(),
        json={"version": 2, "data": {"location": "Mumbai"}},
    )
    hist = (await client.get(f"/v1/records/candidate/{rid}/history", headers=agency.h())).json()
    assert [h["action"] for h in hist] == ["create", "update", "update"]
    assert hist[0]["actor_name"].startswith("Owner")
    assert "location" not in hist[1]["before"] and hist[1]["after"]["location"] == "Pune"
    assert hist[2]["after"]["location"] == "Mumbai" and hist[2]["app_version"]
    async with db.tenant(uuid.UUID(agency.tenant_id)) as s:
        entries = await read_history(s, "candidate", uuid.UUID(rid))
    assert verify_chain("candidate", rid, entries)
    tampered = [
        HistoryEntry(**{**e.__dict__, "after": {"location": "Hacked"}}) if e.seq == 2 else e
        for e in entries
    ]
    assert not verify_chain("candidate", rid, tampered)


async def test_history_rows_cannot_be_updated_or_deleted_by_the_app(
    client: httpx.AsyncClient, agency: Agency, db: Database
) -> None:
    await agency.create_candidate(candidate())
    import pytest
    from sqlalchemy.exc import ProgrammingError

    for sql in ("UPDATE record_history SET action = 'x'", "DELETE FROM record_history"):
        with pytest.raises(ProgrammingError):
            async with db.tenant(uuid.UUID(agency.tenant_id)) as s:
                await s.execute(text(sql))


async def test_outbox_relay_is_at_least_once_and_consumers_are_idempotent(
    client: httpx.AsyncClient, agency: Agency, app, db: Database, analytics: Database
) -> None:  # type: ignore[no-untyped-def]
    await agency.create_candidate(candidate())
    published_before = len(app.state.publisher.published)
    sent = await app.state.relay.run_once()
    assert sent >= 1 and len(app.state.publisher.published) == published_before + sent
    assert await app.state.relay.run_once() == 0  # nothing left unpublished
    event = app.state.publisher.published[-1]
    from tableui.insights.public import handle_event

    async with analytics.control() as s:
        before = (await s.execute(text("SELECT count(*) FROM fact_record"))).scalar_one()
    await handle_event(analytics, event)  # duplicate delivery
    await handle_event(analytics, event)
    async with analytics.control() as s:
        after = (await s.execute(text("SELECT count(*) FROM fact_record"))).scalar_one()
        processed = (
            await s.execute(
                text("SELECT count(*) FROM processed_event WHERE event_id = :e"),
                {"e": uuid.UUID(event["event_id"])},
            )
        ).scalar_one()
    assert before == after and processed == 1
