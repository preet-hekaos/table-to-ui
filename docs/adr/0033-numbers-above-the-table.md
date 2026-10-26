# 33. Numbers above the table

Status: accepted

## Decision
- A strip above the list shows how many records match the current search and, for number fields (whole number, decimal, money, duration), the average, lowest and highest, plus the total where a total means something (not for durations).
- `GET /v1/records/{table}/stats` computes them in the database over every matching record, not the loaded rows, with the list's own scope and filters. Totals and averages are never taken over a field the person may not see: asking for one is refused, and the automatic choice skips it.
- The owner picks the fields in Studio (Features, "Numbers above the table"), or leaves "Choose for me" (the first three number fields). The `statistics` switch is enforced on the server (403 when off).
- Numbers are exact: nothing is rounded beyond two decimals, and empty values are left out of averages.

## Consequences
No per-group totals yet (group headings show loaded counts). Custom formulas and charts stay in Insights, which has its own measures.
