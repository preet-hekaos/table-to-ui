# 37. Schema from a document (PDF, Word, text), read by AI

Status: accepted. Extends [ADR-26](0026-schema-import.md); follows the AI rules in [ADR-20](0020-ai-assist.md).

## Decision
- Import schema also accepts a PDF, Word or text file that describes the data in words. `POST /v1/ai/schema-from-document` reads its text (no OCR: a scanned image has no text and is refused), removes email addresses and phone numbers, and asks the AI for tables, fields, types, choices and links.
- Nothing is invented. Every table and field must carry a quote copied from the document; one without a quote the document contains is dropped and counted ("2 items the document did not clearly say were left out"). If nothing is supported the answer is thrown away.
- The result is a plain JSON Schema (`$defs`, `$ref` for links, `x-field-type`). The browser sends it through the normal Import schema preview, so the person sees, edits and ticks everything exactly as for any file. Nothing is created until they confirm, and the notice says AI can be wrong.
- Same switches as the other AI features: AI must be on for the workspace, the caller needs `ai.setup` and `metadata.write`, the monthly token cap and the call log apply. Limits: 5 MB, first 14,000 characters of text, 25 tables, 60 fields each. The answer is cached for 24 hours like other AI answers.

## Consequences
Long documents are cut at 14,000 characters. Quality with a real provider is not measured yet (a live check is a parked owner action); with the fake provider a simple "Table: field, field" layout is read so the flow can be tried offline.
