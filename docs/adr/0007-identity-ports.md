# ADR-7: Identity behind ports, local adapter first

Status: accepted

## Context
WorkOS access is not available yet.

## Decision
OrganisationProvider and TenantProvisioner are ports; a local adapter (scrypt, TOTP, opaque sessions with 30-minute idle timeout, lockout after 5 failures in 10 minutes) stands in. Operator realm requires MFA.

## Consequences
Swapping in WorkOS touches one adapter.
