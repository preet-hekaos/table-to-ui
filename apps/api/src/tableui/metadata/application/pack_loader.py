"""Load an industry pack from disk and validate it. Failures name the file and the field."""

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cel
import yaml
from pydantic import BaseModel, ValidationError

from tableui.metadata.domain.models import (
    MeasureDef,
    NavItem,
    Pack,
    PackManifest,
    RoleDef,
    RuleDef,
    ScreenDef,
    TableDef,
)


@dataclass(frozen=True)
class PackIssue:
    file: str
    field: str
    message: str

    def __str__(self) -> str:
        return f"{self.file}: {self.field or '(file)'}: {self.message}"


class PackInvalid(Exception):
    def __init__(self, issues: list[PackIssue]) -> None:
        self.issues = issues
        super().__init__("pack is invalid:\n" + "\n".join(f"  - {i}" for i in issues))


def _read_yaml(root: Path, rel: str, issues: list[PackIssue]) -> Any:
    path = root / rel
    if not path.is_file():
        issues.append(PackIssue(rel, "", "file not found"))
        return None
    try:
        return yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        issues.append(PackIssue(rel, "", f"not valid YAML: {exc}"))
        return None


def _parse[M: BaseModel](model: type[M], data: Any, rel: str, issues: list[PackIssue]) -> M | None:
    if data is None:
        return None
    try:
        return model.model_validate(data)
    except ValidationError as exc:
        for err in exc.errors():
            loc = ".".join(str(p) for p in err["loc"])
            issues.append(PackIssue(rel, loc, err["msg"]))
        return None


def load_pack(root: Path) -> Pack:
    """Read ``pack.yaml`` and every file it lists. Raises PackInvalid with all issues found."""
    issues: list[PackIssue] = []
    manifest = _parse(PackManifest, _read_yaml(root, "pack.yaml", issues), "pack.yaml", issues)
    if manifest is None:
        raise PackInvalid(issues)

    tables, rules, measures = [], [], []
    files: dict[int, str] = {}
    for rel in manifest.tables:
        t = _parse(TableDef, _read_yaml(root, rel, issues), rel, issues)
        if t:
            tables.append(t)
            files[id(t)] = rel
    for rel in manifest.rules:
        r = _parse(RuleDef, _read_yaml(root, rel, issues), rel, issues)
        if r:
            rules.append(r)
            files[id(r)] = rel
    for rel in manifest.measures:
        m = _parse(MeasureDef, _read_yaml(root, rel, issues), rel, issues)
        if m:
            measures.append(m)
            files[id(m)] = rel

    screens: list[ScreenDef] = []
    for rel in manifest.screens:
        sc = _parse(ScreenDef, _read_yaml(root, rel, issues), rel, issues)
        if sc:
            screens.append(sc)
            files[id(sc)] = rel
    navigation: list[NavItem] = []
    if manifest.navigation:
        raw = _read_yaml(root, manifest.navigation, issues)
        for i, item in enumerate(raw or []):
            n = _parse(NavItem, item, f"{manifest.navigation}[{i}]", issues)
            if n:
                navigation.append(n)
    roles: list[RoleDef] = []
    if manifest.roles:
        raw = _read_yaml(root, manifest.roles, issues)
        for i, item in enumerate(raw or []):
            rd = _parse(RoleDef, item, f"{manifest.roles}[{i}]", issues)
            if rd:
                roles.append(rd)

    _cross_check(tables, rules, measures, files, issues)
    _check_generality(tables, screens, navigation, roles, manifest, issues)
    if issues:
        raise PackInvalid(issues)
    return Pack(
        id=manifest.id,
        version=manifest.version,
        title=manifest.title,
        tables=tables,
        rules=rules,
        measures=measures,
        description=manifest.description,
        screens=screens,
        navigation=navigation,
        roles=roles,
    )


def _cross_check(
    tables: list[TableDef],
    rules: list[RuleDef],
    measures: list[MeasureDef],
    files: dict[int, str],
    issues: list[PackIssue],
) -> None:
    by_key = {t.key: t for t in tables}
    for r in rules:
        f = files[id(r)]
        table = by_key.get(r.table)
        if table is None:
            issues.append(PackIssue(f, "table", f"unknown table '{r.table}'"))
            continue
        for name, loader in r.context.items():
            if loader.kind == "lookup":
                ref = table.field(loader.ref_field or "")
                if ref is None or ref.type != "reference" or not ref.ref_table:
                    issues.append(
                        PackIssue(f, f"context.{name}.ref_field", "must name a reference field")
                    )
                else:
                    target = by_key.get(ref.ref_table)
                    if target is None or target.field(loader.field or "") is None:
                        issues.append(
                            PackIssue(
                                f, f"context.{name}.field", f"unknown field on '{ref.ref_table}'"
                            )
                        )
                continue
            for attr in ("field", "exact_field", "fuzzy_field"):
                key = getattr(loader, attr)
                if key and table.field(key) is None:
                    issues.append(PackIssue(f, f"context.{name}.{attr}", f"unknown field '{key}'"))
                elif key and table.field(key) and not table.field(key).normalize:  # type: ignore[union-attr]
                    issues.append(
                        PackIssue(f, f"context.{name}.{attr}", f"field '{key}' has no normalize")
                    )
        for i, check in enumerate(r.checks):
            try:
                cel.compile(check.when)
            except Exception as exc:
                issues.append(PackIssue(f, f"checks.{i}.when", f"invalid CEL: {exc}"))
            if check.link and check.link not in r.context:
                issues.append(
                    PackIssue(f, f"checks.{i}.link", f"'{check.link}' is not a context entry")
                )
    for m in measures:
        f = files[id(m)]
        table = by_key.get(m.table)
        if table is None:
            issues.append(PackIssue(f, "table", f"unknown table '{m.table}'"))
            continue
        for i, flt in enumerate(m.where):
            fld = table.field(flt.field)
            if fld is None:
                issues.append(PackIssue(f, f"where.{i}.field", f"unknown field '{flt.field}'"))
            elif not fld.analytics:
                issues.append(
                    PackIssue(f, f"where.{i}.field", f"field '{flt.field}' is not analytics: true")
                )


def _check_generality(
    tables: list[TableDef],
    screens: list[ScreenDef],
    navigation: list[NavItem],
    roles: list[RoleDef],
    manifest: PackManifest,
    issues: list[PackIssue],
) -> None:
    """Screens, navigation, roles and reference fields must point at things that exist."""
    by_key = {t.key: t for t in tables}
    for t in tables:
        for fld in t.fields:
            if fld.type == "reference" and fld.ref_table not in by_key:
                issues.append(
                    PackIssue(
                        "tables", f"{t.key}.{fld.key}.ref_table", f"unknown table '{fld.ref_table}'"
                    )
                )
    screen_keys = {s.key for s in screens}
    role_keys = {r.key for r in roles}
    for s in screens:
        if s.table and s.table not in by_key:
            issues.append(PackIssue(f"screen {s.key}", "table", f"unknown table '{s.table}'"))
        for r in s.roles:
            if role_keys and r not in role_keys:
                issues.append(PackIssue(f"screen {s.key}", "roles", f"unknown role '{r}'"))
    for n in navigation:
        if n.screen not in screen_keys:
            issues.append(
                PackIssue(
                    manifest.navigation or "navigation", n.key, f"unknown screen '{n.screen}'"
                )
            )
        for r in n.roles:
            if role_keys and r not in role_keys:
                issues.append(
                    PackIssue(manifest.navigation or "navigation", n.key, f"unknown role '{r}'")
                )
