# S2 against board 2 (Type picker)

Mockup: `docs/screens/studio-table/2-type-picker.png`. Built: `s2/after-picker.png`, `after-add-field.png`, `after-length.png`, `after-shrink-confirm.png`, `after-type-name-panel.png`.

| Part of board 2 | Built | Where it belongs |
|---|---|---|
| Search box with the example placeholder | Yes | S2.3 |
| Commonly used: Short text, Long text, Date, Yes or no, Choice from a list (this order) | Yes, order fixed in the comparison pass | S2.3 |
| Group for this workspace's industry, ranked by use | Yes | S2.3 |
| All others, then Core types (low level) with Show all 14 | Yes | S2.3 |
| Right pane: tile, name, "Industry · description" | Yes, industry prefix added in the comparison pass | S2.3 |
| Right pane: Core type, Length, Saved as, Example, If blank | Yes | S2.3 |
| Right pane: Validation row (pattern and plain words) | No | S3 (validation fx) |
| Right pane: "Capital letters, spaces removed" | Capital letters only; spaces removal arrives with transformation rules | S5 |
| Explanatory box "a type is a starting point" | Yes, wording mentions length and rules until S3 and S5 add validation and defaults | S2.3 |
| Footer caption "Groups are ordered the business first" | Yes, added in the comparison pass | S2.3 |
| Cancel and "Use <type>" buttons, always visible | Yes, picker now fits the window and scrolls inside | S2.3 |
| Length column in the grid | Yes, editable | S2.4 |
| Shrinking a length asks first, with the record count | Yes | S2.5 |
| Add field dialog uses the same picker | Yes | S2.6 |
| Same type name in the grid and the field panel | Yes | S2.7 |
| Validation column in the grid | No | S3 |
| "New" badge on a new row | Shown as the Draft badge, the stage colours decided in S0 | S0 |
| Published removal record count on Undo | No, still open | S2 |
