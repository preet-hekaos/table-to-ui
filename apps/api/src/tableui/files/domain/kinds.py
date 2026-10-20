"""What each kind of upload may be: allowed types (by content, not by name) and size limits."""

import io
import zipfile
from dataclasses import dataclass

MB = 1024 * 1024


@dataclass(frozen=True)
class Kind:
    key: str
    types: frozenset[str]
    max_bytes: int


KINDS = {
    "logo": Kind("logo", frozenset({"image/png", "image/jpeg", "image/webp"}), 1 * MB),
    "cv": Kind(
        "cv",
        frozenset(
            {
                "application/pdf",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "image/png",
                "image/jpeg",
            }
        ),
        10 * MB,
    ),
    "import": Kind(
        "import",
        frozenset(
            {"text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
        ),
        100 * MB,
    ),
}


def sniff(data: bytes, name: str) -> str | None:
    """The content type judged from the bytes themselves; the file name only separates CSV from text."""
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:4] == b"PK\x03\x04":
        try:
            names = set(zipfile.ZipFile(io.BytesIO(data)).namelist())
        except zipfile.BadZipFile:
            return None
        if "word/document.xml" in names:
            return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        if "xl/workbook.xml" in names:
            return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        return None
    head = data[:65536]
    if b"\x00" in head:
        return None
    try:
        head.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            head.decode("cp1252")
        except UnicodeDecodeError:
            return None
    return "text/csv" if name.lower().endswith((".csv", ".txt", ".tsv")) else "text/plain"
