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
    events_queue_url: str | None = None  # set in AWS; empty uses the in-process bus
    aws_region: str = "ap-south-1"
    aws_endpoint_url: str | None = None
    mail_backend: str = "smtp"  # smtp | log
    smtp_host: str = "localhost"
    smtp_port: int = 1025
    mail_sender: str = "no-reply@tableui.local"
    web_base_url: str = "http://localhost:5173"
    signing_key: str = "dev-signing-key-change-me"  # signs unsubscribe links
    automation_tick_seconds: float = 60.0  # how often retries and the date check wake up
    automation_check_minutes: int = 60  # how often date triggers are checked
    automation_daily_cap: int = 2000  # runs per workspace per day
    digest_hour_utc: int = 3  # the daily summary email goes out from this hour
    packs_dir: Path = Path(__file__).resolve().parents[5] / "packs"
    files_dir: Path = Path(__file__).resolve().parents[3] / "var" / "files"  # local file store
    clamd_host: str | None = None  # set to use ClamAV; empty uses the signature scanner
    clamd_port: int = 3310
    cv_parser: str = "rules"  # rules (built in) | rchilli
    rchilli_api_key: str | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()
