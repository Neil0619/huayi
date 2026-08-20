# Phase 25 Web 分析到学习库浏览器验收方案

日期：2026-08-13
校准日期：2026-08-14
状态：Phase 27 契约重做、离线重新验收与实现后复审已完成；
`implemented; target-platform validation pending`

> Phase 27 已把 Web 分析固定为 `phrase | sentence | passage` 的 WebDeepAnalysis：表单不再接受
> translate/explain action 或 word，结果必须使用 V2 教学结构，只产生 Expression/SentencePattern 候选。
> Phase 25 数字只保留为历史；当前 actual browser journey 已在 Phase 27 strict contract 上重新通过。

## 1. 用户结果与范围

当前 actual Web production bundle 证明一个已登录学习者可以把主动粘贴的英文转成待整理记录，
确认其中一个表达，并从服务器权威学习库重新读取结果：

1. 从 `/analysis` 提交严格 `manual` 来源的英文；
2. 浏览器消费 `analysis.started`、临时 `analysis.preview` 与唯一 `analysis.completed`；
3. 完成页只携带服务器返回的 AnalysisRecord id 跳到 `/app`，不在浏览器创建第二份记录；
4. Inbox 从 CloudAuthority 重读 pendingReview 记录，用户编辑并确认一个表达候选；
5. `/library` 从同一 authority 重读新 LearningItem 和可信来源快照。

本阶段只做离线浏览器组合验收，不接真实 DeepSeek、Supabase、Vercel 或 Postgres，不声称真实费用、
代理缓冲、断网恢复或多进程并发已验证。取消、断流恢复、幂等冲突和 fencing 继续由既有单元/集成测试
负责；本 journey 验证主成功路径的浏览器组合。

## 2. 技术路线

### 2.1 浏览器拓扑

```text
actual Web dist
  /analysis form
      │ Cookie + CSRF + Idempotency-Key
      ▼
local CloudAuthority POST /v1/analyses:stream
      │ strict SSE: started → preview → completed
      ▼
Web completed projection ──link──▶ /app Inbox
      │ GET server authority
      │ candidate confirm + revision/write proof
      ▼
CloudAuthority LearningItem ──GET──▶ /library detail
```

Playwright 只 route-fulfill 保留 HTTPS origin；不能预种 AnalysisRecord、直接调用 React 组件、向 Web
Storage 写结果、跳过 CSRF/Origin/Idempotency-Key，或在测试中调用私有页面状态。

### 2.2 深模块边界

- 新增独立 browser-only streaming authority，负责严格解析 start request、同 key replay/conflict、生成
  有界 SSE envelope 和一次 completed AnalysisRecord；
- 主 CloudAuthority 只组合路由、认证 proof 与共享 analysis/list/confirm 权威；
- public snapshot 继续只暴露聚合计数和脱敏 request facts，不增加 sourceText、preview、result、候选、
  token、Cookie、幂等 key 或 raw error；
- production contracts、API、Postgres、migration 和运行时 composition 不变。

## 3. 数据与状态

### 3.1 输入与权威记录

Start request 必须通过 `startAnalysisRequestSchema`：

- `source.type = manual`；
- `sourceText`、可选 title 和 `selectionKind=phrase|sentence|passage` 来自真实表单；
- 不接受 action 或 `selectionKind=word`；教学动作固定为翻译与讲解合一；
- 不接受 userId、provider、model、quota、endpoint 或 owner 字段。

更新后的离线 authority 只接受本 journey 计划的 `manual + passage` strict request，并产生一个 V2
contract-valid AnalysisRecord：输入 source/sourceText/selectionKind 原样进入权威记录；模型 metadata、
result、candidate 和 quota 使用固定公开 fixture 语义，不含凭据或内部 lease。候选 confirmation 仍使用
既有 revision、path-bound idempotency 与 server reread。

### 3.2 状态机

```text
idle → running(started) → running(preview) → completed
                                            │
                                            ▼
                                   pendingReview in Inbox
                                            │ confirm
                                            ▼
                                    reviewed + LearningItem
```

preview 只存在页面组件内存；completed 才写 authority。浏览器离开 `/analysis` 后，Inbox 必须通过 GET
重新读取记录。确认成功后，学习库必须通过 GET list/detail 重读；不得从 confirmation 表单本地拼出详情。

### 3.3 幂等与失败关闭

- start 必须具备 Web session、正确 Origin、CSRF 与有效 Idempotency-Key；缺一即拒绝；
- same key/same strict body 重放同一 terminal stream 且不创建第二条 AnalysisRecord；
- same key/different body 返回 `idempotency_conflict`；
- 非 strict body、非 manual source、Cookie 外泄到 snapshot、额外 SSE 字段或非法 terminal 均失败关闭。

## 4. TDD 与测试设计

Phase 25 的 fresh RED 先证明 `/v1/analyses:stream` 缺少 browser authority；Phase 27 再用当前 strict
request/result/candidate schemas 重新执行同一真实 bundle 路径，不能直接沿用旧通过数字。

journey 断言：

1. actual `/analysis` 表单提交的 request body 是 strict manual shape，request fact 为 Web write-valid；
2. 页面显示 started、临时 preview 和 completed，preview 明示不保存；
3. 点击“前往待整理”后由 GET 显示刚生成的 source 与 candidate；
4. 编辑表达和标签后确认，Inbox 清空；
5. `/library` list/detail 重读新 item，详情获得焦点并显示来源；
6. 390px viewport、reduced-motion、label、live status、焦点交接与无横向溢出通过；
7. snapshot 只包含当前 `CloudBrowserAuthoritySnapshot` 的聚合计数与 request facts：analysis/capture/
   extension-query/extension-session/item/word/word-copy/word-import/wordbook-job/practice-provider，以及始终为
   0 的 legacy `importCount`；序列化后不含 sourceText、preview、候选正文、Cookie、CSRF 或幂等 key。

focused RED/GREEN 后运行 Web E2E strict typecheck、focused Playwright、完整 `pnpm test:e2e`；共享 test
support 变更还必须通过全仓 test/typecheck/build、受影响 ESLint/Prettier、instructions、architecture 与
`git diff --check`。

## 5. 验收标准

- 一条实际 Web 浏览器旅程完成 analysis→Inbox→confirm→library；
- 只有 strict completed event 进入 authority，preview 不成为收藏或公开 snapshot；
- start 与 confirm 都有真实浏览器 proof，所有后续页面从 server authority 重读；
- 无 Web Storage 业务权威、原始 HTML 注入、Supabase 直表访问或测试专用 production 分支；
- 新增 browser helper 小而深，所有手写 source 少于 400 行；
- 文档、实现记录、项目状态与 fresh gate 数字同步。

## 6. 方案自审

- **需求一致**：该 journey 覆盖 Phase 5 尚缺的“分析→整理”组合，不重复 Phase 24 的账号→手动录入；
- **权威清晰**：SSE completed、Inbox GET、confirm response、library GET 依次传递事实，没有客户端第二权威；
- **安全边界可证**：复用 production adapter 的 Cookie/CSRF/idempotency/revision，不放宽 API schema；
- **证据不过度**：本地 fixed model content 只证明浏览器/契约组合，不证明真实 Provider、quota 或部署代理；
- **模块可维护**：streaming fixture 与既有 onboarding/practice fixture 分离，主 authority 不承担模型细节；
- **结论**：方案合理且当前实现不需要绕过 strict SSE decoder、预种分析记录或暴露正文到 snapshot。
  Phase 27 重做保持了原深模块边界，并删除了 action/word 与 Store result import 的旧含义；未发现需要
  追加业务代码的偏差。

## 7. 实现记录

> 以下是 Phase 25 旧契约的历史实现记录，仅用于说明原始 TDD；当前结论以之后的 Phase 27 证据为准。

- fresh RED：actual `/analysis` 已发出 production adapter 请求，但 browser authority 对
  `/v1/analyses:stream` 返回 strict `not_found`，journey 在期待 `analysis.started` 处失败；学习库组件
  RED 同时证明详情没有呈现已有 SourceExample；
- 新增独立 streaming authority，严格校验 `manual + passage` body、Cookie/Origin/CSRF/Idempotency-Key，
  输出 started→preview→completed strict SSE；same-key replay 不新建记录，different-body 返回 409；
- actual Web journey 从空 authority 提交分析，经 Inbox 编辑确认后由学习库 list/detail 重读；390px、
  reduced-motion、详情焦点、无横向溢出与 Web Storage 为空通过；
- 学习库详情新增语义化“来源示例”只读区块，使用现有品牌 token、文本节点与自然换行，不引入本地状态；
- focused Web 组件 154/154、Web strict typecheck 与 Playwright journey 1/1 已通过；最终完整复验为
  366 个 Vitest 文件（2,441 passed / 12 skipped）、74/74 Playwright，以及全 workspace typecheck/build；
  其余质量门禁见 `project-status.md`。

### Phase 27 当前证据

- actual `/analysis` request 为无 action/word 的 strict manual passage；browser streaming authority 使用
  当前 `startAnalysisRequestSchema`、`analysisEventSchema` 与 `analysisRecordSchema`，只在 completed 时
  写入 AnalysisRecord；
- journey 从空 authority 进入 ReviewInbox、编辑 Expression、确认后从 Learning Library list/detail 重读
  LearningItem 与 SourceExample；same-key replay 为 200，different-body 为 409；
- 页面覆盖 390px、reduced-motion、label/live status、详情焦点、无横向溢出与空 Web Storage；snapshot
  仍为无正文聚合，legacy `importCount=0`；
- 2026-08-14 fresh 全量复验为 411 个 Vitest 文件（2581 passed / 12 skipped）、workspace typecheck/build、
  93/93 Playwright、instructions/architecture 与相关 ESLint/Prettier；
- 未运行真实 DeepSeek、Supabase/Vercel/Postgres、代理缓冲或真实登录浏览器，因此状态保持
  `implemented; target-platform validation pending`。
