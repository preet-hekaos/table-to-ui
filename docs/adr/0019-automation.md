# ADR-19: Automations are metadata that run after a save, once, within limits

Status: accepted. Builds on [ADR-6](0006-analytics-store.md) (the outbox) and [ADR-18](0018-insights.md).

## Context
M4 lets a workspace say "when this happens, do that" without code: remind a recruiter, give them a task, tell a manager. People also need a place to see what needs them. Automations are powerful and easy to get wrong, so they must never slow or break a save, never run twice, never run away, and always leave a trail.

## Decision
- An automation is metadata (`AutomationDef`, a new kind in the Draft, manifest and releases): a trigger (a record is added, changed, a field becomes a value, or a date arrives, with days before or after), conditions, and up to five actions (create a record for someone, tell someone, set a field). `metadata/domain/automations.py` holds the one set of rules for the pack loader and the Studio builder. Pack automations can be renamed and switched off, never rewritten.
- Event triggers run from the outbox, after the save has committed. A saved record is never blocked, delayed or rolled back by an automation. Events now say which fields changed and carry a `depth`.
- Date triggers are checked hourly (`automation_clock` claims the check, so several API instances do not repeat it). A date trigger catches up only seven days back, so switching one on never floods anyone. A "before" trigger does not fire for a date already past.
- Once only: every run is keyed by (automation, record, trigger) and inserted with `ON CONFLICT DO NOTHING`. Redelivered events and repeated checks start nothing new. Event runs are keyed by event id; date runs by the date value.
- Each action that finished is recorded in the run, so a retry resumes after the last good action and never repeats work. Mail or database hiccups retry after 1, 5 and 30 minutes (three tries), then show as failed with a Retry button. A rule block, a validation error or a missing record fails at once with the reason; it will not pass on retry.
- Guardrails: a person's save may set off automations, and their changes at most one more level (events with `depth` above 1 are ignored); a workspace may run at most 2,000 automations a day (`automation_daily_cap`), after which admins are told once; every run is on record with what it did.
- Automations act as a system user with full permission, but every change still goes through the command pipeline (rules, history, audit, outbox), attributed to "Automation". A created record is owned by the person it is for.
- Email goes only to workspace members, through the existing mailer. People choose per kind (automations, tasks, approvals) whether they hear in the app, in the app and by email, or not at all, and whether to get one daily summary. The summary link to stop it is signed with `SIGNING_KEY` and works without signing in.
- "What needs me" reads the table the pack marks with `todo` (status field, done value, due date): the person's open to-dos, soonest first, and changes waiting for their decision. First steps per role and sample data come from the pack (`guides.yaml`, `samples.yaml`), served from the pack catalog; first steps tick themselves when the person has added a record to the named table. Sample records are created through the normal pipeline, tracked in `sample_batch`, and removed in one step.

## Consequences
- An automation may take a few seconds to act after a save (the relay runs every second); the Studio shows each run and its outcome.
- Condition checks for date triggers run in memory over at most 5,000 candidate records per automation per sweep, taken from the seven-day window. Measured: a first sweep over 100,000 records that started 753 runs took 18.4 s; a steady-state sweep took 2.2 s.
- A workspace that changes the pack's task table loses nothing: `todo` is part of the table's metadata and can be moved to another table in a later release.
- Roles are not yet validated against the workspace when an automation is saved through a pack update; the builder validates them.
