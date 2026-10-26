"""Edit in the list (N5e) uses the ordinary update command: clearing, required fields, stale versions."""

import httpx

from tests.conftest import Agency, candidate


async def _patch(
    client: httpx.AsyncClient, a: Agency, rid: str, version: int, data: dict
) -> httpx.Response:  # type: ignore[type-arg]
    return await client.patch(
        f"/v1/records/candidate/{rid}", headers=a.h(), json={"version": version, "data": data}
    )


async def test_one_cell_change_clears_validates_and_refuses_stale_versions(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    made = (
        await agency.create_candidate(candidate(full_name="Cell Person", location="Pune"))
    ).json()
    rid, v = made["id"], made["version"]
    changed = await _patch(client, agency, rid, v, {"location": "Surat"})
    assert changed.status_code == 200 and changed.json()["data"]["location"] == "Surat"
    cleared = await _patch(client, agency, rid, v + 1, {"location": None})
    assert cleared.status_code == 200 and cleared.json()["data"].get("location") is None
    required = await _patch(client, agency, rid, v + 2, {"full_name": None})
    assert required.status_code == 422
    stale = await _patch(client, agency, rid, v, {"location": "Goa"})
    assert stale.status_code == 409
