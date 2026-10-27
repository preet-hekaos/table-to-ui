# 42. Field grid in Studio, and the owner's table defaults

Status: accepted

## Decision
- Studio's table features gain one grid with a row per field. Ticked means people may do it; everything starts ticked, so nothing existing changes. Columns: Shown by default, Sort, Filter, Edit in list, Group, Export, Bulk edit, In summary (number fields). A Row density choice (Compact or Comfortable) sits beside it.
- Settings are saved in the table features (`default_columns`, `density`, `uneditable`, `ungroupable`, `unexported`, `nobulk`, plus the existing `unsortable`, `unfilterable`, `stat_fields`) and follow Draft, Test, Live.
- The server enforces the limits that matter, not just the screen: an export that asks for an unexported field is refused (422), and a bulk change on a no-bulk field is refused. Unknown or removed fields are trimmed when settings are applied to all tables.
- The owner's default columns win over the pack screen's own column list on the table's main list. The title always shows, since it opens the record.
- A person's own choices still sit on top: columns they hide or add (new "N changed" badge and a reset in the Columns menu) and a density they pick override the owner's default, for them only.
- The automatic summary strip is restyled as tiles: a Matching tile plus one tile per number field, the average large, total and range small.

## Consequences
The grid's "automatic" Shown ticks use the first six fields; a pack screen with its own list may differ until the owner saves a choice. Tests: API tests for the new limits, and a browser test through Studio and the list with contrast checks.
