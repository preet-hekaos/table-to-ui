"""M0-S03 sign-up, M0-S04 sign-in with MFA, M0-S05 invitations."""

import uuid

import httpx
import pyotp
from sqlalchemy import text

from tableui.platform.db import Database
from tableui.platform.mail import InMemoryMailer
from tests.conftest import PASSWORD, Agency


async def test_signup_creates_tenant_schema_owner_and_lands_in_workspace(
    client: httpx.AsyncClient, db: Database
) -> None:
    a = Agency(client, "Northstar Talent Partners", f"o-{uuid.uuid4().hex[:6]}@n.test")
    await a.sign_up()
    me = (await client.get("/v1/me", headers=a.h())).json()
    assert me["role"] == "admin" and me["tenant_name"] == "Northstar Talent Partners"
    async with db.control() as s:
        row = (
            await s.execute(
                text("SELECT schema_name, workos_org_id FROM control.tenant WHERE id = :i"),
                {"i": uuid.UUID(a.tenant_id)},
            )
        ).one()
        assert row.schema_name == f"t_{uuid.UUID(a.tenant_id).hex}"
        assert row.workos_org_id.startswith("local_org_")
        exists = (
            await s.execute(
                text("SELECT 1 FROM information_schema.schemata WHERE schema_name = :n"),
                {"n": row.schema_name},
            )
        ).first()
        assert exists


async def test_provisioning_failure_leaves_nothing_behind(
    client: httpx.AsyncClient, db: Database, app
) -> None:  # type: ignore[no-untyped-def]
    deleted: list[str] = []
    real_create, real_delete = app.state.org.create, app.state.org.delete

    async def fake_delete(org_id: str) -> None:
        deleted.append(org_id)

    original = app.state.provisioner

    async def failing(session, *, name, workos_org_id):  # type: ignore[no-untyped-def]
        await original(session, name=name, workos_org_id=workos_org_id)
        raise RuntimeError("boom after schema creation")

    app.state.org.delete, app.state.provisioner = fake_delete, failing
    try:
        async with db.control() as s:
            before = (
                await s.execute(
                    text(
                        "SELECT count(*) FROM information_schema.schemata WHERE schema_name LIKE 't\\_%'"
                    )
                )
            ).scalar_one()
        r = await client.post(
            "/v1/auth/signup",
            json={
                "agency_name": "Doomed",
                "full_name": "D",
                "email": "doomed@x.test",
                "password": PASSWORD,
            },
        )
        assert r.status_code == 500 and r.json()["request_id"]
        async with db.control() as s:
            after = (
                await s.execute(
                    text(
                        "SELECT count(*) FROM information_schema.schemata WHERE schema_name LIKE 't\\_%'"
                    )
                )
            ).scalar_one()
            tenants = (
                await s.execute(text("SELECT count(*) FROM control.tenant WHERE name = 'Doomed'"))
            ).scalar_one()
            users = (
                await s.execute(
                    text("SELECT count(*) FROM control.app_user WHERE email = 'doomed@x.test'")
                )
            ).scalar_one()
        assert (before, tenants, users) == (after, 0, 0)
        assert len(deleted) == 1  # the vendor organisation was compensated
    finally:
        app.state.org.create, app.state.org.delete, app.state.provisioner = (
            real_create,
            real_delete,
            original,
        )


async def test_same_agency_name_is_allowed(client: httpx.AsyncClient) -> None:
    for _ in range(2):
        a = Agency(client, "Same Name Ltd", f"o-{uuid.uuid4().hex[:6]}@n.test")
        await a.sign_up()


async def test_sign_in_needs_second_factor(client: httpx.AsyncClient, agency: Agency) -> None:
    r = await client.post("/v1/auth/sign-in", json={"email": agency.email, "password": PASSWORD})
    assert r.status_code == 200 and r.json()["mfa_required"] is True
    pending = r.json()["token"]
    blocked = await client.get("/v1/studio/tables", headers=agency.h(pending))
    assert blocked.status_code == 401
    bad = await client.post(
        "/v1/auth/mfa/verify", headers=agency.h(pending), json={"code": "000000"}
    )
    assert bad.status_code == 401
    ok = await client.post(
        "/v1/auth/mfa/verify",
        headers=agency.h(pending),
        json={"code": pyotp.TOTP(agency.secret).now()},
    )
    assert ok.status_code == 204
    assert (await client.get("/v1/studio/tables", headers=agency.h(pending))).status_code == 200


async def test_five_failed_attempts_pause_sign_in_and_are_logged(
    client: httpx.AsyncClient, agency: Agency, db: Database
) -> None:
    for _ in range(5):
        r = await client.post(
            "/v1/auth/sign-in", json={"email": agency.email, "password": "wrong-password-xx"}
        )
        assert r.status_code == 401
    r = await client.post("/v1/auth/sign-in", json={"email": agency.email, "password": PASSWORD})
    assert r.status_code == 429
    async with db.control() as s:
        n = (
            await s.execute(
                text(
                    "SELECT count(*) FROM control.audit_event WHERE action = 'auth.locked' AND subject_id = :e"
                ),
                {"e": agency.email},
            )
        ).scalar_one()
    assert n >= 1


async def test_idle_session_must_sign_in_again(
    client: httpx.AsyncClient, agency: Agency, db: Database
) -> None:
    assert (await client.get("/v1/studio/tables", headers=agency.h())).status_code == 200
    async with db.control() as s:
        await s.execute(
            text(
                "UPDATE control.session SET last_seen_at = now() - interval '31 minutes' WHERE user_id = (SELECT id FROM control.app_user WHERE email = :e)"
            ),
            {"e": agency.email},
        )
    r = await client.get("/v1/studio/tables", headers=agency.h())
    assert r.status_code == 401 and "inactivity" in r.json()["detail"]


async def _invite(
    client: httpx.AsyncClient, agency: Agency, mailer: InMemoryMailer, email: str
) -> str:
    r = await client.post(
        "/v1/invitations", headers=agency.h(), json={"email": email, "role": "recruiter"}
    )
    assert r.status_code == 201, r.text
    body = mailer.sent[-1]["body"]
    assert mailer.sent[-1]["to"] == email
    return body.split("token=")[1].split()[0]


async def test_invitation_accept_joins_tenant_with_invited_role(
    client: httpx.AsyncClient, agency: Agency, mailer: InMemoryMailer
) -> None:
    email = f"priya-{uuid.uuid4().hex[:6]}@northstar.test"
    token = await _invite(client, agency, mailer, email)
    info = (await client.get(f"/v1/invitations/{token}")).json()
    assert info["state"] == "valid" and info["tenant_name"] == agency.name
    r = await client.post(
        f"/v1/invitations/{token}/accept", json={"full_name": "Priya Nair", "password": PASSWORD}
    )
    assert r.status_code == 201
    priya = Agency(client, agency.name, email)
    priya.token, priya.tenant_id = r.json()["token"], r.json()["tenant_id"]
    await priya.enrol_mfa(priya.token)
    me = (await client.get("/v1/me", headers=priya.h())).json()
    assert me["role"] == "recruiter" and me["tenant_id"] == agency.tenant_id


async def test_reused_or_expired_invitation_is_refused(
    client: httpx.AsyncClient, agency: Agency, mailer: InMemoryMailer, db: Database
) -> None:
    token = await _invite(client, agency, mailer, f"a-{uuid.uuid4().hex[:6]}@n.test")
    await client.post(
        f"/v1/invitations/{token}/accept", json={"full_name": "A B", "password": PASSWORD}
    )
    assert (await client.get(f"/v1/invitations/{token}")).json()["state"] == "used"
    again = await client.post(
        f"/v1/invitations/{token}/accept", json={"full_name": "A B", "password": PASSWORD}
    )
    assert again.status_code == 404
    token2 = await _invite(client, agency, mailer, f"b-{uuid.uuid4().hex[:6]}@n.test")
    async with db.control() as s:
        await s.execute(
            text(
                "UPDATE control.invitation SET expires_at = now() - interval '1 day' WHERE accepted_at IS NULL"
            )
        )
    assert (await client.get(f"/v1/invitations/{token2}")).json()["state"] == "expired"
    assert (
        await client.post(
            f"/v1/invitations/{token2}/accept", json={"full_name": "B C", "password": PASSWORD}
        )
    ).status_code == 404


async def test_only_admins_can_invite(
    client: httpx.AsyncClient, agency: Agency, mailer: InMemoryMailer
) -> None:
    email = f"p-{uuid.uuid4().hex[:6]}@northstar.test"
    token = await _invite(client, agency, mailer, email)
    r = await client.post(
        f"/v1/invitations/{token}/accept", json={"full_name": "P Q", "password": PASSWORD}
    )
    recruiter = r.json()["token"]
    denied = await client.post(
        "/v1/invitations",
        headers=agency.h(recruiter),
        json={"email": "x@y.test", "role": "recruiter"},
    )
    assert denied.status_code in (401, 403)
