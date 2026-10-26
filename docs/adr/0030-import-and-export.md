# 30. Import and export

Status: accepted

## Decision
- **Import**: the list's "Import data" opens the existing wizard on that table. The wizard now also reads JSON (a list of flat objects; arrays become comma lists, nested objects are refused). The table's `import_data` switch is checked on the server when the job is created.
- **Export**: `POST /v1/records/{table}/export` gives CSV, JSON or Excel. It reads the list again (same scope, filters, sort and hidden fields) so it holds nothing the person could not see. Columns are the shown ones or every visible field; asking for a hidden field is refused.
- Limits: Excel up to 50,000 rows, CSV and JSON up to 100,000. Beyond that the server says to narrow the search.
- Spreadsheet safety: a text cell that starts with `=`, `+`, `-` or `@` is saved with a leading apostrophe so it cannot run as a formula.
- The table's `export_data`, `export_formats` and `export_email` switches are enforced on the server. Every export is written to the audit trail with its format, row count and columns.
- **Email**: a signed link (7 days) is sent only to the signed-in person's own address, and only for a search, not for ticked rows. Opening it needs sign-in as the same person; the file is built at that moment from what they can see then. No file is stored.

## Consequences
Anyone with the read permission can export what they can read. A separate export permission is possible later if an owner asks for it.
