# ADR-21: The AI plans, the Studio does

Status: accepted. Builds on [ADR-20](0020-ai-assist.md) (AI proposes, people decide) and [ADR-17](0017-relationship-builder.md) (builders compose the Studio's own operations).

## Context
M5.5 lets an owner describe their app in words ("track our projects with a status") and get tables, fields, screens and menu entries. A model that wrote definitions or SQL directly would bypass the Studio's validation, pack protection and audit, and could not be undone safely.

## Decision
- The model returns only a **plan**: an ordered list of `{op, args, why}` from a fixed registry in `metadata` (`table.add`, `field.add`, `field.change`, `link.add`, `screen.change`, `nav.add`, `measure.add`, `automation.add`, `rule.severity`, `stage.set`). Each operation is a thin wrapper over an existing Studio edit, so naming, validation, pack protection (pack fields take label, help and hidden only; pack measures and automations are not rewritten) and audit are the Studio's own. Unknown operations or more than 20 steps fail the shape check and the plan is thrown away. There is no code or SQL path.
- The planner sees an outline of the app definition (table, field, screen and menu names; never records) and the last 10 chat messages. The owner's words are passed as quoted `<data>`.
- **Dry run**: every step runs in the real Studio code inside a transaction that is rolled back, each in its own savepoint, so the owner sees which steps would work and why one would not. Nothing is kept.
- **Apply** runs the ticked steps in one transaction after storing a snapshot of the Draft; if any step fails nothing changes. The snapshot, the Draft hash after applying and the plan are kept in `control.ai_plan`. **Undo** restores the snapshot, and drops tables the plan created while they are still empty. It is refused if the Draft changed after the plan (hash check) or a later plan was applied, because restoring would silently discard that work.
- One open plan per workspace: a new request replaces it. Applying only writes the Draft; going Live remains the existing publish and approval flow.
- Access: a new permission `ai.setup` (admins hold `*`; it can be granted to other roles) plus the AI switch; applying also needs `metadata.write`. The setup endpoints and AI settings need no Live app, so a workspace that started blank can build its first tables this way.
- Prompts are not cached (`cache_hours=0`), because a plan depends on the current Draft and chat.

## Consequences
- The registry limits what chat can do to what the Studio can already do; adding an operation means adding a wrapper and a test.
- `rule.add` is not in the registry because the Studio has no rule builder yet; only severity of checks the pack marks editable can change.
- Undo leaves added columns and indexes (additive, harmless) and any non-empty table; only empty plan-created tables are dropped.
- Dry run and apply of a 20-step plan measured p95 340 ms and 323 ms with an instant model (see [benchmarks](../benchmarks/README.md)). Real model time is the provider's. `apps/api/scripts/ai_live_setup.py` tries three descriptions on real providers; it is not part of CI.
