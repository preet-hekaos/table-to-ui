# 41. Summary strip cards and whole-table numbers

Status: accepted

## Decision
- A table's "Numbers above the table" can now be set up in Studio as up to six cards, in order: how many records, a number field measured as Total, Average, Lowest or Highest, or how many records hold a value of a choice field (for example Status: Active). A card can have its own name. With no cards chosen, the strip stays automatic as before (Matching plus the first three number fields), so nothing existing changes.
- A "Whole table" switch makes the numbers ignore the search and filters. Off by default: numbers follow what is on screen. The strip says so when it is on. Record scope and hidden fields still apply: a card on a field a person may not see is left out for them.
- The setting is saved in the table features (`stat_cards`, `stat_scope`) and follows Draft, Test, Live like every other table feature. The stats endpoint returns `cards` (each with its number) and `scope`; the number is computed by the database over every matching record.
- Cards are large single numbers with a small name, set apart from the table card.
- Tests: API tests (chosen cards, follow search, whole table, refused bad cards, automatic mode unchanged) and a browser test through Studio and the live screen with contrast checks.

## Consequences
A value card counts exact matches of one value; ranges and several values are not offered yet. Per-person card choices are not part of this; the owner sets the strip for everyone.
