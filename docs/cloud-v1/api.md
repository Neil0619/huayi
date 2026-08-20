# 华译 Cloud V1 `/v1` 契约

## 1. 通用约定

- JSON 使用 UTF-8、camelCase 和严格对象；未知字段、非有限数字和未声明 union variant 一律拒绝。
- 成功资源含 `id`、`revision`、`createdAt`、`updatedAt`。列表使用 `items` 与可空 `nextCursor`，默认
  20、最大 100；cursor 为带签名的不透明值。
- 各资源显式声明的可重放 mutation 必须带不超过 128 字符的 `Idempotency-Key`；编辑、归档、恢复和
  删除通常还需 `If-Match: "<revision>"`。认证、邀请、pairing approval 与一次性 auth/link flow 使用
  各自的短时状态机和读取恢复语义，不伪造 replay header。
- 每个响应含 `X-Request-Id`。错误 envelope：

```ts
type ApiError = {
  error: {
    code:
      | "invalid_request"
      | "authentication_required"
      | "forbidden"
      | "invitation_invalid"
      | "invitation_expired"
      | "invitation_consumed"
      | "sign_in_method_already_linked"
      | "revision_conflict"
      | "idempotency_conflict"
      | "exact_duplicate"
      | "quota_exhausted"
      | "rate_limited"
      | "generation_busy"
      | "study_capture_in_use"
      | "capture_hash_collision"
      | "model_unavailable"
      | "model_output_invalid"
      | "client_upgrade_required"
      | "not_found";
    message: string;
    requestId: string;
    retryAfterSeconds?: number;
  };
};
```

错误不得回显原始模型 JSON、prompt、SQL、堆栈、正文或内部供应商响应。

## 2. 认证与账号

| Method/path                       | 用途                 | 关键输入/输出                                              |
| --------------------------------- | -------------------- | ---------------------------------------------------------- |
| `POST /v1/invitations/claim`      | 验证并预占邀请       | invitation token；返回短时 claim ticket，不创建业务账号    |
| `POST /v1/auth/google/start`      | 发起 Google OAuth    | body 中的 claim ticket；302 到 Supabase/Google             |
| `GET /v1/auth/csrf`               | 登录后获取新 CSRF    | HttpOnly Cookie + Web Origin；轮换后返回短时 token         |
| `POST /v1/auth/password/register` | 邮箱密码注册         | claim ticket、email、password；要求邮件验证                |
| `POST /v1/auth/password/login`    | 已注册账号登录       | email、password；设置 Web Cookie                           |
| `POST /v1/auth/password/recovery` | 请求密码恢复         | email；统一 202 accepted，不披露账号或 method              |
| `POST /v1/auth/logout`            | 撤销当前 Web session | CSRF；204                                                  |
| `GET /v1/account`                 | 当前账号聚合         | Cookie；email/preferences/有效 extension sessions/最低版本 |
| `GET /v1/account/preferences`     | 当前账号偏好         | Cookie；练习偏好、三项插件偏好、revision/updatedAt         |
| `PATCH /v1/account/preferences`   | 更新账号偏好         | Cookie + Origin + CSRF + revision/idempotency proof        |
| `GET /v1/extension-preferences`   | 插件偏好投影         | Extension proof；三项插件偏好、revision/updatedAt          |
| `POST /v1/account/export`         | 创建导出             | 返回 export job；完成后给短时签名下载地址                  |
| `POST /v1/account/delete`         | 删除账号             | 重新认证证明与确认字符串；立即撤销会话并返回 job           |

密码注册 202/200 与密码登录 200 响应都使用 `Cache-Control: private, no-store`。注册 202 只返回
`{emailConfirmationRequired:true}`，不设置 Web Cookie；只有邮件确认 callback 完成邀请，或 provider 明确
返回已验证 session 时才可创建 Cookie。密码登录错误统一为认证失败，不回显账号或供应商细节。

PasswordRecovery 使用独立五路由状态机：start 为 strict `{email}` 并对未知/Google-only/非 active/eligible
统一 202 `{accepted:true}`；只有 active+password method 才创建 flow。邮件固定回到
`GET /v1/auth/password/recovery/confirm?flow&code`；该 GET 只显示 inert CSP/no-store/no-referrer 确认页，
用户显式 exact form POST `/v1/auth/password/recovery/callback` 才交换同 owner Provider session、设置 15
分钟 purpose-scoped HttpOnly Cookie并 302 `/recover?continue=1`。Web 再以 Cookie+Origin GET
`/v1/auth/password/recovery/session` 取得短时 CSRF，POST
`/v1/auth/password/recovery/complete` 提交 strict `{password}`。成功 204、清 recovery Cookie、撤销全部
Huayi Web/Extension sessions并要求重新登录；不创建 Huayi session、不新增 method。全部响应 no-store，
callback no-referrer；有效且未限速的 start 202 固定至少 250ms handler floor。完整契约见
`password-recovery.md`。当前 strict route/input/output、五条公开 handler、internal outcome/dispatch route、
production composition、Web strict client/页面与 actual-bundle fake-mail journey 已离线实现；真实通知
sender/CRON/告警、Supabase/邮件/部署与双平台 Chrome 尚未验证。
eligible start 只创建 `requested` flow；外部发信由
`GET /internal/password-recovery/run` 的 CRON bearer worker 每次有界领取一个任务。worker 在 Provider
前耐久标记 dispatch，若回执不明确则不得自动重发。

Web 与 API 为独立 origin；API CORS 只允许固定 `HUAYI_WEB_ORIGIN` 与配置的发布 Store Extension
origin，响应包含 `Vary: Origin`。只有 Web origin 携带 Cookie；Extension 使用 Authorization 和
client-version 且 `credentials=omit`。OAuth callback 绝对跳转至 Web `/app`。Web 随后以 HttpOnly
session Cookie 和固定 Origin 调用 `/v1/auth/csrf`，原子轮换服务端 hash 后取得 token；长期 token
不进入 OAuth query。

账号偏好是 `user_profiles` 的窄投影，不包含 owner：IANA timezone、dailyGoal 1–100、
`extensionQueryModelMode=platform|byok`、`studyCaptureMode=manual|automatic`、
`cloudWordCopyMode=enabled|disabled`、revision 与 updatedAt。GET/PATCH 在 forced-RLS transaction 中执行；
PATCH 是至少一个字段的 strict partial，并要求 Idempotency-Key、quoted If-Match 和 body expectedRevision。
真实变化只推进一次 revision；重放不推进。修改只影响后续查询/采集/收藏/每日队列，不改变已开始请求、
PracticeSession 或两端既有数据。Extension GET 只返回三项插件偏好及 revision/time。

`GET /v1/account` 只接受 active/full Web Cookie，并在 owner repeatable-read snapshot 内再次要求 profile
仍为 active，再返回规范 email、嵌套完整 AccountPreferences、未撤销且未过期并按 `(createdAt,id)` 排序的 ExtensionSessionResource，以及
启动时严格校验的公开最低插件版本。响应 `private, no-store`，不含 owner/status/consentVersion、Web
session、token/hash、install ID、quota 或正文。disabled data-rights session 仍只能访问导出、删除和退出。

邀请 claim ticket 与最终身份创建必须绑定同一次流程并短时过期。邀请只有在 Auth 身份成功建立并写入
`user_profiles` 和本次实际 `account_sign_in_methods.method` 的幂等 finalization 完成后才标记 consumed；
失败可以使用同一 ticket 安全重试，不能签发业务 session、生成多个 profile 或给既有 profile 补 method。
失去有效 ticket 的孤立 Auth identity 不可登录并由清理任务删除。

普通 `POST /v1/auth/password/login` 与 Google `kind=login` callback 都在 provider 成功后、Web session
创建前校验 `(userId,password|google)` 已登记。未登记、profile 不存在或 deleting 统一
`authentication_required` 且不设置 Cookie；disabled 的已登记 method 只可得到 data-rights session。
`GET /v1/account/sign-in-methods` strict 资源已在 Phase B 接入 production handler：active/full Cookie 后
从 owner-RLS transaction 返回 1–2 项 canonical `{method,linkedAt}`，响应 private/no-store，不含 owner、
email、provider subject/identity ID/token。`POST /v1/auth/reauthenticate/password` 也已接入：只接受当前
active/full Cookie、固定 Origin、CSRF 与 strict `{password}`；服务端读取规范邮箱并确认 password method，
Provider 返回同一 user ID 后原子撤销旧 Huayi session、替换 encrypted refresh ciphertext 并轮换 Cookie/
CSRF，响应只含 `{access:"full",csrfToken}`。错误密码、错 user、过期/并发旧 session 与未登记 method 均
零 session 写且不设置新 Cookie；每 IP+owner 每分钟最多五次 Provider 尝试。Google recent-auth、显式绑定
也已接入：POST start 以 Cookie+Origin+CSRF 建立 purpose/session-bound 15 分钟 flow，只通过 path-scoped
HttpOnly SameSite=Strict intent Cookie 把 opaque secret 带到固定 continue GET；continue 单次 302 Google，
callback 必须返回同一 Supabase user ID 才原子轮换 Huayi session/CSRF/encrypted refresh。intent、flow、
provider code/state/token 不进入公开 JSON/Web URL/Storage。显式绑定 mutation 与账号页 UI 已接入；在
active/full Cookie、可信 Origin、CSRF 与目标绑定要求的 recent-auth provenance 已验证后，目标 method
已存在固定返回 HTTP 409
`sign_in_method_already_linked`，不创建 flow、不调用 Provider、不轮换或撤销 session。未认证或已撤销
session、普通登录或错误 recent-auth 仍统一 `authentication_required`，不能用该错误探测账号。

`POST /v1/auth/google/start` 保留严格 JSON 客户端语义，同时允许浏览器顶层导航所需的
`application/x-www-form-urlencoded`。表单必须恰好只有一个 `claimTicket` 字段；缺失、重复、额外、
非法或过长字段以及其他 Content-Type 都返回 `invalid_request`。API 校验短时 ticket 后才创建一次性
Auth flow，302 目标由服务端 Supabase adapter 返回；Web 表单 action 只能由已验证的固定 HTTPS API
origin 构造，不能来自邀请 URL、用户输入或第三方响应。

`POST /v1/auth/google/login/start` 使用 identity-owned strict 空对象契约，不复用同形的数据导出或
reauth/link request。JSON 必须精确 `{}`，原生 form body 必须为空；start 与共用 callback 都固定
`Cache-Control: private, no-store`，callback 另固定 `Referrer-Policy: no-referrer`，包括畸形/过期/未授权
失败。完整 production-bundle 验收路线见 `google-authentication-acceptance.md`。

## 3. Extension 配对

| Method/path                                | 用途                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| `POST /v1/extension-pairings`              | Extension 创建 state、challenge、install hash；返回 pairing ID 和固定 Web URL |
| `GET /v1/extension-pairings/:id`           | Extension 有界轮询 pending/approved/expired；按 pairing ID 与 IP 限速         |
| `POST /v1/extension-pairings/:id/approve`  | Web 原子确认设备标签、同意和三项账号插件偏好                                  |
| `POST /v1/extension-pairings/:id/exchange` | verifier 换 session token + 偏好快照；pairing 原子变 consumed                 |
| `GET /v1/extension-sessions`               | Web Cookie 列出当前账号仍有效的设备 session 元数据                            |
| `DELETE /v1/extension-sessions/:id`        | Web Cookie + Origin + CSRF 撤销当前账号拥有的指定设备；204                    |
| `DELETE /v1/extension-session`             | 当前 Extension token 只撤销自身服务器 session；统一 204                       |

设备列表不包含 token、token hash 或 install ID。跨账号、已撤销或不存在的 session ID 均返回统一
not_found；客户端不能提交 userId 改变归属。Store self-revoke 不接受 session ID、userId、Cookie、CSRF、
body 或 Idempotency-Key；固定 Extension Origin、严格 token shape 与合法三段版本才可调用，但安全退出不
应用最低版本 426 gate。随机、已撤销、过期 token 统一 204，具体 remote-first 语义见
`extension-session-disconnect.md`。

approve body 含 deviceLabel、三项插件偏好和 expectedPreferencesRevision；请求要求 Web Cookie、Origin
与 CSRF。它是 pending→approved 的一次性转换，不使用 Idempotency-Key/If-Match 或 mutation replay；
丢失 204 后客户端通过 GET pairing 读取 approved 恢复。偏好未变化时只批准，变化时与 pairing approval
在同一事务写入；revision conflict 不批准 pairing，也不创建 session。exchange strict response 在
session token 之外返回偏好快照，供 SW 建立与 session 绑定的本机 cache。

Extension 业务请求使用 `Authorization: HuayiExtension <token>`、`X-Huayi-Client-Version` 与固定
`Origin: chrome-extension://<published-id>`。生产 API 先按 `HUAYI_STORE_EXTENSION_ID` 和
`HUAYI_MIN_SUPPORTED_EXTENSION_VERSION` 验证 Origin/版本，再验证 token；旧或非法版本返回 HTTP 426
`client_upgrade_required`。服务器仍只以 token 归属决定 userId，不接受客户端 userId。

## 4. 插件查询、学习采集、分析与历史

### Web 深度分析

`POST /v1/analyses:stream` 使用 SSE，输入：

```ts
type StartAnalysisRequest = {
  sourceText: string;
  source: { type: "manual"; title?: string; userContext?: string };
  selectionKind: "phrase" | "sentence" | "passage";
};
```

事件只允许：

```ts
type AnalysisEvent =
  | { type: "analysis.started"; requestId: string; unitCount: number }
  | { type: "analysis.preview"; section: "overall" | `unit:u${number}`; text: string }
  | { type: "analysis.completed"; analysis: AnalysisRecord; quota: QuotaSummary }
  | { type: "analysis.failed"; error: ApiError["error"]; quota: QuotaSummary };
```

事件有递增 `id`；preview 单事件最大 4 KiB、总预览最大 64 KiB。断线后客户端用
`GET /v1/analysis-requests/:requestId` 查询，不使用 Last-Event-ID 触发模型重跑。

服务端在发送 SSE header 前按 `(owner, Idempotency-Key)` 与规范化请求 hash 领取持久生成租约：同 key
不同 payload 返回 HTTP 409 `idempotency_conflict`；同 key、同 payload 若仍运行，只返回既有 request
ID 的 `analysis.started` 后结束流，客户端转为状态查询；若已完成或失败，则重放严格 terminal event。
生成租约为 4 分钟，额度预留为 5 分钟。租约过期会被原子标为 `analysis.failed` 并按预留额保守结算，
不会透明重新调用模型；陈旧 worker 的完成/失败写入被 fencing 拒绝。用户主动重试必须使用新 key。

Web 客户端通过 HttpOnly Cookie、固定 Origin、CSRF token 和新幂等键调用该端点。浏览器取消使用
`AbortSignal` 停止当前 SSE 消费，但 V1 没有平台分析取消端点，不能据此推断模型调用或服务器租约已
撤销；客户端必须忽略该运行代次的迟到事件，后续完成记录仍以服务器待整理区为准。若流只返回
`analysis.started` 或连接在取得 request ID 后中断，客户端查询严格 request status；`running` 不得
伪装为完成或自动以新 key 重跑。

Web manual 与 StudyCapture analyze 都使用 WebDeepAnalysis V2；phrase 只允许 ExpressionCandidate，
sentence/passage 只允许 ExpressionCandidate/SentencePatternCandidate。phrase 固定 `analysisUnitId=u1`，
sentence/passage 的确定性分句为 u1..u40；Candidate/SourceExample 用 analysisUnitId 关联。request 拒绝 action、word、owner、
Provider、model、quota 和 URL。`POST /v1/study-captures/:id/analyses:stream` 另要求 capture revision 与
`intent=initial|reanalysis`；reanalysis 使用新 key 并追加记录。initial 失败 fencing 后 capture 回到
pending；reanalysis 期间保持 analyzed，失败保留旧 latest，成功才追加 AnalysisRecord/candidates 并更新
最新投影。
manual 记录 `source.type=manual`；capture endpoint 忽略/拒绝客户端 source type，服务器固定
`source.type=study-capture`。两者都不出现 web-selection/youtube-caption。

### Extension 平台查询

| Method/path                               | 用途                                              |
| ----------------------------------------- | ------------------------------------------------- |
| `POST /v1/extension-queries:stream`       | Extension session 发起 compact platform query SSE |
| `GET /v1/extension-query-generations/:id` | 同 owner/session 在一小时内恢复 running/terminal  |

strict request：

```ts
type ExtensionQueryRequest = {
  action: "translate" | "explain";
  selectionKind: "word" | "phrase" | "sentence" | "passage";
  sourceType: "web-selection" | "youtube-caption";
  sourceText: string;
  sentenceContext?: string; // 只允许 word/phrase；恰好一条完整英文句
};
```

事件与 Store compact streaming interface 等价，只含 started/progress/delta/section/completed/failed 和严格
ExtensionQueryResult；不返回 AnalysisRecord/Candidate。请求要求 Extension token/Origin/client version 与
Idempotency-Key；同 key/hash 重放，different hash 冲突。平台 generation 在 dispatch 前持久化并预留额度，
再以当前 lease durable 写入 `dispatched_at`。终态输入/结果最多保留一小时，之后 status 为 not_found；
无正文 UsageLedger 保留。平台/BYOK 路由由
Store 请求开始时固定，API 不接受 BYOK key/provider endpoint，也不提供 fallback 参数。

内部 `GET /internal/extension-queries/cleanup` 只接受定时任务 Bearer `CRON_SECRET`；每次返回严格
`{abandonedCount,deletedCount}`（各 0–100），不返回 generation、owner、正文、结果、额度或内部错误。
它先安全终态化 lease 已过期的 running：未 dispatch 释放 reservation、不记账；已 dispatch 按预留上限
保守结算；随后删除到期 terminal。普通 Extension/Web 身份不能调用该路由。

### StudyCapture

| Method/path                                   | 用途                                     |
| --------------------------------------------- | ---------------------------------------- |
| `GET /v1/study-captures`                      | Web 按 status/kind/query 与签名游标读取  |
| `POST /v1/study-captures`                     | Extension exact upsert                   |
| `GET /v1/study-captures/:id`                  | Web owner-scoped 详情和最新分析投影      |
| `PATCH /v1/study-captures/:id`                | 分析前修改 kind/title/userContext        |
| `DELETE /v1/study-captures/:id`               | Web 二次确认删除或 Extension 当前卡 undo |
| `POST /v1/study-captures/:id/analyses:stream` | Web 初次分析/明确 reanalysis             |

POST 只接受 kind/sourceText；服务器执行 NFKC、引号统一、trim/空白折叠和 SHA-256。返回
`outcome=created|existing|linked-analysis` 与 strict capture；只有 created 允许当前卡以返回 revision undo。
同 key/body 重放不增 captureCount，新 key 的 exact occurrence 才增一次。hash 命中但规范全文不同返回
`capture_hash_collision`。PATCH/DELETE 要求 revision proof；kind 修改撞到既有 exact capture 返回带
owner-scoped target ID 的 `exact_duplicate`，不静默合并。

DELETE 只允许 pending、无 active generation/analysis 且 revision 未变化的 capture，否则
`study_capture_in_use`。Extension DELETE 使用 session/Origin/version/idempotency/revision；Web 另要求
Cookie/Origin/CSRF，并在 UI 二次确认。网络失败可由本机 SubmissionOutbox 保留 POST；本机 queued item
尚未提交时由 SW 直接移除而不调用 DELETE。

analyze 要求 `Idempotency-Key`、`If-Match` 与 strict `{ expectedRevision, intent: initial|reanalysis }`，
返回与 manual 分析相同的 SSE event。详情可额外返回脱敏
`activeAnalysisRequest:{ requestId,state:"running" }` 供刷新后检查同一次请求；不得返回 lease、reservation、
Provider 或幂等内部字段。首次失败恢复 pending，reanalysis 失败保持 analyzed 和此前 latest。

### Analysis 历史资源

| Method/path                     | 用途                                                      |
| ------------------------------- | --------------------------------------------------------- |
| `GET /v1/analyses`              | 按 status、source、selectionKind、query、时间游标查询历史 |
| `GET /v1/analyses/:id`          | 完整分析与候选                                            |
| `POST /v1/analyses/:id/process` | 标记无需收藏，或在候选确认后置 `reviewState=reviewed`     |
| `POST /v1/analyses/:id/archive` | 归档                                                      |
| `POST /v1/analyses/:id/restore` | 清除 archivedAt；reviewState 不变                         |
| `DELETE /v1/analyses/:id`       | 删除分析/候选；可按规则同时删除当前关联 StudyCapture      |

历史默认 `archived=false`、`limit=20`，支持 `reviewState`、`archived`、`sourceType`、
`selectionKind`、`query` 和不透明签名 cursor。服务端按 `(createdAt,id)` 降序执行 keyset 分页；query
只匹配来源正文/标题的字面文本，`%`、`_` 和 `\\` 不作为通配符。`archived=true` 只返回归档记录。

`process` 的 V1 outcome 仅为 `nothing-to-save`。process/archive/restore/delete 均要求
`Idempotency-Key`、`If-Match: "<revision>"`，且 JSON 中 `expectedRevision` 必须与 header 一致；旧 revision
返回 409 `revision_conflict` 且无副作用。同 owner、operation、key、request hash 原子重放严格响应，
不同请求重用 key 返回 409 `idempotency_conflict`。delete 的响应为 `{ id, deleted: true }`，记录删除后
仍可凭同 key 重放；已复制的 SourceExample 保留正文快照并将 `analysisId` 置空。删除 body 另可含
`deleteStudyCapture:boolean`，只有 `true` 才要求该 analysis 仍是 capture 当前最新投影，Web 对当前关联
记录默认 true；false 时 capture 从剩余关联记录投影最新，没有剩余则回 pending。删除非最新旧记录时
Web 不显示 capture 删除选项并固定发送 false；伪造 true 会以稳定关系冲突拒绝。

Web `/history` 直接消费上述列表/详情/维护接口：归档筛选与 reviewState 筛选独立，客户端不在内存中
重建历史权威。维护响应本身是已提交事实；后续列表或详情刷新失败只能报告“写入已完成、刷新失败”。

`POST /v1/analyses:import` 从目标契约移除。BYOK compact result 永不上传；尚未发布开发环境中的旧 route、
contract、adapter 与 encrypted analysis-import item 在 Phase 27 迁移阶段删除，不能保留为隐藏兼容入口。

## 5. 学习库

| Method/path                                         | 用途                                                      |
| --------------------------------------------------- | --------------------------------------------------------- |
| `POST /v1/analyses/:id/candidates:confirm`          | 编辑并批量确认候选，在一个事务内创建/合并学习项并处理分析 |
| `POST /v1/learning-items`                           | 手动创建 Expression 或 SentencePattern                    |
| `GET /v1/learning-items`                            | 类型、标签、系统属性、query、due/new、游标查询            |
| `GET /v1/learning-items/:id`                        | 内容、来源、排期与最近练习摘要                            |
| `PATCH /v1/learning-items/:id`                      | 编辑类型专属核心字段、属性和标签                          |
| `POST /v1/learning-items/:id/duplicate-suggestions` | 返回服务端重取的同类型语义候选                            |
| `POST /v1/learning-items/:id/merge:preview`         | 非权威预览安全子集合并；confirm 仍须重验                  |
| `POST /v1/learning-items/:id/merge:confirm`         | 显式确认同类型合并；返回目标和被删除来源 ID               |
| `POST /v1/learning-items/:id/archive`               | 可逆停止未来练习；保留排期和历史                          |
| `POST /v1/learning-items/:id/restore`               | 恢复学习并沿用原排期                                      |
| `DELETE /v1/learning-items/:id`                     | 仅硬删从未练习的项目、排期和项目关联；不删来源分析        |
| `GET/POST/PATCH/DELETE /v1/tags`                    | 管理用户标签；删除标签不删学习项                          |

候选确认请求必须包含 analysis revision、每个 candidate ID、目标类型、编辑后 payload、标签以及
`create | merge:<targetId>` 决策。候选只能是 Expression/SentencePattern 并创建或合并 LearningItem；
WordEntry 使用独立 words 接口。批量中任何一项校验失败则整个事务失败，不产生部分收藏。请求同时要求
`Idempotency-Key` 与匹配 analysis revision 的
`If-Match`；同 key/同 analysis path/同 body 重放首次严格响应，同 key 的 path 或 body 改变返回
`idempotency_conflict`，旧 revision 返回 `revision_conflict`。同 owner/type/规范键已存在时，`create`
返回 409 `exact_duplicate`，客户端必须
显式改选 `merge:<targetId>`；merge 只能指向同 owner、同类型、同规范键目标。

确认成功按请求顺序返回每个 `created | merged` 的完整 LearningItem，并把 AnalysisRecord 置为 reviewed。
merge 只追加未重复的标签、系统属性与来源，不覆盖已有学习项核心内容，同时递增目标 revision。标签以
NFKC、引号/空白统一和英文大小写折叠复用，保留首次 display spelling；只有确认 body 的标签会被创建。
SourceExample 的正文、译文、来源类型和标题来自可信 AnalysisRecord 句子快照，而不是客户端编辑字段。

Web 待整理页通过 `GET /v1/analyses?reviewState=pendingReview`、详情、确认和 `nothing-to-save` 组合
闭环。`exact_duplicate` 当前不携带可合并目标 ID，因此客户端必须保留编辑与勾选、提示等待精确/
语义查重目标，不能自动改写为 `merge`。这不改变确认端点必须显式给出 `merge:<targetId>` 的约束。

学习库 GET 的 list/detail 返回只读 view：`archivedAt`、`hasPracticeHistory`、完整 `LearningItem`、严格
`ScheduleState`，以及
可空的最近已完成练习摘要 `{ sessionId, type, completedAt, rating }`；不返回练习 prompt、回答、反馈、
turn、owner 或内部排期 revision。list 默认 `limit=20`、`archived=false`，上限 100，按
`(createdAt,id)` 降序返回带完整规范化筛选 fingerprint 的签名 keyset cursor。`type`、规范化 tag、systemAttribute、字面 query、
`due=new|due` 和 `archived=false|true` 均在 owner tenant transaction 内过滤；
`new` 表示 `level=-1`，`due` 使用服务器当前时间判断 `level>=0 && dueAt<=now`。不存在和跨账号 detail
统一返回 404。

`POST /v1/learning-items/:id/duplicate-suggestions` 只接受 strict `{expectedRevision}`、Cookie、可信
Origin、CSRF 与 `Idempotency-Key`，并固定 `private, no-store`；客户端不能提交候选 ID、owner、model、
endpoint 或 prompt。服务器读取最多 50 个同 owner/type active 候选，空候选零 reservation/Provider，
非空请求经 durable quota/dispatch 后最多返回 10 个服务器重读投影。运行中返回 409
`generation_busy`，额度不足返回 429 `quota_exhausted`，Provider/timeout 返回 503 `model_unavailable`，
strict 输出失败返回 502 `model_output_invalid`；不会返回 `exactOnly` 或自动切换其他模型路径。同
owner/key/source revision 的 completed/failed terminal 在新价格预检前重放；只有新 generation 才先按
peak 上限创建 reservation，再在 durable dispatch transition 以可信 UTC 时刻选择 legacy/off-peak/peak，
精确校验不可变数据库价格行并固定 UUID。kill switch、额度和配置错误均在 Provider fetch 前失败关闭；
HTTP response 不新增价格、usage 或内部 task 字段。

`POST /v1/learning-items` 接受 strict create request，仅使用 Web HttpOnly Cookie、可信 Origin、CSRF 与
`Idempotency-Key`，不需要 `If-Match`。同 owner/operation/key/body hash 优先重放完整 detail view；
同 key 不同 body 返回 `idempotency_conflict`。tenant transaction 原子创建 LearningItem、level -1
ScheduleState、规范化复用标签及 join；同 owner/type/canonical key 返回 409 `exact_duplicate`。
PATCH/DELETE/merge confirm 要求 Cookie、可信 Origin、CSRF、`Idempotency-Key`、quoted `If-Match`
与 body `expectedRevision`（merge 为 source revision）一致；相同 operation/key/hash 从删除前严格响应
快照重放，不同 body 为 `idempotency_conflict`。PATCH 不允许改变 item type，会重新计算 canonical key，
精确重复返回 `exact_duplicate`；标签按规范键复用。

DELETE 对无 `practice_session_items` 引用的项目 hard-delete；对有引用的项目仅在已归档且所有 session
安全终态、已完成自评并无生成/反馈 lease 时执行 LearningItemErasure。成功响应以
`deletionKind=hard-delete|erased` 区分；未归档返回 `learning_item_must_be_archived`，非安全引用返回
`learning_item_in_use`，均不披露数量或会话。抹除清除正文、identity、ScheduleState、SourceExample 和
tag joins，但保留最小关系墓碑；PracticeSession item 只增加 `learningItemDeletedAt`。
archive/restore 使用相同 proof/revision 规则并返回完整 detail；它只更新 archivedAt/revision/time，不改
ScheduleState 或 practice FK。归档项不能进入新练习或 patch/suggest/merge，返回
`learning_item_archived`；恢复沿用原排期，canonical uniqueness 不因归档释放。
merge preview 不是授权且可过期；confirm 在同一 tenant transaction 重验 owner、同类型、source/target
revision、source 从未练习且 `level=-1`。目标 identity/core/ScheduleState 保留，来源的 SourceExample、
标签和系统属性去重追加后 source 硬删，无 redirect。已练习或已排程来源返回
`learning_item_in_use`，不改写 PracticeSession 历史。

语义建议模型只能返回最多 10 个请求内不透明 candidate alias、bounded 中文理由和 `[0,1]` 置信值；API
只按服务端预取的 owner-scoped、current、同类型最多 50 项 alias map 重取并序列化候选，未知、重复或
越权 alias 丢弃。production 已组合固定 DeepSeek adapter、paid generator 与 Postgres authority；调用前
durable reservation/dispatch、调用后实际/保守 ledger 结算均不可绕过，且永不自动 merge。Web 每次用户
再次点击才使用新 key，不自动重试；item/revision 改变时清除候选并抑制迟到响应。

## 6. 练习

| Method/path                                                         | 用途                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------ |
| `GET /v1/practice/daily-queue`                                      | 按服务器时钟与账号时区返回到期优先、新项补足的目标队列 |
| `POST /v1/practice/sentence-sessions`                               | 从指定 1 个学习项生成句子创作题                        |
| `POST /v1/practice/dialogue-sessions`                               | 从指定 1–3 个学习项生成角色、任务、结束条件与开场消息  |
| `POST /v1/practice/sessions/:id/turns`                              | 先保存用户 turn，再生成下一条情境角色 turn             |
| `POST /v1/practice/sessions/:id/retry-assistant-turn`               | 显式重试同一待生成的情境角色 turn                      |
| `POST /v1/practice/sessions/:id/attempts`                           | 提交造句 PracticeAttempt；expected revision 必填       |
| `POST /v1/practice/sessions/:id/attempts/:attemptId/retry-feedback` | 显式重试同一作答反馈                                   |
| `POST /v1/practice/sessions/:id/finish`                             | 生成最终逐项反馈；对话必须 3–5 轮                      |
| `POST /v1/practice/sessions/:id/ratings`                            | 一次提交所有项目自评并原子推进排期                     |
| `GET /v1/practice/sessions`                                         | 历史分页与 status/type 筛选                            |
| `GET /v1/practice/sessions/:id`                                     | 查看完整造句或对话练习                                 |
| `DELETE /v1/practice/sessions/:id`                                  | 删除已完成练习；删除不回滚排期                         |

一个对话 round 指“一次用户回复及随后的助手回复”；开场消息不计 round，共完成 3–5 个 round。
活跃会话同时最多一个，`active | awaiting-feedback` 都占用该名额。句子题目先创建
`pendingGeneration=sentence-prompt` 的持久 session；句子答案先以 PracticeAttempt 原子保存并把 session
改为 awaiting-feedback；对话 user turn 也先保存。之后领域 claim 与 `practice_generation_tasks` 在同一
tenant transaction 中建立，Provider dispatch 前还必须完成额度预留和 durable dispatch mark。

`claimed|reserved` 尚无外部副作用，租约过期可安全接管；`dispatched` 已可能计费，过期后只能保守结算并
abandoned，不能透明调用第二次；`ready` 严格输出可以零调用重放并应用。反馈完成后才允许 ratings；相同
ratings 幂等重放，不同 ratings 冲突且排期不重复推进。对话 start、user turn、assistant retry 与 finish
都使用 `Idempotency-Key`；session mutation 还必须携带匹配 `If-Match`。普通 replay 只返回既有 pending
或 terminal 投影，新 Provider 调用必须来自用户显式动作的新 key。production 只经已验证的额度、结算、
fencing 与固定 DeepSeek Provider 组合；非法/缺失运行配置 fail-closed。完整恢复矩阵见
`paid-practice-generation.md`。
daily queue 同时返回匹配的可空 `currentSession` 与有序 `currentItems[1..3]`，Web 重开页面可恢复 active、
awaiting-feedback，以及 completed 但尚未自评的会话；浏览器不提交“今天”的日期。页面关闭不发送取消，
也不会释放服务器会话。`pendingGeneration=dialogue-start` 时公开 session 省略尚未生成的 `prompt` 和
DialoguePlan，不用内部占位文案伪装正式题目。

练习历史默认 `limit=20`，可按 `status=active|awaiting-feedback|completed|failed` 与
`type=sentence-creation|dialogue` 筛选。未完成项以 null completion time 和 ID 稳定分页，完成项再按
`(completedAt,id)` 降序；cursor 是资源隔离、签名且版本化的不透明值。列表只返回会话元数据、有序 item
ID/自评和 revision；详情返回严格公开 PracticeSession 及可空 `completedAt`，不返回 owner、生成/反馈
lease、token、内部 prompt reservation 或幂等记录。

DELETE 必须同时携带 Cookie、固定 Origin、CSRF、`Idempotency-Key`、`If-Match` 与 body 中相同的
`expectedRevision`。只有 status=completed|failed 且不存在 pending generation/反馈 worker lease 的会话
可删；active、awaiting-feedback 或 worker 占用统一返回 409 `practice_session_in_use`，不披露内部状态。
已评分与未评分的 completed 会话均可删。成功响应为 `{ id, deleted: true }`；删除后的同 key/同 body 从
幂等快照重放，不同 body 返回 `idempotency_conflict`。删除不修改 LearningItem、ScheduleState 或
SourceExample，也不重算既有 due/level/streak/rating；最后一条引用删除时可清理非内容墓碑。

## 7. 单词与外部词典

| Method/path                           | 用途                                                                   |
| ------------------------------------- | ---------------------------------------------------------------------- |
| `POST /v1/words`                      | upsert 规范词头与可选语境                                              |
| `POST /v1/words:copy`                 | Extension 提交新本机收藏的最小 CloudWordCopy                           |
| `POST /v1/words:import-local`         | 一次确认后，Extension 分批导入最多 100 词/1,000 语境的本机快照         |
| `GET /v1/words`                       | normalized headword query 与签名 createdAt/id 游标分页                 |
| `GET /v1/words/:id`                   | 查看词条与按 observedAt/id 签名游标分页的不可变语境                    |
| `PATCH /v1/words/:id`                 | 只编辑或清除 notes；headword/canonical 不变                            |
| `DELETE /v1/words/:id`                | 二次确认删除词条和语境；外部任务引用时拒绝                             |
| `GET /v1/words:export`                | 下载 UTF-8、一行一规范词头的不可恢复 WordListExport                    |
| `GET /v1/wordbook-jobs`               | owner-scoped filters 与签名 createdAt/id 游标分页                      |
| `GET /v1/wordbook-jobs/:id`           | 聚合任务详情，不返回 payload、lease 或原始第三方回执                   |
| `POST /v1/wordbook-jobs`              | 用户在 Web 或 Extension 显式创建 Eudic import/export 或 Shanbay export |
| `POST /v1/wordbook-jobs/:id/lease`    | Extension-only nonce 幂等领取最多 20 个 export item 或一个 Eudic page  |
| `POST /v1/wordbook-jobs/:id/receipts` | Extension-only token-fenced 幂等提交严格批次结果                       |
| `POST /v1/wordbook-jobs/:id/retry`    | 显式恢复 failed job，只重排失败 export item/保留 import cursor         |
| `POST /v1/wordbook-jobs/:id/cancel`   | 停止新租约；已发送第三方请求只记录迟到回执                             |

word list 默认 `limit=20`，query 经服务端 `normalizeHeadword` 后在 Postgres 对 canonical key 做字面
包含搜索，`%`、`_` 与反斜杠不成为通配符。词条 cursor 使用 `(createdAt,id)` 降序；详情 context cursor
使用 `(observedAt,id)` 降序且绑定 word ID。两个 cursor 有不同 HMAC 上下文，不可与其他资源或彼此复用。
列表只返回无 contexts 的 WordEntry core；详情返回有界 context page，不含 owner/content hash/内部字段。

`POST /v1/words` 必须携带 Cookie、固定 Origin、CSRF 与 `Idempotency-Key`。body 只允许 `headword`、仅在
创建时采用的可选 `notes`，以及可选手动语境 `{sourceText?,contextualMeaningZh?,sourceTitle?}`；语境至少
包含正文或语境释义之一。客户端不能提交 ID、owner、canonical key、sourceType 或 observedAt。服务器使用
`normalizeHeadword`、固定 `sourceType=manual`、服务器时钟和服务器 ID。响应为
`{word,wordOutcome:'created|existing',contextOutcome:'created|duplicate|omitted'}`；既有词条保持原 headword
和 notes，新增非重复语境时才递增既有词条 revision。同 key/同 body 从响应快照重放，不同 body返回
`idempotency_conflict`；不同 key/同规范词头由 `(owner,canonical_key)` 唯一约束收敛。

`POST /v1/words:copy` 只接受 Extension proof 与 Idempotency-Key，body 为
`{headword,sentence,contextualMeaningZh,collectedAt}`；拒绝 URL/title/result/provider/key/owner。服务器另存
receivedAt，固定 `sourceType=extension-collection`，按同一 canonical/context hash upsert，永不覆盖 notes。
`words:import-local` body 为 `{entries:[...]}`，含 1–100 个 strict entry；每项为
`{entryKey,headword,contexts}`，contexts 可为零，单项最多 1,000 条，且整批最多 1,000 条。每条 context 为
`{contextKey,sentence,contextualMeaningZh?,collectedAt}`；entryKey/contextKey 在批内唯一。API 不接受
`confirmedCount`、notes、URL、结果或客户端 owner。响应逐 entry/context 返回稳定 key、wordId、
`wordOutcome=created|existing`、`outcome=created|duplicate`，并返回可由这些结果严格复算的 word/context
聚合计数。一次本机快照预览和二次确认后，Extension 自动形成多批；每批使用持久稳定
Idempotency-Key，相同 batch key 重放，不同 batch 仍按 canonical word 与共同本机 context hash 收敛。
两条写入路径都不覆盖 Web notes，也不改变插件本机词库。

PATCH/DELETE 必须携带 Cookie、固定 Origin、CSRF、`Idempotency-Key`、quoted `If-Match` 与 body 中匹配的
`expectedRevision`，path ID 进入请求 hash。PATCH body 只有 `notes: string|null`，null 清除；ContextObservation
保持不可变。DELETE 只有在不存在 ExternalWordbookItem 引用时级联 word contexts；有引用统一返回 409
`word_entry_in_use`，不披露任务状态或数量。删除后的同 key/同 body 从严格响应 snapshot 重放，不同 body
冲突；AnalysisRecord、LearningItem、Practice 与外部任务记录均不改变。单条 ContextObservation mutation
仍不开放；外部词典任务端点已由 Phase 7 实现并在下文固定。

wordbook job create/list/get/cancel/retry 接受 Web Cookie 或 Extension session；Web mutation 还要求固定
Origin+CSRF。lease/receipts 只接受 Extension Authorization。job resource 只投影 target、direction、
`pending|active|completed|failed|cancelled|source-limit-reached`、processed/failed/total counts、可空
`nextPage`、稳定错误、revision/timestamps，不返回 owner、payload、receipt、nonce/token hash 或 expiry。

lease body 是 `{expectedRevision,claimNonce}`；nonce 至少 32 字节随机值。同 nonce 返回相同 lease，另一
nonce 在活跃租约期间返回稳定冲突。lease response 按 `kind` 分为 export entries（最多 20，只有 itemId、
headword、可选 contextLine）或 Eudic import page（固定 pageSize=100）。receipt request 同样按 kind 分流，
要求租约 item/page 精确匹配；重复/缺失/跨 job item 和陈旧 token 原子失败。完整 schema、幂等和取消迟到
语义见 `external-wordbooks.md`。

`GET /v1/words:export` 只接受 Web Cookie，响应为 `text/plain; charset=utf-8` 和固定安全下载文件名；按
`(canonical_key,id)` 在 owner snapshot transaction 中排序。非空文件每行一个 headword并以单个 LF
结束，空词库返回空文件；不包含 notes、context、ID、来源、时间、任务、账号或凭据。

## 8. 配额与管理

| Method/path                                         | 用途                                                                   |
| --------------------------------------------------- | ---------------------------------------------------------------------- |
| `GET /v1/quota`                                     | 当前 UTC 周期、limit/used/reserved micro-USD、percent 和 warning state |
| `GET /v1/admin/access`                              | 证明当前近期认证账号具有 Operator 角色                                 |
| `GET /v1/admin/invitations` / `POST` / `DELETE :id` | 列举、创建、撤销邀请；创建时只返回一次明文 URL                         |
| `GET /v1/admin/users`                               | 仅 email、状态、额度和设备数，不含正文                                 |
| `POST /v1/admin/users/:id/status`                   | `{action: "enable"                                                     | "disable"}`，状态与会话撤销 |
| `POST /v1/admin/users/:id/devices/revoke`           | 撤销目标账号全部有效 Extension session                                 |
| `PUT /v1/admin/users/:id/quota`                     | 设置当前或后续 UTC 月 limit，写审计                                    |
| `GET /v1/admin/usage`                               | 无正文的聚合费用、成功率、延迟与结构修复率                             |
| `PUT /v1/admin/runtime/model-kill-switch`           | 幂等暂停或恢复新的平台模型额度预留                                     |
| `GET /v1/admin/audit-events`                        | 固定 action/safeDetails 白名单的无正文审计                             |

管理员 GET 必须验证 active/full Web session、`admin_roles` 和最近重新认证时间；mutation 还必须验证
固定 Origin、CSRF 与 `Idempotency-Key`。所有成功写入恰好产生一条 `audit_events`，幂等重放不重复
写审计。严格投影、状态机、cursor 和 kill switch 路由见 `admin-operations.md`。

`GET /v1/quota` 只接受当前 Web HttpOnly Cookie，不接受 Extension Authorization 或客户端 owner，响应
使用 `Cache-Control: private, no-store`。响应直接使用 strict `QuotaSummary`：`availableMicroUsd` 为
`max(0, limit-used-reserved)`；`percentUsed` 只按已结算 `used/limit` 计算；已结算使用达到 80% 为
`warning`，而 used+active reserved 达到 limit 时优先为 `exhausted`。没有 current grant 时服务器按当前
UTC 月返回 0 limit/used/reserved/available、100% 和 exhausted。BYOK 不进入 reservation 或 ledger，
不反映在该响应中。账号资料/偏好/有效 Extension session 由 `GET /v1/account` 聚合；quota 仍不能由 Web
猜测或塞入账号响应。

## 9. 账号数据权利

| Method/path                                      | 用途                                                       |
| ------------------------------------------------ | ---------------------------------------------------------- |
| `POST /v1/account-data-exports`                  | 创建或幂等重放完整账号导出任务                             |
| `GET /v1/account-data-exports/current`           | 获取当前/最近公开任务状态                                  |
| `POST /v1/account-data-exports/:id/retry`        | 以 revision 显式重试 failed export                         |
| `POST /v1/account-data-exports/:id/download-url` | 最近认证后签发最长 15 分钟、且不越过 object expiry 的 URL  |
| `POST /v1/account-deletion`                      | 最近认证后创建删除任务、撤销全部 session 并清除当前 Cookie |

所有 POST 都要求可信 Origin、CSRF；create/retry/deletion 还要求 Idempotency-Key，retry 携带匹配
If-Match/body revision。export resource 只返回 id/state/formatVersion/recordCount?/byteLength?/expiresAt?/
stableError?/revision/timestamps，不返回 owner/object key/hash/lease。download URL 只出现在单次
`private, no-store` 响应。删除 body 固定 `{confirmation:"delete-account"}`，返回 202
`{accepted:true,requestedAt}`；账号进入 deleting 后普通认证失败关闭。

若删除请求丢响应，原 Cookie 只可在 24 小时内、以同一 confirmation/Idempotency-Key/body hash 重放固定
accepted 响应；该特殊 replay 不恢复认证、不返回 job state/user/object/stage，也不能访问其他 route。

active 登录创建 `access=full` Web session；disabled 登录创建 `access=data-rights`，只能调用本节端点与
logout；deleting 登录失败。`/v1/auth/csrf` 和密码登录 strict 响应都返回 access，Web 刷新后不能把受限
会话误当完整账号。普通 API 的认证函数继续只接受 active+full。

`POST /v1/auth/google/login/start` 接受 strict 空 body 并以原生顶层 302 启动 `kind=login` flow；callback
只为 Supabase 返回的既有 user ID 且已登记 `google` method 创建相应 access session。未知 profile、
未登记 method、deleting 或 flow kind 不匹配均失败关闭，不能消费邀请、创建 profile 或把 Google 登录
变成无邀请注册入口。

内部 `GET /internal/data-rights/run` 只接受 Vercel `CRON_SECRET` bearer，每次最多领取一个 export 和一个
deletion。响应只含 bounded outcome/count。完整状态机、NDJSON record union 和失败语义见
`account-data-rights.md`。
