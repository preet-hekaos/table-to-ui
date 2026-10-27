# 44. Features tab layout and separate Sorting and Filtering

Status: accepted

## Decision
- The Features tab has three parts in one spacing scale: "For the whole table" (Select rows and bulk actions, Export data, Import data, Drag to reorder), "Defaults" (default order, row density, the numbers above the table), and "Field options".
- In Field options, each column heading holds the on/off chip for that option across the whole table (Sorting, Filtering, Edit in the list, Group rows, Numbers above the table). When it is off, every chip in the column is greyed and says what to turn on first; the chips keep their settings. Export and Bulk follow the Export data and Select rows cards instead of having a second switch.
- Sorting and filtering were one stored switch. They are now two (`sortable`, `filterable`). The old `sort_filter` still applies: a table that had it off reads as both off. The server refuses new filters when filtering is off; sorting stays enforced on screen as before.
- A save bar sticks to the bottom with an "N unsaved changes" count. Wording describes the product ("Group rows", "Each user can still choose their own"), not what people are allowed to do.

## Consequences
The per-field choices stay a list of fields left out, so a field added later starts with every option on, while a switched-off option stays off.
