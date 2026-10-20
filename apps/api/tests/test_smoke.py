from tests.conftest import Agency, candidate


async def test_end_to_end_smoke(agency: Agency) -> None:
    r = await agency.create_candidate(candidate(phone=None, email="smoke@x.test"))
    assert r.status_code == 201, r.text
    assert r.json()["version"] == 1
