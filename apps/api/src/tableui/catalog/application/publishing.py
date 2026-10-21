"""pack.publish (operators) and pack updates (workspace owners).

A pack version is published only when every fixture passes against the pack itself and its
compatibility range is valid. Workspaces see it as an available update; nothing changes until an
owner accepts. Accepting adds what is new (tables, fields, screens, menu entries, roles) and takes the
pack's rules and measures; it never removes or overwrites what the workspace changed itself.
"""

import json
import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tableui.audit.public import write_audit
from tableui.catalog.application.catalog import PackCatalog
from tableui.catalog.domain.versions import parse, satisfies, valid_range
from tableui.metadata.public import Pack, add_field_index_sql, add_shadow_column_sql, table_ddl_sql
from tableui.platform.errors import NotFound, ValidationFailed
from tableui.platform.ids import schema_name
from tableui.platform.sql import split_statements
from tableui.rules.public import run_fixtures


async def overview(s: AsyncSession, catalog: PackCatalog) -> list[dict[str, Any]]:
    rows = await s.execute(
        text(
            "SELECT pack_id, version, compatible_with, published_at FROM control.pack_release ORDER BY published_at DESC"
        )
    )
    published: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        published.setdefault(r.pack_id, []).append(
            {
                "version": r.version,
                "compatible_with": r.compatible_with,
                "published_at": r.published_at.isoformat(),
            }
        )
    return [
        {
            "id": p.id,
            "title": p.title,
            "version": p.version,
            "compatible_with": p.compatible_with,
            "fixtures": len(p.fixtures),
            "published": published.get(p.id, []),
            "is_published": any(x["version"] == p.version for x in published.get(p.id, [])),
        }
        for p in catalog.packs.values()
    ]


async def publish(
    s: AsyncSession,
    catalog: PackCatalog,
    *,
    operator_id: uuid.UUID,
    pack_id: str,
    request_id: str | None,
) -> dict[str, Any]:
    pack = catalog.get(pack_id)
    results = run_fixtures({t.key: t for t in pack.tables}, pack.rules, pack.fixtures)
    problems = []
    if results["total"] == 0:
        problems.append("The pack has no fixtures. Add examples of the outcomes it promises first.")
    elif results["failed"]:
        problems.append(f"{results['failed']} of {results['total']} fixtures fail.")
    if not valid_range(pack.compatible_with):
        problems.append(
            f"The compatibility range '{pack.compatible_with}' is not valid (for example >=1.0,<2.0)."
        )
    latest = (
        (
            await s.execute(
                text("SELECT version FROM control.pack_release WHERE pack_id = :p"), {"p": pack_id}
            )
        )
        .scalars()
        .all()
    )
    if latest and max(parse(v) for v in latest) >= parse(pack.version):
        problems.append(
            f"Version {pack.version} is not newer than the published {max(latest, key=parse)}."
        )
    if problems:
        raise ValidationFailed(" ".join(problems), extra={"fixtures": results})
    rid = uuid.uuid4()
    await s.execute(
        text(
            "INSERT INTO control.pack_release (id, pack_id, version, compatible_with, fixtures, results, content, published_by) "
            "VALUES (:i, :p, :v, :c, CAST(:f AS jsonb), CAST(:r AS jsonb), CAST(:content AS jsonb), :u)"
        ),
        {
            "i": rid,
            "p": pack_id,
            "v": pack.version,
            "c": pack.compatible_with,
            "f": json.dumps({"total": results["total"], "passed": results["passed"]}),
            "r": json.dumps(results),
            "content": pack.model_dump_json(),
            "u": operator_id,
        },
    )
    await write_audit(
        s, tenant_id=None, scope="platform", actor_id=operator_id, action="pack.publish",
        subject_type="pack", subject_id=f"{pack_id}@{pack.version}", detail={"fixtures": results["total"]}, request_id=request_id,
    )  # fmt: skip
    return {"pack_id": pack_id, "version": pack.version, "fixtures": results}


async def available_updates(s: AsyncSession, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
    t = (
        await s.execute(
            text("SELECT pack_id, pack_version FROM control.tenant WHERE id = :t"), {"t": tenant_id}
        )
    ).one()
    if not t.pack_id or not t.pack_version:
        return []
    rows = await s.execute(
        text(
            "SELECT version, compatible_with, published_at, content->>'title' AS title FROM control.pack_release WHERE pack_id = :p"
        ),
        {"p": t.pack_id},
    )
    out = [
        {
            "pack_id": t.pack_id,
            "version": r.version,
            "title": r.title,
            "published_at": r.published_at.isoformat(),
            "from": t.pack_version,
        }
        for r in rows
        if parse(r.version) > parse(t.pack_version) and satisfies(t.pack_version, r.compatible_with)
    ]
    return sorted(out, key=lambda x: parse(x["version"]))


async def _enter(s: AsyncSession, tenant_id: uuid.UUID) -> str:
    schema = schema_name(tenant_id)
    await s.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": str(tenant_id)})
    await s.execute(text(f'SET LOCAL search_path TO "{schema}", public, pg_catalog'))
    return schema


async def _put(
    s: AsyncSession, tenant_id: uuid.UUID, kind: str, key: str, d: dict[str, Any]
) -> None:
    await s.execute(
        text(
            "INSERT INTO metadata_object (tenant_id, kind, key, definition, source) VALUES (:t, :k, :key, CAST(:d AS jsonb), 'pack') "
            "ON CONFLICT (kind, key) DO UPDATE SET definition = EXCLUDED.definition, updated_at = now()"
        ),
        {"t": tenant_id, "k": kind, "key": key, "d": json.dumps(d)},
    )


async def accept_update(
    s: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    version: str,
    request_id: str | None,
) -> dict[str, Any]:
    """Merge the pack version into the Draft. The owner then publishes it like any other change."""
    updates = {u["version"]: u for u in await available_updates(s, tenant_id)}
    if version not in updates:
        raise NotFound(f"Version {version} is not an available update for this workspace.")
    pack_id = updates[version]["pack_id"]
    content = (
        await s.execute(
            text("SELECT content FROM control.pack_release WHERE pack_id = :p AND version = :v"),
            {"p": pack_id, "v": version},
        )
    ).scalar_one()
    pack = Pack.model_validate(content)
    schema = await _enter(s, tenant_id)
    existing = {
        (r.kind, r.key): r.definition
        for r in await s.execute(text("SELECT kind, key, definition FROM metadata_object"))
    }
    changes: dict[str, list[str]] = {
        "tables": [],
        "fields": [],
        "screens": [],
        "navs": [],
        "rules": [],
        "measures": [],
        "automations": [],
        "roles": [],
    }
    for t in pack.tables:
        cur = existing.get(("table", t.key))
        if cur is None:
            for stmt in split_statements(table_ddl_sql(schema, t)):
                await s.execute(text(stmt))
            await _put(s, tenant_id, "table", t.key, t.model_dump(mode="json"))
            changes["tables"].append(t.key)
            continue
        have = {f["key"] for f in cur["fields"]}
        new_fields = [f for f in t.fields if f.key not in have]
        groups = {g["key"] for g in cur.get("groups", [])}
        if not new_fields:
            continue
        for f in new_fields:
            if f.normalize:
                for stmt in split_statements(add_shadow_column_sql(schema, t.key, f.key, f.unique)):
                    await s.execute(text(stmt))
            if f.filterable or f.type == "reference":
                await s.execute(text(add_field_index_sql(schema, t.key, f.key)))
            changes["fields"].append(f"{t.key}.{f.key}")
        merged = {
            **cur,
            "fields": [*cur["fields"], *(f.model_dump(mode="json") for f in new_fields)],
            "groups": [
                *cur.get("groups", []),
                *(g.model_dump(mode="json") for g in t.groups if g.key not in groups),
            ],
            "version": int(cur.get("version", 1)) + 1,
        }
        await _put(s, tenant_id, "table", t.key, merged)
    additions: list[tuple[str, str, dict[str, Any]]] = [
        ("screen", sc.key, sc.model_dump(mode="json")) for sc in pack.screens
    ] + [("nav", n.key, n.model_dump(mode="json")) for n in pack.navigation]
    for kind, key, d in additions:
        if (kind, key) not in existing:  # the workspace's own changes to existing screens stay
            await _put(s, tenant_id, kind, key, d)
            changes[f"{kind}s"].append(key)
    logic: list[tuple[str, str, dict[str, Any]]] = (
        [("rule", r.id, r.model_dump(mode="json")) for r in pack.rules]
        + [("measure", m.key, m.model_dump(mode="json")) for m in pack.measures]
        + [("automation", a.key, a.model_dump(mode="json")) for a in pack.automations]
    )
    for kind, key, d in logic:
        if existing.get((kind, key)) != d:
            await _put(s, tenant_id, kind, key, d)
            changes[f"{kind}s"].append(key)
    await _put(
        s, tenant_id, "pack", pack.id, {"id": pack.id, "version": pack.version, "title": pack.title}
    )
    await s.execute(text("RESET search_path"))
    for role in pack.roles:
        added = (
            await s.execute(
                text(
                    "INSERT INTO control.tenant_role (tenant_id, key, name, description) VALUES (:t, :k, :n, :d) ON CONFLICT DO NOTHING RETURNING key"
                ),
                {"t": tenant_id, "k": role.key, "n": role.name, "d": role.description},
            )
        ).first()
        if added:
            for perm in role.grants:
                await s.execute(
                    text(
                        "INSERT INTO control.tenant_role_grant (tenant_id, role_key, permission) VALUES (:t, :r, :p) ON CONFLICT DO NOTHING"
                    ),
                    {"t": tenant_id, "r": role.key, "p": perm},
                )
            changes["roles"].append(role.key)
    await s.execute(
        text("UPDATE control.tenant SET pack_version = :v WHERE id = :t"),
        {"v": version, "t": tenant_id},
    )
    await write_audit(
        s, tenant_id=tenant_id, scope="tenant", actor_id=user_id, action="pack.update_accept",
        subject_type="pack", subject_id=f"{pack_id}@{version}", detail=changes, request_id=request_id,
    )  # fmt: skip
    return {"pack_id": pack_id, "version": version, "changes": changes}
