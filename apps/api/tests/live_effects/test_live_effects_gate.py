"""The no-cosmetic gate: a setting without proof of its live effect breaks the build."""

import ast
from pathlib import Path

import pytest

from tableui.metadata.domain.models import FieldDef, TableFeatures

from .register import FIELD, TABLE

TESTS = Path(__file__).resolve().parent.parent
E2E = TESTS.parents[1] / "web" / "e2e"
LEVELS = {"live", "server", "gap"}
STAGES = {"S1", "S2", "S3", "S4", "S5", "S6"}
# The number of gaps may only go down. Lower this when a gap is closed; S6 sets it to 0.
GAP_BUDGET = 21


def _functions(path: Path) -> set[str]:
    tree = ast.parse(path.read_text())
    return {n.name for n in ast.walk(tree) if isinstance(n, ast.FunctionDef | ast.AsyncFunctionDef)}


def _all() -> list[tuple[str, object]]:
    return [(f"field.{k}", v) for k, v in FIELD.items()] + [
        (f"table.{k}", v) for k, v in TABLE.items()
    ]


def test_every_field_property_and_table_flag_is_in_the_register() -> None:
    assert set(FIELD) == set(FieldDef.model_fields), (
        "a field property was added or removed: update register.py"
    )
    assert set(TABLE) == set(TableFeatures.model_fields), (
        "a table feature was added or removed: update register.py"
    )


@pytest.mark.parametrize(("name", "setting"), _all())
def test_each_entry_is_complete_and_its_proof_exists(name: str, setting) -> None:
    assert setting.level in LEVELS, name
    if setting.level == "gap":
        assert setting.stage in STAGES, f"{name}: a gap names the stage that closes it"
        assert not setting.proofs, name
        return
    assert setting.proofs, f"{name}: level {setting.level} needs at least one proof"
    for proof in setting.proofs:
        kind, _, rest = proof.partition(":")
        file, _, func = rest.partition("::")
        if kind == "api":
            path = TESTS / file
            assert path.exists(), f"{name}: {file} does not exist"
            assert func in _functions(path), f"{name}: {func} is not in {file}"
        elif kind == "e2e":
            path = E2E / file
            assert path.exists(), f"{name}: {file} does not exist"
            assert func in path.read_text(), f"{name}: scenario '{func}' is not in {file}"
        else:
            pytest.fail(f"{name}: unknown proof kind {kind}")
    if setting.level == "live":
        assert any(p.startswith("e2e:") for p in setting.proofs), (
            f"{name}: live needs a screen-level scenario"
        )


def test_the_number_of_gaps_only_goes_down() -> None:
    gaps = [n for n, s in _all() if s.level == "gap"]
    assert len(gaps) <= GAP_BUDGET, f"{len(gaps)} gaps, budget {GAP_BUDGET}: {gaps}"
    assert len(gaps) == GAP_BUDGET, (
        f"{len(gaps)} gaps, budget {GAP_BUDGET}: lower GAP_BUDGET to lock in the progress"
    )
