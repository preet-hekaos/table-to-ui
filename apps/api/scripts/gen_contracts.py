"""Regenerate the import-linter contracts in pyproject.toml from the module list (run after adding a module)."""

from pathlib import Path

MODULES = [
    "audit",
    "metadata",
    "tenancy",
    "identity",
    "rules",
    "commands",
    "query",
    "insights",
    "ops",
    "workspace",
    "catalog",
    "imports",
    "files",
    "search",
    "matching",
    "workflow",
    "approvals",
    "duplicates",
]


def q(items: list[str]) -> str:
    return "[" + ", ".join(f'"{x}"' for x in items) + "]"


def main() -> None:
    p = Path(__file__).resolve().parents[1] / "pyproject.toml"
    s = p.read_text()
    out = s[: s.index("[[tool.importlinter.contracts]]")]
    out += (
        '[[tool.importlinter.contracts]]\nname = "Shared kernel (platform) imports no module"\ntype = "forbidden"\n'
        f'allow_indirect_imports = true\nsource_modules = ["tableui.platform"]\nforbidden_modules = {q(["tableui." + m for m in MODULES])}\n\n'
    )
    for m in MODULES:
        others = [f"tableui.{o}" for o in MODULES if o != m]
        hidden = [f"tableui.{m}.{x}" for x in ("application", "domain", "adapters")] + [
            f"tableui.{m}.api.router"
        ]
        out += (
            f"[[tool.importlinter.contracts]]\nname = \"Module '{m}': only its public interface is importable from other modules\"\n"
            f'type = "forbidden"\nallow_indirect_imports = true\nsource_modules = {q(others)}\nforbidden_modules = {q(hidden)}\n\n'
        )
        layers = [f"tableui.{m}.{x}" for x in ("api", "adapters", "application", "domain")]
        out += (
            f"[[tool.importlinter.contracts]]\nname = \"Module '{m}' layers: api > adapters > application > domain\"\n"
            f'type = "layers"\nlayers = {q(layers)}\n\n'
        )
    p.write_text(out.rstrip() + "\n")


if __name__ == "__main__":
    main()
