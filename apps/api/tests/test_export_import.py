"""Import and export (N5d): JSON in, three formats out, switches, hidden fields and the emailed link."""

import io
import json
import uuid
from typing import Any

import httpx
from openpyxl import load_workbook  # type: ignore[import-untyped]

from tableui.platform.db import Database
from tableui.platform.mail import InMemoryMailer
from tests.conftest import Agency, candidate
from tests.test_access import _member, _setup


async def _people(a: Agency) -> None:
    for i, (name, status) in enumerate(
        [("Asha Rao", "Active"), ("=cmd|' /C calc'!A0", "Active"), ("Chitra Nair", "Archived")]
    ):
        r = await a.create_candidate(
            candidate(
                full_name=name, status=status, skills=["Python", "SQL"], phone=f"+91 98450 3{i}000"
            )
        )
        assert r.status_code == 201, r.text


async def _export(client: httpx.AsyncClient, a: Agency, **body: Any) -> httpx.Response:
    return await client.post("/v1/records/candidate/export", headers=a.h(), json=body)


async def test_three_formats_follow_the_search_and_are_safe_to_open(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    await _people(agency)
    csv_r = await _export(
        client,
        agency,
        format="csv",
        filters={"status": "Active"},
        sort="full_name",
        direction="asc",
    )
    assert csv_r.status_code == 200 and csv_r.headers["content-type"].startswith("text/csv")
    lines = csv_r.content.decode("utf-8-sig").strip().splitlines()
    assert len(lines) == 3  # header and the two Active people
    assert "'=cmd" in csv_r.text  # a formula is kept as text
    assert "Python; SQL" in csv_r.text
    js = await _export(
        client,
        agency,
        format="json",
        fields=["full_name", "skills"],
        sort="full_name",
        direction="asc",
    )
    rows = json.loads(js.content)
    assert {r["full_name"] for r in rows} >= {
        "Asha Rao",
        "Chitra Nair",
    }  # order depends on collation
    assert rows[0]["skills"] == ["Python", "SQL"]
    assert set(rows[0]) == {"id", "full_name", "skills"}
    xl = await _export(client, agency, format="xlsx", fields=["full_name", "status"])
    ws = load_workbook(io.BytesIO(xl.content)).worksheets[0]
    assert [c.value for c in ws[1]] == ["Full name", "Status"] and ws.max_row == 4
    ids = [r["id"] for r in json.loads(js.content)][:1]
    one = await _export(client, agency, format="json", ids=ids)
    assert len(json.loads(one.content)) == 1
    assert (await _export(client, agency, format="pdf")).status_code == 422


async def test_switches_and_formats_are_enforced(client: httpx.AsyncClient, agency: Agency) -> None:
    await _people(agency)
    r = await client.put(
        "/v1/studio/tables/candidate/features",
        headers=agency.h(),
        json={"export_formats": ["csv"], "export_email": False},
    )
    assert r.status_code == 200, r.text
    await agency.publish_live()
    assert (await _export(client, agency, format="csv")).status_code == 200
    assert (await _export(client, agency, format="xlsx")).status_code == 403
    mail = await client.post(
        "/v1/records/candidate/export/email", headers=agency.h(), json={"format": "csv"}
    )
    assert mail.status_code == 422
    await client.put(
        "/v1/studio/tables/candidate/features", headers=agency.h(), json={"export_data": False}
    )
    await agency.publish_live()
    assert (await _export(client, agency, format="csv")).status_code == 403


async def test_a_hidden_field_never_leaves_in_an_export(
    client: httpx.AsyncClient, db: Database, mailer: InMemoryMailer
) -> None:
    boss = Agency(client, "Export Co", f"x-{uuid.uuid4().hex[:8]}@export.test")
    await boss.sign_up("recruitment")
    await _setup(
        db, boss.tenant_id,
        "INSERT INTO control.tenant_field_deny (tenant_id, role_key, table_key, field_key) "
        "VALUES (:t, 'recruiter', 'candidate', 'expected_ctc') ON CONFLICT DO NOTHING",
    )  # fmt: skip
    await _setup(
        db,
        boss.tenant_id,
        "UPDATE control.tenant_role_scope SET scope = 'all' WHERE tenant_id = :t AND role_key = 'recruiter'",
    )
    rec = await _member(client, boss, mailer, "recruiter")
    r = await boss.create_candidate(candidate(full_name="Rich Person", expected_ctc=1234567))
    assert r.status_code == 201
    assert "1234567" in (await _export(client, boss, format="csv")).text
    out = await _export(client, rec, format="csv")
    assert out.status_code == 200 and "1234567" not in out.text and "Expected" not in out.text
    asked = await _export(client, rec, format="csv", fields=["expected_ctc"])
    assert asked.status_code == 422


async def test_emailed_link_is_signed_expires_and_is_only_for_the_recipient(
    client: httpx.AsyncClient, agency: Agency, mailer: InMemoryMailer, db: Database
) -> None:
    await _people(agency)
    sent = await client.post(
        "/v1/records/candidate/export/email",
        headers=agency.h(),
        json={"format": "csv", "filters": {"status": "Active"}},
    )
    assert sent.status_code == 200, sent.text
    token = mailer.sent[-1]["body"].split("/export/")[1].split()[0]
    got = await client.get(f"/v1/exports/{token}", headers=agency.h())
    assert got.status_code == 200 and "Asha Rao" in got.text and "Chitra" not in got.text
    assert (await client.get(f"/v1/exports/{token}x", headers=agency.h())).status_code == 422
    other = Agency(client, "Other Co", f"o-{uuid.uuid4().hex[:8]}@other.test")
    await other.sign_up("recruitment")
    assert (await client.get(f"/v1/exports/{token}", headers=other.h())).status_code == 403
    ticked = await client.post(
        "/v1/records/candidate/export/email",
        headers=agency.h(),
        json={"format": "csv", "ids": [str(uuid.uuid4())]},
    )
    assert ticked.status_code == 422


async def test_json_files_import_and_the_switch_can_refuse_it(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    data = json.dumps(
        [
            {"Name": "Json One", "E-mail": "j1@example.in", "Key Skills": ["Java", "SQL"]},
            {"Name": "Json Two", "E-mail": "j2@example.in", "Extra": "x"},
        ]
    ).encode()
    up = await client.post(
        "/v1/files",
        headers=agency.h(),
        data={"kind": "import"},
        files={"file": ("people.json", data)},
    )
    assert up.status_code == 201, up.text
    job = await client.post(
        "/v1/imports", headers=agency.h(), json={"file_id": up.json()["id"], "table": "candidate"}
    )
    assert job.status_code == 201, job.text
    assert job.json()["profile"]["rows"] == 2
    assert {c["header"] for c in job.json()["profile"]["columns"]} == {
        "Name",
        "E-mail",
        "Key Skills",
        "Extra",
    }
    bad = await client.post(
        "/v1/files",
        headers=agency.h(),
        data={"kind": "import"},
        files={"file": ("x.json", b'{"a": 1}')},
    )
    assert bad.status_code == 201
    refused = await client.post(
        "/v1/imports", headers=agency.h(), json={"file_id": bad.json()["id"], "table": "candidate"}
    )
    assert refused.status_code == 422
    await client.put(
        "/v1/studio/tables/candidate/features", headers=agency.h(), json={"import_data": False}
    )
    await agency.publish_live()
    off = await client.post(
        "/v1/imports", headers=agency.h(), json={"file_id": up.json()["id"], "table": "candidate"}
    )
    assert off.status_code == 403
