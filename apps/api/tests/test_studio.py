"""Studio editing: tables and fields (M1-S12), screens and menu (S14, S15), versions (S17)."""

import httpx

from tableui.platform.mail import InMemoryMailer
from tests.conftest import Agency, candidate
from tests.test_workspace_admin import _team_mate


async def test_agency_field_is_stored_without_rewrite_searchable_filterable_and_agency_owned(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    r = await client.post(
        "/v1/studio/tables/candidate/fields",
        headers=a.h(),
        json={"label": "Preferred shift", "type": "select", "options": ["Day", "Night"]},
    )
    assert r.status_code == 201, r.text
    f = r.json()
    assert f["key"] == "preferred_shift" and f["source"] == "agency"
    assert f["searchable"] and f["filterable"]
    # Not in the live app until published.
    live = (await client.get("/v1/app/tables/candidate", headers=a.h())).json()["table"]
    assert "preferred_shift" not in {x["key"] for x in live["fields"]}
    status = (await client.get("/v1/studio/status", headers=a.h())).json()
    assert status["draft_changed"] is True
    change = status["changes"]["tables"][0]
    assert change["key"] == "candidate" and change["fields"][0]["change"] == "added"

    await a.publish_live()
    live = (await client.get("/v1/app/tables/candidate", headers=a.h())).json()["table"]
    assert "preferred_shift" in {x["key"] for x in live["fields"]}
    for shift, name, phone in (
        ("Night", "Night Owl", "+91 98450 11111"),
        ("Day", "Day Bird", "+91 98450 22222"),
    ):
        r = await a.create_candidate(candidate(full_name=name, preferred_shift=shift, phone=phone))
        assert r.status_code == 201, r.text
    bad = await a.create_candidate(candidate(preferred_shift="Evening", phone="+91 98450 33333"))
    assert bad.status_code == 422
    night = (
        await client.get(
            "/v1/records/candidate", headers=a.h(), params={"f.preferred_shift": "Night"}
        )
    ).json()["items"]
    assert [x["data"]["full_name"] for x in night] == ["Night Owl"]
    found = (await client.get("/v1/records/candidate", headers=a.h(), params={"q": "night"})).json()
    assert "Night Owl" in [x["data"]["full_name"] for x in found["items"]]


async def test_pack_field_can_be_relabelled_or_hidden_but_not_deleted_or_retyped(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    base = "/v1/studio/tables/candidate/fields"
    r = await client.patch(f"{base}/current_employer", headers=a.h(), json={"label": "Employer"})
    assert r.status_code == 200 and r.json()["label"] == "Employer"
    r = await client.patch(f"{base}/current_employer", headers=a.h(), json={"hidden": True})
    assert r.status_code == 200 and r.json()["hidden"] is True
    r = await client.patch(f"{base}/current_employer", headers=a.h(), json={"type": "integer"})
    assert r.status_code == 422 and r.json()["errors"][0]["code"] == "not_editable"
    r = await client.delete(f"{base}/current_employer", headers=a.h())
    assert r.status_code == 422 and r.json()["errors"][0]["code"] == "pack_field"
    r = await client.patch(f"{base}/email", headers=a.h(), json={"hidden": True})
    assert r.status_code == 422  # required pack fields stay visible
    r = await client.post(base, headers=a.h(), json={"label": "Owner", "type": "text"})
    assert r.status_code == 422  # reserved name
    r = await client.post(base, headers=a.h(), json={"label": "Email", "type": "text"})
    assert r.status_code == 422 and r.json()["errors"][0]["code"] == "duplicate"


async def test_builder_creates_a_table_with_a_screen_and_menu_entry(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    r = await client.post(
        "/v1/studio/tables",
        headers=a.h(),
        json={"label": "Referral partner", "plural_label": "Referral partners"},
    )
    assert r.status_code == 201, r.text
    assert r.json()["key"] == "referral_partner" and r.json()["source"] == "agency"
    r = await client.post(
        "/v1/studio/tables/referral_partner/fields",
        headers=a.h(),
        json={"label": "Partner email", "type": "email", "unique": True},
    )
    assert r.status_code == 201, r.text
    r = await client.post(
        "/v1/studio/tables/referral_partner/fields",
        headers=a.h(),
        json={"label": "Introduced by", "type": "reference", "ref_table": "candidate"},
    )
    assert r.status_code == 201, r.text
    dup = await client.post("/v1/studio/tables", headers=a.h(), json={"label": "Candidate"})
    assert dup.status_code == 422

    nav = (await client.get("/v1/studio/navigation", headers=a.h())).json()
    assert any(n["screen"] == "referral_partner_list" for n in nav)
    await a.publish_live()
    items = (await client.get("/v1/app/navigation", headers=a.h())).json()["items"]
    assert any(i["table"] == "referral_partner" for i in items)
    r = await client.post(
        "/v1/records/referral_partner",
        headers=a.h(),
        json={"data": {"name": "Talent Bridge", "partner_email": "Hello@TalentBridge.in"}},
    )
    assert r.status_code == 201, r.text
    again = await client.post(
        "/v1/records/referral_partner",
        headers=a.h(),
        json={"data": {"name": "Other", "partner_email": "hello@talentbridge.in"}},
    )
    assert again.status_code in (409, 422)


async def test_menu_and_screen_changes_appear_only_in_draft_until_published(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    nav = (await client.get("/v1/studio/navigation", headers=a.h())).json()
    nav = [{**n, "label": "People"} if n["screen"] == "candidates" else n for n in nav]
    nav = [n for n in nav if n["screen"] != "skills"]
    r = await client.put("/v1/studio/navigation", headers=a.h(), json={"items": nav})
    assert r.status_code == 200, r.text
    live = (await client.get("/v1/app/navigation", headers=a.h())).json()["items"]
    assert "Candidates" in [i["label"] for i in live] and any(i["screen"] == "skills" for i in live)

    r = await client.put(
        "/v1/studio/screens/clients",
        headers=a.h(),
        json={
            "title": "Clients",
            "pattern": "searchable_table",
            "table": "client",
            "config": {"columns": ["name", "status"], "empty_text": "No clients yet"},
        },
    )
    assert r.status_code == 200, r.text
    bad = await client.put(
        "/v1/studio/screens/clients",
        headers=a.h(),
        json={
            "title": "Clients",
            "pattern": "searchable_table",
            "table": "client",
            "config": {"columns": ["nope"]},
        },
    )
    assert bad.status_code == 422
    await a.publish_live()
    live = (await client.get("/v1/app/navigation", headers=a.h())).json()["items"]
    assert "People" in [i["label"] for i in live] and not any(i["screen"] == "skills" for i in live)
    sc = (await client.get("/v1/app/screens/clients", headers=a.h())).json()["screen"]
    assert sc["config"]["columns"] == ["name", "status"]


async def test_compare_lists_changed_tables_fields_screens_and_menu(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    await client.patch(
        "/v1/studio/tables/client/fields/name", headers=a.h(), json={"label": "Company"}
    )
    await client.put(
        "/v1/studio/screens/clients",
        headers=a.h(),
        json={"title": "Companies", "pattern": "searchable_table", "table": "client"},
    )
    v2 = await a.publish_live()
    diff = (
        await client.get("/v1/apps/current/compare", headers=a.h(), params={"from": 1, "to": v2})
    ).json()
    assert diff["changed"] is True
    table = next(t for t in diff["tables"] if t["key"] == "client")
    name = next(f for f in table["fields"] if f["field"] == "name")
    assert name["change"] == "changed" and name["attributes"]["label"]["to"] == "Company"
    assert "title" in next(s for s in diff["screens"] if s["key"] == "clients")["attributes"]
    same = (await client.get("/v1/apps/current/compare", headers=a.h(), params={"from": v2})).json()
    assert same["changed"] is False


async def test_live_publish_by_a_non_owner_needs_owner_approval(
    client: httpx.AsyncClient, agency: Agency, mailer: InMemoryMailer
) -> None:
    a = agency
    r = await client.post(
        "/v1/workspace/roles",
        headers=a.h(),
        json={
            "key": "builder",
            "name": "Builder",
            "grants": ["metadata.read", "metadata.write", "release.publish"],
        },
    )
    assert r.status_code == 201, r.text
    b, _ = await _team_mate(client, a, mailer, "builder")
    r = await client.patch(
        "/v1/studio/tables/client/fields/name", headers=b.h(), json={"label": "Company"}
    )
    assert r.status_code == 200, r.text
    v = (await client.post("/v1/apps/current/releases", headers=b.h())).json()["version"]
    r = await client.post(f"/v1/apps/current/releases/{v}/promote", headers=b.h())
    assert r.status_code == 202 and r.json()["status"] == "pending_approval"
    live = (await client.get("/v1/app/tables/client", headers=a.h())).json()
    assert live["release_version"] == 1
    approval = r.json()["approval_id"]
    denied = await client.post(
        f"/v1/apps/current/approvals/{approval}", headers=b.h(), json={"approve": True}
    )
    assert denied.status_code == 403
    ok = await client.post(
        f"/v1/apps/current/approvals/{approval}", headers=a.h(), json={"approve": True}
    )
    assert ok.status_code == 200 and ok.json()["status"] == "live"
    live = (await client.get("/v1/app/tables/client", headers=a.h())).json()
    assert live["release_version"] == v
    listed = (await client.get("/v1/apps/current/approvals", headers=a.h())).json()
    assert listed[0]["status"] == "approved"


async def test_studio_edits_need_metadata_write(
    client: httpx.AsyncClient, agency: Agency, mailer: InMemoryMailer
) -> None:
    rec, _ = await _team_mate(client, agency, mailer, "recruiter")
    r = await client.post(
        "/v1/studio/tables/candidate/fields", headers=rec.h(), json={"label": "X", "type": "text"}
    )
    assert r.status_code == 403


async def test_pack_fixtures_run_from_test_and_list_each_result(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    r = await client.post("/v1/apps/current/fixtures/run", headers=a.h())
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["environment"] == "test" and out["total"] >= 8
    assert out["failed"] == 0, [x for x in out["results"] if not x["passed"]]
    assert {x["id"] for x in out["results"]} >= {"FX-02", "FX-07"}


def test_a_broken_rule_makes_its_fixture_fail() -> None:
    from pathlib import Path

    from tableui.metadata.public import load_pack
    from tableui.rules.public import run_fixtures

    pack = load_pack(Path(__file__).parents[3] / "packs" / "recruitment")
    tables = {t.key: t for t in pack.tables}
    without_r01 = [r for r in pack.rules if r.id != "R-01"]
    out = run_fixtures(tables, without_r01, pack.fixtures)
    failed = {x["id"] for x in out["results"] if not x["passed"]}
    assert failed == {"FX-02", "FX-03", "FX-04"}


async def test_preview_as_a_role_hides_what_that_role_cannot_see_and_is_read_only(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    r = await a.create_candidate(candidate(expected_ctc="18 LPA"))
    assert r.status_code == 201, r.text
    rid = r.json()["id"]
    as_sourcer = a.h(**{"X-Preview-Role": "sourcer"})
    rec = (await client.get(f"/v1/records/candidate/{rid}", headers=as_sourcer)).json()
    assert "expected_ctc" not in rec["data"]
    full = (await client.get(f"/v1/records/candidate/{rid}", headers=a.h())).json()
    assert "expected_ctc" in full["data"]
    items = (await client.get("/v1/app/navigation", headers=as_sourcer)).json()["items"]
    assert {i["table"] for i in items} <= {
        "candidate",
        "skill",
        "requirement",
        "candidate_document",
    }
    write = await client.post(
        "/v1/records/candidate", headers=as_sourcer, json={"data": candidate()}
    )
    assert write.status_code == 403
    unknown = await client.get("/v1/app/navigation", headers=a.h(**{"X-Preview-Role": "nobody"}))
    assert unknown.status_code == 403
    # The signed-in person's own permissions follow the previewed role, so screens draw what that role could do.
    me = (await client.get("/v1/me", headers=as_sourcer)).json()
    assert me["role"] == "sourcer"
    assert "record.candidate.create" in me["permissions"]
    assert "metadata.write" not in me["permissions"] and "*" not in me["permissions"]
    assert "expected_ctc" not in {
        f["key"]
        for f in (await client.get("/v1/app/tables/candidate", headers=as_sourcer)).json()["table"]["fields"]
        if not f["hidden"]
    }
    assert any(
        f["key"] == "expected_ctc" and not f["hidden"]
        for f in (await client.get("/v1/app/tables/candidate", headers=a.h())).json()["table"]["fields"]
    )
    # A role that cannot add documents is not offered the CV screen; one that can, is.
    viewer = a.h(**{"X-Preview-Role": "viewer"})
    assert "cv_intake" not in {
        i["screen"] for i in (await client.get("/v1/app/navigation", headers=viewer)).json()["items"]
    }
    assert "cv_intake" in {
        i["screen"] for i in (await client.get("/v1/app/navigation", headers=a.h())).json()["items"]
    }


async def test_preview_never_gives_more_than_the_builder_has(
    client: httpx.AsyncClient, agency: Agency, mailer: InMemoryMailer
) -> None:
    rec, _ = await _team_mate(client, agency, mailer, "recruiter")
    r = await client.get("/v1/app/navigation", headers=rec.h(**{"X-Preview-Role": "admin"}))
    assert r.status_code == 403  # previewing needs builder rights


async def test_builder_renames_and_adds_stages_but_not_to_an_unknown_one(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    r = await client.put(
        "/v1/studio/tables/submission/stages",
        headers=a.h(),
        json={
            "labels": {"Interview": "Client interview"},
            "add": {"key": "Assessment", "after": "Screened"},
        },
    )
    assert r.status_code == 200, r.text
    wf = r.json()
    labels = {s["key"]: s["label"] for s in wf["stages"]}
    assert labels["Interview"] == "Client interview" and "Assessment" in labels
    assert "Assessment" in wf["transitions"]["Screened"]
    bad = await client.put(
        "/v1/studio/tables/submission/stages", headers=a.h(), json={"labels": {"Nope": "X"}}
    )
    assert bad.status_code == 422
    await a.publish_live()
    live = (await client.get("/v1/app/tables/submission", headers=a.h())).json()["table"]
    assert {s["key"] for s in live["workflow"]["stages"]} >= {"Interview", "Assessment"}


async def test_builder_changes_a_policy_severity_and_fixtures_respect_it(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    r = await client.put(
        "/v1/studio/rules/R-04/checks/R-04.notice", headers=a.h(), json={"severity": "block"}
    )
    assert r.status_code == 200, r.text
    fixed = await client.put(
        "/v1/studio/rules/R-01/checks/R-01.email", headers=a.h(), json={"severity": "warn"}
    )
    assert fixed.status_code in (404, 422)
    out = (await client.post("/v1/apps/current/fixtures/run", headers=a.h())).json()
    assert out["failed"] == 0, [x for x in out["results"] if not x["passed"]]


async def test_builder_previews_unpublished_draft_changes_in_the_real_app(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    await a.publish_live()
    off = await client.put(
        "/v1/studio/tables/candidate/features", headers=a.h(), json={"statistics": False}
    )
    assert off.status_code == 200, off.text
    as_draft = a.h(**{"X-Preview-Env": "draft"})
    assert (await client.get("/v1/records/candidate/stats", headers=as_draft)).status_code == 403
    assert (await client.get("/v1/records/candidate/stats", headers=a.h())).status_code == 200
    live = a.h(**{"X-Preview-Env": "live"})
    assert (await client.get("/v1/records/candidate/stats", headers=live)).status_code == 200


async def test_removing_a_choice_in_use_is_refused_and_deleting_a_field_cleans_settings(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    r = await client.post(
        "/v1/studio/tables/candidate/fields",
        headers=a.h(),
        json={"label": "Shift", "type": "select", "options": ["Day", "Night"]},
    )
    assert r.status_code == 201, r.text
    await a.publish_live()
    made = await a.create_candidate(candidate(full_name="Night Owl", shift="Night"))
    assert made.status_code == 201, made.text
    refuse = await client.patch(
        "/v1/studio/tables/candidate/fields/shift", headers=a.h(), json={"options": ["Day"]}
    )
    assert refuse.status_code == 422 and "Night (1)" in refuse.text, refuse.text
    ok = await client.patch(
        "/v1/studio/tables/candidate/fields/shift",
        headers=a.h(),
        json={"options": ["Day", "Night", "Evening"]},
    )
    assert ok.status_code == 200, ok.text

    feat = {"unsortable": ["shift"], "default_columns": ["full_name", "shift"]}
    assert (
        await client.put("/v1/studio/tables/candidate/features", headers=a.h(), json=feat)
    ).status_code == 200
    gone = await client.delete("/v1/studio/tables/candidate/fields/shift", headers=a.h())
    assert gone.status_code in (200, 204), gone.text
    table = (await client.get("/v1/studio/tables/candidate", headers=a.h())).json()
    feats = table.get("features") or {}
    assert "shift" not in (feats.get("unsortable") or [])
    assert "shift" not in (feats.get("default_columns") or [])


async def test_switches_for_sorting_and_filtering_hold_in_the_api_and_charts_take_dates_added(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    await a.publish_live()
    off = {"unsortable": ["full_name"], "unfilterable": ["current_employer"]}
    r = await client.put("/v1/studio/tables/candidate/features", headers=a.h(), json=off)
    assert r.status_code == 200, r.text
    h = a.h(**{"X-Preview-Env": "draft"})
    assert (
        await client.get("/v1/records/candidate", headers=h, params={"sort": "full_name"})
    ).status_code == 422
    assert (
        await client.get("/v1/records/candidate", headers=h, params={"sort": "updated_at"})
    ).status_code == 200
    assert (
        await client.get(
            "/v1/records/candidate", headers=h, params={"c.current_employer": "inf"}
        )
    ).status_code == 422
    chart = await client.get("/v1/records/candidate/chart", headers=h, params={"x": "created_at"})
    assert chart.status_code == 200, chart.text
    assert chart.json()["x"]["key"] == "created_at"


async def test_field_cannot_become_required_while_records_lack_it(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    r = await client.post(
        "/v1/studio/tables/candidate/fields",
        headers=a.h(),
        json={"label": "Badge", "type": "text"},
    )
    assert r.status_code == 201, r.text
    await a.publish_live()
    assert (await a.create_candidate(candidate(full_name="No Badge"))).status_code == 201
    no = await client.patch(
        "/v1/studio/tables/candidate/fields/badge", headers=a.h(), json={"required": True}
    )
    assert no.status_code == 422 and "no badge" in no.text, no.text
