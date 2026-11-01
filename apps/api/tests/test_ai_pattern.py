"""S3.5: describe a validation pattern in words. A suggestion only; the engine decides what is usable."""

import httpx

from tableui.ai.adapters.fake import FakeProvider, demo_answer
from tests.conftest import Agency
from tests.test_ai_setup import _on, fake  # noqa: F401 - the fixture is shared


async def _ask(client: httpx.AsyncClient, a: Agency, text: str) -> httpx.Response:
    return await client.post("/v1/ai/pattern", headers=a.h(), json={"description": text})


async def test_with_ai_off_the_pattern_helper_says_so_and_the_library_still_works(
    client: httpx.AsyncClient,
    agency: Agency,
    fake: FakeProvider,  # noqa: F811
) -> None:
    a = agency
    r = await _ask(client, a, "5 capital letters")
    assert r.status_code == 409 and "switched off" in r.text
    lib = await client.get("/v1/studio/validation-library", headers=a.h())
    assert lib.status_code == 200 and lib.json()


async def test_a_described_pattern_comes_back_checked_and_nothing_is_saved(
    client: httpx.AsyncClient,
    agency: Agency,
    fake: FakeProvider,  # noqa: F811
) -> None:
    a = agency
    await _on(client, a)
    fake.answer = demo_answer
    r = await _ask(client, a, "5 capital letters, then 4 digits, then 1 capital letter")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["pattern"] == "^[A-Z]{5}[0-9]{4}[A-Z]{1}$"
    allowed = {s["value"]: s["allowed"] for s in body["samples"]}
    assert allowed["AAAAA1111A"] is True and allowed["aaaaa1111a"] is False
    fields = (await client.get("/v1/studio/tables", headers=a.h())).json()
    candidate_t = next(t for t in fields if t["key"] == "candidate")
    assert all(not f.get("rules") for f in candidate_t["fields"])
    status = (await client.get("/v1/studio/status", headers=a.h())).json()
    assert status["draft_changed"] is False


async def test_an_unsafe_or_wrong_answer_from_the_model_is_thrown_away(
    client: httpx.AsyncClient,
    agency: Agency,
    fake: FakeProvider,  # noqa: F811
) -> None:
    a = agency
    await _on(client, a)
    fake.answer = lambda s, u: {"pattern": "(a+)+$", "explanation": "x", "good": ["aa"], "bad": []}
    r = await _ask(client, a, "many letters")
    assert r.status_code == 503
    fake.answer = lambda s, u: {
        "pattern": "^[0-9]+$",
        "explanation": "digits",
        "good": ["abc"],  # the model claims a sample the pattern refuses
        "bad": [],
    }
    r = await _ask(client, a, "digits only")
    assert r.status_code == 503
    fake.answer = lambda s, u: {
        "pattern": "^[0-9]+$",
        "explanation": "digits",
        "good": ["123", "abc"],  # one false claim is dropped, the true one is kept
        "bad": ["abc", "456"],
    }
    r = await _ask(client, a, "digits only")
    assert r.status_code == 200, r.text
    assert {(s["value"], s["allowed"]) for s in r.json()["samples"]} == {
        ("123", True),
        ("abc", False),
    }
    assert (await _ask(client, a, "")).status_code == 422
