# 语见 Cloud V1 分阶段开发计划

本计划使用依赖门禁，不把客户端工作机械地串行化；只有全部阶段完成才向邀请用户一次性开放 V1。
Phase 3 后，每个稳定的 API/契约纵向切片允许 Web 与 Store Extension 同步开发和独立验证，再以共享
fixture、API 集成和跨端 journey 联合验收。共享契约、迁移和 API 每个切片仍由单一协调者维护，避免
并行写入同一 seam。需求或技术边界变化必须先写入 `change-log.md` 并同步权威文档。

## 当前进度（2026-08-14）

- Phase 0 已完成：权威文档、领域词汇、ADR 和只读审阅已收口；
- Phase 1 已完成：四个 Cloud workspace、离线测试基础、runner、架构夹具和构建入口已通过主任务验收；
- Phase 2 已完成：领域 strict schema、纯规则、`/v1` 公共契约与 Store 兼容 seam 已通过离线门禁；
- Phase 3 的数据库、RLS、认证、配对、额度与管理基础已实现并完成离线门禁；真实 Supabase/Vercel、
  多连接 Postgres 竞争与真实浏览器验证仍待受控环境验收；
- Store 当前开发阶段已提交，Phase 4 起 Web 与 Store 按同一纵向切片同步推进。
- Phase 24 已完成邀请注册到学习项的离线浏览器验收设计、自审与实现；选择邀请绑定 Google 注册而非
  绕过邮箱确认，actual Web bundle 已通过同站 HTTPS CloudBrowserAuthority/fake Provider 完成 claim、
  callback Cookie、登录 bootstrap 和手动 LearningItem 写后重读。完整证据见
  `web-onboarding-acceptance.md`；真实 Google/Supabase/部署仍待。
- PasswordAuthentication actual-bundle 增量已完成需求/技术/数据/测试方案、实现前后复审和 TDD：邀请
  密码注册 202 待确认→fake mail 显式 callback→Cookie `/app`，清会话后再覆盖 `/login` 错误/正确密码；
  密码响应已统一 private/no-store。完整 Playwright 更新为 100/100，状态为
  `implemented; target-platform validation pending`，详见 `password-authentication-acceptance.md`。
- GoogleAuthentication 普通登录已完成全局审计、独立产品/技术/数据/TDD/验收方案、实现前后复审和
  RED→GREEN：新增 identity-owned strict 空 request、start/callback no-store、callback no-referrer，以及
  active→full、disabled→data-rights、missing-method→零 Cookie 的 production-bundle fake Provider 三条
  旅程。专项 Playwright 3/3、完整离线 Playwright 108/108 通过；状态为
  `implemented; target-platform validation pending`，详见 `google-authentication-acceptance.md`。
- 完整 V1 离线完成度复审已按 `product.md` 逐项绑定当前 source/test/actual-bundle 证据，不再以“无路由
  缺口”代替完成证明。审计确认的 Phase 28 两个本地缺口——production 语义重复建议与 AA token
  对比度自动检查——均已完成离线闭环；产品/技术/数据/TDD/验收与实现前后审查分别见
  `offline-completion-audit.md`、`semantic-duplicate-suggestions.md`。A1 已按 Fresh RED→GREEN 加入真实 token
  对比度计算并校准 tertiary color；S1 strict header/no-store/error-status 已通过 TDD。S2 Provider + paid
  deep module 已完成 Fresh RED→GREEN、空候选失败回归和 API 全包复验；S3 Postgres durable authority 也已
  完成 forced-RLS、费用原子结算与 CRON 前后 dispatch 恢复回归。S4 已完成 production composition、Web
  稳定重试边界与 actual-bundle suggestion→preview→显式 confirm→server reread；S5 已完成全局文档
  回写和完整离线门禁。真实 Provider、部署、多连接 Postgres 与双平台 Chrome 仍单列验证。
- 2026-08-14 完成度复审重新打开的 Phase 27F-R 本地回归已完成：有效 session/同意下 `api=null`
  不再让 SubmissionOutbox 的 enqueue/process/status 误清密文，counted `not-configured` 会显示保留队列
  并保持 retry 禁用、二次确认 clear 可用。首轮 Fresh RED 为 5 expected failures / 24 baseline passes；
  实现终审又以第二轮 2 expected failures / 17 baseline passes 固化同版本 426 前先清 invalid session、
  `api=null` enqueue 仍执行七天裁剪。最终 GREEN focused 6 files / 32 tests，Store-domain+Store 110 files /
  524 tests，两包 strict typecheck/build、目标 ESLint/Prettier 与仓库 instructions/architecture 全绿。
  根侧完整门禁又通过 114/114 Node 脚本、444 个 Vitest 文件（2,721 passed / 12 skipped）、Playwright
  109/109、全 workspace typecheck/build、Store release audit、Store coverage 97 files / 480 tests 与
  instructions/architecture；Phase 27 本地完成声明已恢复，外部门禁不变。
- Phase 29 已完成根级离线质量门收口与实现后复审：保持全部产品源码、文档、配置、manifest
  与 lockfile 受检，只把不属于 pnpm workspace、产品运行时或发布包的 `.agents/skills/**` 代理辅助资产
  以精确路径排除；其余 5 个真实门内格式问题使用既有 Prettier 机械修复。Fresh RED 为 format 70 个
  文件（其中技能资产 65 个）、lint 143 条错误（全部技能 CJS），配置测试另为 2 passed / 1 expected
  failure；GREEN 为根 format/lint、配置测试 3/3、115/115 Node 脚本、444 个 Vitest 文件（2,721 passed /
  12 skipped）、Playwright 109/109、workspace typecheck/build 与 instructions/architecture 全绿，详见
  `root-quality-gates.md`。
- Phase 30 已在 macOS 真实执行完整 `pnpm verify:macos` 聚合门禁并以退出码 0 通过：除 Phase 29
  全量回归外，还包括 Store coverage、Store release、生产依赖审计与 `git diff --check`；Playwright
  仍为 109/109，生产依赖审计未发现已知漏洞。本阶段只补验证证据，不扩大到安装、真实 Chrome、
  Provider/词典 smoke、Supabase/Vercel 或多连接 Postgres；Windows 目标平台验证也未由 macOS 结果替代。
- Phase 32 已按 `product.md` 七条成功标准重建完成度证据矩阵，每条分别绑定 production source、
  strict contract、database/RLS test、actual-bundle 用例、fresh 命令和 `X`。复审确认 R3-C 是真实
  安全通知 sender/通知 CRON 生产组合/告警的代码缺口及邮件/告警选型决策缺口，不是纯外部验证；
  完整 V1 因此仍未完成。当前未跟踪 Cloud V1 交付文件的入库范围确认及入库后
  `git diff --check` 重跑也仍 pending。
- Phase 33 已完成 Store 当前权限必要性源码审阅：按 Chrome 官方语义和实际存储后端决定保留
  `storage`、`unlimitedStorage`、`alarms` 及三个精确第三方 API host，不新增 `tabs`。本机正式词库与
  词典耐久状态使用 IndexedDB；`chrome.storage.local` 中 SubmissionOutbox 与本机批量导入密文可并存并
  超过默认 10 MiB。当前没有 Cache Storage/OPFS 调用，不以未使用能力作为理由。正式候选仍须在 Huayi
  API origin 固定后重跑 permission/host/CSP 一致性审计和目标 Chrome 验收。
- Phase 36 已把 R3-C 外部邮件前置条件明确延期：用户当前没有自有正式域名、DNS 管理方、Resend
  账号、支持邮箱或告警目的地，本阶段不购买/注册、不创建 API key、不添加 DNS，也不继续真实
  sender/CRON/告警实现。后续恢复时先重新核价并取得明确批准；暂定首选 Cloudflare Registrar +
  `notify.<root-domain>` + Resend，国内支付/账号条件不便时备选腾讯云域名 + DNSPod。该延期不改变
  现有 R3-A/R3-B 离线完成证据，也不关闭 R3-C 发布阻塞。
- AccountSignInMethods 全局审计发现 Supabase verified-email auto-link 与产品“不静默合并”存在架构冲突；
  已完成 authorization fence 与显式 recent-auth 绑定的数据/契约/TDD/验收方案和实现前审查。Phase A
  method table、邀请单 method finalization、密码/Google 普通登录授权 fence、forced RLS、账号导出与
  actual-bundle 失败关闭旅程已按 TDD 实现；当时完整 Playwright 更新为 101/101。当前为
  `Phase A implemented; Phase B offline implementation complete; target-platform validation pending`。Phase B 已接入 production
  method GET、forced-RLS 查询、Web strict client、recent-auth/link contracts，以及 password recent-auth 的
  Cookie+Origin+CSRF/限速/同 user 验证和原子 encrypted refresh/session/CSRF 轮换；Google recent-auth 的
  path-scoped intent、purpose/session/user-bound flow、单次 continue/callback 与同一原子轮换也已完成。
  session 另已加入 password/google/null recent-auth provenance，普通登录不能冒充 link 前置证明。Google
  manual link 已完成 Provider refresh/manual-link 分离 seam、三操作深模块、数据库四阶段/30 秒单写 lease、
  production HTTP/Postgres adapter，以及成功后的 method 插入、当前 Cookie 轮换和其他 Web/Extension
  session 撤销。Google-only→password 也已按独立四阶段/单写 lease、authenticated `updateUser` 与原子
  method/session transaction 实现；账号页 UI 已接入双向 recent-auth/link，绑定后重新 bootstrap CSRF 与
  server method list。实现后审查发现的 stale/replayed 已绑定请求也已校准为稳定 409
  `sign_in_method_already_linked`，且只允许在包含正确 recent-auth provenance 的完整 Web proof 后披露；
  actual Web bundle 三条离线旅程覆盖双向成功路径和 stale 页面权威重读，完整 Playwright 更新为
  104/104；
  真实 Supabase/Google、
  安全通知、部署和双平台 Chrome 仍 pending，详见
  `account-sign-in-methods.md`。
- PasswordRecovery 已完成全局需求/代码/测试审计、Supabase 官方 PKCE 行为复核，以及独立产品、HTTP、
  深模块、数据、TDD、验收和实现前审查文档。路线固定为 email-enumeration-safe 统一 202、仅既有
  active+password method 可创建 flow、purpose-scoped recovery Cookie、一次改密不登录、成功撤销全部
  Huayi sessions并写安全通知；公开 start 不等待 Provider，trusted worker 先耐久标记 dispatch，回执不
  明确不得自动重发。邮件 GET 只显示 inert confirm，用户显式 POST 才交换单次 code。不复用邀请/link
  flow，也不允许 Google-only 借恢复新增 method。R1 已按 RED→GREEN 实现并导出 strict contracts、
  internal bounded outcome、独立三操作 Provider port、共享逐 flow Supabase PKCE storage 与 recovery
  adapter；R2 深模块、内存与 Postgres 状态机也已覆盖本地 request、dispatch/callback/complete、最新 flow、
  过期、单写恢复、dispatch/complete 前 eligibility 重检、全 session 撤销和通知事务。两张受限表、12 个
  SECURITY DEFINER 转换、forced RLS、业务 role 零直访和 cleanup 已进入 migration；deep/in-memory
  11/11、当时 migration+PGlite adapter 19/19。R3-A 五条公开 HTTP、dispatch CRON、250ms start floor 与
  production composition 已实现；R3-B notification-ID 幂等 sender port、120 秒 Postgres lease、有界退避
  与 fake sender 也已实现。R4 Web strict client、`/recover` 状态机和 production-bundle fake-mail journey
  也已完成，focused Web 17/17、专项 Playwright 1/1，覆盖另一浏览器最新邮件、旧邮件/replay、显式
  callback、全 session 撤销、单通知与旧/新密码重登。当前 contracts 62/62、API 102 files、360/360；状态为
  `R4 Web + actual bundle offline implemented; R3-C real notification sender and R5 target-platform
validation pending`。R5 离线总审又通过 Web 184/184、完整 Playwright 105/105、instructions、workspace
  typecheck/build、`pnpm test`、目标 lint/format 与 diff check；当时根级 format/lint 仍分别由既有 70 个
  文件和 `.agents/skills/**` 143 条错误阻塞，后由 Phase 29 关闭。详见 `password-recovery.md`。
- Phase 25 已完成 Web 分析到学习库的离线浏览器验收设计、自审与实现；技术路线固定为 actual `/analysis`
  strict SSE→服务器 pendingReview→Inbox 确认→学习库 GET 重读，不预种 AnalysisRecord、不以 preview
  冒充完成；学习库详情同时开始呈现只读可信来源快照。完整证据见
  `web-analysis-review-acceptance.md`；真实 DeepSeek、部署代理与数据库仍待。
- Phase 26 的平台/BYOK 交互选择已在 Phase 27 完成用户逐项裁决：账号全局 mode 默认 platform、Web-only
  修改、所有设备生效且无自动 fallback；查询结果与 StudyCapture 分离。Phase 26A 已完成的请求证明继续
  复用，但旧 BYOK full-result import 不再是目标行为。请求证明方案、自审与
  离线实现，统一 Store client-version header 与 API 固定 Extension Origin/最低版本校验，详见
  `extension-request-proof.md`。Phase 26B 已把候选 Extension ID、API 公开 ID 与最低版本纳入同一个
  Cloud release audit，并完成方案自审与 focused TDD，详见 `release-runtime-consistency.md`。
- Phase 26C 已修复旧登录 BYOK outbox 对 426 的错误自动重试与模糊提示；其 SW-only 加密升级标记、同版本
  fail-before-fetch、新版本显式恢复和 Popup 脱敏聚合状态已按 focused TDD 实现，详见
  `store-upgrade-recovery.md`。Phase 27 已保留通用升级恢复语义，把 payload union 改为
  StudyCapture/CloudWordCopy，并删除 analysis import。
- 当前账号聚合切片已按 `account-profile.md` 完成需求/技术复审与 contracts→API/PGlite→Web TDD：
  `GET /v1/account` 返回规范邮箱、五项偏好、有效 Extension session 公开投影和最低兼容版本，账号页不再
  重复 GET preferences；actual Web 账号页已进入 93/93 离线浏览器门禁。真实登录/部署仍待。
- LearningItemArchive 已按 `learning-item-archive.md` 完成文档/术语复审与
  contracts→migration/API/Postgres→Practice→账号导出→Web→actual bundle TDD：归档与
  tombstone/delete 分离，保留排期和练习历史、阻止新 session、恢复沿用原排期；状态为
  `implemented; target-platform validation pending`，真实部署多连接竞争、登录与 Chrome 仍待批准。
- LearningItemErasure 已按 `learning-item-erasure.md` 完成需求、数据权、事务、契约、测试矩阵、实现前
  复审与 contracts→database/API→practice/export→Web→actual bundle 离线 TDD：已练习项先归档，安全
  终态后清除内容/identity/排期，只保留最小关系墓碑；PracticeSession 独立保留并可另删，最后引用消失
  后清墓碑。状态为 `implemented; target-platform validation pending`；真实多连接 Postgres、登录、部署与
  Chrome 仍待批准验证。
- Phase 4 首个分析/历史切片已建立：fake-model 分析深模块、SSE/断线状态、旧 BYOK 导入、租户历史与
  Web/Store 真流式 HTTP adapter 已通过共享契约和全量离线门禁；生产组合已把分析记录、候选、用量
  账本和额度结算收进同一 Postgres 事务，并统一 Web Cookie+CSRF 与 Extension token 认证。DeepSeek
  平台 adapter 的固定模型、总超时、严格 JSON、一次结构修复、reasoning 丢弃和逐调用费用账本已通过
  离线 fake；数据库请求生命周期也已实现跨实例运行中去重、terminal 重放、租约 fencing 与过期保守
  结算。完整历史 API 操作也已实现严格筛选/签名 keyset 分页、详情、nothing-to-save、归档/恢复/删除、
  revision/幂等事务和 Web/Store adapter。候选确认 API 切片也已实现严格批量编辑、Word/学习项路由、
  精确重复、非覆盖 merge、可信来源快照、Postgres 原子幂等/RLS 以及两端 HTTP adapter。真实模型核验、
  Web `/history` 的筛选、分页、完整结构化详情、归档/恢复/nothing-to-save/删除与迟到响应防护也已离线
  接入现有权威；analysis→Inbox→learning library 的 actual Web 离线 journey 已由 Phase 25 覆盖，但
  真实模型、部署代理和数据库核验尚未完成，因此 Phase 4 仍在进行中。旧 BYOK import、WordCandidate
  分支和 action/word Web 输入已被 Phase 27 产品决定否决并从当前契约/组合移除，旧绿灯只保留为历史
  证据，不能继续作为当前行为验收。
- Phase 5 已建立首个待整理 Web 纵向切片：可访问 App Shell、pending 列表/详情、Candidate 字段编辑与
  勾选、原子批量确认、nothing-to-save、错误/空态/loading、精确重复保留草稿、窄屏与 reduced-motion
  样式均已离线实现；生产入口使用严格 API origin 与 CSRF bootstrap，缺配置失败关闭。账号 bootstrap
  与固定路由配对审批也已接入严格 Cookie/Origin/CSRF adapter；账号设备列表与 owner-scoped 服务端
  撤销也已离线接线。邀请领取、邮箱密码注册/登录、普通 Google 登录与邀请绑定 Google OAuth 都已复用
  现有 API/identity authority，并通过 actual production-bundle 离线 journey；语义查重/显式 merge、
  学习库和完整分析历史 UI 也已有离线纵向切片与浏览器组合证据。真实 Supabase/Google/邮件、部署
  Cookie/Domain 和目标平台登录 journey 仍待受控验收。
- Phase 6 同步加入浮层云状态与无参数 Web 入口消息；Service Worker 发布 URL 仍未配置，因此当前会
  稳定显示“无法打开”，不会打开保留域名。配对 start/poll/exchange、独立加密 session vault、Popup
  脱敏状态与本机断开已离线接线；生产 API/Web origin 仍为 null，因此发布构建继续 not-configured。
  Phase 6 当时接入的登录 BYOK full-result SubmissionOutbox 已由 Phase 27 删除；当前 outbox 只接受
  StudyCapture/CloudWordCopy，未登录与未配置状态保持 local-only。Web 服务端设备撤销已完成；Store
  DeviceDisconnect 的 self-revoke/remote-first 安全收口也已完成离线实现与实现后复审：远端 204 后才清
  本机会话/账号队列，失败保留撤销能力，actual bundle 已覆盖重试、旧 token 失效和设备投影归零。
  平台插件查询、StudyCapture/CloudWordCopy 与 actual Store/Web
  离线跨端 journey 已完成；正式候选入口、真实 Chrome 与部署验证仍待。
- Phase 27 已完成产品逐项对齐、领域语言、三份 ADR、权威方案复审和 27A–27G 离线实现；当前进入
  27H 目标环境验收。离线全量门禁与跨端 rebaseline 已完成；真实 Chrome、Provider、Supabase/Vercel、
  Eudic/Shanbay 和双平台发布验证仍需分别批准。

## Phase 0：权威文档与审阅

### 工作

- 建立产品、架构、数据模型、API、安全、测试、运营和发布文档；
- 更新领域词汇，新增 Cloud topology、云端权威、服务器可读、学习项、平台额度、Classic 对齐和托管
  运行时 ADR；旧 ADR 保留并标注 superseded；
- 把 Store 1.0 本地候选标记为历史设计，更新根文档入口和项目状态；
- 只读审阅文档间术语、状态、额度、删除、认证和接口是否一致。

### 退出门槛

- 所有高影响决策在文档中只有一个答案；云端唯一权威、本机 LocalLexiconEntry 独立权威、服务器可读
  内容和 platform/BYOK 账号模式必须按各自范围准确描述；
- `pnpm check:instructions`、`pnpm format:check`、`pnpm lint`、`pnpm check:architecture`、
  `git diff --check` 通过。

## Phase 1：工程门禁与 workspace 骨架

### TDD 顺序

1. 扩展脚本测试，先证明现有 architecture/build/typecheck/test runners 不扫描新模块；
2. 新增 `packages/learning-domain`、`packages/cloud-contracts`、`apps/api`、`apps/web` 最小 workspace，
   再更新 runner 与架构规则使测试通过；
3. 固定依赖方向与 400 行/循环/深导入规则；新增 Vercel 与环境 schema，但不连接真实服务；
4. 建立 fake clock、fake model、fake mail 和临时数据库测试基础。

### 退出门槛

- 四个 workspace 均可 typecheck/test/build；架构检查能在故意违规 fixture 上失败；
- Classic 与 Native Host 不依赖 Cloud；无真实网络、秘密或业务占位实现。

## Phase 2：领域模型与公共契约

### TDD 顺序

1. 实现 AnalysisRecord/Candidate、Expression/SentencePattern/SourceExample、WordEntry、Practice、
   ScheduleState 和额度值对象的 strict schema；
2. 实现规范键、精确重复、合并、来源复制和固定阶梯纯函数；
3. 实现 `/v1` 请求/响应/SSE/error schema、契约兼容 fixtures 和安全字段拒绝；早期 WordCandidate
   导入路径由 Phase 27 移除，WebDeepAnalysis 只产生表达/句型，WordEntry 使用独立 words 流程；
4. 将 `store-domain` 中仍成立的分析结果/词头规范化下沉到 `learning-domain`，再由 `store-domain`
   通过公开入口适配；不能让 Cloud 契约反向依赖 Store 包，也不能复制两套含义不同的类型。

### 退出门槛

- `learning-domain` 只依赖允许的纯库；所有边界、union 和排期测试通过；
- Web/API/Extension 能通过公共 package 构造相同 fixture，未知字段均失败关闭。

## Phase 3：数据库、RLS、认证与额度基础

### TDD 顺序

1. 先写迁移验证和跨账号 RLS 失败测试，再建立全部核心表、索引、约束与 policies；
2. 实现邀请领取、Supabase Google/密码身份、API Web session、CSRF 和账号状态；
3. 实现 Extension pairing/PKCE、设备 token、列举与撤销；
4. 实现价格快照、grant、reservation、ledger、advisory lock、频率限制和 kill switch；
5. 实现最小管理权限、邀请/额度/启停接口和审计。

### 退出门槛

- 并发邀请、配对和额度测试证明只有一个合法提交成功；
- 所有用户表通过 API + RLS 多租户矩阵；Cookie、CSRF、token 和日志安全测试通过。

## Phase 4：平台分析与历史

### TDD 顺序

1. 用 fake model 写分析用例：确定性分句、预留、SSE、最终校验、事务落库和断线查询；
2. 实现 DeepSeek adapter，限制 model/thinking/JSON/output/timeout，丢弃 reasoning；
3. 加入一次结构修复和全部失败结算分支；
4. 实现历史/详情/待整理/归档/恢复/删除接口；旧 BYOK import 由 Phase 27 删除并由 StudyCapture 显式
   分析替代；
5. 完成 prompt injection、无正文日志和 idempotency/revision 回归。

### 退出门槛

- 默认测试全程 fake；preview 不落库，completed 可重新查询，重复请求不重复计费；
- 真实 DeepSeek 验证仍标记 pending，除非用户另行批准。
- 每个可消费的分析/历史 API 切片同时提供 Web 与 Store adapter 的契约 fixture；任一端可以先完成
  focused gate，但该切片只有两个客户端和 API 联合 journey 都通过后才算关闭。

## Phase 5：Web 账号、分析与整理

### TDD 顺序

本阶段与 Phase 6 按功能切片交错推进，不再等待全部 Web 页面完成后才开始 Store 客户端。

1. 建立复用现有设置页 token 的可访问 App Shell 和主导航；
2. 实现邀请、Google/密码登录、账号与设备页；
   - 2026-08-14 复审确认 Store create/poll/exchange 与 Web pairing 组件分层证据有效，但 production
     `/pair-extension/:id` 尚无 actual-bundle 审批旅程；专项状态机、数据披露、API 文档校正、TDD 与验收
     见 `pairing-approval-acceptance.md`。现已完成披露文案修正与补充 RED→GREEN，focused 1/1、完整
     Playwright 99/99；状态为 `implemented; target-platform validation pending`。
   - PasswordAuthentication production 入口已按 `password-authentication-acceptance.md` 完成：注册 202 不建
     session，显式 confirmation callback 才建 Cookie；清会话后错误/正确密码重登和 no-store 均通过，
     完整 Playwright 100/100。真实邮件/Supabase/部署与目标平台验证仍 pending。
3. 实现粘贴分析、SSE、StudyInbox、完整详情、历史和待整理；
   - 已离线完成 Web `/analysis` 的 manual 粘贴表单、严格 Cookie/Origin/CSRF SSE adapter、临时 preview、
     completed→既有待整理交接、失败保留输入重试、AbortSignal 取消/迟到抑制与 started-only 状态查询；
     `/history` 也已离线完成服务器筛选/分页、完整结构化详情、nothing-to-save、归档/恢复、二次确认删除、
     写后重读与 list/detail/action 迟到抑制；Phase 25 已离线覆盖 actual Web 分析→待整理→学习库浏览器
     journey，真实 DeepSeek、部署网络和数据库仍待。Phase 27 已移除 action/word 输入，并把 StudyInbox
     拆为 CaptureInbox/ReviewInbox；旧页面行为只保留为历史基线。
   - 2026-08-14 生产路由复审确认 `/history` 的分层实现仍有效，但缺少当前 actual-bundle 维护闭环；专项
     需求、状态机、strict helper、TDD 和验收见 `analysis-history-acceptance.md`。当前进入补充离线
     RED→GREEN，不修改生产 contracts/API/SQL。现已通过 focused 1/1 与完整 Playwright 98/98，状态为
     `implemented; target-platform validation pending`。
4. 实现候选编辑、批量原子确认、精确重复、同模型语义建议、手动录入、标签与学习库；
   - 已离线完成学习库只读纵向切片：strict list/detail、owner-scoped Postgres 筛选/签名游标、ScheduleState
     与最近 completed practice 摘要，以及 Web `/library` 列表/详情/筛选/分页/恢复状态；手动 create
     也已离线接入 strict POST、幂等 Postgres transaction、类型专属表单及成功后 server reread；patch、
     维护切片也已离线接入 patch、未练习 hard-delete、语义候选 seam 与安全子集 preview/explicit merge；
     production 语义模型 fail-closed。已练习项目的可逆 archive 已完成离线 contracts、Postgres、练习
     边界、账号导出、Web 和 actual bundle 旅程；已练习项不可逆抹除也已完成 contracts、Postgres、
     Practice、账号导出、Web 和 actual bundle 离线 TDD，真实多连接数据库、登录、Chrome 与语义模型/
     quota 仍待。
5. 实现配额展示、80/100% 状态、错误恢复和响应式 E2E；
   - 已离线实现 Web `/settings/account` 与 Web-Cookie-only `GET /v1/quota`，显示服务器 UTC 周期、
     limit/used/reserved/remaining/percent/warning，含 0 grant、80% 和 exhausted 状态及 BYOK 排除说明；
     窄 `GET/PATCH /v1/account/preferences` 已离线接入 timezone/dailyGoal；Phase 27 已加入三项账号插件
     偏好、revision 与 pairing 原子选择。`GET /v1/account` 已按 `account-profile.md` 完成
     contracts→API/PGlite→Web TDD，账号页直接用聚合偏好初始化并通过 actual Web 离线验收；真实登录/
     部署浏览器 E2E 仍待。
6. 主动练习：已离线完成 `/practice` 今日队列、单学习项句子创作与 1–3 项受约束对话，含 turn 先落库、
   start/assistant/final generation lease + fencing、3–5 round、逐项反馈、多项原子 rating、pending 显式
   重试与刷新恢复。句子切片含 PracticeAttempt 先落库、feedback lease/retry fencing、反馈后
   SourceExample/自评与幂等排期。Phase 23 已把五类生成统一接入 durable task、quota reservation、
   UsageLedger、固定 DeepSeek adapter 与 production composition；练习历史/单次 completed/failed 删除也已离线
   接入。两种实际 Web bundle 练习 journey 已离线覆盖 pending 显式重试、造句反馈/自评、三轮对话/
   逐项反馈/原子自评和 quota 重读；真实模型、部署数据库与并发进程仍待独立验证。

当前已完成第 1 项 App Shell、第 2 项中的严格登录态 bootstrap、邀请领取、邮箱密码注册/登录、邀请
绑定 Google OAuth 启动、配对审批与设备列表/服务端撤销，以及第 3 项的 Web 粘贴 SSE 分析与第 3/4
项中“待整理 + 候选编辑/批量确认”的最小闭环、第 4 项学习库视图和第 5 项额度读取/页面。邀请注册、
普通 Google/密码登录与显式双向身份绑定的 actual-bundle 离线组合均已覆盖；真实 Google/邮件回调与
Supabase、部署 Cookie/Domain 和其余目标环境验证仍 pending，因此不能据此关闭 Phase 5。

### 退出门槛

- 邀请到学习项闭环的 Web E2E 通过；键盘、焦点、AA、窄屏和 reduced-motion 通过；
- 页面无原始 HTML 渲染、Supabase 直表访问或客户端业务权威缓存。

## Phase 6：Store Cloud 客户端

### TDD 顺序

1. 先更新行为测试，固定本机 LocalLexiconEntry、StudyCapture 与 AnalysisRecord 是不同资源；
2. 扩展配对/session，使三项账号偏好在 Web 原子选择并由 Service Worker 缓存；
3. 实现 QueryRouter：platform 走临时 API generation，BYOK 保持本机 Provider；两者都不上传 compact result，
   且任一错误不自动 fallback；
4. Overlay 保持 compact 查询，增加手动/自动 StudyCapture 状态与 current-card undo，不做候选编辑；
5. 把 SubmissionOutbox 改为 StudyCapture/CloudWordCopy、网络恢复、退出/撤销和版本阻塞；
6. 更新 Manifest、CSP、权限与打包审计。

第 1–6 项的当前离线实现已完成：三项账号偏好随配对/session 缓存；QueryRouter 固定 platform/BYOK 且
零 fallback；Overlay 只显示 compact 查询并提供 StudyCapture；旧 BYOK import/outbox 已删除，当前加密
outbox 只接受 StudyCapture/CloudWordCopy，支持恢复、版本阻塞与脱敏聚合；Manifest/CSP/权限进入发布
审计。Web 已可撤销服务器 session；Store DeviceDisconnect 已完成需求/技术/TDD 方案、self-revoke SQL/API、
remote-first manager、Popup 和 actual bundle journey，并完成实现后复审；状态为
`implemented; target-platform validation pending`。Popup 仍不提供逐项正文浏览/删除。正式 API/Web URL
未进入候选配置，真实 Chrome 与部署验证仍 pending，因此不能据此关闭 Phase 6。

### 退出门槛

- 普通网页/YouTube/配对偏好/BYOK/平台 fake/StudyCapture/CloudWordCopy/outbox Chrome E2E 通过；
- token 和凭据无法进入 Content Script；本机 LocalLexiconEntry 保持正式且不被账号切换清除，插件端不
  新增 Expression/SentencePattern 正式学习 repository。

## Phase 7：生词与外部词典桥接

详细需求、状态机、数据结构、深模块接口、测试矩阵和复审结论见 `external-wordbooks.md`。本阶段拆成
7A 云任务权威、7B Store Extension 桥接、7C WordListExport/联合验收，避免把导入 page 与 export item
塞进同一个不完整 lease 形状。

### TDD 顺序

1. 实现云端 WordEntry/ContextObservation CRUD 与 Web 管理；
   - 已离线完成 owner-scoped list/detail、notes-only PATCH、无外部任务引用时的 whole-word DELETE，以及
     Web `/words`。手动 POST/upsert 已按服务器 manual/now/ID、既有 notes 保留、内容 hash 去重、
     `word.upsert` 幂等事务与写后重读离线完成；ContextObservation 保持不可变，单条 context mutation 不开放。
2. 把 Eudic import/export 与 Shanbay export 改为云端任务、Extension lease 和幂等 receipt；
3. 保留欧路 DeviceVault 凭据、固定 endpoint 和 Shanbay 人工点击；
4. 实现 WordListExport、任务状态和取消/迟到回执。

### 7A：云任务权威

当前状态：已离线实现并通过全仓离线门禁；真实第三方/部署验证见本阶段退出门槛。

1. 先用 strict contracts 固定 job resource、签名列表、create、nonce lease、receipt union、retry/cancel；
2. 调整未发布 bootstrap 0001 的 job/item 约束、payload snapshot、稳定错误和 hash-only lease；
3. 用 PGlite 证明 RLS、export snapshot、import page 原子 upsert、幂等、过期重领、旧 token fencing、
   取消/迟到和失败重试；
4. 接 Web `/words/wordbooks` 与 Extension HTTP adapter fake，生产 origin 继续 fail-closed。

### 7B：Extension 桥接

当前状态：核心 Cloud bridge、Eudic runner、Shanbay 加密别名租约与 production fail-closed 组合已离线
实现；真实第三方和 Chrome 验证仍待独立批准。

1. production composition 停止向本地正式 outbox 写入，改为 Cloud job authority；
2. 复用固定 Eudic client，增加独立加密 Shanbay lease vault 和 Content 本机别名；
3. Options 分区显示本机词库导入/导出、云任务聚合状态与本机 credential；补断开、撤回同意、session
   过期和 alarm 恢复。云任务 authority 不替代 LocalLexiconExport/LocalEudicImport。

### 7C：词表导出与联合验收

当前状态：owner UTF-8 互操作词表、Web strict 下载，以及 Eudic/Shanbay fake 跨端 browser 的成功、稳定
失败显式重试、取消和当前租约迟到回执 journey 已实现；真实目标验证仍待。

1. 实现 owner snapshot 的一行一词 UTF-8 导出和 Web 下载；
2. 跑 API/Web/Store shared fixture 与完整 fake journey；
3. 全仓离线门禁后仍保留真实 Eudic/Shanbay/Chrome 独立批准项。

### 退出门槛

- fake 第三方流程覆盖分页、中断、重领、已有远端、部分成功和取消；
- 真实 Eudic/Shanbay 仍需分别批准，未批准时不得声称系统集成完成。

## Phase 8：主动练习

### TDD 顺序

1. 实现用户时区、每日目标、到期优先与新项补足；
2. 实现句子创作生成、回答、反馈和延迟 SourceExample；
3. 实现 1–3 项、3–5 轮受约束对话和最终逐项反馈；
4. 实现完整历史、自评事务与排期，失败答案可恢复；
   - 已离线实现 owner-scoped 正式会话列表/详情、签名 completion cursor、Web `/practice/history`，以及仅
     completed/failed 且无 worker lease 的单次删除。删除后的幂等重放来自 snapshot，且不回滚排期。
   - 2026-08-14 全局生产路由复审确认上述 contracts/API/Postgres/Web 证据仍有效，但缺少
     `/practice/history` actual production bundle 组合旅程。专项需求、技术路线、fixture 数据结构、TDD
     和验收见 `practice-history-acceptance.md`；现已按该文档完成补充离线 RED→GREEN，不改生产契约或
     SQL，并通过 focused 1/1 与完整 Playwright 97/97。状态为
     `implemented; target-platform validation pending`。
5. 完成 Web E2E 与额度耗尽/kill switch 恢复。

### 退出门槛

- 同一 item 每 session 只计一次；重复 rating 不重复推进；删除历史不倒退排期；
- 两种练习都能从今日队列完成并在下一到期日可见。

## Phase 9：数据权利、运营与完整发布

账号数据权利拆为 Phase 18 有界切片，权威需求、技术路线、状态机、数据结构、TDD 与验收见
`account-data-rights.md`。当前已离线实现 strict contracts、owner-RLS 导出任务、可恢复删除任务、
worker/cron 入口、Supabase service-role adapter、普通 Google 登录、DataRightsSession 和 Web
`/settings/data`。2026-08-14 实现后复审确认 Phase 27 strict snapshot 已完成，并补齐 actual Web
导出/新窗口下载/删除 journey 与删除 accepted 后的 SPA signed-out 转换；状态为
`implemented; target-platform validation pending`。真实 Supabase/Vercel、登录和部署验证仍待完成。
本轮 Web focused 11/11、全 workspace 411 个 Vitest 文件（2,582 passed / 12 skipped）、typecheck/build
与完整离线 Playwright 94/94 均通过。

管理运营台拆为 Phase 19，权威需求、权限、数据结构、接口、TDD 与验收见
`admin-operations.md`。当前已完成 Operator authority、规范化登录邮箱、独立签名 cursor、幂等管理
事务、无正文 usage/audit、严格账号状态机、kill switch 和 Web `/admin` 的离线闭环；没有沿用旧非幂等
HTTP 写入。2026-08-14 复审曾确认缺少 actual Web bundle 的 Operator/非 Operator 离线组合证据，现已按
`admin-operations.md` 补齐 strict authority 与两条 journey；Operator 四区/管理写入/服务器重读、一次性
fragment 和非 Operator access 403 均已通过，完整 Playwright 更新为 96/96。状态为
`implemented; target-platform validation pending`；真实部署、Supabase 登录邮箱刷新、真实 Operator
浏览器 journey、告警与备份恢复演练仍 pending。

### TDD 顺序

1. 实现 AccountDataExport、删除任务、会话即时撤销和失败恢复；管理后台剩余页面另作后续切片；
2. 补齐无正文监控、费用面板、告警、kill switch runbook、备份/恢复演练和回滚；
3. 重写 Cloud 隐私政策、Store listing、权限理由、截图和数据披露；
4. 跑全量离线门禁、macOS/Windows CI 与经批准的真实 Chrome/服务检查；
5. 只在所有验收证据齐全后创建完整 V1 候选包并开放邀请。

第 3 项拆为 Phase 20，权威需求、公开路由优先级、披露矩阵、TDD 与验收见
`release-trust-surfaces.md`。该阶段先交付无需登录/API 的预发布 `/privacy` 和 Cloud 专用商店草稿；运营
主体、联系信息、生产区域、备份残留、生产 URL 与 Dashboard 人工问卷仍必须由真实发布环境补齐。
当前预发布页面、登录页入口、无网络启动分流、Cloud listing 和 Manifest/披露一致性回归已离线完成；
不得据此勾选正式政策或商店提交门槛。

候选配置与证据一致性拆为 Phase 21，权威接口、阻塞 code、审计规则、TDD 与验收见
`release-evidence.md`。它只消费公开候选配置和本地产物，当前开发态必须得到预期 blocked，不会为了
让审计变绿而填入虚构 origin、Extension ID 或正式政策事实。

离线跨端浏览器组合拆为 Phase 22，权威旅程、fake authority seam、数据状态机、TDD 与验收见
`browser-acceptance.md`。当前已构建实际 Web production bundle 与 packaged Store Content Script，并以
同站 HTTPS 保留域的本地 route interception 验证 Store→Cloud→Web、Inbox→Learning Library、隐私/
未登录失败关闭和幂等冲突；不把该证据解释为真实部署、Manifest host 授权或扩展进程验证。

平台付费练习生成拆为 Phase 23，权威状态机、深模块、数据结构、恢复矩阵、TDD 与验收见
`paid-practice-generation.md`。上述 domain/task/quota/ledger、固定 DeepSeek adapter、production composition
与 Web pending retry 已离线实现；任何后续改动仍必须证明 `dispatched` 丢失会保守结算且不会透明二次
调用。真实环境验收未完成前状态保持 `implemented; validation pending`。

### 退出门槛

- `testing.md` 全部自动门禁通过，真实验证结果逐项记录；
- 没有 `pending` 的发布阻塞项；公开商店提交和邀请开放各自取得明确批准。

## Phase 28：语义重复建议与离线完成度收口

Phase 28 由完整产品要求审计触发，不新增自动 merge。Web semantic token 的可计算 AA 契约，以及既有
duplicate-suggestion seam 到独立 DeepSeek provider、owner-scoped durable generation、月度 quota/ledger、
显式 Web retry 和 actual-bundle suggestion→preview→confirm→server reread 的离线闭环均已完成。完整
数据结构、状态机、TDD 与验收见 `semantic-duplicate-suggestions.md`；真实 Provider 费用和目标平台仍
单独批准。

S1 已按 Fresh RED→GREEN 完成专用 strict Idempotency-Key、Web 每次动作传键、API no-store/拒绝
`If-Match`，以及 `generation_busy`/`quota_exhausted`/`model_output_invalid` 的 409/429/502 映射。
S2 Provider + paid deep module 已完成实现前 seam 复审与 Fresh RED→GREEN；Provider 返回每次实际调用的
`billedCalls[]`，repository begin 使用 `acquired/resolved/busy`，外部 interface 只保留
`suggest(command)`。根侧复审新增空候选零 repository/dispatch/Provider 的失败回归后，S2 focused 12/12、
API 105 files / 374 tests、strict typecheck/build、instructions/architecture 与目标 lint/format 通过。
S3 Postgres authority 已完成 restricted forced-RLS 表、definer transitions、owner/key/hash、lease/fencing、
durable replay、dispatch 前释放重领、dispatch 后保守结算、24h terminal TTL、≤100 cleanup 与账号级联。
根侧复审补齐 CRON 未 dispatch 同 key 重领回归；focused 4 files / 23 tests、API 107 files / 383 tests、
strict typecheck/build、instructions/architecture 与目标 lint/format 通过。S4 production composition 已把
固定 DeepSeek adapter、paid generator、Postgres authority 与 `CRON_SECRET` cleanup route 接入；相同
owner/key 的 terminal replay 先于新价格预检，新 generation 才执行 price→kill/quota→reservation→durable
dispatch→fetch。Web 每次显式点击使用新 key、不自动重试并抑制 item/revision 变化后的迟到响应；actual
bundle 已证明 suggestion→preview→explicit confirm→target GET reread 与公开 snapshot/Web Storage 脱敏。
S4 fresh evidence 为 API 109 files / 387 tests、Web 42 files / 191 tests、专项 Playwright 1/1、strict
typecheck/build、目标 lint/format 与 instructions/architecture 全绿；根侧 focused 复验另为 API 9 files /
38 tests、Web 2 files / 17 tests、Playwright 1/1。S5 已完成 15 份权威文档收口与完整离线门禁：
workspace typecheck/build、114/114 Node 脚本、443 个 Vitest 文件（2,714 passed / 12 skipped）与
Playwright 109/109 全绿。当时根级 format/lint 的既有阻断继续单独记录，不改变本阶段完成结论；该阻断
后由 Phase 29 关闭。

## Phase 29：根级离线质量门收口

Phase 29 不改变产品行为。Fresh RED 先证明根 format 70 个文件、lint 143 条错误和配置精确边界缺失；
实现只让 Prettier/ESLint 排除不在 workspace、运行时或发布包中的 `.agents/skills/**`，不排除
`.agents/**`，并用既有 Prettier 机械修复 3 个 Web 文件、跨平台文档和 lockfile。配置回归、完整离线
门禁与实现后范围审查均已通过，数据、依赖解析、Classic/Host/wire 和外部门禁不变。详细需求、技术
路线、测试与验收见 `root-quality-gates.md`。

## Phase 27：插件查询、StudyCapture 与本机生词校准

权威需求、资源关系、深模块、数据、HTTP、TDD 和复审见
`extension-query-and-study-capture.md`。本阶段不是在旧 BYOK import 上加开关，而是替换已经被产品决定
否决的跨端主链路。Classic/Host 不进入修改范围。

### 27A：文档冻结

1. 全局搜索产品、ADR、架构、数据、API、安全、测试、公开披露与项目状态中的旧口径；
2. 建立 ExtensionQueryResult、ExtensionQueryGeneration、StudyCapture、三个账号偏好、LocalLexiconEntry
   与 CloudWordCopy 的唯一语言；
3. 审查权威、FK/删除、幂等计数、离线 queue、费用与接收方；修正后才允许写业务代码。

退出门槛：所有权威文档只有一个答案，旧实现明确标记待替换而非“已完成”。

### 27B：领域、契约与 bootstrap RED→GREEN

1. 先让 learning-domain/cloud-contracts/Store contracts 因缺少新 strict union/default/route 失败；
2. 新增 V2 WebDeepAnalysis、compact query event、StudyCapture、偏好和 CloudWordCopy；删除
   `importAnalysisRequest` 的目标公开出口；
3. 迁移加入 preferences、study_captures、extension_query_generations 与 analysis 关系；扩 RLS、索引、
   idempotency allowlist 和账号导出；PGlite 覆盖并发、跨租户、collision、删除和一小时清理。

退出门槛：领域/contracts/API migration focused/full、typecheck/build/architecture/diff 全绿；开发库重建
说明已更新。

### 27C：账号偏好与配对

1. Web 设置页五项 projection/revision；pairing 三项选择与原子批准；
2. Extension exchange/read adapter、session-bound cache、Popup/Options 只读投影；
3. 断开/换号/过期清缓存，离线 BYOK cache 与 platform fail-closed。

退出门槛：Web/API/Store focused + pairing/browser fake journey 通过，零逐设备 mode 写入口。

### 27D：插件模型路由与临时平台查询

1. QueryRouter 先 RED：signed-out、platform、byok、pin、no-fallback 和输入最小化；
2. API durable temporary generation、quota/dispatch/fencing/status/TTL；
3. 两条 model adapter 归一到同一 compact result/stream，Overlay 不知道 Provider。

退出门槛：所有失败组合零 fallback，BYOK 零 Huayi result upload，平台结果不进 AnalysisRecord/history。

实现检查点：QueryRouter、无 fallback、Extension-only durable generation、quota/lease fencing、strict
DeepSeek compact adapter、`dispatched_at` 和独立 trusted cron 已完成离线实现。PGlite/HTTP 回归覆盖
undispatched release、dispatched conservative settlement、并发 `SKIP LOCKED`、每批 100 条上限、terminal
硬删、running 防误删、固定 CRON_SECRET 和 production Vercel 调度。AccountDataExport 已在同一 owner
repeatable-read snapshot 中输出偏好、未过期临时查询、StudyCapture 和既有正式学习数据，且不输出
email/session/lease/quota。27D 离线关闭；真实部署与跨端验证进入 27H。

### 27E：StudyCapture API 与 Web

1. exact upsert/count/idempotency、metadata/type patch、current-card delete、CaptureInbox；
2. manual/capture 统一 V2 deep analysis、失败恢复、reanalysis append-only；
3. 分析删除默认 checkbox/取消/非最新关系与 ReviewInbox 候选闭环。

退出门槛：API/PGlite/Web full 和 actual Web manual/capture→ReviewInbox→LearningItem 离线 journey 通过。

实现检查点：exact upsert/linked manual、CaptureInbox、显式初次分析/reanalysis、数据库状态原子推进、
失败恢复、SSE 断线按同 requestId 查询、刷新后 active request 投影，以及 analysis/capture 删除默认勾选、
取消保留、最新关系重验和幂等回放均已完成。Phase 27H 首条 actual 跨端 journey 已使用 packaged Store
Content Script 和 production StudyCapture outbox/API seam，完成手动采集→Web CaptureInbox→显式深度分析→
ReviewInbox→LearningItem；另以 automatic journey 证明 created-only 当前卡撤销与 exact existing 无撤销。
双页面独立幂等命名空间进一步证明 stale revision 撤销失败关闭；断网采集通过 production alarm runner
恢复后可由 Web 重读。platform query 已通过 production QueryRouter/PlatformAnalysisEngine/HTTP SSE decoder
完成成功与 quota-exhausted 无 fallback journey，并证明不产生 AnalysisRecord/StudyCapture。CloudWordCopy
联合 journey 已通过 production lexicon handler、local-first repository、HTTP copy client 和共享 outbox，
覆盖开启后 Web 重读、关闭时零云写入，以及离线本机保存后关卡并由 alarm runner 恢复。显式历史批量
导入也已通过 production Options controller、加密 runtime 与 alarm runner，覆盖 201 词预览/二次确认、
100+100+1 续传、无语境词和本机不删除。账号断开 journey 已证明清除离线 CloudWordCopy 队列但保留
LocalLexiconEntry；换号 journey 已通过 production CloudSessionManager 的 disconnect/pairing/exchange，
证明旧队列不跨账号、本机旧词保留且新收藏使用新 session。LocalEudicImport 已通过 production
BrowserWordbookExportEngine→LocalLexiconEntry→显式预览/二次确认→加密 Cloud batch runtime 联合
journey，云端任务不替代本机导入。

### 27F：Store StudyCapture/outbox

1. manual/automatic trigger、same-card suppression、created/existing/linked 状态；
2. online/offline current-card undo 与 revision race；
3. outbox union 改为 capture/word-copy，删除 BYOK import adapter/route/message，保留版本阻塞与聚合管理。

退出门槛：普通网页/YouTube/signed-out/signed-in/offline/account-switch Chrome E2E 通过。

### 27F-R：adapter 暂缺队列保留回归（已完成）

1. 文档先固定 `api=null` 是构建能力阻塞，不是授权撤回或账号失效；
2. Fresh RED 分别覆盖 enqueue/process/status 保留密文、counted `not-configured`、Popup retry 禁用与
   二次确认 clear；
3. 最小实现只拆开 adapter 与授权/session 清除分支，不改变 7 天裁剪、永久无效项、426、disconnect、
   换号或 consent 撤回规则；
4. 运行 Store focused、strict typecheck/build、目标 lint/format、instructions/architecture 并做实现后复审。

退出门槛已满足：上述行为证据与对照清除边界全部通过；真实服务、Chrome 与双平台手工验证仍保持
pending。当时根级 `format:check` 与 `lint` 仍分别只由 70 个既有文件和 `.agents/skills/**` 的 143 条
既有错误阻断；本阶段目标文件的 ESLint/Prettier 已通过，该根阻断后由 Phase 29 关闭。

### 27G：本机生词与 CloudWordCopy

1. 锁定 local-first，不让 cloud/session 失败进入本机保存事务；
2. 新词可选 copy、关闭后 future-only、显式本机批量导入；
3. 恢复/保留 LocalEudicImport/LocalLexiconExport，并与 cloud job UI/adapter 分区。

退出门槛：登录/退出/换号不改变 LocalLexiconEntry；cloud copy、批量导入与两套外部词典 journey 通过。

实现检查点：单条 future copy 和显式历史批量导入已完成 strict contracts、Postgres 原子 upsert、跨路径
context 精确去重、notes 保留与离线 PGlite 回归。Store 已完成完整快照预览（词数+语境数）、一次二次
确认、100 词/1,000 语境自动分批、独立加密任务、稳定 key retry、Options 聚合状态和账号/session 安全
清理。离线 actual Store/Web journey 已覆盖本机收藏→单条 copy、201 词多批续传、账号断开/换号，以及
LocalEudicImport→本机词库→显式 Cloud batch；两套真实外部词典服务仍待获批的 27H 目标环境验证。

### 27H：全量与真实验证 handoff

运行 `testing.md` 全部门禁、Cloud release evidence、macOS/Windows CI 和跨端离线浏览器验收；随后才分别
申请真实 Chrome、DeepSeek/OpenAI、Supabase/Vercel、Eudic/Shanbay 验证。未获批准的项目保持
`implemented; target validation pending`，不能据此开放邀请或提交商店。

实现检查点：Phase 27 旧 `/v1/analyses:import` 浏览器 fixture 已替换为 strict StudyCapture authority；
Store/Web 两侧 E2E support 均进入 TypeScript 门禁，CloudWordCopy local-first/关闭零写入/离线恢复也已
进入 actual Store/Web 联合 journey；显式历史导入已覆盖 201 词预览/二次确认、100+100+1 加密任务续传、
Web 重读与本机保留；账号断开另覆盖队列清理、本机保留和云端零写入。当前完整离线 Playwright 85/85
通过；换号再覆盖完整新配对交换、旧队列隔离与新 session 写入，LocalEudicImport→显式 Cloud batch
journey，以及 Cloud Eudic export/import 和 Shanbay 人工确认联合 journey 加入后，门禁更新为 90/90。
Eudic 失败→显式重试、Shanbay 两词部分成功和取消→当前租约迟到确认三条 journey 再把门禁更新为
93/93；AccountDataRights journey 加入后为 94/94，AdminOperations Operator/非 Operator 两条 journey
加入后更新为 96/96。全局生产入口矩阵已在 `browser-acceptance.md` 固化；`/practice/history`
actual-bundle 补充旅程加入后门禁更新为 97/97，AnalysisHistory `/history` 维护旅程再把门禁更新为
98/98；PairingApproval 旅程再把门禁更新为 99/99，PasswordAuthentication 注册确认与重登旅程更新为
100/100；AccountSignInMethods Phase A 未登记密码方式失败关闭旅程再更新为 101/101，Phase B 双向
绑定旅程继续更新为 103/103，already-linked stale 页面旅程再更新为 104/104；PasswordRecovery 更新为
105/105，普通 Google 登录三条旅程最终更新为 108/108。当时根 format 仍被仓库既有
`.agents/skills/**`、三个 Web 源文件、跨平台文档与 lockfile 共 70 个文件
阻断；根 lint 只剩 `.agents/skills/**` CJS 资产的 143 个错误，后由 Phase 29 关闭。Cloud release 开发态按设计失败关闭，真实服务、
候选公开配置、真实登录/部署与双平台 CI/Chrome 仍为 pending；断开、换号和本轮外部词典离线跨端矩阵
不再列为 pending。

Phase 26C 的升级恢复也已在 Phase 27 strict union 上完成 payload rebaseline：v3 outbox 只接受
StudyCapture/CloudWordCopy，legacy v1/v2 envelope 直接清除，426 阻塞、同版本零 fetch、版本变化恢复与
Popup 聚合均有当前回归。2026-08-14 实现后复审发现并修复 blocked current-card remove 误解除剩余队列
阻塞：fresh RED 后保留原版本标记、同版本继续零 fetch；focused 38/38 与完整离线门禁通过。状态为
`implemented; target-platform validation pending`。

Phase 27 release audit 已补齐文档—实现差距：公开材料缺少账号偏好、无自动 fallback、StudyCapture 原始
意图或本机词库/CloudWordCopy 独立边界时固定失败；旧 `/v1/analyses:import`、`pendingReview import` 和
登录后上传 BYOK 完整结果也固定失败。当前开发态 fresh audit 没有 Phase 27 误报，仅保留最终隐私事实、
候选公开配置和 Store null-origin 的预期阻塞。

## Phase 31：开发态发布阻塞基线

1. 文档先固定 `check:cloud-release` 正式 ready 与开发态 expected-blocked 是两个互不替代的入口；
2. Fresh RED 覆盖真实开发树必须精确命中九项固定 code，少一项、多一项均失败且输出只用安全 code；
3. 最小实现复用 `auditCloudRelease`，不复制候选规则、不读取 secret、不访问网络；
4. macOS/Windows 聚合门禁在 `build` 后立即调用开发态入口，再继续 E2E、包审计与平台特有步骤；
5. focused 与根质量门通过后回写 RED/GREEN 证据并复审正式候选语义未变。

退出门槛：新入口对真实工作树精确九项退出 0，集合少/多均退出非零；现有正式候选 fixture 仍
`ready=true`；双平台步骤顺序、format/lint/typecheck/build、instructions/architecture 全绿。真实候选与
外部环境验证状态不因此改变。

实现检查点：Phase 31 已按文档→自审→Fresh RED→最小 GREEN 完成。固定集合为 `privacy-not-final`、
六项 `release-config-*`、`store-api-origin` 与 `store-web-workspace-url`；真实开发树入口在 build 后静默
通过，focused 17/17、全量 118/118 Node 与 444 files / 2,721 passed / 12 skipped Vitest、macOS 聚合
109/109 Playwright 及其余离线门禁全绿。正式候选 ready 语义与外部门禁未改变。

## Phase 33：Store 权限必要性审阅

1. **需求方案**：逐项把 Manifest 的 `storage`、`unlimitedStorage`、`alarms`、content-script matches 和
   三个 host 映射到当前用户功能；权限没有当前调用或数据语义时删除，有必要时给出可审查的最小理由。
2. **技术与数据方案**：以 Chrome 官方权限/存储/网络文档为平台权威，源码为产品权威；分别盘点
   `chrome.storage.local/session`、IndexedDB、Cache Storage、OPFS 的实际使用，记录每个 vault/outbox 的
   schema 上限以及本机词库是否有总量 cap。不得把 `unlimitedStorage` 解释为无限物理磁盘。
3. **审阅裁决**：本机词库 IndexedDB 没有总词条/字节 cap，词典状态可达 20,000 outbox；local 中两个
   独立加密任务分别允许约 5 MiB 明文且可并存，删除权限会引入默认 10 MiB quota rejection 与 IndexedDB
   常规 eviction 风险，改变 local-first/耐久恢复语义。因此保留 `unlimitedStorage`；其余当前权限/host
   也都有固定调用，`tabs` 的当前非敏感操作无需新增权限。
4. **测试与验收**：本阶段是只读平台/源码审阅加文档校准，不制造无行为变化的单元测试；目标文档通过
   Prettier，仓库 instructions/architecture 通过。正式候选注入 Huayi API/Web origin 后仍须重跑发布
   审计、逐项核对实际 Manifest/CSP，并在 macOS/Windows Chrome 完成既有手工验收。

退出门槛：六份发布/状态文档的权限结论、容量边界、官方链接、源码位置与候选 pending 边界一致；不改
Manifest 或运行时代码，不运行真实服务、安装、Chrome 或 smoke。

## Phase 34：DeepSeek V4 Flash usage 与分时账本校准

1. docs-first 固定官方 usage envelope、2026-08-16T16:00:00Z 生效点、两个 UTC 半开 peak 窗口与三套
   micro-USD；自审确认 begin 不能代表实际 dispatch，因为 pre-dispatch reclaim 可跨窗；
2. Fresh RED 覆盖 `completion_tokens_details` 被 strict schema 拒绝、价格 schedule 缺失，以及 begin
   03:59:59.999→dispatch 04:00 的 production path 错选当前全局快照；
3. 最小 GREEN 新增 `DeepSeekPriceSchedule`，环境只提供三个互异 UUID。所有 generation 按 peak
   reservation，durable dispatch 用同一可信 UTC 时刻校验 DB 行并固定实际 UUID，Provider/settlement
   复用该快照；
4. 未发布 bootstrap 只为 `analysis_requests` 补 `dispatched_at` 与原子 transition，其他三类 task 复用
   既有 dispatch 字段。pre-dispatch 过期释放，post-dispatch 才保守结算；
5. focused 已覆盖四条付费路径、边界、DB 精确校验、usage schema、replay/fencing；最终 7 files / 55
   tests 与 API full 110 files / 407 tests 通过，API strict 及全 workspace typecheck/build、目标 lint/format、
   instructions/architecture 全绿，最终证据已回写 `release-evidence.md`。

离线退出门槛已关闭；但不能被解释为真实 DeepSeek/生产账单已验收。生产仍须受控插入三个不可变价格行、
部署 UUID、执行经批准最小真实请求并对账；不修改 Classic/Native Host，也不运行安装、Chrome 或真实
Provider。

## Phase 35：未跟踪交付候选范围盘点

1. **需求方案**：把产品交付文件、代理辅助资产和未引用 QA 截图分开，不用 `git diff --check` 推断未跟踪
   文件已进入候选，也不擅自删除或提交用户资产；
2. **技术方案**：以 `git ls-files --others --exclude-standard` 为权威输入，按精确目录和文件前缀计数；
   当前纳入候选的规则为 `.prettierignore`、API/Store Extension/Web、Cloud ADR/文档、三个 Cloud/domain
   package 及 Cloud release scripts；
3. **审查结果**：当前候选 610 个；`.agents/skills/**` 150 个是非 workspace 的代理辅助资产，
   `artifacts/**` 8 张截图未被源码或文档引用，两组均排除但保留；
4. **验收**：本阶段只完成只读盘点。取得用户对大规模 Git 纳入范围的确认后，按清单暂存/提交，再重新
   统计、运行 `git diff --check`、完整离线门与正式候选审计；未完成这些步骤前交付完整性保持 pending。

## Phase 37：排除邮件/域名/DNS 后的剩余工作路线（2026-08-20）

用户决定把域名购买、DNS、Resend、verified sender、支持邮箱、通知告警和相关生产部署放入独立新任务。
本路线不实施或替代该任务，也不把 R3-C 从发布阻塞项移除。其余工作按以下依赖顺序推进：

1. **A. 当前仓库交付收口（可立即离线推进）**
   - 先取得用户对 Phase 35 大规模版本控制纳入的明确授权；只纳入 610 个 Cloud 交付候选，继续排除且
     保留 150 个 `.agents/skills/**` 与 8 张未引用截图；不得把整个脏工作树无审查提交；
   - 纳入后重新统计候选、审查完整 diff 与 secret/生成物边界，运行 `git diff --check`、开发态发布审计、
     root format/lint/typecheck/test/e2e/build、instructions/architecture 和 `verify:macos`；
   - 对发布检查表中仍未关闭的 fake model/third-party 成功、失败、取消、超时、额度矩阵做一次源码/测试
     审计；只对真实缺口按 docs-first、Fresh RED→GREEN 补测试或最小实现，不为追求勾选重复已有覆盖。
2. **B. Windows 离线目标平台门禁**
   - 在 Windows + Node.js 26+ 运行 `pnpm verify:windows`、SEA package/health 与对应 CI；fake OS/registry/
     DPAPI 测试不能替代该证据；
   - 若失败，按根因补文档、回归和最小跨平台修复，再回到 macOS 与 Windows 双侧门禁；不使用已废弃的
     `windows-codex` 项目。
3. **C. 生产数据与身份平台验收**
   - 在邮件/域名独立任务提供正式 origin 后，核验 Supabase/Vercel 区域、空库/升级 migration、RLS
     多连接竞争、备份残留、CORS/Cookie/TLS、Google OAuth、password 登录与 session 撤销；
   - 演练 AccountDataExport 24 小时删除、账号主数据删除、对象存储/备份残留和跨设备恢复。该任务需要
     生产或隔离预发布环境与单独授权，不能用 PGlite/actual bundle 替代。
4. **D. DeepSeek 与计费真实对账**
   - 受控插入 legacy/off-peak/peak 三个不可变价格 UUID 行并核对部署配置；
   - 获得真实 API、费用和数据发送批准后，以最小额度验证 analysis、ExtensionQuery、语义建议和练习的
     model/usage/timeout/账单/UsageLedger 一致性，以及 kill switch、默认 grant 和保守结算。
5. **E. 双平台真实 Chrome 与升级验收**
   - 固定 Chrome Dashboard Store ID、Web/API origin 和最低版本后，在 macOS/Windows 真实 Chrome 验证
     安装/升级、普通网页/YouTube、platform/BYOK、StudyCapture、outbox、断开/换号、本机词库与
     CloudWordCopy；真实安装与 Chrome 操作必须另行批准；
   - Classic 0.13/Native Host 必须保持封存，不能被 Cloud 版本或安装流程改动。
6. **F. 外部词典真实验收**
   - 分别批准后验证欧路导入/导出与扇贝人工最终提交、重试、幂等和账本/任务状态；不得在默认测试中
     调用第三方服务或使用真实凭据。
7. **G. 运营、公开材料与商店候选**
   - 在生产事实固定后补齐运营主体、联系方式、区域、备份残留、正式隐私政策、数据问卷、商店文案和
     截图；重跑 permission/host/CSP/remote-code 审计；
   - 草稿上传和人工预审、最终公开提交、开放邀请分别取得明确批准。只有七条产品成功标准、全部双平台/
     真实服务门禁和 R3-C 独立任务都关闭后，才能把状态改为发布完成。

以上 A→B 是 Phase 37 当时的候选收口顺序，A 与首轮 B 均已完成。当前后续 Windows 节奏由 Phase 41
取代：先在 Mac 持续完成需求校准和功能切片，到候选冻结后再批量执行 Windows 门，不因普通小提交立即
回到 B。邮件/域名独立任务提供正式 origin 后，C→D→E→F→G 的外部依赖顺序保持不变。

## Phase 38：Vercel Hobby + Supabase Free 高频调度适配（2026-08-20）

影响平台为 `shared`；macOS 与 Windows 客户端支持均保留。该阶段只替换 production scheduler adapter，
不创建云资源、不部署、不处理域名/DNS/Resend，也不改变 Classic、Native Host、公开 API 或四个 worker
业务状态机。

1. **需求与技术方案**：以 `vercel-hobby-supabase-cron.md` 冻结四个固定 minute job、production-only
   安装、Vault 配置、精确 allowlist、权限撤销、≤55 秒网络 timeout、幂等重装和停用/恢复；明确该切片
   当时不解决未启用 Fluid 时 Hobby 60 秒与 DeepSeek 90 秒应用超时的独立冲突；该口径由 Phase 45
   supersede；
2. **文档审查**：同步 architecture/security/operations/testing/data-rights/ExtensionQuery/change-log，保留
   历史 Vercel Cron 记录但用本阶段新决策 supersede；确认 R3-C 不被误并为第五项；
3. **Fresh RED**：保留四个 route 挂载断言，新增 `vercel.json` 零 cron 与 operations SQL 静态安全契约；
   在 SQL 尚不存在且 Vercel 配置仍有 crons 时真实观察预期失败；
4. **最小 GREEN**：新增 `apps/api/operations/configure-supabase-cron.sql`，从 Vercel 配置删除高频 cron；
   不在应用 migration 或启动流程自动执行生产运维 SQL；
5. **离线验收**：focused、API full、strict typecheck/build、目标 ESLint/Prettier、instructions 与
   architecture 全绿，并复审 diff/secret/路径/Windows 边界；
6. **外部验收保持 pending**：独立部署任务配置正式 origin/Vault 后运行 SQL 两次并确认恰好四项，观察
   成功/401/5xx/timeout/恢复；Phase 45 后改为核验 Fluid/120 秒实际部署，并继续裁决个人非商业限制、
   Supabase Free 暂停/备份与 pg_net Beta。未取得授权前不执行。

Fresh RED 为 2 个文件中 3 个预期失败、2 个基线通过；GREEN focused 为 2 files / 5 tests。首次 API full
另暴露历史 dispatch-price 测试把 lease 到期硬编码在 2026-08-17，当前日期下被数据库正确拒绝；最小测试
修复只把 lease 改为相对当前时间 4 分钟，固定 dispatch 计费边界和生产实现不变。修复后该文件 5/5、API
full 111 files / 409 tests、API strict typecheck/build、目标 ESLint/Prettier、instructions/architecture 全绿。
最终根级 format/lint/typecheck/build、118/118 Node 脚本、446 个 Vitest 文件（2,743 passed / 12 skipped）
通过；Playwright 首轮 108/109 的 fake Google consent 导航超时在单条 1/1 与完整重跑 109/109 均通过，
没有修改认证行为。

离线退出门槛已关闭；状态为 `implemented; real Vercel/Supabase deployment pending`，不得称 Cloud V1
或正式发布整体完成。

## Phase 39：交付候选收口与 fake/third-party 矩阵（2026-08-20）

1. **范围审计**：按 Phase 35 精确规则重算未跟踪候选，纳入 613 个 Cloud 文件；继续排除且保留 150 个
   `.agents/skills/**` 与 8 张未引用截图。审查 90 个 tracked 修改、依赖、secret pattern、生成目录、文件
   类型/大小与 symlink，不使用宽泛 `git add .`；
2. **矩阵审查**：以 `testing.md` 2.1 为权威，只按各能力真实定义检查 success/failure/cancel/timeout/quota。
   复用已有 model、mail、Eudic、Shanbay、lease/replay 证据，不为勾选重复测试；
3. **Fresh RED**：证明 Store Eudic 默认调用在 10 秒后没有 abort，且 ExtensionQuery 接受超过 90 秒的
   非法 timeout；其余缺失项先作为 characterization regression，不伪称行为 RED；
4. **最小 GREEN**：Eudic client 增加固定 10 秒内部 deadline、正整数且不超过 10 秒的测试注入上限，并
   与 caller signal 合并；ExtensionQuery timeout 与其余 DeepSeek adapter 保持 1–90 秒失败关闭。补
   ExtensionQuery quota-before-provider 与四条 timeout regression，不改变公开 API/账本；
5. **候选收口**：运行 focused、Store/API full、全 workspace 静态门、root test/e2e/build、开发态/Store
   release audit、production dependency audit 和真实 macOS `verify:macos`；审查 staged manifest/diff 后只
   创建本地 Conventional Commit，不 push；
6. **Windows 边界**：本阶段保留 Windows 支持与 CI 契约，但 macOS 不能替代 Windows Node.js 26+
   `verify:windows`/SEA health；该证据继续进入下一项 Phase 37-B。

退出门槛：候选提交只包含 613 个核准未跟踪文件与已审查的相关 tracked 修改，排除资产仍在工作树；所有
离线门全绿。真实 Provider/词典、部署、安装、Chrome、邮件、域名与 Windows 目标机验证不在本阶段运行。

当前实现证据：Fresh RED 为 2 个预期失败 / 19 个基线通过，分别证明 Eudic 缺固定内部 deadline、
ExtensionQuery 接受 90,001ms；其余 quota/abort 用例作为 characterization regression 直接保持 GREEN。
最小实现后 focused 5 files / 21 tests、Store Extension full 97 files / 481 tests、API full 111 files /
413 tests 全绿；两包 strict typecheck/build 与目标 ESLint 通过。首次完整 Playwright 在真正越过
`2026-08-20T10:00:00Z` 后暴露 E2E harness 固定 session 已过期：首条本机批量导入失败并连锁使 8 条
词典 journey idle；改用独立、长期有效的测试 session 常量后，单条 1/1、受影响范围 8/8、完整重跑
109/109 均通过。最终 staged candidate 为 613 个新增 + 92 个相关修改，排除项仍恰好 158 个；根级
instructions/architecture/format/lint/typecheck/build、118/118 Node 脚本、446 个 Vitest 文件（2,748 passed /
12 skipped）、development blocker、Store release 与 production dependency audit 全绿，`pnpm verify:macos`
退出 0。Windows 目标机证据仍按计划进入 Phase 37-B。

## Phase 37-B：Windows Node.js 26+ 离线候选验证

1. **发布前置**：`origin/codex/settings-configuration` 必须先包含 `e9abf514807cd5bf9eba54c531a4d7d6ef426c05`
   和 `windows-validation-handoff.md`；Windows 以 `merge-base --is-ancestor` 失败关闭，不能在旧远端 HEAD
   上验证；
2. **Fresh 目标门**：在干净 Windows 10/11、Node.js 26+、pnpm 10.12.4 工作树执行
   `pnpm install --frozen-lockfile` 与 `pnpm verify:windows`；记录首轮真实结果；
3. **最小修复**：只有 Fresh 门失败时才在 Windows/shared 范围复现、补 regression 并修复；禁止新增
   skip、降低 audit/coverage、删除 Windows 支持或扩大到安装、凭据、真实 Chrome/Provider/词典/部署；
4. **完整 GREEN**：focused 只用于收敛，最终必须重新执行整个 `pnpm verify:windows`，确认真实 SEA
   package 与仓库外 `.exe` health；
5. **记录与推送**：按交接文档回写 Windows/Node/pnpm/HEAD/首轮/修复/最终数量/SEA/CI，精确暂存并
   Conventional Commit，普通 push 到同一分支；不得 force-push；
6. **返回复审**：当前任务在 Windows push 后核对提交、文档、CI 和 shared diff；Windows 自动门不关闭
   真实安装、Chrome、DPAPI、DeepSeek/Eudic、云部署或商店发布门禁。

本地退出门槛：Windows `pnpm verify:windows` 退出 0 且输出 `Windows SEA health verified.`，记录提交已
普通 push；若有任一项未满足，状态保持 `implemented; Windows target-platform validation pending`。
GitHub macOS/Windows CI 只有真实全绿后才关闭发布检查表总项；未触发时明记 pending，不阻止把本地
Windows 目标机结果交回当前任务复审。

## Phase 41：macOS 优先开发与 Windows 批量验证（2026-08-20）

本阶段采用 `macos-first-windows-batch-validation.md` 的新节奏，保留 Windows 支持和最终双平台门禁，
但不再为每个普通小提交立即执行 Windows 全量验证。

1. **41-A 产品需求校准**：在 Mac 继续优化需求，先同步产品、技术、数据、测试与验收文档并完成自审；
2. **41-B Mac 功能切片**：按文档 Fresh RED→GREEN，逐切片运行 focused gate，在阶段或高风险 shared
   边界运行完整 `pnpm verify:macos`；允许多个小提交累计；
3. **41-C Mac 候选冻结**：需求暂时冻结、无已知 P0/P1、Mac 完整门全绿、累计 diff 已审、工作树干净，
   普通 push 精确候选 SHA；
4. **41-D Windows 批量验证**：只对冻结 SHA 执行一次 fresh install + `pnpm verify:windows`；Windows 发现
   可集中修复，但最终必须在最新 SHA 从头重跑完整门；
5. **41-E 候选裁决**：Mac 与 Windows 最终证据必须指向同一 SHA。CI、真实安装/Chrome、凭据、Provider、
   词典和部署继续按各自授权与门禁单独记录。

当前 Windows 已验证代码为 `3aa143c`，当前 Mac HEAD `2a035ee` 比它新增品牌与跨平台候选稳定性两个提交；
两者进入下一批 Windows 验证，无需立即重跑。下一项是 41-A，邮件、域名、DNS、Resend 和真实部署仍在
独立任务中，不纳入本阶段。

## Phase 42：Cloud 数据边界公开披露一致性（2026-08-20）

1. **需求校准**：以现行 product/security 为权威，分别固定 BYOK、platform、StudyCapture、CloudWordCopy
   的接收方、字段、用途、保留和撤回语义；
2. **文档自审**：同步 `cloud-data-disclosure-consistency.md`、隐私草案、Store listing、testing、审计、
   状态和 change log，不填入邮件/域名/运营主体等未知生产事实；
3. **Fresh RED**：扩展 PrivacyPage、pairing 和 release-material tests，证明 actual `/privacy` 仍含“登录
   BYOK 上传/严格结果上传 Huayi”的旧边界；
4. **最小 GREEN**：只校准公开页面与材料，不改协议、API、数据库、Provider 或 Extension runtime；
5. **验收**：focused Web tests、actual bundle privacy/pairing、Web typecheck/build、目标 lint/format、
   instructions/architecture 与完整 `pnpm verify:macos`；Windows 进入下一冻结候选批次。

下一产品体验候选为统一 Web 工作台外壳与主导航；不与本轮隐私边界混改。

实现检查点：Fresh RED 为 focused Vitest 3 个预期失败 / 10 个基线通过与 actual bundle 2 个预期失败；
GREEN 为 focused 3 files / 13 tests、Web full 42 files / 192 tests、actual bundle 2/2、Web strict
typecheck/build 及目标静态门全绿。最终 `pnpm verify:macos` 退出 0，并覆盖 121/121 Node 脚本、Store
coverage、全部 workspace build、109/109 Playwright、release audits 与 production dependency audit。
状态为 `implemented and verified on macOS; Windows batch validation pending`。

## Phase 43：Web 工作台外壳与主导航（2026-08-20）

1. **需求校准**：固定七项一级导航、独立运营入口、练习历史/外部词典/设置子页归组、受限数据权利和
   非工作台页面边界；
2. **技术方案**：以 `CloudApp` 组合层的单一 WorkspaceShell deep module 替换 `PracticeShell` 和五份
   复制外壳；module 独占 route/order/active/skip link/details，各页面只返回内容；
3. **Fresh RED**：从页面可见 interface 证明今日练习 href、七项集合、子页 active 和窄屏折叠当前错误；
4. **最小 GREEN**：不引入 router/依赖，不改业务请求和状态；为词典子页补显式二级入口；
5. **验收**：focused/Web full、实际 bundle 桌面与 390px、Web typecheck/build、目标 lint/format、
   instructions/architecture 与完整 `pnpm verify:macos`；Windows 进入下一冻结候选批次。

实现检查点：Fresh RED 为 1 个缺失 suite、5 个预期行为失败与 12 个基线通过；GREEN 为 focused
4 files / 20 tests、Web full 43 files / 196 tests。实际 bundle 先暴露 closed details 的桌面无障碍树缺陷，
改为 media-query 控制的单一 details 后 Workspace journey 1/1；完整 Playwright 首轮再暴露两条旧移动
journey 未展开导航，按真实用户交互修正后 focused 2/2、最终 110/110。Web strict typecheck/build、目标
静态门和 `pnpm verify:macos` 全绿。状态为
`implemented and verified on macOS; Windows batch validation pending`。

## Phase 44：Web 语义设计 Token 收口（2026-08-21）

影响平台为 `shared + macOS`；Windows 保留支持并进入下一候选批次。该阶段只落实产品已规定的单一
皮肤与 Token-only 约束，不改变 DOM、路由、请求、数据或既有视觉值。

1. **Docs-first**：以 `web-design-token-contract.md` 固定 primitive → semantic → component 依赖、受控
   CSS 属性、结构性例外、TDD 和 actual-bundle 验收；同步产品、测试、审计、发布和状态文档；
2. **文档自审**：确认 breakpoint、结构尺寸、字体和 reset 不被误判，颜色/间距/圆角/阴影没有宽泛豁免；
   确认无需 architecture/data/API/security 变化；
3. **Fresh RED**：由 `main.tsx` 的生产 CSS import 清单驱动测试，解析声明并证明 `--red-600` 未定义、
   data-rights/privacy/StudyInbox 等入口仍含原始主题值；
4. **最小 GREEN**：扩充集中 registry，并等值替换所有生产入口违规值；不新增依赖、主题切换或运行时
   parser；
5. **实际产物**：在桌面与 390px 检查 `/app`、`/settings/data`、`/privacy` 的可见性、焦点、computed
   danger border/privacy background、零横向溢出与公共页零 API；
6. **退出门槛**：focused/Web full、typecheck/build、目标 lint/format、instructions/architecture/diff 和
   `pnpm verify:macos` 全绿。状态只能是
   `implemented and verified on macOS; Windows batch validation pending`。

本阶段不处理邮件、域名、DNS、Resend、部署、Provider、词典、安装或 Chrome。

实现检查点：Fresh RED 为 2 个预期失败 / 7 个基线通过，分别报告 1 个未定义引用和 33 个受控属性
违规。GREEN 静态契约 9/9、focused 4 files / 18 tests、Web full 43 files / 198 tests、actual bundle 3/3；
最终 `pnpm verify:macos` 退出 0，覆盖 121/121 Node 脚本、447 个 Vitest 文件、Store coverage 97 files /
481 tests、Playwright 110/110、全 workspace 静态/构建门、发布审计和 production audit。状态为
`implemented and verified on macOS; Windows batch validation pending`。

## Phase 45：Vercel Fluid Compute 与 API Function 时长（2026-08-21）

影响平台为 `shared + macOS`；Windows 支持保留并进入下一冻结候选批次。本阶段只关闭 API 部署配置的
离线缺口，不访问 Vercel、不部署，也不处理邮件、域名、DNS、Resend、Provider、安装或 Chrome。

1. **Docs-first**：以 `vercel-fluid-function-duration.md` 冻结当前 Vercel Fluid/Hobby 时长事实、90 秒
   应用总预算、120 秒 Function 上限、55 秒 Cron timeout 的独立边界和真实部署 pending；
2. **文档自审**：从四条生产 adapter 证明结构修复共用同一 timer，确认 4/5 分钟 lease/reservation 是
   恢复窗口而非请求时长；同步 architecture/security/operations/testing 与 Phase 38 历史口径；
3. **Fresh RED**：扩展 `production-app.test.ts` 解析真实配置，先观察当前 `vercel.json` 缺少 `fluid` 和
   `functions["src/server.ts"].maxDuration`；保留零 Vercel Cron 断言；
4. **最小 GREEN**：只在 API `vercel.json` 显式写入 `fluid: true` 与入口 `maxDuration: 120`，不改业务
   TypeScript、公开 API、Provider deadline、lease/fencing、账本或依赖；
5. **离线退出门**：focused/API full、strict typecheck/build、目标 lint/format、instructions/architecture、
   root 离线门与 `pnpm verify:macos` 全绿；回写 fresh 数字并审查 diff；
6. **外部验收保持 pending**：另行部署后在 Vercel Settings/Functions、部署产物和 Observability 验证
   Fluid、120 秒上限、90 秒应用 abort 与平台终止恢复；未授权前不执行。

状态在实现与 Mac 门通过后只能标记为
`runtime configuration implemented and verified on macOS; real deployment and Windows batch pending`。

实现检查点：Fresh RED 为 `production-app.test.ts` 2 个预期失败 / 3 个基线通过；最小 GREEN 只修改
`apps/api/vercel.json`。配置与四条 DeepSeek deadline focused 为 5 files / 25 tests，API full 为
111 files / 415 tests，API strict typecheck/build 与目标 lint/format 全绿。最终 `pnpm verify:macos`
退出 0，覆盖 121/121 Node 脚本、447 个 Vitest 文件（2,757 passed / 12 skipped）、Store coverage
97 files / 481 tests、Playwright 110/110、全 workspace 静态/构建门、发布审计、production audit 与
diff check。状态为
`runtime configuration implemented and verified on macOS; real deployment and Windows batch pending`。
