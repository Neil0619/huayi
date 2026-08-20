# Phase 28 语义重复建议与显式合并方案

## 1. 状态与需求校准

影响平台为 `shared`。产品要求学习库使用平台模型提供语义建议；当前 strict route、owner-scoped
候选上下文、固定 DeepSeek adapter、付费深模块、forced-RLS Postgres authority、production composition、
Web 显式重试和 actual-bundle 用户旅程均已完成离线实现与验证。

本阶段不是让模型自动合并，也不改变 canonical exact duplicate。它把“查找语义重复”实现为一次用户
显式触发、可计费、可恢复、只返回服务器重读候选投影的建议调用；用户仍须预览并再次明确确认 merge。

状态：`S1–S5 implemented and verified; target-platform and real-service validation pending`。

## 2. 产品行为与边界

1. 只有 active/full Web session 可请求；source 必须属于当前 owner、未归档且 revision 匹配；
2. API 从服务器读取最多 50 个同类型、未归档候选，Provider 不接收 owner、email、标签、notes、来源
   快照、排期、URL 或任意客户端候选；
3. Provider 只看到 source/candidate 的最小类型化核心文本和不透明本次别名，最多返回 10 个别名、中文
   理由（1–500 字）与 `[0,1]` confidence；未知、重复或越权别名丢弃；
4. 没有候选时零额度、零 Provider 调用并返回空建议；有候选时先取得月度额度 reservation，再耐久标记
   dispatch，任何失败都不得自动切换 BYOK 或自动 merge；
5. 浏览器每次用户动作生成 Idempotency-Key。同 owner/key/相同 source revision 重放同一完成结果；同 key
   不同输入冲突；运行中返回稳定 `generation_busy`，不能并发重复调用；
6. dispatch 后丢失回执属于不确定计费：保守结算并终态失败，只允许用户以新 key 显式重试；
7. 结果只是短时 merge 建议，不改变 LearningItem、ScheduleState、AnalysisRecord 或标签。preview 和
   confirm 继续重新验证 source/target revision、同 owner/type、source 未练习且 level=-1；
8. quota exhausted、kill switch、Provider/Schema/timeout 错误使用稳定公共错误；DOM、日志、审计和公开
   snapshot 不包含完整候选集、prompt、raw Provider output、usage detail 或内部 task/reservation ID。

## 3. 公共契约与 HTTP

- 保留 `POST /v1/learning-items/:id/duplicate-suggestions` 与 strict body
  `{expectedRevision}`；新增 strict `Idempotency-Key` header，拒绝 `If-Match`、owner、candidate IDs、model、
  endpoint、prompt 或 quota 字段；
- response 继续使用 `DuplicateSuggestionsResponse`，只含 source revision 与最多 10 个 server-reread
  candidate projections；不公开 generation/task ID；
- route 要求 Cookie + trusted Origin + CSRF + Idempotency-Key，并从 handler 起点设置
  `Cache-Control: private, no-store`；
- empty candidate 返回 200；active replay 返回同一 200；运行中 409 `generation_busy`；额度不足 429
  `quota_exhausted`（不暗示 V1 可购买额度）；Provider 不可用/超时 503 `model_unavailable`；strict 输出失败 502
  `model_output_invalid`；
- Web 不自动重试。失败保留当前详情，用户再次点击产生新 key；成功后 suggestion 只驻留组件内存，页面
  切换或 revision 变化立即丢弃。

## 4. 深模块设计

```ts
interface DuplicateSuggestionProvider {
  generate(input: {
    candidates: { alias: string; content: LearningItemContent }[];
    source: { content: LearningItemContent };
  }): Promise<{
    billedCalls: AnalysisBilledCall[];
    suggestions: { alias: string; confidence: number; reasonZh: string }[];
  }>;
}

interface DuplicateSuggestionGenerationRepository {
  begin(
    command: BeginCommand,
  ): Promise<
    | { kind: "acquired"; reservationId: string }
    | { kind: "resolved"; response: DuplicateSuggestionsResponse }
    | { kind: "busy" }
  >;
  markDispatched(command: LeaseCommand): Promise<boolean>;
  complete(command: CompleteCommand): Promise<DuplicateSuggestionsResponse>;
  fail(command: FailureCommand): Promise<void>;
}
```

`PaidDuplicateSuggestionGenerator` 的外部 interface 只有 `suggest(command)`；候选别名、request hash、
request/lease ID、terminal replay/busy/conflict→价格预检→reserve/claim→dispatch→provider→strict alias
filter→complete/settle 顺序均留在 module 内部。HTTP/maintenance 不接触 quota row 或 Provider usage；
Provider 不接触数据库、owner 或 public HTTP。repository 是该深 module 的内部 seam，在一个 owner
transaction 内协调 task、reservation、ledger 与 terminal response。相同 owner/key 的有效 completed/
failed replay 在检查新部署价格前返回；只有真正的新 generation 才先精确校验价格版本，再创建额度预留。
`markDispatched=false` 与 active `busy` 都固定映射为 `generation_busy`，且绝不调用 Provider。

DeepSeek adapter 使用固定 model/HTTPS endpoint/timeout、`response_format=json_object`、temperature 0、固定
prompt version `learning-duplicate-suggestions-v1`。用户内容始终作为数据块，不解释其中指令；adapter
丢弃 reasoning，只把 strict JSON 与每个实际调用的 `billedCalls[]` 返回深模块。S2 固定为单次 Provider
调用，因此 reservation 上限使用 131,072 input tokens + 2,048 output tokens；若将来加入 repair call，必须
先提高 reservation ceiling、保存两次 billed call 并重新审查保守结算，不能静默复用当前上限。

分时计费后，新 generation 先按 peak 上限 reserve；`markDispatched` 使用其可信 `now` 选择实际快照，
在同一数据库 transition 验证三项代码单价并写入 UUID，成功后才允许 Provider fetch。terminal
replay/busy 仍先于新 generation 的 reserve/dispatch；settlement 只读 request 已固定的价格版本。详见
`deepseek-v4-billing.md`。

## 5. 数据结构与状态机

未发布 bootstrap 新增 owner-scoped `learning_duplicate_suggestion_requests`：

| 字段                                                       | 约束与用途                                                              |
| ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| `id`, `owner_user_id`, `source_item_id`, `source_revision` | UUID owner FK、source/revision 请求快照                                 |
| `idempotency_key`, `request_hash`                          | owner 内唯一；hash 只含 source ID/revision 与固定 prompt/schema version |
| `state`                                                    | `pending\|running\|completed\|failed`                                   |
| `generation`, `lease_expires_at`, `dispatched_at`          | 单写 lease/fencing 与不确定 dispatch 边界                               |
| `reservation_id`, `price_version_id`                       | quota reservation 与不可变价格版本                                      |
| `candidate_aliases`, `response`, `stable_error_code`       | alias→ID/revision、strict public response 或 allowlisted error          |
| `created_at`, `updated_at`, `expires_at`                   | terminal 最多保留 24 小时供 replay/清理                                 |

表启用 forced RLS；普通业务 role 只经 SECURITY DEFINER transitions，不直接 SELECT/INSERT/UPDATE。为
保证相同 key 精确 replay，`response` 会在同一数据库短时复制最多 10 个 bounded public candidate
projections 与理由，最多保留 24 小时；不保存 prompt、50 项完整 Provider input 或 raw output。账号删除
级联；每分钟独立 CRON 最多清理 100 条到期 terminal。AccountDataExport 排除该短时内部任务，但 usage
ledger 的公开聚合继续进入额度统计。

```text
none -> running + active reservation + lease -> dispatched
dispatched -> completed + ledger succeeded + reservation settled
dispatched -> failed + ledger failed/conservative + reservation settled
running before dispatch lease expiry -> reservation released + old request deleted
expired lease before dispatch -> same owner/key may create a new generation
expired lease after dispatch -> terminal conservative failure; never transparent provider retry
```

UsageLedger feature 固定为 `learning-duplicate-suggestions`，call ordinal 固定 0。reservation 使用公开最大
输入（source + 50 bounded candidates + prompt）和固定最大输出计算，不信任浏览器 token 估计。

## 6. TDD 分阶段

### S1 contracts + HTTP proof

- Fresh RED：suggestion headers 不接受 Idempotency-Key；Web client 不发送；HTTP 未检查 Origin/CSRF/no-store；
- GREEN：新增 strict header、proof 与稳定错误映射，不接 Provider。

实现记录：Fresh RED 分别证明 contract schema 缺失、Web 未传键、API 未设置 no-store，以及
`generation_busy`/`quota_exhausted`/`model_output_invalid` 仍错误落为 400。GREEN 新增专用 strict header，
Web 每次点击传新 key，API 拒绝缺失 key 与 `If-Match` 并从 handler 起点设置 `private, no-store`；错误状态
固定为 409/429/502。focused contracts 3/3、Web 12/12、API 7/7 与三包 strict typecheck、目标 ESLint
通过。S1 只证明 HTTP 边界，不代表 key 已有耐久 replay；该语义由 S2/S3 完成。

### S2 provider + paid deep module

- Provider RED：URL/headers/body/model/prompt/schema/timeout/usage、reasoning 丢弃、未知字段和 prompt
  injection；
- generator RED：empty zero-call、reserve-before-provider、dispatch-before-provider、alias allowlist、busy/replay、
  quota/kill switch、invalid output、ambiguous usage conservative settlement；
- GREEN 只实现 port/deep module 与 fake repository，不接 production。

实现记录：Fresh RED 已证明两个目标 module 均不存在，focused Vitest 因
`paid-duplicate-suggestion-generator.js` 与 `deepseek-duplicate-suggestion-provider.js` 缺失而准确失败。
实现前 seam 复审又校准了旧文档漂移：Provider 返回 `billedCalls[]` 而非单个 `usage`，repository begin
返回 `acquired/resolved/busy` 的带类型结果，`markDispatched` 以 boolean 执行 fencing。外部 interface
仍只有 `suggest(command)`；上述 repository/provider 只作为内部 production/test adapter seam。

GREEN 新增两个 module，并在根侧审查发现“空候选仍进入 reservation/dispatch/provider”的遗漏后补充
Fresh 回归；该回归先以 1 failed / 7 passed 证明 repository 被错误调用，再把空候选校准为验证输入后的
deterministic empty fast path，即使 kill switch 关闭也零 repository、零 dispatch、零 Provider。最终 S2
focused 12/12、API 105 files / 374 tests、strict typecheck、build、instructions、architecture 与目标
ESLint/Prettier 全部通过。S2 尚未接 Postgres 或 production composition，不代表 key 已有耐久 replay。

### S3 Postgres authority

- migration/PGlite RED：表、forced RLS、business role 零直访、owner/key/hash、single lease/fencing、replay、
  before/after-dispatch recovery、ledger/settlement 原子性、cleanup≤100、账号删除；
- GREEN：SECURITY DEFINER transitions + repository adapter；不做内存锁冒充多连接证明。

实现记录：Fresh RED 的两个 PGlite suites 因 repository/maintenance module 缺失而失败。GREEN 新增
restricted owner-scoped request 表、forced RLS/零 business 直访、固定 search_path 的 definer transitions、
Postgres repository 与总批次≤100 的 `SKIP LOCKED` maintenance。根侧审查随后发现 CRON 把未 dispatch
请求错误终态化；新增回归先以 1 failed / 5 passed 证明同 key 被阻塞，再校准为未 dispatch 释放并删除旧
request、零 ledger、同 key 可重领，已 dispatch 仍保守结算并永久失败。最终 focused 4 files / 23 tests、
API 107 files / 383 tests、strict typecheck/build、instructions/architecture 与目标 ESLint/Prettier 通过。
S3 仍未接 production composition 或 Web。

### S4 production + Web + actual bundle

- production RED：composition 仍固定 `model_unavailable`；
- Web RED：同 key/缺 proof/失败自动重试或迟到结果污染新详情；
- actual-bundle RED：当前 authority 无 suggestion/preview/confirm routes；
- GREEN：接 DeepSeek provider、Postgres generator、Web 新 key/保留详情，并增加 suggestion→preview→explicit
  confirm→server reread 的 production-bundle journey。

实现记录：production app 已通过 `createProductionDuplicateSuggestions` 组合固定 DeepSeek adapter、
`PaidDuplicateSuggestionGenerator` 与 Postgres repository，并挂载受 `CRON_SECRET` bearer 保护、每分钟
调度的 `/internal/learning-duplicate-suggestions/cleanup`。Postgres begin 对相同 owner/key 先重放 terminal
结果或返回 busy/conflict；只有新 generation 才在新 reservation 前精确校验部署价格快照，再由共享
`reserve_quota` 在 Provider fetch 前执行 kill switch 与额度检查。单次 Provider 上限固定为 131,072 input
tokens 和 2,048 output tokens，成功/失败均按实际或保守用量原子结算。

Web 每次用户点击生成新 `Idempotency-Key`，不自动重试；稳定 quota/busy/output/provider 错误保留当前
详情和既有 suggestion，item 选择或 revision 变化会清除 suggestion 并用 generation guard 丢弃迟到
响应。actual production bundle 已经 strict fake Cloud authority 走完 suggestion→preview→explicit
confirm→target GET server reread；合并前 item 数不变，确认后才删除 source，公开 snapshot/Web Storage
不含学习正文、prompt、raw output、reservation 或 task。S4 fresh evidence 为 API 109 files / 387 tests、
Web 42 files / 191 tests、专项 actual bundle 1/1、strict typecheck/build、目标 ESLint/Prettier、instructions/
architecture 全绿；根侧另复验 focused API 9 files / 38 tests、Web 2 files / 17 tests 与 Playwright 1/1。

### S5 文档与完整门禁

同步 product/API/data/security/testing/operations/change-log/implementation-plan/project-status/release
checklist；运行 contracts/API/PGlite/Web/Playwright focused、workspace test/typecheck/build、instructions、
architecture、目标 lint/format 与 diff check。真实 DeepSeek smoke/费用与多连接部署需另行批准。

实现记录：15 份受影响权威文档已完成实现后全局复审，`README.md` 经核对无漂移而未机械修改。根侧
完整离线门禁通过：`pnpm typecheck`、`pnpm build`、`pnpm check:instructions`、
`pnpm check:architecture`，以及 `pnpm test` 的 114/114 Node 脚本与 443 个 Vitest 文件
（2,714 passed / 12 skipped）、`pnpm test:e2e` 109/109。目标文档 Prettier 与本阶段目标 ESLint/Prettier
通过；根级 `format:check` 仍由 70 个既有文件阻断，根级 `lint` 仍由 `.agents/skills/**` 的 143 条既有
错误阻断。真实 DeepSeek、Supabase/Vercel、多连接 production Postgres、双平台 Chrome 与发布动作不属于
离线证据。

## 7. 验收标准

- production 不再硬编码 `model_unavailable`，但配置、额度或 kill switch 无效时仍在 fetch 前失败关闭；
- Provider 只接收最小 server-owned同类型候选，返回值不能注入 owner/item/content/merge 决策；
- 每个可能计费的请求都有 durable-before-dispatch、不可变价格、usage ledger 与保守恢复；
- replay/busy/conflict 不产生第二次 Provider 调用或第二条 ledger；
- UI 只建议和预览，永不自动 merge；confirm 后 source 删除、target core/schedule 保留并从服务器重读；
- actual bundle 与公开证据不泄漏学习正文、prompt、raw output、quota 内部字段或 task ID；
- 离线完成后状态最多为 `implemented; target-platform validation pending`。

## 8. 实现前审查问题

1. 不能直接把 `LearningLibraryMaintenance.suggestions` 接到 DeepSeek；这会绕过 durable quota/dispatch；
2. 不能复用 PracticeGenerationTask 或 AnalysisRequest；它们的 owner resource、public lifecycle 和输出
   schema 不同，复用会形成浅模块和错误清理语义；
3. 不能让客户端提交 candidate IDs；候选集合必须在调用前和响应投影时两次由服务器约束；
4. 不能把相同 Idempotency-Key 的运行中请求透明等待或重发 Provider；公开 `generation_busy` 更诚实；
5. 精确 replay 与“零内容副本”不能同时成立；本方案选择诚实保存最多 24 小时的 bounded public response，
   并要求有界清理、账号级联删除、forced RLS 与安全文档披露；
6. quota exhausted 使用 429 而非 402，因为 V1 不提供平台额度购买；`generation_busy` 与
   `model_output_invalid` 分别校准为 409/502，并加入公共 error-status 回归。

若上述边界在 C2 复审成立，即可先推进独立的 A1 对比度修复，再按 S1→S5 开发。
