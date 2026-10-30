# Recruitment demo data

A believable recruitment agency, so every screen shows what the product looks like in real use:
8 clients, 11 contacts, 14 requirements, 62 candidates, 68 submissions across every pipeline stage,
25 interviews, 7 offers, 3 placements, 24 tasks, 36 interactions, consent records and 37 skills.
All names, companies and addresses are made up.

## Load it (recommended): one command

Use a **new** Recruitment workspace (the script stops if clients already exist).

```
cd apps/api
uv run python ../../samples/recruitment-demo/seed.py --email you@company.com --password "your password"
```

- The API must be running (default `http://127.0.0.1:8000`; use `--api` for another address).
- If your account has two-step sign-in on, add `--code 123456` with the current code.

It goes through the app's own API and follows the business rules in order, so the data looks like real
use: submissions start at Sourced and move stage by stage, interviews come before offers, a placement
closes its submission and fills the requirement, and filled or closed requirements are marked last.

## Or upload the simple tables by hand

Use **Import** in the left menu, once per file, in this order (a record can only link to something that
already exists): `01-skills.csv`, `02-clients.csv`, `03-contacts.csv`, `04-requirements.csv`,
`05-candidates.csv` (two possible duplicates are flagged on purpose: choose **Create** for both),
`06-consent-records.csv`. Then stop: the pipeline files (`08` to `11`) are for the script. The app only
lets a new submission start at Sourced, so Import will refuse later stages. Tasks (`12`) and
interactions (`13`) can be uploaded after the pipeline exists.

`generate.py` rebuilds all the files (`python3 generate.py`); change the seed or counts there.
