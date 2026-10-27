# 39. Table card and numbered pages

Status: accepted

## Decision
- The records list is one card: toolbar on top (range text, Custom order, Group by, Columns, density, full screen), the table, and a footer with "Showing X to Y of Z", rows per page (15, 25, 50, 100) and page numbers. The summary strip sits above the card.
- The list API takes optional `page` and `page_size`. With `page` it counts the matching rows, clamps past-the-end to the last page, and returns `total`, `page`, `page_size`. Without `page` the cursor behaviour is unchanged, so exports, bulk actions and other callers keep working. Sorting stays server-side with the id as tie-breaker, so pages never repeat or skip a row.
- Any change to search, filter, sort, grouping, Custom order or page size returns to page 1. The page number is kept in the address (`?page=`) except in a Studio preview.
- Custom order drag works within the page shown. The first column and the selection box stay in view while scrolling sideways; the header stays in view while scrolling down.
- Each person can hide columns and choose compact or comfortable rows; kept per table in the browser (`tableui.table.<table>`). The title column cannot be hidden. The owner's default columns and density arrive with the table settings in R5.
- "Load more" is gone from the records list only; other tables keep it.

## Consequences
Deep pages cost an OFFSET scan; fine for the sizes served today, and keyset paging remains for callers that do not pass `page`. Group headings count rows on the page shown.
