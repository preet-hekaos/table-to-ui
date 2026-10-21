"""The port every AI provider fits. Features never know which provider answered."""

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class Completion:
    text: str
    tokens_in: int
    tokens_out: int
    provider: str
    model: str


class ProviderUnavailable(Exception):
    """The provider could not answer (down, timed out, bad key). Nothing else in the app depends on it."""


class ProviderLimited(ProviderUnavailable):
    """The provider is rate-limiting us."""


class AiProvider(Protocol):
    name: str

    async def complete(
        self, system: str, user: str, *, json_mode: bool, max_tokens: int
    ) -> Completion: ...
