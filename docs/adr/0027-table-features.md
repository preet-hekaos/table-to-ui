# ADR-27: Table features are one settings block per table, on by default

Status: accepted. Builds on [ADR-24](0024-canvas.md) and [ADR-25](0025-screens-in-tables.md). First part (5a) of the table building blocks.

## Context
Sorting, filtering, bulk actions, import and export, inline edit, grouping, statistics and manual row order are things every table should offer, but a workspace owner must be able to keep only what a table needs.

## Decision
- A table definition may carry a `features` block: `sort_filter`, `select_bulk` (with `bulk_actions` and `bulk_scope` of shown columns or every field), `import_data`, `export_data` (with `export_formats` and `export_email`), `inline_edit`, `grouping`, `statistics` and `row_order`. Yes/no where that is enough, extra options only where the feature needs them.
- The block is empty (`null`) until someone customises the table, and a table with no block has every feature on. Existing manifests, releases and hashes are therefore unchanged. Setting the same values again creates no Draft change.
- Because the block lives in the table definition, it moves Draft, Test, Live like any other table change and shows in the colour coding and the Versions comparison.
- `PUT /v1/studio/tables/{table}/features` sets one table; `PUT /v1/studio/features` applies the same settings to every table. Both need Studio edit permission and are audited.
- Studio: a **Features** part beside Fields and Screens, with the switches and options, **Save**, **Apply to all tables** and **Switch everything on**. Each switch says "Takes effect in an upcoming update" until its part ships; the list of live features is a single set in the code.
- The records list gets a slim toolbar (what is shown on the left, tools on the right). The existing table pattern remains the one shared table; later parts add their tools to the toolbar.

## Consequences
- Nothing about a list's behaviour changes in this part, apart from the toolbar line.
- Each later part must enforce its feature on the server as well as on the screen.
