"""Public interface of the files module."""

from tableui.files.adapters.clamd import ClamdScanner
from tableui.files.adapters.store import LocalFileStore
from tableui.files.api.router import router
from tableui.files.application.files import describe, read_clean, upload
from tableui.files.domain.kinds import KINDS, sniff
from tableui.files.domain.scan import EICAR, Scanner, SignatureScanner
from tableui.files.domain.store import FileStore

__all__ = [
    "EICAR",
    "KINDS",
    "ClamdScanner",
    "FileStore",
    "LocalFileStore",
    "Scanner",
    "SignatureScanner",
    "describe",
    "read_clean",
    "router",
    "sniff",
    "upload",
]
