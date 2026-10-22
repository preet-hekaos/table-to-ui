# ADR-22: The operator sees counts, never contents

Status: accepted. Builds on [ADR-2](0002-tenancy.md) tenant isolation (schema per workspace, row security) and the separate operator realm.

## Context
M6 gives the service owner a console to create, suspend, export, limit and delete client workspaces. The operator is a different kind of user from a workspace member: they run the service, they do not work in a client's data.

## Decision
- The console returns **counts and settings only** (people, records, storage, last activity, status, limits). No endpoint under `/v1/ops` returns record contents. Reading a client's data stays impossible for the operator by construction, not by policy.
- **Status** is `provisioning | active | suspended | scheduled_deletion`. `authenticate` and `sign_in` check it on every request, so a suspension takes effect on the next request and needs no session clean-up. A suspended or scheduled workspace answers 403 `workspace-suspended`.
- **Delete is two steps**: suspend first, then schedule with the exact workspace name, a reason and a grace period (default 7 days, 0 to 90). It can be canceled until the period ends; the workspace then returns to suspended. `purge_due` (CLI `tableui-ops purge-due`, or the maintenance endpoint) erases everything: control rows are found by their `tenant_id` column rather than a hand-kept list, so a table added later is purged too; the tenant schema is dropped; analytics facts and uploaded files are removed. One platform audit line with no tenant remains. An automated test asserts no row, schema, fact or file is left.
- **Export** is initiated by the operator with a reason, built as one zip (`app-definition.json`, one CSV per table, the uploaded files), stored, and the link is **emailed to the workspace owner**; the link expires in 24 hours and the token is its own credential. The operator does not receive the data.
- **Limits** (people, records, storage, monthly AI tokens) are per workspace and block only the new thing: invitations, new records, uploads. Editing and reading continue. AI tokens reuse the existing monthly cap.
- **Remove a person** is an owner action: the person is signed out, deactivated and their email is released; their name stays on history. Not yourself, not the last admin.
- The list stays fast by turning JIT off for its one query (the planner prices the per-workspace subqueries high enough to trigger a half-second compile) and by counting records per workspace concurrently, reusing a count for 30 seconds.

## Consequences
- The overview record count can trail a write by up to 30 seconds; limits and exports count exactly.
- One login per workspace holds in M6 (the same email cannot join two workspaces); the operator's account is a separate realm.
- Billing, custom domains, branded emails and the operator opening a client workspace are out of scope.
