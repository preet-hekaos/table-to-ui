# ADR-20: AI proposes, rules and people decide

Status: accepted. Builds on [ADR-4](0004-command-pipeline.md) (every change goes through the pipeline) and [ADR-12](0012-search-and-matching.md) (scores are deterministic).

## Context
M5 adds AI where it saves typing and reading: filling what a CV parser missed, summarising a record, explaining a score or a number, turning a sentence into a search, drafting a message. The product is deterministic by design, so AI must never change what the rules decide, never write on its own, and never be required.

## Decision
- A new `ai` module. Features never name a provider: they call a `AiProvider` port. Adapters: Groq (`openai/gpt-oss-20b`) and Google Gemini, both free tiers, tried in that order (`FailoverProvider`); a fake provider for tests; a demo provider (`AI_PROVIDER=fake`, local only) with canned answers so the screens can be tried without a key. Keys come from the environment (`GROQ_API_KEY`, `GOOGLE_API_KEY`), never from the database or the repo.
- Every call goes through one gateway: switch (off by default per workspace) → table allow-list → monthly token cap → 24-hour cache by input hash → provider (20 s limit, one retry) → shape check → call log. A reply that does not fit its shape is thrown away, not repaired.
- A suggestion is only a suggestion. No AI endpoint writes. Accepting one (using a CV suggestion, copying a draft) is the person's own action through the normal forms and pipeline, so rules, approvals, history and undo apply.
- Deterministic things stay deterministic. Explaining a match restates the already computed parts; the score and order are identical with AI on or off (tested). Explaining a number reads the measure's own series.
- Suggestions must be supported. A CV suggestion is kept only when its quote is found in the document text and its value fits the field's type and choices. Ask-in-words keeps only fields and choices the table really has.
- Privacy by construction: only fields the person's role can read are put in a prompt; email addresses and phone numbers are replaced with placeholders unless the feature needs them (CV reading and drafting); document and record text is passed as quoted data in `<data>` tags and the model has no tools, so text in a CV cannot make anything happen.
- Prompts: the built-in instructions are generic. A pack adds domain wording per feature in `prompts.yaml` (recruitment v1.5.0), versioned with the pack. Each call records `feature.v<n>.<hash of the final instructions>`, so a change of wording is visible in the log.
- Limit is counted in tokens (the providers are free, so money is not the unit). Usage and the last calls are shown to admins in Settings → AI; the text sent is not stored.

## Consequences
- If the provider is down, rate-limited or the limit is reached, the buttons say so and nothing else changes. Free tiers do rate-limit, so the cache and the Groq → Gemini fallback matter.
- Prompt wording is not yet editable in the Studio or in releases; it ships with the pack. Making prompts a metadata kind (diffed, rolled back) is a later step.
- Overhead with an instant model: p95 44 ms uncached, 46 ms cached, against 20 ms for a plain record read; a save is unchanged (see [benchmarks](../benchmarks/README.md)). Real model time is the provider's.
- The Groq and Gemini adapters are covered by canned-HTTP tests. A live check against the real services is a script (`apps/api/scripts/ai_live.py`) run with real keys; it is not part of CI.
