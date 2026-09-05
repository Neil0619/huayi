# 语见 Cloud V1 技术方案

## 1. 系统形态

Cloud V1 继续使用 pnpm、严格 TypeScript、ESM、Vite 和 Zod，并新增 React/Hono/Supabase。运行时
依赖方向固定为：

```text
apps/web ───────────────┐
apps/store-extension ───┼──> packages/cloud-contracts ──> packages/learning-domain
apps/api ────────────────┘                                      ^
apps/store-extension ────────> packages/store-domain ───────────┘

apps/api ──> Supabase Auth/Postgres
apps/api ──> DeepSeek
apps/store-extension ──> BYOK Provider / Eudic / Shanbay page
```

- `packages/learning-domain`：平台无关的领域实体、规范化、候选确认、排期和配额计算。不得依赖 DOM、
  Chrome、Node、HTTP、数据库或供应商 SDK。
- `packages/cloud-contracts`：`/v1` 请求、响应、SSE 事件和错误 envelope 的严格 Zod 契约，只依赖
  `learning-domain` 与 Zod。
- `packages/store-domain`：保留 Store 客户端消息和兼容表面；仍成立的分析结果与规范化纯规则已下沉到
  `learning-domain`，Store 只通过后者的公开入口适配，Cloud 契约不得反向依赖它。
- `apps/api`：Hono 组合根，拥有认证、授权、用例、事务、模型调用、日志和外部 adapter。
- `apps/web`：React + Vite 客户端，只经 `/v1` 使用业务数据；不直接调用 Supabase 表或 DeepSeek。
- `apps/store-extension`：继续是独立 MV3 客户端；Content Script 不持有 token、密钥或任意 endpoint，
  只有 Service Worker 可以调用 Huayi API、Provider 和 Eudic。

`packages/protocol`、Classic Extension 和 Native Host 不依赖任何 Cloud 包，也不因 Cloud V1 改 wire v7。

API 生产数据访问使用 `postgres`，以单个事务表达受控角色切换、RLS、advisory lock 和
SECURITY DEFINER 函数；禁用 prepared statements 以兼容 Supabase transaction pooler。
`@supabase/supabase-js` 只封装 Auth PKCE/密码流程，不承担业务表访问。默认离线数据库门禁使用测试
依赖 PGlite 执行真实迁移与 PostgreSQL 方言，但真实多连接竞争和托管环境仍需独立验证。
Hosted Data API 保持关闭；数据库 migration 仍必须把 `public` schema 的既有函数和 owner=`postgres` 的
后续函数默认 ACL 收敛为显式授权：PUBLIC、`anon`、`authenticated`、`service_role` 不自动取得
`EXECUTE`，Huayi runtime 只通过逐函数最窄 direct grant 调用。per-schema default revoke 不能替代 global
PUBLIC revoke；完整 Phase 91 契约见 `public-function-acl-hardening.md`。

`AnalysisDatabase` 在交给 `postgres` 驱动前只识别 SQL 中显式 `$N::jsonb` 参数，并把既有 JSON 字符串
解析一次；这是 driver adapter 的私有规范化，不改变 repository 接口。事务内 `tenant` 每次查询恢复
`huayi_business`，`trusted` 每次查询恢复 `huayi_context_setter`，测试 adapter 必须同样恢复角色。业务表
与幂等响应由 tenant 写；练习额度终态由 tenant 先锁定生成任务，再在同一事务调用窄
`settle_practice_generation_quota` 写账本和预留，避免把任一角色扩成跨边界表管理员。

## 2. 深模块与 seam

API 对调用者暴露少量用例模块，数据库、模型、邮件和时钟 adapter 只作为内部 seam：

```ts
interface WebAnalysisModule {
  startDeepAnalysis(command: StartDeepAnalysis): AsyncIterable<AnalysisEvent>;
  processAnalysis(command: ProcessAnalysis): Promise<AnalysisRecord>;
}

interface ExtensionQueryModule {
  run(command: ExtensionQuery): AsyncIterable<ExtensionQueryEvent>;
  status(query: ExtensionQueryStatusQuery): Promise<ExtensionQueryStatus>;
}

interface StudyCaptureModule {
  list(query: StudyCaptureQuery): Promise<StudyCapturePage>;
  get(id: string): Promise<StudyCaptureDetail | null>;
  execute(command: StudyCaptureCommand): Promise<StudyCaptureResult>;
}

interface LearningLibraryModule {
  confirmCandidates(command: ConfirmCandidates): Promise<ConfirmationResult>;
  saveManualItem(command: SaveManualItem): Promise<LearningItem>;
  mergeItems(command: MergeItems): Promise<LearningItem>;
}

interface PracticeModule {
  getDailyQueue(query: DailyQueueQuery): Promise<DailyQueue>;
  startSession(command: StartPractice): Promise<PracticeSession>;
  submitTurn(command: SubmitPracticeTurn): Promise<PracticeSession>;
  rateSession(command: RatePracticeSession): Promise<PracticeSession>;
}
```

这些是行为接口，不直接暴露表、SQL、Supabase client、DeepSeek 请求或内部 repository。生产 adapter
分别使用 Postgres、DeepSeek、邮件提供商和系统时钟；测试使用事务数据库、fake model、fake mail 和
fake clock。客户端通过 HTTP adapter 访问同一用例，不复制领域规则。

## 3. 认证与授权

### Web

1. 邀请领取端点在事务内校验 hash、过期时间、未撤销和未消费，并原子创建 15 分钟 claim ticket；
   邀请不绑定邮箱，同一时间只能有一个有效 claim。
2. Google OAuth 或已验证邮箱密码由 Supabase Auth 完成身份验证。Google 与密码确认使用不同的固定 API
   callback；API 把路由确定的 `password|google` 显式传给幂等 finalization 事务，写入 user profile、仅
   登记本次实际 method 并消费 invitation。既有 profile 不能借邀请登录或补 method。跨系统失败时保留
   ticket 供重试，禁止签发业务 session；finalization 已提交而后续 session 创建失败时，账号保持已注册，
   由普通登录重建 session，不重放单次邮箱确认。
3. 失去有效 ticket 且没有 user profile 的孤立 Auth identity 保持不可登录，并由一小时清理任务删除。
4. API 验证 Supabase 身份、profile 和 Huayi-owned `account_sign_in_methods` 后才签发自己的 Web session；
   Supabase 同邮箱 auto-link 不自动取得 Huayi 授权。refresh token 只保存在加密服务端会话记录，浏览器只
   得到 `HttpOnly; Secure; SameSite=Lax; Path=/` Cookie。Provider 返回的规范邮箱只经
   `refresh_profile_email` 窄 SECURITY DEFINER 函数刷新；context-setter 不直接更新 forced-RLS profile，
   刷新失败时整个 Web-session 事务失败关闭。
5. 密码近期重认证由 Web-session 深模块分两步封装：prepare 校验 Cookie/Origin/CSRF、active/full、
   password method 并读取服务端规范邮箱；Provider password sign-in 成功且 user ID 相同后，complete 经
   `rotate_password_reauthenticated_session` 锁定旧 session，在一个事务写入新 encrypted refresh、session
   ID/CSRF/`reauthenticated_at` 并撤销旧 session。错误/并发重放不改变旧 session。
6. Google 近期重认证以 `auth_flows.kind=reauthenticate-google` 绑定 owner 与发起 session hash；path-scoped
   HttpOnly SameSite=Strict intent Cookie 只允许固定 continue GET 单次启动 OAuth。callback 在同一事务锁定
   flow/session/profile，匹配 purpose、session 与 provider user 后才消费 flow并轮换 session；错 user 只
   终结 flow，不改变旧 session。
7. `web_sessions.reauthenticated_method` 是绑定授权 provenance：普通登录/邀请写 null，password/Google
   recent-auth 原子轮换分别写对应 method。link 不只检查 15 分钟时间窗，还必须匹配规定的前置 method；
   因此刚完成的普通登录不能直接升级为身份绑定权限。
8. Google manual link 由三操作的深模块封装 Provider 与 repository adapter：先领取 30 秒、单 session
   refresh-generation lease，再持久化 refreshed encrypted token/state，随后才调用 manual `linkIdentity`
   并在 302 前保存更新的 PKCE state；callback 才原子写 method、轮换当前 session并撤销其他 sessions。
   任何重试都从数据库 stage 恢复，HTTP 不感知租约/阶段，也不猜测外部调用是否成功。
9. Password manual link 使用对称但独立的四阶段深模块：Google provenance 后先 refresh 并持久化新
   encrypted token/state，再从该 state 调 `updateUser({password})`，最后事务写 password method/轮换当前
   session/撤销其他 sessions。明文密码只穿过 HTTP→AuthProvider 调用，不进入 repository、flow 或日志；
   provider 成功后的重试不再消费 refresh generation。
10. Google authentication 是 deployment capability，不由 origin 或 Supabase Dashboard 状态推断。API
    composition 缺 `HUAYI_GOOGLE_AUTHENTICATION=enabled` 时不挂载全部 Google 子应用；Web composition
    缺 `VITE_GOOGLE_AUTHENTICATION=enabled` 时不渲染注册、登录、link 或 Google reauth 动作。离线 E2E
    由专用构建显式启用，两端生产部署必须同批配置并验证。
11. PasswordRecovery 使用独立深模块、独立表与 purpose-scoped HttpOnly Cookie：公开 start 统一 202，
    只有 active+password method 才入队；trusted worker 在外部调用前耐久标记 dispatch 后请求 Supabase
    恢复邮件，公开请求不等待 Provider。邮件用 `RedirectTo + TokenHash` 进入惰性确认页，显式 POST 后由
    `verifyOtp(type=recovery)` 建立一次改密 session，complete 成功撤销全部 Huayi
    sessions并要求重登，不能派生 full/data-rights session或新增 method。独立三操作 Provider port、共享
    逐请求 Supabase Auth storage 与 adapter 已在 R1 实现；深模块、内存与 Postgres/forced-RLS 状态机已
    在 R2 建立；R3-A production HTTP/dispatch、R3-B notification outbox lease/retry、R3-C Resend
    sender/23 小时幂等窗口/8 次上限/独立 CRON/无正文告警 port 与 R4 Web/actual bundle 已离线实现。
    hosted acceptance 的真实 DNS/verified sender、分离 SMTP/HTTP key、Supabase Custom SMTP 与 API R3-C
    通知变量子集已完成；真实 Resend 投递/监控目的地、完整应用/邮件部署与双平台 Chrome 仍待 R5 目标验证。
    详见 `password-recovery.md`。
12. 非安全方法必须同时校验 Origin 和双提交 CSRF token。登录、邀请、近期重认证和密码恢复另加 IP/账号
    速率限制。
13. 所有业务查询从服务端 session 取得 `userId`；请求体中的 owner、role 或 quota 字段一律拒绝。

### Extension

1. Extension 生成 PKCE verifier/challenge 与随机 state，经固定 Web origin 打开配对页。
2. 已登录用户显式批准后，API 创建单次、10 分钟有效的授权码并绑定 extension install ID、challenge
   和请求账号；批准事务同时校验/更新三项账号插件偏好，轮询只返回稳定 pending/approved/expired 状态。
3. Service Worker 使用 verifier 换取随机 extension session；服务端只保存 token hash、设备标签、
   创建/最近使用/过期/撤销时间。exchange 同时返回三项偏好和 revision，后续由 Extension-only GET
   同步。
4. token 以 DeviceVault 加密保存在 `chrome.storage.local`，只允许 Service Worker 读取。Content
   Script 到 Worker 的消息不能携带 token、userId、URL、Header、模型 endpoint 或任意请求体。
5. extension session 使用 90 天滑动过期；账号停用、密码安全事件或 Web 设备页撤销使服务器 session
   立即失效。Extension DeviceDisconnect 以当前 token 调用 singular self-revoke，服务器统一 204 后才清
   本机会话和账号绑定队列；网络失败保留撤销能力。Web 退出只撤销当前 Web session，不暗中撤销其他
   设备。完整顺序见 `extension-session-disconnect.md` 与 ADR-0022。

## 4. 查询、采集与分析调用链

### WebDeepAnalysis

1. Web manual 或 StudyCapture analyze 请求只接受 phrase/sentence/passage、原文、可选标题/用户上下文；
   不接受 action、word、owner、Provider、model 或 quota。
2. API 按 owner、幂等键和 request hash 原子领取 generation，计算最坏成本并创建 QuotaReservation；
   Provider dispatch 前持久化，dispatch 后遵守 ADR-0018，不透明重领。
3. 服务端为 phrase 固定 `analysisUnitId=u1`，为 sentence/passage 确定性分句并分配稳定 `u1...un`，把
   用户内容作为带边界数据传给固定 prompt。模型没有工具、网络、URL 或动态指令能力。
4. DeepSeek adapter 固定模型/JSON Output/超时；严格 V2 结果按 phrase 或 sentence/passage 解析，只允许
   Expression/SentencePattern candidates。结构失败至多一次仅修结构调用。
5. API 发送 started/preview/completed/failed SSE。preview 只显示；成功事务写 AnalysisRecord、候选、
   StudyCapture 状态/关系和 UsageLedger。首次生成失败 fencing 后恢复 pending；reanalysis 失败保留
   analyzed 与此前 latest。
6. Web 用 generation guard 与 AbortController 抑制迟到事件；客户端取消只停止本页等待。只有服务器
   completed 才进入 ReviewInbox。reanalysis 使用新 key 并追加记录。

### Extension 平台查询

1. Store `ExtensionQueryRouter` 在开始时固定缓存的 account mode。platform 只经固定 API origin，BYOK
   只经本机 BrowserAnalysisEngine；任何错误都不跨模式 fallback。
2. platform request 对 word/phrase 只含选区和一条 sentenceContext，对 sentence/passage 只含精确选区；
   不含 URL、标题、视频 ID、相邻段落或 Provider 参数。
3. API 在 Provider 前建立临时 `extension_query_generations`、quota reservation 和 durable dispatch mark；
   返回与本机 engine 相同的 compact event/result interface。
4. 完成后正文/结果最多保留一小时用于同 key replay 与 CardSession/SW 恢复；清理后只留无正文
   UsageLedger。它不写 AnalysisRecord、Candidate 或 ReviewInbox。
5. 关闭 Card 只停止等待，不伪称取消已 dispatch 的平台调用。运行中设置变化不改变已固定 mode。
6. 已关联 Store 在每次新查询/采集/生词复制前尝试有界读取最新偏好；API 可达则必须使用最新 revision，
   不可达时只用有效 session 绑定缓存。缓存 BYOK 可离线继续，缓存 platform 失败关闭，且同步错误不
   触发 fallback。
7. 独立 `ExtensionQueryMaintenance` 由 CRON_SECRET 路由触发；跨 owner SQL 使用 security-definer、
   `FOR UPDATE SKIP LOCKED` 与 100 条上限。它先按 durable dispatch mark 选择释放或保守结算，再删除到期
   terminal；业务 API 不拥有跨 owner delete seam。

### Extension BYOK 与云端数据动作

- 未登录或账号 mode=byok 时，Service Worker 调用本机 OpenAI/DeepSeek 并严格校验 compact result；
  结果永不上传 Huayi，也不因已登录而进入分析历史。
- StudyCapture 和 CloudWordCopy 是与模型路由独立的数据动作。前者提交原始 phrase/sentence/passage，
  后者只提交规范词头/完整句/语境义/收藏时间；二者都不携带 compact result 或 Provider 元数据。
- `SubmissionOutbox` 仅由 Service Worker 组合，strict union 为 study-capture/cloud-word-copy；使用独立
  DeviceVault AAD/envelope、最多 20 条/5 MiB/7 天、稳定幂等键和 alarm retry。网络、API 或版本阻塞保留
  密文；撤回同意、session 失效、本机断开、换号或二次确认清空才删除账号绑定队列。
- production API adapter 缺失是构建能力阻塞，不是授权终态：有效 session/同意下 `process/status` 返回
  带 count/oldest 的稳定 `not-configured`，不 fetch、不安排 alarm；`enqueue` 不清既有队列。Popup 禁用
  retry 但保留二次确认 clear。授权撤回与 session/account 边界继续优先执行原有清除规则。
- current-card undo 可按稳定本机 queue ID 删除单项；若升级阻塞队列仍有其他 item，版本阻塞随剩余队列
  保留，只有版本变化或队列清空才能解除，不能由单项删除触发同版本重新探测。
- Popup 通过无参数命令读取聚合状态、重试或清空；Options/Content/Overlay 不获得正文、token、队列或
  endpoint。旧 analysis-import envelope 在未发布开发升级中清除，不能再提交为 AnalysisRecord。

## 5. 数据与事务原则

- Postgres 是账号云端数据的 CloudAuthority；每个插件的 LocalLexiconEntry 另有独立本机权威，不是云端
  缓存。所有云端用户内容行都有 `owner_user_id`、`revision`、`created_at`、
  `updated_at`；服务端创建 ID 和时间。
- 用户级列表使用 `(created_at, id)` 或对应排序字段的稳定游标，不使用 offset 作为公开分页契约。
- 所有写请求带 `Idempotency-Key`。服务端按 `(owner_user_id, operation, key)` 保存请求 hash 和结果；
  相同 key/相同 payload 返回原结果，不同 payload 返回冲突。
- 编辑/归档/恢复/删除使用 expected revision 或 `If-Match`；过期 revision 返回 `revision_conflict`。
- AccountPreferences 把 timezone/dailyGoal 与三项插件偏好放在同一 owner revision 下。Web PATCH、首次
  pairing approve 和 Extension projection 复用同一深模块；插件缓存与 session 绑定，不能成为第二权威。
- StudyCapture 用 `(owner,kind,normalized_sha256)` 唯一键收敛，命中后比较规范全文防止 hash collision。
  同幂等 key 重放不增加计数；新的 occurrence key 才原子推进 lastCapturedAt/captureCount/revision。
  AnalysisRecord 只保存可空 `study_capture_id`；最新关联按 `(created_at,id)` 服务器投影，不维护循环
  `latest_analysis_id`。首次分析失败恢复 pending；reanalysis 期间仍为 analyzed，失败保留旧 latest，
  成功才追加记录并与关系/状态同事务落地。
- Candidate 是 AnalysisRecord 的不可变产物。WebDeepAnalysis 只产生 Expression/SentencePattern；候选
  确认在一个事务中校验 analysis revision，创建或合并 LearningItem 并复制 SourceExample，随后把
  AnalysisRecord 置为 reviewed。WordEntry 由手动录入、CloudWordCopy、本机批量导入或外部词典导入
  维护。API 预分配全部资源 ID，来源正文、译文、类型
  和标题只从可信分析句子复制。create 遇到精确规范键重复即冲突；merge 必须是同 owner/type/key，
  只追加来源、标签和系统属性并递增目标 revision，不覆盖用户已有核心字段。
- 分析历史使用签名、版本化的不透明 cursor 和 `(created_at,id)` 降序 keyset 分页；默认排除归档，
  字面 query 对 `%`、`_`、`\\` 转义。详情与候选在同一租户事务快照内读取，避免分页 N+1/混合版本。
- Web `/history` 通过一个窄 history API seam 消费现有服务器权威；list、detail 与 mutation 各自使用
  generation guard 丢弃迟到响应。维护先接受严格 mutation response，再重读列表/详情；重读失败不会
  否认已提交写入。页面只以 React 文本节点结构化投影结果，不解析或插入 HTML。
- 学习库只读深模块拥有独立的签名版本化 cursor，并把类型、规范化标签、系统属性、字面正文与
  due/new 条件全部传入 Postgres adapter。adapter 在一个 tenant transaction/RLS 快照中联结
  LearningItem、ScheduleState、来源/标签和最近已完成练习摘要；服务器时钟决定 due，Web 不做过滤、
  排期判断或本地权威缓存。跨租户详情与不存在 ID 都映射为相同 404。
- 学习库 create 深模块把 strict 规范键、幂等 hash 和规范化标签交给一个 Postgres transaction；它先按
  `(owner,learning.create,key)` 重放/冲突，再检查精确重复，最后原子创建 item、新项排期、标签 join
  和严格响应。并发标签通过 owner/normalized 唯一键复用。
- 学习库 maintenance 深模块封装 patch/delete/suggestion/merge preview+confirm。Postgres adapter 先按
  `(owner,operation,key,hash)` 重放，再锁定 current item/revisions；patch 重新计算 canonical 并由唯一键
  裁决精确重复。delete/merge 禁止触及已被 practice 引用的 source；merge 还要求 source level -1，保留
  target schedule，去重追加来源/标签/系统属性后删除 source。删除后的重放只解析幂等响应快照。
- duplicate model 只能从服务端给出的 owner-scoped 同类型候选返回 alias/reason/confidence；深模块再次按
  候选 Map hydrate，模型不能构造正文或 owner。production 只经独立 paid module 组合固定 DeepSeek
  adapter 与 forced-RLS Postgres authority，拥有 quota reservation、持久 claim/lease、durable dispatch、
  fencing、ledger settlement 与有界恢复。相同 owner/key 先处理 terminal replay/busy/conflict；只有新
  generation 才依次执行精确价格预检、共享 kill/quota 检查、新 reservation 和 dispatch，Provider HTTP
  期间不持数据库事务。
- Analysis model 的 candidate ID 是 private request-local alias；Analysis module 在 strict assembly 后用
  server ID source 统一重键 candidates 和 result 引用，再交给 UUID Postgres authority。模型已产生 usage
  后的 assembly/commit 异常必须把同一 billed calls/usage/cost 传给失败 committer，不能用默认成本覆盖；
  失败结算与 terminal event 仍走原 reservation/lease fencing。
- quota summary 属于 owner-scoped 业务读取，统一在已设置 owner context 的 tenant transaction 中先由
  context-setter 调用校验 owner 的窄 SECURITY DEFINER helper，幂等确保当前 UTC 月 default grant，再由
  `huayi_business` 通过 forced RLS 查询该月 grant、ledger 与 reservation；trusted/context-setter 不获得
  quota 表读取权。这样跨月访问自动续期，价格、kill switch 或 reserve 失败后的 terminalization 仍能
  生成严格额度摘要，不会回退到历史月或因第二次权限错误留下永久 `running` 请求。
- 主动练习深模块把队列选择、PracticeAttempt、反馈租约和排期推进隐藏在 Postgres repository 后。队列
  用服务器时钟与账号 timezone 计算本地日边界，due 项按 created/id 稳定优先，再用 level -1 新项补
  dailyGoal；浏览器不提交日期。响应同时携带匹配的 current session/item，使 active、awaiting-feedback
  与 completed-but-unrated 都能刷新恢复。
  答案事务先落库再调用模型；initial/retry 共用 attempt lease，completion/failure 均以 token fencing。
  Web 只投影严格 session，不在本地推进 ScheduleState。production 只经 PaidPracticeGenerator 组合固定
  DeepSeek adapter、Postgres task authority 与共享额度，不保留绕过 task 的 model seam。
- 对话练习由独立深模块编排 start/user turn/assistant retry/final feedback：所有生成 seam 先取得 Postgres
  claim/lease，模型调用不持有事务，完成写入以 lease token fencing。公共 PracticeSession 承载有序 turns、
  DialoguePlan、pendingGeneration 与逐项 DialogueItemFeedback；排期仍只有 Postgres rating transaction
  能一次覆盖全部 session items 并原子推进。
- start reservation 可通过 Daily Queue 恢复；生成完成前投影省略 prompt/plan，活跃 lease 只显示处理中，
  过期 lease 才允许同一有序 item 集合接管。Web 请求异常后重读服务器权威，只在服务器已保存同一
  user turn 时清空草稿。
- Phase 23 在领域 claim 外增加 `PaidPracticeGenerator` 深模块。原有 Practice repository 必须在同一
  tenant transaction 中创建或接管 `practice_generation_tasks`，再把 task ID 与 fencing token 交给生成
  模块；生成模块隐藏价格快照、额度预留、durable dispatch、最多一次结构修复、结算和 ready output
  replay。Provider HTTP 期间不持数据库事务，也不能直接修改 PracticeSession。
- `claimed|reserved` task 尚无 Provider 副作用，租约过期可安全接管；`dispatched` 已可能计费，租约过期
  只能保守结算并标记 abandoned，绝不透明发起第二次调用；`ready` 则零调用重放严格输出。领域事务应用
  ready output 后把 task 置 applied 并清除临时 output。完整状态机见 `paid-practice-generation.md`。
- 练习历史深模块拥有独立 HMAC 上下文的版本化 cursor；Postgres adapter 在 owner tenant/RLS transaction
  内完成 status/type 过滤、summary 聚合和完整 session 投影。未完成会话以 null completion boundary
  稳定分页，最终反馈首次完成时固定 `completed_at`，评分不会改写它。
- 单次练习删除先重放/锁定 `(owner,practice.delete,key,hash)`，再锁 session/revision 并确认 completed 且
  不存在 generation/feedback lease。删除后只从严格 snapshot 重放；session FK 级联不触及 LearningItem、
  ScheduleState 或 SourceExample，历史删除不会倒推排期。
- process-nothing-to-save、归档、恢复和删除由 Postgres 原子校验 owner、operation/key/hash 与 revision，
  存储严格响应后再提交。删除分析只级联未确认候选；已复制 SourceExample 保留并解除分析引用。
- 候选确认也在同一租户事务中先原子锁定 `(owner,analysis.confirm,key)`，相同请求优先重放；然后锁定
  分析、候选和 merge 目标，完成整个混合批次后才保存严格响应。任一类型、归属、revision 或目标校验
  失败都会回滚词条、学习项、标签、来源和 reviewed 状态。
- 删除 AnalysisRecord 不级联删除已复制的 SourceExample；未进入练习的 LearningItem 可硬删除并级联
  ScheduleState、SourceExample 与项目关联，不删除来源 AnalysisRecord 或规范化 Tag。已练习项目必须
  先归档，再由 LearningItemErasure 清内容而非级联 PracticeSession。
- LearningItemArchive 使用同一学习库深模块的 owner transaction 与行锁：archive/restore 只更新
  archivedAt/revision/time，保留 ScheduleState 和 practice FK；list/queue/session-create 分别在服务器过滤
  或重验 active。既有 session 可完成，归档后新 session 不得创建；恢复不重置排期。
- LearningItemErasure 在同一深模块锁 item 与引用 session：只有安全终态引用才把 live row 转成不含
  type/canonical/content/metadata/schedule 的最小 tombstone。公共练习历史从关联行投影
  `learningItemDeletedAt`，账号导出不把墓碑当 LearningItem；最后一条 session 删除时同步清理无引用墓碑。
- 账号删除先撤销全部 session 和权限，再启动可重试删除任务；主库 24 小时内硬删除。备份残留按照
  上线时确认的 Supabase 实际策略披露，文档不得承诺未经验证的期限。
- AccountDataExport 与 AccountDeletionJob 由同一个数据权利深模块编排，Hono/Web 不拥有工作流状态。
  export job 是 owner-RLS 账号数据，worker 从同一账号 snapshot 构造 strict NDJSON 后写 Supabase private
  Storage；download URL 最长 15 分钟且不越过 24 小时 object expiry。deletion job 独立于 user_profiles，
  通过 lease fencing 依次删除 export object、主库账号/直接运营 UUID 与 Supabase Auth；任务完成后清除
  subject UUID。service-role 只位于 Storage/Auth adapter，不得用于普通业务表读取。详见
  `account-data-rights.md` 与 ADR-0016。
- disabled 账号重新通过 Supabase 身份后只得到 `access_scope=data-rights` 的受限 Web session；普通
  authenticate seam 仍要求 active+full，数据权利 seam 单独接受 active+full 或 disabled+data-rights。
  deleting 不创建会话。这避免用“停用”绕过导出/删除权，也不开放 disabled 账号的正文功能。
- 普通 Google 登录使用独立 `auth_flows.kind=login`；它复用 Supabase OAuth/PKCE adapter，但 callback 只为
  已有 profile 且已登记 `google` method 的账号建 session，不进入邀请 bind/finalize，也不创建/绑定
  method。Google-only 账号因此可以重新认证行使数据权利，而邀请门槛保持不变；密码登录对已登记
  `password` 执行同一 fence。

详细表结构见 `data-model.md`，HTTP/SSE 契约见 `api.md`。

## 6. 额度与成本

- 金额统一存整数 `micro_usd`；模型价格表保存 `provider/model/input/output/cache` 单价、货币和
  `effective_from`，历史 UsageLedger 永远引用当时快照。
- DeepSeek V4 Flash 先按 peak 价格保守 reservation，再由 `DeepSeekPriceSchedule` 在 durable dispatch
  transition 的服务端 UTC 时刻选择 legacy/off-peak/peak 不可变快照；Provider 费用计算与 terminal
  settlement 共享该快照，跨峰谷边界不重新路由。详见 `deepseek-v4-billing.md`。
- 默认 grant 为每 UTC 月 1_000_000 micro-USD。后台覆盖额度产生新 QuotaGrant 和审计记录，不修改
  已结算账本。
- 邀请注册在 profile 与 sign-in method 的同一事务中建立当前 UTC 月默认 grant；注册重放不重复，已有
  当前月 admin grant 不被覆盖。既有账号通过 forward-only migration 幂等回填，不能要求清库换取一致性；
  后续月份的自动续期仍须由独立额度生命周期纵切冻结，不能把首次注册 grant 冒充永久续期。
- 同一账号只允许一个 active model generation；此外默认 60 次/小时、300 次/日。额度和频率分别
  判断并返回不同错误码。
- 练习 PlatformGeneration 的 task ID 同时作为 quota reservation request ID；它与 AnalysisGeneration
  共用每账号唯一 active reservation。`claimed|reserved` 可安全接管，`dispatched` 丢失只能保守结算并
  abandoned，`ready` 只重放而不重新计费；UsageLedger 以五类固定 practice feature 区分用途。
- 语义重复建议额度不足固定返回 429 `quota_exhausted`，不调用 Provider、不返回 `exactOnly`、不自动切换
  模型；确定性精确重复仍由 create/confirm 的 canonical 规则独立执行，所以用户可继续编辑或保存其他
  非重复内容。Web 对 quota/busy/provider/schema 失败不自动重试，每次用户再次点击才创建新 key；项目或
  revision 变化会让旧 suggestion/response generation 失效。练习生成和反馈额度不足时保留当前答案草稿
  并给出可恢复错误。
- API 提供全局模型 kill switch 和单账号停用；两者不能阻止数据导出、删除或登出。
- production 的 Web 分析、Extension 平台查询、练习和语义重复建议共用同一个 Postgres reservation
  入口；入口在 owner advisory lock 内先处理 active request replay，再检查 quota，并以持久事件共享滚动
  60 次/小时、300 次/24 小时限速。BYOK 与纯数据动作不经过该入口。
- 管理端由单一 `AdminOperationsModule` 隐藏 operator/recent-auth、资源专用签名 cursor、幂等事务、严格
  账号状态机、审计和 kill switch；Web/Hono 不直接组合表。管理查询使用 Postgres 白名单投影，不能用
  Supabase service role 枚举用户或读取学习正文。详见 `admin-operations.md`。
- 空环境的首位 Operator 不进入 `AdminOperationsModule` 或公开 Hono。独立
  `FirstOperatorBootstrap` 部署深模块只暴露 issue/replace-unclaimed/complete：CLI 持有项目管理员连接并
  生成 token，私有数据库函数持有 advisory lock、空状态 guard 和精确账号推导。complete 不接受
  userId/email，只能晋升 current BootstrapInvitation 正常 finalization 的唯一账号；完成后没有复用入口。
  详见 `first-operator-bootstrap.md` 与 ADR-0023。
- `GET /v1/quota` 复用平台生成的 `AnalysisQuota.summary(userId)` 深模块：Hono 只从 Web Cookie session
  取得 userId，production adapter 从 current grant、append-only ledger 与 active reservation 计算一次
  strict server projection。Hono 与 Web HTTP adapter 都再次 strict parse，客户端不提交时间或 owner。
  `/settings/account` 同时通过窄 `GET/PATCH /v1/account/preferences` 投影 timezone、dailyGoal、三项插件
  偏好、revision 与 updatedAt；Postgres adapter 在 owner forced-RLS transaction 内读写，mutation 使用
  Web Cookie + Origin + CSRF + Idempotency-Key + If-Match。只读 `AccountProfileModule.read(owner)` 在一个
  repeatable-read snapshot 中聚合规范 email、同一完整偏好结构和有效 Extension session，再附加已校验
  的公开最低插件版本；HTTP/Web 不直接拼表。配对/本机 consent 不是账号字段，quota 保持独立模块。

## 7. 外部词典桥接

- 详细状态机、接口、数据结构和验收见 `external-wordbooks.md`。云端 `ExternalWordbookJob` 是任务权威；
  production Store 不再以本地 `BrowserWordbookExportEngine` 作为正式任务 repository，也不把旧本地
  outbox 伪装成云任务上传。
- 上述“云任务权威”不替代当前安装的 LocalLexiconEntry 或本机欧路导入/欧路导出/扇贝导出。Options
  通过独立本机与 Web 任务分区组合两套深模块；CloudWordCopy 只把新本机收藏最小单向复制到 WordEntry，
  失败不参与本机保存事务。
- API 的 `ExternalWordbookJobs` 深模块只公开 list/get/create/lease/submit/retry/cancel；Postgres adapter
  隐藏 owner transaction、签名游标、唯一任务、状态机、nonce 幂等 lease、signed-token fencing、item
  聚合和 Eudic WordEntry/context 原子 upsert。第三方 HTTP 始终在 transaction 外。
- Extension 只能用随机 nonce 领取有界批次；服务器以独立 HMAC 上下文签名 job/kind/nonce/expiry，只保存
  nonce hash 与 expiry。同 nonce 可重放，过期可重领，新 token fencing 旧 worker；回执使用独立幂等键。
- Eudic 凭据和第三方 HTTP 只存在 Extension。API 永不返回凭据、任意 URL、Header 或页面脚本指令。
- Eudic export 在任务创建时快照 headword 与可选最新 sourceText；import lease 领取固定 page，成功页才
  原子 upsert WordEntry/ContextObservation 和 job item。同词合并语境、不覆盖用户编辑；取消后的迟到
  import page 不再创建词条。
- Web 手动单词 upsert 走独立 WordLibrary 深模块接口：Hono 只解析 strict body/header，模块负责规范化、
  服务器 ID/时间、内容 hash 和请求 hash，Postgres adapter 在单一 owner transaction 内执行 idempotency
  claim、唯一键收敛、语境去重、revision 与响应快照。该接口固定 manual 来源，不与未来 EudicImportJob
  的可信 Extension 批处理入口共用可伪造 sourceType 的请求形状。
- 生词库深模块拥有独立 word/context 签名 cursor，上下文还绑定 word ID；Postgres adapter 在 forced-RLS
  tenant transaction 内执行 normalized canonical 字面搜索、稳定分页、详情和 row-lock mutation。PATCH
  只改变 notes；DELETE 在写幂等 snapshot 前检查外部任务引用，避免现有 FK cascade 破坏 receipt 历史。
- Shanbay adapter 只接收云端有界词头批次并在固定页面预填；云 lease token 由 Service Worker 和独立
  DeviceVault 加密 lease vault 持有，Content Script 只获得本机批次/item 别名。Extension 不自动点击
  最终提交，只有用户真实点击且页面明确确认后才能回写 receipt。

## 8. Web 与 UI

- React Router 定义产品页；TanStack Query 管理远端缓存、失效和 mutation，局部表单使用组件状态。
  不建立与服务器并列的全局实体 store。
- SSE 只进入当前分析视图；`analysis.completed` 后才用正式记录替换 preview 并失效 ReviewInbox/历史
  查询。StudyCapture 的 CaptureInbox 是独立资源列表，不把 pending capture 伪装成 AnalysisRecord。
- 所有模型文本按纯文本渲染；不使用 `dangerouslySetInnerHTML`，不解析模型生成 HTML/Markdown 中的
  原始标签，不动态导入模型指定资源。
- Web 与 Store 各自维护 primitive → semantic → component 三层 token registry，不建立跨包运行时样式
  依赖。`moon | silver | champagne | porcelain` 只覆盖 semantic token；组件负责可访问行为，页面不得
  复制颜色和阴影常量，也不得按外观改变 DOM、布局或交互。Web/Store 各自通过独立的当前设备存储键
  保存选择，Store `pearl | parchment` 仍是正交的词卡材质。精确合同见
  `seen-said-ui-design-system.md`。
- Web WorkspaceShell 是登录后页面的 in-process 深 module：discriminated interface 接收 full 会话的
  当前一级区段，或 data-rights-only 受限访问，再接页面 children。implementation 独占品牌顶栏、skip
  link、固定一级 route/order、active 语义和窄屏原生 details；seam 位于 `CloudApp` identity bootstrap 后
  的业务页组合处，每页只返回内容。公共/认证/恢复/配对和独立运营面不经过完整导航；练习历史归入今日
  练习、外部词典归入生词、完整会话账号子页归入设置，受限会话只显示数据权利内容。
- Web 生产入口从严格 `VITE_API_ORIGIN` 创建 HTTP adapter，并通过携带 Cookie 的
  `/v1/auth/csrf` bootstrap 获取每次写入所需 token；缺少部署配置时只显示失败关闭页面，不发业务
  请求。待整理组件依赖窄 `InboxApi`，测试不需要真实网络或伪造登录 token。
- Store Content Script 只能发送无参数的 `store/open-web-workspace` 命令。Service Worker 独占经发布
  配置注入的 HTTPS Web 工作台 URL 并创建标签页；响应也经严格解析。发布 URL 未配置时返回稳定的
  `not-configured`，浮层显示失败，不允许把保留域名、模型正文、analysis ID 或任意 URL 当入口。
- Web 账号 bootstrap 只调用带 Cookie 的 `/v1/auth/csrf` 并严格解析响应；配对审批页面依赖注入的
  identity adapter，不在客户端发明 OAuth 或密码身份权威。Store 的配对 state、PKCE verifier 和
  extension token 由 Service Worker 专用 `ExtensionSessionVault` 使用 DeviceVault DEK 加密；通用
  CredentialSlot、Options 和 Content Script 不持有该能力。Popup/运行时消息只暴露
  connected/pairing/expired/disconnected/not-configured 与有效期。
- Web `/settings/devices` 在 bootstrap 成功后通过同一 identity adapter 读取严格 session 元数据，并
  通过 Origin + CSRF 执行 owner-scoped DELETE。页面不缓存 token，只在确认后更新远端列表视图；
  loading/empty/error/成功态和确认焦点均由局部组件状态管理。
- Web `/settings/account` 在同一登录 bootstrap 后以 Cookie GET 读取 strict QuotaSummary，显示 UTC 周期、
  limit/used/reserved/available/percent/warning；0 grant 是可见空配置而不是客户端默认值。页面明确 BYOK
  不计入并且 exhausted 只影响平台模型，使用局部 loading/error/retry/live 状态且不缓存额度权威。练习
  偏好表单独立读取 strict `{timezone,dailyGoal}`；失败保留草稿，成功只采用服务器响应，新设置由后续
  daily queue 的服务器时钟/时区计算消费，不在浏览器改写现有 session。
- Web `/join#<token>` 从不发送给服务器的 fragment 读取 token，通过 identity adapter 以 JSON body
  领取邀请并使用 `no-referrer`，成功后用 `replaceState` 清除地址栏
  token。claim ticket 仅存在于页面组件状态；密码注册继续走 Cookie 响应，Google 注册用固定 API
  origin 的原生 POST 表单完成真实 302 顶层导航。`/login` 只为已注册密码用户创建 Cookie session；
  客户端不直接组合 Supabase、不伪造 provider 成功，也不把认证材料放入全局实体 store。
- 密码注册的待邮箱确认响应不签发 Web session。邮件只显示六位 OTP，CTA 进入固定 inert
  `/v1/auth/password/confirm?flow=<43-char>`；GET 不访问 Provider/数据库。用户显式 POST
  `/v1/auth/password/callback` 后才执行 `verifyOtp(type=email)` 并以 `password` 完成 invitation。
  `/v1/auth/callback` 只处理 Google code exchange。已绑定但过期的 claim 不能被重新领取清理；原邀请、
  Provider 密码证明与数据库原子恢复函数共同关闭确认后中断状态。

## 9. 部署与可观测性

- 环境生命周期固定为 offline automation → local acceptance → hosted acceptance → production candidate →
  production。hosted acceptance 使用独立 Vercel/Supabase 资源，不能与 production 共用数据库、Auth、
  Storage、OAuth client、Provider Key、额度或调度。
- local acceptance 的 destructive reset 是独立开发运维 composition，不进入 API 请求或生产 migration：
  只有精确本机数据丢失确认才能触发，固定串联 loopback 审计、HTTPS 停机、local migration/虚构 seed、
  bootstrap/build 与 HTTPS 恢复；不能接受远端目标或调用者 SQL。失败保持停机，普通启动不自动修复为
  reset。该 seam 不改变业务表、RLS、Auth 或生产部署契约。
- local acceptance 的 persistence verification 是另一条非破坏性开发运维 composition：服务器内先生成
  覆盖 public/Auth/Storage/migration 的不透明 row digest，完整停启 Supabase 并只做 forward migration，
  第二次指纹完全一致后才恢复 HTTPS。Node 不接收原始行或输出 digest；该 seam 不运行 bootstrap、seed、
  reset、build 或 Provider，也不外推 hosted backup/multi-connection 结论。
- local acceptance 的模型成功路径只在 composition root 将现有 `providerFetch` seam 替换为确定性零网络
  Adapter；WebDeepAnalysis、ExtensionQuery、DuplicateSuggestion 与 Practice 继续通过 production
  quota/dispatch/schema/ledger/repository。Web 构建以持续横幅和正文标记公开模拟性质；production App 和
  普通 Web build 不知道该 Adapter，也不扩大公开 provider 枚举。技术兼容 metadata/ledger 不能作为真实
  DeepSeek 证据。细节见 `local-acceptance-simulated-provider.md`。
- local acceptance bootstrap 同时把共享 `model_kill_switch` 幂等设置为关闭；这只让上述固定零网络
  Adapter 进入 production 状态机，不授权外网 Provider。hosted acceptance 与 production 不继承该
  bootstrap 值，仍由各自 Operator 控制并按部署策略失败关闭。
- local acceptance HTTPS 进程在启动时把 Web bundle 固定为只读内存快照，并只加载一次 API
  composition；磁盘 build 只产生候选，不能改变已运行的 8443/8444。SPA fallback 与静态资源来自同一
  快照，缺入口或非普通文件时失败关闭；显式 HTTPS restart 是 Web/API 唯一同步 cutover seam，且不改变
  Supabase 生命周期。
- hosted acceptance 首选自有根域下的 `app.acceptance.<root-domain>` 与
  `api.acceptance.<root-domain>`：二者同站、不同源，保留 host-only `Secure; SameSite=Lax` Cookie、精确
  CORS/Origin 与 CSRF。域名未就绪时才使用一个 Vercel `*.vercel.app` 同源 gateway 代理 Web/API；不把
  Cookie 改为 `SameSite=None` 或依赖第三方 Cookie。两个 profile 都不得改变 production origin 契约；
  完整方案见 `user-acceptance-environment.md`。
- `apps/web` 和 `apps/api` 各有独立 Vercel 配置、环境校验和 preview/production 环境；Cloud
  workspace 与 Store Manifest 首个公开版本为 `1.0.0`，不改变 Classic/root 的 `0.13.0`。数据库
  迁移由 CI 的受控生产步骤执行，不在请求启动时自动迁移。
- Vercel 原生 Hono 检测要求认可入口默认导出 app；`apps/api/src/server.ts` 是唯一允许的适配器例外，
  业务模块仍只使用命名导出。
- Vercel Hobby 只承载 Web/API Function，不承载分钟级 Cron。production Supabase 以管理员显式运行的
  operations SQL 安装五个独立 `pg_cron` job，再由私有 `pg_net` adapter 调用既有
  `CRON_SECRET` HTTPS route；local/preview 不自动安装。调度 adapter 不进入 migration，也不改变 worker
  的 lease/fencing/幂等语义。完整方案见 `vercel-hobby-supabase-cron.md`。
- API 项目以 `apps/api/vercel.json` 显式启用 Fluid Compute，并只为唯一 Hono 入口 `src/server.ts`
  配置 120 秒 `maxDuration`。它容纳既有 90 秒应用级 Provider 总预算与终态写入余量，不改变 Provider
  deadline、公开 API、lease 或账本；完整契约见 `vercel-fluid-function-duration.md`。
- API 日志只包含 request ID、route、稳定错误码、时延、模型/价格版本、token 和 micro-USD；正文、
  可选标题、答案、模型响应、凭据、session 和 reasoning 均不得进入日志或错误监控。
- 插件平台模型的私有输出约束由现有结果 Schema 投影，固定当前请求的结果类型和 selectionKind；
  首次请求携带嵌套结构、必填字段、枚举和长度约束，语言及音标组合约束继续显式说明并严格校验。
  结构失败保留有界、脱敏的字段路径和固定原因码，同时交给既有一次修复请求与按生成 UUID 关联的
  服务端诊断。该诊断仅使用 security.md 规定的额外白名单，不持久化模型原文或改变公开错误合同。
- 运营指标只保留无正文聚合：请求成功率、结构修复率、延迟分位、费用、额度拒绝和 session 撤销。
- API 以必填 `HUAYI_STORE_EXTENSION_CAPABILITY=enabled|disabled` 决定是否组合 Store surface；disabled
  从 CORS/专用路由移除 Extension 并在 identity 查询前拒绝 token。enabled 才使用
  `HUAYI_MIN_SUPPORTED_EXTENSION_VERSION` 强制最低版本并以 426 `client_upgrade_required` 让陈旧客户端
  失败关闭，同时用 `HUAYI_STORE_EXTENSION_ID` 把业务 token 请求绑定到固定 Chrome Origin。完整
  `/v1/account` 仍聚合公开最低版本；正式发布时至少兼容当前和上一 Store Cloud 版本的 `/v1` 契约。

## 10. 安全与 Chrome 边界

- 业务 SQL 使用专用 `NO BYPASSRLS` 数据库角色，并在事务内设置由 session 验证得到的账号上下文；
  RLS policy 读取该上下文。Supabase service role 只用于 Auth 管理，不能成为普通业务查询 adapter。
- Service role、DeepSeek 平台密钥和邮件密钥只存在 API 环境；Web 与 Extension 构建必须扫描秘密。
- Manifest 只声明确定的 Huayi API、OpenAI、DeepSeek、Eudic 和既有 Shanbay 页面权限；实现完成后
  重新审计并删除无调用者权限。远程配置只能改变非可执行数据，不能下发代码或脚本。
- 页面输入和模型输出均不可信。所有跨 context 消息、HTTP body、数据库读取和 Provider 输出都执行
  strict schema 校验，未知字段拒绝。
- 新云端披露必须明确 Huayi API 与 DeepSeek 会接收哪些内容、使用目的、费用、保留和删除方式；
  旧 Store 的“开发者不接收”文案不得复用。
