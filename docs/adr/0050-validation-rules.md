# 50. Validation rules (fx)

Status: accepted

## Decision
- A field holds an ordered list of rules (library rule, own pattern, or a rule suggested from a sentence and checked by the engine) each with a message and an on/off switch.
- Forms show the message when a person leaves the field. Rules hold on create, edit, bulk edit and import.
- On existing records a new rule is a warning with a count, not a block. Unique blocks duplicates; Required cannot be switched on while an existing record lacks a value.
