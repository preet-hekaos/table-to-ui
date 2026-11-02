# S6 comparison: release, migration, full journey

| PRD item | Result | Proof |
|---|---|---|
| Old defaults become "if blank" rules | Done | tests/test_migration_s6.py |
| Every setting proven live, gap budget 0 | 53 of 53 live | tests/live_effects/register.py, test_live_effects_gate |
| Publish review in plain words, rollback | Done | tests/test_s6_release.py, review-in-words.png |
| Full journey Studio to recruiter to rollback | Passes | e2e/s6-journey.spec.ts, journey-recruiter-record.png |
| ADRs 47-52, builder guide | Done | docs/adr, docs/screens/studio-table/builder-guide.md |

Found by the journey: a field added and made Unique in one Draft failed on save after publish (fixed, tested).

Honest gaps: "Describe a field in words" (S4) not built; alternative import column names (import wizard) and per-role hiding (Roles screen) parked; check-existing stays a count, not a link.

Results: API 430 passed; web lint, types, 72 unit tests pass; e2e full run 86 specs, the 23 that failed once were an accessibility bug in the Features chip (fixed), two older specs expecting the pre-redesign layout (updated) and slow-run flakes (rerun: all passed).
