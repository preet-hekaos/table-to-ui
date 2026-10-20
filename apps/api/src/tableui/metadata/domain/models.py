"""Typed metadata: what a pack (and later an agency) can define. No industry terms live here."""

import re
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

FieldType = Literal[
    "text",
    "long_text",
    "email",
    "phone",
    "integer",
    "decimal",
    "boolean",
    "date",
    "select",
    "url",
    "money",  # an amount in the workspace currency
    "months",  # a duration stored as whole months, shown as "5 yrs 3 mo"
    "tags",  # a list of short labels (for example skills)
    "reference",  # a link to a record of another table
]
Normalizer = Literal["text", "email", "phone"]
Key = Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]{0,62}$")]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class FieldGroup(_Strict):
    key: Key
    label: str


class FieldDef(_Strict):
    key: Key
    label: str
    type: FieldType
    required: bool = False
    group: str | None = None
    normalize: Normalizer | None = None
    unique: bool = False
    default: Any = None
    options: list[str] = []
    min: float | None = None
    max: float | None = None
    max_length: int | None = None
    analytics: bool = False
    source: Literal["pack", "agency"] = "pack"
    ref_table: str | None = None
    hidden: bool = False  # kept in the data but not shown on screens
    searchable: bool = False  # included in keyword search
    filterable: bool = False  # offered as a facet or filter
    help: str | None = None
    aliases: list[str] = []  # other column names an import should match to this field

    @model_validator(mode="after")
    def _check(self) -> "FieldDef":
        if self.type == "select" and not self.options:
            raise ValueError("a select field needs options")
        if self.unique and not self.normalize:
            raise ValueError("a unique field needs a normalizer")
        if self.type == "reference" and not self.ref_table:
            raise ValueError("a reference field needs 'ref_table'")
        return self


class SearchInclude(_Strict):
    """Keyword search on this table also looks in the searchable text of records that point at it
    (for example the text of a document filed under the record)."""

    table: Key
    via: Key  # the reference field on that table that points here


class CountDef(_Strict):
    """A count shown beside each record, for example how many open orders a customer has."""

    key: Key
    label: str
    table: Key
    via: Key
    where: dict[str, str | int | bool] = {}


class StageDef(_Strict):
    key: str  # the stored value (it is also an option of the stage field)
    label: str | None = None  # what screens show; builders may rename it
    end: bool = False  # an end state: nothing moves on from here


class WorkflowDef(_Strict):
    """Stages a record moves through, and which moves are allowed. No industry terms live here."""

    field: Key
    stages: list[StageDef]
    transitions: dict[str, list[str]] = {}

    @model_validator(mode="after")
    def _check(self) -> "WorkflowDef":
        keys = [st.key for st in self.stages]
        if len(keys) != len(set(keys)) or not keys:
            raise ValueError("a workflow needs distinct stages")
        for src, targets in self.transitions.items():
            if src not in keys or any(t not in keys for t in targets):
                raise ValueError(f"transition '{src}' uses an unknown stage")
        return self

    def stage(self, key: str | None) -> StageDef | None:
        return next((st for st in self.stages if st.key == key), None)

    @property
    def first(self) -> str:
        return self.stages[0].key


class RollupDef(_Strict):
    """Keep a count on the record this one points at: ``field`` = rows here that point at it and match ``where``."""

    field: Key
    where: dict[str, str | int | bool] = {}


class FullDef(_Strict):
    """When ``field`` reaches ``at_least`` (a field of the same record), set ``set`` on that record."""

    field: Key
    at_least: Key
    set: dict[str, str | int | bool]


class EffectDef(_Strict):
    """A follow-on change to the record a reference points at, made in the same transaction."""

    id: str
    actions: list[Literal["create", "update"]]
    ref: Key  # reference field on this table; the effect changes the record it points at
    when_changed: dict[str, str | int | bool] = {}  # this record's field has just become this value
    when_is: dict[str, str | int | bool] = {}  # this record's field has this value
    set: dict[str, str | int | bool] = {}
    rollup: RollupDef | None = None
    then: FullDef | None = None


class TableDef(_Strict):
    key: Key
    label: str
    plural_label: str
    title_field: Key
    groups: list[FieldGroup] = []
    fields: list[FieldDef]
    version: int = 1
    description: str = ""
    source: Literal["pack", "agency"] = "pack"
    search_includes: list[SearchInclude] = []
    counts: list[CountDef] = []
    workflow: WorkflowDef | None = None
    effects: list[EffectDef] = []

    @model_validator(mode="after")
    def _check(self) -> "TableDef":
        keys = [f.key for f in self.fields]
        if len(keys) != len(set(keys)):
            raise ValueError("duplicate field keys")
        if self.title_field not in keys:
            raise ValueError(f"title_field '{self.title_field}' is not a field")
        groups = {g.key for g in self.groups}
        for f in self.fields:
            if f.group and f.group not in groups:
                raise ValueError(f"field '{f.key}' uses unknown group '{f.group}'")
        for e in self.effects:
            ref = self.field(e.ref)
            if ref is None or ref.type != "reference":
                raise ValueError(f"effect '{e.id}': '{e.ref}' is not a reference field")
        if self.workflow is not None:
            wf_field = self.field(self.workflow.field)
            if wf_field is None or wf_field.type != "select":
                raise ValueError("the workflow field must be a select field of this table")
            missing = [st.key for st in self.workflow.stages if st.key not in wf_field.options]
            if missing:
                raise ValueError(f"stages {missing} are not options of '{wf_field.key}'")
        return self

    def field(self, key: str) -> FieldDef | None:
        return next((f for f in self.fields if f.key == key), None)


class ContextLoader(_Strict):
    kind: Literal["normalised_match", "fuzzy_match", "lookup", "count"]
    ref_field: str | None = None  # lookup: the reference field on this table (a.b follows links)
    table: str | None = None  # count: the table whose records are counted
    match: dict[
        str, str
    ] = {}  # count: field on that table -> field of this record ('$id' = its id)
    where: dict[str, str | int | bool] = {}  # count: fixed values the counted records must have
    field: str | None = None
    exact_field: str | None = None
    fuzzy_field: str | None = None
    threshold: int = 90

    @model_validator(mode="after")
    def _check(self) -> "ContextLoader":
        if self.kind == "normalised_match" and not self.field:
            raise ValueError("normalised_match needs 'field'")
        if self.kind == "fuzzy_match" and not (self.exact_field and self.fuzzy_field):
            raise ValueError("fuzzy_match needs 'exact_field' and 'fuzzy_field'")
        if self.kind == "lookup" and not (self.ref_field and self.field):
            raise ValueError("lookup needs 'ref_field' and 'field'")
        if self.kind == "count":
            if not (self.table and self.match):
                raise ValueError("count needs 'table' and 'match'")
            keys = [self.table, *self.match, *self.where]
            if any(not re.fullmatch(r"[a-z][a-z0-9_]{0,62}", k) for k in keys):
                raise ValueError("count uses a table or field key that is not valid")
        return self


class RuleCheck(_Strict):
    id: str
    # block: refuse. warn: allow and tell. approval: hold until an approver allows it.
    severity: Literal["block", "warn", "approval"]
    when: str
    message: str
    link: str | None = None
    overridable: bool = (
        False  # a block that a user with the override permission may pass, with a reason
    )


class RuleDef(_Strict):
    id: str
    title: str
    table: Key
    applies_to: list[Literal["create", "update"]]
    context: dict[Key, ContextLoader] = {}
    checks: list[RuleCheck]
    version: int = 1


class MeasureFilter(_Strict):
    field: Key
    op: Literal["eq", "neq"]
    value: str | int | bool


class MeasureDef(_Strict):
    key: Key
    label: str
    table: Key
    aggregate: Literal["count"]
    where: list[MeasureFilter] = []


Pattern = Literal[
    "searchable_table",
    "profile",
    "master_detail",
    "form",
    "ranked_list",
    "document_review",
    "detail",
]
Scope = Literal["all", "own_team", "own"]


class ScreenDef(_Strict):
    """A screen is a pattern applied to a table, plus configuration. Builders edit these; nothing is code."""

    key: Key
    title: str
    pattern: Pattern
    table: Key
    config: dict[str, Any] = {}
    roles: list[str] = []  # empty means every role
    version: int = 1


class NavItem(_Strict):
    key: Key
    label: str
    screen: Key
    icon: str = "list"
    section: str = "main"
    order: int = 100
    roles: list[str] = []
    version: int = 1


class RoleDef(_Strict):
    """A role a pack starts a workspace with. Grants may use * for a table or an action."""

    key: Key
    name: str
    description: str = ""
    grants: list[str] = []
    scopes: dict[str, Scope] = {}  # table key (or "default") -> visibility
    field_deny: list[str] = []  # "table.field" the role never sees


class FixtureRecord(_Strict):
    """A record that already exists when a fixture runs."""

    table: Key
    id: str
    data: dict[str, Any]


class FixtureDef(_Strict):
    """An example change and the outcome the pack promises for it: the pack's own test."""

    id: str
    title: str
    table: Key
    op: Literal["create", "update"] = "create"
    given: list[FixtureRecord] = []
    record: dict[str, Any]
    record_id: str | None = None  # for an update: which given record is being changed
    expect: Literal["allowed", "blocked", "warned", "approval", "invalid"]
    checks: list[str] = []  # rule checks that must fire (for blocked or warned)


class PackManifest(_Strict):
    id: Key
    version: str
    title: str
    description: str = ""
    tables: list[str]
    rules: list[str] = []
    measures: list[str] = []
    screens: list[str] = []
    navigation: str | None = None
    roles: str | None = None
    fixtures: str | None = None  # a YAML file holding a list of fixtures
    compatible_with: str = ">=1.0"


class Pack(_Strict):
    id: str
    version: str
    title: str
    description: str = ""
    tables: list[TableDef]
    rules: list[RuleDef]
    measures: list[MeasureDef]
    screens: list[ScreenDef] = []
    navigation: list[NavItem] = []
    roles: list[RoleDef] = []
    fixtures: list[FixtureDef] = []
    compatible_with: str = ">=1.0"

    def table(self, key: str) -> TableDef | None:
        return next((t for t in self.tables if t.key == key), None)
