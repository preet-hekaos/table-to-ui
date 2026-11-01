"""S5.3: describe a transformation rule in words. A suggestion only; the engine checks every rule and runs the examples."""

import httpx

from tableui.ai.adapters.fake import FakeProvider, demo_answer
from tests.conftest import Agency
from tests.test_ai_setup import _on, fake  # noqa: F401 - the fixture is shared


async def _ask(
    client: httpx.AsyncClient, a: Agency, text: str, ftype: str = "integer"
) -> httpx.Response:
    return await client.post(
        "/v1/ai/transform",
        headers=a.h(),
        json={"description": text, "label": "Notice period", "type": ftype},
    )


async def test_ai_off_says_so(
    client: httpx.AsyncClient,
    agency: Agency,
    fake: FakeProvider,  # noqa: F811
) -> None:
    r = await _ask(client, agency, "if it says two months, save 60")
    assert r.status_code == 409 and "switched off" in r.text


async def test_a_described_rule_comes_back_checked_and_nothing_is_saved(
    client: httpx.AsyncClient,
    agency: Agency,
    fake: FakeProvider,  # noqa: F811
) -> None:
    a = agency
    await _on(client, a)
    fake.answer = demo_answer
    r = await _ask(client, a, "if it says two months, save 60")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["rules"][0]["when"] == "equals_any" and body["rules"][0]["value"] == "60"
    outs = {s["input"]: s["output"] for s in body["samples"]}
    assert outs["two months"] == 60 and outs["something else"] == "something else"
    cand = next(
        t
        for t in (await client.get("/v1/studio/tables", headers=a.h())).json()
        if t["key"] == "candidate"
    )
    assert all(not f.get("transforms") for f in cand["fields"])


async def test_an_unusable_reply_is_refused_not_passed_on(
    client: httpx.AsyncClient,
    agency: Agency,
    fake: FakeProvider,  # noqa: F811
) -> None:
    a = agency
    await _on(client, a)
    fake.answer = lambda s, u: {
        "rules": [{"when": "matches", "args": ["("], "do": "trim"}],
        "explanation": "x",
        "tries": [],
    }
    r = await _ask(client, a, "anything")
    assert r.status_code >= 400
