# ADR-11: Imports run through the command pipeline in batches

Status: accepted

## Context
Imports of 50,000 rows must finish within 15 minutes, apply the same rules as a single save, be reconciled and be undoable (M1-S08 to S10).

## Decision
- Rows are cleaned (money in LPA, months, Indian dates, E.164 phones, choices, reference names) and validated by the table's own validation.
- Duplicates are found by the table's rules in bulk: each context loader prefetches for the whole file and also matches earlier rows of the file, then the ordinary engine evaluates every row, so a file row and a form get the same answer.
- Loading uses `apply_batch`: 500 rows per transaction, one savepoint per row, each row still checked for permission, references and rules and written with history, audit and outbox. A block can be overridden only for named checks with a reason, and the override is audited.
- One import loads per workspace at a time; at most two run across the process. Every created and updated record is recorded so an undo within 7 days deletes exactly what was created and restores what was updated.

## Consequences
The runtime role may delete record rows (only the undo path does so); history keeps every deleted value.
