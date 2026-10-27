"""Export schema (N6a): the Draft's tables, fields and links as JSON Schema, SQL or a field list."""

import csv
import io
import json
from typing import Any

import httpx

from tableui.imports.domain import schema_read as sr
from tests.conftest import Agency


async def _get(client: httpx.AsyncClient, a: Agency, **params: str) -> httpx.Response:
    return await client.get("/v1/studio/schema-import/export", headers=a.h(), params=params)


def _fields(t: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {f["key"]: f for f in t["fields"]}


async def test_json_export_reads_back_with_types_and_links(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    r = await _get(client, agency, format="json")
    assert r.status_code == 200 and "schema.json" in r.headers["content-disposition"]
    doc = json.loads(r.text)
    assert {"candidate", "client", "requirement"} <= set(doc["$defs"])
    assert doc["$defs"]["requirement"]["properties"]["client"]["$ref"] == "#/$defs/client"
    back = {t["key"]: t for t in sr.combine(sr.read_schema("schema.json", "", r.content), set())}
    assert len(back) == len(doc["$defs"])
    cand = _fields(back["candidate"])
    assert cand["email"]["type"] == "email" and cand["phone"]["type"] == "phone"
    assert _fields(back["requirement"])["client"]["link"]["to"] == "client"


async def test_sql_export_reads_back(client: httpx.AsyncClient, agency: Agency) -> None:
    r = await _get(client, agency, format="sql")
    assert r.status_code == 200 and "CREATE TABLE candidate" in r.text
    back = {t["key"]: t for t in sr.combine(sr.read_schema("schema.sql", "", r.content), set())}
    assert {"candidate", "client", "requirement"} <= set(back)
    assert _fields(back["requirement"])["client"]["link"]["to"] == "client"
    status = _fields(back["candidate"])["status"]
    assert status["type"] == "select" and status["options"]


async def test_csv_lists_fields_and_neutralises_formulas(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    r = await _get(client, agency, format="csv", tables="client")
    rows = list(csv.reader(io.StringIO(r.text.lstrip("﻿"))))
    assert rows[0][:3] == ["Table", "Field", "Key"]
    assert {row[0] for row in rows[1:]} == {"Client"}
    assert any(row[2] == "name" for row in rows[1:])
    from tableui.imports.application.schema_export import _cell

    assert _cell("=SUM(A1)") == "'=SUM(A1)" and _cell("Plain") == "Plain"


async def test_only_chosen_tables_and_bad_format_refused(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    r = await _get(client, agency, format="json", tables="client,skill")
    assert set(json.loads(r.text)["$defs"]) == {"client", "skill"}
    bad = await _get(client, agency, format="xml")
    assert bad.status_code == 422
