"""Test harness. Uses a real PostgreSQL 16 (TEST_DATABASE_URL, or a Testcontainers container)."""

import os
import tempfile
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pyotp
import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from tableui.main import create_app
from tableui.platform.config import Settings
from tableui.platform.db import Database
from tableui.platform.mail import InMemoryMailer
from tableui.platform.messaging import LocalBus
from tableui.platform.migrate import upgrade_control

PASSWORD = "correct-horse-battery"


def _base_url() -> str:
    url = os.environ.get("TEST_DATABASE_URL")
    if url:
        return url.rsplit("/", 1)[0]
    from testcontainers.postgres import PostgresContainer

    container = PostgresContainer("postgres:16", driver="asyncpg")
    container.start()
    pytest._pg_container = container  # type: ignore[attr-defined]  # keep alive
    return container.get_connection_url().rsplit("/", 1)[0]


@pytest.fixture(scope="session")
def base_url() -> str:
    return _base_url()


async def _reset(base: str, name: str) -> str:
    admin = create_async_engine(f"{base}/postgres", isolation_level="AUTOCOMMIT")
    async with admin.connect() as c:
        await c.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        await c.execute(text(f'CREATE DATABASE "{name}"'))
    await admin.dispose()
    return f"{base}/{name}"


@pytest_asyncio.fixture(scope="session")
async def urls(base_url: str) -> dict[str, str]:
    main = await _reset(base_url, "tableui_test")
    analytics = await _reset(base_url, "tableui_test_analytics")
    await upgrade_control(main)
    return {"main": main, "analytics": analytics}


@pytest_asyncio.fixture(scope="session")
async def db(urls: dict[str, str]) -> AsyncIterator[Database]:
    d = Database(urls["main"])
    yield d
    await d.dispose()


@pytest_asyncio.fixture(scope="session")
async def analytics(urls: dict[str, str]) -> AsyncIterator[Database]:
    d = Database(urls["analytics"], pool_size=3)
    yield d
    await d.dispose()


@pytest.fixture(scope="session")
def mailer() -> InMemoryMailer:
    return InMemoryMailer()


@pytest_asyncio.fixture(scope="session")
async def app(
    urls: dict[str, str], db: Database, analytics: Database, mailer: InMemoryMailer
) -> AsyncIterator[Any]:
    settings = Settings(
        database_url=urls["main"],
        analytics_database_url=urls["analytics"],
        run_outbox_relay=False,
        ai_provider="off",  # tests inject a fake; they never reach a real model
        web_base_url="http://web.test",
        files_dir=Path(tempfile.mkdtemp(prefix="tableui-files-")),
    )
    application = create_app(
        settings, mailer=mailer, publisher=LocalBus(), db=db, analytics=analytics
    )
    async with application.router.lifespan_context(application):
        yield application


@pytest_asyncio.fixture(scope="session")
async def client(app: Any) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


class Agency:
    """A signed-up agency with an admin who has MFA, ready to use the API."""

    def __init__(self, client: httpx.AsyncClient, name: str, email: str) -> None:
        self.client, self.name, self.email = client, name, email
        self.token = ""
        self.tenant_id = ""
        self.secret = ""

    def h(self, token: str | None = None, **extra: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {token or self.token}", **extra}

    async def choose_pack(self, pack_id: str = "recruitment") -> None:
        r = await self.client.post(
            "/v1/workspace/pack", headers=self.h(), json={"pack_id": pack_id}
        )
        assert r.status_code == 201, r.text

    async def sign_up(self, pack_id: str | None = None) -> "Agency":
        r = await self.client.post(
            "/v1/auth/signup",
            json={
                "agency_name": self.name,
                "full_name": "Owner " + self.name,
                "email": self.email,
                "password": PASSWORD,
            },
        )
        assert r.status_code == 201, r.text
        self.token, self.tenant_id = r.json()["token"], r.json()["tenant_id"]
        await self.enrol_mfa(self.token)
        if pack_id:
            await self.choose_pack(pack_id)
        return self

    async def enrol_mfa(self, token: str) -> str:
        r = await self.client.post("/v1/auth/mfa/enroll", headers=self.h(token))
        secret = r.json()["secret"]
        r = await self.client.post(
            "/v1/auth/mfa/confirm", headers=self.h(token), json={"code": pyotp.TOTP(secret).now()}
        )
        assert r.status_code == 204, r.text
        if token == self.token:
            self.secret = secret
        return secret

    async def publish_live(self) -> int:
        r = await self.client.post("/v1/apps/current/releases", headers=self.h())
        assert r.status_code == 201, r.text
        v = r.json()["version"]
        r = await self.client.post(f"/v1/apps/current/releases/{v}/promote", headers=self.h())
        assert r.status_code == 200, r.text
        return int(v)

    async def create_candidate(
        self, data: dict[str, Any], key: str | None = None, token: str | None = None
    ) -> httpx.Response:
        headers = self.h(token, **({"Idempotency-Key": key} if key else {}))
        return await self.client.post("/v1/records/candidate", headers=headers, json={"data": data})


@pytest_asyncio.fixture
async def agency(client: httpx.AsyncClient) -> Agency:
    a = Agency(client, "Northstar Talent Partners", f"ananya-{uuid.uuid4().hex[:8]}@northstar.test")
    await a.sign_up("recruitment")
    return a


@pytest_asyncio.fixture
async def other_agency(client: httpx.AsyncClient) -> Agency:
    a = Agency(client, "Crestline HR", f"rohan-{uuid.uuid4().hex[:8]}@crestline.test")
    await a.sign_up("recruitment")
    return a


def candidate(**over: Any) -> dict[str, Any]:
    base = {
        "full_name": "Arjun Menon",
        "email": f"arjun-{uuid.uuid4().hex[:8]}@gmail.com",
        "phone": "+91 98450 12345",
        "current_employer": "Infosys",
        "status": "Active",
    }
    return {**base, **over}
