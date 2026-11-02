# S5 against mockup board 4 (Transformation rules)

Screenshots: `after-panel.png`, `after-cell.png`, `after-words.png`, `after-form-hint.png`.

| Mockup element | Built | Proof |
|---|---|---|
| Column "Transformation rule" with the first rule and "+N more" | Yes | S5.2 e2e |
| Panel: IF/THEN palette, rules list, "and stop", on/off, order arrows, delete | Yes | S5.2 e2e |
| Standard values by type | Yes | test_transforms |
| Try a value (real function, names the rule, shows the refusal) | Yes | S5.2 e2e, server preview test |
| Cancel throws away, Done saves to the Draft | Yes | S5.2 e2e |
| "Or say it in words" (suggestion only, checked by the engine, AI off disables it) | Yes | S5.3 e2e, test_ai_transform |
| Form says what a blank becomes | Yes | S5.4 e2e |
| Live: form, API, bulk, inline, import | Yes | test_transforms (all surfaces), S5.4 e2e (form, API) |

Honest gaps: import, bulk and inline are proved by server tests, not yet by a second-user screen scenario (S6).
The old `default` still applies; S6 migrates it into an "if blank" rule.
