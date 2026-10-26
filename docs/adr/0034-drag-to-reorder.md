# 34. Drag to reorder

Status: accepted

## Decision
- Each table has one shared manual order, stored in a nullable `sort_order` column on the record table (added to existing tables by migration 0014). Records never moved sort after moved ones.
- A "Custom order" switch in the list toolbar turns on the `manual` sort. It shows a handle on each row: drag it, or focus it and press the up and down arrow keys. Moves are announced to screen readers. Grouping and header sorting are off while it is on.
- `POST /v1/records/{table}/order` moves one record before another (or to the end). It needs the `row_order` switch, update permission and the record in the person's scope. The first move numbers every record; later moves take the midpoint between neighbours and renumber only when the gap gets too small. The table is locked for the move so two people cannot interleave.
- A move does not change the record's version, and is written to the audit log (`record.reorder`).

## Consequences
The order is shared by everyone, not per person. Dropping at the very end is not offered while more rows are still to be loaded. Measured on 10,000 records: first move about 0.5 s, later moves about 20 ms.
