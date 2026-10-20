# ADR-8: UI generated from metadata with shared patterns

Status: accepted

## Context
UI quality is the priority and must scale across tables and industries.

## Decision
Forms, lists and detail pages render from /v1/app/tables/{table} using design-system patterns with eight shared states, tokens from the approved palette, and axe checks in unit and end-to-end tests.

## Consequences
No per-table screens in M0; new tables appear without frontend changes.
