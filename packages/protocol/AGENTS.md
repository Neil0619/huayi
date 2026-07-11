# Protocol Instructions

- Depend only on Zod and platform-neutral TypeScript.
- Use strict schemas and reject unknown keys.
- The initial `schemaVersion` is `1`.
- Backward-compatible fields must be optional. Removing, renaming, or changing field semantics
  requires a schema-version increment and migration documentation.
- Every wire message is a discriminated union using `type`.
- Define all error codes in this package.
- Similar terms and synonyms require English text, part of speech, and a Chinese meaning.
- Export public types and schemas only through `src/index.ts`; consumers must not deep-import.
- Every contract change updates contract tests and `docs/protocol.md` in the same change.
