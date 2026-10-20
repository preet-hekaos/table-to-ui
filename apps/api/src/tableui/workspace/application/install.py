"""Onboarding: choose a pack (or start blank). Installing a pack is one all-or-nothing transaction."""

import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tableui.audit.public import write_audit
from tableui.catalog.public import PackCatalog
from tableui.metadata.public import (
    Pack,
    build_manifest,
    promote_to_live,
    publish_to_test,
)
from tableui.platform.db import Database
from tableui.platform.errors import ValidationFailed
from tableui.platform.ids import schema_name
from tableui.tenancy.public import Tenant, install_pack_schema

BLANK = "blank"


async def onboarding_state(
    db: Database, tenant_id: uuid.UUID, catalog: PackCatalog
) -> dict[str, Any]:
    async with db.control() as s:
        row = (
            await s.execute(
                text(
                    "SELECT name, pack_id, pack_version, onboarding_step FROM control.tenant WHERE id = :t"
                ),
                {"t": tenant_id},
            )
        ).one()
    return {
        "workspace": row.name,
        "step": row.onboarding_step,
        "pack_id": row.pack_id,
        "pack_version": row.pack_version,
        "packs": catalog.summaries(),
    }


async def _install_roles(s: AsyncSession, tenant_id: uuid.UUID, pack: Pack) -> None:
    for role in pack.roles:
        if role.key == "admin":
            continue  # every workspace already has its Administrator
        await s.execute(
            text(
                "INSERT INTO control.tenant_role (tenant_id, key, name, description) "
                "VALUES (:t, :k, :n, :d) ON CONFLICT DO NOTHING"
            ),
            {"t": tenant_id, "k": role.key, "n": role.name, "d": role.description},
        )
        for perm in role.grants:
            await s.execute(
                text(
                    "INSERT INTO control.tenant_role_grant (tenant_id, role_key, permission) "
                    "VALUES (:t, :r, :p) ON CONFLICT DO NOTHING"
                ),
                {"t": tenant_id, "r": role.key, "p": perm},
            )
        for table, scope in role.scopes.items():
            await s.execute(
                text(
                    "INSERT INTO control.tenant_role_scope (tenant_id, role_key, table_key, scope) "
                    "VALUES (:t, :r, :tb, :sc) ON CONFLICT DO NOTHING"
                ),
                {
                    "t": tenant_id,
                    "r": role.key,
                    "tb": "*" if table == "default" else table,
                    "sc": scope,
                },
            )
        for denied in role.field_deny:
            table, _, fld = denied.partition(".")
            await s.execute(
                text(
                    "INSERT INTO control.tenant_field_deny (tenant_id, role_key, table_key, field_key) "
                    "VALUES (:t, :r, :tb, :f) ON CONFLICT DO NOTHING"
                ),
                {"t": tenant_id, "r": role.key, "tb": table, "f": fld},
            )


async def install_pack(
    db: Database,
    catalog: PackCatalog,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    pack_id: str,
    request_id: str | None,
) -> dict[str, Any]:
    """Create the pack's tables, roles, screens and navigation and publish the first Live version."""
    pack = None if pack_id == BLANK else catalog.get(pack_id)
    async with db.control() as s:
        tenant = (
            await s.execute(
                text("SELECT name, pack_id FROM control.tenant WHERE id = :t FOR UPDATE"),
                {"t": tenant_id},
            )
        ).one()
        if tenant.pack_id is not None:
            raise ValidationFailed("This workspace already has its starting point.")
        if pack is not None:
            t = Tenant(id=tenant_id, name=tenant.name, schema_name=schema_name(tenant_id))
            await install_pack_schema(s, t, pack)
            await s.execute(
                text("SELECT set_config('app.tenant_id', :t, true)"), {"t": str(tenant_id)}
            )
            await s.execute(text(f'SET LOCAL search_path TO "{t.schema_name}", pg_catalog'))
            manifest = await build_manifest(s)
            await s.execute(text("RESET search_path"))
            published = await publish_to_test(
                s, tenant_id=tenant_id, user_id=user_id, manifest=manifest, request_id=request_id
            )
            await promote_to_live(
                s,
                tenant_id=tenant_id,
                user_id=user_id,
                version=published["version"],
                request_id=request_id,
            )
            await _install_roles(s, tenant_id, pack)
        await s.execute(
            text(
                "UPDATE control.tenant SET pack_id = :p, pack_version = :v, onboarding_step = 'done' "
                "WHERE id = :t"
            ),
            {"p": pack_id, "v": pack.version if pack else None, "t": tenant_id},
        )
        await write_audit(
            s,
            tenant_id=tenant_id,
            scope="tenant",
            actor_id=user_id,
            action="workspace.pack_install",
            subject_type="pack",
            subject_id=pack_id,
            detail={"version": pack.version if pack else None},
            request_id=request_id,
        )
    return {"pack_id": pack_id, "step": "done"}
