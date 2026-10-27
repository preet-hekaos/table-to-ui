"""N6c: a document that describes data becomes a proposal in Import schema. Fake provider only."""

import io
import json
from collections.abc import AsyncIterator
from typing import Any

import docx
import httpx
import pytest_asyncio

from tableui.ai.adapters.fake import FakeProvider, demo_answer
from tableui.platform.mail import InMemoryMailer
from tests.conftest import Agency
from tests.test_access import _member

DOC = (
    "Clients: Name, City, Email\n"
    "Jobs: Title, Client, Start date\n"
    "Please keep these. Contact: owner@firm.test or +91 98450 12345.\n"
)


@pytest_asyncio.fixture
async def fake(client: httpx.AsyncClient) -> AsyncIterator[FakeProvider]:
    app = client._transport.app  # type: ignore[attr-defined]
    before = app.state.ai_provider
    f = FakeProvider(demo_answer)
    app.state.ai_provider = f
    yield f
    app.state.ai_provider = before


async def _on(client: httpx.AsyncClient, a: Agency) -> None:
    r = await client.put("/v1/ai/settings", headers=a.h(), json={"enabled": True, "tables": []})
    assert r.status_code == 200, r.text


async def _post(client: httpx.AsyncClient, a: Agency, name: str, data: bytes) -> httpx.Response:
    return await client.post(
        "/v1/ai/schema-from-document", headers=a.h(), files={"file": (name, data)}
    )


async def test_a_text_document_becomes_a_schema_that_previews_with_a_link(
    client: httpx.AsyncClient, agency: Agency, fake: FakeProvider
) -> None:
    await _on(client, agency)
    r = await _post(client, agency, "plan.txt", DOC.encode())
    assert r.status_code == 200, r.text
    out = r.json()
    assert (out["tables"], out["fields"], out["dropped"]) == (2, 6, 0)
    defs = out["schema"]["$defs"]
    assert set(defs) == {"clients", "jobs"}
    assert defs["jobs"]["properties"]["client"]["$ref"] == "#/$defs/clients"
    assert defs["clients"]["properties"]["email"]["x-field-type"] == "email"
    # the same file goes through the normal preview, where the person checks it
    prev = await client.post(
        "/v1/studio/schema-import/preview",
        headers=agency.h(),
        files=[("files", ("plan.json", json.dumps(out["schema"]).encode(), "application/json"))],
    )
    tables = {t["key"]: t for t in prev.json()["tables"]}
    link = next(f for f in tables["jobs"]["fields"] if f["key"] == "client")["link"]
    assert link["to"] == "clients"
    assert next(f for f in tables["clients"]["fields"] if f["key"] == "email")["type"] == "email"
    listed = await client.get("/v1/studio/tables", headers=agency.h())
    assert "jobs" not in [t["key"] for t in listed.json()]  # nothing was created


async def test_contact_details_never_reach_the_model(
    client: httpx.AsyncClient, agency: Agency, fake: FakeProvider
) -> None:
    await _on(client, agency)
    await _post(client, agency, "plan.txt", DOC.encode())
    sent = fake.calls[-1][1]
    assert "owner@firm.test" not in sent and "98450" not in sent


async def test_a_word_file_is_read_too(
    client: httpx.AsyncClient, agency: Agency, fake: FakeProvider
) -> None:
    await _on(client, agency)
    d = docx.Document()
    for line in DOC.splitlines():
        d.add_paragraph(line)
    buf = io.BytesIO()
    d.save(buf)
    r = await _post(client, agency, "plan.docx", buf.getvalue())
    assert r.status_code == 200 and r.json()["tables"] == 2


async def test_what_the_document_does_not_say_is_dropped(
    client: httpx.AsyncClient, agency: Agency, fake: FakeProvider
) -> None:
    await _on(client, agency)
    reply: dict[str, Any] = {
        "tables": [
            {
                "label": "Clients",
                "quote": "Clients",
                "fields": [
                    {"label": "Name", "type": "text", "quote": "Name"},
                    {"label": "Salary", "type": "money", "quote": "Salary is secret"},
                ],
            },
            {
                "label": "Invented",
                "quote": "Not in the document",
                "fields": [{"label": "X", "quote": "X"}],
            },
        ]
    }
    fake.answer = lambda s, u: reply
    r = await _post(client, agency, "plan.txt", DOC.encode())
    assert r.status_code == 200, r.text
    out = r.json()
    assert (out["tables"], out["fields"], out["dropped"]) == (1, 1, 2)
    fake.answer = lambda s, u: {"tables": [reply["tables"][1]]}
    bad = await _post(client, agency, "other.txt", b"Something else entirely, nothing here at all.")
    assert bad.status_code >= 400  # nothing supported by a quote: no proposal


async def test_checks_before_the_model_is_asked(
    client: httpx.AsyncClient, agency: Agency, fake: FakeProvider, mailer: InMemoryMailer
) -> None:
    off = await _post(client, agency, "plan.txt", DOC.encode())
    assert off.status_code >= 400 and not fake.calls  # AI is off by default
    await _on(client, agency)
    empty = await _post(client, agency, "blank.pdf", b"%PDF-1.4\n%%EOF")
    assert empty.status_code == 422 and not fake.calls
    huge = await _post(client, agency, "big.txt", b"x" * 5_000_100)
    assert huge.status_code == 422
    viewer = await _member(client, agency, mailer, "viewer")
    denied = await _post(client, viewer, "plan.txt", DOC.encode())
    assert denied.status_code == 403
