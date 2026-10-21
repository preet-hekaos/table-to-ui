"""Workspace administration: people, teams, roles and permissions, branding, regional settings."""

import json
import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tableui.audit.public import write_audit
from tableui.platform.errors import NotFound, ValidationFailed
from tableui.platform.ids import new_id
from tableui.workspace.domain import contrast

DEFAULT_REGIONAL = {
    "currency": "INR",
    "locale": "en-IN",
    "date_format": "dd MMM yyyy",
    "week_start": "monday",
    "phone_region": "IN",
}
SCOPES = ("all", "own_team", "own")


def _bad(field: str, message: str, code: str = "invalid") -> ValidationFailed:
    return ValidationFailed(errors=[{"field": field, "code": code, "message": message}])


# ---- people -------------------------------------------------------------------------------


async def list_people(s: AsyncSession, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
    rows = (
        await s.execute(
            text(
                "SELECT u.id, u.email, u.full_name, u.active, m.role_key, "
                "COALESCE((SELECT array_agg(t.name ORDER BY t.name) FROM control.team_member tm "
                "  JOIN control.team t ON t.id = tm.team_id WHERE tm.user_id = u.id AND t.tenant_id = m.tenant_id), "
                "  '{}') AS teams "
                "FROM control.membership m JOIN control.app_user u ON u.id = m.user_id "
                "WHERE m.tenant_id = :t ORDER BY u.full_name"
            ),
            {"t": tenant_id},
        )
    ).all()
    return [
        {
            "id": str(r.id),
            "email": r.email,
            "full_name": r.full_name,
            "active": r.active,
            "role": r.role_key,
            "teams": list(r.teams),
        }
        for r in rows
    ]


async def _active_admins(s: AsyncSession, tenant_id: uuid.UUID) -> list[uuid.UUID]:
    rows = await s.execute(
        text(
            "SELECT u.id FROM control.membership m JOIN control.app_user u ON u.id = m.user_id "
            "JOIN control.tenant_role_grant g ON g.tenant_id = m.tenant_id AND g.role_key = m.role_key "
            "WHERE m.tenant_id = :t AND u.active AND g.permission = '*'"
        ),
        {"t": tenant_id},
    )
    return [r.id for r in rows]


async def _member(s: AsyncSession, tenant_id: uuid.UUID, user_id: uuid.UUID) -> Any:
    row = (
        await s.execute(
            text(
                "SELECT u.id, u.active, m.role_key FROM control.membership m "
                "JOIN control.app_user u ON u.id = m.user_id WHERE m.tenant_id = :t AND u.id = :u"
            ),
            {"t": tenant_id, "u": user_id},
        )
    ).first()
    if row is None:
        raise NotFound("That person is not in this workspace.")
    return row


async def remove_member(
    s: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    actor_id: uuid.UUID,
    user_id: uuid.UUID,
    request_id: str | None,
) -> None:
    """End a person's access for good. Their name stays on past history and audit lines (the user row stays)."""
    member = await _member(s, tenant_id, user_id)
    if user_id == actor_id:
        raise ValidationFailed("You cannot remove yourself. Ask another administrator.")
    if await _active_admins(s, tenant_id) == [member.id]:
        raise ValidationFailed("This is the last administrator and cannot be removed.")
    await s.execute(text("UPDATE control.session SET revoked = true WHERE user_id = :u"), {"u": user_id})  # fmt: skip
    await s.execute(text("DELETE FROM control.team_member WHERE user_id = :u"), {"u": user_id})
    await s.execute(
        text("DELETE FROM control.membership WHERE user_id = :u AND tenant_id = :t"),
        {"u": user_id, "t": tenant_id},
    )
    # The sign-in is closed and the email is free for someone else; the name stays on old history.
    await s.execute(
        text(
            "UPDATE control.app_user SET active = false, email = 'removed-' || id::text || '@removed.invalid', "
            "password_hash = '!', mfa_secret = NULL, mfa_enabled = false WHERE id = :u"
        ),
        {"u": user_id},
    )
    await write_audit(
        s,
        tenant_id=tenant_id,
        scope="tenant",
        actor_id=actor_id,
        action="user.remove",
        subject_type="user",
        subject_id=str(user_id),
        request_id=request_id,
    )


async def set_active(
    s: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    actor_id: uuid.UUID,
    user_id: uuid.UUID,
    active: bool,
    request_id: str | None,
) -> None:
    member = await _member(s, tenant_id, user_id)
    if not active:
        admins = await _active_admins(s, tenant_id)
        if admins == [user_id]:
            raise ValidationFailed(
                "This is the last administrator. Make someone else an administrator first."
            )
        await s.execute(
            text("UPDATE control.session SET revoked = true WHERE user_id = :u AND tenant_id = :t"),
            {"u": user_id, "t": tenant_id},
        )
    await s.execute(
        text("UPDATE control.app_user SET active = :a WHERE id = :u"), {"a": active, "u": member.id}
    )
    await write_audit(
        s,
        tenant_id=tenant_id,
        scope="tenant",
        actor_id=actor_id,
        action="user.activate" if active else "user.deactivate",
        subject_type="user",
        subject_id=str(user_id),
        detail={},
        request_id=request_id,
    )


async def set_member_role(
    s: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    actor_id: uuid.UUID,
    user_id: uuid.UUID,
    role_key: str,
    request_id: str | None,
) -> None:
    member = await _member(s, tenant_id, user_id)
    exists = (
        await s.execute(
            text("SELECT 1 FROM control.tenant_role WHERE tenant_id = :t AND key = :k"),
            {"t": tenant_id, "k": role_key},
        )
    ).first()
    if exists is None:
        raise _bad("role", "is not a role in this workspace", "unknown")
    admins = await _active_admins(s, tenant_id)
    new_is_admin = (
        await s.execute(
            text(
                "SELECT 1 FROM control.tenant_role_grant WHERE tenant_id = :t AND role_key = :k AND permission = '*'"
            ),
            {"t": tenant_id, "k": role_key},
        )
    ).first()
    if admins == [member.id] and not new_is_admin:
        raise ValidationFailed("This is the last administrator and cannot lose the admin role.")
    await s.execute(
        text("UPDATE control.membership SET role_key = :r WHERE tenant_id = :t AND user_id = :u"),
        {"r": role_key, "t": tenant_id, "u": user_id},
    )
    await write_audit(
        s,
        tenant_id=tenant_id,
        scope="tenant",
        actor_id=actor_id,
        action="user.role_change",
        subject_type="user",
        subject_id=str(user_id),
        detail={"role": role_key},
        request_id=request_id,
    )


# ---- teams --------------------------------------------------------------------------------


async def list_teams(s: AsyncSession, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
    rows = (
        await s.execute(
            text(
                "SELECT t.id, t.name, COALESCE(array_agg(tm.user_id) FILTER (WHERE tm.user_id IS NOT NULL), '{}') AS members "
                "FROM control.team t LEFT JOIN control.team_member tm ON tm.team_id = t.id "
                "WHERE t.tenant_id = :t GROUP BY t.id, t.name ORDER BY t.name"
            ),
            {"t": tenant_id},
        )
    ).all()
    return [{"id": str(r.id), "name": r.name, "members": [str(m) for m in r.members]} for r in rows]


async def create_team(s: AsyncSession, tenant_id: uuid.UUID, name: str) -> dict[str, Any]:
    name = name.strip()
    if not name:
        raise _bad("name", "is required", "required")
    tid = new_id()
    try:
        async with s.begin_nested():
            await s.execute(
                text("INSERT INTO control.team (id, tenant_id, name) VALUES (:i, :t, :n)"),
                {"i": tid, "t": tenant_id, "n": name},
            )
    except Exception:
        raise _bad("name", "a team with this name already exists", "taken") from None
    return {"id": str(tid), "name": name, "members": []}


async def set_team_members(
    s: AsyncSession, tenant_id: uuid.UUID, team_id: uuid.UUID, user_ids: list[uuid.UUID]
) -> None:
    team = (
        await s.execute(
            text("SELECT 1 FROM control.team WHERE id = :i AND tenant_id = :t"),
            {"i": team_id, "t": tenant_id},
        )
    ).first()
    if team is None:
        raise NotFound("That team does not exist.")
    valid = {p["id"] for p in await list_people(s, tenant_id)}
    if any(str(u) not in valid for u in user_ids):
        raise _bad("members", "includes someone who is not in this workspace")
    await s.execute(text("DELETE FROM control.team_member WHERE team_id = :i"), {"i": team_id})
    for u in set(user_ids):
        await s.execute(
            text("INSERT INTO control.team_member (team_id, user_id) VALUES (:i, :u)"),
            {"i": team_id, "u": u},
        )


# ---- roles and permissions grid -----------------------------------------------------------


async def list_roles(s: AsyncSession, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
    roles = (
        await s.execute(
            text(
                "SELECT r.key, r.name, r.description, "
                "(SELECT count(*) FROM control.membership m WHERE m.tenant_id = r.tenant_id AND m.role_key = r.key) AS members "
                "FROM control.tenant_role r WHERE r.tenant_id = :t ORDER BY (r.key = 'admin') DESC, r.name"
            ),
            {"t": tenant_id},
        )
    ).all()
    grants = (
        await s.execute(
            text("SELECT role_key, permission FROM control.tenant_role_grant WHERE tenant_id = :t"),
            {"t": tenant_id},
        )
    ).all()
    scopes = (
        await s.execute(
            text(
                "SELECT role_key, table_key, scope FROM control.tenant_role_scope WHERE tenant_id = :t"
            ),
            {"t": tenant_id},
        )
    ).all()
    denies = (
        await s.execute(
            text(
                "SELECT role_key, table_key, field_key FROM control.tenant_field_deny WHERE tenant_id = :t"
            ),
            {"t": tenant_id},
        )
    ).all()
    return [
        {
            "key": r.key,
            "name": r.name,
            "description": r.description,
            "members": r.members,
            "grants": sorted(g.permission for g in grants if g.role_key == r.key),
            "scopes": {x.table_key: x.scope for x in scopes if x.role_key == r.key},
            "field_deny": sorted(
                f"{d.table_key}.{d.field_key}" for d in denies if d.role_key == r.key
            ),
        }
        for r in roles
    ]


async def save_role(
    s: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    actor_id: uuid.UUID,
    key: str,
    name: str,
    description: str,
    grants: list[str],
    scopes: dict[str, str],
    field_deny: list[str],
    request_id: str | None,
) -> None:
    """Create or replace a role. Takes effect on the person's next request (nothing is cached)."""
    if key == "admin":
        raise ValidationFailed("The Administrator role cannot be changed.")
    if not key or not key.replace("_", "").isalnum() or not key[0].isalpha():
        raise _bad("key", "use letters, numbers and underscores", "invalid")
    if not name.strip():
        raise _bad("name", "is required", "required")
    if "*" in grants:
        raise _bad("grants", "only the Administrator role has full access")
    for sc in scopes.values():
        if sc not in SCOPES:
            raise _bad("scopes", f"'{sc}' is not a visibility rule")
    await s.execute(
        text(
            "INSERT INTO control.tenant_role (tenant_id, key, name, description) VALUES (:t, :k, :n, :d) "
            "ON CONFLICT (tenant_id, key) DO UPDATE SET name = :n, description = :d"
        ),
        {"t": tenant_id, "k": key, "n": name.strip(), "d": description},
    )
    for tbl in ("tenant_role_grant", "tenant_role_scope", "tenant_field_deny"):
        await s.execute(
            text(f"DELETE FROM control.{tbl} WHERE tenant_id = :t AND role_key = :k"),  # noqa: S608
            {"t": tenant_id, "k": key},
        )
    for g in sorted(set(grants)):
        await s.execute(
            text(
                "INSERT INTO control.tenant_role_grant (tenant_id, role_key, permission) VALUES (:t, :k, :p)"
            ),
            {"t": tenant_id, "k": key, "p": g},
        )
    for table, sc in scopes.items():
        await s.execute(
            text(
                "INSERT INTO control.tenant_role_scope (tenant_id, role_key, table_key, scope) VALUES (:t, :k, :tb, :sc)"
            ),
            {"t": tenant_id, "k": key, "tb": table, "sc": sc},
        )
    for d in sorted(set(field_deny)):
        table, _, fld = d.partition(".")
        await s.execute(
            text(
                "INSERT INTO control.tenant_field_deny (tenant_id, role_key, table_key, field_key) VALUES (:t, :k, :tb, :f)"
            ),
            {"t": tenant_id, "k": key, "tb": table, "f": fld},
        )
    await write_audit(
        s,
        tenant_id=tenant_id,
        scope="tenant",
        actor_id=actor_id,
        action="role.save",
        subject_type="role",
        subject_id=key,
        detail={"grants": len(grants)},
        request_id=request_id,
    )


async def delete_role(s: AsyncSession, tenant_id: uuid.UUID, key: str) -> None:
    if key == "admin":
        raise ValidationFailed("The Administrator role cannot be removed.")
    used = (
        await s.execute(
            text("SELECT count(*) FROM control.membership WHERE tenant_id = :t AND role_key = :k"),
            {"t": tenant_id, "k": key},
        )
    ).scalar_one()
    if used:
        raise ValidationFailed(
            f"{used} people still have this role. Move them to another role first."
        )
    await s.execute(
        text("DELETE FROM control.tenant_role WHERE tenant_id = :t AND key = :k"),
        {"t": tenant_id, "k": key},
    )


# ---- settings: branding and regional ------------------------------------------------------


async def get_settings(s: AsyncSession, tenant_id: uuid.UUID) -> dict[str, Any]:
    row = (
        await s.execute(
            text("SELECT name, settings FROM control.tenant WHERE id = :t"), {"t": tenant_id}
        )
    ).one()
    stored = row.settings or {}
    brand = {
        "app_name": row.name,
        "accent": "#1d4ed8",
        "logo_file_id": None,
        **stored.get("brand", {}),
    }
    return {"brand": brand, "regional": {**DEFAULT_REGIONAL, **stored.get("regional", {})}}


async def save_brand(
    s: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    actor_id: uuid.UUID,
    app_name: str,
    accent: str,
    logo_file_id: str | None,
    request_id: str | None,
) -> dict[str, Any]:
    if not app_name.strip():
        raise _bad("app_name", "is required", "required")
    if not contrast.is_hex(accent):
        raise _bad("accent", "must be a colour like #1d4ed8")
    ratio = contrast.ratio_with_white(accent)
    if ratio < contrast.MIN_RATIO:
        suggestion = contrast.nearest_passing(accent)
        raise ValidationFailed(
            f"White text on this colour is hard to read ({ratio:.1f}:1; 4.5:1 is needed). Try {suggestion}.",
            errors=[{"field": "accent", "code": "low_contrast", "message": f"try {suggestion}"}],
            extra={"suggestion": suggestion, "ratio": round(ratio, 2)},
        )
    if logo_file_id:
        logo = (
            await s.execute(
                text(
                    "SELECT kind, scan_status FROM control.file WHERE tenant_id = :t AND id::text = :i"
                ),
                {"t": tenant_id, "i": logo_file_id},
            )
        ).first()
        if logo is None or logo.kind != "logo":
            raise _bad("logo_file_id", "is not an uploaded logo")
        if logo.scan_status != "clean":
            raise _bad("logo_file_id", "did not pass the virus scan", "infected")
    brand = {"app_name": app_name.strip(), "accent": accent.lower(), "logo_file_id": logo_file_id}
    await s.execute(
        text(
            "UPDATE control.tenant SET settings = jsonb_set(settings, '{brand}', CAST(:b AS jsonb), true) WHERE id = :t"
        ),
        {"b": json.dumps(brand), "t": tenant_id},
    )
    await write_audit(
        s,
        tenant_id=tenant_id,
        scope="tenant",
        actor_id=actor_id,
        action="settings.brand",
        subject_type="settings",
        subject_id="brand",
        detail={},
        request_id=request_id,
    )
    return brand


async def save_regional(
    s: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    actor_id: uuid.UUID,
    values: dict[str, str],
    request_id: str | None,
) -> dict[str, Any]:
    regional = {**DEFAULT_REGIONAL, **{k: v for k, v in values.items() if k in DEFAULT_REGIONAL}}
    if regional["week_start"] not in ("monday", "sunday", "saturday"):
        raise _bad("week_start", "must be monday, sunday or saturday")
    await s.execute(
        text(
            "UPDATE control.tenant SET settings = jsonb_set(settings, '{regional}', CAST(:b AS jsonb), true) WHERE id = :t"
        ),
        {"b": json.dumps(regional), "t": tenant_id},
    )
    await write_audit(
        s,
        tenant_id=tenant_id,
        scope="tenant",
        actor_id=actor_id,
        action="settings.regional",
        subject_type="settings",
        subject_id="regional",
        detail={},
        request_id=request_id,
    )
    return regional
