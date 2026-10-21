import uuid
from typing import Any

from sqlalchemy import text

from tableui.ai.application.gateway import get_setting
from tableui.audit.public import write_audit
from tableui.platform.db import Database
from tableui.platform.errors import ValidationFailed


async def set_setting(
    db: Database,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    known_tables: set[str],
    enabled: bool | None,
    tables: list[str] | None,
    cap: int | None,
    request_id: str | None,
) -> dict[str, Any]:
    cur = await get_setting(db, tenant_id)
    if tables is not None:
        bad = sorted(set(tables) - known_tables)
        if bad:
            raise ValidationFailed(errors=[{"field": "tables", "code": "unknown", "message": f"There is no table '{bad[0]}'."}])  # fmt: skip
    if cap is not None and not 0 <= cap <= 50_000_000:
        raise ValidationFailed(errors=[{"field": "monthly_token_cap", "code": "range", "message": "must be between 0 and 50,000,000"}])  # fmt: skip
    new = {
        "enabled": cur["enabled"] if enabled is None else enabled,
        "tables": cur["tables"] if tables is None else sorted(set(tables)),
        "cap": cur["monthly_token_cap"] if cap is None else cap,
    }
    async with db.control() as c:
        await c.execute(
            text(
                "INSERT INTO control.ai_setting (tenant_id, enabled, tables, monthly_token_cap, updated_by, updated_at) "
                "VALUES (:t, :e, :tb, :c, :u, now()) ON CONFLICT (tenant_id) DO UPDATE SET enabled = EXCLUDED.enabled, "
                "tables = EXCLUDED.tables, monthly_token_cap = EXCLUDED.monthly_token_cap, updated_by = EXCLUDED.updated_by, updated_at = now()"
            ),
            {
                "t": tenant_id,
                "e": new["enabled"],
                "tb": new["tables"],
                "c": new["cap"],
                "u": user_id,
            },
        )
        await write_audit(
            c, tenant_id=tenant_id, scope="tenant", actor_id=user_id, action="ai.settings",
            subject_type="workspace", subject_id=str(tenant_id), detail=new, request_id=request_id,
        )  # fmt: skip
    return await get_setting(db, tenant_id)


async def recent_calls(db: Database, tenant_id: uuid.UUID, limit: int = 30) -> list[dict[str, Any]]:
    async with db.control() as c:
        rows = (
            await c.execute(
                text(
                    "SELECT c.created_at, c.feature, c.prompt_version, c.subject, c.provider, c.model, c.tokens_in, "
                    "c.tokens_out, c.outcome, c.detail, u.full_name FROM control.ai_call c "
                    "LEFT JOIN control.app_user u ON u.id = c.user_id WHERE c.tenant_id = :t "
                    "ORDER BY c.created_at DESC LIMIT :n"
                ),
                {"t": tenant_id, "n": limit},
            )
        ).all()
    return [
        {
            "at": r.created_at.isoformat(), "feature": r.feature, "prompt_version": r.prompt_version,
            "subject": r.subject, "provider": r.provider, "model": r.model,
            "tokens": r.tokens_in + r.tokens_out, "outcome": r.outcome, "detail": r.detail, "by": r.full_name,
        }
        for r in rows
    ]  # fmt: skip
