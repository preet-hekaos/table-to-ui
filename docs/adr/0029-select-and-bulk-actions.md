# 29. Select rows and bulk actions

Status: accepted

## Decision
- Lists get tick-boxes (per row, per page, and "all matching" when more rows match than are loaded). A bar shows the count and the allowed actions: export, change one field, delete.
- One endpoint, `POST /v1/records/{table}/bulk`. Each record goes through the same steps as a single command (permission, validation, references, rules, history, audit); a bad row never stops the others.
- "All matching" sends the search, not the ids, with the count the person saw. If the count has changed the server answers 409 and nothing happens. Up to 10,000 records at a time.
- The ids are re-read through the list's own scope and filter rules, so a bulk action cannot reach a record the person could not have ticked.
- The table's `select_bulk` and `bulk_actions` switches are enforced on the server. Delete also needs the role's delete permission; no built-in role except the owner has it.
- Undo: the server restores from the record history, only the caller's own latest change, within 15 minutes. A deleted record comes back under its own id.

## Consequences
Export of ticked rows uses the screen's shown columns, or every visible field when the table's bulk scope is "all". Import and export formats come in 5d.
