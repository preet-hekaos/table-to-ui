# 28. Sort and filter in the list

Status: accepted

## Decision
- Every list column gets a heading filter button that fits the field: text contains, choices, yes/no, number and date ranges. Active filters show as chips that can be removed one by one.
- The server understands `c.<field>` (contains), `in.<field>` (any of), and date ranges in `r.<field>`. These are refused when the table's `sort_filter` feature is off.
- Fields a role cannot see can neither be sorted nor filtered by that role (422). This is enforced on the server.
- Per field, the owner can switch sorting or filtering off, and pick a default order. These are stored in the table's nullable `features` block, so existing manifest hashes do not change.
- Per-field switches are UI configuration: sorting a field a person may see leaks nothing.

## Consequences
Saved searches keep the new criteria. "Apply to all tables" drops field names a table does not have.
