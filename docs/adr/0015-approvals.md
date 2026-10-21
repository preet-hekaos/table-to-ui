# ADR-15: Approvals hold a change; the decision applies it

Status: accepted

## Context
Offers above budget, fees below the agency floor and rule overrides need a second person (M2-S19 to S22).

## Decision
- A rule check with severity `approval` makes the command return 409 `approval-required` with the checks. The user may request approval, which stores the intended create or update (data, version, checks) in `control.approval`. Nothing is written to the record yet.
- A manager or admin approves or rejects. Rejection needs a note. The requester cannot decide their own request. Approving replays the held change through the command pipeline as the requester with the approved checks marked passed, so history and audit show both people. If the record changed since the request, the approval fails with a version conflict and the requester is told.
- Requests can be cancelled by their requester while pending.

## Consequences
Held changes are a snapshot, not a lock: two pending approvals on one record can conflict, and the second then fails visibly rather than overwriting.
