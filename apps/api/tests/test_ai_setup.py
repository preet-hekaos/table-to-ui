"""M5.5: setup by chat. The AI plans from a fixed list; the Studio does; one click undoes it."""

import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest_asyncio

from tableui.ai.adapters.fake import FakeProvider
from tests.conftest import Agency, candidate
from tests.test_access import _member


@pytest_asyncio.fixture
async def fake(client: httpx.AsyncClient) -> AsyncIterator[FakeProvider]:
    app = client._transport.app  # type: ignore[attr-defined]
    before = app.state.ai_provider
    f = FakeProvider()
    app.state.ai_provider = f
    yield f
    app.state.ai_provider = before


@pytest_asyncio.fixture
async def blank(client: httpx.AsyncClient) -> Agency:
    a = Agency(client, "Fresh Start Co", f"b-{uuid.uuid4().hex[:8]}@fresh.test")
    await a.sign_up()  # no pack chosen: an empty workspace
    return a


PLAN = {
    "reply": "I will add a Projects table with a status.",
    "steps": [
        {
            "op": "table.add",
            "args": {"label": "Project", "plural_label": "Projects"},
            "why": "track work",
        },  # fmt: skip
        {
            "op": "field.add",
            "args": {
                "table": "project",
                "label": "Status",
                "type": "select",
                "options": ["Open", "Done"],
            },
            "why": "see progress",
        },  # fmt: skip
    ],
}


async def _on(client: httpx.AsyncClient, a: Agency) -> None:
    r = await client.put("/v1/ai/settings", headers=a.h(), json={"enabled": True, "tables": []})
    assert r.status_code == 200, r.text


async def _say(client: httpx.AsyncClient, a: Agency, msg: str = "track our projects") -> Any:
    return await client.post("/v1/ai/setup/messages", headers=a.h(), json={"message": msg})


async def _tables(client: httpx.AsyncClient, a: Agency) -> set[str]:
    r = await client.get("/v1/studio/tables", headers=a.h())
    assert r.status_code == 200, r.text
    return {t["key"] for t in r.json()}


async def test_a_new_workspace_builds_its_first_table_from_a_description(
    client: httpx.AsyncClient, blank: Agency, fake: FakeProvider
) -> None:
    await _on(client, blank)
    fake.answer = lambda s, u: PLAN
    assert await _tables(client, blank) == set()
    r = await _say(client, blank)
    assert r.status_code == 200, r.text
    plan = r.json()["plan"]
    assert [x["ok"] for x in plan["steps"]] == [True, True]
    # The dry run changed nothing.
    assert await _tables(client, blank) == set()
    r = await client.post(f"/v1/ai/setup/plans/{plan['id']}/apply", headers=blank.h(), json={"steps": [0, 1]})  # fmt: skip
    assert r.status_code == 200 and r.json()["status"] == "applied", r.text
    assert await _tables(client, blank) == {"project"}
    screens = (await client.get("/v1/studio/screens", headers=blank.h())).json()
    nav = (await client.get("/v1/studio/navigation", headers=blank.h())).json()
    assert [s["key"] for s in screens] == ["project_list"] and [n["label"] for n in nav] == ["Projects"]  # fmt: skip


async def test_undo_puts_the_draft_back_and_frees_the_name(
    client: httpx.AsyncClient, blank: Agency, fake: FakeProvider
) -> None:
    await _on(client, blank)
    fake.answer = lambda s, u: PLAN
    pid = (await _say(client, blank)).json()["plan"]["id"]
    await client.post(f"/v1/ai/setup/plans/{pid}/apply", headers=blank.h(), json={"steps": [0, 1]})
    r = await client.post(f"/v1/ai/setup/plans/{pid}/undo", headers=blank.h())
    assert r.status_code == 200 and r.json()["status"] == "undone", r.text
    assert await _tables(client, blank) == set()
    assert (await client.get("/v1/studio/navigation", headers=blank.h())).json() == []
    again = await client.post(f"/v1/ai/setup/plans/{pid}/undo", headers=blank.h())
    assert again.status_code == 409
    # The same table can be planned and applied again after an undo.
    pid2 = (await _say(client, blank)).json()["plan"]["id"]
    r = await client.post(f"/v1/ai/setup/plans/{pid2}/apply", headers=blank.h(), json={"steps": [0, 1]})  # fmt: skip
    assert r.status_code == 200, r.text


async def test_undo_is_refused_once_the_app_changed_after_the_plan(
    client: httpx.AsyncClient, blank: Agency, fake: FakeProvider
) -> None:
    await _on(client, blank)
    fake.answer = lambda s, u: PLAN
    pid = (await _say(client, blank)).json()["plan"]["id"]
    await client.post(f"/v1/ai/setup/plans/{pid}/apply", headers=blank.h(), json={"steps": [0, 1]})
    r = await client.post("/v1/studio/tables/project/fields", headers=blank.h(), json={"label": "Notes", "type": "text"})  # fmt: skip
    assert r.status_code == 201
    r = await client.post(f"/v1/ai/setup/plans/{pid}/undo", headers=blank.h())
    assert r.status_code == 409 and "changed" in r.json()["detail"]
    assert await _tables(client, blank) == {"project"}


async def test_a_failing_step_is_shown_and_blocks_the_whole_apply(
    client: httpx.AsyncClient, agency: Agency, fake: FakeProvider
) -> None:
    await _on(client, agency)
    before = await _tables(client, agency)
    fake.answer = lambda s, u: {
        "reply": "Two changes.",
        "steps": [
            {"op": "table.add", "args": {"label": "Project"}, "why": "x"},
            # A pack field's type cannot be changed.
            {
                "op": "field.change",
                "args": {"table": "candidate", "field": "email", "type": "text"},
                "why": "x",
            },  # fmt: skip
        ],
    }
    plan = (await _say(client, agency)).json()["plan"]
    assert [x["ok"] for x in plan["steps"]] == [True, False]
    assert plan["steps"][1]["error"]
    r = await client.post(f"/v1/ai/setup/plans/{plan['id']}/apply", headers=agency.h(), json={"steps": [0, 1]})  # fmt: skip
    assert r.status_code == 409 and "Nothing was changed" in r.json()["detail"]
    assert await _tables(client, agency) == before
    # Ticking only the good step works.
    r = await client.post(f"/v1/ai/setup/plans/{plan['id']}/apply", headers=agency.h(), json={"steps": [0]})  # fmt: skip
    assert r.status_code == 200
    assert await _tables(client, agency) == before | {"project"}


async def test_only_listed_operations_are_accepted(
    client: httpx.AsyncClient, blank: Agency, fake: FakeProvider
) -> None:
    await _on(client, blank)
    fake.answer = lambda s, u: {"reply": "ok", "steps": [{"op": "sql.run", "args": {"q": "drop table x"}}]}  # fmt: skip
    r = await _say(client, blank)
    assert r.status_code == 503 and r.json()["type"].endswith("ai-unavailable")
    fake.answer = lambda s, u: {"reply": "ok", "steps": [{"op": "field.add", "args": {"table": "t", "label": "x", "type": "text"}}] * 21}  # fmt: skip
    assert (await _say(client, blank)).status_code == 503


async def test_a_question_gets_an_answer_and_no_plan(
    client: httpx.AsyncClient, blank: Agency, fake: FakeProvider
) -> None:
    await _on(client, blank)
    fake.answer = lambda s, u: {"reply": "You have no tables yet.", "steps": []}
    body = (await _say(client, blank, "what do I have?")).json()
    assert body["plan"] is None and body["reply"].startswith("You have")
    state = (await client.get("/v1/ai/setup", headers=blank.h())).json()
    assert [m["role"] for m in state["messages"]] == ["user", "assistant"]
    assert state["open_plan"] is None


async def test_a_new_plan_replaces_the_open_one_and_history_is_capped(
    client: httpx.AsyncClient, blank: Agency, fake: FakeProvider
) -> None:
    await _on(client, blank)
    fake.answer = lambda s, u: PLAN
    first = (await _say(client, blank, "one")).json()["plan"]["id"]
    second = (await _say(client, blank, "two")).json()["plan"]["id"]
    r = await client.post(f"/v1/ai/setup/plans/{first}/apply", headers=blank.h(), json={"steps": [0]})  # fmt: skip
    assert r.status_code == 409
    assert (await client.get("/v1/ai/setup", headers=blank.h())).json()["open_plan"]["id"] == second
    for i in range(8):
        await _say(client, blank, f"msg {i}")
    assert fake.calls[-1][1].count("\nOwner: ") + fake.calls[-1][1].count("Owner: ") <= 10


async def test_the_planner_never_sees_records(
    client: httpx.AsyncClient, agency: Agency, fake: FakeProvider
) -> None:
    await _on(client, agency)
    mark = f"zz{uuid.uuid4().hex[:6]}@secret.test"
    assert (await agency.create_candidate(candidate(email=mark))).status_code == 201
    fake.answer = lambda s, u: {"reply": "Nothing to change.", "steps": []}
    await _say(client, agency, "add a table")
    system, user = fake.calls[-1]
    assert mark not in user and mark not in system and "candidate" in user


async def test_setup_needs_its_own_permission_and_the_ai_switch(
    client: httpx.AsyncClient, agency: Agency, fake: FakeProvider, mailer: Any
) -> None:
    fake.answer = lambda s, u: PLAN
    off = await _say(client, agency)
    assert off.status_code == 409 and off.json()["type"].endswith("ai-off")
    await _on(client, agency)
    rec = await _member(client, agency, mailer, "recruiter")
    assert (await client.get("/v1/ai/setup", headers=rec.h())).status_code == 403
    assert (await _say(client, rec)).status_code == 403
    assert (await client.get("/v1/ai/setup", headers=agency.h())).status_code == 200
