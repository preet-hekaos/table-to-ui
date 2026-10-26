"""Schema import (N4): CSV, Excel, JSON and SQL files become Draft tables, only after a preview."""

import io
import json
import zipfile
from pathlib import Path
from typing import Any

import httpx
import pytest
from openpyxl import Workbook  # type: ignore[import-untyped]

from tableui.imports.domain import schema_read as sr
from tableui.platform.mail import InMemoryMailer
from tests.conftest import Agency
from tests.test_workspace_admin import _team_mate

SAMPLES = Path(__file__).resolve().parents[3] / "samples" / "schema"


def _read(name: str, data: bytes) -> list[dict[str, Any]]:
    return sr.combine(sr.read_schema(name, "", data), set())


def _fields(t: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {f["key"]: f for f in t["fields"]}


def _xlsx(sheets: dict[str, list[list[Any]]]) -> bytes:
    wb = Workbook()
    wb.remove(wb.active)
    for name, rows in sheets.items():
        ws = wb.create_sheet(name)
        for r in rows:
            ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ---- readers ----------------------------------------------------------------------------------


def test_csv_with_only_a_header_is_schema_only() -> None:
    (t,) = _read("candidates.csv", b"Full name,Email,Phone,Status\n")
    assert t["key"] == "candidates" and t["rows"] == 0
    f = _fields(t)
    assert f["email"]["type"] == "email" and f["phone"]["type"] == "phone"
    assert t["title_key"] == "full_name"


def test_csv_with_rows_detects_types_and_counts_rows() -> None:
    body = "Name,Joined,Age,Active\n" + "\n".join(
        f"P{i},2026-01-{i % 28 + 1:02d},{20 + i},{'yes' if i % 2 else 'no'}" for i in range(30)
    )
    (t,) = _read("people.csv", body.encode())
    f = _fields(t)
    assert t["rows"] == 30
    assert (f["joined"]["type"], f["age"]["type"], f["active"]["type"]) == (
        "date",
        "integer",
        "boolean",
    )


def test_csv_messy_headers_encodings_and_the_id_column() -> None:
    raw = "id,Name,Name,Café\n1,a,b,c\n".encode("cp1252")
    (t,) = _read("messy.csv", raw)
    keys = [f["key"] for f in t["fields"]]
    assert "id" not in keys and len(keys) == len(set(keys))
    assert any("id is skipped" in w for w in t["warnings"])


def test_a_csv_with_hundreds_of_columns_is_capped() -> None:
    header = ",".join(f"c{i}" for i in range(500))
    (t,) = _read("wide.csv", (header + "\n").encode())
    assert len(t["fields"]) == sr.MAX_COLUMNS
    assert any("first" in w for w in t["warnings"])


def test_excel_each_sheet_is_a_table_formulas_are_text_and_links_are_found() -> None:
    data = _xlsx(
        {
            "Clients": [["Name", "City"], ["Acme", "Pune"]],
            "Jobs": [["Title", "Client id"], ["Sales", 1], ["Ops", "=SUM(1,2)"]],
            "Empty": [],
        }
    )
    ts = _read("book.xlsx", data)
    assert [t["key"] for t in ts] == ["clients", "jobs"]
    jobs = _fields(ts[1])
    assert jobs["client_id"]["link"]["to"] == "clients"
    assert ts[1]["rows"] == 2


def test_an_excel_zip_bomb_is_refused() -> None:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("big.bin", b"\0" * (sr.MAX_UNZIPPED + 1_000_000))
    with pytest.raises(sr.SchemaError, match="too large"):
        sr.read_schema("bomb.xlsx", "", buf.getvalue())


def test_json_list_of_objects_and_nested_values() -> None:
    doc = [
        {"name": "A", "age": 3, "tags": ["x", "y"], "address": {"city": "Pune"}},
        {"name": "B", "age": 4, "tags": [], "address": {"city": "Goa"}},
    ]
    (t,) = _read("people.json", json.dumps(doc).encode())
    f = _fields(t)
    assert f["age"]["type"] == "integer" and f["tags"]["type"] == "tags"
    assert "address" not in f and any("nested" in w for w in t["warnings"])
    assert t["rows"] == 2


def test_json_schema_reads_required_enums_formats_and_refs() -> None:
    ts = _read("employee-schema.json", (SAMPLES / "employee-schema.json").read_bytes())
    emp = next(t for t in ts if t["key"] == "employee")
    f = _fields(emp)
    assert f["email"]["type"] == "email" and f["email"]["required"] is True
    assert f["grade"]["type"] == "select" and f["grade"]["options"] == ["A", "B", "C"]
    assert f["team"]["link"]["to"] == "team"
    assert emp["rows"] == 0


def test_sql_reads_columns_keys_checks_and_insert_counts_without_running_anything() -> None:
    ts = _read("hiring-schema.sql", (SAMPLES / "hiring-schema.sql").read_bytes())
    assert [t["key"] for t in ts] == ["clients", "jobs", "applicants"]
    clients, jobs, applicants = ts
    assert clients["rows"] == 2 and jobs["rows"] == 0
    assert _fields(clients)["status"]["options"] == ["Prospect", "Active", "Dormant"]
    assert _fields(clients)["name"]["required"] is True
    assert _fields(jobs)["client"]["link"] == {"to": "clients", "reason": "foreign key"}
    assert _fields(applicants)["job"]["link"]["to"] == "jobs"


def test_sql_without_a_table_and_other_hostile_input_is_refused_plainly() -> None:
    with pytest.raises(sr.SchemaError):
        sr.read_schema("x.sql", "", b"DROP TABLE users; SELECT 1;")
    with pytest.raises(sr.SchemaError):
        sr.read_schema("x.sql", "", b"CREATE TABLE ((((")
    with pytest.raises(sr.SchemaError, match="empty"):
        sr.read_schema("x.csv", "", b"   ")
    with pytest.raises(sr.SchemaError, match="larger"):
        sr.read_schema("x.csv", "", b"a\n" * 3_000_000)
    with pytest.raises(sr.SchemaError, match="not supported"):
        sr.read_schema("x.pdf", "application/pdf", b"%PDF-1.7")
    with pytest.raises(sr.SchemaError):
        sr.read_schema("x.json", "", b"[" * 100_000)
    with pytest.raises(sr.SchemaError):
        sr.read_schema("x.json", "", b"[1, 2, 3]")


def test_a_name_that_already_exists_is_renamed_and_said_so() -> None:
    ts = sr.combine(sr.read_schema("candidate.csv", "", b"Name\n"), {"candidate"})
    assert ts[0]["key"] == "candidate_2"
    assert any("already exists" in w for w in ts[0]["warnings"])


def test_links_need_a_matching_table_in_the_same_import() -> None:
    (t,) = _read("jobs.csv", b"Title,Client id\n")
    assert _fields(t)["client_id"]["link"] is None


# ---- the API ------------------------------------------------------------------------------------


def _files(*names: str) -> list[tuple[str, tuple[str, bytes, str]]]:
    return [("files", (n, (SAMPLES / n).read_bytes(), "application/octet-stream")) for n in names]


async def test_preview_saves_nothing_and_apply_creates_exactly_the_previewed_tables(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    before = (await client.get("/v1/studio/tables", headers=a.h())).json()
    r = await client.post(
        "/v1/studio/schema-import/preview", headers=a.h(), files=_files("hiring-schema.sql")
    )
    assert r.status_code == 200, r.text
    proposal = r.json()
    assert [t["key"] for t in proposal["tables"]] == ["clients", "jobs", "applicants"]
    assert (await client.get("/v1/studio/tables", headers=a.h())).json() == before

    # The person edits one type and accepts the links, then confirms.
    tables = proposal["tables"]
    for t in tables:
        for f in t["fields"]:
            if f["link"]:
                f["type"], f["ref_table"] = "reference", f["link"]["to"]
    next(f for f in tables[1]["fields"] if f["key"] == "openings")["type"] = "decimal"
    r = await client.post("/v1/studio/schema-import/apply", headers=a.h(), json={"tables": tables})
    assert r.status_code == 201, r.text
    assert r.json()["tables"] == ["clients", "jobs", "applicants"]

    after = {t["key"]: t for t in (await client.get("/v1/studio/tables", headers=a.h())).json()}
    assert {"clients", "jobs", "applicants"} <= set(after)
    jobs = {f["key"]: f for f in after["jobs"]["fields"]}
    assert jobs["client"]["type"] == "reference" and jobs["client"]["ref_table"] == "clients"
    assert jobs["openings"]["type"] == "decimal" and jobs["title"]["required"] is True
    assert after["clients"]["title_field"] == "name"
    assert all(t["source"] == "agency" for t in (after[k] for k in ("clients", "jobs")))

    # They are Draft only: nothing in the live app, and no record anywhere.
    live = await client.get("/v1/app/tables/clients", headers=a.h())
    assert live.status_code == 404
    status = (await client.get("/v1/studio/status", headers=a.h())).json()
    assert {c["key"] for c in status["changes"]["tables"]} >= {"clients", "jobs", "applicants"}


async def test_the_other_samples_preview(client: httpx.AsyncClient, agency: Agency) -> None:
    r = await client.post(
        "/v1/studio/schema-import/preview",
        headers=agency.h(),
        files=_files(
            "hiring-workbook.xlsx", "recruitment-headers-only.csv", "employee-schema.json"
        ),
    )
    assert r.status_code == 200, r.text
    keys = [t["key"] for t in r.json()["tables"]]
    assert keys == [
        "clients",
        "requirements",
        "tags",
        "recruitment_headers_only",
        "employee",
        "team",
    ]
    assert r.json()["problems"] == []


async def test_a_bad_file_is_reported_without_blocking_the_good_one(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    files = [
        *_files("recruitment-headers-only.csv"),
        ("files", ("notes.pdf", b"%PDF-1.7", "application/pdf")),
    ]
    r = await client.post("/v1/studio/schema-import/preview", headers=agency.h(), files=files)
    body = r.json()
    assert len(body["tables"]) == 1
    assert (
        body["problems"][0]["file"] == "notes.pdf"
        and "not supported" in body["problems"][0]["message"]
    )


async def test_apply_is_all_or_nothing_and_refuses_a_name_that_exists(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    good = {"key": "gadget", "label": "Gadget", "title_key": "name", "fields": [
        {"key": "name", "label": "Name", "type": "text"}]}  # fmt: skip
    clash = {"key": "candidate", "label": "Candidate", "title_key": "name", "fields": [
        {"key": "name", "label": "Name", "type": "text"}]}  # fmt: skip
    r = await client.post(
        "/v1/studio/schema-import/apply", headers=a.h(), json={"tables": [good, clash]}
    )
    assert r.status_code == 422
    keys = {t["key"] for t in (await client.get("/v1/studio/tables", headers=a.h())).json()}
    assert "gadget" not in keys
    r = await client.post("/v1/studio/schema-import/apply", headers=a.h(), json={"tables": []})
    assert r.status_code == 422


async def test_only_people_who_can_edit_the_studio_may_import_a_schema(
    client: httpx.AsyncClient, agency: Agency, mailer: InMemoryMailer
) -> None:
    viewer, _ = await _team_mate(client, agency, mailer, "sourcer")
    r = await client.post(
        "/v1/studio/schema-import/preview",
        headers=viewer.h(),
        files=_files("recruitment-headers-only.csv"),
    )
    assert r.status_code == 403
    r = await client.post("/v1/studio/schema-import/apply", headers=viewer.h(), json={"tables": []})
    assert r.status_code == 403


async def test_imported_tables_stay_inside_their_own_workspace(
    client: httpx.AsyncClient, agency: Agency, other_agency: Agency
) -> None:
    r = await client.post(
        "/v1/studio/schema-import/preview", headers=agency.h(), files=_files("hiring-schema.sql")
    )
    r = await client.post(
        "/v1/studio/schema-import/apply", headers=agency.h(), json={"tables": r.json()["tables"]}
    )
    assert r.status_code == 201, r.text
    theirs = {
        t["key"] for t in (await client.get("/v1/studio/tables", headers=other_agency.h())).json()
    }
    assert "clients" not in theirs and "jobs" not in theirs
