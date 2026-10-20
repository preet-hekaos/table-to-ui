"""Port: read a document into fields. Vendors and the built-in reader sit behind it."""

from typing import Any, Protocol


class ParserUnavailable(Exception):
    """The parser could not be reached; the document is kept and queued for another try."""


class DocumentParser(Protocol):
    name: str

    async def parse(self, content_type: str, data: bytes) -> dict[str, Any]:
        """``{"text": str, "fields": {key: {"value": ..., "confidence": 0..1}}}``"""
        ...
