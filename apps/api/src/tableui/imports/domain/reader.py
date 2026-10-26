"""Read a CSV or Excel file into a header row and rows of text cells."""

import csv
import datetime as dt
import io

XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
MAX_ROWS = 200_000


class FileUnreadable(Exception):
    pass


def _decode(data: bytes) -> str:
    for enc in ("utf-8-sig", "cp1252"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    raise FileUnreadable("The file is not in a text encoding we can read (save it as UTF-8 CSV).")


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


def _json_cell(v: object) -> str:
    if isinstance(v, list):
        return ", ".join(_json_cell(x) for x in v)
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, dict):
        raise FileUnreadable("Nested objects are not supported; flatten them into columns first.")
    return _cell(v)


def _read_json(data: bytes) -> tuple[list[str], list[list[str]]]:
    """A list of flat objects: one column per key (in first-seen order), one row per object."""
    import json

    try:
        doc = json.loads(_decode(data))
    except json.JSONDecodeError as e:
        raise FileUnreadable(f"The JSON file could not be read: {e.msg}.") from e
    if isinstance(doc, dict):
        doc = next((v for v in doc.values() if isinstance(v, list)), None)
    if not isinstance(doc, list) or not all(isinstance(x, dict) for x in doc):
        raise FileUnreadable("The JSON must be a list of objects, one per record.")
    if len(doc) > MAX_ROWS:
        raise FileUnreadable(
            f"The file has more than {MAX_ROWS:,} rows. Split it and import each part."
        )
    header: list[str] = []
    for obj in doc:
        for k in obj:
            if k not in header:
                header.append(str(k))
    rows = [[_json_cell(obj.get(h)) for h in header] for obj in doc]
    return header, [r for r in rows if any(r)]


def read_table(content_type: str, data: bytes) -> tuple[list[str], list[list[str]]]:
    if content_type == "application/json":
        header, rows = _read_json(data)
        if not header:
            raise FileUnreadable("The JSON has no records.")
        return header, rows
    if content_type == XLSX:
        from openpyxl import load_workbook  # type: ignore[import-untyped]

        try:
            wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        except Exception as e:
            raise FileUnreadable("The Excel file could not be opened.") from e
        ws = wb.worksheets[0]
        it = ws.iter_rows(values_only=True)
        header = [_cell(x) for x in next(it, ())]
        rows = []
        for r in it:
            cells = [_cell(x) for x in r]
            if any(cells):
                rows.append(cells)
                if len(rows) > MAX_ROWS:
                    raise FileUnreadable(
                        f"The file has more than {MAX_ROWS:,} rows. Split it and import each part."
                    )
        wb.close()
    else:
        text = _decode(data)
        sample = text[:20000]
        try:
            dialect: type[csv.Dialect] | csv.Dialect = csv.Sniffer().sniff(
                sample, delimiters=",;\t|"
            )
        except csv.Error:
            dialect = csv.excel
        reader = csv.reader(io.StringIO(text), dialect)
        header = [h.strip() for h in next(reader, [])]
        rows = []
        for r in reader:
            if any(c.strip() for c in r):
                rows.append([c.strip() for c in r])
                if len(rows) > MAX_ROWS:
                    raise FileUnreadable(
                        f"The file has more than {MAX_ROWS:,} rows. Split it and import each part."
                    )
    while header and not header[-1]:
        header.pop()
    if not header:
        raise FileUnreadable("The first row must name the columns.")
    seen: dict[str, int] = {}
    named = []
    for i, h in enumerate(header):
        h = h or f"Column {i + 1}"
        if h in seen:
            seen[h] += 1
            h = f"{h} ({seen[h]})"
        else:
            seen[h] = 1
        named.append(h)
    width = len(named)
    return named, [(r + [""] * width)[:width] for r in rows]
