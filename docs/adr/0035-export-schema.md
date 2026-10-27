# 35. Export schema

Status: accepted

## Decision
- Studio has an "Export schema" button on the Canvas and Tables tabs. It downloads the Draft's tables, fields and links, with no records, as JSON Schema, SQL (`CREATE TABLE` with foreign keys and `CHECK` lists for choices) or a field list (CSV, opens in Excel).
- The person can pick which tables to include. Anyone who can read the Studio can export; nothing is changed, so nothing is written to the audit log.
- JSON and SQL read back through Import schema. The JSON carries `x-field-type` so types such as money and duration survive the round trip; Import schema honours it. A JSON Schema made only of `$defs` (no root properties) is now read as one table per definition.
- Text in the CSV that a spreadsheet could run as a formula is prefixed with an apostrophe.

## Consequences
Rules, stages, automations and screens are not part of the file, only the data shape. Field labels come back as the key written in title case (a label such as "Fee (% of annual CTC)" is renamed on re-import, the key is kept).
