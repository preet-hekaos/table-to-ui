# 32. Group rows

Status: accepted

## Decision
- A "Group by" choice in the list toolbar groups rows by a select, yes/no, link or short-text field. A screen's Studio setting still starts the list grouped; the person can change or clear it while the list is open.
- Each group has a heading button (open and close, with the count) and the list has "Collapse all groups" and "Expand all groups". Closed groups hide their rows only; ticks and exports still cover them.
- Grouping asks the server to sort by the group field, so groups are whole. While more pages remain, a heading's count shows a plus sign ("3+") because later pages may add to it.
- While grouped, the group field decides the order; other columns' sort buttons wait until grouping is cleared.
- The table's `grouping` switch turns the whole thing off, including a screen's own default grouping.

## Consequences
Counts are for loaded rows. Exact totals per group would need a second count query per group and are left for statistics (5g).
