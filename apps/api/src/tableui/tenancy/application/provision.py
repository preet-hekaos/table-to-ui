"""tenant.provision: create the tenant row, its schema, tables and Draft in the caller's transaction."""

import uuid
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tableui.metadata.public import Pack, seed_draft, tenant_schema_sql
from tableui.platform.ids import new_id, schema_name
from tableui.platform.sql import split_statements


@dataclass(frozen=True)
class Tenant:
    id: uuid.UUID
    name: str
    schema_name: str


async def provision_tenant(
    control: AsyncSession, *, name: str, pack: Pack, workos_org_id: str | None
) -> Tenant:
    """All-or-nothing: DDL is transactional in PostgreSQL, so a failure leaves nothing behind."""
    tenant_id = new_id()
    schema = schema_name(tenant_id)
    await control.execute(
        text(
            "INSERT INTO control.tenant (id, name, schema_name, workos_org_id) "
            "VALUES (:i, :n, :s, :o)"
        ),
        {"i": tenant_id, "n": name, "s": schema, "o": workos_org_id},
    )
    for stmt in split_statements(tenant_schema_sql(schema, pack)):
        await control.execute(text(stmt))
    # Seed the Draft with RLS context set for this tenant, then restore the search path.
    await control.execute(
        text("SELECT set_config('app.tenant_id', :t, true)"), {"t": str(tenant_id)}
    )
    await control.execute(text(f'SET LOCAL search_path TO "{schema}", pg_catalog'))
    await seed_draft(control, tenant_id, pack)
    await control.execute(text("RESET search_path"))
    return Tenant(id=tenant_id, name=name, schema_name=schema)
