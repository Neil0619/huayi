# Phase 7 外部词典桥接方案

状态：2026-08-14 已完成需求与技术复审、7A/7B/7C 离线实现和 Phase 27 browser rebaseline。Cloud
Eudic export/import 与 Shanbay 人工确认已通过 actual Web/Store production bridge 联合 journey，完整
离线 Playwright 为 93/93；Eudic 稳定失败→Web 显式重试、Shanbay 两词精确部分成功，以及 active
cancel→当前租约迟到确认也已通过同一联合层。真实第三方/部署验证仍待。Cloud V1 尚未发布，本文涉及
的 `0001` 变化只属于 bootstrap，既有开发数据库必须重建，不能把 `0001` 重放当成增量升级。

## 1. 目标与范围

Huayi 继续以 `WordEntry` 作为账号云端单词权威，外部词典只接收或提供副本；每个插件安装的
LocalLexiconEntry 另有独立本机权威。本阶段实现的是 cloud job，并明确不得取代本机能力：

1. 用户显式创建一次 Eudic import、Eudic export 或 Shanbay export 任务；
2. 云端保存任务、待处理 item、租约、稳定错误和回执；Store Extension 只领取有界工作；
3. Eudic 凭据只由 Service Worker 从 DeviceVault 读取并直连固定 Eudic endpoint；
4. Shanbay 只在固定页面预填词头，最终“批量添加”必须由用户可信点击并由页面明确结果确认；
5. Web 展示任务状态、进度、错误、重试和二次确认取消；
6. 用户可下载 UTF-8、一行一词的 `WordListExport`。

本阶段不实现后台双向同步、定时拉取、远端删除、远端词条编辑、账号完整备份、任意第三方 endpoint、
自动点击 Shanbay 最终提交或把 Eudic 凭据发送给 Huayi API。本机 LocalEudicImport 与
LocalLexiconExport 继续独立存在，不因 cloud job 上线而迁移或删除。

## 2. 分阶段交付

### 7A：云任务权威

- strict 公共契约、任务列表/详情/创建/取消/重试、Extension-only lease/receipt；
- Postgres forced-RLS、签名游标、任务状态机、租约 fencing、幂等响应和 Eudic import 原子 upsert；
- Web `/words/wordbooks` 任务创建、状态、重试和取消；
- fake Extension adapter 证明 Web、API 和 Extension 观察同一任务权威。

### 7B：Store Extension 桥接

- cloud job 生产组合不再把本地外部词典队列冒充 Cloud API 权威；这不影响 LocalLexiconEntry 自己的
  本机 import/export 状态；
- Eudic import/export 使用现有固定 client，但输入来自云租约，结果回到云端回执；
- Shanbay 云租约经过独立加密 `ExternalWordbookLeaseVault` 持久化；Content Script 只获得本地批次别名、
  词头和本地 item 别名，不获得 Extension session token、云 lease token 或 Huayi API origin；
- Options 分区显示“本机生词导入/导出”和“Web 生词任务”，并继续显示本机 Eudic 凭据；两区不能共用
  模糊的“同步”按钮或状态。

### 7C：词表导出与联合验收

- `GET /v1/words:export` 在 owner transaction 中按 `(canonical_key,id)` 排序生成 UTF-8 纯文本；
- Web 下载按钮只使用固定 API origin、Cookie 和服务器文件名；
- API/Web/Store 跨端 fake journey 覆盖中断、重领、迟到回执、取消、部分成功、显式失败重试和 Shanbay
  人工确认；
- 真实 Eudic/Shanbay 保持独立批准项。

Phase 27 browser rebaseline 使用 actual Web `/words/wordbooks`、strict owner-scoped authority 和 production
Store adapters：Eudic export 从云端 WordEntry 快照领取并提交精确回执；Eudic import 页只写云端
WordEntry，不改变处理插件的 LocalLexiconEntry；Shanbay 云 lease 先进入独立加密 vault，页面只收到本机
别名和词头，明确用户确认后才提交 confirmed 回执。三条 journey 均由 Web 重读终态；fake 第三方不替代
真实 Eudic/Shanbay 验收。后续两条失败态 journey 进一步证明 Eudic `network-error` 进入 Web 稳定错误并
只在用户点击“重试失败项”后重新排队，以及 Shanbay 当前 lease 在 Web 二次确认取消后即使迟到回执被
接受，Web 重读仍保持 `cancelled`，不把已经发生的第三方副作用伪装成撤回。另一个两词 batch 以 production
handler 精确提交一项 confirmed、一项 `invalid-response`，Web 必须重读 `1/2 · 失败 1`。

## 3. 产品流程与不变量

### 3.1 创建任务

- Web Cookie 会话或已配对 Extension 可以创建任务；Web mutation 还要求固定 Origin 与 CSRF。
- `shanbay + import` 在 strict schema 层拒绝。
- export 创建时在同一 owner transaction 中快照当前全部 WordEntry。Eudic item 保存规范词头和当时最新
  非空 `sourceText`（若有）；Shanbay item只保存规范词头。notes、语境释义、标题和来源不发送第三方。
- import 创建时不伪造 item；`nextPage=0`、`totalCount=null`，只有成功提交远端页后才建立已处理 item。
- 同一个账号可以在旧任务终态后再次创建新任务；同 target/direction 的未终态任务只允许一个，重复创建
  返回既有任务而不是制造并行外部写入。

### 3.2 租约

- 只有有效 Extension session 可以领取；普通 Web Cookie 不能调用 lease/receipt。
- 每个 job 同时最多一个租约。export 每批最多 20 项、5 分钟；Eudic import 每次固定一个 100 项页、
  5 分钟。Shanbay 用户确认可能跨 Service Worker suspend，因此 7B 在本机加密保存云租约。
- Extension 生成至少 32 字节随机 `claimNonce`。服务器用独立 HMAC 上下文签名 job、kind、nonce 和
  expiry，数据库只保存 nonce hash 与 expiry；同 nonce 重放按已保存 expiry 重建同一 token，不把明文
  token写进数据库或幂等快照。
- 过期租约在新 nonce 领取时可重领；新 nonce hash 生效后，旧 worker 回执被 fencing。
- 如果尚未产生新租约，当前 token 即使刚过期仍可提交结果；这避免第三方已经成功而网络响应略迟时重复。

### 3.3 Eudic export

- Service Worker 对每个 item 调用现有固定 Eudic client，只发送 headword 与可选原句 `contextLine`。
- 每次 Eudic HTTP 请求都有固定 10 秒内部 deadline，并与调用者 `AbortSignal` 合并；即使 alarm/Cloud
  bridge 使用默认 signal，也不能无限等待。超时与调用者取消都终止 fetch/body 读取并映射为稳定
  `timeout`，不得自动重试或保存响应正文。
- `created` 与 `already-present` 都形成终态回执；稳定失败码形成 failed item，不保存原始响应。
- 其余 pending item 可继续处理；全部可处理 item结束且仍有 failed item时 job 为 `failed`。显式 retry
  只把 failed item重新排队，不重做 delivered item。

### 3.4 Eudic import

- lease 返回 `page`，Service Worker 从固定 Eudic endpoint 读取最多 100 条 strict 数据，再提交该页。
- API 固定 `sourceType=eudic`；Eudic `add_time` 是外部观察时间，不能由 Web/manual 接口提交。
- 每页在一个 owner transaction 内规范化词头、以 `(owner,canonical)` 收敛 WordEntry、保留既有
  headword/notes、按 Eudic 内容 hash 去重 ContextObservation、写 item/receipt、推进 cursor 和 revision。
- 少于 100 条时完成；第 50 页仍为满页时进入 `source-limit-reached`，明确表示结果可能不完整。
- 整页失败保留 cursor 并把 job 置为 `failed`；显式 retry 后仍从同一页开始。
- import 被取消后不再应用迟到页面正文，只记录 `discarded-after-cancel` 聚合结果；取消不能在用户不知情时
  继续创建 WordEntry。

### 3.5 Shanbay export

- 云 item 只含 headword。Service Worker 将云 token/item ID 映射为本机随机别名后再发送给固定 Shanbay
  Content Script。
- Content Script 只在输入框为空或已等于当前批次时预填，不覆盖用户内容；只接受真实用户点击。
- 只有页面出现有界、明确的成功或部分失败反馈才提交回执。失败词重新排队；无法确定结果时不确认。
- 取消后，已由用户确认的当前租约仍可记录迟到回执；未发送 item 标为 cancelled，job 始终保持 cancelled。

### 3.6 WordListExport

- 内容只包含规范 headword，每行一词、LF 换行、UTF-8、末尾有且只有一个换行；空词库返回空文件。
- 不包含 ID、notes、语境、释义、来源、时间、任务、回执、账号字段、凭据或 session。
- 这是不可恢复的互操作词表，不得在 UI 中称为完整备份。

## 4. 状态机

任务状态：`pending | active | completed | failed | cancelled | source-limit-reached`。

```text
create ──> pending ──lease──> active ──all delivered/import exhausted──> completed
                    │   │
                    │   ├──stable failure/no pending──> failed ──retry──> pending
                    │   └──Eudic page 50 still full──> source-limit-reached
                    └──cancel────────────────────────> cancelled

active/failed ──cancel──> cancelled
```

export item 状态：`pending | in-flight | delivered | failed | cancelled`。cancel 把 pending/failed 变为
cancelled，保留当前 in-flight item 以接收已发生第三方副作用的迟到回执。import page 不预建 pending item；
成功页按唯一 WordEntry 写 delivered item，取消后的迟到页不写 WordEntry。

## 5. 数据结构

### `external_wordbook_jobs`

| 字段                                   | 语义                                                       |
| -------------------------------------- | ---------------------------------------------------------- |
| `id`, `owner_user_id`                  | 任务 identity 与 RLS owner                                 |
| `target`, `direction`                  | eudic/shanbay、import/export；数据库拒绝 Shanbay import    |
| `state`                                | 上述严格状态                                               |
| `next_page`                            | Eudic import 的 0–51 cursor；export 必须为 null            |
| `last_error_code`                      | 可空稳定白名单错误，不保存原始第三方正文                   |
| `lease_nonce_hash`, `lease_expires_at` | 当前 job 唯一租约；token 是 HMAC 签名 envelope，明文不落库 |
| `revision`, timestamps                 | 所有公开状态变化递增 revision                              |

对 `(owner_user_id,target,direction)` 建未终态 partial unique index。公开 `processedCount/failedCount/totalCount`
由 item 聚合，不把客户端计数当权威。

### `external_wordbook_items`

| 字段                                             | 语义                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------- |
| `id`, `owner_user_id`, `job_id`, `word_entry_id` | owner 一致的任务 item；import 成功后才建立                                      |
| `payload_snapshot`                               | server-created strict `{headword,contextLine?}`；不含 notes/meaning/title/owner |
| `state`, `attempt_count`                         | export item 状态与领取次数                                                      |
| `stable_error_code`                              | 可空白名单错误                                                                  |
| `receipt`                                        | strict target/outcome/recordedAt；不含远端 ID、原始响应或 credential            |
| timestamps                                       | 任务历史时间                                                                    |

保留 `(job_id,word_entry_id)` 唯一约束。WordEntry 删除继续在应用层因任何 item 引用而拒绝。

## 6. HTTP 契约

| Method/path                           | 认证                  | 行为                                                    |
| ------------------------------------- | --------------------- | ------------------------------------------------------- |
| `GET /v1/wordbook-jobs`               | Web 或 Extension      | server filters + 签名 `(createdAt,id)` 游标             |
| `GET /v1/wordbook-jobs/:id`           | Web 或 Extension      | owner-scoped 聚合详情，不返回 payload/lease/receipt正文 |
| `POST /v1/wordbook-jobs`              | Web+CSRF 或 Extension | strict create；export 原子快照                          |
| `POST /v1/wordbook-jobs/:id/lease`    | 仅 Extension          | nonce 幂等领取 export batch 或 Eudic page               |
| `POST /v1/wordbook-jobs/:id/receipts` | 仅 Extension          | token-fenced export receipt 或 Eudic page               |
| `POST /v1/wordbook-jobs/:id/retry`    | Web+CSRF 或 Extension | revision/idempotency 后恢复 failed job                  |
| `POST /v1/wordbook-jobs/:id/cancel`   | Web+CSRF 或 Extension | revision/idempotency 后停止新租约                       |
| `GET /v1/words:export`                | Web Cookie            | `text/plain; charset=utf-8` WordListExport              |

所有 mutation request 都 strict。create/retry/cancel/receipt 使用 `Idempotency-Key`；retry/cancel 还要求
quoted `If-Match` 与 body `expectedRevision` 相同。path job ID 进入 request hash。Extension adapter只接受
固定 API origin/route，不接受 URL、Header 或 token 来自 Content Script/Options。

lease 响应是 strict union：

- export：`{kind:'export',jobId,leaseToken,expiresAt,entries:[{itemId,headword,contextLine?}]}`；
- import：`{kind:'eudic-import',jobId,leaseToken,expiresAt,page,pageSize:100}`。

receipt 请求同样按 `kind` 区分。export 要求回执 item 集合严格等于该租约批次；import 要求 page 与租约
cursor 相同且 entries 最多 100。未知 item、重复 item、跨 job item、部分缺失回执或陈旧 token 全部原子失败。

## 7. 深模块与技术路线

`ExternalWordbookJobs` 是 API use-case 深模块，只公开七个动作：`list/get/create/lease/submit/retry/cancel`。
Hono adapter 只做 strict HTTP 解析、认证映射与安全响应；Postgres adapter 隐藏 RLS transaction、锁顺序、
唯一约束、签名 cursor、幂等、租约 hash、状态机、WordEntry upsert 和计数聚合。

Store 侧 `CloudExternalWordbookBridge` 只公开 `status/start/processOne/cancel/retry` 给可信 Options handler。
它内部组合：

- `CloudWordbookHttpAdapter`：固定 Huayi API origin、Extension session、strict contract；
- 现有 `EudicWordbookClient`：固定 Eudic endpoints 与 DeviceVault credential；
- `ExternalWordbookLeaseVault`：仅 Shanbay 跨 suspend 映射，DeviceVault DEK、独立 key/AAD；
- 固定 Shanbay page adapter：只处理本机别名批次和明确页面结果。

`BrowserWordbookExportEngine` 不能再作为 cloud job 权威，也不能把本地 outbox 上传成云任务；但其
LocalLexiconExport 行为仍是正式本机能力。实现时应把本机与 cloud bridge 组合为两个明确深模块，而不是
删除前者或复用 cloud token/payload 形状。

锁顺序固定为 job row → leased item rows → WordEntry canonical rows → ContextObservation/item insert → job
revision/idempotency finalize。任何第三方 HTTP 都在数据库 transaction 外执行。

## 8. 安全与隐私验收

- API/schema/日志拒绝 `authorization/apiKey/baseUrl/headers/cookie/sessionToken/rawResponse/url`；
- Eudic credential 只在 DeviceVault→Service Worker→固定 Eudic origin 路径出现；
- Huayi Extension session 和云 lease token 不进入 Content Script、Options DOM、Popup、Web 或日志；
- Web/Options 只显示 target/direction/state/count/revision/time/stable error，不显示 item payload/receipt正文；
- server filters/RLS/owner path 均有跨账号 404/空列表回归；
- cancel、retry、expired reclaim、late receipt 与新 lease fencing 有数据库级并发回归；
- 所有真实第三方调用默认关闭，测试只使用 fake fetch/page。

## 9. 单元、集成与跨端测试

### contracts/domain

- strict create/list/detail/lease/receipt/retry/cancel 与路由；Shanbay import、未知字段、非法状态组合拒绝；
- lease/receipt union、max 20/100、重复/缺失 item、稳定错误白名单；
- WordListExport golden fixture 与无秘密字段断言。

### API/Postgres

- forced RLS、跨 owner、签名 cursor 和 literal filters；
- export snapshot、零词完成、并发 create 收敛、revision 与 idempotency replay/conflict；
- claim nonce replay、活跃 lease suppression、过期重领、旧 token fencing、取消后 export 迟到回执；
- Eudic 每页原子 upsert、既有 notes 保留、context hash 去重、响应丢失重放、page cursor、51 页上限；
- 部分失败→failed→retry，只重排失败 item；cancel 后 import 迟到页不写 WordEntry；
- WordListExport 排序、空文件、特殊 Unicode、LF/final newline 和快照一致性。

### Web

- loading/empty/error/retry、target/direction筛选、分页、详情；
- 创建、失败重试、二次确认取消、revision conflict保留状态、mutation 成功后 server reread；
- 迟到 list/detail/action generation guard、焦点/live region、窄屏/reduced-motion；
- 下载只使用固定 origin/Cookie，文件名和 MIME strict，不称为完整备份。

### Store

- 未配置 API、未配对、session expired、未同意接收方、credential missing 全部 fail closed；
- Eudic 固定 endpoint、10 秒内部 deadline、调用者取消、分页/限流/无效响应、receipt 丢失重放；
- Shanbay exact sender、空输入保护、可信点击、明确成功/部分失败、本机别名和跨 suspend lease vault；
- Content/Options/Popup/日志不含云 token、session、credential、任意 URL 或 payload正文；
- API/Web/Store 共享 fixture 和 fake journey 证明同一 CloudAuthority。
- signed-out 与 signed-in 都覆盖 LocalEudicImport/LocalLexiconExport；换号不改变本机词库/任务。
- cloud job 与本机流程可同时存在，状态、按钮、payload、幂等键和失败互不改变；CloudWordCopyMode
  不触发历史本机词条或欧路词条上传。

## 10. 阶段验收标准

7A 完成需要 contracts/API/Web focused tests、PGlite migration/RLS/事务回归、三 workspace typecheck/build、
targeted lint/format、architecture/instructions/diff 全绿；7B 还需 Store full test/typecheck/build 与 Manifest/
bundle security regression；7C 的 WordListExport golden 和 API→Store→Shanbay/Eudic、Web→API 联合离线
journey 已在 Phase 27 rebaseline 补齐。最后运行全仓 `pnpm test/typecheck/build/test:e2e`。

真实 Eudic、真实 Shanbay、生产 API origin、真实登录和 Chrome 安装仍需各自明确批准；离线 fake 全绿不能
替代这些验收，也不能据此宣称 Phase 7 系统集成完成。

## 11. 复审结论

复审确认原设计有两处不足并已修正：原 lease response 只有 export entries，不能表达 Eudic page；原表把
`word_entry_id` 设为 import 前置条件，不能表达尚未进入 CloudAuthority 的远端词。新设计让 import 以 job
cursor 领取，成功页才建立 WordEntry/item；export 则在创建时快照 item。另将 Shanbay 云 token 隔离在
Service Worker/加密 vault，避免沿用本地实现把云 capability 发送到 Content Script。

Phase 27 再修正第三处产品边界：Cloud job 不替代 LocalLexiconEntry 的本机导入/导出，Options 必须同时
保留两类入口。其余 job 状态机、数据结构、认证、幂等和租约路线保持有效。
