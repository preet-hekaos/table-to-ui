"""Write the Draft's tables, fields and links as a file: JSON Schema, SQL or a field list (CSV).
Pure functions over table definitions. The JSON Schema and SQL read back through Import schema."""

import csv
import io
import json
import re
from typing import Any

FORMATS = {"json": "application/json", "sql": "application/sql", "csv": "text/csv"}
EXTENSIONS = {"json": "json", "sql": "sql", "csv": "csv"}

_JSON: dict[str, dict[str, Any]] = {
    "text": {"type": "string"},
    "long_text": {"type": "string", "maxLength": 5000},
    "email": {"type": "string", "format": "email"},
    "phone": {"type": "string"},
    "integer": {"type": "integer"},
    "decimal": {"type": "number"},
    "boolean": {"type": "boolean"},
    "date": {"type": "string", "format": "date"},
    "url": {"type": "string", "format": "uri"},
    "money": {"type": "number"},
    "months": {"type": "integer"},
    "tags": {"type": "array", "items": {"type": "string"}},
}
_SQL = {
    "text": "varchar(255)",
    "long_text": "text",
    "email": "varchar(255)",
    "phone": "varchar(40)",
    "integer": "integer",
    "decimal": "numeric(18,4)",
    "boolean": "boolean",
    "date": "date",
    "url": "varchar(2048)",
    "money": "numeric(14,2)",
    "months": "integer",
    "tags": "text",
    "select": "varchar(100)",
    "reference": "uuid",
}


def _tables(defs: list[dict[str, Any]], keys: list[str] | None) -> list[dict[str, Any]]:
    out = [d for d in defs if not keys or d["key"] in keys]
    return sorted(out, key=lambda d: d["key"])


def to_json(defs: list[dict[str, Any]]) -> str:
    out: dict[str, Any] = {}
    for t in defs:
        props: dict[str, Any] = {}
        for f in t["fields"]:
            if f["type"] == "reference":
                spec: dict[str, Any] = {"$ref": f"#/$defs/{f.get('ref_table')}"}
            elif f["type"] == "select":
                spec = {"type": "string", "enum": list(f.get("options") or [])}
            else:
                spec = dict(_JSON.get(f["type"], {"type": "string"}))
            spec["title"] = f["label"]
            spec["x-field-type"] = f["type"]
            if f.get("help"):
                spec["description"] = f["help"]
            props[f["key"]] = spec
        out[t["key"]] = {
            "title": t["label"],
            "type": "object",
            "properties": props,
            "required": [f["key"] for f in t["fields"] if f.get("required")],
        }
    doc = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "Table to UI schema",
        "$defs": out,
    }
    return json.dumps(doc, indent=2, ensure_ascii=False) + "\n"


def _q(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def to_sql(defs: list[dict[str, Any]]) -> str:
    lines = [
        "-- Table to UI schema. Every table also has its own id, owner and change history.",
        "",
    ]
    for t in defs:
        lines.append(f"-- {t['label']}")
        cols = ["  id uuid PRIMARY KEY"]
        fks = []
        for f in t["fields"]:
            c = f"  {f['key']} {_SQL.get(f['type'], 'text')}"
            if f.get("required"):
                c += " NOT NULL"
            if f["type"] == "select" and f.get("options"):
                c += f" CHECK ({f['key']} IN ({', '.join(_q(o) for o in f['options'])}))"
            cols.append(c)
            if f["type"] == "reference" and f.get("ref_table"):
                fks.append(f"  FOREIGN KEY ({f['key']}) REFERENCES {f['ref_table']} (id)")
        lines.append(f"CREATE TABLE {t['key']} (\n" + ",\n".join(cols + fks) + "\n);")
        lines.append("")
    return "\n".join(lines)


def _cell(v: str) -> str:
    return "'" + v if re.match(r"^[=+\-@\t\r]", v) else v  # a spreadsheet must not run a label


def to_csv(defs: list[dict[str, Any]]) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Table", "Field", "Key", "Type", "Required", "Options", "Links to", "Help"])
    for t in defs:
        for f in t["fields"]:
            w.writerow(
                [
                    _cell(t["label"]),
                    _cell(f["label"]),
                    f["key"],
                    f["type"],
                    "yes" if f.get("required") else "",
                    _cell("; ".join(f.get("options") or [])),
                    f.get("ref_table") or "",
                    _cell(f.get("help") or ""),
                ]
            )
    return "﻿" + buf.getvalue()


def render(defs: list[dict[str, Any]], fmt: str, keys: list[str] | None = None) -> str:
    chosen = _tables(defs, keys)
    return {"json": to_json, "sql": to_sql, "csv": to_csv}[fmt](chosen)
