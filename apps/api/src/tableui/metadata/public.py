"""Public interface of the metadata module."""

from tableui.metadata.application.draft import build_manifest, read_draft_tables, seed_draft
from tableui.metadata.application.ops import (
    REGISTRY,
    operations_help,
    outline,
    restore,
    run_op,
    snapshot,
    snapshot_hash,
)
from tableui.metadata.application.pack_loader import PackInvalid, PackIssue, load_pack
from tableui.metadata.application.releases import (
    list_releases,
    promote_to_live,
    publish_to_test,
    rollback_live,
)
from tableui.metadata.application.runtime import RuntimeApp, live_app
from tableui.metadata.application.studio import add_field, create_table, field_about, read_draft
from tableui.metadata.domain.automations import problems as automation_problems
from tableui.metadata.domain.ddl import (
    add_field_index_sql,
    add_shadow_column_sql,
    base_schema_sql,
    table_ddl_sql,
    tenant_schema_sql,
)
from tableui.metadata.domain.measures import problems as measure_problems
from tableui.metadata.domain.models import (
    CHART_NUMBER_TYPES,
    CHART_X_TYPES,
    AutomationDef,
    ContextLoader,
    EffectDef,
    FieldDef,
    FixtureDef,
    GuideDef,
    MeasureDef,
    Pack,
    PromptDef,
    RuleCheck,
    RuleDef,
    SampleRecord,
    StageDef,
    StatCard,
    TableDef,
    TableFeatures,
    TransformRule,
    WorkflowDef,
    features_of,
)
from tableui.metadata.domain.patterns import check_pattern, rule_problem
from tableui.metadata.domain.presets import BY_KEY as TYPE_PRESETS
from tableui.metadata.domain.transforms import apply_field_rules
from tableui.metadata.domain.values import (
    normalise,
    search_document,
    shadow_columns,
    validate_record,
)

__all__ = [
    "field_about",
    "apply_field_rules",
    "check_pattern",
    "rule_problem",
    "features_of",
    "create_table",
    "read_draft",
    "REGISTRY",
    "operations_help",
    "outline",
    "restore",
    "run_op",
    "snapshot",
    "snapshot_hash",
    "AutomationDef",
    "GuideDef",
    "PromptDef",
    "SampleRecord",
    "automation_problems",
    "measure_problems",
    "add_field",
    "add_field_index_sql",
    "add_shadow_column_sql",
    "base_schema_sql",
    "search_document",
    "table_ddl_sql",
    "ContextLoader",
    "FieldDef",
    "TYPE_PRESETS",
    "TransformRule",
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
    "StatCard",
    "CHART_NUMBER_TYPES",
    "CHART_X_TYPES",
    "TableFeatures",
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
