"""M0-S07: the recruitment pack loads from metadata only; invalid metadata names file and field."""

import shutil
from pathlib import Path

import pytest

from tableui.metadata.public import PackInvalid, load_pack
from tableui.platform.config import get_settings


def test_pack_loads_candidate_table_rule_and_measure() -> None:
    pack = load_pack(get_settings().packs_dir / "recruitment")
    candidate = pack.table("candidate")
    assert candidate is not None
    assert {f.key for f in candidate.fields} >= {"full_name", "email", "phone", "status"}
    assert [r.id for r in pack.rules] == [
        "R-01",
        "R-02",
        "R-03",
        "R-04",
        "R-06",
        "R-07",
        "R-08",
        "R-09",
        "R-10",
        "R-11",
        "R-12",
        "R-14",
    ]
    assert [m.key for m in pack.measures][:2] == ["active_candidates", "open_jobs"]
    assert len(pack.measures) == 9


def test_core_code_contains_no_recruitment_terms() -> None:
    root = Path(__file__).resolve().parents[1] / "src" / "tableui"
    banned = ("candidate", "recruit", "requirement", "placement")
    offenders = []
    for path in root.rglob("*.py"):
        if "migrations" in path.parts or path.name == "config.py":  # config names the deployed pack
            continue
        text = path.read_text().lower()
        offenders += [f"{path.name}: {w}" for w in banned if w in text]
    assert offenders == [], offenders


def _copy(tmp_path: Path) -> Path:
    dst = tmp_path / "pack"
    shutil.copytree(get_settings().packs_dir / "recruitment", dst)
    return dst


def test_invalid_field_type_names_file_and_field(tmp_path: Path) -> None:
    dst = _copy(tmp_path)
    f = dst / "tables" / "candidate.yaml"
    f.write_text(f.read_text().replace("type: email", "type: emial", 1))
    with pytest.raises(PackInvalid) as exc:
        load_pack(dst)
    issue = exc.value.issues[0]
    assert issue.file == "tables/candidate.yaml"
    assert issue.field.startswith("fields.1.type")


def test_rule_with_bad_cel_or_unknown_field_is_reported(tmp_path: Path) -> None:
    dst = _copy(tmp_path)
    f = dst / "rules" / "R-01-no-duplicate-candidates.yaml"
    f.write_text(
        f.read_text()
        .replace("ctx.email_match != null", "ctx.email_match !=", 1)
        .replace("field: phone", "field: nope", 1)
    )
    with pytest.raises(PackInvalid) as exc:
        load_pack(dst)
    fields = {(i.file, i.field) for i in exc.value.issues}
    assert ("rules/R-01-no-duplicate-candidates.yaml", "checks.0.when") in fields
    assert ("rules/R-01-no-duplicate-candidates.yaml", "context.phone_match.field") in fields


def test_missing_file_is_reported(tmp_path: Path) -> None:
    dst = _copy(tmp_path)
    (dst / "tables" / "candidate.yaml").unlink()
    with pytest.raises(PackInvalid) as exc:
        load_pack(dst)
    assert exc.value.issues[0].file == "tables/candidate.yaml"
