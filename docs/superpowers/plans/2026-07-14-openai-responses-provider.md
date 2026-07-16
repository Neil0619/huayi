# OpenAI Responses Provider 与平滑流式展示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留 Codex 为默认 Provider 的前提下，为划译 v0.5.0 增加显式切换的 OpenAI Responses API Provider，并通过数组逐条流式校验和按帧 DOM Patch 提升首屏速度与展示连续性。

**Architecture:** Native Host 以严格本机配置文件和 `RoutingAnalysisProvider` 在 Codex 与 Responses 两个实现间逐请求路由，OpenAI Key 只从 macOS Keychain 读取。两个 Provider 复用同一 Prompt、私有 Schema、流式 JSON 提取器和最终组装器；Extension 继续消费 wire v3 的累计 `analysis-section`，但改用 `requestAnimationFrame` 和稳定节点增量更新。

**Tech Stack:** TypeScript 5.8、Node.js 18+ 内置 `fetch`、OpenAI Responses API、SSE、Chrome Manifest V3、Native Messaging、macOS Keychain、Zod 4、Vitest、JSDOM、Playwright、pnpm workspace。

## Global Constraints

- 实现必须遵循 `docs/superpowers/specs/2026-07-14-openai-responses-provider-design.md`。
- 应用、根包、三个 workspace 包、Extension Manifest 和 Host 统一为 `0.5.0`。
- Native Messaging 协议统一为 `schemaVersion: 3`；v3 Extension 与 v3 Host 同步升级，不实现 v2/v3 降级。
- Codex 仍是缺省 Provider；API Key 的存在不得自动启用 API，API 失败不得自动回退 Codex。
- 生产 API 配置固定为 `https://api.openai.com/v1/responses`、`gpt-5.6-luna`、`reasoning.effort: "none"`、`stream: true`、`store: false`。
- Responses 请求使用官方 `text.format = { type: "json_schema", name, strict: true, schema }` 结构；不得声明工具、Web Search、`previous_response_id` 或远程可配置参数。
- API 模式 warmup 不读取 Key、不发 HTTP；Provider 切换只影响下一次分析，活动请求不得迁移。
- OpenAI Key 只允许通过 `/usr/bin/security` 的隐藏 `-w` 交互写入 Keychain；不得通过聊天、命令参数、环境变量、普通文件或扩展消息传递。
- Keychain service 固定为 `com.huayi.codex_bridge.openai`，account 固定为 `api-key`，label 固定为 `Huayi OpenAI API Key`。
- Provider 配置固定为 `~/Library/Application Support/Huayi/native-host/provider.json`；缺失等价于 Codex，其余无效状态失败关闭。
- HTTP 使用参数化 fake fetch 测试，固定 `redirect: "error"`，不发 Cookie，不自动重试，总超时 60 秒。
- SSE 单事件上限 64 KiB、累计流上限 2 MiB、assistant JSON 上限 1 MiB；所有超限和未知关键形状失败关闭。
- 数组项只有完整解析并通过对应元素 Zod Schema 后才可发出；最终数组仍需完整校验并与累计项逐项一致。
- 所有模型文本只能通过 `textContent` 写入 DOM；不得使用 `innerHTML`。
- Extension 权限必须继续严格等于 `["nativeMessaging"]`；不增加设置页、storage、host permissions 或远程代码。
- 默认测试不得读取真实 Keychain，不得访问 OpenAI、Codex 或欧路；只有显式 smoke/compare 命令可以产生费用。
- 每个任务执行失败测试、确认预期失败、最小实现、聚焦测试、相关门禁和独立提交。
- 手写源码单文件保持在 400 行以内；新生产依赖为零。
- OpenAI 请求字段和 SSE 生命周期以官方 [Responses API reference](https://api.openai.com/v1/responses)、[Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs) 和 [GPT-5.6 guide](https://developers.openai.com/api/docs/guides/latest-model.md) 为准。

---

## File Structure

### 新建文件

- `apps/native-host/src/config/provider-configuration.ts`：Provider 名称、严格配置 Schema 和纯解析。
- `apps/native-host/src/config/provider-configuration-store.ts`：普通文件校验、有界读取、`0600` 临时文件、fsync 和原子替换。
- `apps/native-host/src/provider/routing-analysis-provider.ts`：逐请求读取配置并固定路由。
- `apps/native-host/src/credentials/openai-keychain.ts`：逐请求读取并校验 OpenAI Key。
- `apps/native-host/src/install/openai-keychain.ts`：隐藏配置、精确删除和 dry-run。
- `apps/native-host/src/provider/openai-responses-events.ts`：严格 Responses SSE 事件 Schema。
- `apps/native-host/src/provider/sse-decoder.ts`：有界 UTF-8 SSE 帧解析。
- `apps/native-host/src/provider/openai-responses-client.ts`：固定 HTTP 请求、超时、取消和响应体读取。
- `apps/native-host/src/provider/openai-responses-provider.ts`：Responses 生命周期、流式提取和最终组装。
- `apps/native-host/src/provider/openai-provider-errors.ts`：OpenAI HTTP/SSE/认证错误的私有类型与公共映射。
- `apps/native-host/src/provider/analysis-provider-factory.ts`：Host 与诊断程序复用的两类 Provider 组装。
- `apps/native-host/src/diagnostics/compare-providers.ts`：固定语料、三种 profile 和脱敏计时输出。
- `apps/extension/src/content/overlay/frame-scheduler.ts`：可注入的 rAF 调度器和无 rAF 回退。
- `apps/extension/src/content/overlay/patch-analysis-body.ts`：按 `data-huayi-section` 稳定更新文本、单值和累计列表。
- 上述每个 TypeScript 文件同目录增加 `*.test.ts`，按任务中的精确用例覆盖。

### 主要修改文件

- `packages/protocol/src/{limits,errors,wire-events,index}.ts` 及测试：wire v3、通用 Provider 错误和 health 字段。
- `apps/native-host/src/provider/{streaming-json-tokenizer,streaming-json-fields,model-analysis-schemas}.ts` 及测试：数组项更新、元素 Schema 和累计一致性。
- `apps/native-host/src/{main.ts,main.test.ts}`、`protocol/dispatcher.ts` 及测试：Router、活动 Provider health 和统一错误映射。
- `apps/native-host/src/install/{paths,cli,macos}.ts` 及测试：配置路径、Provider CLI、OpenAI Keychain 生命周期和卸载顺序。
- `apps/native-host/vite.config.ts`：新增显式 compare 诊断构建入口。
- `apps/extension/src/content/overlay/{overlay-update-batch,overlay-controller,render-result,render-streaming-preview,render-analysis-sections,styles}.ts` 及测试：按帧队列和稳定 DOM Patch。
- `scripts/verify-ephemeral-session.mjs` 及 smoke helpers：保留 Codex smoke；新增 `scripts/compare-providers.mjs` 入口测试。
- 根 `package.json`、三个 workspace `package.json`、`pnpm-lock.yaml`、`apps/extension/manifest.json`、`scripts/version-consistency.test.mjs`：v0.5.0 和新增命令。
- 四个 `AGENTS.md`、`README.md`、`CONTRIBUTING.md`、`docs/{architecture,protocol,security,testing,setup-macos}.md`：Provider、费用、凭据、协议和升级文档。

---

### Task 1: Define wire v3 health and Provider errors

**Files:**

- Modify: `packages/protocol/src/limits.ts`
- Modify: `packages/protocol/src/errors.ts`
- Modify: `packages/protocol/src/errors.test.ts`
- Modify: `packages/protocol/src/wire-events.ts`
- Modify: `packages/protocol/src/wire-events.test.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: every live v2 fixture returned by `rg -l 'schemaVersion: 2' apps packages scripts --glob '*.{ts,mjs}'`
- Modify: `packages/protocol/AGENTS.md`
- Modify: `docs/protocol.md`

**Interfaces:**

- Produces: `SCHEMA_VERSION = 3`.
- Produces: `ModelProvider = "codex" | "openai-responses"` and `modelProviderSchema`.
- Produces: `HealthResultEvent.provider`, `HealthResultEvent.model` and nullable `codexVersion`.
- Produces errors `MODEL_PROVIDER_NOT_CONFIGURED` and `MODEL_PROVIDER_AUTH_FAILED`.
- Preserves all analysis delta/section/result shapes and sequence semantics.

- [ ] **Step 1: Add failing protocol tests**

Add exact assertions:

```ts
expect(errorCodeSchema.parse("MODEL_PROVIDER_NOT_CONFIGURED")).toBe(
  "MODEL_PROVIDER_NOT_CONFIGURED",
);
expect(errorCodeSchema.parse("MODEL_PROVIDER_AUTH_FAILED")).toBe("MODEL_PROVIDER_AUTH_FAILED");

const apiHealth = {
  codexVersion: null,
  hostVersion: "0.5.0",
  model: "gpt-5.6-luna",
  provider: "openai-responses",
  ready: true,
  requestId: "health-api",
  schemaVersion: 3,
  type: "health-result",
} as const;

expect(hostEventSchema.parse(apiHealth)).toEqual(apiHealth);
expect(() => hostEventSchema.parse({ ...apiHealth, schemaVersion: 2 })).toThrow();
expect(() => hostEventSchema.parse({ ...apiHealth, endpoint: "https://evil.invalid" })).toThrow();
```

Add a Codex health fixture with `provider: "codex"`, `model: "gpt-5.4-mini"` and a non-null
`codexVersion`. Test the semantic rule with `superRefine`: Codex requires a version and API requires
`codexVersion: null`.

- [ ] **Step 2: Run focused tests and confirm failure**

```bash
pnpm exec vitest run --project protocol \
  packages/protocol/src/errors.test.ts \
  packages/protocol/src/wire-events.test.ts
```

Expected: FAIL because schema v3, the two error codes and health Provider fields do not exist.

- [ ] **Step 3: Implement the v3 types and strict health Schema**

Use these public definitions:

```ts
export const SCHEMA_VERSION = 3;

export const modelProviderSchema = z.enum(["codex", "openai-responses"]);
export type ModelProvider = z.infer<typeof modelProviderSchema>;

export const healthResultEventSchema = z
  .strictObject({
    codexVersion: z.string().trim().min(1).max(120).nullable(),
    hostVersion: z.string().trim().min(1).max(40),
    model: z.string().trim().min(1).max(120),
    provider: modelProviderSchema,
    ready: z.literal(true),
    requestId: requestIdSchema,
    schemaVersion: z.literal(SCHEMA_VERSION),
    type: z.literal("health-result"),
  })
  .superRefine((value, context) => {
    if (value.provider === "codex" && value.codexVersion === null) {
      context.addIssue({ code: "custom", message: "Codex health requires a version." });
    }
    if (value.provider === "openai-responses" && value.codexVersion !== null) {
      context.addIssue({ code: "custom", message: "API health must not report Codex." });
    }
  });
```

Keep `hostEventSchema` strict; if Zod cannot place the refined object directly in the existing
discriminated union, validate `health-result` before the remaining discriminated union in a
top-level `z.union` while preserving a literal `type` on every variant.

- [ ] **Step 4: Migrate live fixtures to v3**

Change valid live fixtures under `apps/`, `packages/` and `scripts/` to `schemaVersion: 3`. First
rename any existing “future version 3” test constant to `PREVIOUS_SCHEMA_VERSION = 2`, so rejection
coverage remains meaningful. Do not rewrite historical v0.1–v0.4 dated plans/specs.

Run:

```bash
rg -n 'schemaVersion: 2|schemaVersion": 2' apps packages scripts \
  --glob '*.{ts,mjs,json}'
```

Expected: only explicit v2 rejection fixtures remain.

- [ ] **Step 5: Update protocol governance and verify**

Update current-version language in `packages/protocol/AGENTS.md` and document the v2-to-v3 breaking
change in `docs/protocol.md`. Run:

```bash
pnpm exec vitest run --project protocol
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/protocol apps packages scripts docs/protocol.md
git commit -m "feat(protocol): define provider-aware wire v3"
```

---

### Task 2: Add strict Provider configuration and CLI switching

**Files:**

- Create: `apps/native-host/src/config/provider-configuration.ts`
- Create: `apps/native-host/src/config/provider-configuration.test.ts`
- Create: `apps/native-host/src/config/provider-configuration-store.ts`
- Create: `apps/native-host/src/config/provider-configuration-store.test.ts`
- Modify: `apps/native-host/src/install/paths.ts`
- Modify: `apps/native-host/src/install/paths.test.ts`
- Modify: `apps/native-host/src/install/cli.ts`
- Modify: `apps/native-host/src/install/cli.test.ts`
- Modify: `apps/native-host/src/install/macos.test.ts`
- Modify: `package.json`

**Interfaces:**

- Produces: `ProviderConfiguration = { schemaVersion: 1; provider: ModelProvider }`.
- Produces: `ProviderConfigurationStore.read(signal?: AbortSignal): Promise<ModelProvider>`.
- Produces: `ProviderConfigurationStore.write(provider, dryRun): Promise<ProviderConfigurationResult>`.
- Produces CLI commands `provider-set` and `provider-status`; user aliases `api` to `openai-responses`.
- Consumes: `ModelProvider` from Task 1 and `MacosInstallationPaths.providerConfigurationPath`.

- [ ] **Step 1: Add failing pure Schema and filesystem tests**

Use the strict shape:

```ts
const valid = { provider: "openai-responses", schemaVersion: 1 } as const;
expect(providerConfigurationSchema.parse(valid)).toEqual(valid);
expect(() => providerConfigurationSchema.parse({ ...valid, endpoint: "x" })).toThrow();
expect(() => providerConfigurationSchema.parse({ ...valid, schemaVersion: 2 })).toThrow();
```

With a temporary application directory, assert:

```ts
await expect(store.read()).resolves.toBe("codex");
await store.write("openai-responses", false);
await expect(store.read()).resolves.toBe("openai-responses");
expect((await stat(configurationPath)).mode & 0o777).toBe(0o600);
```

Also create an invalid JSON file, unknown-field file, directory, and symlink and assert `read()`
rejects each one without changing it. Inject a filesystem operation seam that records
`open -> write -> fsync -> close -> rename -> directory fsync`; assert a failed rename leaves the
previous valid file readable and removes only the owned temporary path.

- [ ] **Step 2: Run focused tests and confirm failure**

```bash
pnpm exec vitest run --project native-host \
  apps/native-host/src/config/provider-configuration.test.ts \
  apps/native-host/src/config/provider-configuration-store.test.ts \
  apps/native-host/src/install/paths.test.ts \
  apps/native-host/src/install/cli.test.ts
```

Expected: FAIL because the configuration modules, path and CLI branches are absent.

- [ ] **Step 3: Implement strict parsing and atomic storage**

Use:

```ts
export const providerConfigurationSchema = z.strictObject({
  provider: modelProviderSchema,
  schemaVersion: z.literal(1),
});

export function parseProviderAlias(value: string): ModelProvider {
  if (value === "api") return "openai-responses";
  if (value === "codex") return "codex";
  throw new TypeError("Provider must be api or codex.");
}
```

`read()` must use `lstat`, reject symbolic links and non-regular files, enforce a 4 KiB byte limit,
read UTF-8 once, and parse without repair. `ENOENT` alone returns `codex`. `write()` must create a
unique sibling temporary regular file with flags `wx`, mode `0o600`, write exactly one trailing
newline, fsync the file, close it, rename it and fsync the parent directory.

- [ ] **Step 4: Implement CLI set/status without Key or network access**

Extend the command union with:

```ts
| { dryRun: boolean; provider: ModelProvider; type: "provider-set" }
| { type: "provider-status" };
```

Parse these exact invocations:

```text
huayi-installer provider-set api [--dry-run]
huayi-installer provider-set codex [--dry-run]
huayi-installer provider-status
```

`provider-status` prints exactly `codex` or `openai-responses` plus the CLI output newline.
`provider-set --dry-run` reports the target but performs no write. Neither command may invoke
Keychain, Codex capabilities or fetch. Add root scripts:

```json
"host:provider:set": "node apps/native-host/dist/install/cli.js provider-set",
"host:provider:status": "node apps/native-host/dist/install/cli.js provider-status"
```

- [ ] **Step 5: Verify install lifecycle and commit**

Assert installation preserves a valid existing provider file and missing configuration remains
missing/default Codex. Assert owned uninstall removes it only as part of the owned application
directory. Run:

```bash
pnpm exec vitest run --project native-host apps/native-host/src/config apps/native-host/src/install
pnpm typecheck
```

Expected: PASS.

```bash
git add apps/native-host/src/config apps/native-host/src/install package.json
git commit -m "feat(host): add explicit provider configuration"
```

---

### Task 3: Manage the OpenAI API Key in macOS Keychain

**Files:**

- Create: `apps/native-host/src/credentials/openai-keychain.ts`
- Create: `apps/native-host/src/credentials/openai-keychain.test.ts`
- Create: `apps/native-host/src/install/openai-keychain.ts`
- Create: `apps/native-host/src/install/openai-keychain.test.ts`
- Modify: `apps/native-host/src/install/cli.ts`
- Modify: `apps/native-host/src/install/cli.test.ts`
- Modify: `apps/native-host/src/install/macos.ts`
- Modify: `apps/native-host/src/install/macos.test.ts`
- Modify: `package.json`

**Interfaces:**

- Produces: `OpenAIApiKeyReader.read(signal: AbortSignal): Promise<string>`.
- Produces constants `OPENAI_KEYCHAIN_SERVICE`, `OPENAI_KEYCHAIN_ACCOUNT`, `OPENAI_KEYCHAIN_LABEL`.
- Produces install operations `configureOpenAIApiKey` and `removeOpenAIApiKey`.
- Preserves Eudic Keychain behavior and exact uninstall ownership rules.

- [ ] **Step 1: Add failing reader and installer tests**

Assert the read command is exactly:

```ts
expect(processRequest.arguments).toEqual([
  "find-generic-password",
  "-s",
  "com.huayi.codex_bridge.openai",
  "-a",
  "api-key",
  "-w",
]);
```

Assert every call re-runs the process so a rotated Key is returned. Cover missing item exit 44,
locked Keychain, five-second timeout, abort, 8 KiB output bound, one removable trailing newline,
leading/trailing whitespace, embedded CR/LF/NUL/control characters and 4,097 characters. Capture
stdout/stderr/errors and assert neither a sentinel Key nor its prefix appears.

For configuration assert the arguments are exactly:

```ts
[
  "add-generic-password",
  "-U",
  "-s",
  OPENAI_KEYCHAIN_SERVICE,
  "-a",
  OPENAI_KEYCHAIN_ACCOUNT,
  "-l",
  OPENAI_KEYCHAIN_LABEL,
  "-w",
];
```

Assert `-w` is last, `-A` is absent, `shell` is false through the existing interactive runner, and
dry-run does not spawn. Assert removal queries and deletes only the exact service/account.

- [ ] **Step 2: Run tests and confirm failure**

```bash
pnpm exec vitest run --project native-host \
  apps/native-host/src/credentials/openai-keychain.test.ts \
  apps/native-host/src/install/openai-keychain.test.ts \
  apps/native-host/src/install/cli.test.ts
```

Expected: FAIL because the OpenAI credential modules and CLI commands do not exist.

- [ ] **Step 3: Implement the reader with Provider-generic errors**

Define a private error carrying only a code, never the Key:

```ts
export class OpenAICredentialError extends Error {
  constructor(
    readonly code:
      | "MODEL_PROVIDER_NOT_CONFIGURED"
      | "MODEL_PROVIDER_AUTH_FAILED"
      | "TIMEOUT"
      | "CANCELLED"
      | "INTERNAL_ERROR",
  ) {
    super("OpenAI credential operation failed.");
    this.name = "OpenAICredentialError";
  }
}
```

Use the existing `ProcessRunner`, allowlisted environment, fixed `/usr/bin/security`, 5,000 ms
timeout and 8 KiB maximum output. Validate 1–4,096 characters without hard-coding an `sk-` prefix.

- [ ] **Step 4: Implement CLI commands and uninstall ordering**

Add exact commands and root scripts:

```json
"host:openai:configure": "node apps/native-host/dist/install/cli.js openai-configure",
"host:openai:remove": "node apps/native-host/dist/install/cli.js openai-remove"
```

`uninstall` must remove the Eudic item, then the OpenAI item, then owned Host files. If either
credential deletion fails, do not delete Host files. Missing items remain idempotent. Installation
only verifies `/usr/bin/security` is executable and does not read or create the OpenAI item.

- [ ] **Step 5: Verify and commit**

```bash
pnpm exec vitest run --project native-host \
  apps/native-host/src/credentials \
  apps/native-host/src/install
pnpm typecheck
```

Expected: PASS and no sentinel secret in output.

```bash
git add apps/native-host/src/credentials apps/native-host/src/install package.json
git commit -m "feat(host): manage openai api credentials"
```

---

### Task 4: Parse bounded SSE and validate Responses events

**Files:**

- Create: `apps/native-host/src/provider/sse-decoder.ts`
- Create: `apps/native-host/src/provider/sse-decoder.test.ts`
- Create: `apps/native-host/src/provider/openai-responses-events.ts`
- Create: `apps/native-host/src/provider/openai-responses-events.test.ts`
- Create: `apps/native-host/src/provider/openai-provider-errors.ts`
- Create: `apps/native-host/src/provider/openai-provider-errors.test.ts`

**Interfaces:**

- Produces: `SseDecoder.push(chunk: Uint8Array): SseMessage[]` and `finish(): SseMessage[]`.
- Produces: `SseMessage = { event: string; data: string }`.
- Produces: `parseOpenAIResponseEvent(message): OpenAIResponseEvent` with strict event/data type match.
- Produces: `OpenAIProviderError` and `mapOpenAIProviderError(error): AnalysisError`.

- [ ] **Step 1: Add failing SSE chunk and limit tests**

Use one canonical stream with CRLF and split it at every byte boundary:

```ts
const source = new TextEncoder().encode(
  "event: response.output_text.delta\r\n" +
    'data: {"type":"response.output_text.delta","delta":"你"}\r\n\r\n',
);

for (let split = 0; split <= source.length; split += 1) {
  const decoder = new SseDecoder();
  expect([
    ...decoder.push(source.slice(0, split)),
    ...decoder.push(source.slice(split)),
    ...decoder.finish(),
  ]).toEqual([
    {
      data: '{"type":"response.output_text.delta","delta":"你"}',
      event: "response.output_text.delta",
    },
  ]);
}
```

Add multi-line `data:` joining with `\n`, comments, LF/CRLF, split UTF-8, invalid UTF-8, missing
blank terminator, `id:`/`retry:`/unknown fields, 64 KiB event and 2 MiB stream boundaries.

- [ ] **Step 2: Add failing strict Responses event tests**

Define fixtures for `response.created`, `response.in_progress`, output item added/done, content part
added/done, output text delta/done, completed, failed, incomplete and `error`. Assert unknown fields,
event name/data type mismatch, nonzero output/content index, reasoning item, function/tool item,
refusal part and empty delta are rejected.

- [ ] **Step 3: Run tests and confirm failure**

```bash
pnpm exec vitest run --project native-host \
  apps/native-host/src/provider/sse-decoder.test.ts \
  apps/native-host/src/provider/openai-responses-events.test.ts \
  apps/native-host/src/provider/openai-provider-errors.test.ts
```

Expected: FAIL because the parser, event schemas and error mapping are absent.

- [ ] **Step 4: Implement the decoder and strict event union**

Use fatal UTF-8 decoding:

```ts
const decoder = new TextDecoder("utf-8", { fatal: true });
```

Count raw bytes before decoding. Accept only `event`, `data` and comment lines; require one event
and at least one data line. Ignore a single optional space after `:`. `finish()` may emit only a
fully terminated event and otherwise throws `OpenAIProviderError("INVALID_RESPONSE")`.

The event parser must parse `message.data` as JSON, validate a strict Zod object selected by
`message.event`, and require `data.type === message.event`. Export only the narrow fields needed by
the lifecycle machine; do not retain usage, request IDs or response metadata.

- [ ] **Step 5: Implement fixed public error mapping and commit**

Map credential missing/auth, HTTP status, fetch errors, abort cause, timeouts and validation
failures to the exact design codes. Distinguish user abort from the internal 60-second timeout.
Treat HTTP 429 as `QUOTA_EXCEEDED` only when the bounded JSON error body has code
`insufficient_quota`; other 429 is `RATE_LIMITED`.

```bash
pnpm exec vitest run --project native-host apps/native-host/src/provider
pnpm typecheck
git add apps/native-host/src/provider
git commit -m "feat(host): validate openai response streams"
```

Expected: tests and typecheck PASS.

---

### Task 5: Stream top-level arrays item by item

**Files:**

- Modify: `apps/native-host/src/provider/streaming-json-tokenizer.ts`
- Modify: `apps/native-host/src/provider/streaming-json-tokenizer.test.ts`
- Modify: `apps/native-host/src/provider/model-analysis-schemas.ts`
- Modify: `apps/native-host/src/provider/model-analysis-schemas.test.ts`
- Modify: `apps/native-host/src/provider/streaming-json-fields.ts`
- Modify: `apps/native-host/src/provider/streaming-json-fields.test.ts`

**Interfaces:**

- Changes `TopLevelJsonUpdate` to include `{ field; index; kind: "array-item"; value }`.
- Produces `modelAnalysisArrayItemSchemaFor(resultType, field): ZodType | undefined`.
- Preserves a final `complete-value` for every array.
- Produces cumulative existing `analysis-section` values after each valid item.

- [ ] **Step 1: Add failing tokenizer tests at every character boundary**

For `{"collocations":[{"text":"a]b","meaningZh":"甲"},{"text":"c","meaningZh":"乙"}]}`
assert updates in this order:

```ts
[
  { field: "collocations", index: 0, kind: "array-item", value: first },
  { field: "collocations", index: 1, kind: "array-item", value: second },
  { field: "collocations", kind: "complete-value", value: [first, second] },
];
```

Feed the source once per character and at every two-way split. Cover nested arrays/objects, escaped
quotes, Unicode escapes, empty array, primitive item, trailing comma, mismatched containers,
duplicate fields and incomplete second item.

- [ ] **Step 2: Add failing extractor validation and cumulative tests**

Assert two valid items produce `[item1]`, then `[item1, item2]`; an invalid first or second item
throws before it emits; index skip/repeat and a fourth item fail; final complete array differing
from accumulated values fails. Cover `collocations`, `coreMeanings`, `similarTerms` and `synonyms`.
Keep sentence `keyExpressions` final-only because wire v3 intentionally adds no new public section
type for it; the tokenizer may observe its items, but the extractor must not emit them.

- [ ] **Step 3: Run focused tests and confirm failure**

```bash
pnpm exec vitest run --project native-host \
  apps/native-host/src/provider/streaming-json-tokenizer.test.ts \
  apps/native-host/src/provider/model-analysis-schemas.test.ts \
  apps/native-host/src/provider/streaming-json-fields.test.ts
```

Expected: FAIL because arrays emit only one `complete-value` today.

- [ ] **Step 4: Implement direct-child array tracking**

Add tokenizer state only for a top-level array value:

```ts
interface RootArrayState {
  index: number;
  itemDepth: number;
  itemSource: string;
  expecting: "item-or-end" | "comma-or-end";
}
```

An item is complete at a comma or closing top-level `]` only when nested depth is zero and no JSON
string is open. Parse that bounded item with `JSON.parse`, emit `array-item`, keep the complete
`valueSource`, and still parse/emit the whole array on `]`.

- [ ] **Step 5: Validate each item and final consistency**

Export element schemas directly from the existing private schemas:

```ts
const MODEL_ARRAY_ITEM_SCHEMAS = {
  "explain-lexical": new Map([
    ["collocations", collocationSchema],
    ["coreMeanings", coreMeaningSchema],
    ["synonyms", relatedTermSchema],
  ]),
  "explain-sentence": new Map(),
  "translate-lexical": new Map([
    ["collocations", collocationSchema],
    ["similarTerms", relatedTermSchema],
  ]),
  "translate-passage": new Map(),
} satisfies Record<ModelResultType, ReadonlyMap<string, z.ZodType>>;
```

The extractor keeps a per-field array, requires `update.index === accumulated.length`, validates
the element before appending, and compares the final parsed array with the accumulated values using
structural equality after Zod parsing. Empty arrays emit no section.

- [ ] **Step 6: Verify both Providers benefit and commit**

Run all Provider tests because Codex and Responses will share this extractor:

```bash
pnpm exec vitest run --project native-host apps/native-host/src/provider
pnpm typecheck
git add apps/native-host/src/provider
git commit -m "feat(host): stream structured array items"
```

Expected: PASS.

---

### Task 6: Implement the Responses API client and Provider

**Files:**

- Create: `apps/native-host/src/provider/openai-responses-client.ts`
- Create: `apps/native-host/src/provider/openai-responses-client.test.ts`
- Create: `apps/native-host/src/provider/openai-responses-provider.ts`
- Create: `apps/native-host/src/provider/openai-responses-provider.test.ts`
- Modify: `apps/native-host/src/provider/codex-app-server-provider.ts`
- Modify: `apps/native-host/src/provider/codex-app-server-provider.test.ts`
- Modify: `apps/native-host/src/provider/prompt-builder.test.ts`

**Interfaces:**

- Produces: `OpenAIResponsesClient.stream(request, key, signal): AsyncIterable<OpenAIResponseEvent>`.
- Produces: `OpenAIResponsesProvider implements AnalysisProvider`.
- Consumes: `OpenAIApiKeyReader`, `StreamingJsonFieldExtractor`, `buildAnalysisPrompt`, private JSON
  schema files and `parseAndAssembleModelResult`.
- Preserves Codex output and validation behavior while sharing schema loading through a small named
  `ModelSchemaRepository` extracted from the Codex Provider.

- [ ] **Step 1: Add failing fixed HTTP request tests**

Inject fake fetch and assert one call to the fixed URL with:

```ts
expect(JSON.parse(String(init.body))).toEqual({
  input: buildAnalysisPrompt(request),
  model: "gpt-5.6-luna",
  reasoning: { effort: "none" },
  store: false,
  stream: true,
  text: {
    format: {
      name: "translate_lexical",
      schema: lexicalSchemaFixture,
      strict: true,
      type: "json_schema",
    },
  },
});
expect(init.redirect).toBe("error");
expect(new Headers(init.headers).get("Authorization")).toBe("Bearer secret-sentinel");
expect(new Headers(init.headers).has("Cookie")).toBe(false);
```

Assert the body has no `tools`, `previous_response_id`, URL, title, Eudic data or configurable model.
Assert `Accept: text/event-stream` and `Content-Type: application/json`. Cover non-200 bounded error
bodies, wrong content type, missing body, redirect, fetch rejection, external cancel, 60-second
timeout and late chunks after abort.

- [ ] **Step 2: Add failing lifecycle Provider tests**

Use a fake event iterable to assert the only accepted successful order is one text message/output
part followed by deltas, matching done events and one completed terminal. Assert rejection of:

- two output items or content parts;
- a refusal, reasoning item, tool/function item or nonzero index;
- delta before content part, duplicate done/completed, completed before text done;
- text done differing from concatenated deltas;
- failed/incomplete/error terminal and any event after terminal;
- valid preview followed by invalid final JSON.

Assert `warmup()` reads neither Key nor fetch. Assert `analyze()` reads the Key for every request,
passes abort through, emits validated string and cumulative array updates, and returns the same
public result as the Codex Provider for the same assistant JSON.

- [ ] **Step 3: Run tests and confirm failure**

```bash
pnpm exec vitest run --project native-host \
  apps/native-host/src/provider/openai-responses-client.test.ts \
  apps/native-host/src/provider/openai-responses-provider.test.ts
```

Expected: FAIL because the client and Provider are absent.

- [ ] **Step 4: Implement fixed request construction and abort composition**

Keep production constants unexported except for test-readable named accessors. Accept controlled
model/effort only in the Provider constructor options used by the diagnostic entrypoint:

```ts
export interface OpenAIResponsesProviderOptions {
  apiKeyReader: OpenAIApiKeyReader;
  client: OpenAIResponsesClient;
  modelConfiguration?: Readonly<{
    effort: "none" | "low";
    model: "gpt-5.4-mini" | "gpt-5.6-luna";
  }>;
  onValidationDiagnostic?: ProviderValidationDiagnosticSink;
  schemaRepository: ModelSchemaRepository;
}
```

`main.ts` must omit `modelConfiguration`, ensuring production always uses fast fixed values. Build
one linked `AbortController`; external abort maps to `CANCELLED`, internal 60-second timer maps to
`TIMEOUT`, and cleanup always clears listeners/timer.

- [ ] **Step 5: Implement the strict lifecycle state machine**

Track these booleans/counters: created, inProgress, outputAdded, partAdded, textDone, partDone,
outputDone, terminal. Require item/content IDs and indexes to match across events. Feed each delta
to `StreamingJsonFieldExtractor` and append it to an in-memory string bounded by 1 MiB. On
`response.completed`, require all done states, call `extractor.finish()`, compare `output_text.done`
with accumulated text, then call `parseAndAssembleModelResult`.

Never log response IDs, usage, prompt, selection, Key or assistant text. Validation diagnostics may
contain only the existing bounded stage/field metadata.

- [ ] **Step 6: Verify and commit**

```bash
pnpm exec vitest run --project native-host apps/native-host/src/provider
pnpm lint
pnpm typecheck
git add apps/native-host/src/provider
git commit -m "feat(host): add openai responses provider"
```

Expected: PASS.

---

### Task 7: Route requests and report the active Provider

**Files:**

- Create: `apps/native-host/src/provider/routing-analysis-provider.ts`
- Create: `apps/native-host/src/provider/routing-analysis-provider.test.ts`
- Create: `apps/native-host/src/provider/analysis-provider-factory.ts`
- Create: `apps/native-host/src/provider/analysis-provider-factory.test.ts`
- Modify: `apps/native-host/src/main.ts`
- Modify: `apps/native-host/src/main.test.ts`
- Modify: `apps/native-host/src/protocol/dispatcher.ts`
- Modify: `apps/native-host/src/protocol/dispatcher.test.ts`
- Modify: `apps/native-host/src/runtime/error-mapper.ts`
- Modify: `apps/native-host/src/runtime/error-mapper.test.ts`

**Interfaces:**

- Produces: `RoutingAnalysisProvider implements AnalysisProvider`.
- Produces: `ActiveProviderHealth = { codexVersion: string | null; model; provider }`.
- Changes `HealthCheckResult` to include all three fields.
- Uses one combined `mapAnalysisProviderError` that recognizes both Codex and OpenAI private errors.

- [ ] **Step 1: Add failing Router tests**

Use deferred fake Providers and a fake store. Assert:

```ts
store.provider = "openai-responses";
const pending = router.analyze(request, signal, listener);
store.provider = "codex";
api.resolve(apiResult);
await expect(pending).resolves.toEqual(apiResult);
await router.analyze(nextRequest, signal, listener);
expect(codex.analyzeCalls).toHaveLength(1);
```

Assert the store is read once per analyze, API failure is returned without calling Codex, Codex
failure is returned without calling API, and `dispose()` disposes both exactly once. For warmup,
assert Codex mode calls only Codex warmup; API mode calls neither Provider network/key path and only
validates config read.

- [ ] **Step 2: Add failing dispatcher/main health tests**

Codex health must report `{ provider: "codex", model: "gpt-5.4-mini", codexVersion: "..." }` after
capability validation. API health must report `{ provider: "openai-responses", model:
"gpt-5.6-luna", codexVersion: null }` without invoking Codex capability checks, Keychain or fetch.
An invalid provider file emits a fixed `INTERNAL_ERROR` without exposing file contents.

- [ ] **Step 3: Run tests and confirm failure**

```bash
pnpm exec vitest run --project native-host \
  apps/native-host/src/provider/routing-analysis-provider.test.ts \
  apps/native-host/src/provider/analysis-provider-factory.test.ts \
  apps/native-host/src/protocol/dispatcher.test.ts \
  apps/native-host/src/main.test.ts
```

Expected: FAIL because Host still constructs only `CodexAppServerProvider` and health is Codex-only.

- [ ] **Step 4: Implement Router and factory wiring**

Use this exact route selection:

```ts
async analyze(request, signal, onDelta) {
  const provider = await this.configurationStore.read(signal);
  return provider === "codex"
    ? this.codex.analyze(request, signal, onDelta)
    : this.openAI.analyze(request, signal, onDelta);
}
```

`warmup()` reads the config. Codex calls Codex warmup; API returns after the local read. The factory
constructs one Codex Provider, one Responses Provider, one Router and the existing Eudic Provider.
`main.ts` receives injectable fake fetch and fake Key reader only through test options; production
uses Node `fetch` and `MacosOpenAIApiKeyReader`.

- [ ] **Step 5: Implement health and error mapping**

Read configuration at health request time. API mode must not call `checkCodexCapabilities`.
Dispatcher emits `HOST_VERSION = "0.5.0"` and all new health fields. Combined mapping must preserve
Codex errors and map OpenAI credential/HTTP/SSE errors exactly once, with fixed Chinese messages and
no causes serialized to wire.

- [ ] **Step 6: Verify and commit**

```bash
pnpm exec vitest run --project native-host
pnpm lint
pnpm typecheck
git add apps/native-host/src
git commit -m "feat(host): route analysis providers explicitly"
```

Expected: PASS.

---

### Task 8: Replace timer batching with stable frame-based DOM updates

**Files:**

- Create: `apps/extension/src/content/overlay/frame-scheduler.ts`
- Create: `apps/extension/src/content/overlay/frame-scheduler.test.ts`
- Create: `apps/extension/src/content/overlay/patch-analysis-body.ts`
- Create: `apps/extension/src/content/overlay/patch-analysis-body.test.ts`
- Modify: `apps/extension/src/content/overlay/overlay-update-batch.ts`
- Modify: `apps/extension/src/content/overlay/overlay-controller.ts`
- Modify: `apps/extension/src/content/overlay/overlay-controller.test.ts`
- Modify: `apps/extension/src/content/overlay/render-analysis-sections.ts`
- Modify: `apps/extension/src/content/overlay/render-analysis-sections.test.ts`
- Modify: `apps/extension/src/content/overlay/render-streaming-preview.ts`
- Modify: `apps/extension/src/content/overlay/render-streaming-preview.test.ts`
- Modify: `apps/extension/src/content/overlay/render-result.ts`
- Modify: `apps/extension/src/content/overlay/render-result.test.ts`
- Modify: `apps/extension/src/content/overlay/styles.ts`

**Interfaces:**

- Produces: `FrameScheduler = { request(callback): number; cancel(handle): void }`.
- Changes `OverlayUpdateBatch` constructor to consume a scheduler instead of `waitMs`.
- Produces: `patchAnalysisBody(body, state): void` using stable `data-huayi-section` keys.
- Preserves `OverlayStateMachine`, public events, wordbook behavior, drag/focus/scroll and cancellation.

- [ ] **Step 1: Add failing frame scheduler tests**

With a fake scheduler assert ten appends before one frame schedule exactly one callback and one
flush; appends during a flush schedule the next frame; `drain()` cancels and returns pending events;
`clear()` cancels and discards; close/new selection prevents a stale callback from flushing.

```ts
const batch = new OverlayUpdateBatch(onFlush, fakeScheduler);
batch.append(delta0);
batch.append(delta1);
expect(fakeScheduler.pendingCount).toBe(1);
fakeScheduler.runFrame();
expect(onFlush).toHaveBeenCalledWith([delta0, delta1]);
```

- [ ] **Step 2: Add failing stable DOM tests**

Render a lexical preview, retain references to the panel, body, contextual meaning paragraph and
first collocation `<li>`, then patch later state. Assert the references are unchanged, text grows,
the second `<li>` is appended, no existing item is animated again, and empty sections do not exist.

Set a sentinel model value to `<img src=x onerror=alert(1)>`; assert it appears as text and no `img`
node exists. Assert final result correction updates existing text/list nodes without clearing body.
Assert scrollTop, focused wordbook button, header, drag position and wordbook availability survive.

- [ ] **Step 3: Run focused tests and confirm failure**

```bash
pnpm exec vitest run --project extension \
  apps/extension/src/content/overlay/frame-scheduler.test.ts \
  apps/extension/src/content/overlay/patch-analysis-body.test.ts \
  apps/extension/src/content/overlay/overlay-controller.test.ts
```

Expected: FAIL because batching uses a 40 ms timer and controller replaces the full Shadow DOM.

- [ ] **Step 4: Implement frame scheduling**

Use the document window when present:

```ts
export function createFrameScheduler(view: Window | null): FrameScheduler {
  if (view?.requestAnimationFrame !== undefined) {
    return {
      cancel: (handle) => view.cancelAnimationFrame(handle),
      request: (callback) => view.requestAnimationFrame(() => callback()),
    };
  }
  return {
    cancel: (handle) => clearTimeout(handle),
    request: (callback) => setTimeout(callback, 16) as unknown as number,
  };
}
```

Tests inject a deterministic scheduler; production code does not install globals. Terminal
`resolve/reject` calls `drain()` before state transition. Close/show/cancel calls `clear()`.

- [ ] **Step 5: Implement keyed body reconciliation**

Every section root uses `data-huayi-section="contextual-meaning"` or the corresponding protocol
section. Text sections contain one `[data-huayi-value]` text node. Lists contain keyed items whose
index is stable because cumulative arrays only append. Patch rules:

- create a section only when its value becomes nonempty;
- update text with `textContent`;
- append missing list items and remove only excess items during final correction;
- never replace an equal existing node;
- mark only new section/item nodes with `huayi-enter` and remove that class on `animationend`;
- remove obsolete sections only when final result proves they are absent.

Controller may rebuild when moving from actions to a new analysis panel or when a new selection is
shown. While the same analysis panel exists, update header/wordbook and call `patchAnalysisBody`
instead of `shadowRoot.replaceChildren`.

- [ ] **Step 6: Add motion and accessibility styles**

Add a 120 ms opacity/translate animation and disable it under:

```css
@media (prefers-reduced-motion: reduce) {
  .huayi-enter {
    animation: none;
  }
}
```

Keep `aria-live="polite"`, visible focus, narrow screen sizing and internal scroll. Do not animate
existing nodes on each delta.

- [ ] **Step 7: Verify and commit**

```bash
pnpm exec vitest run --project extension apps/extension/src/content/overlay
pnpm test:e2e
pnpm lint
pnpm typecheck
git add apps/extension/src/content/overlay
git commit -m "feat(extension): render streaming results by frame"
```

Expected: PASS.

---

### Task 9: Add an explicit, privacy-safe Provider comparison tool

**Files:**

- Create: `apps/native-host/src/diagnostics/compare-providers.ts`
- Create: `apps/native-host/src/diagnostics/compare-providers.test.ts`
- Create: `scripts/compare-providers.mjs`
- Create: `scripts/compare-providers.test.mjs`
- Modify: `apps/native-host/vite.config.ts`
- Modify: `apps/native-host/package.json`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**

- Produces explicit `pnpm smoke:compare` only; it is not part of `pnpm test` or the default gate.
- Compares fixed profiles `codex-gpt-5.4-mini-low`, `api-gpt-5.4-mini-low`, `api-gpt-5.6-luna-none`.
- Emits aggregate timing JSON/console tables without request text, prompt, Key or model output.

- [ ] **Step 1: Add failing corpus and redaction tests**

Define fixed case IDs only in output while keeping text internal:

```ts
const CASES = [
  { id: "word-investigation", action: "translate", selection: "investigation" },
  { id: "word-sustained", action: "explain", selection: "sustained" },
  { id: "word-victims", action: "translate", selection: "victims" },
  { id: "word-accountable", action: "explain", selection: "accountable" },
  { id: "word-four", action: "explain", selection: "Four" },
  { id: "phrase", action: "translate", selection: "in the early stages" },
  { id: "sentence", action: "explain", selection: "He urged anyone to come forward." },
  { id: "paragraph", action: "translate", selection: "First sentence. Second sentence." },
] as const;
```

Inject fake Providers and a sentinel Key/text. Assert output contains only case ID, profile, counts,
P50/P90 and these timestamps: host start, Provider start, upstream sent, first raw delta, first
validated visible update, each section/item arrival and strict completion. Assert no sentinel,
selection, context, prompt, assistant result or Authorization header appears.

- [ ] **Step 2: Run tests and confirm failure**

```bash
node --test scripts/compare-providers.test.mjs
pnpm exec vitest run --project native-host \
  apps/native-host/src/diagnostics/compare-providers.test.ts
```

Expected: FAIL because the diagnostic entrypoint and wrapper do not exist.

- [ ] **Step 3: Implement fixed-profile diagnostics**

Bundle a third native-host entrypoint that constructs Providers through
`analysis-provider-factory.ts`. It may inject only the two API model configurations declared in
Task 6; it must not accept arbitrary model/effort/endpoint/prompt CLI arguments. It reads the OpenAI
Key through Keychain and Codex auth through the existing Codex runtime. It never writes provider
configuration.

Compute nearest-rank P50/P90 over successful samples. Count invalid and cancelled results separately.
Exit nonzero if any fixed quality case fails its strict result Schema, but do not enforce latency
thresholds automatically; print the design targets for human evaluation.

- [ ] **Step 4: Add the explicit script and verify offline behavior**

Add:

```json
"smoke:compare": "node scripts/compare-providers.mjs"
```

The wrapper must refuse to run if the diagnostic build is missing and must state that it can consume
both ChatGPT/Codex quota and OpenAI API charges before starting. Default `pnpm test` tests only fake
diagnostics and never invokes this command.

```bash
node --test scripts/compare-providers.test.mjs
pnpm exec vitest run --project native-host apps/native-host/src/diagnostics
pnpm build
git add apps/native-host/src/diagnostics apps/native-host/vite.config.ts \
  apps/native-host/package.json scripts package.json .gitignore
git commit -m "test: add provider performance comparison"
```

Expected: offline tests and build PASS; no real smoke is run.

---

### Task 10: Complete v0.5.0 docs, versioning, release verification and local upgrade

**Files:**

- Modify: `package.json`
- Modify: `apps/extension/package.json`
- Modify: `apps/native-host/package.json`
- Modify: `packages/protocol/package.json`
- Modify: `apps/extension/manifest.json`
- Modify: `pnpm-lock.yaml`
- Modify: `scripts/version-consistency.test.mjs`
- Modify: `README.md`
- Modify: `CONTRIBUTING.md`
- Modify: `AGENTS.md`
- Modify: `apps/extension/AGENTS.md`
- Modify: `apps/native-host/AGENTS.md`
- Modify: `packages/protocol/AGENTS.md`
- Modify: `docs/architecture.md`
- Modify: `docs/protocol.md`
- Modify: `docs/security.md`
- Modify: `docs/testing.md`
- Modify: `docs/setup-macos.md`
- Modify: `apps/extension/src/manifest.test.ts`
- Modify: `apps/extension/e2e/streaming-wordbook-journeys.spec.ts`

**Interfaces:**

- Produces a consistent installable v0.5.0 Extension/Host pair.
- Documents explicit API enablement, separate billing, privacy boundary, rollback and future UI seam.
- Preserves Manifest permission array exactly `["nativeMessaging"]`.

- [ ] **Step 1: Add failing version, permission and journey assertions**

Update version consistency expected value to `0.5.0`. Keep:

```ts
expect(manifest.permissions).toEqual(["nativeMessaging"]);
expect(manifest).not.toHaveProperty("host_permissions");
```

Extend mocked Playwright journeys to cover API Provider error copy, progressive array items, smooth
node reuse, close cancellation and a late SSE event that cannot reopen the overlay. These journeys
use mock Native Messaging only.

- [ ] **Step 2: Run tests and confirm failure**

```bash
node --test scripts/version-consistency.test.mjs
pnpm exec vitest run --project extension apps/extension/src/manifest.test.ts
pnpm test:e2e
```

Expected: version test FAIL at 0.4.0; new journey assertions fail until final integration fixtures
are updated.

- [ ] **Step 3: Set all versions to 0.5.0 and update the lockfile**

Change only the root/workspace/Manifest versions and Host `HOST_VERSION`. Run `pnpm install` to
refresh workspace lockfile metadata. Do not upgrade unrelated dependencies.

- [ ] **Step 4: Update long-term instructions and Chinese docs**

Document these exact user flows:

```bash
pnpm build
pnpm host:install -- --extension-id kfkamoejomjdihipgdkmfjcdenlhgnpd
pnpm host:openai:configure
pnpm host:provider:set api
pnpm host:provider:status
```

Rollback is `pnpm host:provider:set codex`; removal is
`pnpm host:openai:remove`. State that ChatGPT Plus/Codex quota and OpenAI Platform API billing are
separate. State that API mode sends only current English selection/context/sentence to OpenAI, not
URL, title, history, Eudic authorization or model history. State that Keychain protects storage at
rest but not against malicious processes running as the same macOS user.

Update Native Host instructions with the fixed endpoint/model/Keychain, no retry, fake fetch tests,
strict SSE and no-secret logging. Update Extension instructions with keyed incremental DOM and rAF.
Update Protocol instructions to version 3.

- [ ] **Step 5: Run the complete default quality gate**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
git diff --check
```

Expected: every command exits 0. No command reads real Keychain or calls Codex/OpenAI/欧路.

- [ ] **Step 6: Inspect secrets and permission diff**

```bash
rg -n 'OPENAI_API_KEY|sk-[A-Za-z0-9_-]{8,}' . \
  --glob '!docs/superpowers/**' \
  --glob '!node_modules/**' \
  --glob '!dist/**'
git diff -- apps/extension/manifest.json docs/security.md
```

Expected: no real Key, no environment-based API Key path, and Manifest permission remains exactly
`nativeMessaging`.

- [ ] **Step 7: Commit the release documentation**

```bash
git add package.json apps packages pnpm-lock.yaml scripts README.md CONTRIBUTING.md \
  AGENTS.md docs
git commit -m "docs: release openai provider experiment"
```

- [ ] **Step 8: Request explicit authorization before any real paid verification**

Do not run either command until the user explicitly authorizes it after the default gate:

```bash
pnpm smoke:codex
pnpm smoke:compare
```

If authorized, configure the Key only through the hidden Keychain prompt. Never ask the user to
paste it into chat. Record only the aggregate timings and pass/fail counts defined in Task 9.

- [ ] **Step 9: Replace the installed local Extension/Host only after verification**

After successful build and explicit user authorization, reinstall the Host with the known Extension
ID, ask the user to refresh the unpacked Extension in `chrome://extensions`, then run:

```bash
pnpm host:openai:configure
pnpm host:provider:set api
pnpm host:provider:status
```

Expected status: `openai-responses`. Perform one small manual word translation, one explanation and
one sentence request. If API quality or speed is unacceptable, immediately switch back with
`pnpm host:provider:set codex`; do not delete the Key unless the user requests removal.

---

## Final Acceptance Checklist

- [ ] Missing Provider config defaults to Codex; every other invalid config state fails closed.
- [ ] Provider switch affects the next request without restart and never migrates an active request.
- [ ] API warmup does not read Key or send HTTP.
- [ ] OpenAI Key never enters CLI arguments, environment, normal files, wire, stdout/stderr or tests.
- [ ] Responses request is fixed to `gpt-5.6-luna + none`, strict JSON Schema, streaming and no store/tools.
- [ ] SSE accepts one text output lifecycle and rejects refusal, tool, reasoning, duplicate or late events.
- [ ] Each array item is validated and displayed cumulatively before the final array closes.
- [ ] Final JSON passes private Schema, trusted Host assembly and public protocol validation.
- [ ] Extension renders at most once per frame and reuses text/list nodes without full-card replacement.
- [ ] New content animation is about 120 ms, reduced-motion safe and does not repeat on old nodes.
- [ ] Scroll, focus, drag, narrow layout, wordbook status and cancellation remain correct.
- [ ] Manifest permissions remain exactly `["nativeMessaging"]`.
- [ ] Default gate is entirely offline and passes; real compare runs only with explicit authorization.
- [ ] API fast meets or is measured against first-visible P50 30% and complete-result P50 20% targets.
- [ ] v0.5.0 build, Host reinstall, Extension refresh, hidden Key setup and explicit API switch are documented.
