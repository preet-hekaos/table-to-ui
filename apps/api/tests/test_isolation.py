"""M0-S06 tenant isolation. The most important suite in the repository: it is a CI gate."""

import re
import uuid

import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError

from tableui.platform.db import Database
from tableui.platform.errors import TenantContextMissing
from tests.conftest import Agency, candidate


async def _seed(a: Agency, tag: str) -> dict[str, str]:
    r = await a.create_candidate(
        candidate(full_name=f"{tag} Person", email=f"{tag.lower()}@x.test", phone=None)
    )
    return r.json()


async def test_every_route_as_each_tenant_never_returns_the_other_tenants_data(
    client: httpx.AsyncClient,
    agency: Agency,
    other_agency: Agency,
    app,
    db: Database,  # type: ignore[no-untyped-def]
) -> None:
    mine = await _seed(agency, "Northstar")
    theirs = await _seed(other_agency, "Crestline")
    await app.state.relay.run_once()

    # Every GET route that accepts tenant credentials, with ids of the *other* tenant filled in.
    cases = [
        ("GET", "/v1/records/candidate", None),
        ("GET", f"/v1/records/candidate/{theirs['id']}", None),
        ("GET", f"/v1/records/candidate/{theirs['id']}/history", None),
        ("GET", "/v1/measures", None),
        ("GET", "/v1/measures/active_candidates", None),
        ("GET", "/v1/activity", None),
        ("GET", "/v1/studio/tables", None),
        ("GET", "/v1/apps/current/releases", None),
        ("GET", "/v1/app/tables", None),
        ("GET", "/v1/app/tables/candidate", None),
        ("GET", "/v1/me", None),
    ]
    # Guard: the list above must cover every GET route that needs a tenant principal.
    covered = {re.sub(r"\{[^}]+\}", "{}", c[1]) for c in cases}
    covered = {re.sub(r"[0-9a-f-]{36}", "{}", p) for p in covered}
    for route in app.routes:
        path = getattr(route, "path", "")
        methods = getattr(route, "methods", set())
        if (
            "GET" in methods
            and path.startswith("/v1/")
            and not path.startswith("/v1/ops")
            and "invitations" not in path
        ):
            generic = re.sub(r"\{[^}]+\}", "{}", path)
            assert generic in covered, f"isolation suite does not cover {path}"

    for me, you, your_marker in (
        (agency, other_agency, "Crestline"),
        (other_agency, agency, "Northstar"),
    ):
        for method, path, body in cases:
            r = await client.request(
                method,
                path.replace(theirs["id"], mine["id"]) if me is other_agency else path,
                headers=me.h(),
                json=body,
            )
            blob = r.text
            assert your_marker not in blob, (
                f"{path} leaked {your_marker} to {me.name}: {blob[:200]}"
            )
            assert you.tenant_id not in blob and you.email not in blob, path

    # Reading the other tenant's record id yields not found, never the record.
    r = await client.get(f"/v1/records/candidate/{theirs['id']}", headers=agency.h())
    assert r.status_code == 404
    # And updating it is not found either.
    r = await client.patch(
        f"/v1/records/candidate/{theirs['id']}",
        headers=agency.h(),
        json={"version": 1, "data": {"location": "x"}},
    )
    assert r.status_code == 404
    # Events and cache-like stores: each tenant's outbox only mentions itself.
    for a, b in ((agency, other_agency), (other_agency, agency)):
        async with db.tenant(uuid.UUID(a.tenant_id)) as s:
            payloads = (await s.execute(text("SELECT payload::text FROM outbox"))).scalars().all()
        assert all(b.tenant_id not in p for p in payloads)


async def test_measures_are_per_tenant(
    client: httpx.AsyncClient, agency: Agency, other_agency: Agency, app
) -> None:  # type: ignore[no-untyped-def]
    await _seed(agency, "A1")
    await _seed(agency, "A2")
    await _seed(other_agency, "B1")
    await app.state.relay.run_once()
    a = (await client.get("/v1/measures/active_candidates", headers=agency.h())).json()["value"]
    b = (await client.get("/v1/measures/active_candidates", headers=other_agency.h())).json()[
        "value"
    ]
    assert (a, b) == (2, 1)


async def test_tenant_data_without_tenant_context_fails_closed(db: Database) -> None:
    with pytest.raises(TenantContextMissing):
        async with db.tenant(None):
            pass


async def test_row_level_security_blocks_cross_tenant_rows_even_with_a_qualified_name(
    agency: Agency, other_agency: Agency, db: Database
) -> None:
    await _seed(agency, "Secret")
    other_schema = f"t_{uuid.UUID(agency.tenant_id).hex}"
    # Tenant B's session reaches for tenant A's schema by name: RLS returns no rows...
    async with db.tenant(uuid.UUID(other_agency.tenant_id)) as s:
        n = (await s.execute(text(f'SELECT count(*) FROM "{other_schema}".candidate'))).scalar_one()  # noqa: S608
        assert n == 0
        # ...and cannot write rows for A's tenant id.
        with pytest.raises(ProgrammingError):
            await s.execute(
                text(
                    f"INSERT INTO \"{other_schema}\".candidate (id, tenant_id, data, created_by, updated_by) VALUES (gen_random_uuid(), :t, '{{}}', gen_random_uuid(), gen_random_uuid())"  # noqa: S608
                ),
                {"t": uuid.UUID(agency.tenant_id)},
            )


async def test_tenant_sessions_cannot_read_the_control_plane(agency: Agency, db: Database) -> None:
    with pytest.raises(ProgrammingError):
        async with db.tenant(uuid.UUID(agency.tenant_id)) as s:
            await s.execute(text("SELECT * FROM control.app_user"))


async def test_unauthenticated_requests_see_nothing(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    for path in ("/v1/records/candidate", "/v1/measures", "/v1/activity", "/v1/studio/tables"):
        assert (await client.get(path)).status_code == 401
