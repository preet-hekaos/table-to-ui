"""Draft -> Test -> Live, and rollback. Releases and manifests are immutable once written."""

import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tableui.audit.public import write_audit
from tableui.metadata.application.runtime import canonical_hash
from tableui.platform.errors import NotFound, ValidationFailed


async def publish_to_test(
    control: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    manifest: dict[str, Any],
    request_id: str | None,
) -> dict[str, Any]:
    manifest_id, release_id = uuid.uuid4(), uuid.uuid4()
    await control.execute(
        text(
            "INSERT INTO control.manifest (id, tenant_id, content, content_hash) "
            "VALUES (:i, :t, CAST(:c AS jsonb), :h)"
        ),
        {"i": manifest_id, "t": tenant_id, "c": _json(manifest), "h": canonical_hash(manifest)},
    )
    # Serialise version numbers per tenant.
    await control.execute(
        text("SELECT id FROM control.tenant WHERE id = :t FOR UPDATE"), {"t": tenant_id}
    )
    version = (
        await control.execute(
            text("SELECT COALESCE(MAX(version), 0) + 1 FROM control.release WHERE tenant_id = :t"),
            {"t": tenant_id},
        )
    ).scalar_one()
    await control.execute(
        text(
            "INSERT INTO control.release (id, tenant_id, version, manifest_id, created_by) "
            "VALUES (:i, :t, :v, :m, :u)"
        ),
        {"i": release_id, "t": tenant_id, "v": version, "m": manifest_id, "u": user_id},
    )
    await _deploy(control, tenant_id, "test", release_id, "publish", user_id)
    await write_audit(
        control,
        tenant_id=tenant_id,
        scope="tenant",
        actor_id=user_id,
        action="release.publish_test",
        subject_type="release",
        subject_id=str(release_id),
        detail={"version": version},
        request_id=request_id,
    )
    return {"version": version, "release_id": str(release_id)}


async def promote_to_live(
    control: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    version: int,
    request_id: str | None,
) -> dict[str, Any]:
    rel = await _release(control, tenant_id, version)
    await _require_tested(control, tenant_id, rel)
    await control.execute(
        text(
            "UPDATE control.release_approval SET status = 'approved', decided_by = :u, decided_at = now() "
            "WHERE tenant_id = :t AND release_id = :r AND status = 'pending'"
        ),
        {"u": user_id, "t": tenant_id, "r": rel},
    )
    await _deploy(control, tenant_id, "live", rel, "publish", user_id)
    await write_audit(
        control,
        tenant_id=tenant_id,
        scope="tenant",
        actor_id=user_id,
        action="release.publish_live",
        subject_type="release",
        subject_id=str(rel),
        detail={"version": version},
        request_id=request_id,
    )
    return {"version": version, "release_id": str(rel)}


async def request_live(
    control: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    version: int,
    request_id: str | None,
) -> dict[str, Any]:
    """A builder who is not an owner asks for a tested version to go Live; an owner decides."""
    rel = await _release(control, tenant_id, version)
    await _require_tested(control, tenant_id, rel)
    pending = (
        await control.execute(
            text(
                "SELECT id FROM control.release_approval WHERE tenant_id = :t AND release_id = :r "
                "AND status = 'pending'"
            ),
            {"t": tenant_id, "r": rel},
        )
    ).scalar_one_or_none()
    approval_id = pending or uuid.uuid4()
    if pending is None:
        await control.execute(
            text(
                "INSERT INTO control.release_approval (id, tenant_id, release_id, version, requested_by) "
                "VALUES (:i, :t, :r, :v, :u)"
            ),
            {"i": approval_id, "t": tenant_id, "r": rel, "v": version, "u": user_id},
        )
        await write_audit(
            control,
            tenant_id=tenant_id,
            scope="tenant",
            actor_id=user_id,
            action="release.request_live",
            subject_type="release",
            subject_id=str(rel),
            detail={"version": version},
            request_id=request_id,
        )
    return {
        "version": version,
        "release_id": str(rel),
        "status": "pending_approval",
        "approval_id": str(approval_id),
    }


async def decide_live(
    control: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    approval_id: uuid.UUID,
    approve: bool,
    request_id: str | None,
) -> dict[str, Any]:
    row = (
        await control.execute(
            text(
                "SELECT version, requested_by, status FROM control.release_approval "
                "WHERE id = :i AND tenant_id = :t FOR UPDATE"
            ),
            {"i": approval_id, "t": tenant_id},
        )
    ).first()
    if row is None:
        raise NotFound("There is no such approval request.")
    if row.status != "pending":
        raise ValidationFailed("This request has already been decided.")
    await control.execute(
        text(
            "UPDATE control.release_approval SET status = :s, decided_by = :u, decided_at = now() "
            "WHERE id = :i"
        ),
        {"s": "approved" if approve else "rejected", "u": user_id, "i": approval_id},
    )
    if not approve:
        await write_audit(
            control,
            tenant_id=tenant_id,
            scope="tenant",
            actor_id=user_id,
            action="release.reject_live",
            subject_type="release_approval",
            subject_id=str(approval_id),
            detail={"version": row.version},
            request_id=request_id,
        )
        return {"version": row.version, "status": "rejected"}
    out = await promote_to_live(
        control, tenant_id=tenant_id, user_id=user_id, version=row.version, request_id=request_id
    )
    return {**out, "status": "live"}


async def list_approvals(control: AsyncSession, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
    rows = await control.execute(
        text(
            "SELECT a.id, a.version, a.status, a.requested_at, a.decided_at, u.full_name AS requested_by "
            "FROM control.release_approval a JOIN control.app_user u ON u.id = a.requested_by "
            "WHERE a.tenant_id = :t ORDER BY a.requested_at DESC LIMIT 50"
        ),
        {"t": tenant_id},
    )
    return [
        {
            "approval_id": str(r.id),
            "version": r.version,
            "status": r.status,
            "requested_by": r.requested_by,
            "requested_at": r.requested_at.isoformat(),
            "decided_at": r.decided_at.isoformat() if r.decided_at else None,
        }
        for r in rows
    ]


async def manifest_of(control: AsyncSession, tenant_id: uuid.UUID, version: int) -> dict[str, Any]:
    row = (
        await control.execute(
            text(
                "SELECT m.content FROM control.release r JOIN control.manifest m ON m.id = r.manifest_id "
                "WHERE r.tenant_id = :t AND r.version = :v"
            ),
            {"t": tenant_id, "v": version},
        )
    ).first()
    if row is None:
        raise NotFound(f"There is no version {version}.")
    return row.content  # type: ignore[no-any-return]


async def environment_manifest(
    control: AsyncSession, tenant_id: uuid.UUID, env: str
) -> tuple[int, dict[str, Any]] | None:
    row = (
        await control.execute(
            text(
                "SELECT r.version, m.content FROM control.release_deployment d "
                "JOIN control.release r ON r.id = d.release_id JOIN control.manifest m ON m.id = r.manifest_id "
                "WHERE d.tenant_id = :t AND d.environment = :e ORDER BY d.id DESC LIMIT 1"
            ),
            {"t": tenant_id, "e": env},
        )
    ).first()
    return (row.version, row.content) if row else None


async def _require_tested(control: AsyncSession, tenant_id: uuid.UUID, rel: uuid.UUID) -> None:
    tested = (
        await control.execute(
            text(
                "SELECT 1 FROM control.release_deployment WHERE tenant_id = :t AND "
                "release_id = :r AND environment = 'test' LIMIT 1"
            ),
            {"t": tenant_id, "r": rel},
        )
    ).first()
    if tested is None:
        raise ValidationFailed("Only a version that was published to Test can go Live.")


async def rollback_live(
    control: AsyncSession, *, tenant_id: uuid.UUID, user_id: uuid.UUID, request_id: str | None
) -> dict[str, Any]:
    rows = (
        await control.execute(
            text(
                "SELECT d.release_id, r.version FROM control.release_deployment d "
                "JOIN control.release r ON r.id = d.release_id "
                "WHERE d.tenant_id = :t AND d.environment = 'live' ORDER BY d.id DESC"
            ),
            {"t": tenant_id},
        )
    ).all()
    if not rows:
        raise ValidationFailed("Nothing is live yet, so there is nothing to roll back.")
    current = rows[0]
    previous = next((r for r in rows[1:] if r.release_id != current.release_id), None)
    if previous is None:
        raise ValidationFailed("There is no earlier live version to roll back to.")
    await _deploy(control, tenant_id, "live", previous.release_id, "rollback", user_id)
    await write_audit(
        control,
        tenant_id=tenant_id,
        scope="tenant",
        actor_id=user_id,
        action="release.rollback",
        subject_type="release",
        subject_id=str(previous.release_id),
        detail={"from_version": current.version, "to_version": previous.version},
        request_id=request_id,
    )
    return {"version": previous.version, "release_id": str(previous.release_id)}


async def list_releases(control: AsyncSession, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
    rows = (
        await control.execute(
            text(
                "SELECT r.id, r.version, r.created_at, r.created_by, m.content_hash, m.content, "
                "(SELECT d.release_id FROM control.release_deployment d WHERE d.tenant_id = r.tenant_id "
                "  AND d.environment = 'live' ORDER BY d.id DESC LIMIT 1) = r.id AS is_live, "
                "(SELECT d.release_id FROM control.release_deployment d WHERE d.tenant_id = r.tenant_id "
                "  AND d.environment = 'test' ORDER BY d.id DESC LIMIT 1) = r.id AS is_test "
                "FROM control.release r JOIN control.manifest m ON m.id = r.manifest_id "
                "WHERE r.tenant_id = :t ORDER BY r.version DESC"
            ),
            {"t": tenant_id},
        )
    ).all()
    return [
        {
            "version": r.version,
            "release_id": str(r.id),
            "created_at": r.created_at.isoformat(),
            "manifest_hash": r.content_hash,
            "is_live": bool(r.is_live),
            "is_test": bool(r.is_test),
            "manifest": {
                "pack": r.content["pack"],
                "tables": {
                    k: {"version": v["version"], "hash": v["hash"]}
                    for k, v in r.content["tables"].items()
                },
                "rules": {
                    k: {"version": v["version"], "hash": v["hash"]}
                    for k, v in r.content["rules"].items()
                },
                **{
                    kind: {
                        k: {"version": v["version"], "hash": v["hash"]}
                        for k, v in r.content.get(kind, {}).items()
                    }
                    for kind in ("measures", "automations", "screens", "navs")
                },
            },
        }
        for r in rows
    ]


async def _release(control: AsyncSession, tenant_id: uuid.UUID, version: int) -> uuid.UUID:
    rid = (
        await control.execute(
            text("SELECT id FROM control.release WHERE tenant_id = :t AND version = :v"),
            {"t": tenant_id, "v": version},
        )
    ).scalar_one_or_none()
    if rid is None:
        raise NotFound(f"There is no version {version}.")
    return rid  # type: ignore[no-any-return]


async def _deploy(
    control: AsyncSession,
    tenant_id: uuid.UUID,
    env: str,
    release_id: uuid.UUID,
    action: str,
    user_id: uuid.UUID,
) -> None:
    await control.execute(
        text(
            "INSERT INTO control.release_deployment (tenant_id, environment, release_id, action, by_user) "
            "VALUES (:t, :e, :r, :a, :u)"
        ),
        {"t": tenant_id, "e": env, "r": release_id, "a": action, "u": user_id},
    )


def _json(obj: Any) -> str:
    import json

    return json.dumps(obj)
