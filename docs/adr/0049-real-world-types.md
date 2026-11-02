# 49. Real-world types over a core type

Status: accepted

## Decision
- The Type picker offers real-world types (PAN, Aadhaar, GSTIN, phone, pin code...) that each sit on one core type (text, number, date, ...). Length and a type name are kept per field.
- Live type changes are allowed only between compatible core types; shrinking a length asks for confirmation and shows how many records are affected.
- Alternative column names for import are parked for the import wizard.
