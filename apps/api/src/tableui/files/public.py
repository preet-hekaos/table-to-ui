"""Public interface of the files module."""

from tableui.files.adapters.clamd import ClamdScanner
from tableui.files.adapters.parsers import (
    RChilliParser,
    RuleParser,
    UnavailableParser,
    extract_text,
)
from tableui.files.adapters.store import LocalFileStore
from tableui.files.api.router import documents_router, router
from tableui.files.application.documents import get_parse, mapped_values
from tableui.files.application.files import describe, read_clean, upload
from tableui.files.domain.kinds import KINDS, sniff
from tableui.files.domain.parser import DocumentParser, ParserUnavailable
from tableui.files.domain.resume import parse_resume
from tableui.files.domain.scan import EICAR, Scanner, SignatureScanner
from tableui.files.domain.store import FileStore

__all__ = [
    "EICAR",
    "KINDS",
    "ClamdScanner",
    "DocumentParser",
    "ParserUnavailable",
    "RChilliParser",
    "RuleParser",
    "UnavailableParser",
    "documents_router",
    "extract_text",
    "parse_resume",
    "FileStore",
    "get_parse",
    "mapped_values",
    "LocalFileStore",
    "Scanner",
    "SignatureScanner",
    "describe",
    "read_clean",
    "router",
    "sniff",
    "upload",
]
