# 45. Studio header: a section switcher instead of nine tabs

Status: accepted

## Decision
- The Studio header is one row: the title, the Draft → Test → Live strip (one segmented control, same colours and counts), a "Set up by chat" button and a "..." menu that holds the Pattern library link.
- Below it sits one toolbar. Its first control is a button naming the current section; it opens a map of all sections in three groups (Build: Tables, Canvas, Stages & rules; Automate: Automations, Insights; Ship: Menu, Preview, Versions), each with a one-line description. The current section is marked.
- In Tables the same toolbar row also holds the table picker, the Fields / Screens / Features control and New table, so there is no second row of tabs.
- Sections are still reached by URL (`/studio?tab=...`); only the control changed. The nine-tab row is removed.

## Consequences
Three stacked layers at the top become two. A new section costs one line in the map instead of a tab that no longer fits. Tests move between sections with the `openSection` helper rather than clicking a tab.

## Update (R9)
The section switcher moved up into the header row beside "Set up by chat", because it applies to every section while the table controls only apply to Tables. The toolbar below now exists only in Tables and holds just the table picker, Fields / Screens / Features, Add field and New table. Field rows are compact (about 37 px).
