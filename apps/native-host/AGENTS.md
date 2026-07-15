# Native Host Instructions

- stdout is only the Native Messaging protocol; diagnostics go only to stderr.
- Keep the Host health version, App Server `clientInfo.version`, and Eudic `User-Agent` at the
  current release identity `0.6.0`; wire `schemaVersion` is `4` and rejects v3.
- Validate all wire values with `@huayi/protocol`; the Host name is `com.huayi.codex_bridge`.
- Spawn Codex with argument arrays and stdin, never `shell: true`.
- Codex App Server has no ignore-user-config or ignore-rules flags; never invent or require them.
- Start App Server with the verified environment allowlist, strict config, and explicit overrides
  for read-only/no-network sandboxing, never approval, disabled web search, no history, empty
  Hook configuration, and no inherited shell environment.
- Disable `apps`, `auth_elicitation`, `browser_use`, `browser_use_external`,
  `browser_use_full_cdp_access`, `computer_use`, `enable_mcp_apps`, `hooks`, `image_generation`,
  `in_app_browser`, `memories`, `multi_agent`, `plugins`, `remote_plugin`, `shell_snapshot`,
  `shell_tool`, `skill_mcp_dependency_install`, `tool_call_mcp_elicitation`, `tool_suggest`,
  `unified_exec`, and `workspace_dependencies`.
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
- Compatible POST uses `redirect:error`, `credentials:omit`, no Cookie/retry/fallback, and only the
  documented strict dialect. Unknown/duplicate/late/tool/refusal/mismatched events fail closed.
- Warmup may discover MCP and initialize one shared App Server session, but it contains no page
  data and must never call `thread/start`, `turn/start`, or consume model output.
- Approval, input, app, Hook, MCP, shell, file-change, web, image, dynamic-tool, and
  collaboration-tool items fail closed.
- Never access `~/.codex/auth.json`; pass only the Codex environment allowlist and dedicated cwd.
- Enforce a 60-second request timeout and at most two concurrent requests.
- Providers implement `AnalysisProvider`; do not leak Codex-specific fields into wire contracts.
- Provider JSON schemas contain private model content only. The Host injects trusted
  `sourceText`, `selectionKind`, and public result `type`, validates the assembled public result,
  and never accepts those metadata fields from model output.
- Progressive deltas and typed sections are previews, not success terminals. Send no section for
  `null` or empty lexical content; only a validated `result` completes analysis successfully.
- Eudic stays outside `AnalysisProvider`, fixed to its HTTPS URL and
  `com.huayi.codex_bridge.eudic` / `authorization`, read per request and never injected or logged.
- Keychain commands use fixed `/usr/bin/security`, arrays, `shell:false`, final `-w`, and no `-A`.
- Default tests use fake process/Keychain/fetch only: no real Codex, HTTP service, Keychain, smoke,
  Provider switch, or Eudic API.
- Installation supports dry-run before external writes. Uninstall removes only exact paths owned
  by Huayi.
- v0.6.0 upgrade and rollback must reinstall Extension and Host synchronously with Extension ID
  `kfkamoejomjdihipgdkmfjcdenlhgnpd`. Reinstall preserves the Keychain service/account and the
  documented Host and Native Messaging manifest paths.
- Invalid frames, oversized messages, stdout contamination, unknown requests, and invalid model
  results fail closed.
- Keep `zod` for provider-private progressive/final validation. Do not replace strict schemas with
  drifting handwritten guards or leak private shapes through `@huayi/protocol`.
- stderr provider validation diagnostics are limited to the bounded allowlist `stream-parse`,
  `model-json`, `model-schema`, `result-assembly`, and `protocol-validation`, plus safe field
  names. Never log page/model text, raw JSON, credentials, tokens, or environment values.
