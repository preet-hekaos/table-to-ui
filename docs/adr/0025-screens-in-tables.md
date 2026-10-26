# ADR-25: Screens are managed inside each table

Status: accepted. Builds on [ADR-24](0024-canvas.md).

## Context
Screens had their own Studio tab, with a picker across every screen. But every screen is about one table, so people had to leave the table they were working on to change how it is shown.

## Decision
- The Data tab becomes **Tables**. Choosing a table shows two parts: **Fields** and **Screens**. The Screens part lists only that table's screens, configures them with the live preview, and starts a new screen from a pattern for that table.
- The separate Screens tab is removed (Studio goes from 11 tabs to 9 with Relationships already gone). Old `?tab=screens` addresses open the Screens part of the first table.
- The canvas drawer gets an **Open screens** button next to **Open fields**. The part is kept in the address (`part=screens`).
- No server change.

## Consequences
- A screen cannot be browsed across tables any more; the Menu tab still lists them all by name.
