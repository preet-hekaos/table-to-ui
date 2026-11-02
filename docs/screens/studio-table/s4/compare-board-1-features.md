# Board 1, Features column and toolbar (S4) — mockup vs built

| Mockup element | Built | Proof |
|---|---|---|
| Features column: up to 3 chips, +N, caret | Yes | s4/after-fields-tab.png, e2e S4.1 |
| Dropdown "Features of this field" with the 11 ticks (Shown in the list … Searchable), each with a one-line meaning | Yes | s4/after-dropdown.png, e2e S4.1 |
| Greyed items when the table-wide switch is off, with the reason | Yes | e2e S4.1, r7 |
| Opens on click or Enter, closes on Esc/outside click, keyboard operable | Yes (native checkboxes) | e2e S4.1 |
| Toolbar "Table-wide" switches (Sorting, Filtering, Edit in the list, Group rows, Export data, Select rows, Numbers above the table) | Yes; same stored flags as the Features tab | e2e S4.1 |
| "Search fields" box | Yes | built, filters rows by name or label |
| Field options grid removed from the Features tab | Yes | e2e r6, r7 |
| Unique: duplicates block the publish and are listed | Yes | s4/after-unique-blocked.png, e2e S4.3, API tests |
| Searchable: old records re-indexed at publish | Yes | e2e S4.4, API test |
| Filterable: one meaning (field flag + table list set together) | Yes | API test |

## Differences
- The dropdown reuses the popover style of the Validation cell, not the candidate Skills chip component (that one is a display badge, not a menu).
- Table-wide switches read "Sorting On" with a tick instead of a green dot.
- Not in this stage: "Describe a field in words" button (mockup top right) and the Transformation column (S5).

## Not yet a screen-level second-user scenario
Shown, Sortable, Editable, Groupable, Exportable, Bulk edit, Summary, Chart axis, Filterable: the Studio side is covered by e2e (n5*, r5) and server tests; S6 turns them into second-user scenarios (gap register).
