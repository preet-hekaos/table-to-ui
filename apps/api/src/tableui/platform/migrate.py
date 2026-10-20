"""Run control-plane migrations (Alembic) programmatically."""

import asyncio
from pathlib import Path

from alembic import command
from alembic.config import Config


def _config(url: str) -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", str(Path(__file__).parent / "migrations"))
    cfg.set_main_option("sqlalchemy.url", url)
    return cfg


def upgrade_control_sync(url: str, revision: str = "head") -> None:
    command.upgrade(_config(url), revision)


async def upgrade_control(url: str, revision: str = "head") -> None:
    # Alembic's env.py starts its own event loop, so run it off the caller's loop.
    await asyncio.to_thread(upgrade_control_sync, url, revision)
