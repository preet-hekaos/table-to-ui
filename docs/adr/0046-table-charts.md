# 46. A chart above the table, and even summary cards

Status: accepted

## Decision
- A table's "Numbers above the table" can be shown as summary cards (as before) or as a chart. The owner chooses in Features ("Show numbers as"), sets the starting chart (type, group by, date period, one or two measures, how many groups) and can leave fields out of charts in a Chart column of the field options.
- The chart is hand-drawn SVG, with no chart library: six types (bars with a line, bars, horizontal bars, line, area, donut), animated, with a tooltip, a legend that switches series off, a table view of the same numbers and a text summary for screen readers.
- Anyone can change what the chart groups by, measures and how it looks on the screen. Those choices are kept per user in the browser; the owner's chart applies until they change it.
- Clicking a group filters the table below with the same filter chips as everywhere else; the chart ignores the filter its own bars make so the other groups stay visible. Dates filter by the period clicked (needs Filtering on).
- `GET /v1/records/{table}/chart` groups on the server over everything the search matches: select, text, yes/no and date fields (day, week, month); count, total or average of number fields. The top groups are kept and the rest are folded into "Others". Hidden fields, fields left out of charts and tables whose chart is off are refused.
- Summary cards show a name and one number, on one grid of equal columns: one row up to four cards, then two rows of three.

## Consequences
No new dependency and no extra weight on tables that use cards. A second measure is drawn as a line on its own axis in bars-and-line, line and area charts; bars, horizontal bars and donut show the first measure only.

## Update (R11): numbers settings moved to the table screen

The Studio Features tab no longer has the Defaults row or the chart/card editors. Each person chooses cards or a chart, "Whole table", chart type, group by, measures and groups shown on the table screen itself (remembered per browser). The chart endpoint is available whenever Numbers above the table is on in the field options; it no longer needs `stat_view = chart`. Values already saved by an owner (`stat_view`, `chart`, `stat_cards`, `stat_scope`, `density`, `default_sort`) still apply as the starting point. With no saved chart, it groups by a choice field first, not by name.
