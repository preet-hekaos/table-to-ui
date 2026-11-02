# 51. Unique, Searchable and Filterable after a field exists

Status: accepted

## Decision
- The Draft records the switch; the data work runs at publish in one transaction: Unique checks for duplicates (and blocks, listing them) then builds the comparison column and index; Searchable rebuilds search text; Filterable adds or drops the lookup index.
- A field added and switched on within the same Draft is treated as switched from off, so it gets its column and index at publish (fixes a 500 on save found by the full journey test).
- Filters are refused by the server when Filtering is off; sorting is display-only.
