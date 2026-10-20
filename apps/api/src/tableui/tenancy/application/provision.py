"""tenant.provision: create the tenant row, its schema, tables and Draft in the caller's transaction."""

import uuid
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tableui.metadata.public import Pack, base_schema_sql, seed_draft, table_ddl_sql
from tableui.platform.ids import new_id, schema_name
from tableui.platform.sql import split_statements


@dataclass(frozen=True)
class Tenant:
    id: uuid.UUID
    name: str
    schema_name: str


async def provision_tenant(
    control: AsyncSession, *, name: str, workos_org_id: str | None
) -> Tenant:
    """A blank workspace: control row plus an empty tenant schema. Packs are installed afterwards.

    All-or-nothing: DDL is transactional in PostgreSQL, so a failure leaves nothing behind.
    """
    tenant_id = new_id()
    schema = schema_name(tenant_id)
    await control.execute(
        text(
            "INSERT INTO control.tenant (id, name, schema_name, workos_org_id) "
            "VALUES (:i, :n, :s, :o)"
        ),
        {"i": tenant_id, "n": name, "s": schema, "o": workos_org_id},
    )
    for stmt in split_statements(base_schema_sql(schema)):
        await control.execute(text(stmt))
    return Tenant(id=tenant_id, name=name, schema_name=schema)


async def install_pack_schema(control: AsyncSession, tenant: Tenant, pack: Pack) -> None:
    """Create the pack's tables in the workspace schema and seed its Draft (caller's transaction)."""
    for table in pack.tables:
        for stmt in split_statements(table_ddl_sql(tenant.schema_name, table)):
            await control.execute(text(stmt))
    await control.execute(
        text("SELECT set_config('app.tenant_id', :t, true)"), {"t": str(tenant.id)}
    )
    await control.execute(text(f'SET LOCAL search_path TO "{tenant.schema_name}", pg_catalog'))
    await seed_draft(control, tenant.id, pack)
    await control.execute(text("RESET search_path"))
