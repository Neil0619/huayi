# Phase 18 账号数据权利方案

状态：Phase 18 主体、Phase 27 strict owner snapshot、删除后的 SPA signed-out 转换与 actual Web 数据
权利 journey 均已完成离线实现和复审；状态为 `implemented; target-platform validation pending`。真实
Supabase Storage、Vercel、登录和部署验证仍待完成。
本文是 Phase 9“数据权利、运营与完整发布”中 AccountDataExport 与账号删除任务的权威切片文档。

## 1. 目标与范围

本切片让已登录用户在 Web `/settings/data`：

1. 请求一个版本化、完整、可迁移的 AccountDataExport；
2. 查看导出生成状态，并在最近重新认证后取得 15 分钟私有签名下载；
3. 经解释、输入确认文本与最后一次二次确认后请求永久删除账号；
4. 在删除请求成功响应前立即撤销全部 Web/Extension session；
5. 由可恢复后台任务依次删除私有导出文件、主库账号正文和 Supabase Auth 身份。

账号被管理员停用不能阻止导出、删除或退出。停用用户重新通过 Supabase 密码/Google 身份验证后，只
取得 `DataRightsSession`；它不允许分析、学习库、练习、设备或其他账号操作。`deleting` 用户不再创建
任何会话。Phase 18 同时补齐普通 Google 登录；AccountSignInMethods Phase A 再把它收紧为只给已存在
profile 且已登记 `google` method 的账号建立 full 或 data-rights session，绝不绕过邀请创建新账号或
自动授权另一个 identity。

本阶段不导出凭据、会话、token/hash、幂等记录、内部审计、额度内部记录、隐藏 reasoning、内部 lease、
第三方原始回执或数据库实现字段；不提供“恢复账号”、软删除、部分账号删除、删除后下载、管理员正文
查看或客户端直接访问 Supabase。

WordListExport 仍是“一行一词”的互操作文件，不是 AccountDataExport，也不能用于恢复全部账号数据。

## 2. 用户需求与交互

### 2.1 完整数据导出

- 页面明确列出导出包含：已验证登录邮箱、账号学习偏好、分析及候选、学习项/标签/来源/排期、
  StudyCapture、生词/语境、正式练习、账号级插件查询/自动采集/云端生词复制偏好，以及导出快照时
  仍在原一小时保留期内的平台 ExtensionQueryGeneration 公共内容。导出是用户主动创建、最多保留
  24 小时的独立私有副本，因此该副本可能晚于原 generation 删除；它不延长原 generation 期限，也不
  会建立插件查询历史。
- 页面明确列出排除项：密码与第三方凭据、Web/Extension session、内部安全/运营记录和隐藏模型内容。
- 页面明确说明每个插件安装的 LocalLexiconEntry、本机 BYOK/词典凭据和未提交的加密 outbox 不属于
  Huayi 账号云端权威，不出现在 AccountDataExport；用户应在对应设备单独导出或清理。
- 同一账号最多一个 `pending | running | ready` 导出；重复创建返回同一公开任务，不并发复制正文。
- `failed` 可由用户显式重试；旧 `ready` 过期后才能新建。
- `ready` 只表示私有对象已经写入并通过服务端 SHA-256/字节数记录，不表示用户已下载。
- 下载动作要求最近 15 分钟内重新认证，签名 URL 有效 15 分钟；页面不把 URL 写入 storage、日志、
  query、hash 或分析数据。
- 私有对象的 `expiresAt` 固定为 `ready+24h`。每个签名 URL 最长 15 分钟且不得越过对象到期；剩余不足
  1 分钟时拒绝再签。到期任务先原子转为 `expired`、立即停止签发，再幂等删除对象；删除失败保留内部
  object key/error 供 worker 重试和告警，不把它重新公开为 ready。不依赖对象存储提供“下载完成”回调，
  也不伪称 URL 打开即下载成功。

### 2.2 永久删除账号

- 页面先说明会删除的范围、无法撤销、外部词典已有副本不由 Huayi 远程删除、备份残留以生产政策为准。
- 删除 HuayiAccount 不删除任何设备的 LocalLexiconEntry 或本机外部词典副本；它会使云端 StudyCapture、
  CloudWordCopy/WordEntry 和其他账号内容进入删除任务，并撤销 session，使插件在下一次可信状态同步时
  清除账号偏好缓存与未提交账号绑定 outbox。
- 用户必须输入界面文本“删除我的账号”，勾选理解后再打开最终确认；网络请求只发送固定
  `confirmation: "delete-account"`，不把本地化文案当协议。
- 请求要求 full 或 data-rights Cookie、可信 Origin、CSRF、Idempotency-Key 和最近 15 分钟重新认证。
- API 在成功响应前原子创建 AccountDeletionJob、把账号改为 `deleting`、撤销全部 Web/Extension
  session、使未消费 pairing 失效，并返回清除 Cookie。此后普通登录和业务接口都失败关闭。
- Web 收到 accepted 后必须立即丢弃当前 CSRF/session UI 状态并切到 signed-out 视图；不能只显示“已退出”
  文案却继续保留导出、下载或再次删除控件。该转换由 Cloud App 的会话状态拥有，数据权利页面只发出
  `onAccountDeleted` 事件，不自行伪造登录页或保存删除回执。
- 删除任务不提供用户可轮询详情：会话已被撤销，不能建立“已删除账号仍可认证”的第二通道。
- 若首次响应丢失，旧 Cookie 只可对相同 confirmation、Idempotency-Key 和 request hash 重放固定
  `{accepted:true,requestedAt}`；它不能读取任务状态或任何账号数据。任务保存 pepper-hash 的请求 session
  到完成后 24 小时作为 receipt proof，随后清除。
- 运营任务在 1 小时未完成时告警，24 小时未完成升级为事故；失败只保存稳定阶段，不保存正文或原始
  Provider 错误。

## 3. 权威与状态机

### 3.1 AccountDataExportJob

AccountDataExportJob 属于账号数据且受 owner RLS；账号删除会级联删除任务行。公开状态：

```text
pending ──claim──> running ──object written──> ready ──24 h──> expired
   ^                    │                            │
   └────explicit retry──failed <────safe failure────┘
```

- claim 使用随机 lease token 与 expiry；过期可接管，旧 worker 不能完成新 lease。
- worker 在一个 owner-scoped repeatable snapshot 中构造确定性 NDJSON，再写入私有对象。
- 上传失败时删除可能存在的临时对象并 fenced 标记 `failed`；不得发布不完整下载。
- `ready` 的 object key、hash、byte length 和 lease 都是内部字段，公开任务只返回稳定状态、时间、文件
  大小、记录数和可空 `expiresAt`。expired 可在内部暂时保留 object key/cleanup error，直到幂等删除成功。

### 3.2 AccountDeletionJob

AccountDeletionJob 是独立运营权威，不通过 owner RLS 暴露，也不以 `user_profiles` 外键级联。状态：

```text
requested ──claim──> running
                        ├──exports-deleted
                        ├──database-deleted
                        └──auth-deleted ──> completed
                 safe failure ──> failed ──retry/expired lease──> running
```

- 当前阶段字段记录最后完成的稳定 stage；每一步必须幂等，重试从 stage 之后继续。
- 顺序固定：撤销 session/标记 deleting（请求事务）→ 删除私有导出对象 → 删除 `user_profiles` 及其
  owner 数据 → Supabase Auth Admin 删除身份 → 完成任务。
- 主库删除事务除级联 tenant 表外，还删除该用户创建的 invitation/claim/auth-flow、相关 audit event，
  并清除 `runtime_controls.updated_by` 等非外键直接 UUID；不可逆 hash-only rate-limit 记录按其短期
  保留策略自然过期。
- 若主库删除已完成而 Auth 删除失败，任务仍保留用户 UUID 以重试；完成后立即把 UUID 置空，仅保留
  `subject_hash`、完成时间、attempt count 和稳定结果用于有界运营证明。
- 删除 worker 同样使用 lease token fencing；两个 Vercel 实例不能同时推进同一任务。

## 4. 数据结构

### 4.1 `account_data_export_jobs`

未发布 bootstrap `0001` 新增 tenant 表：

```text
id uuid PK
owner_user_id uuid FK user_profiles ON DELETE CASCADE
state pending|running|ready|failed|expired
format_version integer = 1
record_count integer nullable
byte_length bigint nullable
sha256 text nullable
object_key text nullable
lease_token_hash text nullable
lease_expires_at timestamptz nullable
expires_at timestamptz nullable
last_error_code export-build-failed|object-write-failed|object-delete-failed nullable
revision integer >= 1
created_at / updated_at timestamptz
```

约束：同 owner 仅一个 `pending|running|ready`；ready 必须具有完整 object metadata/expiresAt；expired 可
在清理完成前保留 object key，但永远不能签 URL；非 running 不得持有 generation lease；object key 由
服务器随机 job ID 派生，不包含 owner/email。

### 4.2 `account_deletion_jobs`

独立运营表，不加入 tenant table grants：

```text
id uuid PK
subject_user_id uuid nullable
subject_hash text NOT NULL
state requested|running|failed|completed
stage requested|exports-deleted|database-deleted|auth-deleted
request_key_hash / request_hash text
request_session_hash text nullable
ack_expires_at timestamptz
lease_token_hash / lease_expires_at nullable
attempt_count integer >= 0
last_error_code object-delete-failed|database-delete-failed|auth-delete-failed nullable
requested_at / updated_at / completed_at timestamptz
```

同一非空 subject_user_id 只有一个任务。`completed` 必须 subject_user_id=null、stage=auth-deleted、
completed_at 非空；未完成必须保留 subject_user_id。request_session_hash 只允许重放完全相同的 accepted
response，不是 session；完成 24 小时后必须清除。

### 4.3 `web_sessions.access_scope`

未发布 bootstrap 为 Web session 增加 `access_scope=full|data-rights`：active profile 登录创建 full；disabled
profile 登录创建 data-rights；deleting 不创建。普通 `authenticate_web_session` 只接受 active+full；新的
`authenticate_data_rights_session` 接受 active+full 或 disabled+data-rights。`/v1/auth/csrf` strict 响应
增加同名 access，让 Web 在刷新后仍能只显示 `/settings/data` 与退出。

现有 `auth_flows` 同步增加 `kind=invite-registration|login`，并允许 login flow 的 `ticket_hash` 为空；
check constraint 保证只有 invite-registration 持有 claim ticket。普通 Google start 创建 login flow，
callback 只接受已经存在且状态为 active/disabled 的同 ID profile，不自动建账号；deleting/not-found 失败
关闭；AccountSignInMethods Phase A 后还必须已登记 `google`，Supabase identity 本身不直接授权。邀请注册
继续使用 claim/bind/finalize 路径并只登记本次实际 method。

### 4.4 导出文件

文件名固定 `huayi-account-data-v1.ndjson`，MIME 为 `application/x-ndjson; charset=utf-8`。每行一个 strict
JSON object，以 LF 结束：

1. `manifest`：schemaVersion=1、exportedAt、product=`huayi-cloud`；
2. `account-preferences`：timezone、dailyGoal、extensionQueryModelMode、studyCaptureMode、
   cloudWordCopyMode、revision、createdAt/updatedAt；
3. `account-sign-in-methods`：按 password、google 固定顺序导出 1–2 项 method 与 linkedAt，不含 Auth
   identity ID、subject、email、token 或 owner；
4. `extension-query-generation`：仅导出 owner snapshot 时尚未过期的公开恢复投影：ID、action、
   selectionKind、sourceType、最小输入、公开 state、可选 strict compact result/稳定终态错误、createdAt、
   expiresAt；不含 session、lease、reservation、价格、request hash、幂等键或内部 Provider 响应；
5. `study-capture`：公开 StudyCapture、状态、次数、时间、可选标题/用户上下文和最新分析投影，不含
   ExtensionQueryResult、URL、页面标题、视频 ID 或 outbox；
6. `analysis`：完整公开 AnalysisRecord（含候选和公开 model metadata）；
7. `learning-item`：archivedAt、LearningItem、ScheduleState、全部 SourceExample 和 Tag；归档项不遗漏，
   已抹除项不生成记录；
8. `word`：云端 WordEntry 与全部 ContextObservation；
9. `practice-session`：完整公开 PracticeSession，保留 item 顺序、attempt/turn/反馈与 rating；已抹除学习项
   只在对应 item 上标记 `learningItemDeletedAt`，不恢复或复制已删除正文。

同类型按 `(createdAt,id)` 升序，子记录按领域顺序或 `(createdAt,id)` 升序。文件不包含 owner ID；manifest
之后即使某类为空也不制造占位记录。所有行先由共享 strict schema 验证，未知字段失败整个 job。

## 5. 公共与内部接口

### 5.1 Web API

| Method/path                                      | 认证与用途                                       |
| ------------------------------------------------ | ------------------------------------------------ |
| `POST /v1/account-data-exports`                  | full/data-rights Cookie+proof+key；创建/重放     |
| `GET /v1/account-data-exports/current`           | full/data-rights Cookie；读取当前或最近任务      |
| `POST /v1/account-data-exports/:id/retry`        | full/data-rights Cookie+proof+revision；显式重试 |
| `POST /v1/account-data-exports/:id/download-url` | 最近认证+Origin+CSRF；返回有界 HTTPS signed URL  |
| `POST /v1/account-deletion`                      | 最近认证+Origin+CSRF+key；创建删除任务并退出     |
| `POST /v1/auth/google/login/start`               | strict 空 body；既有账号 Google 顶层登录         |

export job 响应不返回 owner、object key/hash、lease、错误原文或 signed URL。download response 只在单次
响应内含 `url/expiresAt`，响应头 `private, no-store`；其他 route 永不返回 URL。删除成功为 `202`、固定
`{accepted:true,requestedAt}` 并清除 `huayi_session` Cookie。删除端点在普通认证失败后，只可调用内部
receipt replay：presented Cookie hash、key 和 body hash 全部匹配且 ack 未过期才返回同一固定响应。

### 5.2 内部 worker

`GET /internal/data-rights/run` 只接受固定 `Authorization: Bearer <CRON_SECRET>`，每次最多 claim 一个
export 和一个 deletion；响应只含 bounded outcome/count，不含用户 ID、对象 key、URL 或错误原文。
production 由独立 Supabase Cron job 每分钟经 `pg_net` 调用；调度层不保证 exactly-once，恢复性完全来自
Postgres lease/fencing 和后续周期调用，无任务时幂等返回 idle。安装与安全边界见
`vercel-hobby-supabase-cron.md`。

### 5.3 深模块接口

外部 seam 只暴露：

```text
AccountDataRights.requestExport(owner, key)
AccountDataRights.currentExport(owner)
AccountDataRights.retryExport(owner, job, revision, key)
AccountDataRights.createDownload(owner, job, recentAuth)
AccountDataRights.requestDeletion(owner, recentAuth, key)
AccountDataRights.runOne()
```

Postgres snapshot、对象存储、Supabase Auth Admin、clock/IDs/crypto 是内部注入 seam。生产 adapter 分别
使用 tenant Postgres、Supabase private Storage 和 service-role Auth Admin；测试使用 PGlite 与内存对象/
Auth adapter。Hono/Web 不编排阶段或删除顺序。

## 6. 安全、隐私与故障语义

- `SUPABASE_SERVICE_ROLE_KEY`、`CRON_SECRET` 和 private bucket 仅在 API server secret store；Web、
  Extension、构建产物、错误和日志不得出现。
- service-role client 只在对象/Auth adapter 内使用，绝不用于业务表读取以绕过 RLS。
- signed URL 必须是配置的 Supabase HTTPS origin/private bucket，禁止 userinfo、重定向到任意 host 或把 URL
  写入日志；Web 只在用户点击后打开。
- 导出构建在 owner RLS snapshot 内读取；跨 owner job/detail/download 一律 `not_found`。
- 删除不能被平台模型 kill switch、额度耗尽或账号 disabled 阻止。active 用户使用 full session，disabled
  用户重新验证后使用 data-rights session；任务开始后 worker 不再依赖用户 session。
- 错误对用户仅投影 `export_failed`、`recent_authentication_required` 或既有安全 code；内部 job 只保存
  allowlist stage code。
- 所有响应 `private, no-store`；导出/删除端点接入有界账号级 rate limit。

## 7. TDD 与验证矩阵

### 7.1 Contracts

- strict job/status/retry/download/deletion/worker schemas 与固定 routes；
- NDJSON 八类 record union；临时查询只取 snapshot 时尚未过期项且不会延长 expiry；未知/owner/session/
  token/credential/internal lease/reservation/request hash/本机词库/outbox 字段拒绝；
- ready/failed/expired 状态交叉约束、HTTPS signed URL 15 分钟上限与 24 小时 object expiry。

### 7.2 Postgres/PGlite

- tenant RLS、跨 owner current/download not_found、单 open export；
- deterministic golden export，空集合、Unicode、LF、所有 retained 类型与排除字段；
- export claim/replay/过期接管/旧 token fencing、上传失败、ready/expiry cleanup/retry；
- deletion request 在返回前撤销所有 session/pairing并禁止新认证；
- 删除级联覆盖所有 tenant 表，并清除 invitation/claim/auth-flow/audit/runtime-control 中的直接用户 UUID；
  全局 price version 保留，删除任务本身不级联；
- 删除请求丢响应后只重放同 key/hash 的固定 accepted receipt；旧 Cookie 不能访问其他端点，ack 到期清理；
- exports→database→auth 顺序、每 stage 幂等、worker crash/过期 lease 接管、旧 worker fencing；
- 完成后 subject_user_id 清空；跨实例同一任务只有一个有效 worker。

### 7.3 API/adapter

- Cookie/Origin/CSRF/recent-auth/idempotency 与固定 internal cron bearer；
- active→full、disabled→data-rights、deleting→拒绝登录；data-rights 只能访问导出/删除/退出；
- Google login flow 不消费 invitation、不创建 profile、不绑定新 identity；callback 严格区分 flow kind；
- service-role Auth delete 的 success/not-found 幂等和安全失败；
- private object write/delete/signed URL host/bucket/expiry、无 URL/正文日志；
- kill switch/额度不阻止数据权利端点。

### 7.4 Web

- loading/empty/pending/running/ready/failed/expired、显式 retry、下载；
- 包含/排除内容文案、WordListExport 区分、recent-auth 提示；
- 删除确认文本、checkbox、最终 dialog/focus、busy/late generation guard；
- 成功清除账号 UI 并进入已退出状态；失败保留确认状态且不伪称已删除；
- 窄屏、键盘、live region、reduced-motion。

### 7.5 门禁

- contracts/API/Web focused RED→GREEN；PGlite migration/RLS/security/golden；
- 全 workspace test/typecheck/build、architecture/instructions、受影响 ESLint/Prettier、diff；
- 既有 Extension 离线 E2E；actual Web 本地 fake journey 覆盖导出下载与删除请求；
- 真实 Supabase Storage/Auth、Vercel 调度、备份残留和生产浏览器必须另行批准/验证。

### 7.6 2026-08-14 actual bundle 补充 TDD

1. browser authority 增加独立 data-rights helper，只处理 current/create/download/delete 四个固定 route；
   主 authority 仍拥有 Cookie/Origin/CSRF/idempotency proof、固定安全错误和无正文 request facts；
2. journey 从 empty current 开始，请求导出得到 pending；下一次服务器重读模拟 fenced worker 已完成并
   返回 strict ready，不让 React 或测试直接改 job；
3. 下载必须通过实际 `window.open(...,"noopener,noreferrer")` 打开本地 route-fulfilled 私有对象，签名
   URL 不进入主页面 DOM、Web Storage 或 authority snapshot；
4. 删除必须先通过 checkbox、精确本地短语与最终确认焦点，再发送固定
   `{confirmation:"delete-account"}`、Cookie/Origin/CSRF/Idempotency-Key；accepted 响应清 Cookie；
5. Cloud App 收到 `onAccountDeleted` 后立即显示“需要先登录”，数据权利标题/导出/删除控件消失；再次
   访问数据 API 使用已清除 Cookie 并得到 401；
6. 390px/reduced-motion、无横向溢出、空 Web Storage、snapshot 不含 signed URL/token/正文/key。

## 8. 验收标准

1. 用户能获得完整、版本化、可严格解析且不含秘密/会话的云端账号导出；WordListExport 不被称为
   完整备份，AccountDataExport 也不伪称包含各设备本机词库。
2. 任何跨账号、过期 URL、旧 lease 或重复 worker 都不能读、发布或删除另一账号数据。
3. 删除请求返回前所有 session 已失效；任务失败可安全重试且 24 小时 SLA 有无正文告警依据。
4. 主库删除后任务仍能完成 Auth 删除；完成后任务不再保留直接用户 UUID。
5. production 缺 service-role、worker secret、private bucket 或可信 origin 时启动失败关闭。
6. disabled 用户可以重新认证后行使导出/删除权，但不能访问任何普通账号正文接口。
7. password 与 Google-only 既有账号都能取得正确 access scope；未知 Google identity 不会自动注册。
8. 删除请求丢响应可用原 proof 重放固定 accepted receipt，但不能恢复 session 或读取任务/账号数据。
9. 未经真实环境验收不得声称备份残留期限、真实下载、真实 Auth 删除或发布就绪。

## 9. 文档审阅结论

初稿审阅发现并已裁决：

- 同步返回 JSON 会绕过既定短时签名下载且不能恢复大导出失败，拒绝；采用私有对象+任务。
- 把删除任务挂在 user_profiles 下会在最需要恢复时被级联删除，拒绝；任务独立并在完成后去标识。
- 先删 Auth 会导致主库失败后用户无法重新认证处理，且不利于可恢复顺序；请求先撤销 session，worker
  先清私有对象、再删主库、最后幂等删 Auth。
- “签 URL 即下载完成”无法由当前存储可靠证明，拒绝；URL 最长 15 分钟，对象在 ready 后 24 小时先
  失效再幂等清理，清理失败保持不可下载并告警重试。
- 当前代码缺 service-role、private storage 和 worker runtime；实现必须补这三项并保持生产缺配置失败关闭。
- 实现前 disabled 账号无法创建任何 session，与“停用不阻止数据权利”冲突；已增加受限
  DataRightsSession，未放宽普通业务 session 的 active 检查。
- 实现前 Google OAuth 只有邀请注册路径；现有严格 login flow kind 不复用/伪造 claim ticket，Phase A
  还要求 `google` method 已登记，因此不能用普通 Google 登录开放无邀请注册或静默补绑。
- 立即撤销 session 会让丢失的首次删除响应无法普通重试；实现必须提供 hash-only、同 key/body、固定
  accepted receipt replay，不能复活 session 或建立删除后数据读取通道。

上述产品裁决仍成立。2026-08-14 实现后复审曾发现 7.5 明列的 actual Web journey 不存在；同时组件
成功分支只显示“已退出”文案，Cloud App 仍保留账号 UI，与 7.4 冲突。现已在既有 seam 内修复：页面
仅在 deletion accepted 后发出 `onAccountDeleted`，Cloud App 清空 CSRF 并进入统一 signed-out 视图；
独立 data-rights authority helper 与 actual bundle journey 已覆盖服务器重读 ready、新窗口下载、签名
token 脱敏、双重删除确认、Cookie 清除及后续 401。复审未引入新的供应商或安全边界。
本轮 focused Web 11/11、全 workspace 411 个 Vitest 文件（2,582 passed / 12 skipped）、全 workspace
typecheck/build 与完整离线 Playwright 94/94 均通过；真实目标环境状态不因此改变。

账号删除与 Storage 外部事实已于 2026-08-13 依据官方文档复核；调度方案于 2026-08-20 校准为
Supabase `pg_cron + pg_net` 调用固定 HTTPS path，并由私有 adapter 显式发送 `CRON_SECRET` bearer。
Supabase `auth.admin.deleteUser` 要求 service-role 且只能服务端调用；private Storage 支持按秒签发 URL。
实现测试仍使用本地 adapter，不调用真实供应商。

- [Supabase Cron](https://supabase.com/docs/guides/cron)
- [Supabase pg_net](https://supabase.com/docs/guides/database/extensions/pg_net)
- [Supabase Auth Admin deleteUser](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser)
- [Supabase Storage createSignedUrl](https://supabase.com/docs/reference/javascript/v1/storage-from-createsignedurl)
