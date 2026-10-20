# ADR-1: Modular monolith with enforced boundaries

Status: accepted

## Context
One small team; an industry-neutral core must stay separable from industry packs.

## Decision
A single FastAPI deployable split into modules. Other modules may import only a module's public.py; layers are api > adapters > application > domain. import-linter enforces 19 contracts in CI.

## Consequences
Microservice cost is avoided; modules can be extracted later along the same seams.
