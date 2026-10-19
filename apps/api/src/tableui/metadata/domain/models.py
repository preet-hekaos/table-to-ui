"""Typed metadata: what a pack (and later an agency) can define. No industry terms live here."""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

FieldType = Literal[
    "text", "long_text", "email", "phone", "integer", "decimal", "boolean", "date", "select", "url"
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

    @model_validator(mode="after")
    def _check(self) -> "FieldDef":
        if self.type == "select" and not self.options:
            raise ValueError("a select field needs options")
        if self.unique and not self.normalize:
            raise ValueError("a unique field needs a normalizer")
        return self


class TableDef(_Strict):
    key: Key
    label: str
    plural_label: str
    title_field: Key
    groups: list[FieldGroup] = []
    fields: list[FieldDef]
    version: int = 1

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
    kind: Literal["normalised_match", "fuzzy_match"]
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


class PackManifest(_Strict):
    id: Key
    version: str
    title: str
    tables: list[str]
    rules: list[str] = []
    measures: list[str] = []


class Pack(_Strict):
    id: str
    version: str
    title: str
    tables: list[TableDef]
    rules: list[RuleDef]
    measures: list[MeasureDef]

    def table(self, key: str) -> TableDef | None:
        return next((t for t in self.tables if t.key == key), None)
