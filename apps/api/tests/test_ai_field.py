"""Describe a new field in words: a suggestion only; the engine checks it and nothing is saved."""

import httpx

from tableui.ai.adapters.fake import FakeProvider, demo_answer
from tests.conftest import Agency
from tests.test_ai_setup import _on, fake  # noqa: F401 - the fixture is shared


async def _ask(client: httpx.AsyncClient, a: Agency, text: str) -> httpx.Response:
    return await client.post("/v1/ai/field", headers=a.h(), json={"description": text})


async def test_ai_off_says_so(
    client: httpx.AsyncClient,
    agency: Agency,
    fake: FakeProvider,  # noqa: F811
) -> None:
    r = await _ask(client, agency, "PAN number")
    assert r.status_code == 409 and "switched off" in r.text


async def test_a_described_field_comes_back_checked_and_nothing_is_saved(
    client: httpx.AsyncClient,
    agency: Agency,
    fake: FakeProvider,  # noqa: F811
) -> None:
    a = agency
    await _on(client, a)
    fake.answer = demo_answer
    r = await _ask(client, a, "PAN number, required")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["preset"] == "pan_in" and body["type"] == "text" and body["required"] is True
    assert body["max_length"] == 10 and body["type_name"] == "PAN (India)"
    fields = (await client.get("/v1/studio/tables/candidate", headers=a.h())).text
    assert "PAN number" not in fields


async def test_the_engine_refuses_what_is_not_a_real_type_or_empty_choices(
    client: httpx.AsyncClient,
    agency: Agency,
    fake: FakeProvider,  # noqa: F811
) -> None:
    a = agency
    await _on(client, a)
    fake.answer = lambda s, u: {"label": "X", "preset": "nope", "explanation": "x"}
    assert (await _ask(client, a, "something")).status_code == 503
    fake.answer = lambda s, u: {"label": "X", "type": "select", "options": [], "explanation": "x"}
    assert (await _ask(client, a, "something")).status_code == 503
    fake.answer = lambda s, u: {"label": "X", "type": "hologram", "explanation": "x"}
    assert (await _ask(client, a, "something")).status_code == 503
    assert (await _ask(client, a, "")).status_code == 422
