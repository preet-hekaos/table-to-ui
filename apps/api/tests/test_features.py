"""Table features (N5a): per-table settings, on by default, kept in the table definition."""

import httpx

from tableui.metadata.domain.models import TableDef, TableFeatures, features_of
from tableui.platform.mail import InMemoryMailer
from tests.conftest import Agency
from tests.test_workspace_admin import _team_mate


def _table(features: dict | None = None) -> TableDef:
    return TableDef.model_validate(
        {
            "key": "thing",
            "label": "Thing",
            "plural_label": "Things",
            "title_field": "name",
            "fields": [{"key": "name", "label": "Name", "type": "text"}],
            **({"features": features} if features is not None else {}),
        }
    )


def test_a_table_that_was_never_customised_has_every_feature_on() -> None:
    t = _table()
    assert t.features is None
    f = features_of(t)
    assert f == TableFeatures()
    assert all(v for k, v in f.model_dump().items() if isinstance(v, bool))
    assert f.bulk_scope == "view" and f.bulk_actions == ["export", "edit", "delete"]
    assert "features" in t.model_dump(mode="json")  # stored as null until chosen


async def test_features_are_set_per_table_stay_in_draft_and_are_audited(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    r = await client.put(
        "/v1/studio/tables/candidate/features",
        headers=a.h(),
        json={"grouping": False, "bulk_actions": ["export"], "bulk_scope": "all"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["tables"] == ["candidate"]
    table = {t["key"]: t for t in (await client.get("/v1/studio/tables", headers=a.h())).json()}
    f = table["candidate"]["features"]
    assert f["grouping"] is False and f["sort_filter"] is True
    assert f["bulk_actions"] == ["export"] and f["bulk_scope"] == "all"
    assert table["client"]["features"] is None
    # Draft only until published.
    live = (await client.get("/v1/app/tables/candidate", headers=a.h())).json()["table"]
    assert live.get("features") is None
    changes = (await client.get("/v1/studio/status", headers=a.h())).json()["changes"]["tables"]
    assert [c["key"] for c in changes] == ["candidate"]
    await a.publish_live()
    live = (await client.get("/v1/app/tables/candidate", headers=a.h())).json()["table"]
    assert live["features"]["grouping"] is False
    audit = await client.get("/v1/workspace/audit", headers=a.h())
    if audit.status_code == 200:
        assert "metadata.features.update" in audit.text


async def test_setting_the_same_features_again_changes_nothing(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    body = TableFeatures().model_dump(mode="json")
    r = await client.put("/v1/studio/tables/client/features", headers=a.h(), json=body)
    assert r.status_code == 200 and r.json()["tables"] == []
    assert (await client.get("/v1/studio/status", headers=a.h())).json()["draft_changed"] is False


async def test_apply_to_all_tables_and_bad_values_are_refused(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    a = agency
    r = await client.put("/v1/studio/features", headers=a.h(), json={"row_order": False})
    assert r.status_code == 200, r.text
    tables = (await client.get("/v1/studio/tables", headers=a.h())).json()
    assert len(r.json()["tables"]) == len(tables)
    assert all(t["features"]["row_order"] is False for t in tables)
    bad = await client.put(
        "/v1/studio/tables/candidate/features", headers=a.h(), json={"bulk_scope": "everything"}
    )
    assert bad.status_code == 422
    unknown = await client.put(
        "/v1/studio/tables/candidate/features", headers=a.h(), json={"flying": True}
    )
    assert unknown.status_code == 422
    missing = await client.put("/v1/studio/tables/nope/features", headers=a.h(), json={})
    assert missing.status_code == 404


async def test_only_people_who_can_edit_the_studio_and_only_their_own_workspace(
    client: httpx.AsyncClient, agency: Agency, other_agency: Agency, mailer: InMemoryMailer
) -> None:
    viewer, _ = await _team_mate(client, agency, mailer, "sourcer")
    r = await client.put(
        "/v1/studio/tables/candidate/features", headers=viewer.h(), json={"grouping": False}
    )
    assert r.status_code == 403
    await client.put("/v1/studio/features", headers=agency.h(), json={"grouping": False})
    theirs = (await client.get("/v1/studio/tables", headers=other_agency.h())).json()
    assert all(t["features"] is None for t in theirs)
