# Native Host Instructions

- stdout is exclusively the Native Messaging binary protocol. Write diagnostics only to stderr.
- Validate every inbound and outbound value through `@huayi/protocol`.
- The native host name is `com.huayi.codex_bridge`.
- Spawn Codex with an argument array and stdin. Never use `shell: true`.
- Codex App Server has no ignore-user-config or ignore-rules flags; never invent or require them.
- Start App Server with the verified environment allowlist, strict config, and explicit overrides
  for read-only/no-network sandboxing, never approval, disabled web search, no history, empty
  Hook/MCP tables, no inherited shell environment, and no image viewer.
- Disable `apps`, `hooks`, `image_generation`, `in_app_browser`, `memories`, `multi_agent`,
  `plugins`, `remote_plugin`, `shell_tool`, `unified_exec`, `shell_snapshot`, and `tool_suggest`.
- Every analysis uses the dedicated empty cwd and a new ephemeral thread with empty instruction
  sources, built-in `openai`, `gpt-5.4-mini`, and `low` effort. Validate all returned invariants.
- Require empty Hook/MCP discovery. Approval, input, app, Hook, MCP, shell, file-change, web,
  image, dynamic-tool, and collaboration-tool items fail closed.
- Never read, copy, parse, or display `~/.codex/auth.json`.
- Pass only the documented environment allowlist to Codex.
- Use a dedicated empty working directory outside the repository.
- Enforce a 60-second request timeout and at most two concurrent requests.
- Providers implement `AnalysisProvider`; do not leak Codex-specific fields into wire contracts.
- Eudic wordbook support remains separate from `AnalysisProvider` and uses only
  `https://api.frdic.com/api/open/v1/studylist/word`.
- Read Eudic authorization for every `check-word` and `add-word` request from the exact macOS
  Keychain item `com.huayi.codex_bridge.eudic` / `authorization`; never cache it.
- Never accept Eudic authorization through arguments, environment variables, files, extension
  messages, logs, snapshots, or test output. Never expose it in errors or Native Messaging.
- Keychain commands use the fixed `/usr/bin/security` executable with argument arrays and
  `shell: false`. Configuration must keep `-w` last and must never use `-A`.
- Eudic HTTP tests inject fake authorization readers and fake fetch implementations. Automated
  tests must never access the real Keychain or Eudic API.
- Automated tests inject a fake process runner. Real Codex runs only through the explicit smoke
  command.
- Installation supports dry-run before external writes. Uninstall removes only exact paths owned
  by Huayi.
- Invalid frames, oversized messages, stdout contamination, unknown requests, and invalid model
  results fail closed.
