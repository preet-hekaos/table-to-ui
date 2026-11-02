# Studio: every feature and the test that proves it takes effect live

"Live" means: changed in Studio, published, then seen in a fresh session or through the API.

| Studio part | Feature | Proof |
|---|---|---|
| Tables > Fields | Label, type, length, group, required, key rules, undoable remove, reorder | e2e/s1-fields-grid, s6-field-effects |
| Tables > Fields | Type picker, real-world types, shrink confirm | e2e/s2-*, tests/test_presets |
| Tables > Fields | Validation (fx) rules, messages, Describe it in words (AI) | e2e/s3-validation, tests/test_ai_pattern |
| Tables > Fields | Transformation rules, Try a value, Say it in words (AI) | e2e/s5-transforms, tests/test_ai_transform |
| Tables > Fields | Describe a new field in words (AI) | e2e/s7-field-words, tests/test_ai_field |
| Tables > Fields | Unique, Searchable, Filterable, table-wide switches | e2e/s4-*, s6-table-effects, s6-field-effects (53 of 53 live in the register) |
| Tables > Screens | Title, empty-state text, grouping, columns | e2e/s7-studio-live (Screens), tests/test_studio |
| Tables > Screens | New screen from a pattern, preview with your data | e2e/studio.spec |
| Menu | Rename, reorder, remove, add, role visibility | e2e/s7-studio-live (Menu), tests/test_studio (role visibility) |
| Stages and rules | Rename and add stages | tests/test_studio (stages, live table) |
| Stages and rules | Policy severity (Stop it / Ask a manager / Warn only) changes what happens once live | tests/test_workflow (policy_changed) |
| Automations | Add, edit, switch off and on; effect on new records once live | tests/test_automation (switching_an_automation) |
| Insights | Add, edit, hide, show on Home (max four) | tests/test_insights, e2e/m3 |
| Canvas | Add a link, many-to-many, relabel, remove, graph view | tests/test_relationships, e2e/n2, n4 |
| Preview | See as a role, Draft/Test/Live, device, pack fixtures | tests/test_studio (preview), e2e/studio.spec |
| Versions | Compare, publish to Test, Live, Roll back Live, review in words | e2e/s6-journey, tests/test_s6_release |
| Set up by chat (AI) | Plan, review, apply to Draft, undo | e2e/m55, tests/test_ai_setup |
| Schema import / export | SQL, CSV, Excel, JSON preview then create | e2e/n4, n6a-c |

Defects found by this audit and fixed: a screen's Title was overridden by the menu name, so editing it did nothing (the Title now sets the page heading; the menu name only names the sidebar entry).
