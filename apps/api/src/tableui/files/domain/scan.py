"""Virus scanning port (R-14: scan before anything reads a file)."""

from typing import Literal, Protocol

Verdict = Literal["clean", "infected", "error"]

# The industry-standard harmless test signature; every scanner reports it as infected.
EICAR = b"X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"


class Scanner(Protocol):
    async def scan(self, data: bytes) -> Verdict: ...


class SignatureScanner:
    """Local stand-in for ClamAV or GuardDuty: flags the EICAR test signature."""

    async def scan(self, data: bytes) -> Verdict:
        return "infected" if EICAR in data else "clean"
