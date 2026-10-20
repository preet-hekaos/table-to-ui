# ADR-2: Schema per tenant plus row-level security

Status: accepted

## Context
Agencies need strong isolation; metadata-defined tables differ per tenant.

## Decision
Control plane in schema control; one t_<uuid> schema per tenant. Tenant sessions SET LOCAL ROLE tableui_runtime and RLS (FORCE) keys on app.tenant_id. The runtime role can only INSERT audit events.

## Consequences
A cross-tenant isolation suite runs in CI. Provisioning is behind a TenantProvisioner port.
