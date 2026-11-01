# S0 audit: what each setting is proven to do

Generated from `apps/api/tests/live_effects/register.py`. "Not proven" means no test shows the setting taking effect; it may still work. Partly-working findings are in the Note column.

| Setting | Result | Closed by | Note |
|---|---|---|---|
| field.key | Not proven | S1 | key is read-only once published; nothing proves a new key reaches the screens |
| field.label | Not proven | S1 | rename must reach every screen |
| field.type | Not proven | S2 |  |
| field.required | Works (proven on screen) | S1 | form proven end to end; import, bulk and inline are proven on the server only |
| field.group | Not proven | S1 | field group heading on the record form |
| field.normalize | Not proven | S2 | decides how values are compared and saved |
| field.unique | Not proven | S4 | can only be chosen when the field is created; duplicates already stored must block the publish |
| field.default | Not proven | S5 | Studio cannot set one; a pack default applies on create when blank only |
| field.options | Works on the server; screen not yet proven | S1 |  |
| field.min | Not proven | S2 | Partly: Studio sets it, only whole numbers obey it |
| field.max | Not proven | S2 | Partly: Studio sets it, only whole numbers obey it |
| field.max_length | Works on the server; screen not yet proven | S2 | Partly: Studio sets it and text obeys it; email, phone and web address ignore it |
| field.analytics | Not proven | S6 | marks a field for the insights database |
| field.source | Not proven | S1 | stored marker; the redesign stops reading it |
| field.ref_table | Works on the server; screen not yet proven | S1 |  |
| field.hidden | Works on the server; screen not yet proven | S1 |  |
| field.searchable | Not proven | S4 | fixed at creation (on for text); when switchable, records saved earlier must be re-indexed |
| field.filterable | Works on the server; screen not yet proven | S4 | two flags exist (field.filterable and table unfilterable list); S4 decides how they combine |
| field.help | Not proven | S1 | help text under the input |
| field.aliases | Not proven | S6 | kept working; editor moves to the import wizard later |
| table.sort_filter | Works on the server; screen not yet proven | S4 |  |
| table.sortable | Works on the server; screen not yet proven | S4 |  |
| table.filterable | Works on the server; screen not yet proven | S4 |  |
| table.unsortable | Works on the server; screen not yet proven | S4 |  |
| table.unfilterable | Works on the server; screen not yet proven | S4 |  |
| table.default_sort | Works on the server; screen not yet proven | S4 |  |
| table.select_bulk | Works on the server; screen not yet proven | S4 |  |
| table.bulk_actions | Works on the server; screen not yet proven | S4 |  |
| table.bulk_scope | Not proven | S4 | view versus every field |
| table.import_data | Works on the server; screen not yet proven | S4 |  |
| table.export_data | Works on the server; screen not yet proven | S4 |  |
| table.export_formats | Works on the server; screen not yet proven | S4 |  |
| table.export_email | Not proven | S4 | emailed link switch |
| table.inline_edit | Not proven | S4 | table-wide switch; per-field list is proven, the switch itself is not |
| table.grouping | Not proven | S4 | Group rows switch |
| table.statistics | Works on the server; screen not yet proven | S4 |  |
| table.stat_fields | Works on the server; screen not yet proven | S4 |  |
| table.stat_cards | Works on the server; screen not yet proven | S4 |  |
| table.stat_scope | Works on the server; screen not yet proven | S4 |  |
| table.stat_view | Not proven | S4 | cards or chart above the table |
| table.chart | Works on the server; screen not yet proven | S4 |  |
| table.nochart | Works on the server; screen not yet proven | S4 |  |
| table.default_columns | Not proven | S4 | columns everyone sees first |
| table.density | Not proven | S4 | starting row height |
| table.uneditable | Not proven | S4 | per-field edit in the list |
| table.ungroupable | Not proven | S4 |  |
| table.unexported | Works on the server; screen not yet proven | S4 |  |
| table.nobulk | Works on the server; screen not yet proven | S4 |  |
| table.row_order | Works on the server; screen not yet proven | S4 |  |

Totals: 1 proven on screen, 25 proven on the server only, 23 not proven (of 49).
