# ADR-12: Search in PostgreSQL; matching is a deterministic weighted score

Status: accepted

## Context
Keyword search over fields and document text must stay under 500 ms p95 on 50,000 records with typo tolerance; ranked matches must be explainable and repeatable (M1-S23 to S25).

## Decision
- Each record keeps a lower-cased `search_doc` of its searchable fields with trigram and full-text indexes; a table can include the searchable text of records that point at it (for example a CV filed under a candidate). Titles carry a trigram index for the command bar.
- Facets count values or fixed numeric buckets under the same visibility as the list, never over hidden fields.
- Matching is configured as a ranked_list screen: hard filters and scored parts (overlap, within, same, at most) with weights. The score is the weighted sum shown part by part; ties break on name then id. No AI is involved, so the same inputs always give the same order. Weights can be changed per view; the workspace default needs `matching.configure`.

## Consequences
Semantic re-ranking can be added later behind the same screen without changing the score shown to users.
