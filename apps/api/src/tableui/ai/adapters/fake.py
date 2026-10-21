import json
from collections.abc import Callable

from tableui.ai.domain.provider import Completion, ProviderUnavailable


class FakeProvider:
    """Answers from a function, so tests and local runs need no key and no network."""

    name = "fake"

    def __init__(self, answer: Callable[[str, str], object] | None = None) -> None:
        self.answer = answer or (lambda system, user: {"text": "A short, plain answer."})
        self.calls: list[tuple[str, str]] = []
        self.down = False
        self.model = "fake-1"

    async def complete(
        self, system: str, user: str, *, json_mode: bool, max_tokens: int
    ) -> Completion:
        self.calls.append((system, user))
        if self.down:
            raise ProviderUnavailable("fake provider is down")
        out = self.answer(system, user)
        text = out if isinstance(out, str) else json.dumps(out)
        return Completion(text, len(system + user) // 4, len(text) // 4, "fake", self.model)


def demo_answer(system: str, user: str) -> object:
    """Plausible answers for every feature, so the screens can be tried without a key or a network.

    The wording is generic and says plainly that it is a demo; it only echoes what the prompt contained."""
    data = user.split("<data>")[1].split("</data>")[0].strip() if "<data>" in user else ""
    if "Fields to fill (JSON):" in user:
        spec = json.loads(user.split("Fields to fill (JSON):", 1)[1].split("\n", 1)[0])
        words = data.split()
        out: dict[str, object] = {}
        for i, f in enumerate(f for f in spec if f["type"] in ("text", "long_text")):
            chunk = words[3 * i : 3 * i + 3]
            if len(chunk) == 3:
                out[f["key"]] = {"value": " ".join(chunk), "quote": " ".join(chunk)}
        return {"fields": out}
    if "search filters" in system:
        spec = json.loads(user.split("Fields: ", 1)[1].split("\n", 1)[0])
        filters: dict[str, str] = {}
        for f in spec:
            for choice in f.get("choices") or []:
                if choice.lower() in data.lower():
                    filters[f["key"]] = choice
        return {"filters": filters, "text": ""}
    if "Draft a short message" in system:
        return {
            "subject": "A quick hello (demo draft)",
            "body": "Hi,\n\nThis is a demo draft written without a real AI provider.\n\n[Your name]",
        }
    return {"text": "Demo answer: " + (data[:160] or "no details were given.")}
