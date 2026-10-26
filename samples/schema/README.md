Sample files for trying Studio > Tables > Import schema.

- `recruitment-headers-only.csv`: a CSV with only a header row. Makes one empty table ("Schema only").
- `hiring-workbook.xlsx`: three sheets (Clients, Requirements, Tags). Requirements has a "Client id" column, offered as a link to Clients.
- `employee-schema.json`: a JSON Schema with required fields, a list of choices, a date, tags and a `$ref` to a second table.
- `hiring-schema.sql`: three tables with primary keys, foreign keys, a CHECK list of choices and two INSERT rows.

More files for the awkward cases:

- `messy-candidates-with-data.csv`: 40 rows, Windows-1252 text (accents), an `id` column (skipped), two columns with the same name, mixed date values, "5 yrs" and "12 LPA" values (types: months, money), a yes/no column, a `Client id` column and a mostly empty Notes column. Gives "Schema + 40 rows".
- `orders-api-export.json`: an object with two lists (customers, orders). Nested address and order lines are skipped with a warning; `customer_id` in orders is offered as a link to Customers; tags become a list-of-labels field.
- `clashes-and-odd-types.sql`: tables named `candidate` and `client`, which already exist in the recruitment pack, so they come back as `candidate_2` and `client_2` with a warning. Has an ENUM (choices), a self link, BLOB and GEOGRAPHY columns (treated as text, with a warning), TEXT columns, and a view and an index that are ignored.

What to try: import the first set into a blank workspace and tick or untick links; import the clash file into the recruitment workspace and check the renamed tables; drop all of them together to see 12 or more tables on the canvas; drop a PDF to see the plain-words refusal.
