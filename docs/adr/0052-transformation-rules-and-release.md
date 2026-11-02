# 52. Transformation rules, and the release path

Status: accepted

## Decision
- Order on every entry path: transformations, then validation, then save. Rules: when (blank, equals, contains, starts/ends with, matches, above, below, field is) and do (set, standard value, copy field, keep match, trim, case, remove characters, clear), with stop. Rules can be written in words; the engine checks the suggestion and shows sample results.
- Old `default` values migrate to a rule "if blank, set value, stop".
- Publishing is reviewed in plain words on the Versions tab; Roll back Live restores the earlier definition including rules, transforms and labels.
- Per-role hiding waits for the Roles screen.
