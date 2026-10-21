import httpx

from tableui.ai.domain.provider import Completion, ProviderLimited, ProviderUnavailable


class GroqProvider:
    name = "groq"

    def __init__(
        self,
        api_key: str,
        model: str,
        *,
        timeout: float = 20.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._key, self.model, self._timeout, self._transport = api_key, model, timeout, transport

    async def complete(
        self, system: str, user: str, *, json_mode: bool, max_tokens: int
    ) -> Completion:
        body: dict[str, object] = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "temperature": 0,
            "max_completion_tokens": max_tokens,
            "reasoning_effort": "low",
        }
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        try:
            async with httpx.AsyncClient(timeout=self._timeout, transport=self._transport) as c:
                r = await c.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {self._key}"},
                    json=body,
                )
        except httpx.HTTPError as e:
            raise ProviderUnavailable(f"groq: {type(e).__name__}") from None
        if r.status_code == 429:
            raise ProviderLimited("groq is rate limiting")
        if r.status_code >= 400:
            raise ProviderUnavailable(f"groq: HTTP {r.status_code}")
        d = r.json()
        try:
            content = d["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError):
            raise ProviderUnavailable("groq: empty answer") from None
        u = d.get("usage", {})
        return Completion(
            content,
            int(u.get("prompt_tokens", 0)),
            int(u.get("completion_tokens", 0)),
            "groq",
            self.model,
        )
