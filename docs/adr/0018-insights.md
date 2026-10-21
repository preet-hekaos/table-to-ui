# ADR-18: Insights are governed measures read from the analytics store

Status: accepted. Builds on [ADR-6](0006-analytics-store.md).

## Context
M3 turns the single "Active candidates" count into a dashboard: totals, averages, bars by stage, trends over time, a date range, and a click-through to the records behind every number. Admins add measures without a developer, and every number must be checkable.

## Decision
- A measure stays metadata (`MeasureDef`): a table, an aggregate (count, sum, average, distinct), an optional field, filters, and at most one shape (one number, bars by a choice field, or a trend per day, week or month). `metadata/domain/measures.py` holds the one set of rules that both the pack loader and the Studio's builder use, so a mistake reads the same everywhere.
- Measures read only from `fact_record` in the analytics store. Field and table keys are validated metadata keys; every value is a bound parameter. The store now keeps each record's owner and creation time, so own and own-team scopes apply to numbers exactly as they do to lists.
- Every number has a drill-down (`GET /v1/measures/{key}/records`) that selects record ids from the same store with the same filters, scope and dates, then loads those records through the normal list path. The count on the card and the count in the list come from one query, and a test checks they match.
- Facts stay in step with live records: creates and updates carry owner and creation time; deletes (a merge, an import undone) emit a delete event.
- The store can be rebuilt from live records (`POST /v1/measures/rebuild`, and automatically once per newly live version). A rebuild reads each live table once, read-only, and is the only path where Insights touches operational tables. A test deletes the facts, rebuilds, and requires identical numbers.
- The builder switches on Insights for the fields a measure uses. Pack measures can be renamed, hidden, moved and put on Home, never changed in meaning; Home shows at most four.

## Consequences
- Numbers may lag by seconds after a change; the page shows an as-of time.
- A measure over a field that was not previously switched on shows its numbers after the app goes Live, when the rebuild fills in existing records.
- Preview in the builder needs the table and its fields to be live; otherwise it explains why and what happens on publish.
- "Average days from submission to placement" is not offered: it needs a value from two tables per record. The pack ships average offer CTC and placement fees instead.
