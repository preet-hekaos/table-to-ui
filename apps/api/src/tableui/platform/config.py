"""Runtime settings, read from environment variables (12-factor)."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "local"
    app_version: str = "0.1.0"
    database_url: str = "postgresql+asyncpg://app:app@localhost:5432/tableui"
    analytics_database_url: str = "postgresql+asyncpg://app:app@localhost:5432/tableui_analytics"
    session_idle_minutes: int = 30
    invitation_ttl_days: int = 7
    max_failed_logins: int = 5
    lockout_window_minutes: int = 10
    outbox_poll_seconds: float = 1.0
    run_outbox_relay: bool = True
    cors_origins: list[str] = ["http://localhost:5173"]
    smtp_host: str = "localhost"
    smtp_port: int = 1025
    mail_sender: str = "no-reply@tableui.local"
    web_base_url: str = "http://localhost:5173"
    pack_dir: Path = Path(__file__).resolve().parents[5] / "packs" / "recruitment"


@lru_cache
def get_settings() -> Settings:
    return Settings()
