"""The chart above a table (R10): groups and measures over the matches, and what it refuses."""

import httpx

from tests.conftest import Agency
from tests.test_stats import _people


async def _put(client: httpx.AsyncClient, a: Agency, table: str, body: dict) -> httpx.Response:  # type: ignore[type-arg]
    return await client.put(f"/v1/studio/tables/{table}/features", headers=a.h(), json=body)


async def _chart(
    client: httpx.AsyncClient, a: Agency, table: str = "candidate", **params: str
) -> httpx.Response:
    return await client.get(f"/v1/records/{table}/chart", headers=a.h(), params=params)


async def _on(
    client: httpx.AsyncClient, a: Agency, table: str = "candidate", **extra: object
) -> None:
    assert (await _put(client, a, table, {"stat_view": "chart", **extra})).status_code == 200
    await a.publish_live()


async def test_chart_is_refused_until_the_owner_chooses_it(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    await _people(agency)
    assert (await _chart(client, agency, x="status")).status_code == 403
    await _on(client, agency)
    assert (await _chart(client, agency, x="status")).status_code == 200


async def test_groups_count_and_measure_over_the_matches(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    await _people(agency)
    await _on(client, agency)
    body = (await _chart(client, agency, x="status", measures="count,avg:expected_ctc")).json()
    pts = {p["label"]: p for p in body["points"]}
    assert pts["Active"]["values"]["count"] == 3
    assert pts["Archived"]["values"]["count"] == 1
    assert pts["Active"]["values"]["avg:expected_ctc"] == 1200000  # Dev has none, so two values
    assert pts["Archived"]["values"]["avg:expected_ctc"] == 700000
    assert [p["label"] for p in body["points"]][0] == "Active"  # biggest first
    assert body["total"] == 4
    assert body["overall"] == {"count": 4, "avg:expected_ctc": 1033333.33}
    assert {m["key"] for m in body["measures"]} == {"count", "avg:expected_ctc"}
    narrowed = (await _chart(client, agency, x="status", **{"f.status": "Archived"})).json()
    assert [p["label"] for p in narrowed["points"]] == ["Archived"]


async def test_small_groups_fold_into_others(client: httpx.AsyncClient, agency: Agency) -> None:
    await _people(agency)
    await _on(client, agency)
    body = (
        await _chart(client, agency, x="status", top="1", measures="count,sum:expected_ctc")
    ).json()
    assert [p["label"] for p in body["points"]] == ["Active", "Others"]
    others = body["points"][1]
    assert others["count"] == 1 and others["values"]["count"] == 1
    assert others["values"]["sum:expected_ctc"] == 700000


async def test_a_date_groups_into_periods_oldest_first(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    for day in ("2026-01-05", "2026-01-20", "2026-02-10", "2026-03-15"):
        r = await client.post("/v1/records/interaction", headers=agency.h(), json={"data": {"summary": f"Call {day}", "kind": "Call", "occurred_on": day}})  # fmt: skip
        assert r.status_code == 201, r.text
    await _on(client, agency, "interaction")
    body = (await _chart(client, agency, "interaction", x="occurred_on", bucket="month")).json()
    assert [(p["label"], p["values"]["count"]) for p in body["points"]] == [("2026-01-01", 2), ("2026-02-01", 1), ("2026-03-01", 1)]  # fmt: skip
    assert body["x"]["bucket"] == "month"
    by_day = (await _chart(client, agency, "interaction", x="occurred_on", bucket="day")).json()
    assert len(by_day["points"]) == 4


async def test_it_refuses_what_cannot_be_charted(client: httpx.AsyncClient, agency: Agency) -> None:
    await _people(agency)
    await _on(client, agency, nochart=["location"])
    for bad in (
        {"x": "skills"},  # a list of labels
        {"x": "location"},  # left out of charts by the owner
        {"x": "nope"},
        {"x": "status", "measures": "sum:full_name"},  # not a number
        {"x": "status", "measures": "sum"},
        {"x": "status", "measures": "count,count,count"},
        {"x": "status", "top": "99"},
        {"x": "status", "bucket": "year"},
    ):
        r = await _chart(client, agency, **bad)
        assert r.status_code in (400, 422), (bad, r.text)
    offered = (await _chart(client, agency, x="status")).json()
    assert "location" not in {g["key"] for g in offered["groupable"]}
    assert "expected_ctc" in {n["key"] for n in offered["numbers"]}


async def test_chart_settings_must_fit_the_table(client: httpx.AsyncClient, agency: Agency) -> None:
    good = {
        "type": "area",
        "x": "status",
        "measures": [{"agg": "avg", "field": "expected_ctc"}],
        "top": 5,
    }
    assert (
        await _put(client, agency, "candidate", {"stat_view": "chart", "chart": good})
    ).status_code == 200
    for chart in (
        {"x": "skills"},
        {"x": "status", "measures": [{"agg": "sum", "field": "full_name"}]},
        {"type": "pie"},
        {"measures": [{"agg": "sum"}]},
        {"top": 0},
    ):
        r = await _put(client, agency, "candidate", {"stat_view": "chart", "chart": chart})
        assert r.status_code in (400, 422), (chart, r.text)
    assert (await _put(client, agency, "candidate", {"nochart": ["nope"]})).status_code in (
        400,
        422,
    )
