"""Document parsers: the built-in rule reader, a vendor adapter, and text extraction they share."""

import base64
import io
from typing import Any

import httpx

from tableui.files.domain.parser import ParserUnavailable
from tableui.files.domain.resume import parse_resume

PDF = "application/pdf"
DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def extract_text(content_type: str, data: bytes) -> str:
    """Plain text of a PDF or DOCX. Images have no text layer here (no OCR), so they read as empty."""
    if content_type == PDF:
        from pypdf import PdfReader

        try:
            reader = PdfReader(io.BytesIO(data))
            return "\n".join((page.extract_text() or "") for page in reader.pages[:20])
        except Exception:  # a damaged PDF reads as empty; the person fills the fields
            return ""
    if content_type == DOCX:
        import docx

        try:
            d = docx.Document(io.BytesIO(data))
        except Exception:
            return ""
        parts = [p.text for p in d.paragraphs]
        for t in d.tables:
            for row in t.rows:
                parts.append("  ".join(c.text for c in row.cells))
        return "\n".join(parts)
    return ""


class RuleParser:
    """Built in, deterministic, offline."""

    name = "rules"

    async def parse(self, content_type: str, data: bytes) -> dict[str, Any]:
        parsed = parse_resume(extract_text(content_type, data))
        return {"text": parsed.text, "fields": parsed.fields}


class RChilliParser:
    """RChilli's résumé API. Needs an API key (an owner action); any failure counts as unavailable."""

    name = "rchilli"
    URL = "https://rest.rchilli.com/RChilliParser/Rchilli/parseResumeBinary"

    def __init__(self, api_key: str | None, timeout: float = 20.0) -> None:
        self.api_key, self.timeout = api_key, timeout

    async def parse(self, content_type: str, data: bytes) -> dict[str, Any]:
        if not self.api_key:
            raise ParserUnavailable("RChilli is not configured")
        body = {
            "filedata": base64.b64encode(data).decode(),
            "filename": "cv.pdf" if content_type == PDF else "cv.docx",
            "userkey": self.api_key,
            "version": "8.0.0",
            "subuserid": "tableui",
        }
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as c:
                r = await c.post(self.URL, json=body)
                r.raise_for_status()
                doc = r.json().get("ResumeParserData", {})
        except (httpx.HTTPError, ValueError) as e:
            raise ParserUnavailable(str(e)) from e
        name = doc.get("Name", {}).get("FullName")
        emails = doc.get("Email") or []
        phones = doc.get("PhoneNumber") or []
        skills = [s.get("Skill") for s in doc.get("SegregatedSkill") or [] if s.get("Skill")]
        exp = doc.get("WorkedPeriod", {}).get("TotalExperienceInMonths")
        fields: dict[str, Any] = {}

        def put(k: str, v: Any, conf: float = 0.9) -> None:
            if v not in (None, "", []):
                fields[k] = {"value": v, "confidence": conf}

        put("name", name)
        put("email", emails[0].get("EmailAddress") if emails else None)
        put("phone", phones[0].get("FormattedNumber") if phones else None)
        put("title", doc.get("JobProfile"))
        put("employer", doc.get("CurrentEmployer"))
        put("location", (doc.get("Address") or [{}])[0].get("City"))
        put("experience_months", int(exp) if exp and str(exp).isdigit() else None)
        put("skills", skills[:25])
        return {"text": doc.get("DetailResume", ""), "fields": fields}


class UnavailableParser:
    """Stands in for a vendor outage in tests and drills."""

    name = "down"

    async def parse(self, content_type: str, data: bytes) -> dict[str, Any]:
        raise ParserUnavailable("the parser is down")
