"""FastAPI helpers shared by every module's api layer."""

import uuid
from typing import Any

from fastapi import Request

from tableui.platform.config import Settings
from tableui.platform.db import Database
from tableui.platform.mail import Mailer


def get_settings_dep(request: Request) -> Settings:
    return request.app.state.settings  # type: ignore[no-any-return]


def get_db(request: Request) -> Database:
    return request.app.state.db  # type: ignore[no-any-return]


def get_analytics(request: Request) -> Database:
    return request.app.state.analytics  # type: ignore[no-any-return]


def get_mailer(request: Request) -> Mailer:
    return request.app.state.mailer  # type: ignore[no-any-return]


def get_request_id(request: Request) -> str | None:
    return getattr(request.state, "request_id", None)


def bearer(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    return header[7:] if header.lower().startswith("bearer ") else None


def new_request_id() -> str:
    return uuid.uuid4().hex


def state_get(request: Request, name: str) -> Any:
    return getattr(request.app.state, name)
