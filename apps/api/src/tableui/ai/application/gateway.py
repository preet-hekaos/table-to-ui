"""Every AI call goes through here: switch, cap, cache, provider, shape check, and the call log."""

import asyncio
import hashlib
import json
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text

from tableui.ai.domain.provider import AiProvider, ProviderUnavailable
from tableui.ai.domain.shapes import BadReply, parse_json
from tableui.identity.public import Principal
from tableui.platform.db import Database
from tableui.platform.errors import ProblemError
from tableui.platform.ids import new_id


class AiUnavailable(ProblemError):
    status = 503
    type_slug = "ai-unavailable"
    title = "AI is not available"


class AiOff(ProblemError):
    status = 409
    type_slug = "ai-off"
    title = "AI is switched off"


async def get_setting(db: Database, tenant_id: uuid.UUID) -> dict[str, Any]:
    async with db.control() as c:
        r = (
            await c.execute(
                text(
                    "SELECT enabled, tables, monthly_token_cap FROM control.ai_setting WHERE tenant_id = :t"
                ),
                {"t": tenant_id},
            )
        ).first()
        used = (
            await c.execute(
                text(
                    "SELECT COALESCE(SUM(tokens_in + tokens_out), 0) FROM control.ai_call "
                    "WHERE tenant_id = :t AND created_at >= date_trunc('month', now())"
                ),
                {"t": tenant_id},
            )
        ).scalar_one()
    return {
        "enabled": bool(r.enabled) if r else False,
        "tables": list(r.tables) if r else [],
        "monthly_token_cap": int(r.monthly_token_cap) if r else 200_000,
        "used_tokens": int(used),
    }


async def _log(
    db: Database,
    p: Principal,
    *,
    feature: str,
    version: str,
    subject: str | None,
    outcome: str,
    detail: str | None = None,
    provider: str | None = None,
    model: str | None = None,
    chars: int = 0,
    tin: int = 0,
    tout: int = 0,
) -> None:
    assert p.tenant_id
    async with db.control() as c:
        await c.execute(
            text(
                "INSERT INTO control.ai_call (id, tenant_id, user_id, feature, prompt_version, subject, provider, "
                "model, input_chars, tokens_in, tokens_out, outcome, detail) VALUES (:i, :t, :u, :f, :v, :s, :p, :m, "
                ":c, :ti, :to, :o, :d)"
            ),
            {
                "i": new_id(), "t": p.tenant_id, "u": p.user_id, "f": feature, "v": version, "s": subject,
                "p": provider, "m": model, "c": chars, "ti": tin, "to": tout, "o": outcome, "d": (detail or "")[:300] or None,
            },
        )  # fmt: skip


def prompt_version(feature: str, pack_version: int | None, system: str) -> str:
    h = hashlib.sha256(system.encode()).hexdigest()[:8]
    return f"{feature}.v{pack_version or 0}.{h}"


async def run(
    db: Database,
    provider: AiProvider | None,
    p: Principal,
    *,
    feature: str,
    version: str,
    system: str,
    user: str,
    shape: Callable[[Any], dict[str, Any]],
    subject: str | None = None,
    table: str | None = None,
    json_mode: bool = True,
    max_tokens: int = 1500,
    limit_seconds: float = 20.0,
    cache_hours: int = 24,
) -> dict[str, Any]:
    """Run one AI feature. The answer is only ever a suggestion; the caller decides what it may do."""
    assert p.tenant_id
    p.require("ai.use")
    setting = await get_setting(db, p.tenant_id)
    if not setting["enabled"]:
        raise AiOff("AI is switched off for this workspace.")
    if table and table not in setting["tables"]:
        raise AiOff("AI is not allowed to read this table. An admin can allow it in AI settings.")
    if provider is None:
        raise AiUnavailable("No AI provider is set up.")
    chars = len(system) + len(user)
    if setting["used_tokens"] >= setting["monthly_token_cap"]:
        await _log(
            db,
            p,
            feature=feature,
            version=version,
            subject=subject,
            outcome="refused",
            detail="cap",
            chars=chars,
        )
        raise AiUnavailable("This month's AI limit has been reached. The rest of the app works as usual.")  # fmt: skip
    key = hashlib.sha256(
        json.dumps([feature, version, system, user], ensure_ascii=False).encode()
    ).hexdigest()
    async with db.control() as c:
        hit = (
            await c.execute(
                text(
                    "SELECT result FROM control.ai_cache WHERE tenant_id = :t AND input_hash = :h "
                    "AND created_at > now() - make_interval(hours => :hrs)"
                ),
                {"t": p.tenant_id, "h": key, "hrs": cache_hours},
            )
        ).scalar_one_or_none()
    if hit is not None:
        await _log(
            db, p, feature=feature, version=version, subject=subject, outcome="cached", chars=chars
        )
        return {**hit, "cached": True, "prompt_version": version}
    last: Exception | None = None
    for _ in range(2):
        try:
            async with asyncio.timeout(limit_seconds):
                done = await provider.complete(
                    system, user, json_mode=json_mode, max_tokens=max_tokens
                )
        except (ProviderUnavailable, TimeoutError) as e:
            last = e
            continue
        try:
            result = shape(parse_json(done.text) if json_mode else {"text": done.text})
        except BadReply as e:
            await _log(db, p, feature=feature, version=version, subject=subject, outcome="bad_reply", detail=str(e),
                       provider=done.provider, model=done.model, chars=chars, tin=done.tokens_in, tout=done.tokens_out)  # fmt: skip
            raise AiUnavailable(
                "The AI gave an answer that could not be used. Try again."
            ) from None
        await _log(db, p, feature=feature, version=version, subject=subject, outcome="ok", provider=done.provider,
                   model=done.model, chars=chars, tin=done.tokens_in, tout=done.tokens_out)  # fmt: skip
        async with db.control() as c:
            await c.execute(
                text(
                    "INSERT INTO control.ai_cache (tenant_id, input_hash, result, created_at) VALUES (:t, :h, CAST(:r AS jsonb), now()) "
                    "ON CONFLICT (tenant_id, input_hash) DO UPDATE SET result = EXCLUDED.result, created_at = now()"
                ),
                {"t": p.tenant_id, "h": key, "r": json.dumps(result)},
            )
        return {
            **result,
            "cached": False,
            "prompt_version": version,
            "generated_at": datetime.now(UTC).isoformat(),
        }
    await _log(db, p, feature=feature, version=version, subject=subject, outcome="provider_error",
               detail=str(last), chars=chars)  # fmt: skip
    raise AiUnavailable("The AI service did not answer. Everything else still works.")
