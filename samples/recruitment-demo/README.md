# Recruitment demo data

A believable recruitment agency in one set of files, so every screen shows what the product looks like in real use.

| Order | File | Table | Rows |
|---|---|---|---|
| 1 | `01-skills.csv` | Skills | 37 |
| 2 | `02-clients.csv` | Clients | 8 |
| 3 | `03-contacts.csv` | Contacts | 11 |
| 4 | `04-requirements.csv` | Requirements | 14 |
| 5 | `05-candidates.csv` | Candidates | 62 |
| 6 | `06-consent-records.csv` | Consent records | 96 |
| 7 | `08-submissions.csv` | Submissions | 67 |
| 8 | `09-interviews.csv` | Interviews | 24 |
| 9 | `10-offers.csv` | Offers | 6 |
| 10 | `11-placements.csv` | Placements | 3 |
| 11 | `12-tasks.csv` | Tasks | 24 |
| 12 | `13-interactions.csv` | Interactions | 36 |

## How to load

Use **Import** in the left menu, once per file, **in the order above** (a record can only link to something that already exists: contacts need clients, submissions need candidates and consent).

1. Pick the table in *Import into*, then drop the file in.
2. Every column should already be matched (headers use the field names). Click **Check the data**.
3. On Candidates you will see two possible duplicates. That is on purpose, it gives the *Duplicate candidates* screen something to show. Choose **Create** for both, with any reason, then **Load**.
4. Click **Load**.

If a file fails on a link ("no client called ..."), the earlier file was skipped; load that one first.

## What is in it

- 8 clients in every status, 11 contacts, 14 requirements (open, on hold, filled, closed) with budgets, notice limits and target dates.
- 60 candidates across backend, frontend, data, DevOps, QA, product and sales, with skills, experience, notice, current and expected pay, and sources; 6 archived.
- 67 submissions spread over every pipeline stage, with client feedback and rejection reasons; interviews, offers and placements follow from them.
- Overdue, due-today and upcoming tasks; calls, emails and meetings on candidates and clients; consent for everyone.
- 2 near-duplicate candidates (same person, new email and phone).

All names, companies and addresses are made up. `generate.py` rebuilds the files (`python3 generate.py`); change the seed or counts there.
