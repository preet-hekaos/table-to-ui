# ADR-10: Studio edits land in the Draft; schema changes are additive only

Status: accepted

## Context
Workspaces must change their own tables, fields, screens and menu without a code push (M1-S12 to S17), and nothing may change for users until it is published.

## Decision
- Every Studio edit writes the Draft (`metadata_object`) and, in the same transaction, any DDL it needs. DDL is additive only: a new record table, a nullable shadow column, an index. Field values live in the record's JSON, so adding a field never rewrites a table.
- Pack fields can be relabelled or hidden, never deleted or retyped; workspace fields can be removed from the Draft (values stay in history).
- Releases pin every object (tables, rules, measures, screens, menu entries) in an immutable manifest. A builder who is not an owner asks for Live; an owner approves.
- Preview runs the app as another role against Test or Live, read-only, and never grants more than the builder has (intersection of permissions, stricter row scope, union of hidden fields).

## Consequences
A physical table can exist before any release refers to it; it is invisible until published. Removing a column is never automatic.
