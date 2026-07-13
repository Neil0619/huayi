# Native Host Instructions

- stdout is exclusively the Native Messaging binary protocol. Write diagnostics only to stderr.
- Validate every inbound and outbound value through `@huayi/protocol`.
- The native host name is `com.huayi.codex_bridge`.
- Spawn Codex with an argument array and stdin. Never use `shell: true`.
- Codex App Server has no ignore-user-config or ignore-rules flags; never invent or require them.
- Start App Server with the verified environment allowlist, strict config, and explicit overrides
  for read-only/no-network sandboxing, never approval, disabled web search, no history, empty
  Hook configuration, and no inherited shell environment.
- Disable `apps`, `auth_elicitation`, `browser_use`, `browser_use_external`,
  `browser_use_full_cdp_access`, `computer_use`, `enable_mcp_apps`, `hooks`, `image_generation`,
  `in_app_browser`, `memories`, `multi_agent`, `plugins`, `remote_plugin`, `shell_snapshot`,
  `shell_tool`, `skill_mcp_dependency_install`, `tool_call_mcp_elicitation`, `tool_suggest`,
  `unified_exec`, and `workspace_dependencies`.
- Discover directly configured MCP servers with the no-model `codex mcp list --json` command
  before each App Server process start; validate names and disable every enabled server with an
  individual config override.
- Never use unsupported config keys or `mcp_servers={}` as a substitute for verified isolation.
- Accept Hook records only for the dedicated cwd with empty hooks/warnings/errors, and MCP status
  records only when disconnected and without tools, resources or templates.
- Any discovery failure, unsafe name, active capability or unknown response shape fails closed.
- Every analysis uses the dedicated empty cwd and a new ephemeral thread with empty instruction
  sources, built-in `openai`, `gpt-5.4-mini`, and `low` effort. Validate all returned invariants.
- Approval, input, app, Hook, MCP, shell, file-change, web, image, dynamic-tool, and
  collaboration-tool items fail closed.
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
