# Studio table builder guide

1. **Fields** – edit label, type, length, group and Required in the grid. Pick a real-world type from the Type picker (`2-type-picker.png`).
2. **fx (validation)** – add library rules, your own pattern, or describe it in words. Messages show in forms (`3-validation-fx.png`).
3. **Transformations** – tidy values before validation, e.g. trim and upper-case; try a value before saving (`4-transformation-rules.png`).
4. **Features** – Unique, Searchable, Filterable per field; Unique is checked against existing records at publish (`1-fields-tab.png`).
5. **Review and publish** – the Versions tab lists every change in plain words (`s6/review-in-words.png`); publish makes it Live, Roll back Live undoes it.
6. **Check as a recruiter** – open a fresh session (`s6/journey-recruiter-record.png`).

## Explain this field (existing fields, read only)

Nothing shows until you ask. Hover a field row and press **✦ Explain**, or use **Explain this field** in the row's ⋯ menu, or in the Edit dialog. A side panel opens (Esc closes it):

- Facts built from the field's own settings, no AI: what goes in (type, length, choices, rules with their messages), what happens to it (capitals, tidying, transformation rules, duplicates refused), where it shows (the Features ticks), what depends on it (stage questions, screens, numbers, automations) and how many records are filled or blank.
- **Ask about this field**: with AI on, a question is answered from the same facts. The model never sees record values, only counts. With AI off the box is disabled and says why.
- Nothing is saved. API: `GET /v1/studio/tables/{t}/fields/{f}/about`, `POST /v1/ai/field-question`.
