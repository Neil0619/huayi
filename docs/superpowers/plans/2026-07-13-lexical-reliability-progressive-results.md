# 词汇结果可靠性与渐进性能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复单词翻译和解释在核心文本出现后以 `INVALID_RESPONSE` 结束的问题，并通过无模型预热、经过字段级校验的结构化渐进事件和更小的模型输出，让 v0.4.0 更快展示可靠的完整结果。

**Architecture:** 将模型私有内容与公共 `AnalysisResult` 分离，由 Native Host 注入可信请求元数据并执行两次严格校验；Extension 在首次有效选区后发送不含网页文本的全局 warmup，分析时继续接收字符串增量，并新增完整结构化板块事件。所有分析更新共享连续序号，最终 `result` 仍是唯一完整成功态，欧路查词和显式加词保持独立请求通道。

**Tech Stack:** TypeScript 5.8、Node.js 18+、Chrome Manifest V3、Native Messaging、Codex App Server stdio JSON-RPC、Zod 4、Vitest、JSDOM、Playwright、pnpm workspace。

## Global Constraints

- 实现必须遵循已确认设计：
  `docs/superpowers/specs/2026-07-13-lexical-reliability-performance-design.md`。
- 应用及三个 workspace 包统一升级为 `0.4.0`；Native Messaging 协议统一升级为
  `schemaVersion: 2`，不实现 v1/v2 兼容层。
- Extension 与 Native Host 必须同步升级；v1 消息在 v2 运行时明确拒绝。
- 模型继续固定为内置 `openai`、`gpt-5.4-mini` 和 `low` effort。
- warmup 只允许 MCP 名称发现、App Server 启动、initialize、Hook/MCP 安全检查；不得
  创建 thread、turn 或调用模型。
- 模型私有输出不得包含 `sourceText`、`selectionKind` 或 `type`；这些字段只能由 Host
  从已验证请求注入。
- 词汇搭配、相似词和同义词允许 0–3 项；核心词义要求 1–3 项；不得为满足数量伪造内容。
- `analysis-delta` 和 `analysis-section` 必须共享每个分析请求从 0 开始的连续序号。
- 对象和数组只有在完整解析并通过字段 Schema 后才允许发送给 Extension。
- 最终 `result` 仍需通过公共 `analysisResultSchema`；部分板块不得伪装成成功终态。
- 所有模型文本只通过 `textContent` 渲染；不得使用 `innerHTML`。
- Chrome 权限必须继续严格等于 `['nativeMessaging']`，不得增加 storage、alarm、
  offscreen 或 host permissions。
- warmup 不含选区、上下文、URL、标题或历史；自动欧路查词仍只发送原始单词。
- 默认测试必须使用 fake App Server、fake Keychain 和 fake fetch，不访问 OpenAI 或欧路。
- `pnpm smoke:codex` 会消耗真实额度，只能在完整默认门禁通过后再次取得用户明确允许再运行。
- 每个任务按失败测试、确认失败、最小实现、聚焦验证、相关门禁、独立提交执行。
- 保持手写源码单文件不超过 400 行；扩展流式 JSON 解析器时必须按下述文件边界拆分。

---

## File Structure

### 新建文件

- `apps/extension/src/content/selection/extract-sentence-context.ts`：从真实 Range 提取单词或
  短语所在的有界英文句子。
- `apps/extension/src/content/selection/extract-sentence-context.test.ts`：重复词、跨节点、
  缩写、混合文本和超长句回归。
- `apps/native-host/src/provider/model-analysis-schemas.ts`：四类 provider 私有 Zod 内容
  Schema 及字段级 Schema。
- `apps/native-host/src/provider/model-analysis-schemas.test.ts`：可空字段、空数组、未知字段和
  基数契约测试。
- `apps/native-host/src/provider/model-result-assembler.ts`：请求元数据注入、例句组装和公共
  结果终验。
- `apps/native-host/src/provider/model-result-assembler.test.ts`：大小写、复数、原形和例句可信
  来源回归。
- `apps/native-host/src/provider/provider-validation.ts`：五类内部校验阶段、安全诊断和错误码
  分类。
- `apps/native-host/src/provider/provider-validation.test.ts`：阶段映射、长度上限和敏感文本不
  泄漏测试。
- `apps/native-host/src/provider/streaming-json-tokenizer.ts`：有界顶层 JSON 字段扫描、字符串
  增量和完整值边界。
- `apps/native-host/src/provider/streaming-json-tokenizer.test.ts`：chunk、嵌套容器、转义、
  Unicode、重复键和半成品测试。
- `apps/extension/src/content/overlay/overlay-update-batch.ts`：统一合并文本增量和结构化板块
  更新。
- `apps/extension/src/content/overlay/render-analysis-sections.ts`：最终结果与渐进预览共用的
  安全 DOM 板块渲染函数。
- `apps/extension/src/content/overlay/render-analysis-sections.test.ts`：空板块和 `textContent`
  安全回归。

### 删除文件

- `apps/extension/src/content/selection/extract-wordbook-context.ts`：由通用句子提取模块替代。
- `apps/extension/src/content/selection/extract-wordbook-context.test.ts`：测试迁移到新模块。
- `apps/extension/src/content/overlay/overlay-delta-batch.ts`：由统一更新批处理替代。

### 主要修改文件

- `packages/protocol/src/{limits,requests,results,wire-events,index}.ts` 及同目录测试：协议 v2、
  `sentenceContext`、warmup、结构化板块和词汇基数。
- `apps/extension/src/{shared,background,content}/**/*.ts` 及相关测试：warmup 命令、统一序号、
  精确句子和渐进浮层。
- `apps/native-host/src/provider/{analysis-provider,codex-app-server-provider,prompt-builder,
streaming-json-fields}.ts` 及测试：私有输出、可信组装和结构化流。
- `apps/native-host/src/provider/schemas/*.json` 与 `schemas.test.ts`：只描述模型内容，使用
  required nullable keys 和 0–3 数组。
- `apps/native-host/src/runtime/{codex-app-server,codex-app-server-lifecycle}.ts` 及测试：共享
  session warmup。
- `apps/native-host/src/protocol/dispatcher.ts` 及测试：warmup 分发和两类分析更新的统一序号。
- `apps/native-host/src/{main.ts,main.test.ts}`：安全诊断输出和 v0.4.0 组装。
- `apps/extension/e2e/{fixtures, support, selection-journeys.spec.ts,
streaming-wordbook-journeys.spec.ts}`：warmup、四个问题单词、结构化渐进和竞态。
- `scripts/{native-host-smoke-client,native-host-smoke-helpers,
native-host-smoke-streaming-cases,verify-ephemeral-session}*.mjs`：warmup 和统一更新序号、
  三类耗时输出、真实回归用例。
- 根包、三个 workspace 包、Extension Manifest、`pnpm-lock.yaml`、四个 `AGENTS.md`、README
  和中文文档：依赖、版本、协议、安全、测试和升级说明。

---

### Task 1: Define protocol v2 contracts and migrate fixtures

**Files:**

- Modify: `packages/protocol/src/limits.ts`
- Modify: `packages/protocol/src/requests.ts`
- Modify: `packages/protocol/src/requests.test.ts`
- Modify: `packages/protocol/src/results.ts`
- Modify: `packages/protocol/src/results.test.ts`
- Modify: `packages/protocol/src/wire-events.ts`
- Modify: `packages/protocol/src/wire-events.test.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/AGENTS.md`
- Modify: `docs/protocol.md`
- Modify: `CONTRIBUTING.md`
- Mechanical fixture migration: every nonhistorical TypeScript or MJS file returned by
  `rg -l 'schemaVersion: 1' apps packages scripts --glob '*.{ts,mjs}'`

**Interfaces:**

- Produces: `SCHEMA_VERSION = 2`, required `AnalyzeRequest.sentenceContext`, `WarmupRequest`,
  `WarmupReadyEvent`, `AnalysisSectionPayload`, `AnalysisSectionEvent`, exported
  `Pronunciation`, `CoreMeaning` and `ContextExample` schemas/types.
- Changes: `collocations`, `similarTerms`, `synonyms` to 0–3 and `coreMeanings` to 1–3.
- Preserves: v2 `HostWorkRequest` remains analyze/check/add; `WarmupRequest` belongs to
  `HostRequest` but contains no work payload or page data.

- [ ] **Step 1: Add failing request, result and wire contract tests**

Use `const PREVIOUS_SCHEMA_VERSION = 1` only in explicit rejection cases. Add exact request cases:

```ts
const lexicalRequest = {
  action: "translate",
  context: "The victims were taken to safety.",
  requestId: "analysis-v2",
  schemaVersion: 2,
  selection: "victims",
  selectionKind: "word",
  sentenceContext: "The victims were taken to safety.",
  targetLanguage: "zh-CN",
  type: "analyze",
} as const;

expect(analyzeRequestSchema.parse(lexicalRequest)).toEqual(lexicalRequest);
expect(() =>
  analyzeRequestSchema.parse({ ...lexicalRequest, sentenceContext: "受害者 were safe." }),
).toThrow();
expect(() =>
  analyzeRequestSchema.parse({
    ...lexicalRequest,
    selectionKind: "sentence",
    sentenceContext: lexicalRequest.sentenceContext,
  }),
).toThrow();
expect(() =>
  analyzeRequestSchema.parse({ ...lexicalRequest, schemaVersion: PREVIOUS_SCHEMA_VERSION }),
).toThrow();
```

Add result cases accepting zero and three related items, rejecting four; accept one and three core
meanings, reject zero and four. Assert optional single-value fields may be absent while all objects
remain strict.

Add all nine structured section cases plus strict warmup cases:

```ts
const warmup = {
  requestId: "warmup-1",
  schemaVersion: 2,
  type: "warmup",
} as const;

expect(hostRequestSchema.parse(warmup)).toEqual(warmup);
expect(() => hostRequestSchema.parse({ ...warmup, selection: "secret" })).toThrow();
expect(
  hostEventSchema.parse({
    requestId: warmup.requestId,
    schemaVersion: 2,
    type: "warmup-ready",
  }),
).toMatchObject({ type: "warmup-ready" });

expect(
  hostEventSchema.parse({
    requestId: "analysis-v2",
    schemaVersion: 2,
    section: "part-of-speech",
    sequence: 1,
    type: "analysis-section",
    value: "number",
  }),
).toMatchObject({ section: "part-of-speech", value: "number" });
```

- [ ] **Step 2: Run protocol tests and verify the intended failures**

```bash
pnpm exec vitest run --project protocol \
  packages/protocol/src/requests.test.ts \
  packages/protocol/src/results.test.ts \
  packages/protocol/src/wire-events.test.ts
```

Expected: FAIL because v2, `sentenceContext`, warmup, section events and zero-length lexical arrays
are not yet accepted.

- [ ] **Step 3: Implement the strict v2 schemas**

Set the limits to:

```ts
export const SCHEMA_VERSION = 2;
export const MAX_COLLOCATIONS = 3;
export const MAX_RELATED_TERMS = 3;
export const MAX_CORE_MEANINGS = 3;
```

Make `sentenceContext` a required nullable field. It must use `englishContextSchema` when non-null,
and a refinement must require `null` for sentence/paragraph requests. Export the three reusable
result sub-schemas and add the strict structured event discriminated union described in the design.

Use these public payload types exactly:

```ts
export type AnalysisSectionPayload =
  | { section: "part-of-speech"; value: PartOfSpeech }
  | { section: "pronunciation"; value: Pronunciation }
  | { section: "base-form"; value: string }
  | { section: "word-formation"; value: string }
  | { section: "core-meanings"; value: CoreMeaning[] }
  | { section: "collocations"; value: Collocation[] }
  | { section: "context-example"; value: ContextExample }
  | { section: "similar-terms"; value: RelatedTerm[] }
  | { section: "synonyms"; value: RelatedTerm[] };
```

Every event variant must repeat the strict common fields `requestId`, `schemaVersion`, `sequence`
and `type`; do not build the public schema with a permissive intersection.

- [ ] **Step 4: Migrate all live fixtures to v2 without rewriting historical plans**

Before the mechanical change, replace the old tests that used `schemaVersion: 2` as an invalid
future version with `schemaVersion: PREVIOUS_SCHEMA_VERSION`. Then update valid fixtures under
`apps/`, `packages/` and `scripts/` from literal `1` to `2`, and add `sentenceContext: null` to old
analyze fixtures until Task 2 supplies exact values.

Do not modify dated v0.1–v0.3 design/plan documents. Verify remaining live occurrences:

```bash
rg -n 'schemaVersion: 1|schemaVersion": 1' apps packages scripts \
  --glob '*.{ts,mjs,json}'
```

Expected: only explicit v1 rejection fixtures remain.

- [ ] **Step 5: Update current protocol governance and migration documentation**

Update `packages/protocol/AGENTS.md` to state current version 2 and preserve the breaking-change
rule. Update `docs/protocol.md` with v1-to-v2 migration, all new requests/events, shared sequence,
cardinality, terminal matching and strict unknown-field rules. Update `CONTRIBUTING.md` so it no
longer instructs contributors to preserve version 1.

- [ ] **Step 6: Run protocol and repository type checks, then commit**

```bash
pnpm exec vitest run --project protocol
pnpm typecheck
git diff --check
git add packages/protocol apps packages scripts docs/protocol.md CONTRIBUTING.md
git commit -m "feat(protocol): define v2 progressive contracts"
```

---

### Task 2: Extract exact sentence context for lexical requests

**Files:**

- Create: `apps/extension/src/content/selection/extract-sentence-context.ts`
- Create: `apps/extension/src/content/selection/extract-sentence-context.test.ts`
- Delete: `apps/extension/src/content/selection/extract-wordbook-context.ts`
- Delete: `apps/extension/src/content/selection/extract-wordbook-context.test.ts`
- Modify: `apps/extension/src/content/selection/read-selection.ts`
- Modify: `apps/extension/src/content/selection/read-selection.test.ts`
- Modify: `apps/extension/src/content/content-script.ts`
- Modify: `apps/extension/src/content/content-script.test.ts`
- Modify: `apps/extension/src/content/content-script-concurrency.test.ts`

**Interfaces:**

- Produces: `extractSentenceContext(range, selection): string | null`.
- Changes: `SelectionRequestInput` gains `sentenceContext: string | null` and retains
  `wordbookContext: string | null` as a word-only alias of that exact sentence for the existing
  wordbook state boundary.
- Preserves: analyze uses paragraph `context`; automatic check sends only `word`; explicit add uses
  original selected word and `wordbookContext`, never model output.

- [ ] **Step 1: Write failing Range-based extraction tests**

Add JSDOM cases for nested nodes, the second occurrence of a repeated word, a phrase crossing text
nodes, abbreviations, quotes, no final punctuation, a sentence over 2,000 characters and mixed Han
text. The core repeated-word assertion is:

```ts
expect(extractSentenceContext(secondRange, "victims")).toBe(
  "Later, the victims were taken to safety.",
);
```

Assert unsafe or unlocatable context returns `null`, not the selected token. Assert a 2,000-character
crop contains the actual selected occurrence.

- [ ] **Step 2: Run focused selection tests and verify failure**

```bash
pnpm exec vitest run --project extension \
  apps/extension/src/content/selection/extract-sentence-context.test.ts \
  apps/extension/src/content/selection/read-selection.test.ts \
  apps/extension/src/content/content-script.test.ts
```

Expected: FAIL because the new module and `AnalyzeRequest.sentenceContext` wiring do not exist.

- [ ] **Step 3: Generalize the existing sentence algorithm**

Move the existing Range offset, `Intl.Segmenter`, abbreviation merge, deterministic punctuation
fallback and crop logic into `extract-sentence-context.ts`. Return `null` when no semantic block,
safe offsets, English sentence or selected occurrence can be established. Keep whitespace folding,
quotes and punctuation; reject Han characters.

In `readSelection`, calculate once for words and phrases:

```ts
const lexical = selectionKind === "word" || selectionKind === "phrase";
const sentenceContext = lexical ? extractSentenceContext(range, normalizedSelection) : null;

return {
  context: extractContext(range, normalizedSelection),
  range: range.cloneRange(),
  selection: normalizedSelection,
  selectionKind,
  sentenceContext,
  wordbookContext: selectionKind === "word" ? sentenceContext : null,
};
```

When a safe sentence cannot be extracted, both fields are `null`: analysis cannot fabricate an
English example and explicit add remains unavailable because Huayi cannot satisfy the required
Eudic context contract.

- [ ] **Step 4: Wire v2 analyze and add-word requests**

`createAnalyzeRequest` must send `sentenceContext: selection.sentenceContext`. `createAddWordRequest`
must keep using `wordbookContext`; add tests proving a phrase gets sentence context for Codex but
never an add-word action, and a word add uses the exact Range-derived sentence.

- [ ] **Step 5: Run extension selection gates and commit**

```bash
pnpm exec vitest run --project extension \
  apps/extension/src/content/selection \
  apps/extension/src/content/content-script.test.ts \
  apps/extension/src/content/content-script-concurrency.test.ts
pnpm --filter @huayi/extension typecheck
git diff --check
git add apps/extension/src/content
git commit -m "feat(extension): extract lexical sentence context"
```

---

### Task 3: Define provider-private model contracts and prompts

**Files:**

- Create: `apps/native-host/src/provider/model-analysis-schemas.ts`
- Create: `apps/native-host/src/provider/model-analysis-schemas.test.ts`
- Modify: `apps/native-host/src/provider/prompt-builder.ts`
- Modify: `apps/native-host/src/provider/prompt-builder.test.ts`
- Modify: `apps/native-host/src/provider/schemas/translate-lexical.json`
- Modify: `apps/native-host/src/provider/schemas/translate-passage.json`
- Modify: `apps/native-host/src/provider/schemas/explain-lexical.json`
- Modify: `apps/native-host/src/provider/schemas/explain-sentence.json`
- Modify: `apps/native-host/src/provider/schemas.test.ts`
- Modify: `apps/native-host/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/native-host/AGENTS.md`

**Interfaces:**

- Produces: private `ModelAnalysisResult`, four strict schemas, result-type lookup and field-schema
  lookup. None are exported from `@huayi/protocol`.
- Consumes: public child schemas only through `@huayi/protocol`.
- Dependency: add direct `zod@^4.0.5` to `@huayi/native-host`; no new library is introduced.

- [ ] **Step 1: Write failing private-schema tests for the reported lexical shapes**

Use exact model-only content such as:

```ts
const fourExplanation = {
  baseForm: null,
  collocations: [],
  contextualMeaningZh: "在这里表示数字四。",
  coreMeanings: [{ meaningZh: "数字四", partOfSpeech: "number" }],
  synonyms: [],
  wordFormation: null,
} as const;
```

Assert it parses. Assert `sourceText`, `selectionKind`, `type`, unknown fields, a fourth synonym,
zero core meanings, a pronunciation with missing required nullable keys and a non-null example
translation with the wrong type are rejected.

- [ ] **Step 2: Run provider contract tests and verify failure**

```bash
pnpm exec vitest run --project native-host \
  apps/native-host/src/provider/model-analysis-schemas.test.ts \
  apps/native-host/src/provider/schemas.test.ts \
  apps/native-host/src/provider/prompt-builder.test.ts
```

Expected: FAIL because model-private schemas do not exist and JSON schemas still demand public
metadata plus non-empty related arrays.

- [ ] **Step 3: Add the direct Zod dependency and private strict schemas**

```bash
pnpm --filter @huayi/native-host add zod@^4.0.5
```

Implement these exact private shapes:

```ts
export interface ModelLexicalTranslation {
  contextualMeaningZh: string;
  partOfSpeech: PartOfSpeech;
  pronunciation: { uk: string | null; us: string | null } | null;
  collocations: Collocation[];
  contextExampleTranslationZh: string | null;
  similarTerms: RelatedTerm[];
}

export interface ModelLexicalExplanation {
  contextualMeaningZh: string;
  baseForm: string | null;
  wordFormation: string | null;
  coreMeanings: CoreMeaning[];
  collocations: Collocation[];
  synonyms: RelatedTerm[];
}
```

The passage schema contains only `translationZh`. The sentence schema contains exactly
`mainStructure`, `keyExpressions`, `translationZh` and `contextRole`. All root and nested objects
must reject unknown keys.

- [ ] **Step 4: Replace the four Codex Structured Output JSON schemas**

Keep every content key in `required`; represent absence with `null` or `[]`. Remove all metadata
properties. Set lexical list `minItems` to 0 and `maxItems` to 3; set core meanings to 1–3. For
pronunciation require both nullable keys when the object is non-null. Order properties by visual
priority, beginning with the streamable core string.

Update `schemas.test.ts` to compare JSON Schema acceptance against the private Zod schema rather
than public result schemas, and assert none of the four files contains `sourceText`,
`selectionKind` or `type`.

- [ ] **Step 5: Align prompt instructions with nullable and empty semantics**

The lexical prompts must say 0–3 and explicitly instruct `null`/`[]` when a field is not naturally
applicable. Include `sentenceContext` in inert `UNTRUSTED_WEBPAGE_DATA`; tell the model to return
only its Chinese translation in `contextExampleTranslationZh`, never repeat the English sentence.
Tests must prove the prompt contains no `2-5`, `3-5`, public metadata request or invented examples.

- [ ] **Step 6: Document the dependency rule, run focused gates and commit**

Add the direct dependency purpose, rejected alternatives and security impact to
`apps/native-host/AGENTS.md`. Then run:

```bash
pnpm exec vitest run --project native-host \
  apps/native-host/src/provider/model-analysis-schemas.test.ts \
  apps/native-host/src/provider/schemas.test.ts \
  apps/native-host/src/provider/prompt-builder.test.ts
pnpm --filter @huayi/native-host typecheck
git diff --check
git add apps/native-host pnpm-lock.yaml
git commit -m "feat(host): define provider private model contracts"
```

---

### Task 4: Assemble trusted final results and add safe diagnostics

**Files:**

- Create: `apps/native-host/src/provider/model-result-assembler.ts`
- Create: `apps/native-host/src/provider/model-result-assembler.test.ts`
- Create: `apps/native-host/src/provider/provider-validation.ts`
- Create: `apps/native-host/src/provider/provider-validation.test.ts`
- Modify: `apps/native-host/src/provider/codex-app-server-provider.ts`
- Modify: `apps/native-host/src/provider/codex-app-server-provider.test.ts`
- Modify: `apps/native-host/src/runtime/error-mapper.ts`
- Modify: `apps/native-host/src/runtime/error-mapper.test.ts`
- Modify: `apps/native-host/src/main.ts`
- Modify: `apps/native-host/src/main.test.ts`

**Interfaces:**

- Produces: `parseAndAssembleModelResult(finalText, request): AnalysisResult` and safe validation
  stages `stream-parse`, `model-json`, `model-schema`, `result-assembly`, `protocol-validation`.
- Changes: model failures map to retryable `INVALID_RESPONSE`; impossible Host assembly/public
  validation failures map to retryable `INTERNAL_ERROR`.
- Preserves: no untrusted text, raw JSON, credentials or environment values enter stderr.

- [ ] **Step 1: Write failing assembler and diagnostic tests**

Cover `sustained`, `victims`, `accountable` and `Four`. Assert the returned public result always has:

```ts
expect(result).toMatchObject({
  selectionKind: request.selectionKind,
  sourceText: request.selection,
  type: expectedResultType,
});
```

For `victims`, let model content contain `baseForm: "victim"` and prove `sourceText` remains
`"victims"`. For `Four`, prove capitalization and `partOfSpeech: "number"` remain valid with empty
lists. Test that example English is always `request.sentenceContext`; a non-null model example
translation with `sentenceContext: null` fails at `result-assembly`.

Feed a fake secret through model JSON, context and a fake token, then assert captured diagnostics
contain only a bounded stage and optional fixed field name.

- [ ] **Step 2: Run focused tests and verify current metadata comparison fails**

```bash
pnpm exec vitest run --project native-host \
  apps/native-host/src/provider/model-result-assembler.test.ts \
  apps/native-host/src/provider/provider-validation.test.ts \
  apps/native-host/src/provider/codex-app-server-provider.test.ts \
  apps/native-host/src/main.test.ts
```

Expected: FAIL because provider still parses the model as public `AnalysisResult` and exact-compares
model-generated metadata.

- [ ] **Step 3: Implement staged parsing and trusted assembly**

`JSON.parse` failure is `model-json`; private Zod failure is `model-schema`. Build each public result
with the request-owned fields first and validated content only. Normalize pronunciation by omitting
null accents and omitting the whole object when both are null. Build `contextExample` only when both
model translation and trusted `sentenceContext` exist.

After assembly, call `analysisResultSchema.safeParse`. Do not drop an invalid optional value to make
the whole result pass. Classify inconsistent assembly as `result-assembly` and public schema failure
as `protocol-validation`.

- [ ] **Step 4: Replace provider final parsing and add safe stderr sink**

Remove the old public parse and these comparisons entirely:

```ts
parsed.data.selectionKind !== request.selectionKind;
parsed.data.sourceText !== request.selection;
```

Inject a diagnostic callback into the provider from `main.ts`. Format only allowlisted stage names
and allowlisted model field names, cap each line at 160 characters, and write only to stderr. The
public Native Messaging error remains the fixed Chinese message from `error-mapper.ts`.

- [ ] **Step 5: Add fake App Server regressions for all reported words**

Add table-driven translate/explain cases whose final assistant text uses valid private model JSON.
Assert no case produces `INVALID_RESPONSE`, request metadata wins over model lexical form, and empty
optional sections remain valid instead of being synthesized.

- [ ] **Step 6: Run Host gates and commit**

```bash
pnpm exec vitest run --project native-host \
  apps/native-host/src/provider \
  apps/native-host/src/runtime/error-mapper.test.ts \
  apps/native-host/src/main.test.ts
pnpm --filter @huayi/native-host typecheck
git diff --check
git add apps/native-host/src
git commit -m "fix(host): assemble reliable lexical results"
```

---

### Task 5: Stream complete validated structured fields

**Files:**

- Create: `apps/native-host/src/provider/streaming-json-tokenizer.ts`
- Create: `apps/native-host/src/provider/streaming-json-tokenizer.test.ts`
- Modify: `apps/native-host/src/provider/streaming-json-fields.ts`
- Modify: `apps/native-host/src/provider/streaming-json-fields.test.ts`
- Modify: `apps/native-host/src/provider/analysis-provider.ts`
- Modify: `apps/native-host/src/provider/codex-app-server-provider.ts`
- Modify: `apps/native-host/src/provider/codex-app-server-provider.test.ts`
- Modify: `apps/native-host/src/protocol/dispatcher.ts`
- Modify: `apps/native-host/src/protocol/dispatcher.test.ts`

**Interfaces:**

- Produces: one provider callback carrying either a text delta or a complete public section payload.
- Preserves: assistant JSON 1 MiB limit, per-delta limit, duplicate-key rejection, final strict parse
  and one shared dispatcher-owned sequence.

- [ ] **Step 1: Write failing tokenizer and structured-stream tests**

Define provider updates as:

```ts
export type AnalysisStreamUpdate =
  | {
      delta: string;
      section: AnalysisDeltaSection;
      type: "analysis-delta";
    }
  | (AnalysisSectionPayload & { type: "analysis-section" });

export type AnalysisStreamListener = (update: AnalysisStreamUpdate) => void;
```

Test arrays and objects split at every chunk boundary, nested quoted braces, escaped quotes,
surrogate pairs, CR/LF, duplicate root keys, unknown keys, primitives, oversized JSON and unfinished
containers. Assert no structured event appears until the closing delimiter and field-level Zod parse
succeeds.

- [ ] **Step 2: Run parser/provider/dispatcher tests and verify failure**

```bash
pnpm exec vitest run --project native-host \
  apps/native-host/src/provider/streaming-json-tokenizer.test.ts \
  apps/native-host/src/provider/streaming-json-fields.test.ts \
  apps/native-host/src/provider/codex-app-server-provider.test.ts \
  apps/native-host/src/protocol/dispatcher.test.ts
```

Expected: FAIL because the current extractor supports only selected string deltas.

- [ ] **Step 3: Split the bounded JSON parser before extending it**

Move character-level JSON state, escape decoding, nesting and complete top-level value capture into
`streaming-json-tokenizer.ts`. Keep field policy and wire-size limits in
`streaming-json-fields.ts`. The tokenizer must emit only:

```ts
export type TopLevelJsonUpdate =
  | { field: string; kind: "string-delta"; value: string }
  | { field: string; kind: "complete-value"; value: unknown };
```

Neither file may exceed 400 handwritten lines. Unknown fields may be ignored for preview only; the
final private root Schema must still reject them.

- [ ] **Step 4: Map complete private fields to public section payloads**

For lexical translation map part of speech, pronunciation, collocations, trusted context example
and similar terms. For lexical explanation map base form, word formation, core meanings,
collocations and synonyms. Validate with the exact private child schema before transformation.
Return no event for `null`, empty arrays or a pronunciation whose two values are null.

Keep contextual meaning, passage translation, main structure and context role on the existing text
delta path.

- [ ] **Step 5: Interrupt immediately on stream parse or field validation failure**

On the first JSON boundary, syntax, duplicate-key or size failure, record `stream-parse`; on a
complete field that fails its private child Schema, record `model-schema`. In either case stop
emitting updates and call `appServer.interrupt(request.requestId)`. If the interrupted turn rejects,
prefer the recorded `INVALID_RESPONSE` over a derived `CANCELLED`. Add a test proving later assistant
chunks and a final result are not emitted after the first invalid field.

- [ ] **Step 6: Emit both update types with one dispatcher sequence**

In `dispatchAnalyze`, allocate one `sequence` counter. Emit `analysis-delta` or
`analysis-section` according to `update.type`, then increment once. Validate every event with
`hostEventSchema` before stdout.

- [ ] **Step 7: Run Host provider/dispatcher gates and commit**

```bash
pnpm exec vitest run --project native-host \
  apps/native-host/src/provider \
  apps/native-host/src/protocol/dispatcher.test.ts
pnpm --filter @huayi/native-host typecheck
git diff --check
git add apps/native-host/src/provider apps/native-host/src/protocol
git commit -m "feat(host): stream validated analysis sections"
```

---

### Task 6: Warm the App Server without starting a model turn

**Files:**

- Modify: `apps/native-host/src/runtime/codex-app-server-lifecycle.ts`
- Modify: `apps/native-host/src/runtime/codex-app-server.ts`
- Modify: `apps/native-host/src/runtime/codex-app-server.test.ts`
- Modify: `apps/native-host/src/runtime/codex-app-server-startup.test.ts`
- Modify: `apps/native-host/src/provider/analysis-provider.ts`
- Modify: `apps/native-host/src/provider/codex-app-server-provider.ts`
- Modify: `apps/native-host/src/provider/codex-app-server-provider.test.ts`
- Modify: `apps/native-host/src/protocol/dispatcher.ts`
- Modify: `apps/native-host/src/protocol/dispatcher.test.ts`
- Modify: `apps/native-host/src/protocol/dispatcher-test-helpers.ts`

**Interfaces:**

- Adds: `CodexAppServer.warmup(signal): Promise<void>` and
  `AnalysisProvider.warmup(signal): Promise<void>`.
- Adds: Native Host `warmup` dispatch ending only in `warmup-ready` or `error`.
- Preserves: `runTurn` still creates a fresh ephemeral thread/turn per analysis.

- [ ] **Step 1: Write failing no-model and shared-startup tests**

Test that `warmup()` performs MCP discovery, process creation and initialize safety checks, while
the fake JSON-RPC request log contains neither `thread/start` nor `turn/start`. Add a race:

```ts
const warming = client.warmup(warmupController.signal);
const analyzing = client.runTurn(turnRequest);

await Promise.all([warming, analyzing]);
expect(discoverMcp).toHaveBeenCalledTimes(1);
expect(processFactory).toHaveBeenCalledTimes(1);
expect(initializeRequests).toHaveLength(1);
```

Also cover warmup cancellation, initialization failure followed by a successful analyze retry,
dispose during startup and two concurrent warmups.

- [ ] **Step 2: Run App Server and dispatcher tests and verify failure**

```bash
pnpm exec vitest run --project native-host \
  apps/native-host/src/runtime/codex-app-server.test.ts \
  apps/native-host/src/runtime/codex-app-server-startup.test.ts \
  apps/native-host/src/provider/codex-app-server-provider.test.ts \
  apps/native-host/src/protocol/dispatcher.test.ts
```

Expected: FAIL because no warmup method or dispatcher branch exists.

- [ ] **Step 3: Generalize session demand and reuse `ensureSession()`**

Track active warmup callers separately from active turns so `#startSession()` remains demanded after
MCP discovery even when no turn exists. `warmup(signal)` must race caller cancellation against the
same private `#ensureSession()` Promise used by `runTurn()`. Cancellation of one caller must not tear
down a shared startup still needed by another warmup or analyze.

Do not call `#startThread`, `startAppServerThread` or `startAppServerTurn` from warmup.

- [ ] **Step 4: Delegate provider warmup and dispatch it through the request queue**

`CodexAppServerProvider.warmup` delegates directly to App Server. Add a `warmup` switch branch to the
dispatcher, enqueue it under its request ID, propagate queue cancellation, and emit exactly:

```ts
{
  requestId: request.requestId,
  schemaVersion: SCHEMA_VERSION,
  type: "warmup-ready",
}
```

Do not emit model progress or create a wordbook request.

- [ ] **Step 5: Run Native Host lifecycle gates and commit**

```bash
pnpm exec vitest run --project native-host \
  apps/native-host/src/runtime/codex-app-server*.test.ts \
  apps/native-host/src/provider/codex-app-server-provider.test.ts \
  apps/native-host/src/protocol/dispatcher.test.ts
pnpm --filter @huayi/native-host typecheck
git diff --check
git add apps/native-host/src
git commit -m "feat(host): warm codex app server session"
```

---

### Task 7: Coordinate warmup and ordered progressive events in the extension

**Files:**

- Modify: `apps/extension/src/shared/extension-messages.ts`
- Modify: `apps/extension/src/shared/extension-messages.test.ts`
- Modify: `apps/extension/src/background/request-coordinator.ts`
- Modify: `apps/extension/src/background/request-coordinator-test-helpers.ts`
- Modify: `apps/extension/src/background/request-coordinator.test.ts`
- Modify: `apps/extension/src/background/service-worker.ts`
- Modify: `apps/extension/src/background/service-worker.test.ts`
- Modify: `apps/extension/src/background/native-transport.test.ts`
- Modify: `apps/extension/src/content/content-script.ts`
- Modify: `apps/extension/src/content/content-script.test.ts`
- Modify: `apps/extension/src/content/content-script-acknowledgement.test.ts`
- Modify: `apps/extension/src/content/content-script-concurrency.test.ts`

**Interfaces:**

- Adds internal command: `{ type: "WARMUP_HOST" }`, with no request, selection or context field.
- Adds coordinator method: `warmup(): void`, scoped to the Native Messaging port lifecycle rather
  than a tab.
- Changes analysis delivery: `analysis-delta` and `analysis-section` use one ordered path.

- [ ] **Step 1: Write failing command, coordinator and content tests**

Assert `parseContentCommand({ type: "WARMUP_HOST" })` succeeds and any extra key fails. Test first
valid selection synchronously shows actions, then sends one warmup command. Selecting again while
warmup is pending or ready sends no native duplicate; a transport disconnect resets it so a later
selection may send a new warmup.

Test that closing, Escape and a replacement selection cancel analysis/check/add lanes but never send
cancel for warmup. Add mixed ordered updates at sequence 0/1 and reject gaps, duplicates, wrong lanes,
updates after terminal and wrong terminal event types.

- [ ] **Step 2: Run extension coordination tests and verify failure**

```bash
pnpm exec vitest run --project extension \
  apps/extension/src/shared/extension-messages.test.ts \
  apps/extension/src/background/request-coordinator.test.ts \
  apps/extension/src/background/service-worker.test.ts \
  apps/extension/src/content/content-script*.test.ts
```

Expected: FAIL because warmup and `analysis-section` are not routed.

- [ ] **Step 3: Add the page-data-free warmup command**

After `controller.show(selectionInput, anchorRect)`, send `{ type: "WARMUP_HOST" }` asynchronously
without awaiting it or changing the overlay. Swallow only the transport acknowledgement failure;
the first actual analyze must still surface its own normal error.

Service Worker calls `coordinator.warmup()` only for a valid sender tab. The coordinator creates the
random `WarmupRequest`, tracks `idle | pending | ready`, does not deliver ready/error to a tab, and
resets to idle on disconnect or warmup failure.

- [ ] **Step 4: Generalize ordered analysis update routing**

For a pending analyze, treat both event types as nonterminal updates:

```ts
const isAnalysisUpdate = event.type === "analysis-delta" || event.type === "analysis-section";
```

Require `event.sequence === pending.nextSequence`, deliver it, then increment. Any mismatch sends a
targeted cancel, removes the request and delivers fixed `INVALID_RESPONSE`. Non-analysis lanes must
reject either update type. A terminal result finishes the lane and late updates are ignored locally.

- [ ] **Step 5: Route sections to the controller without disturbing wordbook concurrency**

Content Script forwards either update to one controller method. Keep analyze acknowledgement before
automatic `check-word`, and keep check errors isolated from analysis. Prove a check result may arrive
before or after structured sections without consuming their sequence.

- [ ] **Step 6: Run extension transport gates and commit**

```bash
pnpm exec vitest run --project extension \
  apps/extension/src/shared \
  apps/extension/src/background \
  apps/extension/src/content/content-script*.test.ts
pnpm --filter @huayi/extension typecheck
git diff --check
git add apps/extension/src
git commit -m "feat(extension): coordinate warmup and progressive updates"
```

---

### Task 8: Render typed progressive lexical sections

**Files:**

- Create: `apps/extension/src/content/overlay/overlay-update-batch.ts`
- Create: `apps/extension/src/content/overlay/render-analysis-sections.ts`
- Create: `apps/extension/src/content/overlay/render-analysis-sections.test.ts`
- Delete: `apps/extension/src/content/overlay/overlay-delta-batch.ts`
- Modify: `apps/extension/src/content/overlay/overlay-state.ts`
- Modify: `apps/extension/src/content/overlay/overlay-state.test.ts`
- Modify: `apps/extension/src/content/overlay/overlay-controller.ts`
- Modify: `apps/extension/src/content/overlay/overlay-controller.test.ts`
- Modify: `apps/extension/src/content/overlay/render-streaming-preview.ts`
- Modify: `apps/extension/src/content/overlay/render-streaming-preview.test.ts`
- Modify: `apps/extension/src/content/overlay/render-result.ts`
- Modify: `apps/extension/src/content/overlay/render-result.test.ts`
- Modify: `apps/extension/src/content/overlay/render-result.test-fixtures.ts`
- Modify: `apps/extension/src/content/overlay/styles.ts`

**Interfaces:**

- Changes: `AnalysisPreview` stores text deltas and typed complete sections separately with one
  `lastSequence`.
- Adds: `appendUpdate(event: AnalysisDeltaEvent | AnalysisSectionEvent)` on the controller.
- Preserves: state-machine-only transitions, 40–50 ms DOM batching, scroll/focus restoration and
  right-header wordbook status.

- [ ] **Step 1: Write failing state, renderer and controller tests**

Test text sequence 0 followed by a part-of-speech section at 1 and collocations at 2. Feed sections
in nonvisual order and assert DOM order remains fixed. For `Four`, assert the card contains the
contextual meaning and number part of speech but no headings for 构词、语境搭配、同义词 or 相似词.

Use hostile values such as `<img src=x onerror=alert(1)>` and assert they appear only as text and no
element is created. Test an invalid terminal after valid sections keeps preview plus “内容未完整生成”.

- [ ] **Step 2: Run overlay tests and verify failure**

```bash
pnpm exec vitest run --project extension \
  apps/extension/src/content/overlay/overlay-state.test.ts \
  apps/extension/src/content/overlay/overlay-controller.test.ts \
  apps/extension/src/content/overlay/render-analysis-sections.test.ts \
  apps/extension/src/content/overlay/render-streaming-preview.test.ts \
  apps/extension/src/content/overlay/render-result.test.ts
```

Expected: FAIL because preview stores only strings and final rendering always emits array headings.

- [ ] **Step 3: Generalize the batch and overlay state**

Rename the batch to `OverlayUpdateBatch` and preserve its single 40–50 ms timer. Replace
`APPEND_DELTA` with one `APPEND_ANALYSIS_UPDATE` event. The reducer must reject any update whose
sequence is not `lastSequence + 1`; deltas append strings, sections replace their one typed value.

Represent typed preview values explicitly with public protocol types; do not use `unknown`, `any` or
model-private types in the extension.

- [ ] **Step 4: Extract shared safe section renderers**

Move part-of-speech labels, source, pronunciation, collocation, meaning and related-term DOM helpers
into `render-analysis-sections.ts`. Every user/model value must be assigned with `textContent`.
Functions for list sections must return without creating a heading when the input array is empty.

Use the same helpers in final and progressive renderers so labels and escaping cannot drift.

- [ ] **Step 5: Render in fixed visual order and preserve orthogonal wordbook state**

Always render available values in these orders:

```text
翻译：原词 -> 语境义 -> 词性 -> 音标 -> 搭配 -> 原文例句 -> 相似词
解释：原词 -> 语境义 -> 原形 -> 构词 -> 核心词义 -> 搭配 -> 同义词
```

The header may show an already-present word during streaming, but explicit add remains enabled only
for a complete lexical `result`. Rerender must restore body scroll and the matching focused action.

- [ ] **Step 6: Run complete overlay gates and commit**

```bash
pnpm exec vitest run --project extension apps/extension/src/content/overlay
pnpm --filter @huayi/extension typecheck
pnpm --filter @huayi/extension build
git diff --check
git add apps/extension/src/content/overlay
git commit -m "feat(extension): render progressive lexical sections"
```

---

### Task 9: Add browser regressions and measurable smoke timings

**Files:**

- Modify: `apps/extension/e2e/fixtures/selection-journeys.html`
- Modify: `apps/extension/e2e/support/harness.ts`
- Modify: `apps/extension/e2e/support/harness-results.ts`
- Modify: `apps/extension/e2e/support/journey-helpers.ts`
- Modify: `apps/extension/e2e/selection-journeys.spec.ts`
- Modify: `apps/extension/e2e/streaming-wordbook-journeys.spec.ts`
- Modify: `scripts/native-host-smoke-client.mjs`
- Modify: `scripts/native-host-smoke-client.test.mjs`
- Modify: `scripts/native-host-smoke-helpers.mjs`
- Modify: `scripts/native-host-smoke-helpers.test.mjs`
- Modify: `scripts/native-host-smoke-streaming-cases.mjs`
- Modify: `scripts/verify-ephemeral-session.mjs`
- Modify: `scripts/verify-ephemeral-session.test.mjs`
- Modify: `apps/extension/src/manifest.test.ts`

**Interfaces:**

- E2E fake transport supports warmup, text delta, complete section and final result without network.
- Smoke client accepts both analysis update types with one sequence and returns timestamps without
  returning or logging model text.
- Real smoke request set includes four reported words plus existing phrase, sentence and paragraph
  baselines; this task updates it but does not run it.

- [ ] **Step 1: Write failing E2E and smoke-client tests**

Add fixtures for `sustained`, `victims`, `accountable` and `Four` in real sentence context. Cover
translate and explain across the four words so every case reaches a complete result, retains exact
source form and hides inapplicable sections.

Assert the toolbar is visible within 100 ms of the fixture selection event and the first native
request is a payload-free warmup. Assert at least one `analysis-section` is visible before final
result. Preserve both wordbook races and all existing close/new-selection/Escape cancellation tests.

Add smoke unit cases where sequence 0 is a delta and sequence 1 is a section; reject a section gap,
wrong lane, duplicate, late section and terminal mismatch.

- [ ] **Step 2: Run E2E and script tests and verify failure**

```bash
node --test scripts/*.test.mjs
pnpm test:e2e
```

Expected: FAIL because the harness and smoke client do not yet understand warmup or sections.

- [ ] **Step 3: Extend the browser harness without weakening production validation**

Log request type and safe metadata for assertions. On warmup, emit `warmup-ready` without invoking
the fake analyze result builder. Emit structured values before terminal and keep final results strict.
Do not add special production branches for fixture words.

Keep Manifest regression exact:

```ts
expect(manifest.permissions).toEqual(["nativeMessaging"]);
```

- [ ] **Step 4: Generalize smoke event accounting and timing labels**

The client must count either analysis update against one expected sequence and set first-update time
on the first valid delta or section. `verify-ephemeral-session.mjs` must first send warmup and output
only these labels and integer durations:

```text
cold warmup: <ms> ms
click-to-first-delta: <ms> ms
click-to-full-result: <ms> ms
```

Do not print selections, model deltas, sections, final model text or raw diagnostics. Keep session
snapshot verification and detached process-group shutdown unchanged.

- [ ] **Step 5: Add the real request matrix without executing it**

Give word/phrase requests their exact `sentenceContext`; sentence/paragraph requests use `null`.
Include the four reported words and current investigation, sustained-heatwave phrase, sentence and
paragraph baselines. Update `validateSmokeResult` for 0–3 lists and exact request-owned metadata.

- [ ] **Step 6: Run fake browser/script gates and commit**

```bash
node --test scripts/*.test.mjs
pnpm test:e2e
pnpm --filter @huayi/extension typecheck
git diff --check
git add apps/extension/e2e apps/extension/src/manifest.test.ts scripts
git commit -m "test: cover lexical reliability and progressive timing"
```

Do not run `pnpm smoke:codex` in this task.

---

### Task 10: Release v0.4.0 documentation and complete the default gate

**Files:**

- Modify: `package.json`
- Modify: `apps/extension/package.json`
- Modify: `apps/extension/manifest.json`
- Modify: `apps/native-host/package.json`
- Modify: `packages/protocol/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/native-host/src/protocol/dispatcher.ts`
- Modify: `apps/native-host/src/protocol/dispatcher.test.ts`
- Modify: `apps/native-host/src/runtime/codex-app-server-protocol.ts`
- Modify: `apps/native-host/src/runtime/codex-app-server.test.ts`
- Modify: `apps/native-host/src/wordbook/eudic-client.ts`
- Modify: `apps/native-host/src/wordbook/eudic-client.test.ts`
- Modify: `scripts/version-consistency.test.mjs`
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

**Interfaces:**

- Releases: app/package/Manifest/Host/client identity/User-Agent version `0.4.0` and wire version 2.
- Documents: failure cause, private/public contract boundary, warmup privacy, progressive terminal
  semantics, performance metrics, synchronous upgrade and rollback.
- Preserves: current extension ID, Eudic Keychain item and macOS install paths.

- [ ] **Step 1: Make version consistency fail for the intended release**

Change the expected version in `scripts/version-consistency.test.mjs` to `0.4.0` and add assertions
for Host `HOST_VERSION`, App Server `clientInfo.version` and Eudic `User-Agent`.

```bash
node --test scripts/version-consistency.test.mjs
```

Expected: FAIL while runtime and package versions remain 0.3.1.

- [ ] **Step 2: Update every live version source to 0.4.0**

Update the root and workspace packages, Manifest, dispatcher Host version, App Server client info,
Eudic User-Agent and lockfile. Do not rewrite historical version references inside dated designs or
plans.

```bash
node --test scripts/version-consistency.test.mjs
```

Expected: PASS with all live versions exactly 0.4.0.

- [ ] **Step 3: Update governance and Chinese delivery documents**

Document:

- v1 messages are incompatible with v2 and Extension/Host require synchronous reinstall.
- the model emits content only; Host owns source text, kind and result type.
- warmup contains no webpage text and does not create a model turn or consume model output quota.
- typed sections are previews; only `result` is a complete success.
- empty lexical sections are intentionally hidden and never backfilled with fabricated values.
- safe stderr stages never include page/model/credential contents.
- default tests remain offline; real smoke requires explicit approval.
- upgrade commands, Chrome refresh, Host reinstall with extension ID
  `kfkamoejomjdihipgdkmfjcdenlhgnpd`, and preservation of the Eudic Keychain item.

Keep permissions and unsupported-platform scope unchanged.

- [ ] **Step 4: Run the complete default quality gate**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
git diff --check
```

Expected: every command exits 0. If formatting fails, run `pnpm format`, inspect the resulting diff,
then rerun the complete gate from the first command.

- [ ] **Step 5: Audit security and migration invariants**

```bash
rg -n 'schemaVersion: 1|schemaVersion": 1' apps packages scripts \
  --glob '*.{ts,mjs,json}'
rg -n '\.innerHTML' apps/extension/src --glob '!*.test.ts'
rg -n 'host_permissions|"storage"|"alarms"|"offscreen"' apps/extension/manifest.json
rg -n '"sourceText": \{|"selectionKind": \{|"type": \{' \
  apps/native-host/src/provider/schemas
git status --short
```

Expected: schema v1 appears only in explicit rejection tests; no forbidden permission/rendering
usage exists; provider JSON schemas contain no public metadata; only intended task files are dirty.

- [ ] **Step 6: Commit the release documentation and version**

```bash
git add AGENTS.md README.md CONTRIBUTING.md package.json pnpm-lock.yaml \
  apps packages scripts/version-consistency.test.mjs docs
git commit -m "docs: release huayi v0.4.0"
```

- [ ] **Step 7: Request explicit approval before real Codex smoke**

Do not run the command automatically. After the user explicitly authorizes quota use, run:

```bash
pnpm smoke:codex
```

Expected: all word/phrase/sentence/paragraph results validate, the three timing labels contain only
durations, and `~/.codex/sessions` gains no Huayi session file.

- [ ] **Step 8: Rebuild and replace the installed local extension after approval**

After successful default gate and any authorized smoke, use the documented synchronous upgrade:

```bash
pnpm build
pnpm host:install -- --extension-id kfkamoejomjdihipgdkmfjcdenlhgnpd
```

Then refresh the unpacked `apps/extension/dist` entry in `chrome://extensions`, verify it reports
0.4.0, and manually check one absent and one existing Eudic word. Reinstall must not read, overwrite
or delete the existing Eudic Keychain authorization.

---

## Implementation Completion Checklist

- [ ] Every task has its own green focused tests and Conventional Commit.
- [ ] `sustained`, `victims`, `accountable` and `Four` pass private schema, Host assembly, progressive
      update, final protocol and E2E coverage.
- [ ] Empty optional lexical content never causes `INVALID_RESPONSE` or an empty UI heading.
- [ ] Model output cannot control `sourceText`, `selectionKind`, `type` or English context example.
- [ ] warmup performs no thread/turn/model operation and contains no page data.
- [ ] warmup/analyze races create one App Server session initialization.
- [ ] Mixed delta/section sequences fail closed on gap, duplicate, wrong lane or late event.
- [ ] Safe preview survives terminal validation failure without being labeled complete.
- [ ] Wordbook lookup/add concurrency and right-header status remain unchanged.
- [ ] Manifest permissions equal `['nativeMessaging']`.
- [ ] Default tests access neither OpenAI, Eudic nor the real Keychain.
- [ ] Full default quality gate and `git diff --check` pass.
- [ ] Real smoke and local installation occur only after the stated approval gates.
