"""Public interface of the metadata module."""

from tableui.metadata.application.draft import build_manifest, read_draft_tables, seed_draft
from tableui.metadata.application.pack_loader import PackInvalid, PackIssue, load_pack
from tableui.metadata.application.releases import (
    list_releases,
    promote_to_live,
    publish_to_test,
    rollback_live,
)
from tableui.metadata.application.runtime import RuntimeApp, live_app
from tableui.metadata.application.studio import add_field
from tableui.metadata.domain.ddl import (
    add_field_index_sql,
    add_shadow_column_sql,
    base_schema_sql,
    table_ddl_sql,
    tenant_schema_sql,
)
from tableui.metadata.domain.models import (
    ContextLoader,
    EffectDef,
    FieldDef,
    FixtureDef,
    MeasureDef,
    Pack,
    RuleCheck,
    RuleDef,
    StageDef,
    TableDef,
    WorkflowDef,
)
from tableui.metadata.domain.values import (
    normalise,
    search_document,
    shadow_columns,
    validate_record,
)

__all__ = [
    "add_field",
    "add_field_index_sql",
    "add_shadow_column_sql",
    "base_schema_sql",
    "search_document",
    "table_ddl_sql",
    "ContextLoader",
    "FieldDef",
    "FixtureDef",
    "MeasureDef",
    "Pack",
    "PackInvalid",
    "PackIssue",
    "RuleCheck",
    "RuleDef",
    "RuntimeApp",
    "EffectDef",
    "StageDef",
    "TableDef",
    "WorkflowDef",
    "build_manifest",
    "list_releases",
    "live_app",
    "load_pack",
    "normalise",
    "promote_to_live",
    "publish_to_test",
    "read_draft_tables",
    "rollback_live",
    "seed_draft",
    "shadow_columns",
    "tenant_schema_sql",
    "validate_record",
]
