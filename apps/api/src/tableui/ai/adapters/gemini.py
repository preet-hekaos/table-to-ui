import httpx

from tableui.ai.domain.provider import Completion, ProviderLimited, ProviderUnavailable


class GeminiProvider:
    name = "gemini"

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
        cfg: dict[str, object] = {"temperature": 0, "maxOutputTokens": max_tokens}
        if json_mode:
            cfg["responseMimeType"] = "application/json"
        body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": cfg,
        }
        try:
            async with httpx.AsyncClient(timeout=self._timeout, transport=self._transport) as c:
                r = await c.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent",
                    headers={"x-goog-api-key": self._key},
                    json=body,
                )
        except httpx.HTTPError as e:
            raise ProviderUnavailable(f"gemini: {type(e).__name__}") from None
        if r.status_code == 429:
            raise ProviderLimited("gemini is rate limiting")
        if r.status_code >= 400:
            raise ProviderUnavailable(f"gemini: HTTP {r.status_code}")
        d = r.json()
        try:
            parts = d["candidates"][0]["content"]["parts"]
            content = "".join(p.get("text", "") for p in parts)
        except (KeyError, IndexError):
            raise ProviderUnavailable("gemini: empty answer") from None
        u = d.get("usageMetadata", {})
        return Completion(
            content,
            int(u.get("promptTokenCount", 0)),
            int(u.get("candidatesTokenCount", 0)),
            "gemini",
            self.model,
        )
