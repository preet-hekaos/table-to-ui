"""Read a document (PDF, Word, text) that describes data and propose tables from it.

The answer is only a proposal: it is turned into a JSON Schema that goes through the normal Import
schema preview, where the person checks and ticks everything. A table or field the document does not
quote is dropped, so nothing is invented."""

import re
from typing import Any

from tableui.ai.application.features import Ctx
from tableui.ai.domain.redact import redact, squash
from tableui.ai.domain.shapes import BadReply, need_object
from tableui.files.public import extract_text, sniff
from tableui.identity.public import Principal
from tableui.platform.errors import ValidationFailed

MAX_BYTES = 5_000_000
MAX_TEXT = 14_000
MAX_TABLES = 25
MAX_FIELDS = 60
TYPES = {
    "text", "long_text", "email", "phone", "integer", "decimal", "boolean", "date", "url",
    "money", "months", "tags", "select",
}  # fmt: skip
INSTRUCTIONS = (
    "Describe the data tables a business would need to keep the information this document is about. "
    "Use only what the document says: for every table and every field give a short quote copied exactly "
    "from the document that supports it, and leave out anything it does not mention. "
    'Field types: {types}. Use "select" with "choices" when the document lists the allowed values. '
    'Use "links_to" (another table\'s label from your own answer) when a field points at a record of '
    "another table. "
    'Reply as JSON: {{"tables": [{{"label": "...", "quote": "...", "fields": [{{"label": "...", '
    '"type": "...", "required": false, "choices": [], "links_to": null, "quote": "..."}}]}}]}}'
)


def _slug(label: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")[:50]
    return s if s and s[0].isalpha() else f"t_{s}" if s else "table"


def _text_of(filename: str, data: bytes) -> str:
    if len(data) > MAX_BYTES:
        raise ValidationFailed(
            errors=[
                {"field": "file", "code": "invalid", "message": "The file is larger than 5 MB."}
            ]
        )
    kind = sniff(data, filename)
    if kind in {
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }:
        text = extract_text(kind, data)
    elif filename.lower().endswith((".txt", ".md")):
        text = data.decode("utf-8-sig", errors="replace")
    else:
        text = ""
    if len(text.strip()) < 20:
        raise ValidationFailed(
            errors=[
                {
                    "field": "file",
                    "code": "invalid",
                    "message": "There is no readable text in this file. Use a PDF or Word file with text, or a text file.",
                }
            ]
        )
    return text


def _schema(tables: list[dict[str, Any]]) -> dict[str, Any]:
    defs: dict[str, Any] = {}
    keys = {t["label"].lower(): _slug(t["label"]) for t in tables}
    for t in tables:
        props: dict[str, Any] = {}
        required: list[str] = []
        for f in t["fields"]:
            k = _slug(f["label"])
            link = keys.get(str(f.get("links_to") or "").lower())
            if link and link != keys[t["label"].lower()]:
                spec: dict[str, Any] = {"$ref": f"#/$defs/{link}"}
            elif f["type"] == "select":
                spec = {"type": "string", "enum": f["choices"]}
            else:
                spec = {"type": "string"}
            spec["title"] = f["label"]
            if f["type"] != "select":
                spec["x-field-type"] = f["type"] if "$ref" not in spec else "text"
            props[k] = spec
            if f.get("required"):
                required.append(k)
        defs[keys[t["label"].lower()]] = {
            "title": t["label"],
            "type": "object",
            "properties": props,
            "required": required,
        }
    return {"$schema": "https://json-schema.org/draft/2020-12/schema", "$defs": defs}


async def propose(c: Ctx, p: Principal, filename: str, data: bytes) -> dict[str, Any]:
    p.require("metadata.write")
    text = _text_of(filename, data)
    shown = redact(text)[:MAX_TEXT]
    seen = squash(shown)
    dropped = 0

    def supported(item: dict[str, Any]) -> bool:
        q = squash(str(item.get("quote") or ""))
        return len(q) >= 3 and q in seen

    def shape(v: Any) -> dict[str, Any]:
        nonlocal dropped
        raw = need_object(v).get("tables")
        if not isinstance(raw, list):
            raise BadReply("no tables")
        out: list[dict[str, Any]] = []
        labels: set[str] = set()
        for t in raw[:MAX_TABLES]:
            t = need_object(t)
            label = str(t.get("label") or "").strip()[:60]
            if not label or label.lower() in labels:
                continue
            if not supported(t):
                dropped += 1
                continue
            fields: list[dict[str, Any]] = []
            seen_f: set[str] = set()
            for f in (t.get("fields") or [])[:MAX_FIELDS]:
                f = need_object(f)
                fl = str(f.get("label") or "").strip()[:60]
                ft = f.get("type") if f.get("type") in TYPES else "text"
                choices = [str(x)[:60] for x in (f.get("choices") or []) if str(x).strip()][:25]
                if not fl or fl.lower() in seen_f:
                    continue
                if not supported(f):
                    dropped += 1
                    continue
                if ft == "select" and not choices:
                    ft = "text"
                seen_f.add(fl.lower())
                fields.append(
                    {
                        "label": fl,
                        "type": ft,
                        "required": bool(f.get("required")),
                        "choices": choices if ft == "select" else [],
                        "links_to": f.get("links_to")
                        if isinstance(f.get("links_to"), str)
                        else None,
                    }
                )
            if fields:
                labels.add(label.lower())
                out.append({"label": label, "fields": fields})
        if not out:
            raise BadReply("nothing in the document was supported by a quote")
        return {"tables": out, "dropped": dropped}

    system_note = INSTRUCTIONS.format(types=", ".join(sorted(TYPES)))
    user = f"<data>\n{shown}\n</data>"
    got = await c.run(
        p, "schema_from_document", system_note, user, shape, permission="ai.setup", max_tokens=3500
    )
    tables = got["tables"]
    return {
        "schema": _schema(tables),
        "tables": len(tables),
        "fields": sum(len(t["fields"]) for t in tables),
        "dropped": got.get("dropped", 0),
        "cached": got.get("cached", False),
    }
