# ADR-17: Links are reference fields; the builder composes the Studio's own operations

Status: accepted

## Context
M2.5 lets an admin see and manage every link between tables from one screen, including many-to-many links.

## Decision
- A link stays what it already was: a reference field on the "many" side. There is no second link store, so the parent's related list, filters, search and rules keep working unchanged.
- The Relationships API (`/v1/studio/relationships`) lists links with the number of records that use each one (one query per table, not per link), adds a link, adds a many-to-many link, and removes a link. Renaming or making a link required uses the existing field endpoint.
- Many-to-many is a linking table created through the normal table operation, with two required links and an optional note as its name. Each pair is one row.
- A link's target table cannot change. A pack link can be renamed or hidden, never deleted. An agency link is removed only when no record, screen or related-list setting uses it.
- Everything is written to the Draft and follows the same publish flow and additive-schema rule (ADR 10).

## Consequences
A one-to-one link is a link marked required plus a unique value on the parent, which the builder does not offer yet. Linking tables show up in the menu like any other table; hiding them from the menu is done in the Menu tab.
