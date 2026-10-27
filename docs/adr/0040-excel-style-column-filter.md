# 40. Excel-style column filter

Status: accepted

## Decision
- The filter button on a column heading opens one menu: sort (A to Z, Z to A; smallest, oldest for numbers and dates), then the filter.
- Text, choice, tag and reference columns show a list of the values the column holds, with counts, a search box, Select all, and Apply / Cancel / Clear. Nothing narrows until Apply. Typing in the search box and applying uses the typed result as the choice, as Excel does. Text columns also have a Contains tab. Numbers and dates keep From/To, Yes/No keeps its radio buttons.
- Counts come from the server (`GET /v1/records/{table}/values/{field}`), under the rest of the search but not this column's own choice, so every value stays listed after one is picked. The list is alphabetical and capped at 200 values; when more exist the menu says so, nothing starts ticked, and the person types to narrow (or uses Contains for text).
- Ticked values are sent as `in.<field>=a,b,c` (up to 200). Text columns match ignoring case. An empty choice is not applied: Apply waits until at least one value is ticked, and Clear removes the filter.
- Chips show the names of references, not their ids. Hidden columns and fields a role may not read have no list (refused with a 422).
- Tests: API tests for the list, search, cap, case-insensitive match and refusals; a browser test with contrast checks on the menu.

## Consequences
A column with more than 200 distinct values cannot be filtered by ticking all but a few. The server cannot express "everything except"; Contains covers text, narrowing by search covers the rest.
