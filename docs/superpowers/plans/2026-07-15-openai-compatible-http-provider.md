# 划译 OpenAI-Compatible HTTP Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为划译 v0.6.0 增加一个与 Codex CLI、官方 OpenAI Provider 完全隔离的 OpenAI-Compatible HTTP Provider，在用户明确确认明文 HTTP 风险后，以 `gpt-5.4-mini + low` 严格流式返回翻译和解释结果。

**Architecture:** Native Host 继续通过 `RoutingAnalysisProvider` 按请求读取 `provider.json`，但第三方端点配置独立保存在 `compatible-http.json`，Key 独立保存在 macOS Keychain。新 Provider 使用独立的 HTTP Client、严格 SSE 方言 Parser 和生命周期状态机；官方 OpenAI Parser、Codex 配置、Extension 流式协议和 DOM 渲染均不放宽。

**Tech Stack:** TypeScript 5.8、Node.js 18+ 内置 `fetch`、OpenAI Responses-compatible SSE、Chrome Manifest V3、Native Messaging、macOS Keychain、Zod 4、Vitest、Playwright、pnpm workspace。

## Global Constraints

- 实现必须遵循 `docs/superpowers/specs/2026-07-15-openai-compatible-http-provider-design.md`。
- 根包、三个 workspace 包、Extension Manifest、Native Host health 与 App Server client identity 统一为 `0.6.0`。
- Native Messaging 协议统一为 `schemaVersion: 4`；v4 Extension 与 v4 Host 同步升级，不增加 v3/v4 兼容层。
- `ModelProvider` 固定为 `"codex" | "openai-responses" | "openai-compatible-http"`。
- 缺少 `provider.json` 时仍默认 Codex；Key、compatible 配置或 smoke 成功都不得自动改变当前 Provider。
- `provider.json` 只保存 Provider 选择；`compatible-http.json` 只保存 `baseUrl`、`model`、`effort` 和 `allowInsecureHttp`。
- 0.6.0 compatible 默认 profile 固定为 `gpt-5.4-mini + low`；另一个允许组合仅为 `gpt-5.6-luna + none`。
- 第三方 Keychain 固定为 service `com.huayi.codex_bridge.compatible_http`、account `api-key`、label `Huayi OpenAI-Compatible HTTP API Key`。
- 第三方配置和代码禁止读取或修改 `~/.codex/config.toml`、`~/.codex/auth.json`、Codex `model_providers`、登录、模型、effort 或 session。
- compatible HTTP 只能通过显式 `allowInsecureHttp: true` 启用；URL 不允许 credentials、query、fragment、尾随 `/responses` 或网页覆盖。
- HTTP 使用 POST、`redirect: "error"`、`credentials: "omit"`、无 Cookie、无重试、60 秒总超时、64 KiB 错误正文上限和 1 MiB 模型文本上限。
- 官方 `parseOpenAIResponseEvent` 和 `OpenAIResponsesProvider` 生命周期测试不得放宽。
- compatible Parser 只接受设计文档列出的实测事件、固定顺序、最多一个成对 reasoning item 和恰好一个 assistant output text；未知事件、工具、refusal、第二消息及文本不一致全部 fail closed。
- 第三方 Key 只允许通过 `/usr/bin/security` 隐藏输入写入专用 Keychain，并仅短暂进入 Host 内存与目标 Authorization Header。
- 默认测试使用 fake Keychain、fake fetch 和脱敏 fixture，不访问第三方端点、OpenAI、Codex 或欧路；只有明确授权的 `pnpm smoke:compatible` 可访问第三方。
- Extension 权限继续严格等于 `["nativeMessaging"]`；不增加设置页、storage、host permissions 或远程扩展代码。
- 新生产依赖为零；手写源码单文件在 400 行前拆分。
- 每个任务都执行失败测试、确认预期失败、最小实现、聚焦测试、相关门禁和独立 Conventional Commit。

---

## File Structure

### 新建文件

- `apps/native-host/src/config/compatible-http-configuration.ts`：严格配置 Schema、固定模型组合和 CLI 参数解析。
- `apps/native-host/src/config/compatible-http-configuration-store.ts`：安全有界读取、原子写入、status 与精确移除。
- `apps/native-host/src/credentials/compatible-http-keychain.ts`：逐请求读取第三方 Key。
- `apps/native-host/src/install/compatible-http-keychain.ts`：隐藏配置、dry-run 和精确删除第三方 Key。
- `apps/native-host/src/provider/compatible-http-responses-events.ts`：实测 compatible SSE 事件严格解析。
- `apps/native-host/src/provider/compatible-http-responses-events-test-fixtures.ts`：不含真实文本和标识的脱敏事件 fixture。
- `apps/native-host/src/provider/compatible-http-provider-errors.ts`：第三方 HTTP、SSE、认证和取消的私有错误类型。
- `apps/native-host/src/provider/compatible-http-responses-client.ts`：固定请求构造、HTTP、超时、取消与 SSE 解码。
- `apps/native-host/src/provider/compatible-http-responses-provider.ts`：compatible 生命周期、流式字段提取和最终组装。
- `apps/native-host/src/provider/responses-request-body.ts`：官方与 compatible 共用的严格 Responses 请求体纯函数。
- `apps/native-host/src/diagnostics/run-compatible-smoke.ts`：固定语料、匿名计时和严格质量退出码。
- `scripts/smoke-compatible.mjs`：拒绝参数并显式提示明文 HTTP 风险的 smoke 入口。
- 每个新 TypeScript 模块同目录创建对应 `*.test.ts`。

### 主要修改文件

- `packages/protocol/src/{limits,wire-events,index}.ts` 及测试：wire v4 与第三个 Provider 身份。
- `apps/native-host/src/config/{provider-configuration,provider-configuration-store}.ts` 及测试：第三个选择值和 CLI alias，不混入端点配置。
- `apps/native-host/src/provider/{openai-responses-client,analysis-provider-factory,routing-analysis-provider}.ts` 及测试：共享请求体、第三 Provider 与逐请求固定路由。
- `apps/native-host/src/{main,native-host-configuration}.ts` 及测试：独立配置路径、独立 Key Reader、fake fetch 注入和 health。
- `apps/native-host/src/install/{paths,cli,macos}.ts` 及测试：compatible 配置和 Key 命令、安装保留与精确生命周期。
- `apps/native-host/src/runtime/error-mapper.ts` 及测试：compatible 认证、HTTP、取消和严格响应错误映射。
- `apps/native-host/vite.config.ts`、根 `package.json`：compatible smoke 构建与命令。
- `apps/extension/src/shared/extension-messages.test.ts`、`apps/extension/src/background/*.test.ts`：v4 health Provider 和错误文案回归；业务消息形状不变。
- `README.md`、`CONTRIBUTING.md`、四个 `AGENTS.md`、`docs/{architecture,protocol,security,testing,setup-macos}.md`：协议、明文风险、凭据、配置、smoke、升级和回滚。
- 根与三个 workspace `package.json`、`apps/extension/manifest.json`、`scripts/version-consistency.test.mjs`：统一 v0.6.0。

---

### Task 1: Define wire v4 and the compatible Provider identity

**Files:**

- Modify: `packages/protocol/src/limits.ts`
- Modify: `packages/protocol/src/wire-events.ts`
- Modify: `packages/protocol/src/wire-events.test.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: every live v3 fixture returned by `rg -l 'schemaVersion: 3' apps packages scripts --glob '*.{ts,mjs}'`
- Modify: `packages/protocol/AGENTS.md`
- Modify: `docs/protocol.md`

**Interfaces:**

- Produces: `SCHEMA_VERSION = 4`.
- Produces: `ModelProvider = "codex" | "openai-responses" | "openai-compatible-http"`.
- Preserves: all analyze, progressive, wordbook and error message shapes.
- Health rule: only `codex` has non-null `codexVersion`; both HTTP Providers require null.

- [ ] **Step 1: Write failing v4 contract tests**

Add these assertions to `wire-events.test.ts`:

```ts
const compatibleHealth = {
  codexVersion: null,
  hostVersion: "0.6.0",
  model: "gpt-5.4-mini",
  provider: "openai-compatible-http",
  ready: true,
  requestId: "health-compatible",
  schemaVersion: 4,
  type: "health-result",
} as const;

expect(modelProviderSchema.parse("openai-compatible-http")).toBe("openai-compatible-http");
expect(hostEventSchema.parse(compatibleHealth)).toEqual(compatibleHealth);
expect(() => hostEventSchema.parse({ ...compatibleHealth, schemaVersion: 3 })).toThrow();
expect(() => hostEventSchema.parse({ ...compatibleHealth, codexVersion: "0.144.2" })).toThrow();
expect(() => hostEventSchema.parse({ ...compatibleHealth, endpoint: "http://example" })).toThrow();
```

Keep a Codex health fixture proving non-null `codexVersion`, and an official OpenAI fixture proving
`codexVersion: null` remains valid.

- [ ] **Step 2: Run the focused contract test and confirm failure**

```bash
pnpm exec vitest run --project protocol packages/protocol/src/wire-events.test.ts
```

Expected: FAIL because compatible Provider and wire v4 do not exist.

- [ ] **Step 3: Implement the strict Provider enum and health semantics**

Use:

```ts
export const SCHEMA_VERSION = 4;

export const modelProviderSchema = z.enum(["codex", "openai-responses", "openai-compatible-http"]);
export type ModelProvider = z.infer<typeof modelProviderSchema>;
```

Replace the API-only health branch with:

```ts
if (value.provider !== "codex" && value.codexVersion !== null) {
  context.addIssue({ code: "custom", message: "HTTP health must not report Codex." });
}
```

Do not add endpoint, effort, Key state or configuration fields to public health.

- [ ] **Step 4: Migrate only live fixtures to v4**

Change valid runtime fixtures under `apps/`, `packages/` and `scripts/` to `schemaVersion: 4`.
Retain explicit v3 rejection fixtures under a constant named `PREVIOUS_SCHEMA_VERSION`.

```bash
rg -n 'schemaVersion: 3|schemaVersion": 3' apps packages scripts \
  --glob '*.{ts,mjs,json}'
```

Expected: matches are only explicit previous-version rejection tests. Do not rewrite historical dated
specs or plans.

- [ ] **Step 5: Document the breaking upgrade and verify**

Update `packages/protocol/AGENTS.md` to wire v4 and add the v3→v4 migration note to
`docs/protocol.md`. Run:

```bash
pnpm exec vitest run --project protocol
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/protocol apps packages scripts docs/protocol.md
git commit -m "feat(protocol): add compatible provider to wire v4"
```

---

### Task 2: Separate compatible endpoint configuration from Provider selection

**Files:**

- Create: `apps/native-host/src/config/compatible-http-configuration.ts`
- Create: `apps/native-host/src/config/compatible-http-configuration.test.ts`
- Create: `apps/native-host/src/config/compatible-http-configuration-store.ts`
- Create: `apps/native-host/src/config/compatible-http-configuration-store.test.ts`
- Modify: `apps/native-host/src/config/provider-configuration.ts`
- Modify: `apps/native-host/src/config/provider-configuration.test.ts`
- Modify: `apps/native-host/src/config/provider-configuration-store.test.ts`
- Modify: `apps/native-host/src/install/paths.ts`
- Modify: `apps/native-host/src/install/paths.test.ts`

**Interfaces:**

- Produces: `CompatibleHttpConfiguration` with no `provider` field.
- Produces: `CompatibleHttpConfigurationError` with `MODEL_PROVIDER_NOT_CONFIGURED` for a missing file
  and `INTERNAL_ERROR` for an unsafe or invalid owned file.
- Produces: `CompatibleHttpConfigurationStore.read(signal): Promise<CompatibleHttpConfiguration>`.
- Produces:
  `write(configuration: CompatibleHttpConfiguration, dryRun: boolean): Promise<CompatibleConfigurationOperationResult>`.
- Produces:
  `remove(dryRun: boolean): Promise<CompatibleConfigurationOperationResult>`; CLI status calls the
  same strict `read()` and never has a relaxed parser.
- Produces: Provider CLI alias `compatible-http` → `openai-compatible-http`.
- Preserves: `ProviderConfigurationStore` as the only owner of `provider.json`.

- [ ] **Step 1: Write failing pure-schema and separation tests**

Use exact valid values:

```ts
const mini = {
  allowInsecureHttp: true,
  baseUrl: "http://101.133.153.118:9090/v1",
  effort: "low",
  model: "gpt-5.4-mini",
  schemaVersion: 1,
} as const;

expect(compatibleHttpConfigurationSchema.parse(mini)).toEqual(mini);
expect(
  compatibleHttpConfigurationSchema.parse({ ...mini, model: "gpt-5.6-luna", effort: "none" }),
).toMatchObject({ model: "gpt-5.6-luna", effort: "none" });
expect(() => compatibleHttpConfigurationSchema.parse({ ...mini, provider: "codex" })).toThrow();
expect(() =>
  compatibleHttpConfigurationSchema.parse({ ...mini, allowInsecureHttp: false }),
).toThrow();
```

Add table tests rejecting `https:`, URL credentials, query, fragment, `/responses`, trailing slash,
relative URLs, unknown models, `mini + none`, `luna + low`, unknown fields and schema version 2.
Assert `parseProviderAlias("compatible-http") === "openai-compatible-http"` and existing aliases
remain unchanged.

- [ ] **Step 2: Write failing secure-store tests**

With separate temporary paths, prove:

```ts
await providerStore.write("codex", false);
await compatibleStore.write(mini, false);
await expect(providerStore.read()).resolves.toBe("codex");
await expect(compatibleStore.read(new AbortController().signal)).resolves.toEqual(mini);
expect(await readFile(providerPath, "utf8")).not.toContain("baseUrl");
expect(await readFile(compatiblePath, "utf8")).not.toContain("provider");
```

Also cover missing file, invalid JSON, directory, symlink, wrong UID, permissions other than `0600`,
more than 4 KiB, abort before/during read, dry-run, atomic replacement failure and exact idempotent
remove. `write` must validate the current target before changing it.

- [ ] **Step 3: Run focused tests and confirm failure**

```bash
pnpm exec vitest run --project native-host \
  apps/native-host/src/config/compatible-http-configuration.test.ts \
  apps/native-host/src/config/compatible-http-configuration-store.test.ts \
  apps/native-host/src/config/provider-configuration.test.ts \
  apps/native-host/src/install/paths.test.ts
```

Expected: FAIL because compatible configuration modules/path/alias are absent.

- [ ] **Step 4: Implement strict configuration parsing**

Use a discriminated union so model/effort cannot drift:

```ts
const common = {
  allowInsecureHttp: z.literal(true),
  baseUrl: compatibleHttpBaseUrlSchema,
  schemaVersion: z.literal(1),
};

export const compatibleHttpConfigurationSchema = z.discriminatedUnion("model", [
  z.strictObject({ ...common, effort: z.literal("low"), model: z.literal("gpt-5.4-mini") }),
  z.strictObject({ ...common, effort: z.literal("none"), model: z.literal("gpt-5.6-luna") }),
]);
export type CompatibleHttpConfiguration = z.infer<typeof compatibleHttpConfigurationSchema>;
```

Normalize without adding components: parse once with `new URL`, require `protocol === "http:"`, empty
username/password/search/hash, pathname not ending in `/`, and pathname not ending in `/responses`.
The canonical value is `url.href`; only for a host-only URL may validation remove the single root slash
that `URL` adds. Require the input to equal that canonical value so percent encoding and host casing do
not silently change during storage.

- [ ] **Step 5: Implement the owned secure store and path**

Add `compatibleHttpConfigurationPath` to `MacosInstallationPaths` as
`<applicationDirectory>/compatible-http.json`. Follow the existing provider store's
`O_NOFOLLOW | O_NONBLOCK`, current UID, exact `0600`, 4 KiB, unique `wx` temporary file, file fsync,
rename and parent-directory fsync rules. A missing compatible file is an error, never a default.
Return only:

```ts
export interface CompatibleConfigurationOperationResult {
  readonly actions: readonly string[];
  readonly dryRun: boolean;
}
```

`read()` maps only `ENOENT` to
`new CompatibleHttpConfigurationError("MODEL_PROVIDER_NOT_CONFIGURED")`; invalid JSON, ownership,
mode, type, size or Schema maps to `INTERNAL_ERROR` without including file contents.

- [ ] **Step 6: Verify configuration isolation and commit**

```bash
pnpm exec vitest run --project native-host apps/native-host/src/config apps/native-host/src/install/paths.test.ts
pnpm typecheck
git add apps/native-host/src/config apps/native-host/src/install/paths.ts apps/native-host/src/install/paths.test.ts
git commit -m "feat(host): isolate compatible provider configuration"
```

---

### Task 3: Isolate the compatible API Key in macOS Keychain

**Files:**

- Create: `apps/native-host/src/credentials/compatible-http-keychain.ts`
- Create: `apps/native-host/src/credentials/compatible-http-keychain.test.ts`
- Create: `apps/native-host/src/install/compatible-http-keychain.ts`
- Create: `apps/native-host/src/install/compatible-http-keychain.test.ts`
- Modify: `apps/native-host/src/install/cli.ts`
- Modify: `apps/native-host/src/install/cli.test.ts`
- Modify: `package.json`

**Interfaces:**

- Produces: `CompatibleHttpApiKeyReader.read(signal): Promise<string>`.
- Produces constants `COMPATIBLE_HTTP_KEYCHAIN_SERVICE`, `...ACCOUNT`, `...LABEL`.
- Produces installer commands `compatible-key-configure` and `compatible-key-remove`.
- Preserves: existing official OpenAI and Eudic Keychain items and commands without migration.

- [ ] **Step 1: Write failing credential-reader tests**

Assert the process request is exactly:

```ts
expect(request).toMatchObject({
  arguments: [
    "find-generic-password",
    "-s",
    "com.huayi.codex_bridge.compatible_http",
    "-a",
    "api-key",
    "-w",
  ],
  executable: "/usr/bin/security",
  input: "",
  maximumOutputBytes: 8 * 1024,
  timeoutMs: 5_000,
});
```

Cover valid key, one removed trailing LF, leading/trailing whitespace, CR/LF/NUL/control character,
empty, more than 4,096 characters, missing exit 44, locked/nonzero Keychain, output overflow, timeout,
abort and runner failure. Assert errors and captured diagnostics never contain the fake key.

- [ ] **Step 2: Write failing configure/remove and CLI tests**

Assert configure uses exact arguments and hidden input:

```ts
expect(request.arguments).toEqual([
  "add-generic-password",
  "-U",
  "-s",
  "com.huayi.codex_bridge.compatible_http",
  "-a",
  "api-key",
  "-l",
  "Huayi OpenAI-Compatible HTTP API Key",
  "-w",
]);
expect(request.arguments.at(-1)).toBe("-w");
expect(request.arguments).not.toContain("-A");
expect(request.shell).toBe(false);
```

Parse only these forms:

```text
huayi-installer compatible-key-configure [--dry-run]
huayi-installer compatible-key-remove [--dry-run]
```

Unknown options and any value following `-w` must be impossible through the CLI union.

- [ ] **Step 3: Run focused tests and confirm failure**

```bash
pnpm exec vitest run --project native-host \
  apps/native-host/src/credentials/compatible-http-keychain.test.ts \
  apps/native-host/src/install/compatible-http-keychain.test.ts \
  apps/native-host/src/install/cli.test.ts
```

Expected: FAIL because the dedicated item and commands do not exist.

- [ ] **Step 4: Implement by adapting the existing bounded Keychain pattern**

Create a dedicated `CompatibleHttpCredentialError` with only:

```ts
type CompatibleHttpCredentialErrorCode =
  | "MODEL_PROVIDER_NOT_CONFIGURED"
  | "MODEL_PROVIDER_AUTH_FAILED"
  | "TIMEOUT"
  | "CANCELLED"
  | "INTERNAL_ERROR";
```

Do not subclass or reuse the official item constants. The implementation may reuse platform-neutral
process types, but every command must name only the dedicated service/account.

- [ ] **Step 5: Add root scripts and verify isolation**

Add:

```json
"host:compatible:key:configure": "node apps/native-host/dist/install/cli.js compatible-key-configure",
"host:compatible:key:remove": "node apps/native-host/dist/install/cli.js compatible-key-remove"
```

Test that neither command calls official OpenAI operations, compatible config operations, Provider
selection, Codex capability checks or fetch. Do not add the compatible item to automatic migration.

```bash
pnpm exec vitest run --project native-host \
  apps/native-host/src/credentials apps/native-host/src/install/compatible-http-keychain.test.ts \
  apps/native-host/src/install/cli.test.ts
pnpm typecheck
git add apps/native-host/src/credentials apps/native-host/src/install package.json
git commit -m "feat(host): isolate compatible provider credentials"
```

---

### Task 4: Parse the observed compatible SSE dialect strictly

**Files:**

- Create: `apps/native-host/src/provider/compatible-http-responses-events.ts`
- Create: `apps/native-host/src/provider/compatible-http-responses-events.test.ts`
- Create: `apps/native-host/src/provider/compatible-http-responses-events-test-fixtures.ts`
- Test unchanged: `apps/native-host/src/provider/openai-responses-events.test.ts`

**Interfaces:**

- Produces: `parseCompatibleHttpResponseEvent(message): CompatibleHttpResponseEvent`.
- Produces normalized variants for rate limits, response lifecycle, reasoning pair, assistant message,
  text delta/done and completed.
- Does not import or modify `parseOpenAIResponseEvent`.

- [ ] **Step 1: Create a complete sanitized legal fixture**

Build one fixture sequence with stable IDs and JSON text `{\"translation\":\"测试\"}`:

```ts
export const compatibleLifecycleMessages: readonly SseMessage[] = [
  compatibleMessage("codex.rate_limits", rateLimitsFixture),
  compatibleMessage("response.created", createdFixture),
  compatibleMessage("response.in_progress", inProgressFixture),
  compatibleMessage("response.output_item.added", reasoningAddedFixture),
  compatibleMessage("response.output_item.done", reasoningDoneFixture),
  compatibleMessage("response.output_item.added", assistantAddedFixture),
  compatibleMessage("response.content_part.added", partAddedFixture),
  compatibleMessage("response.output_text.delta", firstDeltaFixture),
  compatibleMessage("response.output_text.delta", secondDeltaFixture),
  compatibleMessage("response.output_text.done", textDoneFixture),
  compatibleMessage("response.completed", completedFixture),
];
```

The fixture module must also export this helper and each named fixture referenced above:

```ts
export function compatibleMessage(event: string, value: unknown): SseMessage {
  return { data: JSON.stringify(value), event };
}
```

Fixtures must contain no real request text, model output, user IDs, account IDs, tokens or headers.
Copy only field names and required primitive shapes already observed during the authorized probe.

- [ ] **Step 2: Write failing strict event tests**

Assert every legal message parses to a small normalized object. Add mutation tests for malformed JSON,
event/data type mismatch, unknown fields, unknown event, negative/unsafe sequence, oversized IDs,
tool/function/web-search/refusal items, reasoning content exposure and completed output containing more
than one item. Cross-event order, duplicate/gapped sequence, rate-limit position and second-message
checks belong to the Provider lifecycle test in Task 5.

The normalized union must be explicit:

```ts
type CompatibleSequence = { sequence: number | null };

export type CompatibleHttpResponseEvent = CompatibleSequence &
  (
    | { type: "codex.rate_limits" }
    | { responseId: string; type: "response.created" | "response.in_progress" }
    | {
        itemId: string;
        itemType: "reasoning" | "message";
        type: "response.output_item.added";
      }
    | { itemId: string; itemType: "reasoning"; type: "response.output_item.done" }
    | { itemId: string; text: string; type: "response.content_part.added" }
    | { delta: string; itemId: string; type: "response.output_text.delta" }
    | { itemId: string; text: string; type: "response.output_text.done" }
    | { itemId: string; responseId: string; text: string; type: "response.completed" }
  );
```

- [ ] **Step 3: Run focused tests and confirm failure**

```bash
pnpm exec vitest run --project native-host \
  apps/native-host/src/provider/compatible-http-responses-events.test.ts
```

Expected: FAIL because the compatible Parser is absent.

- [ ] **Step 4: Implement strict per-event Zod Schemas**

Use `z.strictObject` for event envelopes and item shapes. Permit `codex.rate_limits` only through its
observed bounded numeric/null fields and discard the normalized payload. Permit reasoning item content
only as the observed empty/encrypted summary shape; never return it. Keep identifier length ≤512,
error text ≤4,096 and sequence nonnegative safe integer. Normalize `sequence_number` to `sequence`;
use null only when the captured rate-limit or terminal event actually omits a sequence.

The Parser must check `message.event === parsed.type`; it must not ignore `[DONE]`, arbitrary metadata,
unknown event names or unknown keys.

- [ ] **Step 5: Prove official behavior is unchanged and commit**

```bash
pnpm exec vitest run --project native-host \
  apps/native-host/src/provider/compatible-http-responses-events.test.ts \
  apps/native-host/src/provider/openai-responses-events.test.ts
pnpm typecheck
git add apps/native-host/src/provider/compatible-http-responses-events*
git commit -m "feat(host): parse compatible responses events"
```

---

### Task 5: Add the bounded compatible HTTP Client and Provider lifecycle

**Files:**

- Create: `apps/native-host/src/provider/responses-request-body.ts`
- Create: `apps/native-host/src/provider/responses-request-body.test.ts`
- Create: `apps/native-host/src/provider/compatible-http-provider-errors.ts`
- Create: `apps/native-host/src/provider/compatible-http-provider-errors.test.ts`
- Create: `apps/native-host/src/provider/compatible-http-responses-client.ts`
- Create: `apps/native-host/src/provider/compatible-http-responses-client.test.ts`
- Create: `apps/native-host/src/provider/compatible-http-responses-provider.ts`
- Create: `apps/native-host/src/provider/compatible-http-responses-provider.test.ts`
- Modify: `apps/native-host/src/provider/openai-responses-client.ts`
- Modify: `apps/native-host/src/provider/openai-responses-client.test.ts`
- Test unchanged: `apps/native-host/src/provider/openai-responses-provider.test.ts`

**Interfaces:**

- Produces shared request types and body builder:

```ts
export interface ResponsesModelConfiguration {
  readonly effort: "none" | "low";
  readonly model: "gpt-5.4-mini" | "gpt-5.6-luna";
}

export interface ResponsesRequest {
  readonly analysisRequest: AnalyzeRequest;
  readonly modelConfiguration: ResponsesModelConfiguration;
  readonly outputSchema: ModelOutputSchema;
  readonly outputSchemaName: string;
}

export function buildResponsesRequestBody(request: ResponsesRequest): string;
```

- Produces: `CompatibleHttpProviderError` without importing official OpenAI error classes.
- Produces:
  `CompatibleHttpResponsesClient.stream(request: ResponsesRequest, key: string, baseUrl: string, signal: AbortSignal): AsyncIterable<CompatibleHttpResponseEvent>`.
- Produces: `CompatibleHttpResponsesProvider implements AnalysisProvider`.
- Consumes: Tasks 2–4 configuration, Key Reader and normalized events.

- [ ] **Step 1: Write failing shared-body equivalence tests**

Assert the pure builder returns exactly:

```ts
expect(JSON.parse(body)).toEqual({
  input: expectedPrompt,
  model: "gpt-5.4-mini",
  reasoning: { effort: "low" },
  store: false,
  stream: true,
  text: {
    format: {
      name: "translate_lexical",
      schema: outputSchema,
      strict: true,
      type: "json_schema",
    },
  },
});
expect(JSON.parse(body)).not.toHaveProperty("tools");
expect(JSON.parse(body)).not.toHaveProperty("previous_response_id");
```

Refactor the official Client to call the pure function and retain its exact fixed endpoint and request
tests.

- [ ] **Step 2: Write failing Client boundary tests**

For configuration base `http://101.133.153.118:9090/v1`, assert fetch receives exactly
`http://101.133.153.118:9090/v1/responses`, POST, `redirect: "error"`, `credentials: "omit"`, SSE
Accept, JSON Content-Type and only `Authorization: Bearer <fake-key>` as credential.

Cover status mapping: 401 auth failed; 403/429 rate limited; 502–504 and fetch failure network; timeout;
external cancellation; 400/404/500/redirect/non-SSE/null body invalid response; error body above 64 KiB;
SSE event above existing decoder limit; and successful chunk boundaries split inside UTF-8 and SSE
frames. Assert there is one fetch call and no retry in every failure.

Define the private transport codes explicitly:

```ts
export type CompatibleHttpProviderErrorCode =
  | "MODEL_PROVIDER_AUTH_FAILED"
  | "RATE_LIMITED"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "INVALID_RESPONSE"
  | "CANCELLED"
  | "INTERNAL_ERROR";
```

The error message must be fixed and must never include response bodies, URLs, selected text or keys.

- [ ] **Step 3: Write failing Provider lifecycle tests**

Use an async event iterable to cover these accepted sequences:

1. lifecycle without `codex.rate_limits` and reasoning;
2. lifecycle with one opening rate-limit event and one complete reasoning pair;
3. multiple nonempty deltas whose done/completed text exactly equals the accumulation.

Assert progressive callbacks are the existing `AnalysisStreamUpdate` values and final output is
assembled through `parseAndAssembleModelResult`. Add rejection tests for rate limit after created,
unpaired/duplicate reasoning, message before reasoning done, duplicate assistant, duplicated/gapped/
reversed sequence, missing text done, assistant content/output done events, late event, text mismatch,
model JSON failure, private Schema failure, public result failure, more than 1 MiB accumulated UTF-8 and
cancellation.

- [ ] **Step 4: Run focused tests and confirm failure**

```bash
pnpm exec vitest run --project native-host \
  apps/native-host/src/provider/responses-request-body.test.ts \
  apps/native-host/src/provider/compatible-http-provider-errors.test.ts \
  apps/native-host/src/provider/compatible-http-responses-client.test.ts \
  apps/native-host/src/provider/compatible-http-responses-provider.test.ts \
  apps/native-host/src/provider/openai-responses-client.test.ts
```

Expected: FAIL because the shared builder and compatible Client/Provider are absent.

- [ ] **Step 5: Implement request, transport and lifecycle with independent state**

The compatible lifecycle state is:

```ts
interface CompatibleLifecycleState {
  accumulatedText: string;
  assistantItemId?: string;
  created: boolean;
  inProgress: boolean;
  lastSequence?: number;
  messageAdded: boolean;
  partAdded: boolean;
  rateLimitsSeen: boolean;
  reasoningAdded: boolean;
  reasoningDone: boolean;
  reasoningItemId?: string;
  responseId?: string;
  terminal: boolean;
  textDone: boolean;
}
```

Do not share or branch inside the official lifecycle state machine. On `response.completed`, require
response/item IDs and full text equality, call `extractor.finish()`, then
`parseAndAssembleModelResult(accumulatedText, request)`. Map validation diagnostics through the existing
bounded allowlist without page/model text. Every non-null sequence must be exactly the previous
non-null sequence plus one; null is accepted only for the opening rate-limit event and the captured
compatible terminal variant. A gap, duplicate, reversal or null on any other event fails closed.

- [ ] **Step 6: Verify official strictness and commit**

```bash
pnpm exec vitest run --project native-host \
  apps/native-host/src/provider/openai-responses-client.test.ts \
  apps/native-host/src/provider/openai-responses-events.test.ts \
  apps/native-host/src/provider/openai-responses-provider.test.ts \
  apps/native-host/src/provider/compatible-http-responses-client.test.ts \
  apps/native-host/src/provider/compatible-http-responses-events.test.ts \
  apps/native-host/src/provider/compatible-http-responses-provider.test.ts
pnpm typecheck
git add apps/native-host/src/provider
git commit -m "feat(host): add compatible responses provider"
```

---

### Task 6: Route, health-check and cancel the third Provider

**Files:**

- Modify: `apps/native-host/src/provider/routing-analysis-provider.ts`
- Modify: `apps/native-host/src/provider/routing-analysis-provider.test.ts`
- Modify: `apps/native-host/src/provider/analysis-provider-factory.ts`
- Modify: `apps/native-host/src/provider/analysis-provider-factory.test.ts`
- Modify: `apps/native-host/src/native-host-configuration.ts`
- Modify: `apps/native-host/src/main.ts`
- Modify: `apps/native-host/src/main-provider-routing.test.ts`
- Modify: `apps/native-host/src/main.test.ts`
- Modify: `apps/native-host/src/runtime/error-mapper.ts`
- Modify: `apps/native-host/src/runtime/error-mapper.test.ts`

**Interfaces:**

- `RoutingAnalysisProviderOptions` adds `compatibleHttp: AnalysisProvider`.
- `AnalysisProviderFactoryOptions` adds compatible configuration reader, Key reader and injectable fetch.
- `ActiveProviderHealth` adds compatible `{ codexVersion: null; model; provider }`.
- `NativeHostConfiguration` adds `compatibleHttpConfigurationPath` derived locally, never from env.

- [ ] **Step 1: Write failing three-way routing tests**

Assert each request reads selection once and pins its Provider:

```ts
await router.analyze(request, signal, onDelta);
expect(configurationStore.read).toHaveBeenCalledTimes(1);
expect(codex.analyze).not.toHaveBeenCalled();
expect(openAI.analyze).not.toHaveBeenCalled();
expect(compatibleHttp.analyze).toHaveBeenCalledWith(request, signal, onDelta);
```

Change the store during the pending call and prove it does not migrate; the next request uses the new
value. Assert no fallback after compatible auth/network/invalid-response errors. Warmup calls Codex only
when Codex is selected; both HTTP modes resolve locally without Keychain or fetch. Dispose all three once.

- [ ] **Step 2: Write failing factory, health and Host wiring tests**

Use injected fake readers and fetch functions. Assert compatible mode health is exactly:

```ts
{
  codexVersion: null,
  model: "gpt-5.4-mini",
  provider: "openai-compatible-http",
}
```

Health may read provider and compatible config but must not read Key, call fetch, inspect Codex or start
App Server. Assert `createNativeHostDispatcher` resolves compatible config at sibling
`compatible-http.json`; no new `HUAYI_*` environment variable is accepted.

- [ ] **Step 3: Run focused tests and confirm failure**

```bash
pnpm exec vitest run --project native-host \
  apps/native-host/src/provider/routing-analysis-provider.test.ts \
  apps/native-host/src/provider/analysis-provider-factory.test.ts \
  apps/native-host/src/main-provider-routing.test.ts \
  apps/native-host/src/runtime/error-mapper.test.ts
```

Expected: FAIL because the Router and factory have only two Providers.

- [ ] **Step 4: Implement three-way routing without a fallback branch**

Use an exhaustive switch:

```ts
switch (provider) {
  case "codex":
    return this.#codex.analyze(request, signal, onDelta);
  case "openai-responses":
    return this.#openAI.analyze(request, signal, onDelta);
  case "openai-compatible-http":
    return this.#compatibleHttp.analyze(request, signal, onDelta);
}
```

Construct the compatible Provider with its dedicated config store and Key Reader. Do not pass the
official Key Reader or endpoint constant to it.

- [ ] **Step 5: Map errors and verify cancellation**

Map compatible configuration, credential and provider errors to existing public codes:

```text
missing key/config -> MODEL_PROVIDER_NOT_CONFIGURED
401/invalid key -> MODEL_PROVIDER_AUTH_FAILED
403/429 -> RATE_LIMITED
fetch/502-504 -> NETWORK_ERROR
timeout -> TIMEOUT
abort -> CANCELLED
invalid SSE/schema/text -> INVALID_RESPONSE
unexpected local failure -> INTERNAL_ERROR
```

Use compatible-specific safe Chinese messages for the first two cases:

```text
MODEL_PROVIDER_NOT_CONFIGURED -> 第三方兼容模型服务尚未配置，请先完成本机配置。
MODEL_PROVIDER_AUTH_FAILED -> 第三方兼容模型服务授权无效，请更新专用 API Key。
```

Official OpenAI errors retain their existing messages. The public error object must not include the
configured endpoint, model response or credentials.

The existing Dispatcher cancellation must abort compatible Keychain read, fetch and stream; add a
regression test that a late terminal event does not emit `result` after `CANCELLED`.

- [ ] **Step 6: Verify and commit**

```bash
pnpm exec vitest run --project native-host \
  apps/native-host/src/provider/routing-analysis-provider.test.ts \
  apps/native-host/src/provider/analysis-provider-factory.test.ts \
  apps/native-host/src/main-provider-routing.test.ts \
  apps/native-host/src/main.test.ts \
  apps/native-host/src/runtime/error-mapper.test.ts \
  apps/native-host/src/protocol/dispatcher.test.ts
pnpm typecheck
git add apps/native-host/src
git commit -m "feat(host): route compatible provider requests"
```

---

### Task 7: Add safe configuration CLI and explicit real smoke

**Files:**

- Modify: `apps/native-host/src/install/cli.ts`
- Modify: `apps/native-host/src/install/cli.test.ts`
- Modify: `apps/native-host/src/install/macos.ts`
- Modify: `apps/native-host/src/install/macos.test.ts`
- Create: `apps/native-host/src/diagnostics/run-compatible-smoke.ts`
- Create: `apps/native-host/src/diagnostics/run-compatible-smoke.test.ts`
- Modify: `apps/native-host/vite.config.ts`
- Create: `scripts/smoke-compatible.mjs`
- Create: `scripts/smoke-compatible.test.mjs`
- Modify: `package.json`

**Interfaces:**

- Produces CLI commands `compatible-config-set|status|remove`.
- `provider-set compatible-http` validates local compatible config before writing selection.
- Produces `runConfiguredCompatibleSmoke()` and `pnpm smoke:compatible`; both read local compatible
  config and dedicated Keychain directly, regardless of active Provider.
- Produces an injectable smoke boundary:

```ts
export interface CompatibleSmokeRuntime {
  createProvider(configuration: CompatibleHttpConfiguration): AnalysisProvider;
  readConfiguration(signal: AbortSignal): Promise<CompatibleHttpConfiguration>;
  writeReport(report: CompatibleSmokeReport): void;
}

export function runConfiguredCompatibleSmoke(runtime: CompatibleSmokeRuntime): Promise<number>;
```

- [ ] **Step 1: Write failing CLI parsing tests**

Parse exactly:

```text
compatible-config-set --base-url <URL> --model gpt-5.4-mini --effort low --allow-insecure-http [--dry-run]
compatible-config-set --base-url <URL> --model gpt-5.6-luna --effort none --allow-insecure-http [--dry-run]
compatible-config-status
compatible-config-remove [--dry-run]
provider-set compatible-http [--dry-run]
```

Reject duplicated/missing flags, unknown flags, options after `--`, incompatible model/effort, omitted
risk acknowledgement and any Key argument. `compatible-config-status` prints base URL, model, effort and
the fixed warning `WARNING: API credentials and selected text use plaintext HTTP.` but no Keychain
metadata. `provider-status` still prints only the selected Provider.

- [ ] **Step 2: Write failing independence and install-preservation tests**

Assert:

```ts
await executeInstallerCommand(configSet, runtime);
expect(await providerStore.read()).toBe("codex");
await runConfiguredCompatibleSmoke(fakeSmokeRuntime);
expect(await providerStore.read()).toBe("codex");
```

`provider-set compatible-http` performs only a local strict compatible-config read before the provider
write; it does not read Keychain or fetch. Install/upgrade preserves valid `provider.json` and
`compatible-http.json`; it rejects unsafe targets instead of overwriting them. Explicit config remove
removes only `compatible-http.json`. Existing official Keychain behavior remains unchanged, and no
compatible Key deletion occurs during install, upgrade or Provider switching.

- [ ] **Step 3: Write failing smoke-runner tests**

The script wrapper rejects every argument, requires built diagnostics, prints a plaintext HTTP/charge
warning to stderr and inherits stdio. The diagnostic runner must use the fixed comparison corpus and
emit only:

```ts
interface AnonymousTiming {
  readonly caseId: string;
  readonly completedMs: number;
  readonly firstDeltaMs: number;
}

type CompatibleSmokeProfileId = "compatible-gpt-5.4-mini-low" | "compatible-gpt-5.6-luna-none";

interface CompatibleSmokeReport {
  cancelled: number;
  completed: number;
  invalid: number;
  profiles: readonly [{ id: CompatibleSmokeProfileId; cases: readonly AnonymousTiming[] }];
}
```

Each timing contains only anonymous case ID, first-delta milliseconds and completed milliseconds.
Tests spy on output and assert it excludes prompt, source text, context, generated text, Authorization,
Key, endpoint credentials and response bodies. Any invalid final Schema or failed fixed case returns 1.

- [ ] **Step 4: Run focused tests and confirm failure**

```bash
node --test scripts/smoke-compatible.test.mjs
pnpm exec vitest run --project native-host \
  apps/native-host/src/install/cli.test.ts \
  apps/native-host/src/install/macos.test.ts \
  apps/native-host/src/diagnostics/run-compatible-smoke.test.ts
```

Expected: FAIL because the CLI branches, diagnostics build and wrapper do not exist.

- [ ] **Step 5: Implement CLI, diagnostics and scripts**

Add root scripts:

```json
"host:compatible:config:set": "node apps/native-host/dist/install/cli.js compatible-config-set",
"host:compatible:config:status": "node apps/native-host/dist/install/cli.js compatible-config-status",
"host:compatible:config:remove": "node apps/native-host/dist/install/cli.js compatible-config-remove",
"smoke:compatible": "node scripts/smoke-compatible.mjs"
```

The diagnostic entrypoint constructs only `CompatibleHttpResponsesProvider`, its dedicated config/Key
readers and real built-in fetch. It must not construct, discover or start Codex and must not read
`provider.json`.

- [ ] **Step 6: Verify offline and commit**

```bash
node --test scripts/smoke-compatible.test.mjs
pnpm exec vitest run --project native-host \
  apps/native-host/src/install apps/native-host/src/diagnostics/run-compatible-smoke.test.ts
pnpm typecheck
pnpm build
git add apps/native-host scripts package.json
git commit -m "feat(host): add compatible provider lifecycle commands"
```

Do not run the real smoke in this task; it requires a later explicit user authorization after the
dedicated Keychain and config are installed.

---

### Task 8: Update Extension compatibility, governance, docs and v0.6.0 identity

**Files:**

- Modify: `AGENTS.md`
- Modify: `apps/extension/AGENTS.md`
- Modify: `apps/native-host/AGENTS.md`
- Modify: `packages/protocol/AGENTS.md`
- Modify: `README.md`
- Modify: `CONTRIBUTING.md`
- Modify: `docs/architecture.md`
- Modify: `docs/protocol.md`
- Modify: `docs/security.md`
- Modify: `docs/testing.md`
- Modify: `docs/setup-macos.md`
- Modify: `package.json`
- Modify: `apps/extension/package.json`
- Modify: `apps/native-host/package.json`
- Modify: `packages/protocol/package.json`
- Modify: `apps/extension/manifest.json`
- Modify: `pnpm-lock.yaml`
- Modify: `scripts/version-consistency.test.mjs`
- Modify: `apps/extension/src/shared/extension-messages.test.ts`
- Modify: relevant `apps/extension/src/background/*.test.ts` health fixtures

**Interfaces:**

- Produces release identity `0.6.0` everywhere.
- Extension accepts wire v4 health from all three Providers but receives no endpoint or credential.
- Documents exact configuration, smoke, switch and one-command Codex rollback flow.

- [ ] **Step 1: Write failing version and permission regression tests**

Extend `version-consistency.test.mjs` to assert root/workspace/Manifest versions are all `0.6.0`, Host
health version and App Server `clientInfo.version` are `0.6.0`, and `SCHEMA_VERSION === 4`. Preserve:

```ts
expect(manifest.permissions).toEqual(["nativeMessaging"]);
expect(manifest).not.toHaveProperty("host_permissions");
```

Add an Extension health fixture for `openai-compatible-http` and prove unknown Provider and wire v3 are
rejected without changing analyze/result rendering tests.

- [ ] **Step 2: Run focused tests and confirm failure**

```bash
node --test scripts/version-consistency.test.mjs
pnpm exec vitest run --project extension \
  apps/extension/src/manifest.test.ts \
  apps/extension/src/shared/extension-messages.test.ts \
  apps/extension/src/background/request-coordinator-warmup.test.ts
```

Expected: FAIL because identity is 0.5.0 and Extension fixtures know wire v3/two Providers.

- [ ] **Step 3: Update versioned code and governance**

Change all live package/Manifest identities to `0.6.0`, regenerate only lockfile metadata with
`pnpm install --lockfile-only`, and update current AGENTS rules to wire v4/0.6.0. Add permanent Native
Host rules for the dedicated Keychain, separate config, explicit HTTP acknowledgement, no Codex config
access, fake HTTP defaults and strict compatible dialect.

- [ ] **Step 4: Update Chinese user and security documentation**

Document the exact safe rollout:

```bash
pnpm build
pnpm host:install -- --extension-id kfkamoejomjdihipgdkmfjcdenlhgnpd \
  --codex-path /Applications/ChatGPT.app/Contents/Resources/codex
pnpm host:compatible:key:configure
pnpm host:compatible:config:set \
  --base-url http://101.133.153.118:9090/v1 \
  --model gpt-5.4-mini \
  --effort low \
  --allow-insecure-http
pnpm host:compatible:config:status
pnpm smoke:compatible
pnpm host:provider:set -- compatible-http
```

State explicitly that the last two commands require separate deliberate actions, smoke does not switch,
and rollback is:

```bash
pnpm host:provider:set -- codex
```

Security docs must state the Key, selection and context can be intercepted or modified over plaintext
HTTP; official OpenAI Key never goes to the third party; the existing official Keychain item is not
copied or deleted by this release; webpage and Extension cannot configure the endpoint.

- [ ] **Step 5: Verify docs, version and commit**

```bash
pnpm check:instructions
node --test scripts/version-consistency.test.mjs
pnpm exec vitest run --project extension
pnpm typecheck
git diff --check
git add AGENTS.md apps packages docs README.md CONTRIBUTING.md package.json pnpm-lock.yaml scripts/version-consistency.test.mjs
git commit -m "docs: release compatible provider configuration"
```

---

### Task 9: Run the offline gate, authorized smoke and controlled local replacement

**Files:**

- Modify only if a regression is found: the test and implementation file that reproduce it.
- Do not commit: local Keychain contents, installed Host files, Chrome profile state or smoke output.

**Interfaces:**

- Produces a verified v0.6.0 build and anonymous compatible smoke timings.
- Changes active Provider only after all strict smoke cases pass.
- Preserves a one-command rollback to Codex.

- [ ] **Step 1: Run the complete offline quality gate**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
git diff --check
```

Expected: every command exits 0; test logs show no real third-party, OpenAI, Codex or Eudic access.

- [ ] **Step 2: Inspect the release diff and repository state**

```bash
git status --short
git diff --stat HEAD~8..HEAD
git log --oneline --decorate -10
```

Expected: only planned source/docs/version changes; `.superpowers/sdd`, credentials, installed files and
smoke output are absent from Git.

- [ ] **Step 3: Obtain explicit authorization before external state changes**

Before running any of the following, present the user with the exact effects: write a dedicated Keychain
item, write `compatible-http.json`, call the plaintext HTTP endpoint, install Host files, switch Provider
and refresh Chrome. Do not reuse the Key previously stored in the official OpenAI item; configuration
must use the system-hidden `/usr/bin/security ... -w` prompt.

- [ ] **Step 4: Configure without changing the active Provider**

After authorization:

```bash
pnpm host:compatible:key:configure
pnpm host:compatible:config:set \
  --base-url http://101.133.153.118:9090/v1 \
  --model gpt-5.4-mini \
  --effort low \
  --allow-insecure-http
pnpm host:compatible:config:status
pnpm host:provider:status
```

Expected: config status prints the endpoint/model/plaintext warning; Provider status is still `codex`
or the user's pre-existing selection. No command reads or writes Codex config.

- [ ] **Step 5: Run the explicitly authorized real smoke**

```bash
pnpm smoke:compatible
```

Expected: exit 0, every fixed case has strict valid final output, report contains only anonymous IDs and
timings, and Provider status remains unchanged. If any case fails, stop; do not switch or install.

- [ ] **Step 6: Install and switch only after smoke passes**

```bash
pnpm host:install -- --extension-id kfkamoejomjdihipgdkmfjcdenlhgnpd \
  --codex-path /Applications/ChatGPT.app/Contents/Resources/codex
pnpm host:provider:set -- compatible-http
pnpm host:provider:status
```

Refresh the unpacked extension at `chrome://extensions`; confirm version `0.6.0`. Manual tests cover
`investigation`, `sustained`, `accountable`, sentence explanation, cancellation, retry and Eudic add/check.
Record first-visible and complete timings without recording selected/model text.

- [ ] **Step 7: Roll back on any quality, privacy or reliability problem**

```bash
pnpm host:provider:set -- codex
pnpm host:provider:status
```

Expected: status is `codex`; no third-party request occurs for the next analysis. Do not delete the
official OpenAI Keychain item without a separate explicit user request.

- [ ] **Step 8: Commit only regression fixes, then request final review**

For every discovered defect: add a test reproducing it, run the focused test failing, implement the
minimum fix, rerun focused and full gates, then commit with the matching scope. If no defect is found,
create no empty commit. Use `superpowers:requesting-code-review`, address findings, then use
`superpowers:verification-before-completion` before claiming v0.6.0 complete.
