# 47. Every Studio setting must be proven live

Status: accepted

## Decision
- A register (`tests/live_effects/register.py`) lists every Studio setting with a level: `live` (proved by an end-to-end test against the published app), `server` or `gap`. A live entry must name its proof (`e2e:spec.ts::title`).
- A test fails when a setting is missing from the register, a proof does not exist, or the gap count goes above the budget. The budget was lowered stage by stage and is now 0; all 53 settings are live.

## Consequences
A control that only looks like it works cannot ship. New settings need a register line and a live scenario in the same change.
