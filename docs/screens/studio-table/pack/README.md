# Before/after pack: approved mockup boards vs the built app

Each image: approved mockup on the left, built app on the right (live screenshots from the end-to-end tests).

| Board | Image | Matches | Differences for Preet to approve |
|---|---|---|---|
| 1 Fields tab | board-1-fields-tab.png | Columns (Field name, Label, Type, Core type, Length, Validation, Required, Features, Transformation), table-wide chips, Features dropdown of 11 ticks, removed rows with Undo, new-field marker | (a) "Describe a field in words" lives in the Add field dialog, not as a button beside the table-wide chips. (b) New fields are added through the Add field dialog; the inline "Type a label to add a field" row is not built. (c) Pack fields show their core type name (Short text, Phone number); the mockup shows business names (Person name, Mobile number (India)) because the mockup's fields were already given those types. (d) The publish control is the Draft banner (Review changes / Publish Draft to Test) instead of a "Review and publish" button in the header. |
| 2 Type picker | board-2-type-picker.png | Search, Commonly used / Recruitment / All others / Core types groups, "What it sets for you" panel, Cancel and Use button | Screenshot shows a different highlighted type (state, not design) |
| 3 Validation (fx) | board-3-validation-fx.png | Library chips, rules with switch, order arrows, message, built-in length rule, Cancel and Done, AI-off note | None known |
| 4 Transformation rules | board-4-transformation-rules.png | IF/THEN palette, ordered rules, and stop, Try a value, Or say it in words, Cancel and Done | None known |
| 5 What changed | board-5-what-changed.png | Decisions A to E are all honoured (see S6 compare doc); the board is a notes page, the built app shows the same decisions as behaviour and the Versions review in plain words | Decision D (alternative column names) and E (per-role hiding) are parked, as decided |

Owner decisions still standing: keep the app's icon-only Cards/Chart and full-screen buttons on lists.
