"""Typed metadata: what a pack (and later an agency) can define. No industry terms live here."""

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
        return self

    def field(self, key: str) -> FieldDef | None:
        return next((f for f in self.fields if f.key == key), None)


class ContextLoader(_Strict):
    kind: Literal["normalised_match", "fuzzy_match", "lookup"]
    ref_field: str | None = None  # lookup: the reference field on this table
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
        return self


class RuleCheck(_Strict):
    id: str
    severity: Literal["block", "warn"]
    when: str
    message: str
    link: str | None = None


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
    expect: Literal["allowed", "blocked", "warned", "invalid"]
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
