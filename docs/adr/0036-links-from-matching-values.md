# 36. Links from matching values

Status: accepted. Extends [ADR-26](0026-schema-import.md).

## Decision
- When files with rows are imported, a column whose values (almost) all appear in another table's unique text column is suggested as a link to that table, with the reason shown ("values match Clients Client name"). Example: a Company column holding client names.
- Rules: at least 90% of the column's distinct values must appear in the other table's column; spacing and capital letters are ignored; only text-like columns are compared, never numbers (two columns of 1, 2, 3 never link); a unique column is treated as a key, not a link; if two tables match equally well, nothing is suggested.
- It is only a suggestion, like the name-based and foreign-key links: the person ticks or unticks it in the preview before anything is created. Name-based, foreign-key and `$ref` links win when present.
- The values are compared in memory while the file is read (up to 50,000 rows per column) and are not sent to the browser or stored.

## Consequences
SQL files carry no rows through `INSERT` (only counted), so they rely on foreign keys as before. Compound keys and values split by commas are not matched.
