# ADR-5: Draft, Test, Live releases pinned by manifest hash

Status: accepted

## Context
Metadata edits must not change live behaviour unreviewed.

## Decision
Draft metadata publishes to an immutable Test manifest, is promoted to Live, and can be rolled back via release_deployment history.

## Consequences
Runtime reads only the pinned manifest.
