# Huayi Repository Instructions

## Project scope

Huayi is a personal Google Chrome extension for English selection translation and analysis. The
extension communicates with a local Native Messaging host. macOS supports Codex, OpenAI,
OpenAI-compatible HTTP, DeepSeek, and Eudic. Windows is intentionally DeepSeek-only for model
analysis, supports Eudic, and does not support Codex or alternate model providers. Huayi is not a
Chrome Web Store release and does not support Linux, other browsers, history, synchronization,
follow-up chat, or browser settings.

## Sources of truth

- Product behavior: `docs/superpowers/specs/2026-07-11-huayi-design.md`.
- Eudic wordbook behavior: `docs/superpowers/specs/2026-07-12-eudic-wordbook-design.md`.
- Streaming and word-status behavior:
  `docs/superpowers/specs/2026-07-12-streaming-analysis-design.md`.
- Codex capability compatibility behavior:
  `docs/superpowers/specs/2026-07-13-codex-capability-compatibility-design.md`.
- Wire contracts: `packages/protocol/src/` and `docs/protocol.md`.
- Security boundaries: `docs/security.md`.
- Execution order: `docs/superpowers/plans/2026-07-11-huayi-mvp.md`.
- Eudic execution order: `docs/superpowers/plans/2026-07-12-eudic-wordbook.md`.
- Streaming execution order: `docs/superpowers/plans/2026-07-12-streaming-analysis.md`.
- Codex capability compatibility execution order:
  `docs/superpowers/plans/2026-07-13-codex-capability-compatibility.md`.
- OpenAI provider and smooth streaming behavior:
  `docs/superpowers/specs/2026-07-14-openai-responses-provider-design.md`.
- OpenAI provider execution order:
  `docs/superpowers/plans/2026-07-14-openai-responses-provider.md`.
- OpenAI-compatible HTTP provider behavior:
  `docs/superpowers/specs/2026-07-15-openai-compatible-http-provider-design.md`.
- OpenAI-compatible HTTP provider execution order:
  `docs/superpowers/plans/2026-07-15-openai-compatible-http-provider.md`.
- DeepSeek provider behavior:
  `docs/superpowers/specs/2026-07-16-deepseek-v4-flash-provider-design.md`.
- DeepSeek provider execution order:
  `docs/superpowers/plans/2026-07-16-deepseek-v4-flash-provider.md`.
- Word translation and explanation separation:
  `docs/superpowers/specs/2026-07-16-word-results-design.md`.
- Word result implementation order:
  `docs/superpowers/plans/2026-07-16-word-results.md`.
- Overlay visual behavior:
  `docs/superpowers/specs/2026-07-17-ui-refresh-design.md`.
- Current release status and roadmap: `docs/project-status.md`.
- Cross-platform development and completion rules: `docs/cross-platform-development.md`.
- Windows source installation: `docs/setup-windows.md`.
- Keep temporary task status out of AGENTS.md files.

## Current release invariants

- All app, package, Manifest, Host, App Server client, and Eudic User-Agent identities are
  `0.10.0`; the Native Messaging `schemaVersion` is `5`.
- Wire v5 is incompatible with v4 and rejects it. Upgrade or roll back the Extension and Native
  Host synchronously; do not add a translation shim.
- Missing provider configuration defaults to Codex. Every other invalid configuration state
  fails closed. Each analysis request reads and pins one provider; never migrate an active
  request or automatically fall back after a provider failure.
- Provider schemas describe private model content only. The trusted Host owns `sourceText`,
  `selectionKind`, and public result `type`, then validates the assembled public result.
- Word translation is dictionary-focused (`translate-word`); word explanation is contextual
  usage-focused (`explain-word`). Keep phrase behavior in the lexical result types.
- Warmup carries no selection, context, sentence, URL, or other page data and must not create a
  thread, turn, or model output. Typed deltas and sections are previews; only `result` is a
  complete success. Omit empty lexical sections instead of fabricating values.
- Provider-validation stderr diagnostics may contain only bounded allowlisted stages and field
  names. Other startup and protocol diagnostics use fixed safe messages. No stderr path may
  include page, model, credential, raw JSON, or environment contents.
- Default gates are offline. Run `pnpm smoke:codex`, `pnpm smoke:compare`,
  `pnpm smoke:compatible`, or `pnpm smoke:deepseek` only after separate informed approval.
  Compatible approval must cover
  plaintext credential/page-data transmission and third-party billing; other smoke approval must
  cover real-model quota/API billing. Installation and Chrome verification need separate approval.
- The personal Extension ID is `kfkamoejomjdihipgdkmfjcdenlhgnpd`. Synchronous reinstall uses
  `pnpm host:install -- --extension-id kfkamoejomjdihipgdkmfjcdenlhgnpd` and preserves the
  `com.huayi.codex_bridge.eudic` / `authorization` Keychain item and documented macOS paths.
- Windows always pins `deepseek-chat-completions`, stores its DeepSeek API Key and Eudic
  authorization in separate per-user DPAPI-protected credentials below `%LOCALAPPDATA%`, and
  registers only the exact HKCU Chrome Native Messaging key. Windows packaging produces a
  standalone Node SEA executable.

## Architecture boundaries

- Dependency direction is `apps/extension -> packages/protocol <- apps/native-host`.
- The extension and native host must never import each other.
- The protocol package must not depend on DOM, Chrome, Node.js, or provider-specific APIs.
- Cross-package imports must use package public exports; deep imports are forbidden.
- Add a new browser under `apps/<browser>`, a new provider behind `AnalysisProvider`, and a new
  operating-system installer under `apps/native-host/src/install/`.
- Add a new wordbook behind `WordbookProvider`; do not put wordbook concerns in
  `AnalysisProvider`.

## Cross-platform development

- At task start, declare the affected platform set as `shared`, `macOS`, `Windows`, or a
  combination. Do not infer completion for an unverified target platform.
- Protocol, Schema, Prompt, HTTP, Extension UI, and pure domain changes may be implemented on
  either OS, but the macOS and Windows CI jobs must both pass.
- Fake process, filesystem, credential, registry, and Keychain tests prove contracts only. They
  never replace target-platform validation of OS integration.
- Changes to Keychain, Codex process control, macOS launchers, or macOS installation require
  macOS validation. Changes to DPAPI, PowerShell, registry, SEA, or Windows installation require
  Windows validation with Node.js 26 or newer.
- Native Messaging, Host/Extension version, framing, or shared transport changes require both
  platform CI jobs and manual Chrome verification on both supported platforms before release.
- Real Chrome, credentials, provider smoke, install, upgrade, and uninstall are manual target-OS
  checks requiring separate user approval. CI must remain offline and secret-free.
- If the target OS is unavailable, report `implemented; target-platform validation pending`, give
  exact handoff commands and expected results, and do not claim the task or release complete.
- Inject platform, path, permission, newline, case-sensitivity, process, and environment behavior.
  Use `node:path` platform variants where needed, argument arrays, and `shell: false`.
- Do not skip a test merely because the development host differs. Skip only unavoidable real OS
  primitives, document why, and cover the behavior in the matching target-platform CI job.
- Platform integration changes must update `docs/cross-platform-development.md`, `docs/testing.md`,
  the affected setup document, and `docs/security.md` when the security boundary changes.

## Toolchain and commands

- Use pnpm workspaces, Node.js 18 or newer, strict TypeScript, and ESM.
- Use these root commands:
  - `pnpm install`
  - `pnpm check:instructions`
  - `pnpm format:check`
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:e2e`
  - `pnpm build`
  - `pnpm verify:macos`
  - `pnpm verify:windows`
  - `pnpm smoke:codex`
  - `pnpm smoke:compatible`
  - `pnpm smoke:deepseek`
  - `pnpm smoke:compare`
  - `pnpm host:install -- --extension-id <ID>`
  - `pnpm host:eudic:configure`
  - `pnpm host:eudic:remove`
  - `pnpm host:openai:configure`
  - `pnpm host:openai:remove`
  - `pnpm host:deepseek:configure`
  - `pnpm host:deepseek:remove`
  - `pnpm host:compatible:key:configure`
  - `pnpm host:compatible:key:remove`
  - `pnpm host:compatible:config:set --base-url <URL> --model <MODEL> --effort <EFFORT> --allow-insecure-http`
  - `pnpm host:compatible:config:status`
  - `pnpm host:compatible:config:remove`
  - `pnpm host:provider:set api|compatible-http|codex|deepseek`
  - `pnpm host:provider:status`
  - `pnpm host:uninstall`
  - `pnpm host:windows:package` (Windows with Node.js 26+ only)
- Default tests must never call OpenAI, a third-party HTTP service, real Codex, a real Keychain
  item, or the Eudic API. Use
  fake App Servers, process runners, authorization readers, and fetch implementations. Only the
  explicitly approved smoke commands may run real models or consume subscription/API quota.

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
