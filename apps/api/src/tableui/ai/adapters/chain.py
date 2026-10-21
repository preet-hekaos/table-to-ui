from tableui.ai.domain.provider import AiProvider, Completion, ProviderUnavailable


class FailoverProvider:
    """Try each provider in turn; the next one answers when the first is down or rate-limited."""

    def __init__(self, providers: list[AiProvider]) -> None:
        self._providers = providers
        self.name = "+".join(p.name for p in providers)

    async def complete(
        self, system: str, user: str, *, json_mode: bool, max_tokens: int
    ) -> Completion:
        last: ProviderUnavailable | None = None
        for p in self._providers:
            try:
                return await p.complete(system, user, json_mode=json_mode, max_tokens=max_tokens)
            except ProviderUnavailable as e:
                last = e
        raise last or ProviderUnavailable("no AI provider is set up")
