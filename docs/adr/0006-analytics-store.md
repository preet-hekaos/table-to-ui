# ADR-6: Separate analytics store

Status: accepted

## Context
Insights must not load or lock operational tables.

## Decision
A second database fed by the outbox projector; measures read only from it.

## Consequences
Insights may lag by seconds; this is displayed.
