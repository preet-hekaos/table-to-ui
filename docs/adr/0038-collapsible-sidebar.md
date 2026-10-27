# 38. Collapsible sidebar and full screen

Status: accepted

## Decision
- The left menu has three states: expanded (224px), a 64px icon rail, and hidden. Ctrl+B (Cmd+B on Mac) steps through them; buttons at the foot of the menu collapse, expand or hide it. Ctrl+B is ignored while typing.
- The choice is kept in the browser (`tableui.sidebar`) and read before the first paint. A new browser on a screen 768 to 1023px wide starts as the rail; wider starts expanded.
- Below 768px nothing changes: the menu is an overlay opened from the top bar. When the sidebar is hidden on a wider screen the same overlay opens from the top bar, closes with Esc or a click outside.
- In the rail every item keeps its text for screen readers and shows a tooltip on hover and keyboard focus. A single fixed tooltip is used so the scrolling menu cannot clip it.
- Full screen hides the menu, top bar and banners; the Exit button or Esc brings them back. It does not change the saved choice.
- No new dependency; no menu content, route or permission changed.

## Consequences
The page gains up to 160px of width. Starting state differs by screen size only until the person chooses. The full-screen button lives in the top bar for now; the table toolbar (phase R2) will get its own.
