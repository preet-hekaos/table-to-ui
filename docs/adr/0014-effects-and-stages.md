# ADR-14: Stages and follow-on changes are metadata, applied in the same transaction

Status: accepted

## Context
M2 needs pipeline stages with allowed moves, and changes that follow from a save: a declined offer sends the submission back to Interview, a joined placement fills a requirement. Core code must stay free of recruiting words.

## Decision
- A table may declare `workflow`: the stage field, stages (label, final or not, fields to ask for on entry) and allowed moves. Moves outside the list are refused by a generated rule (R-05) that names the allowed ones.
- A table may declare `effects`: when a record is created or updated (and a field changed to a value), set fields on a referenced record, optionally after a count over its siblings. They run inside the same transaction as the triggering write, are written to history as `effect:<id>` and to the audit log, and bypass transition rules because the pack author wrote them.
- Stage moves are ordinary updates through the command pipeline (ADR 4), so rules, history, audit and idempotency apply unchanged. The board is a screen pattern over the stage field.
- Agencies may rename stages and add a stage after another in the Studio; stored values never change. They may change the severity of checks the pack marks `editable`; pack fixtures skip checks an agency has edited.

## Consequences
Stage names in pack fixtures stay stable. Removing or reordering stages is deliberately not offered. Effects are not recursive beyond one level, so a chain of effects needs an explicit second effect.
