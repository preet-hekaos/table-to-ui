# ADR-23: Stage colours are computed on the server and never carried by colour alone

Status: accepted. Builds on [ADR-5](0005-releases.md) releases (Draft, Test, Live) and [ADR-10](0010-studio-edits-additive-ddl.md) Studio edits.

## Context
In the Studio a change sits in the Draft, then moves to Test, then to Live. Looking at a list, it was not possible to tell which stage a table, field or screen was in. The Versions tab could compare, but only on request.

## Decision
- A new read-only call, `GET /v1/studio/stages`, compares the Draft manifest with the Test and Live manifests and returns the stage of every table (and each field), screen, menu item, rule, measure and automation: `live` when the Draft equals Live, `test` when it equals Test, `draft` otherwise, `removed` when Test or Live still have an item the Draft has deleted. A draft item also says whether it is new. Deleted fields and removed items come back with their names so they can be listed until published.
- The comparison is a pure function over the three manifests (`metadata/domain/stages.py`). No table or column was added.
- Each stage has a colour **and** a word **and** an icon. The text colours were checked at 4.5:1 or better on their own backgrounds, in a unit test. Colour is never the only signal.
- The page asks for the report under the query key `studio-status`, so every existing Studio change already refreshes it.

## Consequences
- One extra read when the Studio opens (three manifest loads). Cheap, and cached for five seconds on the page.
- Rules shown on the Stages and rules tab are not marked yet; their edits appear as table changes. Marking them is a follow-up.
