"""Event publishing port. Local/test uses an in-process bus; production uses SQS."""

from collections.abc import Awaitable, Callable
from typing import Any, Protocol

Event = dict[str, Any]
Handler = Callable[[Event], Awaitable[None]]


class Publisher(Protocol):
    async def publish(self, event: Event) -> None: ...


class LocalBus:
    """Delivers each event to every subscriber, in order. At-least-once is simulated by callers."""

    def __init__(self) -> None:
        self._handlers: list[Handler] = []
        self.published: list[Event] = []

    def subscribe(self, handler: Handler) -> None:
        self._handlers.append(handler)

    async def publish(self, event: Event) -> None:
        self.published.append(event)
        for h in self._handlers:
            await h(event)
