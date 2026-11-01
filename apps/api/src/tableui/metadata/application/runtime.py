"""The live app as the runtime sees it: tables, rules and measures pinned by a manifest."""

import hashlib
import json
import uuid
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from tableui.metadata.domain.models import (
    AutomationDef,
    MeasureDef,
    NavItem,
    RuleDef,
    ScreenDef,
    TableDef,
    menu_sorted,
)
from tableui.platform.errors import NotFound


@dataclass(frozen=True)
class RuntimeApp:
    release_id: uuid.UUID
    release_version: int
    manifest_id: uuid.UUID
    tables: dict[str, TableDef]
    rules: list[RuleDef]
    measures: list[MeasureDef]
    screens: dict[str, ScreenDef]
    navigation: list[NavItem]
    automations: list[AutomationDef] = field(default_factory=list)

    def table(self, key: str) -> TableDef:
        t = self.tables.get(key)
        if t is None:
            raise NotFound(f"There is no table '{key}' in the live app.")
        return t


_cache: dict[uuid.UUID, RuntimeApp] = {}


def canonical_hash(content: dict[str, Any]) -> str:
    raw = json.dumps(content, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(raw.encode()).hexdigest()


def _from_manifest(
    release_id: uuid.UUID, version: int, manifest_id: uuid.UUID, content: dict[str, Any]
) -> RuntimeApp:
    return RuntimeApp(
        release_id=release_id,
        release_version=version,
        manifest_id=manifest_id,
        tables={k: TableDef.model_validate(v["definition"]) for k, v in content["tables"].items()},
        rules=[RuleDef.model_validate(v["definition"]) for v in content["rules"].values()],
        measures=[MeasureDef.model_validate(v["definition"]) for v in content["measures"].values()],
        automations=[
            AutomationDef.model_validate(v["definition"])
            for v in content.get("automations", {}).values()
        ],
        screens={
            k: ScreenDef.model_validate(v["definition"])
            for k, v in content.get("screens", {}).items()
        },
        navigation=menu_sorted(
            [NavItem.model_validate(v["definition"]) for v in content.get("navs", {}).values()],
            lambda n: n.section,
            lambda n: n.order,
        ),
    )


async def live_app(session: AsyncSession, tenant_id: uuid.UUID, env: str = "live") -> RuntimeApp:
    """The release currently in an environment (Live by default). Manifests are immutable, so they are cached."""
    row = (
        await session.execute(
            text(
                "SELECT r.id AS release_id, r.version, r.manifest_id FROM control.release_deployment d "
                "JOIN control.release r ON r.id = d.release_id "
                "WHERE d.tenant_id = :t AND d.environment = :e ORDER BY d.id DESC LIMIT 1"
            ),
            {"t": tenant_id, "e": env},
        )
    ).first()
    if row is None:
        raise NotFound(
            "This app has not been published yet. Publish it to Live in the Studio first."
            if env == "live"
            else "Nothing has been published to Test yet."
        )
    cached = _cache.get(row.manifest_id)
    if cached is not None and cached.release_id == row.release_id:
        return cached
    content = (
        await session.execute(
            text("SELECT content FROM control.manifest WHERE id = :m"), {"m": row.manifest_id}
        )
    ).scalar_one()
    app = _from_manifest(row.release_id, row.version, row.manifest_id, content)
    _cache[row.manifest_id] = app
    return app
