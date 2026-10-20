"""Port: where file bytes live."""

from typing import Protocol


class FileStore(Protocol):
    async def put(self, key: str, data: bytes) -> None: ...
    async def get(self, key: str) -> bytes: ...
