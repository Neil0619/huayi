# Phase 23 平台练习生成与额度结算方案

## 1. 问题与目标

Cloud V1 的句子创作和受约束对话已经具备 PracticeSession、PracticeAttempt、turn-first、generation
lease、显式 retry、fencing、历史和排期，但 production 组合仍把五类练习模型方法固定为
`model_unavailable`：

1. 句子题目 `prompt`；
2. 句子作答 `feedback`；
3. 对话情境、计划与开场 `dialogue-start`；
4. 每轮情境角色回复 `assistant-turn`；
5. 对话整体与逐项最终反馈 `final-feedback`。

直接把 DeepSeek adapter 填入这五个 seam 不安全。句子题目当前甚至在创建 DB session/claim 前调用模型；
其余操作虽然先保存用户状态并取得 lease，但过期 lease 可以透明重领。若旧 worker 已把请求发给 Provider，
新 worker 再次调用会产生重复费用，且现有练习完成事务没有把 UsageAllowance 的预留、结算和结果恢复纳入
同一权威链。

Phase 23 的目标是让五类练习生成在配置有效时真正使用平台 DeepSeek，同时满足：

- Provider dispatch 前必须存在持久 PlatformGeneration 与额度预留；
- 同一账号的分析、练习和后续语义模型共享 UTC 月 UsageAllowance 与单一活跃预留；
- Provider 输出先严格校验并耐久保存，再应用到 PracticeSession；
- dispatch 后 worker 丢失不得透明调用第二次；过期任务保守结算并等待用户显式 retry；
- 同 key 重放不重复调用，新 key 才构成用户显式新生成；
- 全部默认测试离线，不读取真实 secret、不调用 DeepSeek，也不虚构生产 origin。

本阶段不改变用户评分阶梯、每日队列选择、练习历史删除语义、公开注册策略或 BYOK 边界。

## 2. 领域状态与用户行为

### 2.1 PlatformGeneration 与 PracticeSession

PracticeSession 是学习过程权威；PlatformGeneration 是可计费生成权威。两者不能合并：

- session 保存题目、答案、对话、反馈和自评；
- generation task 保存一次调用的 kind、dispatch/结算状态、临时严格输出和额度关联；
- session/attempt 只持有当前 generation task ID，不持有 token usage、价格或 Provider 原始响应；
- generation `ready` 后即使 worker 在领域完成前崩溃，新显式 retry 也重放耐久输出，不再调用 Provider；
- generation `applied` 后清除临时输出，长期正文只保留在既有 PracticeSession authority。

### 2.2 公开 pending 状态

`PracticeSession.pendingGeneration` 扩为：

```text
sentence-prompt | dialogue-start | assistant-turn | final-feedback
```

句子题目与对话开场都先创建 `awaiting-feedback` session，再调用模型；尚未生成时 `prompt` 省略。Web
刷新后通过 DailyPracticeQueue 恢复同一 session，显示“题目尚未完成”，且只提供显式重试按钮。不得使用
`Generation pending.` 等占位正文伪装题目。

句子答案仍先持久化 PracticeAttempt；对话用户 turn 仍先持久化。Provider 失败不删除这些输入，也不自动
发起第二次请求。same-key replay 返回已保存的 pending session；用户点击 retry 生成新 key。

### 2.3 状态机

内部 `practice_generation_tasks.state`：

```text
claimed ──quota reserved──> reserved ──durable dispatch mark──> dispatched
   │                            │                                  │
   │ safe lease takeover        │ safe lease takeover              ├─strict output + settle──> ready
   │                            │                                  ├─known failure + settle─> failed
   └─quota failure──────────────> failed                            └─expired/unknown────────> abandoned

ready ──domain transaction applies output──> applied (temporary output cleared)
```

规则：

- `claimed|reserved` 还没有 Provider 副作用，lease 过期可在同一 task 上安全接管；
- `dispatched` 表示请求可能产生费用，过期后只允许 fenced recovery：以最坏预留保守结算、标记
  `abandoned`，本次调用不返回输出；
- `ready` 保存经过严格 schema 校验的输出和真实 billed calls；新 worker 可重放并完成领域事务；
- `failed|abandoned|applied` 为终态，旧 token 不能改变；新调用必须由用户显式动作和新幂等键创建新 task；
- quota/kill switch 在 dispatch 前失败，不得调用 Provider；领域 pending 状态保留以便稍后显式重试。

DeepSeek V4 Flash 分时价格不改变状态机：`claimed -> reserved` 一律按 peak 上限保守 reservation，尚不
固定实际价；`reserved -> dispatched` 使用该 transition 的同一个服务端 UTC `now` 选择
legacy/off-peak/peak，验证不可变数据库行并原子写入价格 UUID 与 dispatch 时间。Provider 与 settlement
复用 dispatch 快照，跨窗不改价；pre-dispatch lease takeover 可按最终真实 dispatch 时刻重新选择。
详见 `deepseek-v4-billing.md`。

## 3. 技术路线

### 3.1 深模块与接口

新增深模块 `PaidPracticeGenerator`。外部 interface 只有一个判别联合方法：

```ts
interface PaidPracticeGenerator {
  generate(command: PracticeGenerationCommand): Promise<PracticeGenerationOutput>;
}

type PracticeGenerationCommand =
  | SentencePromptCommand
  | SentenceFeedbackCommand
  | DialogueStartCommand
  | DialogueAssistantCommand
  | DialogueFinalFeedbackCommand;
```

每个 command 只包含 `generationId`、fencing token、owner、kind 和该 kind 必需的可信学习内容。调用方不
需要知道价格、预留、Provider HTTP、repair、usage、task state 或恢复顺序。

implementation 内部使用两个真实 seam：

1. `PracticeGenerationRepository`：Postgres adapter 与内存 fake，隐藏 task transition、fencing、ready
   output 和 quota settlement transaction；
2. `PracticeProvider`：DeepSeek HTTP adapter 与测试 fake，接收无 owner/内部 UUID 的有界 prompt，返回
   strict output 与 1–2 个 billed calls。

领域 repository 负责在原有 claim transaction 中创建/接管 task，并在完成 PracticeSession 时同事务把
task 置为 `applied`。PaidPracticeGenerator 不直接编辑 session/attempt/turn，避免形成第二学习权威。

### 3.2 调用顺序

每类生成统一执行：

1. Web mutation 通过 Cookie + Origin + CSRF + Idempotency-Key + revision；
2. Practice repository 在 owner-RLS transaction 中先保存 session/attempt/user turn，创建或接管 task，
   返回 `{generationId, leaseToken, session}`；
3. PaidPracticeGenerator 用 `generationId` 作为 `quota_reservations.request_id`，校验固定价格版本并预留最坏
   费用；同 request/amount 重放同一 active reservation；
4. repository fenced 写入 `dispatched_at` 后才允许 DeepSeek adapter 发 HTTP；
5. Provider 最多一次结构修复；所有实际调用分别记录 usage/cost；
6. strict output 与 `settle_quota_reservation(feature, calls, outcome)` 在一个 trusted transaction 中写入
   task `ready|failed|abandoned`；
7. 领域 repository 用 task ID/token 应用 ready output，推进 session，并把 task 置 `applied`、清除 output；
8. 若第 6 与第 7 之间崩溃，新显式 retry 接管 ready task并只执行第 7 步。

### 3.3 Provider adapter

复用当前平台 DeepSeek 固定 endpoint/model、`credentials: omit`、`redirect: error`、90 秒上限、JSON
Content-Type 和价格快照，不允许客户端选择 endpoint/model/effort。五类请求固定 `thinking high`、JSON
Output 与有界 token limit。

模型只接收：

- LearningItem 的 `content`；
- 当前题目、用户答案或当前对话 plan/turns；
- 最少的中文任务说明和输出 schema。

模型不接收 owner、session/attempt/item UUID、标签、排期、来源 URL、Cookie、额度、价格、幂等键或
Provider credential。多学习项使用本次请求内的 `item-1..item-3` 别名；final feedback 返回别名后由可信
代码重绑真实 item ID，且必须一一覆盖。

私有输出：

```ts
type PracticeGenerationOutput =
  | { kind: "sentence-prompt"; prompt: string }
  | { kind: "sentence-feedback"; feedback: string }
  | {
      kind: "dialogue-start";
      prompt: string;
      opener: string;
      plan: { roleZh: string; taskZh: string; endConditionZh: string };
    }
  | { kind: "dialogue-assistant"; assistantTurn: string }
  | {
      kind: "dialogue-final-feedback";
      summary: string;
      itemFeedbacks: Array<{ itemAlias: string; feedback: string }>;
    };
```

所有文本 trim 后 1–4,000 字符；unknown/extra 字段失败。第一次结构错误允许一次只修 JSON 结构的第二
调用；第二次仍错即 `model_output_invalid`，不得第三次。两次调用都进入同一 generation 的 billed calls。

## 4. 数据结构与迁移

Cloud 尚未发布且仓库没有增量 migration runner，本阶段继续修改 bootstrap
`0001-cloud-v1-foundation.sql`；既有开发数据库必须重建，不能把 0001 重放当升级。

### 4.1 `practice_generation_tasks`

```text
id uuid primary key                         # 同 quota request_id
owner_user_id uuid not null                 # forced-RLS owner
session_id uuid not null on delete cascade
attempt_id uuid null on delete cascade
kind text                                   # 五类固定枚举
state text                                  # claimed/reserved/dispatched/ready/applied/failed/abandoned
request_hash text not null
lease_token text not null
lease_expires_at timestamptz not null
reservation_id uuid null unique
price_version_id uuid null
reserved_micro_usd bigint not null
dispatched_at timestamptz null
output jsonb null                           # 仅 ready；applied 后清除
stable_error_code text null                 # quota_exhausted/model_unavailable/model_output_invalid
created_at / updated_at timestamptz
```

约束：

- `attempt_id` 只用于 `sentence-feedback`；其他 kind 必须为空；
- `ready` 必须有 output/reservation/dispatched，`applied` 必须没有 output；
- `failed|abandoned` 必须有 stable error；
- `reserved|dispatched|ready` 必须有 reservation/price version；
- 同 session 最多一个 `claimed|reserved|dispatched|ready` task；
- owner、session、attempt 采用复合 owner FK；表启用并强制 RLS；业务角色只读当前 owner，所有状态写经
  trusted functions/adapter。

### 4.2 领域行引用

- `practice_sessions.current_generation_id uuid null`；
- `practice_attempts.current_generation_id uuid null`；
- `practice_sessions.prompt` 改为 nullable，只有 `sentence-prompt|dialogue-start` pending 可为空；
- session 的 generation lease 字段继续负责领域 claim fencing，但必须与 task lease/token 一致；
- task applied/failed 后领域引用清空，历史不返回 task、reservation、usage 或错误内部详情。

### 4.3 UsageLedger

`usage_ledger.feature` 收紧为：

```text
analysis
practice.sentence-prompt
practice.sentence-feedback
practice.dialogue-start
practice.dialogue-assistant
practice.dialogue-final-feedback
```

每个 generation 最多两个 `(request_id, call_ordinal)` ledger rows；outcome 是 succeeded/failed。实际严格输出
失败仍按 failed 记真实 billed calls。dispatch 后未知结果以 reserved amount 写一条 token-null failed ledger，
防止重复消费绕过额度；UI 只看到统一额度变化，不看到内部 recovery 细节。

## 5. 错误与恢复语义

| 场景                          | Provider 调用 | Task 结果                              | 用户行为                              |
| ----------------------------- | ------------- | -------------------------------------- | ------------------------------------- |
| 无 grant/额度不足/kill switch | 0             | failed/quota 或 unavailable，无 ledger | pending 保留；稍后显式 retry          |
| active duplicate              | 0             | 原 task 不变                           | 返回当前 pending，不自动调用          |
| claimed/reserved worker 丢失  | 0             | 同 task 安全接管                       | 本次显式 retry 可继续                 |
| dispatched worker 丢失        | 不确定        | abandoned + 保守结算                   | 当前 pending；必须再点一次创建新 task |
| Provider 非 200/timeout       | 1             | failed + 保守或实际结算                | 输入保留；显式 retry                  |
| 首次 JSON 错、repair 成功     | 2             | ready→applied，两次记账                | 正常完成                              |
| 两次 JSON 都错                | 2             | failed，两次记账                       | 输入保留；显式 retry                  |
| ready 后领域完成失败          | 0 次新增      | ready 持久化                           | 显式 retry 重放 output 并应用         |
| 旧 worker 迟到                | 0 次可提交    | fencing 拒绝                           | 不覆盖新 task/session                 |

错误响应继续只使用稳定 `quota_exhausted | model_unavailable | model_output_invalid |
generation_busy`；不返回 Provider body、prompt、价格、token 或 task state。反馈/turn 已保存后的失败返回严格
pending PracticeSession，避免把已提交输入误报为丢失。

## 6. Web 变化

- 句子 session 新增 `sentence-prompt` pending 卡，明确“学习项已保存，系统不会自动再次调用模型”；
- “重试生成题目”复用现有 start-sentence route、同 item、新幂等键；
- dialogue-start/assistant/final 与 sentence-feedback 继续使用现有显式 retry；
- quota exhausted 显示统一额度说明并链接 `/settings/account`，但不禁用学习库、历史、手动录入或 BYOK；
- 页面不显示内部 task/reservation/usage、Provider 原始错误或精确费用；
- 旧请求迟到仍受 React generation guard 抑制，按钮 busy 防止并发用户动作。

## 7. TDD 与测试矩阵

### 7.1 Fresh RED

1. learning-domain：strict PracticeSession 目前拒绝 `sentence-prompt` 与无 prompt pending sentence；
2. contracts/Web：pending sentence 没有恢复/显式 retry 语义；
3. PracticeModule：`startSentence` 在 repository claim 前调用 model；
4. Postgres：没有 generation task/current reference，过期 dispatched lease 可直接重领；
5. production：五个 model method 固定 `model_unavailable`；
6. quota：settlement feature 固定为 `analysis`，无法证明练习用量进入统一账本。

### 7.2 Unit tests

- PracticeSession schema：pending sentence 合法；active/completed sentence 仍必须有 prompt；dialogue 不接受
  sentence pending；failed/applied 状态组合失败关闭；
- PaidPracticeGenerator interface：reserve-before-dispatch、ready replay、safe pre-dispatch takeover、
  post-dispatch abandon、quota/kill switch zero-call、repair 至多一次、actual/conservative settlement、old-token
  fencing；
- DeepSeek adapter：固定 URL/model/thinking/JSON、无 UUID/owner、五类 prompt 和 strict output、item alias
  重绑、usage/cached usage/price、timeout/content-type/non-200/invalid JSON；
- Practice/Dialogue module：所有五类都先 claim；pending response 不自动 retry；same key zero-call；new key
  显式 retry；ready output 应用；错误保留 answer/turn；
- Web：pending sentence 恢复、按钮/焦点/live region、quota 文案、迟到 suppression、窄屏/reduced-motion。

### 7.3 PGlite integration

- task 与 session/attempt/user turn 同 transaction 创建；跨 owner 不可见；删除 history 级联 task；
- `claimed|reserved` 过期可同 task 接管，`dispatched` 过期只能 abandoned；旧 token completion/release 失败；
- quota reserve 与 task attach 可重放；task ready + ledger settlement 原子；ready output + domain applied 原子
  清除；
- 同账号分析与练习不能同时持有 active reservation；额度/kill switch 在 dispatch 前阻断；
- billed calls 1–2 条、feature/ordinal/price/outcome 正确；超预留、重复 settlement、非法 feature 回滚；
- same key replay/new key retry、start pending、feedback/turn/final 输入保留和多租户 RLS。

### 7.4 Production composition 与浏览器验收

- production app 使用现有环境 DeepSeek key、price version/prices 组合 PaidPracticeGenerator；health 不触网；
- fake fetch 完整覆盖五类操作及 quota summary 变化；默认测试没有真实网络；
- Playwright 扩展 Phase 22 authority，覆盖 Web 句子创作从 pending→反馈→自评以及 3 轮对话→逐项反馈，
  同时断言额度变化、无自动重试和页面不含内部 task 字段；
- 真实 DeepSeek、部署 Cookie/DB、并发进程和 Chrome 仍需独立批准。

## 8. 验收标准

- 配置有效时 production 五类练习生成不再固定 fail-closed；
- 每次 Provider 调用前都有 task + quota reservation + durable dispatch mark；
- 所有模型调用进入统一 UsageLedger，80/100% 额度语义不变；
- Provider 输出在应用 PracticeSession 前严格校验并持久化；ready 崩溃恢复零新增调用；
- dispatch 后过期任务不会透明重领，旧 worker 不能覆盖或二次结算；
- 题目/答案/user turn/最终反馈刷新可恢复，同 key 不重复，新 key 才显式 retry；
- Web 完成两种练习并可自评，SourceExample 仍只在完成后出现；
- 无 secret/原始响应/owner/task/quota authority 字段进入 Web、Content Script 或日志；
- migration/PGlite、unit/integration、Web/Store、typecheck/build、lint/format/architecture/diff 与离线 E2E
  全绿；真实网络相关检查明确未运行。

## 9. 方案自审

### 9.1 被否决的路线

- **只填入 DeepSeek adapter**：现有 lease 不能证明 Provider 是否已 dispatch，会重复付费；否决。
- **复用 `analysis_requests`**：分析请求以 AnalysisEvent/AnalysisRecord 为终态，练习以 session/attempt/turn
  为权威，强行复用会把两个领域状态机耦合；否决。
- **把 output 只留在 worker 内存**：settlement 后、domain apply 前崩溃无法恢复，只能重复调用；否决。
- **把 Provider 调用包在数据库 transaction 内**：长事务持锁、连接耗尽且不能解决进程崩溃；否决。
- **dispatched lease 过期后自动 takeover**：旧 worker 仍可能收费和迟到；违反 ADR-0018；否决。
- **把 task/usage 暴露给 Web 轮询**：形成第二个面向用户的任务模型并泄露运营细节；否决。

### 9.2 风险与裁决

- 保守结算可能在极少数未知 Provider 结果下按最大预留扣减；它比允许重复调用更可控，运营可从无正文
  ledger/audit 识别，但 V1 不提供自动退款或钱包语义。
- ready output 短暂保存服务器可读正文；ADR-0011 已接受服务器可读 Cloud，且 applied 后立即清除，账号
  删除和 session history 删除均级联清理。
- bootstrap migration 仍未发布；若实施中发现已有受支持 Cloud 数据库，必须停止并设计正式增量
  migration，不得重放 0001。
- 单账号单活跃 reservation 会让分析与练习互斥，这是 ADR-0013 的费用保护，不通过增加并发绕过。

### 9.3 结论

需求与技术路线一致。RED→领域/契约→task authority→DeepSeek adapter→production composition 已完成
离线实现；PGlite/fake Provider 已证明 dispatch mark、ready replay、settlement 和五类 domain apply 的
fencing。实际 Web production bundle 的两类离线浏览器旅程也已覆盖 pending 显式重试、造句反馈/自评、
三轮对话/逐项反馈/原子自评与 quota 重读。真实 DeepSeek、部署数据库和多进程竞争仍未验证，因此阶段
状态仍是 `implemented; validation pending`，不能据此开放邀请或宣称真实计费已投产。

## 10. 实现与验证记录（2026-08-13）

- `PracticeModule` 与 `DialoguePracticeModule` 只依赖统一 `generate(...)` 深接口；不存在可绕过 task/quota
  直接调用模型的 production seam。
- sentence prompt/feedback、dialogue start/assistant/final 都在保存 session/attempt/user turn 的同一 tenant
  transaction 中创建或接管 task；ready output 与领域输入逐字段/alias 重绑后才置 applied。
- Postgres 回归覆盖 quota 失败清理、reservation 已 released 后的迟到失败保守结算、dispatched 过期
  abandoned、ready crash replay、旧 worker fencing 与五类 feature ledger；Provider 回归覆盖固定请求、
  无 owner/UUID 输入、一回 repair、reasoning 丢弃及两次 billed call。
- production 使用既有 DeepSeek key、不可变 price version、共享单活跃 reservation 和按 operation 上限计算的
  reservation；health/composition 测试不触网。默认完整 API/Web/domain 测试仍全部离线。
- actual Web bundle 已用本地 route-fulfilled authority 跑通造句和对话两条练习 journey，并证明 pending
  页面不自动请求、完成后 quota 聚合变化且 snapshot 不含答案/task/reservation；这不替代真实服务。
- Fresh 离线门禁为 366 个 Vitest 文件（2,441 passed / 12 skipped）、72/72 Playwright、全 workspace
  typecheck/build，以及受影响 ESLint/Prettier、instructions、architecture 和 diff check；Web E2E source
  由独立 strict tsconfig 覆盖。
- 未运行真实 DeepSeek、真实费用、部署 Postgres/Cookie 或并发进程；这些仍是发布前独立审批和证据项。
