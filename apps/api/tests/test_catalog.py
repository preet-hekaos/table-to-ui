"""M1-S27: pack versions are published only when their fixtures pass; workspaces update when owners accept."""

from typing import Any

import httpx
import pyotp

from tableui.metadata.public import FieldDef, FixtureDef
from tests.conftest import PASSWORD, Agency


async def _operator(client: httpx.AsyncClient, db: Any) -> dict[str, str]:
    import uuid

    from tableui.ops.application.operators import create_operator

    email = f"op-{uuid.uuid4().hex[:6]}@platform.test"
    async with db.control() as s:
        secret = (await create_operator(s, email=email, full_name="Op", password=PASSWORD))[
            "secret"
        ]
    r = await client.post("/v1/ops/auth/sign-in", json={"email": email, "password": PASSWORD})
    token = r.json()["token"]
    r = await client.post(
        "/v1/ops/auth/mfa/verify",
        headers={"Authorization": f"Bearer {token}"},
        json={"code": pyotp.TOTP(secret).now()},
    )
    assert r.status_code == 204, r.text
    return {"Authorization": f"Bearer {token}"}


def _bump(pack: Any, version: str, **over: Any) -> Any:
    cand = pack.table("candidate")
    extra = FieldDef(key="linkedin_url", label="LinkedIn", type="url")
    tables = [
        t.model_copy(update={"fields": [*t.fields, extra]}) if t.key == "candidate" else t
        for t in pack.tables
    ]
    assert cand is not None
    return pack.model_copy(update={"version": version, "tables": tables, **over})


async def test_publish_is_blocked_until_fixtures_pass_then_owner_accepts(
    client: httpx.AsyncClient, agency: Agency, app: Any, db: Any
) -> None:
    ops = await _operator(client, db)
    catalog = app.state.catalog
    original = catalog.packs["recruitment"]
    try:
        listed = (await client.get("/v1/ops/packs", headers=ops)).json()
        assert any(p["id"] == "recruitment" and p["fixtures"] >= 8 for p in listed)
        # Publish the version on disk first (it may already be published by another test run).
        await client.post("/v1/ops/packs/recruitment/publish", headers=ops)

        broken = FixtureDef(id="FX-X", title="Wrongly promises a duplicate is fine", table="candidate",
                            given=[{"table": "candidate", "id": "a", "data": {"full_name": "A", "email": "a@x.in"}}],  # type: ignore[list-item]
                            record={"full_name": "B", "email": "A@x.in"}, expect="allowed")  # fmt: skip
        catalog.packs["recruitment"] = _bump(
            original, "9.1.0", fixtures=[*original.fixtures, broken]
        )
        r = await client.post("/v1/ops/packs/recruitment/publish", headers=ops)
        assert r.status_code == 422 and "fixtures fail" in r.json()["detail"]
        assert any(not x["passed"] for x in r.json()["fixtures"]["results"])

        catalog.packs["recruitment"] = _bump(original, "9.1.0", compatible_with="1.0 or so")
        r = await client.post("/v1/ops/packs/recruitment/publish", headers=ops)
        assert r.status_code == 422 and "compatibility range" in r.json()["detail"]

        catalog.packs["recruitment"] = _bump(original, "9.1.0", compatible_with=">=1.0,<10.0")
        r = await client.post("/v1/ops/packs/recruitment/publish", headers=ops)
        assert r.status_code == 201, r.text
        again = await client.post("/v1/ops/packs/recruitment/publish", headers=ops)
        assert again.status_code == 422  # not newer
    finally:
        catalog.packs["recruitment"] = original

    home = (await client.get("/v1/workspace/home", headers=agency.h())).json()
    assert [u["version"] for u in home["pack_updates"]][-1] == "9.1.0"
    # Nothing changes until the owner accepts.
    draft = (await client.get("/v1/studio/tables", headers=agency.h())).json()
    assert "linkedin_url" not in {
        f["key"] for t in draft if t["key"] == "candidate" for f in t["fields"]
    }
    r = await client.post("/v1/workspace/pack/updates/9.1.0/accept", headers=agency.h())
    assert r.status_code == 200, r.text
    assert "candidate.linkedin_url" in r.json()["changes"]["fields"]
    draft = (await client.get("/v1/studio/tables", headers=agency.h())).json()
    assert "linkedin_url" in {
        f["key"] for t in draft if t["key"] == "candidate" for f in t["fields"]
    }
    home = (await client.get("/v1/workspace/home", headers=agency.h())).json()
    assert "9.1.0" not in [u["version"] for u in home["pack_updates"]]
    v = await agency.publish_live()
    live = (await client.get("/v1/app/tables/candidate", headers=agency.h())).json()
    assert live["release_version"] == v and any(
        f["key"] == "linkedin_url" for f in live["table"]["fields"]
    )
