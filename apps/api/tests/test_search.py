"""M1-S20 counts, S22 lists, S23 search, facets and saved searches, S24 command bar, S25 matching."""

from typing import Any

import httpx

from tableui.platform.mail import InMemoryMailer
from tests.conftest import Agency, candidate
from tests.test_workspace_admin import _team_mate


async def _cand(a: Agency, n: int, **over: Any) -> dict[str, Any]:
    r = await a.create_candidate(
        candidate(email=f"c{n}-{a.email}", phone=f"+91 9{n:04d} 1{n:04d}", **over)
    )
    assert r.status_code == 201, r.text
    return r.json()  # type: ignore[no-any-return]


async def test_keyword_search_covers_cv_text_and_tolerates_typos(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    arjun = await _cand(a, 1, full_name="Arjun Menon", skills=["Java"])
    await _cand(a, 2, full_name="Priya Nair", skills=["Python"])
    r = await client.post(
        "/v1/records/candidate_document",
        headers=a.h(),
        json={
            "data": {
                "candidate": arjun["id"],
                "kind": "CV",
                "file_name": "cv.pdf",
                "parsed_text": "Built Kubernetes operators at scale",
            }
        },
    )
    assert r.status_code == 201, r.text
    hit = (
        await client.get("/v1/records/candidate", headers=a.h(), params={"q": "kubernetes"})
    ).json()["items"]
    assert [x["data"]["full_name"] for x in hit] == ["Arjun Menon"]
    typo = (
        await client.get("/v1/records/candidate", headers=a.h(), params={"q": "arjun menen"})
    ).json()["items"]
    assert "Arjun Menon" in [x["data"]["full_name"] for x in typo]
    assert hit[0]["owner"]["name"].startswith("Owner ")


async def test_facets_count_and_narrow_and_respect_hidden_fields(
    client: httpx.AsyncClient, agency: Agency, mailer: InMemoryMailer
) -> None:
    a = agency
    await _cand(
        a,
        11,
        skills=["Java", "SQL"],
        location="Pune",
        total_experience="3 yrs",
        notice_period_days=30,
        expected_ctc="8 LPA",
    )
    await _cand(
        a,
        12,
        skills=["Java"],
        location="Pune",
        total_experience="7 yrs",
        notice_period_days=90,
        expected_ctc="25 LPA",
    )
    await _cand(
        a,
        13,
        skills=["Python"],
        location="Chennai",
        total_experience="12 yrs",
        notice_period_days=15,
        expected_ctc="45 LPA",
    )
    f = (await client.get("/v1/records/candidate/facets", headers=a.h())).json()
    assert f["total"] == 3
    skills = {v["value"]: v["count"] for v in f["facets"]["skills"]["values"]}
    assert skills == {"Java": 2, "SQL": 1, "Python": 1}
    loc = {v["value"]: v["count"] for v in f["facets"]["location"]["values"]}
    assert loc == {"Pune": 2, "Chennai": 1}
    exp = {v["label"]: v["count"] for v in f["facets"]["total_experience"]["values"]}
    assert exp == {"Under 2 yrs": 0, "2 to 5 yrs": 1, "5 to 10 yrs": 1, "10 yrs or more": 1}
    narrowed = (
        await client.get("/v1/records/candidate/facets", headers=a.h(), params={"f.skills": "Java"})
    ).json()
    assert narrowed["total"] == 2
    pay = {v["label"]: v["count"] for v in narrowed["facets"]["expected_ctc"]["values"]}
    assert pay["5 to 10 LPA"] == 1 and pay["20 to 40 LPA"] == 1
    ranged = (
        await client.get(
            "/v1/records/candidate",
            headers=a.h(),
            params={"r.total_experience": "60..144", "f.location": "pune"},
        )
    ).json()
    assert len(ranged["items"]) == 1 and ranged["items"][0]["data"]["location"] == "Pune"
    sourcer, _ = await _team_mate(client, a, mailer, "sourcer")
    sf = (await client.get("/v1/records/candidate/facets", headers=sourcer.h())).json()
    assert "expected_ctc" not in sf["facets"]  # hidden from sourcers everywhere
    assert sf["total"] == 0  # sourcers see only their own candidates (R-15)
    bad = await client.get(
        "/v1/records/candidate", headers=sourcer.h(), params={"r.expected_ctc": "0..100"}
    )
    assert bad.status_code == 422


async def test_saved_searches_are_personal(
    client: httpx.AsyncClient, agency: Agency, mailer: InMemoryMailer
) -> None:
    a = agency
    r = await client.post(
        "/v1/search/saved",
        headers=a.h(),
        json={
            "table": "candidate",
            "screen": "candidates",
            "name": "Java in Pune",
            "query": {"filters": {"skills": "Java", "location": "Pune"}, "q": ""},
        },
    )
    assert r.status_code == 201, r.text
    mine = (await client.get("/v1/search/saved", headers=a.h())).json()
    assert [x["name"] for x in mine] == ["Java in Pune"] and mine[0]["query"][
        "screen"
    ] == "candidates"
    other, _ = await _team_mate(client, a, mailer, "recruiter")
    assert (await client.get("/v1/search/saved", headers=other.h())).json() == []
    assert (
        await client.delete(f"/v1/search/saved/{mine[0]['id']}", headers=other.h())
    ).status_code == 404
    assert (
        await client.delete(f"/v1/search/saved/{mine[0]['id']}", headers=a.h())
    ).status_code == 204
    bad = await client.post(
        "/v1/search/saved",
        headers=a.h(),
        json={"table": "candidate", "name": "x", "query": {"sql": "drop"}},
    )
    assert bad.status_code == 422


async def test_command_bar_finds_records_and_screens_by_name(
    client: httpx.AsyncClient, agency: Agency, other_agency: Agency
) -> None:
    a = agency
    await _cand(a, 21, full_name="Kavitha Raman")
    cl = (
        await client.post(
            "/v1/records/client", headers=a.h(), json={"data": {"name": "Kavach Systems"}}
        )
    ).json()
    await client.post(
        "/v1/records/requirement",
        headers=a.h(),
        json={"data": {"title": "Kava developer", "client": cl["id"]}},
    )
    r = (await client.get("/v1/search", headers=a.h(), params={"q": "kav"})).json()
    tables = {x["table"] for x in r["records"]}
    assert {"candidate", "client", "requirement"} <= tables
    s = (await client.get("/v1/search", headers=a.h(), params={"q": "cand"})).json()
    assert any(x["screen"] == "candidates" for x in s["screens"])
    theirs = (
        await client.get("/v1/search", headers=other_agency.h(), params={"q": "kavitha"})
    ).json()
    assert theirs["records"] == []


async def test_client_counts_owner_and_filters(client: httpx.AsyncClient, agency: Agency) -> None:
    a = agency
    acme = (
        await client.post("/v1/records/client", headers=a.h(), json={"data": {"name": "Acme"}})
    ).json()
    zen = (
        await client.post("/v1/records/client", headers=a.h(), json={"data": {"name": "Zen"}})
    ).json()
    for status in ("Open", "Open", "Filled"):
        await client.post(
            "/v1/records/requirement",
            headers=a.h(),
            json={"data": {"title": "Role", "client": acme["id"], "status": status}},
        )
    items = (await client.get("/v1/records/client", headers=a.h())).json()["items"]
    counts = {x["data"]["name"]: x["counts"]["open_requirements"] for x in items}
    assert counts == {"Acme": 2, "Zen": 0}
    open_only = (
        await client.get(
            "/v1/records/client", headers=a.h(), params={"has.open_requirements": "yes"}
        )
    ).json()["items"]
    assert [x["id"] for x in open_only] == [acme["id"]]
    none = (
        await client.get(
            "/v1/records/client", headers=a.h(), params={"has.open_requirements": "no"}
        )
    ).json()["items"]
    assert [x["id"] for x in none] == [zen["id"]]
    mine = (await client.get("/v1/records/client", headers=a.h(), params={"owner": "me"})).json()[
        "items"
    ]
    assert len(mine) == 2 and mine[0]["owner"]["id"]


async def test_ranked_matches_show_each_part_and_weights_change_order(
    client: httpx.AsyncClient, agency: Agency, mailer: InMemoryMailer
) -> None:
    a = agency
    cl = (
        await client.post("/v1/records/client", headers=a.h(), json={"data": {"name": "Aurora"}})
    ).json()
    req = (
        await client.post(
            "/v1/records/requirement",
            headers=a.h(),
            json={"data": {"title": "Backend", "client": cl["id"], "skills": ["Java", "Kafka", "SQL"], "location": "Pune",
                           "min_experience": "4 yrs", "max_experience": "8 yrs", "budget_max": "30 LPA", "max_notice_days": 60}},
        )
    ).json()  # fmt: skip
    skilled = await _cand(
        a,
        31,
        full_name="Skilled Far",
        skills=["Java", "Kafka", "SQL"],
        location="Delhi",
        total_experience="6 yrs",
        expected_ctc="28 LPA",
        notice_period_days=30,
    )
    local = await _cand(
        a,
        32,
        full_name="Local Partial",
        skills=["Java"],
        location="Pune",
        total_experience="6 yrs",
        expected_ctc="20 LPA",
        notice_period_days=15,
    )
    await _cand(
        a,
        33,
        full_name="Long Notice",
        skills=["Java", "Kafka", "SQL"],
        location="Pune",
        total_experience="6 yrs",
        notice_period_days=180,
    )
    await _cand(a, 34, full_name="Archived One", skills=["Java", "Kafka", "SQL"], status="Archived")
    m = (await client.get(f"/v1/matching/requirement_matches/{req['id']}", headers=a.h())).json()
    names = [x["data"]["full_name"] for x in m["items"]]
    assert "Archived One" not in names and "Long Notice" not in names  # hard filters
    assert names[:2] == ["Skilled Far", "Local Partial"]
    top = m["items"][0]
    assert set(top["parts"]) == {"skills", "experience", "location", "pay", "notice"}
    assert top["parts"]["skills"]["points"] == 40 and top["parts"]["location"]["points"] == 0
    assert m["weights"] == {"skills": 40, "experience": 20, "location": 15, "pay": 15, "notice": 10}
    again = (
        await client.get(f"/v1/matching/requirement_matches/{req['id']}", headers=a.h())
    ).json()
    assert [x["id"] for x in again["items"]] == [
        x["id"] for x in m["items"]
    ]  # same inputs, same order
    view = (
        await client.get(
            f"/v1/matching/requirement_matches/{req['id']}",
            headers=a.h(),
            params={"w.skills": 5, "w.location": 60},
        )
    ).json()
    assert view["items"][0]["id"] == local["id"]
    still = (
        await client.get(f"/v1/matching/requirement_matches/{req['id']}", headers=a.h())
    ).json()
    assert still["items"][0]["id"] == skilled["id"]  # the view change did not stick
    rec, _ = await _team_mate(client, a, mailer, "recruiter")
    denied = await client.put(
        "/v1/matching/requirement_matches/weights",
        headers=rec.h(),
        json={"weights": {"skills": 10}},
    )
    assert denied.status_code == 403
    ok = await client.put(
        "/v1/matching/requirement_matches/weights",
        headers=a.h(),
        json={"weights": {"skills": 5, "location": 60}},
    )
    assert ok.status_code == 200
    now = (await client.get(f"/v1/matching/requirement_matches/{req['id']}", headers=a.h())).json()
    assert now["items"][0]["id"] == local["id"] and now["defaults"]["location"] == 60
