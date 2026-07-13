# Codex App Server Capability Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore real Chrome analysis on Codex CLI `0.144.0-alpha.4` while preserving Huayi's
fail-closed Hook, MCP, tool, sandbox, approval and ephemeral-session boundaries.

**Architecture:** A new no-model discovery module runs `codex mcp list --json`, validates at most
128 directly configured servers and returns the enabled safe names. App Server startup converts
those names into per-server `enabled=false` overrides, removes two incompatible blanket overrides,
then verifies that Hook records are empty and every reported MCP record is inert before creating an
ephemeral thread.

**Tech Stack:** Node.js 18+, TypeScript strict ESM, pnpm workspace, Vitest, Codex App Server
JSON-RPC, existing `ProcessRunner` and Native Messaging runtime.

## Global Constraints

- Keep the dependency direction `apps/extension -> packages/protocol <- apps/native-host`.
- Keep `schemaVersion: 1`; this hotfix does not change the public wire protocol.
- Keep `gpt-5.4-mini`, `low` reasoning effort, 60-second analysis timeout and ephemeral threads.
- Use argument arrays, `shell: false`, the environment allowlist and the dedicated empty cwd.
- Never read, copy, parse or display `~/.codex/auth.json`.
- Default tests use fake process and JSON-RPC runners; do not run `pnpm smoke:codex` without
  explicit user authorization.
- Accept at most 128 MCP records and names matching `[A-Za-z0-9_-]{1,128}`; duplicate names fail.
- Any discovery, config, Hook or MCP shape that cannot prove the safe state maps to
  `CODEX_CAPABILITY_MISSING` before a model turn starts.
- Keep handwritten source files below 400 lines; `codex-app-server.ts` is already near the limit,
  so discovery and config construction stay in focused modules.
- Version the root package, all three workspace packages, Chrome Manifest and Host surfaces as
  `0.3.1`; do not rewrite historical v0.3.0 protocol or design records.

---

### Task 1: Discover direct MCP servers and construct compatible App Server arguments

**Files:**

- Create: `apps/native-host/src/runtime/codex-mcp-discovery.ts`
- Create: `apps/native-host/src/runtime/codex-mcp-discovery.test.ts`
- Modify: `apps/native-host/src/runtime/codex-app-server-config.ts`
- Modify: `apps/native-host/src/runtime/codex-app-server-process.test.ts`
- Modify: `apps/native-host/src/runtime/codex-capabilities.test.ts`

**Interfaces:**

- Consumes: `ProcessRunner.run(request: ProcessRunRequest): Promise<ProcessRunResult>`,
  `buildAllowedEnvironment()` and `capabilityMissingError()`.
- Produces:

```ts
export interface CodexMcpDiscoveryOptions {
  codexExecutable: string;
  environment: Readonly<NodeJS.ProcessEnv>;
  processRunner: ProcessRunner;
  workingDirectory: string;
}

export async function discoverEnabledMcpServerNames(
  options: CodexMcpDiscoveryOptions,
): Promise<readonly string[]>;

export function buildAppServerArguments(
  mcpServerNamesToDisable: readonly string[],
): readonly string[];

export function isSafeMcpServerName(name: string): boolean;

export interface NodeAppServerProcessOptions {
  codexExecutable: string;
  environment: Readonly<NodeJS.ProcessEnv>;
  mcpServerNamesToDisable: readonly string[];
  workingDirectory: string;
}
```

- The discovery result contains only unique records whose CLI `enabled` value is `true`.
- `buildAppServerArguments()` validates every name again before interpolating it into a dotted
  config key.

- [ ] **Step 1: Write failing MCP discovery contract tests**

Create `codex-mcp-discovery.test.ts` with a fake `ProcessRunner` and these concrete cases:

```ts
const directServers = [
  { enabled: true, name: "confluence-wiki-mcp", transport: { type: "stdio" } },
  { enabled: false, name: "computer-use", transport: { type: "stdio" } },
  { enabled: true, name: "node_repl", transport: { type: "stdio" } },
];

await expect(
  discoverEnabledMcpServerNames(options(result(JSON.stringify(directServers)))),
).resolves.toEqual(["confluence-wiki-mcp", "node_repl"]);

expect(runner.requests[0]).toMatchObject({
  arguments: [
    "mcp",
    "list",
    "--json",
    ...APP_SERVER_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
  ],
  cwd: "/tmp/huayi-empty",
  executable: "/opt/codex",
  input: "",
  maximumOutputBytes: 64 * 1024,
  timeoutMs: 10_000,
});
expect(runner.requests[0]?.env).toEqual({ HOME: "/Users/tester", PATH: "/usr/bin" });
```

Add table-driven rejections for:

```ts
[
  ["nonzero exit", result("[]", 1)],
  ["signal exit", { ...result("[]"), signal: "SIGTERM" as const }],
  ["invalid JSON", result("not-json")],
  ["non-array JSON", result("{}")],
  ["missing enabled", result('[{"name":"node_repl"}]')],
  ["invalid name", result('[{"enabled":true,"name":"bad.name"}]')],
  ["duplicate name", result('[{"enabled":true,"name":"same"},{"enabled":false,"name":"same"}]')],
  [
    "too many records",
    result(
      JSON.stringify(
        Array.from({ length: 129 }, (_, index) => ({
          enabled: false,
          name: `server-${index}`,
        })),
      ),
    ),
  ],
];
```

Each rejection must expose only `{ code: "CODEX_CAPABILITY_MISSING", retryable: false }`, never
the fake stdout/stderr body. Add a separate runner-rejection case for timeout/output-limit/spawn
errors mapping to the same public error.

- [ ] **Step 2: Run the discovery test and verify RED**

Run:

```bash
pnpm exec vitest run --workspace vitest.workspace.ts \
  apps/native-host/src/runtime/codex-mcp-discovery.test.ts
```

Expected: FAIL because `codex-mcp-discovery.ts` and `discoverEnabledMcpServerNames` do not exist.

- [ ] **Step 3: Write failing argument-builder and feature-lock tests**

Update `codex-app-server-process.test.ts` so the process is created with:

```ts
createNodeAppServerProcess({
  codexExecutable: "/opt/homebrew/bin/codex",
  environment: { HOME: "/Users/tester", OPENAI_API_KEY: "secret", PATH: "/usr/bin" },
  mcpServerNamesToDisable: ["confluence-wiki-mcp", "node_repl"],
  workingDirectory: "/tmp/huayi-empty",
});
```

Assert the spawned arguments:

```ts
const arguments_ = buildAppServerArguments(["confluence-wiki-mcp", "node_repl"]);
expect(arguments_).not.toContain("tools.view_image=false");
expect(arguments_).not.toContain("mcp_servers={}");
expect(arguments_).toEqual(
  expect.arrayContaining([
    "--config",
    "mcp_servers.confluence-wiki-mcp.enabled=false",
    "--config",
    "mcp_servers.node_repl.enabled=false",
  ]),
);
expect(() => buildAppServerArguments(["bad.name"])).toThrow(/MCP server name/u);
expect(spawn).toHaveBeenCalledWith("/opt/homebrew/bin/codex", [...arguments_], {
  cwd: "/tmp/huayi-empty",
  env: { HOME: "/Users/tester", PATH: "/usr/bin" },
  shell: false,
  stdio: ["pipe", "pipe", "pipe"],
});
```

Expand `APP_SERVER_DISABLED_FEATURES` and its capability test to include the currently supported
execution surfaces:

```ts
[
  "apps",
  "auth_elicitation",
  "browser_use",
  "browser_use_external",
  "browser_use_full_cdp_access",
  "computer_use",
  "enable_mcp_apps",
  "hooks",
  "image_generation",
  "in_app_browser",
  "memories",
  "multi_agent",
  "plugins",
  "remote_plugin",
  "shell_snapshot",
  "shell_tool",
  "skill_mcp_dependency_install",
  "tool_call_mcp_elicitation",
  "tool_suggest",
  "unified_exec",
  "workspace_dependencies",
];
```

Import this constant in `codex-capabilities.test.ts` instead of maintaining a second name list.
The existing health and installer checks must continue proving every entry is reported as false.

- [ ] **Step 4: Run the config/process tests and verify RED**

Run:

```bash
pnpm exec vitest run --workspace vitest.workspace.ts \
  apps/native-host/src/runtime/codex-app-server-process.test.ts \
  apps/native-host/src/runtime/codex-capabilities.test.ts
```

Expected: FAIL because process options are static, the two rejected overrides remain and the new
feature list is absent.

- [ ] **Step 5: Implement the bounded discovery parser**

Implement `codex-mcp-discovery.ts` around these constants and guards:

```ts
const MCP_DISCOVERY_MAXIMUM_OUTPUT_BYTES = 64 * 1024;
const MCP_DISCOVERY_MAXIMUM_SERVERS = 128;
const MCP_DISCOVERY_TIMEOUT_MS = 10_000;

interface McpListRecord {
  enabled: boolean;
  name: string;
}

function parseMcpList(stdout: string): readonly string[] {
  const value: unknown = JSON.parse(stdout);
  if (!Array.isArray(value) || value.length > MCP_DISCOVERY_MAXIMUM_SERVERS) {
    throw new TypeError("Invalid Codex MCP list.");
  }
  const seen = new Set<string>();
  const enabled: string[] = [];
  for (const candidate of value) {
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate) ||
      typeof (candidate as { name?: unknown }).name !== "string" ||
      typeof (candidate as { enabled?: unknown }).enabled !== "boolean"
    ) {
      throw new TypeError("Invalid Codex MCP record.");
    }
    const record = candidate as McpListRecord;
    if (!isSafeMcpServerName(record.name) || seen.has(record.name)) {
      throw new TypeError("Invalid Codex MCP server name.");
    }
    seen.add(record.name);
    if (record.enabled) enabled.push(record.name);
  }
  return enabled;
}
```

Run the command using `APP_SERVER_DISABLED_FEATURES`, the allowed environment, 10-second timeout
and 64 KiB limit. Require `exitCode === 0` and `signal === null`; catch every runner/parser failure
and throw `capabilityMissingError(error)` without logging command output.

- [ ] **Step 6: Implement compatible argument construction**

In `codex-app-server-config.ts`:

```ts
const MCP_SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;

export function isSafeMcpServerName(name: string): boolean {
  return MCP_SERVER_NAME_PATTERN.test(name);
}

export function buildAppServerArguments(
  mcpServerNamesToDisable: readonly string[],
): readonly string[] {
  if (mcpServerNamesToDisable.length > 128) {
    throw new TypeError("Too many MCP server names.");
  }
  const seen = new Set<string>();
  const overrides = mcpServerNamesToDisable.flatMap((name) => {
    if (!isSafeMcpServerName(name) || seen.has(name)) {
      throw new TypeError("Invalid MCP server name.");
    }
    seen.add(name);
    return ["--config", `mcp_servers.${name}.enabled=false`];
  });
  return [
    "app-server",
    "--stdio",
    "--strict-config",
    ...APP_SERVER_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
    ...APP_SERVER_CONFIG_OVERRIDES.flatMap((config) => ["--config", config]),
    ...overrides,
  ];
}
```

Remove `tools.view_image=false` and `mcp_servers={}` from both
`APP_SERVER_CONFIG_OVERRIDES` and `HUAYI_THREAD_CONFIG`. Add
`mcpServerNamesToDisable` to `NodeAppServerProcessOptions` and call
`buildAppServerArguments(options.mcpServerNamesToDisable)` inside `spawn`.

- [ ] **Step 7: Run focused tests and related quality checks**

Run:

```bash
pnpm exec vitest run --workspace vitest.workspace.ts \
  apps/native-host/src/runtime/codex-mcp-discovery.test.ts \
  apps/native-host/src/runtime/codex-app-server-process.test.ts \
  apps/native-host/src/runtime/codex-capabilities.test.ts \
  apps/native-host/src/install/macos.test.ts
pnpm --filter @huayi/native-host typecheck
pnpm lint
git diff --check
```

Expected: all commands pass; no test starts a real Codex process.

- [ ] **Step 8: Commit Task 1**

```bash
git add \
  apps/native-host/src/runtime/codex-mcp-discovery.ts \
  apps/native-host/src/runtime/codex-mcp-discovery.test.ts \
  apps/native-host/src/runtime/codex-app-server-config.ts \
  apps/native-host/src/runtime/codex-app-server-process.test.ts \
  apps/native-host/src/runtime/codex-capabilities.test.ts
git commit -m "fix(host): discover configured mcp servers"
```

### Task 2: Gate App Server startup on MCP discovery

**Files:**

- Modify: `apps/native-host/src/runtime/codex-app-server-lifecycle.ts`
- Modify: `apps/native-host/src/runtime/codex-app-server.ts`
- Modify: `apps/native-host/src/runtime/codex-app-server-startup.test.ts`
- Modify: `apps/native-host/src/runtime/codex-app-server-security.test.ts`
- Modify: `apps/native-host/src/runtime/codex-app-server.test.ts`
- Modify: `apps/native-host/src/main.ts`
- Modify: `apps/native-host/src/main.test.ts`

**Interfaces:**

- Consumes: `discoverEnabledMcpServerNames(options)` and Task 1's
  `NodeAppServerProcessOptions.mcpServerNamesToDisable`.
- Produces this required constructor dependency:

```ts
export type McpServerDiscovery = () => Promise<readonly string[]>;

export interface CodexAppServerClientOptions {
  codexExecutable: string;
  environment: Readonly<NodeJS.ProcessEnv>;
  mcpServerDiscovery: McpServerDiscovery;
  processFactory?: (options: NodeAppServerProcessOptions) => JsonRpcProcess;
  timeoutMs?: number;
  workingDirectory: string;
}
```

- Every test client injects `mcpServerDiscovery: async () => []`; production injects the real
  no-model discovery closure. There is no unsafe default.

- [ ] **Step 1: Write failing startup-order and failure-mapping tests**

Extend `codex-app-server-startup.test.ts` with a deferred discovery and a captured process factory:

```ts
it("discovers MCP servers before creating App Server", async () => {
  let resolveDiscovery: (names: readonly string[]) => void = () => undefined;
  const discovery = new Promise<readonly string[]>((resolve) => {
    resolveDiscovery = resolve;
  });
  const process = new FakeAppServerProcess();
  const processFactory = vi.fn(() => process);
  const client = new CodexAppServerClient({
    codexExecutable: "codex",
    environment: {},
    mcpServerDiscovery: () => discovery,
    processFactory,
    workingDirectory: "/tmp/huayi-empty",
  });
  const observation = observe(run(client, "discovery-order", new AbortController()));

  await Promise.resolve();
  expect(processFactory).not.toHaveBeenCalled();
  resolveDiscovery(["node_repl"]);
  await process.takeRequest("initialize");
  expect(processFactory).toHaveBeenCalledWith(
    expect.objectContaining({
      mcpServerNamesToDisable: ["node_repl"],
    }),
  );
  client.dispose();
  expect(observation.rejection).toEqual(expect.objectContaining({ code: "CANCELLED" }));
});
```

Add these cases:

- discovery rejection returns `CODEX_CAPABILITY_MISSING` and never calls `processFactory`;
- two concurrent turns during one startup call discovery once;
- after an App Server process failure, the next turn calls discovery again;
- cancellation isolation regression remains green while a different turn is active.

- [ ] **Step 2: Run startup tests and verify RED**

Run:

```bash
pnpm exec vitest run --workspace vitest.workspace.ts \
  apps/native-host/src/runtime/codex-app-server-startup.test.ts
```

Expected: FAIL because `CodexAppServerClientOptions` has no discovery dependency and process
creation happens immediately.

- [ ] **Step 3: Add the required discovery dependency and startup gate**

In `codex-app-server-lifecycle.ts`, add `McpServerDiscovery` and require it in the client options.
In `CodexAppServerClient`, store it and change only `#startSession()` startup ordering:

```ts
async #startSession(): Promise<Session> {
  let process: JsonRpcProcess;
  try {
    const mcpServerNamesToDisable = await this.#mcpServerDiscovery();
    if (this.#disposed) throw cancelledError();
    process = this.#processFactory({
      codexExecutable: this.#codexExecutable,
      environment: this.#environment,
      mcpServerNamesToDisable,
      workingDirectory: this.#workingDirectory,
    });
  } catch (error) {
    if (error instanceof CodexProviderError && error.code === "CANCELLED") throw error;
    throw capabilityMissingError(error);
  }
  // Existing monitored-process, channel and initialize logic stays unchanged.
}
```

`#ensureSession()` already shares `#sessionPromise`, so it also shares discovery for concurrent
turns. Existing failure cleanup must continue clearing the session so a later restart discovers
again. Do not add discovery logic to `runTurn()` or the provider.

- [ ] **Step 4: Wire production discovery in `main.ts`**

Import `discoverEnabledMcpServerNames` and pass a closure using the already injected process
runner:

```ts
const appServer = new CodexAppServerClient({
  codexExecutable: options.codexExecutable,
  environment: options.environment,
  mcpServerDiscovery: () =>
    discoverEnabledMcpServerNames({
      codexExecutable: options.codexExecutable,
      environment: options.environment,
      processRunner: options.processRunner,
      workingDirectory: options.workingDirectory,
    }),
  workingDirectory: options.workingDirectory,
});
```

Update every fake client in App Server tests with `mcpServerDiscovery: async () => []`. Add a
`main.test.ts` assertion that health-only and Eudic-only requests do not call `mcp list`; discovery
must remain lazy until analysis creates an App Server.

- [ ] **Step 5: Run the App Server and bootstrap regression suite**

Run:

```bash
pnpm exec vitest run --workspace vitest.workspace.ts \
  apps/native-host/src/runtime/codex-mcp-discovery.test.ts \
  apps/native-host/src/runtime/codex-app-server-process.test.ts \
  apps/native-host/src/runtime/codex-app-server-startup.test.ts \
  apps/native-host/src/runtime/codex-app-server-security.test.ts \
  apps/native-host/src/runtime/codex-app-server.test.ts \
  apps/native-host/src/main.test.ts
pnpm --filter @huayi/native-host typecheck
git diff --check
```

Expected: all tests pass, including the existing startup-cancellation isolation regression.

- [ ] **Step 6: Commit Task 2**

```bash
git add \
  apps/native-host/src/runtime/codex-app-server-lifecycle.ts \
  apps/native-host/src/runtime/codex-app-server.ts \
  apps/native-host/src/runtime/codex-app-server-startup.test.ts \
  apps/native-host/src/runtime/codex-app-server-security.test.ts \
  apps/native-host/src/runtime/codex-app-server.test.ts \
  apps/native-host/src/main.ts \
  apps/native-host/src/main.test.ts
git commit -m "fix(host): isolate app server startup capabilities"
```

### Task 3: Accept safe Hook records and inert MCP status records

**Files:**

- Create: `apps/native-host/src/runtime/codex-app-server-protocol.test.ts`
- Modify: `apps/native-host/src/runtime/codex-app-server-protocol.ts`
- Modify: `apps/native-host/src/runtime/codex-app-server-security.test.ts`

**Interfaces:**

- Consumes: App Server responses from `hooks/list` and `mcpServerStatus/list`.
- Produces:

```ts
export function isSafeHooksResponse(value: unknown, workingDirectory: string): boolean;
export function isInertMcpResponse(value: unknown): boolean;
```

- `initializeAppServerChannel()` requests at most 128 MCP status entries and calls both guards
  before any `thread/start` request.

- [ ] **Step 1: Write pure guard tests for observed safe records**

Create `codex-app-server-protocol.test.ts`:

```ts
const safeHook = {
  cwd: "/tmp/huayi-empty",
  errors: [],
  hooks: [],
  warnings: [],
};
const inertMcp = {
  authStatus: "unsupported",
  name: "node_repl",
  resourceTemplates: [],
  resources: [],
  serverInfo: null,
  tools: {},
};

expect(isSafeHooksResponse({ data: [safeHook] }, "/tmp/huayi-empty")).toBe(true);
expect(isSafeHooksResponse({ data: [] }, "/tmp/huayi-empty")).toBe(true);
expect(isInertMcpResponse({ data: [inertMcp], nextCursor: null })).toBe(true);
expect(isInertMcpResponse({ data: [], nextCursor: null })).toBe(true);
```

Add rejections for:

```ts
[
  { ...safeHook, cwd: "/Users/tester/project" },
  { ...safeHook, hooks: [{}] },
  { ...safeHook, warnings: ["warning"] },
  { ...safeHook, errors: ["error"] },
];
```

and:

```ts
[
  { ...inertMcp, serverInfo: { name: "active" } },
  { ...inertMcp, tools: { run: {} } },
  { ...inertMcp, resources: [{}] },
  { ...inertMcp, resourceTemplates: [{}] },
  { ...inertMcp, serverInfo: undefined },
];
```

Also reject non-object entries, missing required fields, unknown top-level response fields and a
non-null `nextCursor`.

- [ ] **Step 2: Run the protocol test and verify RED**

Run:

```bash
pnpm exec vitest run --workspace vitest.workspace.ts \
  apps/native-host/src/runtime/codex-app-server-protocol.test.ts
```

Expected: FAIL because the safe/inert guard functions do not exist.

- [ ] **Step 3: Implement strict safe-state guards**

Replace `isEmptyHooksResponse` and `isEmptyMcpResponse` with focused helpers:

```ts
function isEmptyArray(value: unknown): value is [] {
  return Array.isArray(value) && value.length === 0;
}

function isEmptyObject(value: unknown): value is Record<string, never> {
  return isObject(value) && Object.keys(value).length === 0;
}

export function isSafeHooksResponse(value: unknown, workingDirectory: string): boolean {
  return (
    isObject(value) &&
    Object.keys(value).every((key) => key === "data") &&
    Array.isArray(value.data) &&
    value.data.every(
      (record) =>
        isObject(record) &&
        Object.keys(record).every((key) => ["cwd", "errors", "hooks", "warnings"].includes(key)) &&
        record.cwd === workingDirectory &&
        isEmptyArray(record.errors) &&
        isEmptyArray(record.hooks) &&
        isEmptyArray(record.warnings),
    )
  );
}
```

Implement the MCP guard with the known metadata keys `authStatus`, `name`, `resourceTemplates`,
`resources`, `serverInfo` and `tools`. Require a non-empty name, string `authStatus`,
`serverInfo === null`, an empty tools object, empty resource arrays and `nextCursor === null`.
Reject missing fields and all unknown keys. Keep the response-level keys exactly `data` and
`nextCursor`.

Update initialization:

```ts
const mcpServers = await channel.request("mcpServerStatus/list", {
  detail: "toolsAndAuthOnly",
  limit: 128,
});
if (!isSafeHooksResponse(hooks, workingDirectory) || !isInertMcpResponse(mcpServers)) {
  throw new AppServerInvariantError();
}
```

- [ ] **Step 4: Add end-to-end security regressions**

Update `codex-app-server-security.test.ts` so one startup with `[safeHook]` and `[inertMcp]`
reaches `thread/start`. Retain fail-closed tests using an active Hook record and an MCP record with
a non-empty `tools` object; both must reject with `CODEX_CAPABILITY_MISSING` before `thread/start`.

- [ ] **Step 5: Run focused protocol and security tests**

Run:

```bash
pnpm exec vitest run --workspace vitest.workspace.ts \
  apps/native-host/src/runtime/codex-app-server-protocol.test.ts \
  apps/native-host/src/runtime/codex-app-server-security.test.ts \
  apps/native-host/src/runtime/codex-app-server-startup.test.ts \
  apps/native-host/src/runtime/codex-app-server.test.ts
pnpm --filter @huayi/native-host typecheck
pnpm lint
git diff --check
```

Expected: all tests pass; active or unknown Hook/MCP capabilities remain rejected.

- [ ] **Step 6: Commit Task 3**

```bash
git add \
  apps/native-host/src/runtime/codex-app-server-protocol.ts \
  apps/native-host/src/runtime/codex-app-server-protocol.test.ts \
  apps/native-host/src/runtime/codex-app-server-security.test.ts
git commit -m "fix(host): accept inert app server capability records"
```

### Task 4: Release v0.3.1 and update long-term documentation

**Files:**

- Modify: `package.json`
- Modify: `apps/extension/package.json`
- Modify: `apps/extension/manifest.json`
- Modify: `apps/native-host/package.json`
- Modify: `packages/protocol/package.json`
- Modify: `scripts/version-consistency.test.mjs`
- Modify: `apps/native-host/src/protocol/dispatcher.ts`
- Modify: `apps/native-host/src/protocol/dispatcher.test.ts`
- Modify: `apps/native-host/src/runtime/codex-app-server-protocol.ts`
- Modify: `apps/native-host/src/runtime/codex-app-server.test.ts`
- Modify: `apps/native-host/src/wordbook/eudic-client.ts`
- Modify: `apps/native-host/src/wordbook/eudic-client.test.ts`
- Modify: `apps/native-host/src/main.test.ts`
- Modify: `AGENTS.md`
- Modify: `apps/native-host/AGENTS.md`
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/security.md`
- Modify: `docs/testing.md`
- Modify: `docs/setup-macos.md`

**Interfaces:**

- Consumes: Tasks 1–3's production behavior and the approved design.
- Produces: release-consistent `0.3.1` metadata, Host/User-Agent identifiers and Chinese operating
  documentation. The wire protocol remains version 1.

- [ ] **Step 1: Make the version consistency test fail for v0.3.1**

Change only the expected release version first:

```js
assert.equal(rootPackage.version, "0.3.1");
assert.equal(extensionManifest.version, "0.3.1");
```

Run:

```bash
node --test scripts/version-consistency.test.mjs
```

Expected: FAIL showing the current root and Manifest versions are `0.3.0`.

- [ ] **Step 2: Upgrade every release and runtime version surface**

Set `0.3.1` in the root and three workspace `package.json` files plus
`apps/extension/manifest.json`. Update:

```ts
const HOST_VERSION = "0.3.1";
clientInfo: { name: "huayi", title: "Huayi Native Host", version: "0.3.1" };
"User-Agent": "Huayi/0.3.1";
```

Update only the corresponding version assertions in dispatcher, App Server, Eudic and main tests.
Do not change protocol compatibility fixtures that intentionally use older `hostVersion` values.
Do not edit `pnpm-lock.yaml`; it does not contain workspace package versions.

- [ ] **Step 3: Verify all version surfaces**

Run:

```bash
node --test scripts/version-consistency.test.mjs
pnpm exec vitest run --workspace vitest.workspace.ts \
  apps/native-host/src/protocol/dispatcher.test.ts \
  apps/native-host/src/runtime/codex-app-server.test.ts \
  apps/native-host/src/wordbook/eudic-client.test.ts \
  apps/native-host/src/main.test.ts
```

Expected: PASS with all current Host identifiers reporting `0.3.1`.

- [ ] **Step 4: Update English repository instructions**

In root `AGENTS.md`, add the approved v0.3.1 design and this plan to Sources of Truth. In
`apps/native-host/AGENTS.md`, replace the empty MCP table/no-image-field rules with durable rules:

```text
- Discover directly configured MCP servers with the no-model `codex mcp list --json` command
  before each App Server process start; validate names and disable every enabled server with an
  individual config override.
- Never use unsupported config keys or `mcp_servers={}` as a substitute for verified isolation.
- Accept Hook records only for the dedicated cwd with empty hooks/warnings/errors, and MCP status
  records only when disconnected and without tools, resources or templates.
- Any discovery failure, unsafe name, active capability or unknown response shape fails closed.
```

Synchronize the final disabled feature list. Keep root instructions below 12 KiB, the Host file
below 6 KiB and every root+nested combination below 32 KiB.

- [ ] **Step 5: Update Chinese architecture, security, testing and installation docs**

Make these exact documentation changes:

- `README.md`: label current capability/scope as v0.3.1 and describe startup discovery,
  per-server disables and inert-state verification instead of empty MCP configuration.
- `docs/architecture.md`: insert discovery before process creation and explain rediscovery after
  process restart; Hook/MCP records may exist only in the documented safe state.
- `docs/security.md`: document the 128-record/name limits, removal of `tools.view_image=false` and
  `mcp_servers={}`, defense-in-depth argument validation and active-capability rejection.
- `docs/testing.md`: list fake MCP discovery, compatible argument regression, safe Hook/inert MCP
  acceptance and active-record rejection.
- `docs/setup-macos.md`: synchronize the expanded feature list and add a v0.3.0 → v0.3.1 upgrade
  section: build, sync the extension's currently loaded directory, reload Chrome, reinstall the
  Host using the same extension ID, and preserve the Eudic Keychain item.

Keep historical v0.3.0 streaming design/plan and `docs/protocol.md` unchanged because no wire
contract changes.

- [ ] **Step 6: Verify instruction, formatting and documentation consistency**

Run:

```bash
pnpm check:instructions
pnpm format:check
pnpm lint
node --test scripts/version-consistency.test.mjs
git diff --check
```

Expected: all commands pass and no generated `dist/` file is tracked.

- [ ] **Step 7: Commit Task 4**

```bash
git add \
  AGENTS.md \
  README.md \
  package.json \
  apps/extension/package.json \
  apps/extension/manifest.json \
  apps/native-host/AGENTS.md \
  apps/native-host/package.json \
  apps/native-host/src/main.test.ts \
  apps/native-host/src/protocol/dispatcher.ts \
  apps/native-host/src/protocol/dispatcher.test.ts \
  apps/native-host/src/runtime/codex-app-server-protocol.ts \
  apps/native-host/src/runtime/codex-app-server.test.ts \
  apps/native-host/src/wordbook/eudic-client.ts \
  apps/native-host/src/wordbook/eudic-client.test.ts \
  packages/protocol/package.json \
  scripts/version-consistency.test.mjs \
  docs/architecture.md \
  docs/security.md \
  docs/testing.md \
  docs/setup-macos.md
git commit -m "docs: release codex compatibility hotfix"
```

### Task 5: Verify, install and replace the local v0.3.1 build

**Files:**

- Verify only: all tracked source and test files.
- Build ignored output: `apps/extension/dist/`, `apps/native-host/dist/`.
- External installation: `~/Library/Application Support/Huayi/native-host/` and the exact Huayi
  Chrome Native Messaging manifest.
- Existing Chrome-loaded build target:
  `/Users/niuzhenya/Documents/translate/apps/extension/dist/`.

**Interfaces:**

- Consumes: the complete v0.3.1 source tree.
- Produces: a verified Host installation and matching Chrome build for extension ID
  `kfkamoejomjdihipgdkmfjcdenlhgnpd` without changing the Eudic credential.

- [ ] **Step 1: Run the complete automatic quality gate**

Run from the feature worktree:

```bash
pnpm check:instructions
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
git diff --check
```

Expected: every command exits zero. Do not run `pnpm smoke:codex`; it calls a real model and is not
authorized by this hotfix plan.

- [ ] **Step 2: Run a real no-model Codex compatibility diagnostic**

Using `/Applications/ChatGPT.app/Contents/Resources/codex`, verify without sending a prompt:

1. `mcp list --json` succeeds with every `APP_SERVER_DISABLED_FEATURES` flag applied.
2. Every enabled direct MCP name passes the safe-name pattern.
3. App Server starts with the generated per-server disables and no `tools.view_image` or blanket
   `mcp_servers={}` override.
4. `initialize`, `hooks/list`, `mcpServerStatus/list` and `thread/start` satisfy the production
   guards; terminate before `turn/start` so no model is called and no subscription quota is used.

Expected: initialization reports the target empty cwd Hook record, only inert MCP records and a
`gpt-5.4-mini` / `low` / read-only / no-network / ephemeral thread.

- [ ] **Step 3: Dry-run and reinstall the Native Host**

Run:

```bash
pnpm host:install -- \
  --extension-id kfkamoejomjdihipgdkmfjcdenlhgnpd \
  --codex-path /Applications/ChatGPT.app/Contents/Resources/codex \
  --dry-run
pnpm host:install -- \
  --extension-id kfkamoejomjdihipgdkmfjcdenlhgnpd \
  --codex-path /Applications/ChatGPT.app/Contents/Resources/codex
```

Expected: both commands succeed, the manifest keeps only
`chrome-extension://kfkamoejomjdihipgdkmfjcdenlhgnpd/`, installed Host health reports `0.3.1`,
and the existing Eudic Keychain item is neither read nor changed by installation.

- [ ] **Step 4: Replace the build at Chrome's existing load path**

After verifying both paths are exactly the project-owned build directories, run:

```bash
rsync -a --delete \
  /Users/niuzhenya/Documents/translate/.worktrees/eudic-wordbook/apps/extension/dist/ \
  /Users/niuzhenya/Documents/translate/apps/extension/dist/
diff -qr \
  /Users/niuzhenya/Documents/translate/.worktrees/eudic-wordbook/apps/extension/dist \
  /Users/niuzhenya/Documents/translate/apps/extension/dist
```

Expected: `diff -qr` prints nothing and the target Manifest version is `0.3.1`. The user must click
Reload for “划译” in `chrome://extensions`; automation must not inspect Chrome profile files or
work around browser restrictions.

- [ ] **Step 5: Confirm repository state and push the existing PR branch**

Run:

```bash
git status --short
git log --oneline -8
git push origin codex/eudic-wordbook
```

Expected: tracked worktree is clean, ignored build output is uncommitted, and Draft PR
`https://github.com/Neil0619/huayi/pull/1` includes the v0.3.1 commits.

After the user reloads Chrome, have them retry one word translation. Success means visible streaming
text followed by the complete card, with no `CODEX_CAPABILITY_MISSING`; an existing Eudic word still
shows its saved status independently.
