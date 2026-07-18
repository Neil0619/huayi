# Protocol Instructions

- Depend only on Zod and platform-neutral TypeScript.
- Use strict schemas and reject unknown keys.
- The current release identity is `0.10.0`; `schemaVersion` is `5`.
- Runtime v5 rejects v4. Extension and Host upgrades or rollbacks must be synchronous; do not add
  an implicit compatibility layer.
- Wire v5 health results identify exactly one
  `codex | openai-responses | openai-compatible-http | deepseek-chat-completions` provider and its
  fixed model;
  `codexVersion` is non-null only for Codex. Provider selection and credentials remain private
  Host concerns and must not enter analyze requests.
- Backward-compatible fields must be optional. Removing, renaming, or changing field semantics
  requires a schema-version increment and migration documentation.
- Every wire message is a discriminated union using `type`.
- `analysis-delta` and `analysis-section` are ordered previews; only `result` is complete success.
  Empty lexical arrays and absent optional fields produce no section event.
- Public `sourceText`, `selectionKind`, and result `type` are trusted Host metadata. Keep
  provider-private model schemas and content out of this package.
- Define all error codes in this package.
- Word confusables and synonym comparisons require English text, part of speech, a Chinese
  meaning, and a Chinese distinction. Confusables and synonyms are separate concepts.
- Export public types and schemas only through `src/index.ts`; consumers must not deep-import.
- Every contract change updates contract tests and `docs/protocol.md` in the same change.
