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
