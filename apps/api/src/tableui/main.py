"""Composition root: wires modules, adapters and settings. The only place that knows them all."""

import asyncio
import contextlib
import logging
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

import tableui.catalog.public as catalog
import tableui.commands.public as commands
import tableui.identity.public as identity
import tableui.insights.public as insights
from tableui.audit.api.router import router as audit_router
from tableui.commands.api.router import router as commands_router
from tableui.identity.api.router import router as identity_router
from tableui.insights.api.router import router as insights_router
from tableui.metadata.api.router import router as studio_router
from tableui.ops.api.router import router as ops_router
from tableui.platform.config import Settings, get_settings
from tableui.platform.db import Database
from tableui.platform.errors import ProblemError, TenantContextMissing
from tableui.platform.mail import LogMailer, Mailer, SmtpMailer
from tableui.platform.messaging import LocalBus, Publisher
from tableui.platform.messaging_sqs import SqsConsumer, SqsPublisher, make_client
from tableui.platform.web import new_request_id
from tableui.query.api.router import router as query_router
from tableui.tenancy.public import Tenant, provision_tenant
from tableui.workspace.public import router as workspace_router

log = logging.getLogger("tableui")
PROBLEM = "application/problem+json"


def _problem(status: int, title: str, detail: str, request: Request, **extra: Any) -> JSONResponse:
    body = {
        "type": "about:blank",
        "title": title,
        "status": status,
        "detail": detail,
        "instance": request.url.path,
        "request_id": getattr(request.state, "request_id", None),
        **extra,
    }
    return JSONResponse(body, status_code=status, media_type=PROBLEM)


def create_app(
    settings: Settings | None = None,
    *,
    mailer: Mailer | None = None,
    publisher: Publisher | None = None,
    db: Database | None = None,
    analytics: Database | None = None,
) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.settings = settings
        app.state.db = db or Database(settings.database_url)
        app.state.analytics = analytics or Database(settings.analytics_database_url, pool_size=5)
        app.state.mailer = mailer or (
            LogMailer()
            if settings.mail_backend == "log"
            else SmtpMailer(settings.smtp_host, settings.smtp_port, settings.mail_sender)
        )
        app.state.org = identity.LocalOrganisationProvider()
        app.state.catalog = catalog.PackCatalog.load(
            settings.packs_dir
        )  # fail fast on a broken pack

        async def provisioner(
            session: AsyncSession, *, name: str, workos_org_id: str | None
        ) -> Tenant:
            return await provision_tenant(session, name=name, workos_org_id=workos_org_id)

        app.state.provisioner = provisioner
        await insights.ensure_schema(app.state.analytics)
        bus: Publisher = publisher or LocalBus()
        consumer_task: asyncio.Task[None] | None = None
        if publisher is None and settings.events_queue_url:
            sqs = make_client(settings.aws_region, settings.aws_endpoint_url)
            bus = SqsPublisher(sqs, settings.events_queue_url)

            async def project_sqs(event: dict[str, Any]) -> None:
                await insights.handle_event(app.state.analytics, event)

            consumer_task = asyncio.create_task(
                SqsConsumer(sqs, settings.events_queue_url, project_sqs).run_forever()
            )
        if isinstance(bus, LocalBus) and not bus._handlers:  # noqa: SLF001

            async def project(event: dict[str, Any]) -> None:
                await insights.handle_event(app.state.analytics, event)

            bus.subscribe(project)
        app.state.publisher = bus

        async def list_tenants() -> list[uuid.UUID]:
            async with app.state.db.control() as s:
                rows = await s.execute(
                    text("SELECT id FROM control.tenant WHERE status = 'active'")
                )
                return [r.id for r in rows]

        relay = commands.OutboxRelay(app.state.db, bus, list_tenants)
        app.state.relay = relay
        task: asyncio.Task[None] | None = None
        if settings.run_outbox_relay:

            async def loop() -> None:
                while True:
                    try:
                        await relay.run_once()
                    except Exception:
                        log.exception("outbox relay failed; will retry")
                    await asyncio.sleep(settings.outbox_poll_seconds)

            task = asyncio.create_task(loop())
        try:
            yield
        finally:
            for t in (task, consumer_task):
                if t:
                    t.cancel()
                    with contextlib.suppress(asyncio.CancelledError):
                        await t
            if db is None:
                await app.state.db.dispose()
            if analytics is None:
                await app.state.analytics.dispose()

    app = FastAPI(title="Table to UI API", version=settings.app_version, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID", "Idempotent-Replayed"],
    )

    @app.middleware("http")
    async def request_id_mw(request: Request, call_next):  # type: ignore[no-untyped-def]
        request.state.request_id = request.headers.get("x-request-id") or new_request_id()
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        return response

    @app.exception_handler(ProblemError)
    async def problem_handler(request: Request, exc: ProblemError) -> JSONResponse:
        body = exc.to_body(getattr(request.state, "request_id", None), request.url.path)
        return JSONResponse(body, status_code=exc.status, media_type=PROBLEM)

    @app.exception_handler(RequestValidationError)
    async def validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [
            {
                "field": ".".join(str(p) for p in e["loc"][1:]),
                "code": e["type"],
                "message": e["msg"],
            }
            for e in exc.errors()
        ]
        return _problem(
            422, "Validation failed", "The request is not valid.", request, errors=errors
        )

    @app.exception_handler(TenantContextMissing)
    async def tenant_handler(request: Request, exc: TenantContextMissing) -> JSONResponse:
        return _problem(403, "Tenant context missing", "No workspace is selected.", request)

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception) -> JSONResponse:
        log.exception(
            "unhandled error", extra={"request_id": getattr(request.state, "request_id", None)}
        )
        return _problem(
            500,
            "Something went wrong",
            "Please retry. Quote the request id if it continues.",
            request,
        )

    @app.get("/healthz", tags=["health"])
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/readyz", tags=["health"])
    async def readyz(request: Request) -> dict[str, str]:
        async with request.app.state.db.control() as s:
            await s.execute(text("SELECT 1"))
        return {"status": "ready"}

    for r in (
        identity_router,
        studio_router,
        commands_router,
        query_router,
        insights_router,
        audit_router,
        ops_router,
        workspace_router,
    ):
        app.include_router(r)
    return app
