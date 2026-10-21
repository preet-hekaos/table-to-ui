# Benchmarks (M0)

Both scripts live in `apps/api/scripts`; raw results are the JSON files here.

## CEL rules (M0-S21) — `cel-m0.json`
1,000 compiled rules, 100,000 evaluations. **p99 33 µs per evaluation** (p50 9 µs, one outlier at 1.35 ms) against a 1 ms target: passes, so no fallback engine ADR is needed. Evaluating all 1,000 rules against one record takes p50 8.9 ms, p99 14.9 ms.

## Load baseline (M0-S21) — `load-m0.json`
50 virtual users for 10 minutes against one API process: 70% list, 20% open, 10% create (rules, history, audit and outbox all run).

| | requests | p50 | p95 | p99 |
|---|---|---|---|---|
| list | 56,543 | 195 ms | 403 ms | 545 ms |
| open | 16,045 | 194 ms | 401 ms | 539 ms |
| create | 8,098 | 231 ms | 438 ms | 590 ms |

80,686 requests, **0 errors**, 134 requests/s sustained, 8,098 records created.

Read this as a floor, not a capacity claim: the API (one uvicorn worker), Postgres, the web dev server and the load generator all shared one small sandbox, so latency here is mostly queueing on a single worker. The same script will be re-run against AWS dev once it exists, with several API replicas, and that run becomes the real baseline.

## M1 gates (M1 PRD section 5) — `m1.json`
`apps/api/scripts/bench_m1.py`: one fresh recruitment workspace, 50,000 candidates imported through the import API (then 200 sequential samples per gate). API, Postgres and generator share one small sandbox, so treat this as a floor; the run is repeated on AWS dev once it exists.

| Gate | Target | Measured | |
|---|---|---|---|
| Screen load (navigation, screen, table, first 50 rows, facets, in parallel) | p95 < 800 ms | **p95 602 ms** (p50 492) | pass |
| Saving a record | p95 < 300 ms | **p95 29 ms** | pass |
| Lists and filters | p95 < 600 ms | **p95 73 ms** | pass |
| Keyword search (fields and CV text, typos) | p95 < 500 ms | **p95 54 ms** | pass |
| Import 50,000 rows | < 15 min | **14 min 38 s** end to end (load 14 min 8 s), 0 failed | pass, narrowly |
| 200,000-row file accepted | accepted | profiled and validated, 200,000 valid | pass |
| Command bar (S24) | < 300 ms | **p95 109 ms** | pass |

Not a PRD gate, but worth knowing: ranked matches over 34,266 candidates that pass the hard filters take p95 2.0 s. It is fine for a screen opened once per requirement; narrowing candidates in SQL before scoring is the obvious next step if recruiters find it slow. The import is close to its limit, so a slower disk on AWS dev could breach 15 minutes; batch size is the first thing to tune.

## M2 gates (M2 PRD section 5) — `m2.json`
`apps/api/scripts/bench_m2.py`: one fresh recruitment workspace with 500 submissions, then 50,000 candidates imported through the import API. API, Postgres and generator share one small sandbox, so treat this as a floor.

| Gate | Target | Measured | |
|---|---|---|---|
| Pipeline board, 500 cards (counts for all, 25 cards per stage sent) | p95 < 800 ms | **p95 68.5 ms** | pass |
| Stage move | p95 < 300 ms | **p95 23.8 ms** | pass |
| Approvals inbox | p95 < 600 ms | **p95 11.6 ms** | pass |
| Pipeline filtered to one requirement | p95 < 600 ms | **p95 84.8 ms** | pass |
| Duplicate list over 50,000 candidates | < 3 s | **p95 562.4 ms** (p50 480.9) over 10 calls | pass |
| Merge with 100 linked records | < 5 s | **0.11 s** | pass |

The duplicate list was 10.5 s before a trigram index and a smaller scan cap (150 rows). The index is created for new tables only; workspaces created before M2 would need it added. Pairs are the first matches found, best first within that scan, not a global ranking.

## M2.5 gate — `m25.json`
`apps/api/scripts/bench_m25.py`: 100 tables and 518 links in one workspace, Relationships list, 50 sequential calls.

| Gate | Target | Measured | |
|---|---|---|---|
| Relationships list, 100 tables and 500 links | p95 < 600 ms | **p95 177.2 ms** (p50 94.6) | pass |

## M3 gate — `m3.json`
`apps/api/scripts/bench_m3.py`: 100,000 records in the analytics store, 9 measures, 30 sequential calls each.

| Gate | Target | Measured | |
|---|---|---|---|
| Insights dashboard, 9 cards over 100,000 records | p95 < 1 s | **p95 396.8 ms** (p50 263.2) | pass |
| One card (bars by stage) | n/a | p95 61.2 ms | |
| Drill-down to the records behind a number | n/a | p95 58.3 ms | |
