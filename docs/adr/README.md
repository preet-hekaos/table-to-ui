# docs/adr

| ADR | Decision |
|---|---|
| [1](0001-modular-monolith.md) | Modular monolith with enforced module boundaries |
| [2](0002-tenancy.md) | Schema per tenant with row-level security |
| [3](0003-rules-cel.md) | Business rules in CEL |
| [4](0004-command-pipeline.md) | One command pipeline for every write |
| [5](0005-releases.md) | Draft, Test and Live releases with immutable manifests |
| [6](0006-analytics-store.md) | Measures from a separate analytics store |
| [7](0007-identity-ports.md) | Identity behind ports |
| [8](0008-metadata-driven-ui.md) | UI generated from metadata with shared patterns |
| [9](0009-dev-infrastructure.md) | Development infrastructure |
| [10](0010-studio-edits-additive-ddl.md) | Studio edits land in the Draft; schema changes are additive only |
| [11](0011-imports-through-the-pipeline.md) | Imports run through the command pipeline in batches |
| [12](0012-search-and-matching.md) | Search in PostgreSQL; matching is a deterministic weighted score |
| [13](0013-files-and-document-reading.md) | Files are checked by content and scanned before anything reads them |
| [14](0014-effects-and-stages.md) | Stages and follow-on changes are metadata, applied in the same transaction |
| [15](0015-approvals.md) | Approvals hold a change; the decision applies it |
| [16](0016-duplicate-merge.md) | Merge removes the second record and keeps a snapshot for seven days |
| [17](0017-relationship-builder.md) | Links are reference fields; the builder composes the Studio's own operations |
| [18](0018-insights.md) | Insights are governed measures read from the analytics store; every number links to its records |
| [19](0019-automation.md) | Automations are metadata that run after a save, once, within limits; people choose how they hear |
| [20](0020-ai-assist.md) | AI proposes, rules and people decide; every call is gated, capped, checked and logged |
| [21](0021-chat-setup.md) | The AI plans from a fixed list of Studio operations; dry run, apply to Draft in one step, one-click undo |
| [22](0022-operator-console.md) | The operator sees counts, never contents; suspend, export, limit and two-step delete |
| [23](0023-stage-colours.md) | Stage colours are computed on the server and never carried by colour alone |
| [24](0024-canvas.md) | One canvas for tables and links: cards, ordered layout, details drawer, Cards/Graph switch |
| [25](0025-screens-in-tables.md) | Screens are managed inside each table; the Screens tab is gone |
| [26](0026-schema-import.md) | Schema import: readers for CSV, Excel, JSON and SQL; preview first, Draft tables after confirmation |
| [27](0027-table-features.md) | Table features: one settings block per table, all on by default, kept in the table definition |
| [28](0028-sort-and-filter.md) | Sort and filter in the list |
| [29](0029-select-and-bulk-actions.md) | Select rows and bulk actions |
| [30](0030-import-and-export.md) | Import and export |
| [31](0031-edit-in-the-list.md) | Edit in the list |
| [32](0032-group-rows.md) | Group rows |
| [33](0033-numbers-above-the-table.md) | Numbers above the table |
| [34](0034-drag-to-reorder.md) | Drag to reorder |
| [35](0035-export-schema.md) | Export schema |
| [36](0036-links-from-matching-values.md) | Links from matching values |
| [37](0037-schema-from-documents.md) | Schema from a document (PDF, Word, text), read by AI |
| [38](0038-collapsible-sidebar.md) | Collapsible sidebar: full, icon rail or hidden; Ctrl+B; full screen |
| [39](0039-table-card-and-numbered-pages.md) | Table card: numbered pages, columns menu, density, sticky columns |
| [40](0040-excel-style-column-filter.md) | Excel-style column filter: values with counts, search, select all, sort |
| [41](0041-summary-strip-cards.md) | Summary strip cards chosen in Studio; whole-table numbers |
