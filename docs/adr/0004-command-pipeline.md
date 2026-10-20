# ADR-4: One command pipeline with outbox and hash-chained history

Status: accepted

## Context
Every write needs rules, idempotency, history, audit and events to agree.

## Decision
authorise, validate, claim idempotency key, load context, evaluate rules, then a single transaction writes record, history (hash-chained), audit and outbox. A unique-index backstop reports a race loss as the same rule outcome.

## Consequences
Relay is at-least-once; consumers (analytics projector) are idempotent.
