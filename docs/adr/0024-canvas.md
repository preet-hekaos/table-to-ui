# ADR-24: One canvas for tables and links, with an ordered layout and a details drawer

Status: accepted. Builds on [ADR-23](0023-stage-colours.md) stage colours and the M2.5 relationship builder.

## Context
The canvas drew every table as a tall box on a grid, so lines crossed each other and ran under boxes (44 crossings on the recruitment pack). Relationships lived in a separate tab, so a person flipped between the picture and the list.

## Decision
- Tables are compact cards (name, field count, link count, stage). A click opens a details drawer with fields, what the table points to, what points to it, and Add link / Edit link.
- The layout is our own small pure function: break cycles, put each table in a layer after what it points to, sweep to reduce crossings, then tidy the spacing. It is deterministic, has no dependencies and is unit-tested (pack: 44 → 5 crossings; a generated 40-table, 100-link model: 1124 → 455, about 60% fewer). Saved positions still win.
- Several links between the same two tables are drawn as one thicker line that says how many it carries. Hover, selection and "focus on this table" light up the related lines.
- A Cards / Graph switch (remembered per browser) shows the same tables as dots sized by their links, placed by a deterministic force layout.
- The Relationships tab is gone. Its list, link health, Add link and many-to-many now sit on the canvas ("All links" panel). Old `?tab=links` addresses open the canvas.

## Consequences
- The plan listed elkjs and d3-force; we wrote small equivalents instead to avoid two new dependencies. Revisit if models grow beyond a few hundred tables.
- Dense models still have some crossings; the merged lines, highlight and focus mode are the answer for those.
