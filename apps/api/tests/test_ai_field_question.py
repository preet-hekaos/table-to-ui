"""Ask about one field: an answer from its own settings; reads only, nothing is saved."""

import httpx

from tableui.ai.adapters.fake import FakeProvider, demo_answer
from tests.conftest import Agency, candidate
from tests.test_ai_setup import _on, fake  # noqa: F401 - the fixture is shared


async def _ask(
    client: httpx.AsyncClient, a: Agency, q: str, field: str = "location"
) -> httpx.Response:
    return await client.post(
        "/v1/ai/field-question",
        headers=a.h(),
        json={"table": "candidate", "field": field, "question": q},
    )


async def test_ai_off_says_so(
    client: httpx.AsyncClient,
    agency: Agency,
    fake: FakeProvider,  # noqa: F811
) -> None:
    r = await _ask(client, agency, "What is this?")
    assert r.status_code == 409 and "switched off" in r.text


async def test_the_answer_comes_from_the_field_settings_and_nothing_changes(
    client: httpx.AsyncClient,
    agency: Agency,
    fake: FakeProvider,  # noqa: F811
) -> None:
    a = agency
    await _on(client, a)
    fake.answer = demo_answer
    before = (await client.get("/v1/studio/tables/candidate", headers=a.h())).text
    r = await _ask(client, a, "What if it is blank?")
    assert r.status_code == 200, r.text
    assert "optional" in r.json()["text"] or "required" in r.json()["text"]
    assert (await client.get("/v1/studio/tables/candidate", headers=a.h())).text == before


async def test_the_model_sees_the_settings_and_counts_but_no_record_values(
    client: httpx.AsyncClient,
    agency: Agency,
    fake: FakeProvider,  # noqa: F811
) -> None:
    a = agency
    await _on(client, a)
    seen: list[str] = []

    def spy(system: str, user: str) -> object:
        seen.append(user)
        return {"text": "ok"}

    fake.answer = spy
    r = await a.create_candidate(
        candidate(full_name="Zed Secretname", phone="+91 98450 11111", location="Pune")
    )
    assert r.status_code == 201, r.text
    assert (await _ask(client, a, "Who can see it?")).status_code == 200
    assert "Secretname" not in seen[0] and "Pune" not in seen[0]
    assert '"filled": 1' in seen[0]


async def test_bad_replies_and_unknown_fields_are_refused(
    client: httpx.AsyncClient,
    agency: Agency,
    fake: FakeProvider,  # noqa: F811
) -> None:
    a = agency
    await _on(client, a)
    fake.answer = lambda s, u: {"nothing": 1}
    assert (await _ask(client, a, "Why?")).status_code == 503
    fake.answer = demo_answer
    assert (await _ask(client, a, "Why?", field="nope")).status_code == 404
    assert (await _ask(client, a, "")).status_code == 422
