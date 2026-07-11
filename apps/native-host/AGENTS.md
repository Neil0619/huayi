# Native Host Instructions

- stdout is exclusively the Native Messaging binary protocol. Write diagnostics only to stderr.
- Validate every inbound and outbound value through `@huayi/protocol`.
- The native host name is `com.huayi.codex_bridge`.
- Spawn Codex with an argument array and stdin. Never use `shell: true`.
- Always use ephemeral sessions, ignored user config and rules, a read-only sandbox, disabled web
  search, and a never-approve policy.
- Never read, copy, parse, or display `~/.codex/auth.json`.
- Pass only the documented environment allowlist to Codex.
- Use a dedicated empty working directory outside the repository.
- Enforce a 60-second request timeout and at most two concurrent requests.
- Providers implement `AnalysisProvider`; do not leak Codex-specific fields into wire contracts.
- Automated tests inject a fake process runner. Real Codex runs only through the explicit smoke
  command.
- Installation supports dry-run before external writes. Uninstall removes only exact paths owned
  by Huayi.
- Invalid frames, oversized messages, stdout contamination, unknown requests, and invalid model
  results fail closed.
