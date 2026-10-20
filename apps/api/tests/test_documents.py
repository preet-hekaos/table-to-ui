"""M1-S11: CV upload, scan before parse (R-14), review with confidence, vendor-down fallback."""

from typing import Any

import httpx

from tableui.files.public import EICAR, UnavailableParser
from tests.conftest import Agency
from tools.cv_corpus import corpus

SAMPLE = corpus(2)[0]  # a PDF with known answers


async def _upload(client: httpx.AsyncClient, a: Agency, name: str, data: bytes) -> dict[str, Any]:
    r = await client.post(
        "/v1/files", headers=a.h(), data={"kind": "cv"}, files={"file": (name, data)}
    )
    assert r.status_code == 201, r.text
    return r.json()  # type: ignore[no-any-return]


async def test_cv_is_scanned_then_read_then_confirmed_into_a_record(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    f = await _upload(client, agency, SAMPLE.name, SAMPLE.data)
    assert f["scan_status"] == "clean" and f["content_type"] == "application/pdf"
    r = await client.post(f"/v1/documents/{f['id']}/parse", headers=agency.h())
    assert r.status_code == 200, r.text
    st = r.json()
    assert st["status"] == "parsed"
    assert st["fields"]["email"]["value"] == SAMPLE.truth["email"]
    assert st["fields"]["email"]["confidence"] >= 0.8
    assert all(st["fields"][k]["confidence"] < 0.8 for k in st["review"])
    t = SAMPLE.truth
    data = {
        "full_name": t["name"],
        "email": t["email"],
        "phone": t["phone"],
        "current_employer": t["employer"],
        "skills": t["skills"],
        "total_experience": t["experience_months"],
    }
    r = await client.post(
        f"/v1/documents/{f['id']}/confirm",
        headers=agency.h(),
        json={"screen": "cv_intake", "data": data},
    )
    assert r.status_code == 201, r.text
    out = r.json()
    cand = (
        await client.get(f"/v1/records/candidate/{out['record']['id']}", headers=agency.h())
    ).json()
    assert cand["data"]["email"] == t["email"]
    doc = (
        await client.get(
            f"/v1/records/candidate_document/{out['document']['id']}", headers=agency.h()
        )
    ).json()
    assert doc["data"]["candidate"] == out["record"]["id"] and doc["data"]["kind"] == "CV"
    assert doc["data"]["scan_status"] == "clean"
    # The CV text is searchable from the document table.
    found = (
        await client.get(
            "/v1/records/candidate_document",
            headers=agency.h(),
            params={"q": t["employer"].split()[0]},
        )
    ).json()
    assert any(x["id"] == out["document"]["id"] for x in found["items"])

    # The same person again: R-01 blocks; the CV can be attached to the existing record instead.
    g = await _upload(client, agency, "again.pdf", SAMPLE.data)
    await client.post(f"/v1/documents/{g['id']}/parse", headers=agency.h())
    dup = await client.post(
        f"/v1/documents/{g['id']}/confirm",
        headers=agency.h(),
        json={"screen": "cv_intake", "data": data},
    )
    assert dup.status_code == 409 and dup.json()["rule"]["rule"] == "R-01"
    attach = await client.post(
        f"/v1/documents/{g['id']}/confirm",
        headers=agency.h(),
        json={"screen": "cv_intake", "existing_id": out["record"]["id"]},
    )
    assert attach.status_code == 201 and attach.json()["record"]["id"] == out["record"]["id"]


async def test_infected_cv_is_never_parsed(client: httpx.AsyncClient, agency: Agency) -> None:
    f = await _upload(client, agency, "bad.pdf", b"%PDF-1.4\n" + EICAR)
    assert f["scan_status"] == "infected"
    r = await client.post(f"/v1/documents/{f['id']}/parse", headers=agency.h())
    assert r.status_code == 422 and "virus scan" in r.json()["detail"]
    r = await client.post(
        f"/v1/documents/{f['id']}/confirm",
        headers=agency.h(),
        json={"screen": "cv_intake", "data": {}},
    )
    assert r.status_code == 422


async def test_parser_down_queues_the_cv_and_fields_can_be_typed(
    client: httpx.AsyncClient, agency: Agency, app: Any
) -> None:
    f = await _upload(client, agency, SAMPLE.name, SAMPLE.data)
    original = app.state.document_parser
    app.state.document_parser = UnavailableParser()
    try:
        r = await client.post(f"/v1/documents/{f['id']}/parse", headers=agency.h())
    finally:
        app.state.document_parser = original
    assert r.status_code == 200 and r.json()["status"] == "queued" and r.json()["fields"] == {}
    r = await client.post(
        f"/v1/documents/{f['id']}/confirm",
        headers=agency.h(),
        json={
            "screen": "cv_intake",
            "data": {
                "full_name": "Typed By Hand",
                "email": "typed.hand@gmail.com",
                "phone": "+91 99999 11111",
            },
        },
    )
    assert r.status_code == 201, r.text
    retry = await client.post(f"/v1/documents/{f['id']}/parse", headers=agency.h())
    assert retry.json()["status"] == "parsed" and retry.json()["attempts"] == 2


async def test_parser_reads_docx_too() -> None:
    from tableui.files.public import RuleParser, sniff

    docx_sample = corpus(2)[1]
    got = await RuleParser().parse(
        sniff(docx_sample.data, docx_sample.name) or "", docx_sample.data
    )
    assert got["fields"]["phone"]["value"] == docx_sample.truth["phone"]
