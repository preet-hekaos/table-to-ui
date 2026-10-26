# 31. Edit in the list

Status: accepted

## Decision
- A cell becomes an input on double-click, or Enter / F2 when focused. Enter saves, Escape leaves it as it was, leaving the cell saves a change.
- A save is the ordinary update command (`PATCH /v1/records/{table}/{id}` with the row's version), so permissions, validation, rules, duplicate checks, history and audit are exactly those of the full form. A rule that blocks, or a bad value, shows its message in the cell and keeps the editor open. A stale version refreshes the list and says someone else changed the record.
- Not edited in place: the title (it opens the record), long text and links to other tables. Hidden fields are never shown, so they cannot be edited.
- The table's `inline_edit` switch, and the person's update permission, decide whether cells are editable. The switch is screen behaviour: the server has one update path, so turning it off does not block the full form.

## Consequences
Clearing a value stores it as empty (shown as "Not set"). No optimistic update: the list refreshes from the server after each save.
