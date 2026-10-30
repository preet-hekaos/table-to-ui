"""M1-S08 to S10: upload and map, validate and find duplicates, load, reconcile and undo."""

import io
import uuid
from typing import Any

import httpx

from tableui.imports.public import wait_all
from tests.conftest import Agency, candidate

HEADER = "Name,E-mail,Mobile,Company,Experience,Expected Salary,Notice,Key Skills,Joined\n"


def _csv(rows: list[str]) -> bytes:
    return (HEADER + "\n".join(rows) + "\n").encode()


async def _upload(
    client: httpx.AsyncClient, a: Agency, data: bytes, name: str = "people.csv"
) -> str:
    r = await client.post(
        "/v1/files", headers=a.h(), data={"kind": "import"}, files={"file": (name, data)}
    )
    assert r.status_code == 201, r.text
    return str(r.json()["id"])


async def _job(
    client: httpx.AsyncClient, a: Agency, data: bytes, name: str = "people.csv"
) -> dict[str, Any]:
    fid = await _upload(client, a, data, name)
    r = await client.post("/v1/imports", headers=a.h(), json={"file_id": fid, "table": "candidate"})
    assert r.status_code == 201, r.text
    return r.json()  # type: ignore[no-any-return]


async def _finish(client: httpx.AsyncClient, a: Agency, job_id: str) -> dict[str, Any]:
    await wait_all()
    return (await client.get(f"/v1/imports/{job_id}", headers=a.h())).json()  # type: ignore[no-any-return]


async def test_columns_are_profiled_and_matched_with_confidence(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    job = await _job(
        client,
        agency,
        _csv(
            [
                'Asha Rao,asha.rao@gmail.com,098450 11111,Infosys,5 yrs 3 mo,12.5 LPA,30,"Java, SQL",19/10/2026'
            ]
        ),
    )
    cols = {c["header"]: c for c in job["profile"]["columns"]}
    assert cols["E-mail"]["detected"] == "email" and cols["E-mail"]["samples"] == [
        "asha.rao@gmail.com"
    ]
    assert cols["Experience"]["detected"] == "months"
    sugg = {x["header"]: x for x in job["profile"]["suggestions"]}
    assert sugg["E-mail"]["field"] == "email" and sugg["E-mail"]["mark"] == "high"
    assert sugg["Mobile"]["field"] == "phone"
    assert sugg["Expected Salary"]["field"] == "expected_ctc"
    assert sugg["Joined"]["field"] is None  # no good match: map by hand, skip or create a field
    # A saved mapping is reused for the next file with the same columns.
    mapping = {**job["mapping"], "Joined": None, "Company": "current_employer"}
    r = await client.put(
        f"/v1/imports/{job['id']}/mapping", headers=agency.h(), json={"mapping": mapping}
    )
    assert r.status_code == 200, r.text
    again = await _job(
        client, agency, _csv(["X Y,x.y@gmail.com,9845022222,TCS,2 yrs,8 LPA,60,Go,"])
    )
    assert (
        again["profile"]["reused_mapping"] is True
        and again["mapping"]["Company"] == "current_employer"
    )
    bad = await client.put(
        f"/v1/imports/{job['id']}/mapping",
        headers=agency.h(),
        json={"mapping": {"Name": "full_name", "E-mail": "full_name"}},
    )
    assert bad.status_code == 422


async def test_validate_cleans_values_counts_errors_and_finds_duplicates(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    existing = (
        await agency.create_candidate(candidate(email="known@gmail.com", phone="+91 90000 00001"))
    ).json()
    rows = [
        'Asha Rao,asha.rao@gmail.com,098450 11111,Infosys,5 yrs 3 mo,12.5 LPA,30,"Java, SQL",',
        "Bad Email,not-an-email,9845011112,Wipro,3 yrs,10 LPA,15,Python,",
        "No Email,,9845011113,TCS,1 yr,5 LPA,0,Go,",
        "Known Person,KNOWN@gmail.com,9845011114,HCL,7 yrs,20 LPA,60,Java,",
        "Asha Again,asha.again@gmail.com,+91 98450 11111,Infosys,5 yrs,12 LPA,30,Java,",
        "Ravi Kumar,ravi.k@gmail.com,9845011116,Zoho,4 yrs,9 LPA,thirty,Java,",
    ]
    job = await _job(client, agency, _csv(rows))
    r = await client.put(
        f"/v1/imports/{job['id']}/mapping",
        headers=agency.h(),
        json={"mapping": {**job["mapping"], "Joined": None}},
    )
    r = await client.post(f"/v1/imports/{job['id']}/validate", headers=agency.h())
    assert r.status_code == 200, r.text
    rep = r.json()["report"]
    assert rep["rows"] == 6 and rep["valid"] == 3 and rep["invalid"] == 3
    assert any("Email" in k for k in rep["by_reason"])
    dups = {d["row"]: d for d in rep["duplicates"]}
    assert dups[5]["outcomes"][0]["check"] == "R-01.email"
    assert dups[5]["outcomes"][0]["link"]["id"] == existing["id"]
    assert (
        dups[6]["outcomes"][0]["check"] == "R-01.phone"
        and dups[6]["outcomes"][0]["link"]["row"] == 2
    )  # earlier row of the file
    errs = (await client.get(f"/v1/imports/{job['id']}/errors.csv", headers=agency.h())).text
    assert errs.splitlines()[0].endswith(",Reason") and "Bad Email" in errs and "thirty" in errs


async def test_load_resolves_duplicates_reconciles_and_undoes(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    existing = (
        await agency.create_candidate(
            candidate(email="known2@gmail.com", phone="+91 90000 00002", current_employer="Old Co")
        )
    ).json()
    rows = [
        'Asha Rao,asha.r2@gmail.com,098450 21111,Infosys,5 yrs 3 mo,12.5 LPA,30,"Java, SQL",',
        "Known Person,known2@gmail.com,9845021114,New Co,7 yrs,20 LPA,60,Java,",
        "Asha Twin,asha.twin@gmail.com,+91 98450 21111,Infosys,5 yrs,12 LPA,30,Java,",
        "Skip Me,skip.me@gmail.com,+91 98450 21111,Infosys,5 yrs,12 LPA,30,Java,",
        "Broken,broken,9845021117,X,1 yr,1 LPA,1,Go,",
    ]
    job = await _job(client, agency, _csv(rows))
    jid = job["id"]
    await client.put(
        f"/v1/imports/{jid}/mapping",
        headers=agency.h(),
        json={"mapping": {**job["mapping"], "Joined": None}},
    )
    await client.post(f"/v1/imports/{jid}/validate", headers=agency.h())
    no_reason = await client.put(
        f"/v1/imports/{jid}/resolutions",
        headers=agency.h(),
        json={"rows": {"4": {"action": "create"}}},
    )
    assert no_reason.status_code == 422
    r = await client.put(
        f"/v1/imports/{jid}/resolutions",
        headers=agency.h(),
        json={
            "rows": {
                "3": {"action": "update"},
                "4": {"action": "create", "reason": "Twins share a phone"},
                "5": {"action": "skip"},
            }
        },
    )
    assert r.status_code == 200, r.text
    r = await client.post(f"/v1/imports/{jid}/start", headers=agency.h())
    assert r.status_code == 202 and r.json()["state"] == "loading"
    done = await _finish(client, agency, jid)
    assert done["state"] == "done", done
    c = done["counts"]
    assert c == {"read": 5, "loaded": 2, "updated": 1, "skipped": 1, "failed": 1}
    assert c["loaded"] + c["updated"] + c["skipped"] + c["failed"] == c["read"]
    known = (await client.get(f"/v1/records/candidate/{existing['id']}", headers=agency.h())).json()
    assert known["data"]["current_employer"] == "New Co"
    asha = (
        await client.get(
            "/v1/records/candidate", headers=agency.h(), params={"f.email": "asha.r2@gmail.com"}
        )
    ).json()["items"][0]
    assert asha["data"]["phone"] == "+919845021111"  # E.164
    assert asha["data"]["total_experience"] == 63 and asha["data"]["expected_ctc"] == 1250000
    assert asha["data"]["skills"] == ["Java", "SQL"]
    hist = (await client.get("/v1/imports", headers=agency.h())).json()
    assert hist[0]["id"] == jid and hist[0]["file_name"] == "people.csv" and hist[0]["can_undo"]

    r = await client.post(f"/v1/imports/{jid}/undo", headers=agency.h())
    assert r.status_code == 200 and r.json()["state"] == "undone", r.text
    gone = await client.get(f"/v1/records/candidate/{asha['id']}", headers=agency.h())
    assert gone.status_code == 404
    known = (await client.get(f"/v1/records/candidate/{existing['id']}", headers=agency.h())).json()
    assert known["data"]["current_employer"] == "Old Co"
    again = await client.post(f"/v1/imports/{jid}/undo", headers=agency.h())
    assert again.status_code == 422


async def test_excel_files_and_reference_columns_by_name(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    from openpyxl import Workbook

    client_rec = (
        await client.post(
            "/v1/records/client", headers=agency.h(), json={"data": {"name": "Aurora Fintech"}}
        )
    ).json()
    wb = Workbook()
    ws = wb.active
    ws.append(["Title", "Client", "Status", "Positions", "Target date"])
    ws.append(["Java Lead", "aurora fintech", "Open", 2, "2026-12-01"])
    ws.append(["Data Engineer", "Nobody Inc", "Open", 1, "2026-12-01"])
    buf = io.BytesIO()
    wb.save(buf)
    fid = await _upload(client, agency, buf.getvalue(), "reqs.xlsx")
    r = await client.post(
        "/v1/imports", headers=agency.h(), json={"file_id": fid, "table": "requirement"}
    )
    assert r.status_code == 201, r.text
    job = r.json()
    assert job["mapping"]["Client"] == "client" and job["mapping"]["Target date"] == "target_date"
    await client.put(
        f"/v1/imports/{job['id']}/mapping", headers=agency.h(), json={"mapping": job["mapping"]}
    )
    rep = (await client.post(f"/v1/imports/{job['id']}/validate", headers=agency.h())).json()[
        "report"
    ]
    assert rep["valid"] == 1 and rep["invalid"] == 1
    await client.post(f"/v1/imports/{job['id']}/start", headers=agency.h())
    done = await _finish(client, agency, job["id"])
    assert done["counts"]["loaded"] == 1
    reqs = (
        await client.get(
            "/v1/records/requirement", headers=agency.h(), params={"f.client": client_rec["id"]}
        )
    ).json()["items"]
    assert [x["data"]["title"] for x in reqs] == ["Java Lead"]


async def test_imports_need_permission_and_files_must_be_clean(
    client: httpx.AsyncClient, agency: Agency, mailer: Any
) -> None:
    from tableui.files.public import EICAR
    from tests.test_workspace_admin import _team_mate

    rec, _ = await _team_mate(client, agency, mailer, "recruiter")
    fid = await _upload(client, agency, _csv(["A B,a.b@gmail.com,9845031111,X,1 yr,1 LPA,1,Go,"]))
    r = await client.post(
        "/v1/imports", headers=rec.h(), json={"file_id": fid, "table": "candidate"}
    )
    assert r.status_code == 403
    bad = await client.post(
        "/v1/files",
        headers=agency.h(),
        data={"kind": "import"},
        files={"file": ("x.csv", HEADER.encode() + EICAR)},
    )
    r = await client.post(
        "/v1/imports", headers=agency.h(), json={"file_id": bad.json()["id"], "table": "candidate"}
    )
    assert r.status_code == 422
    r = await client.post(f"/v1/imports/{uuid.uuid4()}/start", headers=agency.h())
    assert r.status_code == 404


async def test_unmatched_column_becomes_a_new_field_and_loads(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    job = await _job(
        client,
        agency,
        _csv(["Neel Shah,neel.shah@gmail.com,9845041111,Infosys,2 yrs,6 LPA,15,Go,01/02/2024"]),
    )
    r = await client.post(
        f"/v1/imports/{job['id']}/fields",
        headers=agency.h(),
        json={"header": "Joined", "label": "Joined on", "type": "date"},
    )
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["live"] is True and out["job"]["mapping"]["Joined"] == "joined_on"
    await client.post(f"/v1/imports/{job['id']}/validate", headers=agency.h())
    await client.post(f"/v1/imports/{job['id']}/start", headers=agency.h())
    done = await _finish(client, agency, job["id"])
    assert done["counts"]["loaded"] == 1
    rec = (
        await client.get(
            "/v1/records/candidate", headers=agency.h(), params={"f.email": "neel.shah@gmail.com"}
        )
    ).json()["items"][0]
    assert rec["data"]["joined_on"] == "2024-02-01"


async def test_submissions_file_is_checked_against_consent_and_repeat_entries(
    client: httpx.AsyncClient, agency: Agency
) -> None:
    """Rules that count other records (consent on record, one entry per candidate per requirement)
    run over a whole file: they used to crash the check with a server error."""

    async def make(table: str, data: dict[str, Any]) -> dict[str, Any]:
        r = await client.post(f"/v1/records/{table}", headers=agency.h(), json={"data": data})
        assert r.status_code == 201, r.text
        return r.json()  # type: ignore[no-any-return]

    cl = await make("client", {"name": "Aurora Fintech"})
    await make("requirement", {"title": "Java Lead", "client": cl["id"], "status": "Open"})
    for name, email in (("Asha Rao", "asha@gmail.com"), ("Ravi Kumar", "ravi@gmail.com")):
        c = await make("candidate", candidate(full_name=name, email=email, phone=None))
        if name == "Asha Rao":  # only Asha has agreed to be shared
            await make(
                "consent_record",
                {"candidate": c["id"], "purpose": "Share with clients", "status": "Given"},
            )
    csv = (
        "Summary,Candidate,Requirement,Stage\n"
        "Asha for Java Lead,Asha Rao,Java Lead,Sourced\n"
        "Ravi for Java Lead,Ravi Kumar,Java Lead,Submitted\n"
        "Asha again,Asha Rao,Java Lead,Sourced\n"
    )
    fid = await _upload(client, agency, csv.encode(), "subs.csv")
    r = await client.post(
        "/v1/imports", headers=agency.h(), json={"file_id": fid, "table": "submission"}
    )
    assert r.status_code == 201, r.text
    job = r.json()
    await client.put(
        f"/v1/imports/{job['id']}/mapping", headers=agency.h(), json={"mapping": job["mapping"]}
    )
    v = await client.post(f"/v1/imports/{job['id']}/validate", headers=agency.h())
    assert v.status_code == 200, v.text
    assert "R-02.consent" in v.text  # Ravi has no consent on record
    assert "R-03.duplicate" in v.text  # Asha is listed on the same requirement twice
    assert "starts at Sourced" in v.text  # a new entry cannot start further along
    await client.post(f"/v1/imports/{job['id']}/start", headers=agency.h())
    done = await _finish(client, agency, job["id"])
    assert done["counts"]["loaded"] == 1
    subs = (await client.get("/v1/records/submission", headers=agency.h())).json()["items"]
    assert [x["data"]["summary"] for x in subs] == ["Asha for Java Lead"]
