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
