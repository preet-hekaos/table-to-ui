# 43. Studio table picker, actions menu and chips

Status: accepted

## Decision
- The Studio Tables tab no longer has a left column. The table is chosen from a searchable picker in the card header (name, Draft/Test/Live dot, field count). New table sits beside it as the main action; Import schema and Export schema live in a small "More" menu that opens over the page. Add field sits above the field list.
- Toggles in the Features tab are chips, not checkboxes: a rounded pill, soft accent with a tick when on, outlined when off. The feature switches read On/Off; options (bulk actions, export formats, summary choices) carry their own labels.
- The field grid is one row per field with a labelled chip for each thing people may do (Shown, Sort, Filter, Edit, Group, Export, Bulk, Summary), in the style of the ITArks admin attributes. Hovering or focusing a chip explains it; a greyed chip says what to switch on first.
- Chips stay checkboxes and switches for assistive technology, with unchanged names, so keyboard and screen reader use is the same. The tick means on is not shown by colour alone.
- New `Chip` and `Tooltip` in the design system (Radix tooltip).

## Consequences
Nothing changes in the API or stored settings. The schema actions take one more click.
