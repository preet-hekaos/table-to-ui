# Board 3 (Validation fx) — mockup vs built

| Mockup element | Built | Proof |
|---|---|---|
| Validation column with fx button ("Add" / "N rules") | Yes | s3/after-popover.png |
| Popover "Validation for <field>", rules run top to bottom | Yes | e2e S3.3 |
| Rule row: switch, name, pattern chip, message, delete | Yes, plus up/down order buttons | e2e S3.3 |
| Built-in Length note | Yes | e2e S3.3 |
| Library chips (Email, Mobile, PAN, Pincode, GSTIN, Letters only, Letters and numbers, Web link, Date not in the future) | Yes, with sample tooltips | API test: every library rule vs its good and bad samples |
| "+ Write my own pattern" | Yes, pattern checked on leaving the box | e2e S3.3, API bad/runaway pattern test |
| Describe it in words (Make a pattern, samples, try your own value, Use as rule / Edit pattern) | Yes; proven with the fake AI provider only | s3/after-describe.png, test_ai_pattern |
| Cancel / Done | Yes | e2e |
| Warning on publish for existing records that break a rule | Yes | s3/after-publish-warning.png |
| Form shows the message on leaving the field; Save explains why it is off | Yes | s3/after-form-message.png |
| Rules hold on create, edit, bulk, import, API; message edits propagate | Yes | tests/test_validation_paths.py |

## Gaps
- Mockup example rule "No spaces / Remove the spaces" is a transformation: belongs to S5.
- "Check existing records" shows the count; it does not yet open the list filtered to the failing records (decided: stays a count).
- "Date not in the future" is a built-in kind, not a regex.
- Real AI provider not exercised.
