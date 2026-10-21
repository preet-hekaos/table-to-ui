"""Public interface of the ai module."""

from tableui.ai.adapters.chain import FailoverProvider
from tableui.ai.adapters.fake import FakeProvider, demo_answer
from tableui.ai.adapters.gemini import GeminiProvider
from tableui.ai.adapters.groq import GroqProvider
from tableui.ai.api.router import router
from tableui.ai.domain.provider import AiProvider
from tableui.platform.config import Settings


def build_provider(settings: Settings) -> AiProvider | None:
    """The providers that have a key, in order: Groq first, Gemini as the fallback."""
    if settings.ai_provider == "off":
        return None
    if (
        settings.ai_provider == "fake"
    ):  # canned answers for trying the screens; never in a hosted workspace
        if settings.environment not in ("local", "test"):
            raise RuntimeError("AI_PROVIDER=fake is only for local use.")
        return FakeProvider(demo_answer)
    found: list[AiProvider] = []
    if settings.ai_provider in ("auto", "groq") and settings.groq_api_key:
        found.append(
            GroqProvider(
                settings.groq_api_key, settings.groq_model, timeout=settings.ai_timeout_seconds
            )
        )
    if settings.ai_provider in ("auto", "gemini") and settings.google_api_key:
        found.append(
            GeminiProvider(
                settings.google_api_key, settings.gemini_model, timeout=settings.ai_timeout_seconds
            )
        )
    if not found:
        return None
    return found[0] if len(found) == 1 else FailoverProvider(found)


__all__ = ["AiProvider", "FailoverProvider", "FakeProvider", "build_provider", "router"]
