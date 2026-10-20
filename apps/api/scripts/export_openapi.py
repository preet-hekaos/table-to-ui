"""Write the OpenAPI document to apps/api/openapi.json (CI diffs it to catch breaking changes)."""

import json
import sys
from pathlib import Path

from tableui.main import create_app
from tableui.platform.config import Settings

spec = create_app(Settings(run_outbox_relay=False)).openapi()
out = Path(__file__).resolve().parents[1] / "openapi.json"
text = json.dumps(spec, indent=2, sort_keys=True) + "\n"
if "--check" in sys.argv:
    if out.read_text() != text:
        sys.exit("openapi.json is out of date: run `uv run python scripts/export_openapi.py`")
else:
    out.write_text(text)
