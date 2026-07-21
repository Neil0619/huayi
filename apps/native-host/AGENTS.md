# Native Host Instructions

- stdout is protocol-only; diagnostics go to stderr.
- Keep the Host health version, App Server `clientInfo.version`, and Eudic `User-Agent` at the
  current release identity `0.10.0`; wire `schemaVersion` is `5` and rejects v4.
- Validate all wire values with `@huayi/protocol`; the Host name is `com.huayi.codex_bridge`.
- Spawn Codex with argument arrays and stdin, never `shell: true`.
- Codex App Server has no ignore-user-config or ignore-rules flags; never invent or require them.
- Start App Server with the verified environment allowlist, strict config, and explicit overrides
  for read-only/no-network sandboxing, never approval, disabled web search, no history, empty
  Hook configuration, and no inherited shell environment.
- Disable every capability in `APP_SERVER_DISABLED_FEATURES`; changes require security tests.
- Before each App Server start, use no-model `codex mcp list --json`; validate names and disable
  each enabled server individually. Never use unsupported keys or `mcp_servers={}`.
- Accept Hook records only for the dedicated cwd with empty hooks/warnings/errors, and MCP status
  records only when disconnected and without tools, resources or templates.
- Any discovery failure, unsafe name, active capability or unknown response shape fails closed.
- Every analysis uses the empty dedicated cwd and a new ephemeral thread with empty instructions,
  built-in `openai`, `gpt-5.4-mini`, and `low`; validate every returned invariant.
- Provider configuration is the strict owned file
  `~/Library/Application Support/Huayi/native-host/provider.json`. A missing file means Codex;
  every other invalid state fails closed. Read once per request, pin the route, and never fall
  back automatically.
- Official Responses is fixed to HTTPS, `gpt-5.6-luna + none`, streaming strict Schema,
  `store:false`, no tools/retry, and strict SSE. Read its Key per request from
  `com.huayi.codex_bridge.openai` / `api-key`; never cache, inject, or log it.
- Keep compatible selection, strict `compatible-http.json`, and
  `com.huayi.codex_bridge.compatible_http` / `api-key` separate. Require literal HTTP consent,
  credential/query/fragment-free base URL, and only `gpt-5.4-mini + low` or
  `gpt-5.6-luna + none`.
- Compatible code never reads/modifies Codex config/auth/session/providers, shell/env credentials,
  or the official Key. Key/config, smoke, and selection are separate actions; smoke never switches.
- DeepSeek is fixed to `https://api.deepseek.com/chat/completions`, `deepseek-v4-flash`, disabled
  thinking, JSON Output, `temperature: 0`, and streaming. Read its Key per request from
  `com.huayi.codex_bridge.deepseek` / `api-key`; never cache, inject, log, or accept another URL.
- DeepSeek uses strict data-only SSE and no retry, fallback, tools, cookies, redirects, or Codex
  configuration. Non-empty reasoning, missing `[DONE]`, truncation, unknown structures, and
  mismatched lifecycle metadata fail closed. Its configure, smoke, and Provider switch remain
  separate explicit actions.
- Follow the root cross-platform completion rules. Windows is DeepSeek-only, reports no Codex
  version, and keeps Eudic as a separate `WordbookProvider`; never resolve or configure another
  model provider there.
- Windows reads separate DeepSeek and Eudic DPAPI `PSCredential` files through fixed installed
  PowerShell helpers. Never accept either secret by argument, environment, repository, or wire.
- Windows owns only `%LOCALAPPDATA%\Huayi\native-host` and the exact per-user Chrome Native
  Messaging registry key. Package a Node SEA `.exe`; use fixed `reg.exe` arrays and `shell:false`.
- Compatible POST uses `redirect:error`, `credentials:omit`, no Cookie/retry/fallback, and only its
  documented strict dialect; unknown, duplicate, late, tool, refusal, or mismatched events fail.
- Warmup may discover MCP and initialize one shared App Server session, but it contains no page
  data and must never call `thread/start`, `turn/start`, or consume model output.
- Approval, tool, app, Hook, MCP, shell, file, web, image, or collaboration items fail closed.
- Never access `~/.codex/auth.json`; pass only the Codex environment allowlist and dedicated cwd.
- Enforce a 60-second request timeout and at most two concurrent requests.
- Providers implement `AnalysisProvider`; keep provider fields out of wire contracts.
- Provider schemas contain private model content only. The Host injects trusted metadata,
  validates the public result, and never accepts metadata from model output.
- Word requests use the dedicated `translate-word` and `explain-word` private schemas. Keep
  confusable words separate from synonyms, omit unreliable content, and preserve the documented
  field order for progressive display across every provider.
- Progressive deltas and typed sections are previews, not success terminals. Send no section for
  `null` or empty lexical content; only a validated `result` completes analysis successfully.
- Eudic stays outside `AnalysisProvider`, uses its fixed HTTPS URL and a platform-owned credential
  (macOS Keychain or Windows DPAPI), and is never injected or logged.
- Keychain commands use fixed `/usr/bin/security`, arrays, `shell:false`, final `-w`, and no `-A`.
- Default tests use fake process/Keychain/fetch only: no real Codex, HTTP service, Keychain, smoke,
  Provider switch, or Eudic API.
- Support dry-run; uninstall only Huayi-owned paths.
- v0.10.0 upgrades reinstall Extension and Host synchronously; preserve owned credentials/config.
- Invalid frames, oversized messages, stdout contamination, unknown requests, and invalid model
  results fail closed.
- Keep Zod for private validation; never leak provider shapes through `@huayi/protocol`.
- stderr provider validation diagnostics are limited to the bounded allowlist `stream-parse`,
  `model-json`, `model-schema`, `result-assembly`, and `protocol-validation`, plus safe field
  names. Never log page/model text, raw JSON, credentials, tokens, or environment values.
