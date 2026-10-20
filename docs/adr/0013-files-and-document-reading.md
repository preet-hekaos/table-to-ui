# ADR-13: Files are checked by content and scanned before anything reads them

Status: accepted

## Context
CVs, logos and spreadsheets arrive from users. A file must never be read before it is scanned (R-14), and the CV parser vendor may be down (M1-S11).

## Decision
- The type is judged from the bytes (magic numbers, ZIP contents), not the name; each kind has allowed types and a size limit.
- A scanner port runs before storage is used: ClamAV over clamd locally and in CI, GuardDuty in AWS, a signature scanner (EICAR) when neither is configured. Only files scanned clean can be opened or parsed.
- A parser port reads documents into fields with a confidence each: a built-in deterministic reader (PDF and DOCX text) and an RChilli adapter. Fields under 0.8 are highlighted for review. If the parser is unavailable the file is kept and queued, and the person types the fields.
- What a document becomes is metadata: a document_review screen maps parser fields to table fields and names the table that files the document.

## Consequences
Image CVs have no text layer without OCR; they are reviewed by hand until a vendor parser is enabled.
