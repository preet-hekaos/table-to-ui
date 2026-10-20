# ADR-16: Merge removes the second record and keeps a snapshot for seven days

Status: accepted

## Context
Duplicate candidates must be merged by a manager, with every link kept, and undone if it was a mistake (M2-S23 to S26).

## Decision
- Pairs come from the rule's `fuzzy_match` loader: block on an exact field and first letter, score with trigram similarity then rapidfuzz, drop pairs a user dismissed.
- Merge needs `record.<table>.merge`. The kept record takes chosen field values from the other; references to the dropped record are repointed; the dropped row is deleted and its full snapshot and the repointed links are stored in `control.record_merge`. History is written on both records.
- Undo within seven days restores the kept record's earlier values, recreates the dropped row from the snapshot and repoints the stored links back, one by one. After that the merge is final.

## Consequences
Links created after the merge stay with the kept record on undo, because only the links stored at merge time are repointed.
