"""The catalog of industry packs available to install. Scans a folder of packs at startup."""

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from tableui.metadata.public import Pack, PackInvalid, load_pack
from tableui.platform.errors import NotFound


@dataclass(frozen=True)
class PackCatalog:
    packs: dict[str, Pack]

    @classmethod
    def load(cls, packs_dir: Path) -> "PackCatalog":
        """Load every ``<dir>/<pack>/pack.yaml``. A broken pack stops startup with every issue named."""
        found: dict[str, Pack] = {}
        problems: list[str] = []
        for manifest in sorted(packs_dir.glob("*/pack.yaml")):
            try:
                pack = load_pack(manifest.parent)
            except PackInvalid as exc:
                problems.append(f"{manifest.parent.name}: {exc}")
                continue
            found[pack.id] = pack
        if problems:
            raise RuntimeError("\n".join(problems))
        return cls(found)

    def get(self, pack_id: str) -> Pack:
        pack = self.packs.get(pack_id)
        if pack is None:
            raise NotFound(f"There is no pack '{pack_id}'.")
        return pack

    def summaries(self) -> list[dict[str, Any]]:
        return [
            {
                "id": p.id,
                "version": p.version,
                "title": p.title,
                "description": p.description,
                "tables": [t.plural_label for t in p.tables],
                "roles": [r.name for r in p.roles],
            }
            for p in self.packs.values()
        ]
