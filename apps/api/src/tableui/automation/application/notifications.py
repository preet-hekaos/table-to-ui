"""Notifications: the bell, per-kind preferences, immediate email, and the daily digest."""

import hashlib
import hmac
import json
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tableui.platform.errors import NotFound, ValidationFailed
from tableui.platform.ids import new_id
from tableui.platform.mail import Mailer

KINDS: dict[str, str] = {
    "automation": "Reminders and alerts from automations",
    "task": "Tasks given to me",
    "approval": "Changes waiting for my approval",
}
CHANNELS = ("in_app", "in_app_email", "off")
DEFAULT_CHANNEL = "in_app"


def _sign(secret: str, tenant_id: uuid.UUID, user_id: uuid.UUID) -> str:
    msg = f"unsubscribe:{tenant_id}:{user_id}".encode()
    return hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()[:32]


def unsubscribe_token(secret: str, tenant_id: uuid.UUID, user_id: uuid.UUID) -> str:
    return f"{tenant_id}.{user_id}.{_sign(secret, tenant_id, user_id)}"


async def unsubscribe(c: AsyncSession, secret: str, token: str) -> bool:
    """Turn the daily digest off for the person the token was made for."""
    try:
        t, u, sig = token.split(".")
        tenant_id, user_id = uuid.UUID(t), uuid.UUID(u)
    except ValueError:
        return False
    if not hmac.compare_digest(sig, _sign(secret, tenant_id, user_id)):
        return False
    await set_preferences(c, tenant_id, user_id, digest=False)
    return True


async def preferences(c: AsyncSession, tenant_id: uuid.UUID, user_id: uuid.UUID) -> dict[str, Any]:
    row = (
        await c.execute(
            text(
                "SELECT channels, digest FROM control.notification_pref "
                "WHERE tenant_id = :t AND user_id = :u"
            ),
            {"t": tenant_id, "u": user_id},
        )
    ).first()
    channels = dict(row.channels) if row else {}
    return {
        "kinds": [
            {"kind": k, "label": label, "channel": channels.get(k, DEFAULT_CHANNEL)}
            for k, label in KINDS.items()
        ],
        "digest": row.digest if row else True,
    }


async def set_preferences(
    c: AsyncSession,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    channels: dict[str, str] | None = None,
    digest: bool | None = None,
) -> dict[str, Any]:
    for k, v in (channels or {}).items():
        if k not in KINDS or v not in CHANNELS:
            raise ValidationFailed(
                errors=[{"field": k, "code": "invalid", "message": "unknown kind or setting"}]
            )
    now = await preferences(c, tenant_id, user_id)
    merged = {k["kind"]: k["channel"] for k in now["kinds"]} | (channels or {})
    await c.execute(
        text(
            "INSERT INTO control.notification_pref (tenant_id, user_id, channels, digest) "
            "VALUES (:t, :u, CAST(:c AS jsonb), :d) ON CONFLICT (tenant_id, user_id) DO UPDATE "
            "SET channels = EXCLUDED.channels, digest = EXCLUDED.digest, updated_at = now()"
        ),
        {
            "t": tenant_id,
            "u": user_id,
            "c": json.dumps(merged),
            "d": now["digest"] if digest is None else digest,
        },
    )
    return await preferences(c, tenant_id, user_id)


async def notify(
    c: AsyncSession,
    mailer: Mailer,
    *,
    tenant_id: uuid.UUID,
    user_ids: list[uuid.UUID],
    kind: str,
    title: str,
    link: str | None = None,
    table_key: str | None = None,
    record_id: uuid.UUID | None = None,
    source: str | None = None,
    dedupe_key: str | None = None,
    also_email: bool = False,
) -> int:
    """Tell people. Each person's own setting wins: off means nothing, email only if they allow it."""
    sent = 0
    for uid in dict.fromkeys(user_ids):
        who = (
            await c.execute(
                text(
                    "SELECT u.email, u.active, COALESCE(p.channels ->> :k, :d) AS channel "
                    "FROM control.membership m JOIN control.app_user u ON u.id = m.user_id "
                    "LEFT JOIN control.notification_pref p ON p.tenant_id = m.tenant_id AND p.user_id = u.id "
                    "WHERE m.tenant_id = :t AND u.id = :u"
                ),
                {"t": tenant_id, "u": uid, "k": kind, "d": DEFAULT_CHANNEL},
            )
        ).first()
        if who is None or not who.active or who.channel == "off":
            continue
        nid = (
            await c.execute(
                text(
                    "INSERT INTO control.notification (id, tenant_id, user_id, kind, title, link, "
                    "table_key, record_id, source, dedupe_key) "
                    "VALUES (:i, :t, :u, :k, :ti, :l, :tk, :r, :s, :dk) "
                    "ON CONFLICT (tenant_id, user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING "
                    "RETURNING id"
                ),
                {
                    "i": new_id(),
                    "t": tenant_id,
                    "u": uid,
                    "k": kind,
                    "ti": title,
                    "l": link,
                    "tk": table_key,
                    "r": record_id,
                    "s": source,
                    "dk": dedupe_key,
                },
            )
        ).scalar_one_or_none()
        if nid is None:
            continue  # already told
        sent += 1
        if who.channel == "in_app_email" or also_email:
            await mailer.send(to=who.email, subject=title, body=title)
            await c.execute(
                text("UPDATE control.notification SET emailed_at = now() WHERE id = :i"), {"i": nid}
            )
    return sent


def _out(r: Any) -> dict[str, Any]:
    return {
        "id": str(r.id),
        "kind": r.kind,
        "title": r.title,
        "link": r.link,
        "created_at": r.created_at.isoformat(),
        "read": r.read_at is not None,
    }


async def inbox(
    c: AsyncSession, tenant_id: uuid.UUID, user_id: uuid.UUID, *, limit: int = 30
) -> dict[str, Any]:
    rows = (
        await c.execute(
            text(
                "SELECT id, kind, title, link, created_at, read_at FROM control.notification "
                "WHERE tenant_id = :t AND user_id = :u ORDER BY created_at DESC LIMIT :n"
            ),
            {"t": tenant_id, "u": user_id, "n": limit},
        )
    ).all()
    return {"unread": await unread_count(c, tenant_id, user_id), "items": [_out(r) for r in rows]}


async def unread_count(c: AsyncSession, tenant_id: uuid.UUID, user_id: uuid.UUID) -> int:
    return int(
        (
            await c.execute(
                text(
                    "SELECT count(*) FROM control.notification "
                    "WHERE tenant_id = :t AND user_id = :u AND read_at IS NULL"
                ),
                {"t": tenant_id, "u": user_id},
            )
        ).scalar_one()
    )


async def mark_read(
    c: AsyncSession, tenant_id: uuid.UUID, user_id: uuid.UUID, ids: list[uuid.UUID] | None
) -> int:
    """Mark some (or, with no list, all) of my notifications read."""
    sql = (
        "UPDATE control.notification SET read_at = now() "
        "WHERE tenant_id = :t AND user_id = :u AND read_at IS NULL"
    )
    params: dict[str, Any] = {"t": tenant_id, "u": user_id}
    if ids is not None:
        sql += " AND id = ANY(:ids)"
        params["ids"] = ids
    return len((await c.execute(text(sql + " RETURNING id"), params)).all())


async def send_digests(
    c: AsyncSession,
    mailer: Mailer,
    *,
    tenant_id: uuid.UUID,
    secret: str,
    base_url: str,
    hour_utc: int,
    now: datetime | None = None,
) -> int:
    """One email a day to each person who has unread, un-emailed notifications and keeps the digest on."""
    now = now or datetime.now(UTC)
    if now.hour < hour_utc:
        return 0
    claimed = (
        await c.execute(
            text(
                "INSERT INTO control.automation_clock (tenant_id, digest_sent_on) VALUES (:t, :d) "
                "ON CONFLICT (tenant_id) DO UPDATE SET digest_sent_on = EXCLUDED.digest_sent_on "
                "WHERE control.automation_clock.digest_sent_on IS DISTINCT FROM EXCLUDED.digest_sent_on "
                "RETURNING tenant_id"
            ),
            {"t": tenant_id, "d": now.date()},
        )
    ).first()
    if claimed is None:
        return 0
    people = (
        await c.execute(
            text(
                "SELECT n.user_id, u.email FROM control.notification n "
                "JOIN control.app_user u ON u.id = n.user_id "
                "LEFT JOIN control.notification_pref p ON p.tenant_id = n.tenant_id AND p.user_id = n.user_id "
                "WHERE n.tenant_id = :t AND n.read_at IS NULL AND n.emailed_at IS NULL "
                "AND n.digested_at IS NULL AND u.active AND COALESCE(p.digest, true) "
                "GROUP BY n.user_id, u.email"
            ),
            {"t": tenant_id},
        )
    ).all()
    for person in people:
        items = (
            await c.execute(
                text(
                    "SELECT id, title, link FROM control.notification WHERE tenant_id = :t AND user_id = :u "
                    "AND read_at IS NULL AND emailed_at IS NULL AND digested_at IS NULL "
                    "ORDER BY created_at DESC LIMIT 50"
                ),
                {"t": tenant_id, "u": person.user_id},
            )
        ).all()
        lines = [f"- {i.title}" + (f"  {base_url}{i.link}" if i.link else "") for i in items]
        stop = (
            f"{base_url}/unsubscribe?token={unsubscribe_token(secret, tenant_id, person.user_id)}"
        )
        body = (
            f"You have {len(items)} update{'s' if len(items) != 1 else ''} waiting:\n\n"
            + "\n".join(lines)
            + f"\n\nOpen the app: {base_url}\nStop these daily emails: {stop}\n"
        )
        await mailer.send(to=person.email, subject="Your daily summary", body=body)
        await c.execute(
            text("UPDATE control.notification SET digested_at = now() WHERE id = ANY(:ids)"),
            {"ids": [i.id for i in items]},
        )
    return len(people)


async def require_owned(
    c: AsyncSession, tenant_id: uuid.UUID, user_id: uuid.UUID, nid: uuid.UUID
) -> None:
    ok = (
        await c.execute(
            text(
                "SELECT 1 FROM control.notification WHERE id = :i AND tenant_id = :t AND user_id = :u"
            ),
            {"i": nid, "t": tenant_id, "u": user_id},
        )
    ).first()
    if ok is None:
        raise NotFound("That notification does not exist.")


async def notify_approvers(
    c: AsyncSession,
    mailer: Mailer,
    *,
    tenant_id: uuid.UUID,
    requested_by: uuid.UUID,
    title: str,
    link: str,
    approval_id: uuid.UUID,
) -> int:
    """Tell everyone who can decide that a change is waiting (never the person who asked)."""
    rows = await c.execute(
        text(
            "SELECT DISTINCT u.id FROM control.membership m JOIN control.app_user u ON u.id = m.user_id "
            "JOIN control.tenant_role_grant g ON g.tenant_id = m.tenant_id AND g.role_key = m.role_key "
            "WHERE m.tenant_id = :t AND u.active AND u.id <> :r AND g.permission IN ('*', 'approval.decide')"
        ),
        {"t": tenant_id, "r": requested_by},
    )
    return await notify(
        c,
        mailer,
        tenant_id=tenant_id,
        user_ids=[r.id for r in rows],
        kind="approval",
        title=title,
        link=link,
        source="approval",
        dedupe_key=f"approval:{approval_id}",
    )
