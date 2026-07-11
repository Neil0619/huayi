# Huayi Repository Instructions

## Project scope

Huayi is a personal macOS Google Chrome extension for English selection translation and
analysis. The extension communicates with a local Native Messaging host, which invokes an
already authenticated Codex CLI. Version 0.2.x is not a Chrome Web Store release and does not
support Windows, Linux, other browsers, cloud API keys, history, synchronization, or follow-up
chat.

## Sources of truth

- Product behavior: `docs/superpowers/specs/2026-07-11-huayi-design.md`.
- Eudic wordbook behavior: `docs/superpowers/specs/2026-07-12-eudic-wordbook-design.md`.
- Wire contracts: `packages/protocol/src/` and `docs/protocol.md`.
- Security boundaries: `docs/security.md`.
- Execution order: `docs/superpowers/plans/2026-07-11-huayi-mvp.md`.
- Eudic execution order: `docs/superpowers/plans/2026-07-12-eudic-wordbook.md`.
- Keep temporary task status out of AGENTS.md files.

## Architecture boundaries

- Dependency direction is `apps/extension -> packages/protocol <- apps/native-host`.
- The extension and native host must never import each other.
- The protocol package must not depend on DOM, Chrome, Node.js, or provider-specific APIs.
- Cross-package imports must use package public exports; deep imports are forbidden.
- Add a new browser under `apps/<browser>`, a new provider behind `AnalysisProvider`, and a new
  operating-system installer under `apps/native-host/src/install/`.
- Add a new wordbook behind `WordbookProvider`; do not put wordbook concerns in
  `AnalysisProvider`.

## Toolchain and commands

- Use pnpm workspaces, Node.js 18 or newer, strict TypeScript, and ESM.
- Use these root commands:
  - `pnpm install`
  - `pnpm format:check`
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:e2e`
  - `pnpm build`
  - `pnpm smoke:codex`
  - `pnpm host:install -- --extension-id <ID>`
  - `pnpm host:eudic:configure`
  - `pnpm host:eudic:remove`
  - `pnpm host:uninstall`
- Default tests must never call real Codex or consume subscription quota. Only the explicit
  smoke command may do so.
- Default tests must never access a real Keychain item or Eudic API. Use fake process runners,
  authorization readers, and fetch implementations.

## Code style

- Use kebab-case filenames, PascalCase types, and camelCase functions and variables.
- Use named exports. Do not add default exports.
- Format with two spaces, double quotes, semicolons, trailing commas, and a 100-column width.
- Do not use unexplained `any`, `@ts-ignore`, non-null assertions, or file-wide lint disables.
- Keep imports side-effect free unless the entrypoint exists specifically to register runtime
  listeners.
- Keep one responsibility per file. Split handwritten source before it exceeds 400 lines.
- Add a production dependency only with a documented purpose, considered alternative, and
  security impact. Commit the lockfile change with it.

## Testing and verification

- Use TDD for behavior: write a failing test, verify the expected failure, add the minimum
  implementation, then refactor while green.
- Every bug fix requires a regression test that reproduces the original symptom.
- Keep unit tests beside source as `*.test.ts`; keep browser journeys under
  `apps/extension/e2e/`.
- Run focused tests before committing and the complete quality gate before claiming completion.
- Never replace a behavior assertion with a mock-interaction assertion.

## Security and privacy

- Treat webpage input and model output as untrusted.
- Never commit secrets, tokens, Codex authentication files, local Native Messaging manifests,
  `dist/`, or coverage output.
- Never read, copy, parse, or display `~/.codex/auth.json`.
- Do not introduce remote-hosted extension code.
- Changes to protocol, Chrome permissions, security boundaries, or installation behavior must
  update the corresponding Chinese document in the same change.

## Git and review

- Use Conventional Commits with scopes `extension`, `host`, `protocol`, `docs`, `build`, or
  `test` when a scope is useful.
- Preserve unrelated user changes and stage only files belonging to the current task.
- Do not commit `AGENTS.override.md`; local temporary overrides must stay untracked.
- Keep this file below 12 KiB and each nested AGENTS.md below 6 KiB. The root plus any nested
  file must remain below Codex's default 32 KiB combined instruction limit.
