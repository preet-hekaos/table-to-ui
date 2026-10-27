# ADR-26: Schema import reads files, shows a preview, and creates Draft tables only after confirmation

Status: accepted. Builds on [ADR-10](0010-studio-edits-additive-ddl.md) Studio edits and [ADR-23](0023-stage-colours.md).

## Context
A client who already has a schema (a spreadsheet header, a SQL file, a JSON Schema) had to rebuild every table and field by hand.

## Decision
- A pure reader per format returns one common proposal: tables, fields (type, required, choices), suggested links, row counts and plain-word warnings. Formats: CSV (one table), Excel (one table per sheet), JSON (a list of objects, an object of lists, or a JSON Schema with `$defs`) and SQL (`CREATE TABLE`, `INSERT` counted only). The SQL is parsed with sqlglot and never run. Excel formulas are read as their stored values, never calculated.
- `POST /v1/studio/schema-import/preview` saves nothing. `POST /v1/studio/schema-import/apply` creates the confirmed tables through the same Studio commands as a hand-made table (so audit, Draft staging and checks are unchanged), all or none. Both need `metadata.write`.
- Limits: 5 MB per file, 10 files, 50 tables, 200 fields per table, type detection on the first 1,000 rows, zip-bomb guard on Excel, SQL statement cap. Names are cleaned into safe keys and a name already in use is renamed in the preview.
- Links come from `*_id` column names, SQL foreign keys and JSON Schema `$ref`; the person ticks them in the preview. Links from matching values are suggested too (see [ADR-36](0036-links-from-matching-values.md)).
- Rows are not loaded by the schema import. Records can only be written to a table that is Live, so a table that came with data says "Schema + N rows" and, once published, its empty list offers **Import data**, which opens the existing import wizard with its row checks, bad-row report and duplicate handling.
- PDF and free-text schema documents are a later step (read by AI, shown as a proposal, never applied without review).

## Consequences
- One new dependency, sqlglot (MIT).
- The data in a schema file is loaded in a second step after publishing. That is deliberate: the same checks apply to every record that enters a workspace.
