"""Files: type checked by content, virus-scanned before use (R-14), per workspace; branding logo (S06)."""

import httpx

from tableui.files.public import EICAR
from tests.conftest import Agency

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


async def _upload(
    client: httpx.AsyncClient, a: Agency, kind: str, name: str, data: bytes
) -> httpx.Response:
    return await client.post(
        "/v1/files", headers=a.h(), data={"kind": kind}, files={"file": (name, data)}
    )


async def test_logo_upload_and_branding_reach_the_live_app(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    r = await _upload(client, agency, "logo", "logo.png", PNG)
    assert r.status_code == 201, r.text
    f = r.json()
    assert f["content_type"] == "image/png" and f["scan_status"] == "clean"
    got = await client.get(f"/v1/files/{f['id']}/content", headers=agency.h())
    assert got.status_code == 200 and got.content == PNG
    assert got.headers["x-content-type-options"] == "nosniff"
    r = await client.put(
        "/v1/workspace/settings/brand",
        headers=agency.h(),
        json={"app_name": "Northstar Hire", "accent": "#0f766e", "logo_file_id": f["id"]},
    )
    assert r.status_code == 200, r.text
    s = (await client.get("/v1/workspace/settings", headers=agency.h())).json()
    assert s["brand"] == {
        "app_name": "Northstar Hire",
        "accent": "#0f766e",
        "logo_file_id": f["id"],
    }
    home = (await client.get("/v1/workspace/home", headers=agency.h())).json()
    assert next(c for c in home["checklist"] if c["key"] == "brand")["done"] is True


async def test_type_is_judged_by_content_not_by_name(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    r = await _upload(client, agency, "logo", "logo.png", b"<svg onload=alert(1)>")
    assert r.status_code == 422 and r.json()["errors"][0]["code"] == "type"
    big = await _upload(client, agency, "logo", "big.png", PNG + b"\x00" * (1024 * 1024))
    assert big.status_code == 422 and big.json()["errors"][0]["code"] == "too_large"


async def test_infected_file_is_kept_out(client: httpx.AsyncClient, agency: Agency) -> None:
    r = await _upload(client, agency, "cv", "cv.pdf", b"%PDF-1.4\n" + EICAR)
    assert r.status_code == 201 and r.json()["scan_status"] == "infected"
    fid = r.json()["id"]
    got = await client.get(f"/v1/files/{fid}/content", headers=agency.h())
    assert got.status_code == 422
    r = await client.put(
        "/v1/workspace/settings/brand",
        headers=agency.h(),
        json={"app_name": "X", "accent": "#0f766e", "logo_file_id": fid},
    )
    assert r.status_code == 422


async def test_files_stay_inside_their_workspace(
    client: httpx.AsyncClient, agency: Agency, other_agency: Agency
) -> None:
    fid = (await _upload(client, agency, "logo", "logo.png", PNG)).json()["id"]
    assert (await client.get(f"/v1/files/{fid}", headers=other_agency.h())).status_code == 404
    assert (
        await client.get(f"/v1/files/{fid}/content", headers=other_agency.h())
    ).status_code == 404
