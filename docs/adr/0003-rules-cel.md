# ADR-3: Business rules as CEL, evaluated deterministically

Status: accepted

## Context
Business logic must be deterministic, auditable and not AI-dependent.

## Decision
Rules are YAML metadata with CEL conditions compiled once (Rust-backed cel). Context loaders (normalised match, fuzzy match) run before evaluation; evaluation is pure.

## Consequences
Benchmark (docs/benchmarks/cel-m0.json): p99 33 microseconds per evaluation, far under the 1 ms target, so no fallback engine is needed.
