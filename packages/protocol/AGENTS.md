# Protocol Instructions

- Depend only on Zod and platform-neutral TypeScript.
- Use strict schemas and reject unknown keys.
- The current `schemaVersion` is `2`.
- Runtime v2 rejects v1. Extension and Host upgrades or rollbacks must be synchronous; do not add
  an implicit compatibility layer.
- Backward-compatible fields must be optional. Removing, renaming, or changing field semantics
  requires a schema-version increment and migration documentation.
- Every wire message is a discriminated union using `type`.
- `analysis-delta` and `analysis-section` are ordered previews; only `result` is complete success.
  Empty lexical arrays and absent optional fields produce no section event.
- Public `sourceText`, `selectionKind`, and result `type` are trusted Host metadata. Keep
  provider-private model schemas and content out of this package.
- Define all error codes in this package.
- Similar terms and synonyms require English text, part of speech, and a Chinese meaning.
- Export public types and schemas only through `src/index.ts`; consumers must not deep-import.
- Every contract change updates contract tests and `docs/protocol.md` in the same change.
