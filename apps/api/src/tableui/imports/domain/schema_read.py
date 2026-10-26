"""Read a schema (and, if present, a count of its rows) from CSV, Excel, JSON or SQL.

Every parser is pure: bytes in, a list of proposed tables out. Nothing is saved and nothing is run.
A proposed table is a plain dict:
  {key, label, plural_label, title_key, source, rows, fields: [{key, label, type, required,
   options, link: {to, reason} | None}], warnings}
"""

import datetime as dt
import io
import json
import re
import zipfile
from collections import Counter
from typing import Any

from tableui.imports.domain.profile import detect
from tableui.imports.domain.reader import XLSX, FileUnreadable, read_table

MAX_BYTES = 5_000_000
MAX_UNZIPPED = 60_000_000
MAX_TABLES = 50
MAX_COLUMNS = 200
MAX_OPTIONS = 25
SAMPLE_ROWS = 1000
MAX_STATEMENTS = 2000
RESERVED = {
    "id", "tenant_id", "version", "data", "owner_id", "owner", "search_doc",
    "created_at", "updated_at", "created_by", "updated_by",
}  # fmt: skip
TEXT_TYPES = {"text", "email", "phone", "url"}


class SchemaError(Exception):
    """The file cannot be read as a schema; the message is shown to the person as is."""


# ---- names ---------------------------------------------------------------------------------


def key_of(label: str, taken: set[str] | None = None, limit: int = 50) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", label.strip().lower()).strip("_")
    if not s or not s[0].isalpha():
        s = f"f_{s}" if s else "f"
    s = s[:limit]
    if s in RESERVED or s.endswith("_norm"):
        s = f"{s}_value"
    if taken is not None:
        base, n = s, 2
        while s in taken:
            s = f"{base[: limit - 3]}_{n}"
            n += 1
        taken.add(s)
    return s


def _title(s: str) -> str:
    s = re.sub(r"[_\-]+", " ", s).strip()
    s = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", s)
    return (s[:1].upper() + s[1:]) if s else s


def _plural(label: str) -> str:
    low = label.lower()
    if low.endswith("s") or low.endswith("data"):
        return label
    if low.endswith("y") and low[-2:-1] not in "aeiou":
        return label[:-1] + "ies"
    return label + "s"


def _hint(key: str, ftype: str) -> str:
    """A column called email, phone or website is that, even when its values are few or odd."""
    if ftype not in {"text", "long_text"}:
        return ftype
    if "email" in key or key.endswith("_mail"):
        return "email"
    if "phone" in key or "mobile" in key:
        return "phone"
    if key in {"url", "website", "link"} or key.endswith("_url"):
        return "url"
    return ftype


def _table(
    label: str, source: str, fields: list[dict[str, Any]], rows: int, warnings: list[str]
) -> dict[str, Any]:
    title = next((f["key"] for f in fields if f["type"] == "text"), None)
    return {
        "key": key_of(label),
        "label": label,
        "plural_label": _plural(label),
        "title_key": title,
        "source": source,
        "rows": rows,
        "fields": fields,
        "warnings": warnings,
    }


def _field(
    label: str,
    ftype: str,
    taken: set[str],
    *,
    required: bool = False,
    options: list[str] | None = None,
    link_to: str | None = None,
    reason: str = "",
) -> dict[str, Any]:
    k = key_of(label, taken)
    return {
        "key": k,
        "label": label,
        "type": _hint(k, ftype),
        "required": required,
        "options": (options or [])[:MAX_OPTIONS] if ftype == "select" else [],
        "link": {"to": link_to, "reason": reason} if link_to else None,
    }


# ---- CSV and Excel -------------------------------------------------------------------------


def _from_grid(name: str, header: list[str], rows: list[list[str]], source: str) -> dict[str, Any]:
    warnings: list[str] = []
    if len(header) > MAX_COLUMNS:
        warnings.append(f"Only the first {MAX_COLUMNS} of {len(header)} columns are used.")
        header = header[:MAX_COLUMNS]
    taken: set[str] = set()
    fields = []
    sample = rows[:SAMPLE_ROWS]
    for i, h in enumerate(header):
        if h.strip().lower() == "id":
            warnings.append("Column id is skipped: every record gets its own id.")
            continue
        values = [r[i] for r in sample if i < len(r) and r[i]]
        ftype = detect(values) if values else "text"
        options = sorted({v for v in values})[:MAX_OPTIONS] if ftype == "select" else None
        if ftype == "select" and not options:
            ftype = "text"
        if len(values) and len({v for v in values}) > 0 and max(map(len, values)) > 255:
            ftype = "long_text"
        if values and ftype == "text":
            share = sum(1 for v in values if v) / max(len(sample), 1)
            if share < 0.5 and len(sample) >= 20:
                warnings.append(f"Column {h} is mostly empty.")
        fields.append(_field(h, ftype, taken, options=options))
    if not fields:
        raise SchemaError(f"{source} has no usable columns.")
    return _table(name, source, fields, len(rows), warnings)


def read_csv(name: str, data: bytes) -> list[dict[str, Any]]:
    try:
        header, rows = read_table("text/csv", data)
    except FileUnreadable as e:
        raise SchemaError(str(e)) from e
    return [_from_grid(_title(name), header, rows, name)]


def _guard_zip(data: bytes) -> None:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            total = sum(i.file_size for i in z.infolist())
            if total > MAX_UNZIPPED or len(z.infolist()) > 2000:
                raise SchemaError("The Excel file is too large once unpacked.")
    except zipfile.BadZipFile as e:
        raise SchemaError("The Excel file could not be opened.") from e


def _cell(v: object) -> str:
    if v is None:
        return ""
    if isinstance(v, dt.datetime):
        return v.date().isoformat() if v.time() == dt.time(0) else v.isoformat()
    if isinstance(v, dt.date):
        return v.isoformat()
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


def read_xlsx(name: str, data: bytes) -> list[dict[str, Any]]:
    _guard_zip(data)
    from openpyxl import load_workbook  # type: ignore[import-untyped]

    try:
        wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception as e:
        raise SchemaError("The Excel file could not be opened.") from e
    out = []
    try:
        for ws in wb.worksheets[:MAX_TABLES]:
            it = ws.iter_rows(values_only=True)
            header = [_cell(x) for x in next(it, ())]
            while header and not header[-1]:
                header.pop()
            if not header:
                continue
            header = [h or f"Column {i + 1}" for i, h in enumerate(header)]
            seen: Counter[str] = Counter()
            uniq = []
            for h in header:
                seen[h] += 1
                uniq.append(h if seen[h] == 1 else f"{h} ({seen[h]})")
            rows: list[list[str]] = []
            for r in it:
                cells = [_cell(x) for x in r][: len(uniq)]
                cells += [""] * (len(uniq) - len(cells))
                if any(cells):
                    rows.append(cells)
                if len(rows) >= 200_000:
                    break
            out.append(_from_grid(_title(ws.title), uniq, rows, f"{name} / {ws.title}"))
    finally:
        wb.close()
    if not out:
        raise SchemaError("The Excel file has no sheet with a header row.")
    return out


# ---- JSON ----------------------------------------------------------------------------------

_JSON_TYPES = {"integer": "integer", "number": "decimal", "boolean": "boolean"}
_FORMATS = {"email": "email", "date": "date", "date-time": "date", "uri": "url", "url": "url"}


def _json_value_type(v: Any) -> str:
    if isinstance(v, bool):
        return "boolean"
    if isinstance(v, int):
        return "integer"
    if isinstance(v, float):
        return "decimal"
    return "text"


def _from_objects(label: str, items: list[dict[str, Any]], source: str) -> dict[str, Any]:
    warnings: list[str] = []
    cols: dict[str, list[Any]] = {}
    for item in items[:SAMPLE_ROWS]:
        for k, v in item.items():
            cols.setdefault(str(k), []).append(v)
    taken: set[str] = set()
    fields = []
    for k, vals in list(cols.items())[:MAX_COLUMNS]:
        present = [v for v in vals if v is not None]
        if k.lower() == "id":
            warnings.append("Key id is skipped: every record gets its own id.")
            continue
        if any(isinstance(v, dict) for v in present):
            warnings.append(f"Key {k} holds nested objects and is skipped.")
            continue
        if any(isinstance(v, list) for v in present):
            flat = all(not isinstance(x, (dict, list)) for v in present for x in v)
            if flat:
                fields.append(_field(_title(k), "tags", taken))
            else:
                warnings.append(f"Key {k} holds nested lists and is skipped.")
            continue
        kinds = {_json_value_type(v) for v in present}
        if len(kinds) == 1 and kinds != {"text"}:
            ftype = kinds.pop()
        else:
            strs = [str(v) for v in present]
            ftype = detect(strs) if strs else "text"
            if kinds <= {"integer", "decimal"} and len(kinds) == 2:
                ftype = "decimal"
        options = sorted({str(v) for v in present})[:MAX_OPTIONS] if ftype == "select" else None
        required = len(present) == len(items[:SAMPLE_ROWS]) and bool(present)
        fields.append(_field(_title(k), ftype, taken, required=required, options=options))
    if not fields:
        raise SchemaError(f"{source} has no usable keys.")
    return _table(label, source, fields, len(items), warnings)


def _schema_fields(
    props: dict[str, Any], required: set[str], defs: dict[str, Any], warnings: list[str]
) -> list[dict[str, Any]]:
    taken: set[str] = set()
    fields = []
    for k, spec in list(props.items())[:MAX_COLUMNS]:
        if not isinstance(spec, dict):
            continue
        if k.lower() == "id":
            warnings.append("Property id is skipped: every record gets its own id.")
            continue
        ref = spec.get("$ref")
        if isinstance(ref, str) and ref.rsplit("/", 1)[-1] in defs:
            target = ref.rsplit("/", 1)[-1]
            f = _field(_title(k), "text", taken, link_to=key_of(target), reason="declared $ref")
            fields.append(f)
            continue
        t = spec.get("type")
        if isinstance(t, list):
            t = next((x for x in t if x != "null"), None)
        if t in {"object"} or (t == "array" and spec.get("items", {}).get("type") in {"object"}):
            warnings.append(f"Property {k} is nested and is skipped.")
            continue
        enum = spec.get("enum")
        if t == "array":
            fields.append(_field(_title(k), "tags", taken, required=k in required))
            continue
        if isinstance(enum, list) and enum:
            opts = [str(x) for x in enum if x is not None]
            fields.append(_field(_title(k), "select", taken, required=k in required, options=opts))
            continue
        ftype = _FORMATS.get(str(spec.get("format"))) or _JSON_TYPES.get(str(t)) or "text"
        if ftype == "text" and (spec.get("maxLength") or 0) > 255:
            ftype = "long_text"
        fields.append(_field(_title(k), ftype, taken, required=k in required))
    return fields


def read_json(name: str, data: bytes) -> list[dict[str, Any]]:
    try:
        doc = json.loads(data.decode("utf-8-sig"))
    except (UnicodeDecodeError, ValueError, RecursionError) as e:
        raise SchemaError("The JSON file could not be read.") from e
    label = _title(name)
    if isinstance(doc, list):
        items = [x for x in doc if isinstance(x, dict)]
        if not items:
            raise SchemaError("The JSON file is a list but holds no objects.")
        return [_from_objects(label, items, name)]
    if not isinstance(doc, dict):
        raise SchemaError("The JSON file must be a list of objects or a JSON Schema.")
    if isinstance(doc.get("properties"), dict):
        defs = {**doc.get("$defs", {}), **doc.get("definitions", {})}
        defs = {k: v for k, v in defs.items() if isinstance(v, dict) and "properties" in v}
        out = []
        root_label = _title(str(doc.get("title") or name))
        warnings: list[str] = []
        fields = _schema_fields(doc["properties"], set(doc.get("required", [])), defs, warnings)
        if fields:
            out.append(_table(root_label, name, fields, 0, warnings))
        for dk, dv in list(defs.items())[:MAX_TABLES]:
            w: list[str] = []
            f = _schema_fields(dv["properties"], set(dv.get("required", [])), defs, w)
            if f:
                out.append(_table(_title(dk), name, f, 0, w))
        if not out:
            raise SchemaError("The JSON Schema declares no usable properties.")
        return out
    groups = {k: v for k, v in doc.items() if isinstance(v, list) and v and isinstance(v[0], dict)}
    if groups:
        return [
            _from_objects(_title(k), [x for x in v if isinstance(x, dict)], f"{name} / {k}")
            for k, v in list(groups.items())[:MAX_TABLES]
        ]
    return [_from_objects(label, [doc], name)]


# ---- SQL -----------------------------------------------------------------------------------

_SQL_INT = {"INT", "INTEGER", "BIGINT", "SMALLINT", "TINYINT", "MEDIUMINT", "SERIAL", "BIGSERIAL"}
_SQL_DEC = {"DECIMAL", "NUMERIC", "FLOAT", "DOUBLE", "REAL", "MONEY"}
_SQL_DATE = {"DATE", "DATETIME", "TIMESTAMP", "TIMESTAMPTZ", "TIMESTAMP WITH TIME ZONE"}
_SQL_LONG = {"TEXT", "MEDIUMTEXT", "LONGTEXT", "JSON", "JSONB", "CLOB"}


def read_sql(name: str, data: bytes) -> list[dict[str, Any]]:
    import sqlglot
    from sqlglot import exp
    from sqlglot.errors import SqlglotError

    try:
        sql = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        sql = data.decode("cp1252", errors="replace")
    try:
        statements = sqlglot.parse(sql)
    except (SqlglotError, RecursionError) as e:
        raise SchemaError(f"The SQL could not be read: {str(e)[:160]}") from e
    if len(statements) > MAX_STATEMENTS:
        raise SchemaError(f"The SQL has more than {MAX_STATEMENTS:,} statements.")
    tables: dict[str, dict[str, Any]] = {}
    inserts: Counter[str] = Counter()
    ignored = 0
    for st in statements:
        if st is None:
            continue
        if isinstance(st, exp.Create) and str(st.args.get("kind", "")).upper() == "TABLE":
            t = _sql_table(st, exp)
            if t:
                tables[t["raw"]] = t
        elif isinstance(st, exp.Insert):
            tgt = st.this.this.name if isinstance(st.this, exp.Schema) else st.this.name
            vals = st.args.get("expression")
            n = len(vals.expressions) if isinstance(vals, exp.Values) else 0
            inserts[str(tgt).lower()] += n
        else:
            ignored += 1
    if not tables:
        raise SchemaError("The SQL has no CREATE TABLE statement.")
    names = {raw.lower(): key_of(raw) for raw in tables}
    out = []
    for raw, t in list(tables.items())[:MAX_TABLES]:
        taken: set[str] = set()
        fields = []
        warnings = list(t["warnings"])
        for c in t["columns"][:MAX_COLUMNS]:
            if c["name"].lower() == "id":
                warnings.append("Column id is skipped: every record gets its own id.")
                continue
            fk = t["fks"].get(c["name"].lower())
            link = names.get(fk.lower()) if fk else None
            label = (
                re.sub(r"\s+id$", "", _title(c["name"]), flags=re.I) if link else _title(c["name"])
            )
            fields.append(
                _field(
                    label,
                    c["type"],
                    taken,
                    required=c["required"] and not link,
                    options=c["options"],
                    link_to=link,
                    reason="foreign key",
                )
            )
        if not fields:
            continue
        out.append(
            _table(_title(raw), name, fields, inserts.get(raw.lower(), 0), warnings)
            | {"key": names[raw.lower()]}
        )
    if ignored:
        out[0]["warnings"].append(
            f"{ignored} statement(s) other than CREATE TABLE and INSERT were ignored."
        )
    return out


def _sql_table(st: Any, exp: Any) -> dict[str, Any] | None:
    schema = st.this
    if not isinstance(schema, exp.Schema):
        return None
    raw = schema.this.name
    cols: list[dict[str, Any]] = []
    fks: dict[str, str] = {}
    warnings: list[str] = []
    checks: dict[str, list[str]] = {}
    for e in schema.expressions:
        if isinstance(e, exp.ColumnDef):
            kind = e.args.get("kind")
            tname = kind.sql().upper().split("(")[0] if kind is not None else "TEXT"
            required = False
            options: list[str] | None = None
            for c in e.args.get("constraints") or []:
                ck = c.kind
                if isinstance(ck, (exp.NotNullColumnConstraint, exp.PrimaryKey)):
                    required = True
                elif isinstance(ck, exp.CheckColumnConstraint) and isinstance(ck.this, exp.In):
                    options = [x.name for x in ck.this.expressions if isinstance(x, exp.Literal)]
                elif isinstance(ck, exp.Reference):
                    fks[e.name.lower()] = ck.this.this.name if hasattr(ck.this, "this") else ""
            if options is None and kind is not None and tname in {"ENUM", "SET"}:
                options = [x.name for x in kind.expressions if hasattr(x, "name")]
            ftype = (
                "integer"
                if tname in _SQL_INT
                else "decimal"
                if tname in _SQL_DEC
                else "date"
                if tname in _SQL_DATE
                else "boolean"
                if tname in {"BOOL", "BOOLEAN", "BIT"}
                else "long_text"
                if tname in _SQL_LONG
                else "text"
            )
            if tname not in _SQL_INT | _SQL_DEC | _SQL_DATE | _SQL_LONG | {
                "BOOL", "BOOLEAN", "BIT", "VARCHAR", "CHAR", "NVARCHAR", "TEXT", "UUID", "ENUM", "SET", "STRING",
            }:  # fmt: skip
                warnings.append(f"Column {e.name} has type {tname.lower()}, treated as text.")
            if options:
                ftype = "select"
            cols.append({"name": e.name, "type": ftype, "required": required, "options": options})
        elif isinstance(e, exp.ForeignKey):
            ref = e.args.get("reference")
            if ref is not None and e.expressions:
                tgt = ref.this.this.name if hasattr(ref.this, "this") else ""
                fks[e.expressions[0].name.lower()] = tgt
        elif isinstance(e, exp.Check):
            body = e.this
            if isinstance(body, exp.In) and isinstance(body.this, exp.Column):
                checks[body.this.name.lower()] = [
                    x.name for x in body.expressions if isinstance(x, exp.Literal)
                ]
    for c in cols:
        vals = checks.get(c["name"].lower())
        if vals:
            c["options"], c["type"] = vals, "select"
    return {"raw": raw, "columns": cols, "fks": fks, "warnings": warnings}


# ---- links and the front door --------------------------------------------------------------


def detect_links(tables: list[dict[str, Any]]) -> None:
    """Columns called client_id (or clientId) point at a table called client or clients."""
    keys = {t["key"] for t in tables}
    by_stem = {}
    for k in keys:
        by_stem[k] = k
        by_stem[k.rstrip("s")] = k
    for t in tables:
        for f in t["fields"]:
            if f["link"] or f["type"] not in {"text", "integer", "boolean"}:
                continue
            m = re.match(r"^(.+?)_?id$", f["key"])
            stem = m.group(1) if m else None
            if stem and stem in by_stem and by_stem[stem] != t["key"]:
                f["link"] = {"to": by_stem[stem], "reason": "named like a link"}
                f["type"] = "integer" if f["type"] == "boolean" else f["type"]
                f["label"] = re.sub(r"\s+id$", "", f["label"], flags=re.I) or f["label"]


def read_schema(filename: str, content_type: str, data: bytes) -> list[dict[str, Any]]:
    if len(data) > MAX_BYTES:
        raise SchemaError(f"{filename} is larger than {MAX_BYTES // 1_000_000} MB.")
    if not data.strip():
        raise SchemaError(f"{filename} is empty.")
    base = re.sub(r"\.[A-Za-z0-9]+$", "", filename.rsplit("/", 1)[-1]) or "Table"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext in {"xlsx", "xlsm"} or content_type == XLSX:
        return read_xlsx(base, data)
    if ext == "json" or content_type == "application/json":
        return read_json(base, data)
    if ext == "sql" or content_type in {"application/sql", "text/x-sql"}:
        return read_sql(base, data)
    if ext in {"csv", "tsv", "txt"} or content_type in {"text/csv", "text/plain"}:
        return read_csv(base, data)
    raise SchemaError(
        f"{filename}: this file type is not supported yet. Use CSV, Excel, JSON or SQL."
    )


def combine(tables: list[dict[str, Any]], existing: set[str]) -> list[dict[str, Any]]:
    """Give every proposed table a key no one else uses; say when a name was already taken."""
    if len(tables) > MAX_TABLES:
        raise SchemaError(f"The files hold more than {MAX_TABLES} tables.")
    taken = set(existing)
    renames: dict[str, str] = {}
    for t in tables:
        old = t["key"]
        k, n = old, 2
        while k in taken:
            k = f"{old[:56]}_{n}"
            n += 1
        taken.add(k)
        if k != old:
            renames[old] = k
            t["warnings"].append(f"A table called {old} already exists; this one will be {k}.")
            t["key"] = k
            t["label"] = f"{t['label']} {n - 1}"
            t["plural_label"] = _plural(t["label"])
    detect_links(tables)
    keys = {t["key"] for t in tables} | existing
    for t in tables:
        for f in t["fields"]:
            if f["link"]:
                f["link"]["to"] = renames.get(f["link"]["to"], f["link"]["to"])
                if f["link"]["to"] not in keys:
                    f["link"] = None
    return tables
