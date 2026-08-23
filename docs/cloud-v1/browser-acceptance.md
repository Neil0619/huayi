# Phase 22 Cloud 离线浏览器联合验收方案

> **Phase 27 校准（2026-08-13）**：本文第 8 节以前保留 Phase 22 当时“完整 BYOK 结果导入
> AnalysisRecord”的历史验收证据，但该产品路径已经被
> [插件查询、学习采集与本机生词方案](./extension-query-and-study-capture.md)取代，不能再作为当前
> 发布验收。Phase 27 必须替换 22B fixture，并重新跑下述“当前联合验收增量”；旧绿灯只证明当时的
> 浏览器组合基础设施可用。

## 当前联合验收增量（Phase 27）

1. `signed-out BYOK → 当前精简 ResultCard`：Huayi authority 收到零请求；本机收藏与本机欧路仍可用；
2. `pairing(platform) → 平台插件查询`：同一 compact UI 成功，但 Web `/history` 和 ReviewInbox 始终为空，
   authority 只投影一小时内可恢复的 ExtensionQueryGeneration 与无正文额度事实；
3. `BYOK 查询 → 手动 StudyCapture`：authority 收到原始 phrase/sentence/passage 和 kind，不收到 BYOK
   结果、Provider、Key、URL、标题、视频 ID 或完整页面；
4. `automatic capture → CaptureInbox → explicit WebDeepAnalysis → ReviewInbox → LearningItem`：自动创建发生
   在 sentence/passage 查询开始时，Web 分析是独立平台调用，且候选只有 Expression/SentencePattern；
5. `created → current-card undo`、exact existing 无 undo、离线 encrypted queue/reconnect、旧 revision 撤销
   失败、关卡后不恢复 undo；
6. `local word → optional CloudWordCopy`：本机保存永远先成功；关闭复制时 authority 零写入；显式批量
   导入有数量预览和二次确认；登录/换号不清本机词库；
7. 两种查询模式在配额耗尽、Key 缺失、网络或 Provider 失败时都不得自动切换。

上述 journey 必须使用更新后的 production bundle、严格公共契约与 owner-scoped fake authority；公开
snapshot 仍不得暴露正文、结果、Key、token、幂等键或原始错误。Phase 27 已完成第 3 项的手动采集、
第 4 项从 CaptureInbox 到 LearningItem 的主链路，以及第 5 项的 created undo、existing 无 undo、离线
恢复与 stale revision；第 2 项的 platform query 成功/额度失败无 fallback 也已完成。旧的
`implemented components; browser rebaseline pending` 总括状态已失效；当前剩余项必须具体写成真实登录、
部署、第三方或目标平台验证，不能再把已通过的离线矩阵列为 pending。第 6 项已完成单条本机生词
local-first、开启复制后
Web 重读、关闭复制时 authority 零写入、离线队列经 production alarm runner 恢复，以及 201 个历史词条
预览/二次确认/100+100+1 三批续传。账号断开 journey 已补强为 self-revoke remote-first：网络失败保留
session/队列，重试成功后服务器设备投影归零、待提交副本被清除、恢复网络时云端零写入，而
LocalLexiconEntry 仍可重读；该补强现已完成。换号 journey 也已经 production CloudSessionManager 完成
disconnect、pairing 与 exchange，旧队列不进入新账号，本机旧词保留，新收藏使用新 session 写入。

Phase 28 另新增实际 `/library` production bundle 旅程：用户显式请求语义建议后，fake Cloud authority
只接受 Cookie/Origin/CSRF/Idempotency-Key 和 source revision；页面先显示 server-reread candidate，预览
阶段 item 数保持 2，只有再次显式确认才删除 source 并把 target revision 推进，随后 production 页面通过
`GET /v1/learning-items/:id` 重读 target。公开 request facts 只保留固定 path/proof；authority snapshot、
localStorage 与 sessionStorage 不含两项正文、prompt version、raw output、reservation 或 task。专项
Playwright 1/1 已通过；它证明离线组合，不冒充真实 DeepSeek、Vercel/Postgres 或双平台 Chrome。

## 1. 问题与目标

Cloud V1 已有严格契约、Postgres/PGlite 集成、React 组件测试、Store Extension 单元测试和 Classic/Store
离线浏览器旅程，但当前 66 条 Playwright 只加载 Extension fixture。它们不能证明 Web 的生产入口、
Cookie/CSRF adapter、浏览器 CORS/preflight、待整理到学习库的页面跳转，以及 Store 终态经
SubmissionOutbox 导入后被 Web 读取的联合行为。

Phase 22 当时建立了一个完全离线的浏览器验收层：构建真实 Web bundle 与 Store Content bundle，用一个严格、
有状态、无正文日志的 fake Cloud authority 接收浏览器请求。它补强跨模块组合证据，但不冒充真实
Supabase、Vercel、DeepSeek、Chrome 扩展进程或生产网络验证。

## 2. 用户旅程与验收范围

### 22A：Web 整理闭环

1. 浏览器加载实际 Web production bundle 的 `/app`；
2. Web 通过固定 HTTPS API origin，以 `credentials: include` 取得 full session + CSRF；
3. 待整理列表和详情读取同一 fake Cloud authority；
4. 用户编辑并确认表达候选，浏览器请求携带 Cookie、Origin、CSRF、Idempotency-Key 与 revision；
5. authority 原子把 AnalysisRecord 置为 reviewed 并创建 LearningItem；
6. Inbox 重新读取后为空，用户通过真实导航进入 `/library`，看到刚创建的学习项和可信来源快照。

### 22B：Store → Cloud → Web

1. 浏览器加载实际 packaged Store Content Script；
2. 用户在普通页面选择英文并点击翻译；
3. harness 只在 Service Worker seam 注入 fake AnalysisEngine、内存 Session/Vault adapter 与固定测试时钟；
4. 实际 `createAnalysisSession` 产生可信 source type，实际 SubmissionOutbox 先耐久 capture，再由 alarm
   runner 用实际 Cloud import adapter 提交；
5. import 使用 `HuayiExtension` session、稳定幂等键且不携带 Web Cookie；DOM 只显示聚合 submitted，
   不显示 token、正文 payload、storage key 或 idempotency key；
6. 同一 Playwright authority 随后被实际 Web `/app` 读取，导入记录处于 pendingReview；由于旧 Store
   结果没有语义候选，Web 只允许诚实地标记“无需收藏”，不得伪造候选。

### 22C：公共与失败关闭

- `/privacy` 在未安装 API route、无 Cookie 时仍由 production bundle 本地渲染，且零 API 请求；
- Web session 缺失时只显示登录入口，不加载学习内容；
- fake authority 对缺 Cookie/Origin/CSRF、错误 revision/幂等键、未知 path 或额外字段失败关闭；
- 浏览器请求或测试输出不得包含 server secret、真实凭据或真实用户数据。

### Phase 19 补充：管理运营台

- actual `/admin` production bundle 必须通过 strict authority 的 access/usage/users/invitations/audit
  adapter 重读四区；Operator 完成筛选、停用、一次性邀请和 kill switch 后刷新服务器状态；
- 一次性邀请 fragment 只在创建响应后的当前组件内存显示，刷新后从 DOM 消失，且不进入 Web Storage
  或公开 snapshot；所有管理 mutation 证明 Cookie/Origin/CSRF/Idempotency-Key；
- 有效 full Cookie 但无 Operator authority 的用户在 access 403 后显示统一拒绝页，不继续读取管理数据；
- 该离线层不冒充真实 Operator 角色、近期认证、部署 Cookie、告警渠道或备份恢复演练。

## 3. 技术路线

### 3.1 Playwright 组合

- 保留现有 `playwright.config.ts` 的 Chrome、单 worker、截图/trace 与 Extension base URL；
- `testDir` 上移到 `apps`，仅匹配 `**/e2e/**/*.spec.ts`，现有 snapshot 命名不改变；
- 现有 `127.0.0.1:4173` Extension/Store fixture Vite server 在启动时额外用固定测试 API origin 构建
  `apps/web/dist`；不新增第二个进程；
- Playwright 将 actual Web dist 以保留域 `https://web.huayi.invalid` 拦截提供，并将 API 固定为同站
  `https://api.huayi.invalid`。HTML/asset/API 都由 `page.route` 本地 fulfill，不做 DNS、TLS 或外部网络
  连接；浏览器仍执行两个 HTTPS origin 之间的 CORS/preflight 和同站 Cookie 规则；
- 不使用 `http://127.0.0.1` Web + HTTPS API 的人工跨站 Cookie 拓扑，避免把第三方 Cookie 策略误测成
  生产 session 行为。

### 3.2 深模块：CloudBrowserAuthority

seam 位于 `apps/web/e2e/support/cloud-browser-authority.ts`，interface 只有：

```ts
interface CloudBrowserAuthority {
  install(page: Page): Promise<void>;
  snapshot(): CloudBrowserAuthoritySnapshot;
}

createCloudBrowserAuthority(seed): CloudBrowserAuthority;
```

implementation 隐藏 preflight/CORS、严格 schema parse、session/CSRF、revision、幂等和状态迁移。测试不
直接改内部数组，不以 mock 调用次数代替用户可见行为。

公开 snapshot 只允许以下聚合证据：

```ts
interface CloudBrowserAuthoritySnapshot {
  analysisCount: number;
  captureCount: number;
  importCount: number;
  itemCount: number;
  practiceProviderCallCount: number;
  requestFacts: Array<{
    authenticatedAs: "extension" | "web" | "none";
    method: string;
    path: string;
    proof: "read" | "write-valid" | "write-invalid";
  }>;
}
```

`practiceProviderCallCount` 只表示离线 fake Provider 的聚合调用次数，用于证明 pending 页面没有自动调用和
额度投影随已完成调用变化；不得返回 operation、task、reservation 或模型输入。其余 snapshot 也不得返回
正文、候选 payload、Cookie、session token、CSRF、幂等键或完整 Header。`importCount` 仅保留用于历史
Phase 22 断言的聚合兼容位，Phase 27 当前路径必须保持为 0。

### 3.3 Store harness seam

`apps/store-extension/e2e/support/cloud-release-harness.ts` 只替换生产中真实不可离线执行的 adapters：

- AnalysisEngine：返回严格本地 fixture，不访问 Provider；
- ExtensionSessionVault：只返回测试 session；
- SubmissionOutboxVault：内存 adapter，验证组合而不重复验证 AES-GCM；
- 时钟/ID：固定值，便于重放断言。

以下必须使用生产实现：packaged Content Script、`createAnalysisSession`、可信 selection request、
StudyCapture privileged handler、SubmissionOutbox 内容转换/上限/幂等队列、Cloud StudyCapture/submission
adapter。harness 不导入完整 production service worker，避免注册真实 Chrome alarm/storage listeners。

## 4. Fake authority 数据与状态机

初始 seed 有两种：

- `candidate-analysis`：一个 strict pending AnalysisRecord，含一个 ExpressionCandidate；
- `empty`：无分析/学习项，等待 Store import。

Phase 23 在同一 authority 增加两种练习 seed：

- `pending-sentence-practice`：一个已经持久化、等待显式重试题目的 sentence session；
- `dialogue-practice`：两个新学习项，等待用户选择后开始三轮受约束对话。

允许的状态迁移：

```text
candidate-analysis
  pendingReview/revision 1
    └─ confirm exact revision + proof ─▶ reviewed/revision 2 + LearningItem(level -1)

empty
  └─ Store import exact Extension proof ─▶ pendingReview/revision 1/candidates=[]
      └─ Web nothing-to-save exact proof ─▶ reviewed/revision 2

pending-sentence-practice
  pending sentence prompt / providerCalls 0
    └─ explicit retry ─▶ active prompt / providerCalls 1
         └─ answer ─▶ completed feedback / providerCalls 2
              └─ rating ─▶ rated schedule

dialogue-practice
  queue with two items / providerCalls 0
    └─ start ─▶ opener / providerCalls 1
         └─ three user turns ─▶ three assistant turns / providerCalls 4
              └─ finish ─▶ summary + two item feedbacks / providerCalls 5
                   └─ all ratings ─▶ both schedules atomically updated
```

LearningItem detail 包含 `ScheduleState(level=-1)`、`recentPractice=null` 和来源快照。所有 response 在返回前
经 `cloud-contracts` public schema parse；unknown route 返回 404 strict ApiError。

幂等仅保存 request hash + response snapshot，不保存 Header/token。相同 key/body 重放相同结果，不同
body 返回 `idempotency_conflict`。本阶段无需 Postgres，因为数据库事务/RLS 已由 API integration 覆盖；
fake authority 只证明浏览器组合和跨页面状态一致。

练习 seed 也不复制 PlatformGeneration/Postgres 租约；它只通过严格公共 request/response、revision、幂等
proof 和聚合 Provider 次数证明浏览器组合。真实 task/quota/ledger/fencing 仍由 Phase 23 unit/PGlite 负责。

## 5. TDD 与测试矩阵

### RED

1. 配置层：Playwright 尚未发现 `apps/web/e2e`，Cloud spec 数量为 0；
2. fixture builder 尚未构建 Web production dist，`/app` 无法加载；
3. CloudBrowserAuthority 模块不存在；
4. Store Cloud fixture 不存在，无法从 packaged Content Script 到 import；
5. runner/config 回归先固定单一 fixture server、route-served Web production build 与现有
   snapshot/baseURL 不漂移。

### GREEN

- `cloud-web-journeys.spec.ts` 覆盖 22A、22B、22C；
- fake authority 通过浏览器 interface 测试严格请求、状态迁移、重放、冲突和脱敏 snapshot；配置发现和
  production fixture build 另由 Node 单元测试锁定；
- Store harness 用浏览器可见结果与 authority snapshot 验证，不读取 DOM 中的秘密；
- 现有 66 条 Extension E2E 全部保持通过，新增 Cloud E2E 计入同一 `pnpm test:e2e`。

### 其他门禁

- Web/Store/store-domain/cloud-contracts typecheck/build；
- 全量 unit/integration、instructions、architecture、受影响 ESLint/Prettier、diff check；
- 不运行真实模型、第三方、安装、生产部署或商店上传。

## 6. 验收标准

- actual Web bundle 和 packaged Store Content Script 都进入浏览器 journey，而非只渲染 React test；
- Web 写请求在真实浏览器层证明 Cookie + Origin + CSRF + Idempotency + revision；
- Store import 在真实浏览器层证明 Extension Authorization、无 Cookie、严格 content 与稳定幂等；
- 同一 authority 中，Store import 可被 Web Inbox 读取，Web confirm 可被学习库读取；
- `/privacy` 零 API，signed-out 不读内容，未知/非法请求失败关闭；
- snapshot/DOM/log 无正文与秘密；现有 Extension E2E、snapshot 和默认 base URL 不回归；
- 文档、实现和项目状态同步，真实部署/Chrome 扩展进程/网络验证仍明确 pending。

## 7. 方案自审

- **合理性**：使用实际 browser fetch 与构建产物可补齐组件测试无法证明的 CORS、Cookie、SPA 和跨端
  组合；复用 production modules，测试 seam 只替换不可离线依赖。
- **不重复数据库测试**：fake authority 不模拟 RLS/SQL/lease；那些仍由 PGlite/API integration 负责。
- **不伪装真实扩展**：普通网页 fixture 无法提供真实 `chrome-extension://` 进程、Manifest host 授权或
  alarm 重启；验收只声称 packaged content + SW 深模块联合，真实 Chrome load-unpacked 仍 pending。
- **主要风险**：上移 testDir 可能改变 snapshot 路径，route fulfill 也可能掩盖静态产物缺失；因此保持
  现有无 project-name 配置、单 worker/base URL，并要求 asset 必须从真实 dist 读取且缺文件直接失败。
- **结论**：路线可以推进。若实现必须放宽 API origin、CORS、schema、Manifest 或生产安全检查才能
  通过，应停止并修改方案，不以测试专用后门进入 production。

### 自审后的路线变更记录

初稿拟启动 `http://127.0.0.1:4174` Web preview。实现前复核发现它与 HTTPS API 属于跨站，会把浏览器
第三方 Cookie 策略引入本应同站的生产 session 验收。现改为 `web.huayi.invalid` / `api.huayi.invalid`
两个同站 HTTPS 保留域并由 Playwright 本地 fulfill；仍覆盖 CORS，且不需要证书、DNS 或第二 server。

## 8. 实现记录

- Playwright 发现范围已上移到 `apps/**/e2e/**/*.spec.ts`，原 66 条 Extension 旅程与 snapshot/base URL
  保持不变；fixture server 在启动时构建实际 Web production bundle。
- `CloudBrowserAuthority` 已隐藏 Cookie/CSRF/CORS/preflight、严格 contract parse、revision、幂等重放/
  冲突和状态迁移；公开 snapshot 只含计数与脱敏请求事实。
- Phase 22 Store fixture 当时使用 packaged Content Script 与生产 AnalysisSession、SubmissionOutbox、
  alarm/import 模块；该 full-result import 路径已被 Phase 27 替换，仅保留为历史证据。
- Phase 22 新增的 4 条 Cloud journey 当时覆盖 Web confirm→learning library、Store import→Web Inbox、
  privacy/signed-out 失败关闭，以及缺 proof、same-key replay、different-body conflict 与 snapshot 脱敏。
- Phase 23 再新增 2 条实际 Web bundle 旅程：pending sentence 在用户点击前保持零 Provider 调用，显式重试
  后完成反馈与自评；两学习项对话完成三轮、逐项反馈与原子自评。两条旅程都从 `/settings/account`
  重读 strict quota 投影，并证明公开 snapshot 不含答案、task 或 reservation。
- Web E2E support 已纳入独立 strict `tsconfig.e2e.json`，不再仅依赖 Playwright 的运行时转译。
- Phase 23 扩展后的完整离线浏览器门禁为 72/72：原 66 条 Extension、Phase 22 的 4 条 Cloud 联合旅程
  和新增 2 条练习旅程共同通过。
- Phase 24 继续复用同一 actual bundle/authority，新增 invitation fragment→claim→原生 Google POST→
  fake Provider→callback Cookie→手动 LearningItem 的新账号旅程；不以密码免验证、预种 Cookie 或组件
  fake 冒充 onboarding。完整状态机、测试和边界见 `web-onboarding-acceptance.md`；加入该旅程后的
  完整离线浏览器门禁为 73/73。
- Phase 25 新增 actual `/analysis`→strict SSE→Inbox→candidate confirm→`/library` 旅程；start 与 confirm
  都必须通过真实浏览器 write proof，preview 不进入 authority，LearningItem 和 SourceExample 由服务器
  list/detail 重读。完整状态机和边界见 `web-analysis-review-acceptance.md`；加入该旅程后的完整离线
  浏览器门禁为 74/74。
- Phase 27 用手动 StudyCapture 主链路替换旧 Store full-result import 旅程：packaged Content Script 选择
  完整句子，经 privileged handler、`study-capture | cloud-word-copy` SubmissionOutbox 和固定 Extension
  proof 创建 Capture；actual Web 再从 CaptureInbox 显式启动 SSE 深度分析、进入 ReviewInbox、确认候选并
  从 Learning Library 重读。旧 `/v1/analyses:import` 请求在当前 journey 中为零，Store E2E support 也已
  加入 strict `tsconfig.e2e.json`。另两条 automatic journey 证明 created-only 当前卡撤销与 exact existing
  不提供撤销；双页面 journey 使用独立稳定幂等命名空间推进 revision，证明旧卡撤销失败关闭；offline
  journey 证明加密队列经 production alarm runner 恢复提交并由 Web 重读。完整离线浏览器门禁为 78/78；
  随后 platform journey 直接使用 production QueryRouter、PlatformAnalysisEngine 和 ExtensionQuery HTTP/
  SSE decoder，证明成功只产生临时 generation 聚合、Web 历史/待收藏/StudyCapture 为空，quota exhausted
  不调用本地 BYOK engine。CloudWordCopy journey 再使用 production lexicon message handler、local-first
  repository、HTTP copy client 与共享 SubmissionOutbox，证明开启时可由 actual Web `/words` 重读、关闭时
  零云写入、离线本机保存不回滚且关卡后仍可由 production alarm runner 恢复。显式历史导入 journey
  进一步使用 production Options controller、加密 import runtime 和 alarm runner，证明 201 个词条（含
  无语境词）在预览/二次确认后按 100+100+1 续传、Web 可重读且本机不删除。完整门禁更新为 84/84；
  随后的账号断开 journey 当前只使用 production account-data clearer；它将按
  `extension-session-disconnect.md` 补上服务器 self-revoke、网络失败零清理与 204 后本机收口，完成前旧
  85/85 证据不能证明服务器设备已撤销。换号
  journey 再用 production CloudSessionManager 完成完整配对交换，证明旧离线队列被清除、本机旧词保留、
  新收藏只使用第二个 session 写入对应 Web authority。LocalEudicImport journey 再用 production
  BrowserWordbookExportEngine 先把一页欧路数据只写本机，authority 保持零写入；用户完成 2 词/1 语境
  预览与二次确认后才经加密 import runtime 创建 Web 副本。Cloud Eudic export/import 与 Shanbay 再以
  actual Web 任务页、strict authority 和 production Store bridge 验证：export 精确回执、import 只写云端、
  Shanbay 只暴露本机别名且必须第二次用户点击确认。随后新增 Eudic 网络失败→Web 稳定错误→显式重试→
  完成、Shanbay 两词精确部分成功，以及 active cancel→当前租约迟到确认→Web 仍重读 cancelled 三条
  旅程。完整门禁更新为 93/93。
- AccountDataRights actual bundle journey 使用独立 strict authority helper，从 empty→pending→服务器重读
  ready→新窗口 signed URL 下载→双重确认永久删除；accepted 后 Cookie 清除、Cloud App 进入 signed-out，
  后续数据 API 返回 401。390px、reduced-motion、无 Web Storage、无横向溢出和 signed token 不进入主
  DOM/公开 snapshot 同时通过；完整离线浏览器门禁更新为 94/94。
- AdminOperations actual bundle 再增加 Operator/非 Operator 两条 journey：前者通过 production
  access/usage/users/invitations/audit adapter 完成筛选、停用、一次性邀请、kill switch 与刷新重读；
  后者所有 StrictMode access 均为 403 且不读取下游管理数据。邀请 token 刷新后从 DOM 消失且不进入
  Web Storage/公开 snapshot；完整离线浏览器门禁更新为 96/96。
- PracticeHistory actual bundle 再从 production `/practice/history` 覆盖 completed dialogue 的筛选、
  结构化详情与焦点、两步删除、有效 revision/幂等写证明和 server reread 空态；返回 `/practice` 后两个
  `DUE` 学习项仍可读取，证明删除历史不删除 LearningItem 或回滚 ScheduleState。390px、
  reduced-motion、Web Storage、公开 snapshot 脱敏同时通过；完整离线浏览器门禁更新为 97/97，专项方案
  与复审见 `practice-history-acceptance.md`。
- AnalysisHistory actual bundle 从 production `/history` 覆盖 linked StudyCapture passage 的筛选、完整
  结构化详情与焦点、revision 1→2→3→4、process/archive/restore 正交状态和默认同时删除 capture；四次
  mutation 都是有效 Web 写，删除后 analysis/capture 同时归零。390px、reduced-motion、Web Storage 与
  公开 snapshot 脱敏通过；完整离线浏览器门禁更新为 98/98，专项方案见
  `analysis-history-acceptance.md`。
- PairingApproval actual bundle 从 production `/pair-extension/:id` 覆盖服务器三项默认值、完整数据披露、
  设备标签、consent gate、revision 3→4 与 Cookie/Origin/CSRF 一次性批准；reload 后只以 GET approved
  恢复，approve 恰好一次且不创建 ExtensionSession。390px、reduced-motion、Web Storage 与 snapshot
  脱敏通过；完整离线浏览器门禁更新为 99/99，专项方案见 `pairing-approval-acceptance.md`。
- PasswordAuthentication actual bundle 从 `/join#token` 覆盖 strict 密码注册 202、零 session、显式 fake
  mailbox confirmation、callback hardened Cookie 与 `/practice`；清 Cookie 后从 `/login` 覆盖统一错误与正确
  密码的新 session。两个密码响应均 private/no-store，390px、reduced-motion、Web Storage 与 snapshot
  脱敏通过；完整离线浏览器门禁更新为 100/100，专项方案见
  `password-authentication-acceptance.md`。
- GoogleAuthentication actual bundle 从 production `/login` 的空原生 POST 进入独立 fake Provider；
  active callback 创建 full Cookie 并进入 `/practice`，disabled 只创建 data-rights Cookie 并进入
  `/settings/data`，未登记 google method 统一失败且零 Cookie。start/callback no-store、callback
  no-referrer、390px、reduced-motion、Web Storage 与公开 snapshot 脱敏同时通过；完整离线浏览器门禁
  更新为 108/108，专项方案见 `google-authentication-acceptance.md`。
- AccountSignInMethods Phase A 在同一 actual `/login` production bundle 增加 provider 凭据正确但 Huayi
  只登记 Google 的失败关闭 seed：响应仍为统一 401、private/no-store、无 Set-Cookie，公开 request facts
  只记录稳定路径/proof。Phase B 再从 production `/settings/account` 增加三条旅程：password-only
  先以当前密码轮换 Cookie/CSRF，再经 Google fake provider callback 绑定；Google-only 先经独立 Google
  reauth callback，再设置新密码、重新 bootstrap CSRF 与 server method list。两条旅程都断言 DOM 零明文
  密码；stale password-link 页面在正确 Google recent-auth 后收到稳定 409，再重读 canonical method list
  并清除密码。完整离线浏览器门禁扩展为 104/104，专项方案见 `account-sign-in-methods.md`。
- Phase 28 SemanticDuplicateSuggestions 从 actual `/library` production bundle 显式点击 suggestion，经过
  strict authority 的 owner-scoped bounded candidate、merge preview 与 confirm，再以 target detail GET
  重读服务器权威。suggestion/preview 前 itemCount 均为 2，confirm 后为 1，证明没有自动 merge；请求
  facts 证明三次 Web write proof 与一次 server read，公开 snapshot/Web Storage 排除正文、prompt、raw
  output、reservation 和 task。专项 Playwright 1/1 通过，完整需求与外部门禁见
  `semantic-duplicate-suggestions.md`。

## 9. 当前生产路由覆盖矩阵（2026-08-14）

以下矩阵只记录实际 Web production bundle 的离线组合证据；组件/API 测试和真实部署验收分别统计，
不得互相替代。

| 生产入口                                 | 当前 actual-bundle 证据                                                    | 状态   |
| ---------------------------------------- | -------------------------------------------------------------------------- | ------ |
| `/app`、`/analysis`、`/library`          | 分析、Capture/Review、确认、学习库、语义建议/预览/显式合并、归档/恢复/抹除 | 已覆盖 |
| `/practice`                              | pending 句子创作与三轮受约束对话、反馈、自评、额度重读                     | 已覆盖 |
| `/practice/history`                      | completed dialogue 详情、两步删除、server reread 与跨资源排期不变量        | 已覆盖 |
| `/words`、`/words/wordbooks`             | 本机复制/批量导入、Eudic/Shanbay 任务及失败恢复                            | 已覆盖 |
| `/settings/account`、`/settings/devices` | 账号偏好/额度、双向登录方式绑定、设备撤销、断开与换号                      | 已覆盖 |
| `/settings/data`、`/admin`               | 导出/删除；Operator 与非 Operator 管理台                                   | 已覆盖 |
| `/privacy`、`/join`                      | 无会话隐私页、邀请领取与 Google onboarding                                 | 已覆盖 |
| `/history`                               | 筛选、完整详情、process/archive/restore/delete 与 linked capture           | 已覆盖 |
| `/pair-extension/:id`                    | 三项偏好、完整披露、consent、一次批准与 GET approved 恢复                  | 已覆盖 |
| 密码注册/登录入口                        | 邀请、202 待确认、callback、错误密码与正确密码新 session                   | 已覆盖 |
| 普通 Google 登录入口                     | 空原生 POST、Provider callback、full/data-rights/零 session                | 已覆盖 |

本轮已补 `/practice/history`，在不新增生产接口的情况下验证一个关键跨资源不变量：删除练习历史只删除
PracticeSession 正文，不删除 LearningItem，也不回滚 ScheduleState。`/history` 也已补齐正交状态维护闭环；
`/pair-extension/:id`、密码认证、普通 Google 登录与 `/library` 语义建议入口也已补齐；当前矩阵已没有只由
组件/adapter 覆盖而缺 actual-bundle production 入口的已知项。真实身份、邮件、DeepSeek、部署与目标
平台证据仍按独立发布门禁处理。

- Phase 22 当时的最终离线证据为 108 个 Node 脚本测试、362 个 Vitest 文件（2,424 passed / 12 skipped）、
  全 workspace typecheck/build、instructions/architecture 与 70/70 Playwright；这些历史计数不能替代上方
  当前矩阵与最新门禁。
- 这些证据不替代真实 Vercel/Supabase、真实扩展 Service Worker 生命周期、Manifest host 权限、跨设备
  Cookie 或双平台 Chrome load-unpacked 验收。
