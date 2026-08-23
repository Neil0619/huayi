# 语见 Cloud V1 发布检查表

任何一项发布阻塞项未完成时，状态只能是 `implemented; validation pending`，不能向外部用户开放
hosted/production 邀请或宣称 Chrome Web Store 就绪。受控 `local-acceptance` 一次性自验邀请只用于
隔离测试，不等于对外开放邀请。

## 可用测试环境与用户验收

- [x] `local-acceptance` 可从空状态一条命令启动、status、stop 和 reset，并可重放
      migration/seed/bootstrap；Phase 47 在独立 project/network/ports 的无 volume 环境真实完成 start、
      offline install、无 dist build、HTTPS status、虚构状态写入、确认式 reset、重建聚合和 stop；
- [x] 本机公开端点均为 loopback 受信任 HTTPS；真实 API/Postgres/Auth/Store acceptance build 完成
      密码注册、Mailpit 确认、Cookie/CSRF 和核心学习闭环，重启及一次增量 migration 后数据仍在；隔离
      reset 没有修改主环境，主账号数据和会话在演练后复核保持；
- [ ] 独立 hosted acceptance 的 Supabase、Vercel API/Web 与自有根域同站子域已创建，且不与 production 共用
      数据、Auth、Storage、OAuth client、secret、Provider Key、额度或调度；Supabase Free 组织已创建，
      首次空 `us-east-1` 项目已在用户确认后删除，正确项目 `kpadiulxkgckskcfydry` 已在 Singapore 创建；
      Data API 已关闭，11 条 migration 已实际应用并经 Dashboard history/schema/roles/RLS 复核；Auth 仍为
      0 用户。用户已确认并完成 foundation bootstrap，创建 application login、三条价格、唯一 private
      empty bucket 和开启的 kill switch，初版 admin/application 验证均 passed；后续安全审查已把 TLS 收紧为
      显式 CA + verify-full，并加入精确角色图、越权 SQLSTATE 与同 backend 跨事务 context 隔离验证。更新后
      focused 与本轮完整 macOS 门、远端 hardened admin/application 双复验均已通过。第 12 条
      FirstOperatorBootstrap migration 已实际应用；Vercel API/Web 项目、Git/Branch、custom domain 与 TLS
      已建立；API 已产生 10 条 Production deployment 记录，当前 Latest/Current source 为 `7577cdd`；Web
      已有首次 Error 与第二次 Ready 两条记录，Ready source 为 `b87ef03`，随后已独立 disarm。Resend sender
      domain、分离 SMTP/HTTP key、Supabase Custom SMTP 与 API
      R3-C 配置也已完成；Supabase Auth Site URL 与五条 exact redirect 已配置，API 21/21（9 Sensitive、
      12 public）与 Web 2/2 public Production-only environment 结构复核通过。application DSN 已 Rotate，
      Rotate 后 exact-SHA API deployment `3fxCRe2xku5qzZ8kdbFo4GivGiRL` 已 Ready；独立 disarm 提交
      `00beea8` 未产生 API/Web deployment，API/Web Git deployment 当前均关闭。错误值导致的两次启动失败
      已保留；正确 Rotate 后 deployment `DyqRzj5UMN8BRpSeZyohXprnAkaT` 已通过 health 与无写入数据库探针。
      现有 API 的 Web-origin/外域 CORS OPTIONS 无写入预检已通过。首个 Web-only deployment
      `87fk9rqpGH2sUcGrzCf68tuXjyu8` 在精确 source `c9ee267` 上因 workspace dist 未先构建而 Error；独立
      disarm `26022a9` 没有触发第二条 Web 或 API deployment。`pnpm build:vercel` 本地修复已通过缺失 dist
      条件验证和完整 macOS 门；fix-only `aba1cc0` 已推送且没有新增 Web/API deployment；随后 reviewed
      re-arm `b87ef03` 产生 Ready deployment `6AAAVXP175oviEhrjULxH48eQjPu`，独立 `c5c25f5` disarm 未新增
      deployment，零账号公开 smoke 已通过。Phase 71 随后完成 API/Web 各一次 Google fail-closed/password
      callback hardening Ready + 独立 disarm，关闭提交均零新增；之后才进入 Auth/SMTP/首位账号 → Operator
      complete → DeepSeek 应用路径 smoke。邮件/Cron/邀请等完整运行
      验收仍未完成，因此本项仍未勾选；
- [x] 在正确 Rotate 后 exact-SHA `7577cdd` deployment 上通过 DB-backed application-role smoke；
      `GET /health` 为 200，随机无效 session 的 `GET /v1/quota` 为精确 401
      `authentication_required`。deployment ID/SHA/创建时间与 Git 关闭证据已记录，API 未重新武装；
- [x] `app.acceptance.<root-domain>` / `api.acceptance.<root-domain>` 的 DNS 与 Vercel domain 已验证；API
      custom-domain TLS、`/health` 200 和固定 JSON 已通过；Web Ready deployment、`/`/`/privacy` TLS 200、
      hosted SHA、secret-free bundle、无 Cookie CSRF/SSE 401 与密码 callback 400 headers 已通过。新的
      authentication hardening 候选已通过 fresh 完整 macOS 离线门、文档复审、API/Web one-shot
      redeploy/disarm、Google 404/隐藏、exact SHA 与 bundle scan；不撤销 Phase 70 已完成的 DNS/TLS 公共门；
      若曾使用
      `*.vercel.app` gateway 备用方案，目标子域仍已重新验收；
- [ ] `notify.acceptance.<root-domain>` 已在 Resend Tokyo 通过 SPF/DKIM 及 monitoring DMARC；旧泄露 key
      已撤销，两把 sending-only/domain-scoped SMTP/HTTP key 已分离托管，Supabase Custom SMTP 与完整 API
      Production environment 已配置；仍须完成真实投递、重复投递观测与告警接收验收；
- [x] R3-C outbox 固定 23 小时 deadline、最多 8 次与 failed/dead-letter 终态；超窗/耗尽在 sender 前
      终态化且零外调，同 notification ID 只在窗口内重放；固定 Resend adapter、独立通知 CRON production
      route/composition 与无正文 reason/count 告警 port 已由 fake fetch、PGlite 和 composition 回归证明；
- [ ] 用户已完成一次端到端清单和至少一个跨多日自然使用周期；P0/P1 清零，P2 均已修复或有用户接受的
      明确结论，每轮反馈/修复/回归/重新部署都有版本记录；
- [ ] 最新验收 SHA 已通过自动回归、macOS 完整门和对应 Windows 批次门，用户明确批准进入生产候选。

以上项目未关闭前不得开始 production cutover。本机验收继续使用 Mailpit；自有域名/DNS/Resend 已恢复为
托管验收准备项，但不用“域名已验证”冒充 production 通知完成。

## 自动门禁

- [x] `pnpm check:cloud-release` 在当前 null-origin/预发布政策开发态按固定安全 code 失败关闭；
- [x] `pnpm check:cloud-development-blocked` 在 build 后证明真实工作树恰好保留固定九项开发态阻塞，
      少项或多项均失败；
- [ ] 使用已核验的公开候选配置运行 `pnpm check:cloud-release` 并得到 ready；
- [ ] audit 输入中的候选/API Extension ID 与目标 Chrome Dashboard ID 相同，最低版本不高于候选版本；
- [x] 当前 macOS 工作树的 instructions、architecture、format、lint、typecheck、unit、API integration
      全绿；最新 Phase 70 门为 235/235 Node scripts、474/474 Vitest files（2,866 passed / 12 skipped）、
      Store 97 files 481/481 与 Playwright 110/110；
- [x] 当前 Web 与 Store Extension Playwright 110/110 全绿；测试使用隔离的 4173 Vite 服务，没有改写或
      重启当前 8443 验收环境；
- [x] 当前 macOS `pnpm verify:macos` 原样退出 0：235/235 Node scripts、474 个 Vitest files（2,866
      passed / 12 skipped）、Store 97 files 481/481、Playwright 110/110；instructions、format、lint、typecheck、
      architecture、workspace build、development blocker、Store release、production audit 和 diff 同轮通过；
- [ ] Windows Node.js 26+ 的 `pnpm verify:windows`、SEA health 与 CI 全绿；Phase 37-B 已在 Windows 11
      build 26220、Node.js 26.7.0 上本地退出 0，109/109 Playwright、SEA 仓库外 health 与 production
      audit 全绿；完整门证据提交 `3aa143c7f60ba52a941f2a2db587bc93819427eb` 已普通 push，但分支无
      开放 PR 且 GitHub Actions 无该分支 run，因此 macOS/Windows CI 未触发，组合项保持未勾选。Windows
      门按 Phase 41 在候选冻结节点批量执行，不要求每个普通提交后重跑。Phase 46 第二批已由用户确认在
      最终远端 `d451122b86c978732a599202437d82caaf03b3d4` 完成，但仓库没有第二批精确计数日志，且 GitHub
      CI 未触发，所以组合项仍不勾选。Phase 46 已把 `3aa143c..15306b4` 的 8 commits / 111 files
      代码范围和随后一个 docs-only 冻结提交纳入第二批候选（自上次 Windows 代码共 9 commits），且 Mac
      完整门已绿；Windows 本地批次已回证，组合项现在仅因 GitHub 双平台 CI 未触发而保持未勾选；
- [x] 数据库空库/升级 migration、RLS 多租户矩阵和账号删除恢复通过；仓库当前 12 条 migration 的 baseline、
      forward-only API/Supabase 镜像与生产角色回归均通过，实际一次性账号删除完成且重放权限不扩大；远端
      acceptance 已在 dry-run、用户明确确认后应用第 12 条 FirstOperatorBootstrap migration，修正版
      foundation verify 已通过且 Operator status 为 `empty`；
- [x] 当前开发态构建审计确认没有新增秘密、远程代码、动态 endpoint 或危险 HTML；
- [ ] 正式候选注入公开配置后重新执行完整构建审计，并复核每项 permission/host；
- [x] fake model/mail/third-party 已按各能力真实定义覆盖成功、失败、取消、超时和额度分支；没有额度或
      自动 HTTP 请求语义的 mail/Shanbay 不虚构 quota/timeout。Phase 39 另补 Eudic 固定 10 秒内部
      deadline、ExtensionQuery quota-before-provider，以及四条 DeepSeek production adapter 的实际 abort
      回归；真实服务仍是独立门禁。
- [x] Phase 27 契约证明 compact ExtensionQueryResult 不能解析为 WebDeepAnalysis/AnalysisRecord，旧
      `/v1/analyses:import` 和 `analysis-import` outbox item 已从当前产品路径移除；
- [x] 三项账号偏好默认值、revision、配对原子选择、全部设备同步和无自动 fallback 有 domain/API/Web/
      Store 回归；
- [x] StudyCapture exact dedupe、created-only undo、离线恢复、stale revision、分析/reanalysis/delete 关系和
      CloudWordCopy local-first 有 PGlite 与跨端回归。
- [x] Phase 47 已在 production 本机 HTTPS/API/Postgres/Auth/Mailpit 上实际完成 ExtensionQuery、
      StudyCapture、CloudWordCopy、设备自断开与一次性账号删除；bodyless DELETE 为 `body=null`，同 proof
      断开重放 204、旧 token 401，账号删除回执只经 context-setter-only wrapper 重放；这项只证明服务端
      契约，不替代真实 Chrome Extension UI/vault/outbox 验收。
- [x] Phase 28 语义建议已有 strict HTTP、固定 DeepSeek adapter、paid/Postgres durable authority、价格/
      kill/quota-before-fetch、CRON cleanup、Web 无自动重试及 actual-bundle suggestion→preview→显式
      confirm→server reread 离线证据；AA semantic token 组合也有可计算回归。

## 生产事实

- [x] R3-C 生产代码已固定使用 Resend HTTPS sender、独立通知 CRON production route/composition 和
      无正文告警 port；provider error、deadline、尝试耗尽及 persistence failure 都不会记录邮箱/owner/
      正文/raw error。本条只关闭本机代码，不证明 verified sender、真实投递或监控接收方；
- [ ] R3-C 外部前置条件部分完成：`seen-said.cn` 已在腾讯云购买/实名，权威 NS 已由两个独立 DoH
      解析器核验为 Cloudflare，Tokyo 的 `notify.acceptance` sender domain 已通过 SPF/DKIM/monitoring
      DMARC；旧泄露 key 与两把未使用的错误/临时 R3-C key 均已撤销，两把最小权限正式 key 已分离托管，
      Custom SMTP 与完整 API Production 配置也已写入对应 hosted secret/config。仍须完成真实投递、重复投递观测与
      无正文告警接收；不能把本机 Mailpit、域名验证或配置成功当 production 证据；
- [x] DeepSeek 官方文档事实已校准：固定 `deepseek-v4-flash`、thinking + JSON、非流
      `completion_tokens_details.reasoning_tokens`，以及 2026-08-16T16:00:00Z 起两个 UTC peak 窗口和
      legacy/off-peak/peak 精确价格；离线 adapter/分时账本实现与回归已完成；
- [ ] 生产环境插入并核对三个不可变价格 UUID 行，部署三个 UUID 配置，并以经批准真实请求核验模型、
      usage、timeout、实际账单与 UsageLedger 一致；
- [ ] 真实 DeepSeek 语义建议在受控小额度下核验固定 endpoint/model、usage、价格、timeout 和账本；不得
      用离线 fake fetch/authority 代替费用或网络事实；
- [ ] Supabase/Vercel 区域、部署前 TLS、Auth Site URL 与五条 exact redirect 已核验；备份残留、真实 OAuth
      callback、CORS/Cookie 和部署后 TLS 仍须在首次 API→Web deployment 后核验；
- [ ] 目标网络验证 Google OAuth、邮箱密码、Web SSE 与新加坡区域延迟；
- [ ] 生产价格快照、默认 1 美元 grant、限速、kill switch 和无正文告警已演练；
- [ ] AccountDataExport 独立私有副本 ready 后 24 小时删除、snapshot 纳入未过期平台查询且不延长原
      generation 一小时期限、主库 24 小时删除和 session 即时撤销已演练。

## macOS 与 Windows Chrome

- [ ] 新 Store ID 与固定 Web/API origin、配对回调和 Manifest 一致；
- [ ] 普通网页与 YouTube 验证 SelectionKind、无标点完整字幕、选区、取消、媒体恢复，以及 platform/BYOK
      两种模式使用同一精简 ResultCard；
- [ ] 未登录 BYOK 对 Huayi 零请求；登录后的 BYOK 精简结果也不上传；平台查询最多一小时恢复且不进入
      `/history` 或 ReviewInbox；任何失败都不自动切换模型路径；
- [ ] 手动/自动 StudyCapture 只发送原文和 kind；created-only 当前卡撤销、existing 无撤销、关卡丢失
      撤销、stale revision 与重复采集语义正确；
- [ ] 离线 outbox 显示“待联网加入/复制”，重启恢复、上限/过期、账号切换/断开清理和二次确认清空正确，
      不称本机队列为已进入 Web；
- [ ] “断开此设备”先撤销当前服务器 DeviceSession，再清账号绑定本机状态；网络失败保留 token/队列，
      旧版本仍能退出，其他设备、Web session、本机词库与 BYOK/外部词典凭据不受影响；
- [ ] 本机生词在未登录、登录、退出和换号后保持；CloudWordCopy 失败不回滚本机，关闭后 future-only，
      显式本机批量导入先预览数量并二次确认；
- [ ] 经独立批准验证欧路导入/导出和扇贝人工最终提交。

## Chrome Web Store 与公开材料

- [x] Web 精确 `/privacy` 无需 API Origin、Cookie 或登录即可离线渲染预发布事实；
- [ ] 补齐运营主体、联系信息、生产区域、备份残留并把 `/privacy` 从预发布升级为正式政策；
- [x] 单一用途说明以英文理解和学习闭环为中心，Web 不被描述为远程代码宿主；Cloud listing 已明确
      “主动选择的英文”与“分析、整理、学习与练习闭环”，并明确不下载或执行远程扩展代码；材料回归固定
      这些边界；
- [x] Phase 33 已逐项绑定当前 permission/host 到源码调用；`unlimitedStorage` 由正式本机词库、词典
      IndexedDB 及可并存且合计可超过 10 MiB 的加密 `storage.local` 耐久状态证明仍需保留；当前没有
      不再需要而应删除的 Manifest 权限；
- [ ] 隐私政策有公开 HTTPS URL，并准确披露 Huayi、DeepSeek、Supabase/Vercel、Google、邮件和词典；
- [ ] 数据问卷、截图、商店文案、首次云端同意与产品行为一致；
- [x] Phase 42 `/privacy`、配对审批、隐私草案和 Store listing 已分别披露 BYOK、platform、StudyCapture、
      CloudWordCopy，且不再出现“登录 BYOK 上传/严格结果上传 Huayi”旧语义；
- [x] 披露分别说明 BYOK Provider、平台插件查询、StudyCapture、CloudWordCopy、本机词库和云端学习
      内容；listing、隐私草案和实际 `/privacy` 页面回归禁止“登录后上传 BYOK 完整结果”及旧 import
      语义；
- [ ] 草稿上传的权限/远程代码/数据预审通过；最终公开上传另行批准。

## Web 工作台外壳

- [x] Phase 43 所有 full-session 学习工作台页面使用同一 WorkspaceShell，普通一级导航恰好七项且
      route/order 一致；
- [x] 练习历史归入今日练习、外部词典归入生词、账号子页归入设置，运营不扩张普通一级导航；
- [x] data-rights-only 会话、运营、公共、认证、恢复和配对页面不暴露完整学习工作台导航；
- [x] 390px 窄屏 details、键盘展开、skip link、active、桌面侧栏和 actual route 跳转均由浏览器测试证明。
- [x] Phase 37-A 当时已将重算的 613 个未跟踪交付候选纳入该批精确 staged candidate：
      `.prettierignore` 1、API 294、Store Extension 75、Web 152、ADR 14、Cloud 文档 43、Cloud contracts 22、
      learning-domain 1、store-domain 9、Cloud release scripts 2；明确排除但不删除 `.agents/skills/**`
      150 个代理技能资产和 `artifacts/**` 8 张未引用截图。该条是历史候选证据，不描述当前 index；当前
      工作树是否 staged 只以 `git status`/`git diff --cached` 为准。

## Web 设计 Token

- [x] `main.tsx` 引入的全部生产 CSS 通过 Token 引用闭包，零未定义 `var(--*)`；
- [x] 颜色、间距、圆角和阴影的受控属性全部经集中 registry，结构性例外与
      `web-design-token-contract.md` 一致；
- [x] `/app`、`/settings/data`、`/privacy` 在桌面与 390px 的实际产物中无横向溢出，危险区边框与隐私
      背景 computed style 有效，焦点可见且公共隐私页零 API。

## Vercel API 运行时

- [x] 首次 API-only policy 精确为 `"**": false` +
      `"codex/settings-configuration": true`；Web 继续 `deploymentEnabled=false`，没有同时解锁；
- [x] `apps/api/vercel.json` 显式 `fluid: true`，且唯一 `src/server.ts` Function 的 `maxDuration` 为 120；
- [x] 配置回归同时证明没有 Vercel Cron、宽泛 Function override 或 legacy `builds`；
- [ ] 真实部署后在 Vercel Settings/Functions、部署产物和 Observability 核验 Fluid 与 120 秒上限；该项
      不能由静态 JSON 或 macOS 离线门勾选。

## Hosted Web 公共门

- [x] reviewed re-arm `b87ef03` 只产生 Web deployment `6AAAVXP175oviEhrjULxH48eQjPu` 并 Ready；记录
      出现后先以独立 `c5c25f5` 恢复 Web Git deployment 关闭，且没有新增 Web/API deployment；
- [x] `app.acceptance.seen-said.cn` 的 `/` 与 `/privacy` 为真实 TLS/HTTP 200，页面显示
      `Hosted 验收 · b87ef03` 且不显示本机模拟模型；HTML/JS/CSS 发布产物秘密扫描为零；
- [x] 无 Cookie 的 CSRF 与分析入口均为精确 401；缺 flow/code 的密码 callback 为精确 400，并保持
      `private, no-store` 与 `no-referrer`；
- [x] 远端只读计数确认 Auth/profile/admin/invitation/analysis/usage/rate-limit/audit/首位 Operator 共 12 项
      全部为 0；公共门没有创建账号、发送邮件、调用 Provider 或切换 kill switch；
- [x] Phase 71 API/Web hardening 各只产生一条 exact-source Ready，独立 disarm 均零新增；API 九条 Google
      route 全部 404，Web `/login` 为 exact SHA、密码专用文案与零 Google 控件，bundle secret scan 为零；
- [x] Supabase `Confirm sign up` 保存态模板使用动态 `{{ .ConfirmationURL }}`，没有硬编码 URL、localhost、
      测试域或旧密码 callback；API `emailRedirectTo` 继续进入 ConfirmationURL 的 `redirect_to`；
- [x] Phase 71 上述 `ConfirmationURL` 仅保留为历史回读；真实验收已证明它会被 scanner/prefetch 提前消费。
      保存并回读 `{{ .Token }}` + `{{ .RedirectTo }}` 模板及五条 43-character flow allowlist；
- [x] Phase 72 候选 `be38942` 已在双关闭下 push；Vercel 默认 6/7 状态筛选下 API/Web 可见数保持
      14/3 且新增均为 0；
- [x] 只读 status 为 `registration-interrupted`，application login verifier 通过；0013 dry-run 只列出
      `20260823010000_password_signup_interruption_recovery.sql` 且数据库未修改；
- [x] 明确确认后实际 push 0013，验证 migration/ACL/application login；不得在当前非空状态要求 pristine
      foundation verifier；
- [x] 严格执行 API arm→deployment record→独立 disarm，再执行 Web 同序；两个 disarm 均未在其目标
      项目新增 deployment，但各自在另一仍 disarmed 项目留下一条 Canceled 审计记录；两个项目从不同时
      armed，并记录同一 reviewed lineage 而非虚构相同 SHA；
- [ ] 浏览器从原邀请页面发起恢复并自动提交内存 token + Provider 密码证明；API/0013 在写入前以
      Production pepper 验证 hash、active invitation 与精确中断状态，取得 `registered` 后完成首位 Operator；
- [x] First Operator complete 后先通过 post-completion verifier；最终 read-only status 精确为
      `completed`，未跳过该只读门创建普通邀请；
- [x] `/admin` 密码重新认证已本地 RED→GREEN：首次统一 `forbidden` 显示可重试表单，成功轮换 CSRF 并
      重读权限，第二次仍拒绝时失败关闭；尚未部署或取得 Hosted 浏览器证据；
- [ ] 受控部署并完成真实 `/admin` 密码重新认证后，新邀请再完成 scanner/repeated GET 无副作用、显式
      OTP POST、Web 落点和密码重登；完成前不得运行 DeepSeek 应用路径 smoke。

## 完整 V1

- [x] 当前 production 本机构建以实际登录会话巡检待分析、待收藏、分析、学习库、生词、分析历史、今日
      练习、账号与数据权利页面；公开 `/privacy` 同时复核，全部标题/空态/已有数据读取正常且浏览器无
      warning/error。该证据不替代真实 Store Extension 或 hosted 验收；
- [ ] CaptureInbox 待分析、ReviewInbox 待收藏、Web V2 深度分析、学习库、生词、历史、两种练习、账号
      偏好、设备、额度、管理、导出/删除均可用；
- [x] 当前审计发现的本机高严重度安全/数据缺陷已关闭：月切额度、生产持久限速、R3-C 无限 retry 与
      导出过期清理均有回归；安全通知和新增日志只含固定 reason/count，无未披露正文。真实外部服务门禁
      仍由本表其他未勾选项跟踪；
- [x] Classic 0.13 与 Native Host 没有被 Cloud 构建、部署或版本流程改动；当前
      `apps/extension`、`apps/native-host`、`packages/protocol` diff 为 0，验收构建只构建
      learning-domain、cloud-contracts、API、Web，完整门继续固定 0.13/wire 7 与 Store release；
- [ ] 变更记录、项目状态、运行手册和回滚步骤与候选构建一致。
