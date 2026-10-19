"""M0-S02: a module importing another module's internals fails the boundary check, naming both."""

import shutil
import subprocess
import sys
from pathlib import Path

API = Path(__file__).resolve().parents[1]


def _run(src: Path) -> subprocess.CompletedProcess[str]:
    env = {"PYTHONPATH": str(src), "PATH": "/usr/bin:/bin"}
    return subprocess.run(  # noqa: S603
        [
            sys.executable,
            "-c",
            "from importlinter.cli import lint_imports_command as m; m()",
            "--config",
            str(API / "pyproject.toml"),
        ],
        cwd=API,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def test_repository_respects_module_boundaries() -> None:
    r = _run(API / "src")
    assert r.returncode == 0, r.stdout[-2000:]


def test_violation_fails_and_names_both_modules(tmp_path: Path) -> None:
    src = tmp_path / "src"
    shutil.copytree(API / "src", src)
    bad = src / "tableui" / "query" / "application" / "sneaky.py"
    bad.write_text("from tableui.rules.domain.engine import evaluate\n")
    r = _run(src)
    out = r.stdout + r.stderr
    assert r.returncode != 0
    assert "tableui.query" in out and "tableui.rules.domain" in out
