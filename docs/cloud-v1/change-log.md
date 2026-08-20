# 华译 Cloud V1 决策变更记录

本文件记录需求与技术方向的实质变化。每项变更必须同步到受影响的权威文档和 ADR；实现状态不在
这里记录。

## 2026-08-20：登录后 Web 页面统一由 WorkspaceShell 拥有一级导航

- 普通账号一级导航保持产品既有七项及固定顺序，不因外部词典或练习历史子页扩张；
- 练习历史归入今日练习，外部词典归入生词，完整会话的账号/设备/数据权利归入设置；运营保持独立权限
  面，只从已验证 Operator 的账号设置进入，不追加普通一级导航；
- `CloudApp` 组合层的 WorkspaceShell 独占品牌顶栏、skip link、一级路径、active、data-rights-only 受限
  形态与窄屏原生折叠菜单，业务页面不再复制外壳；
- 公共、认证、密码恢复、Extension 配对、session 未确认和独立运营面不显示完整学习工作台导航；
- 本阶段不引入客户端 router，不改变业务请求、状态、协议或数据结构。

## 2026-08-20：公开披露必须分开 BYOK、platform 与两类云端学习动作

- BYOK 查询只把最小输入发送该设备所选 Provider；API Key 与精简结果不发送语见，不产生待整理或分析
  历史；
- platform 查询由语见 API/平台 DeepSeek 处理，正文与精简结果最多保留一小时用于恢复和幂等；
- StudyCapture 与 CloudWordCopy 是用户分别选择的独立云端学习动作，不能被称为“BYOK 结果上传”；
- `/privacy`、配对审批、隐私草案和 Store listing 必须对四类动作、接收方、保留和撤回语义一致；
- 本轮只修复公开披露漂移，不修改协议、API、数据库、Provider 或 Extension runtime。

## 2026-08-20：Windows 验证改为候选冻结节点批量执行

- 保留 Windows 支持和发布前双平台门禁，但不再要求每个普通小提交后立即切换 Windows 跑全量门；
- 日常需求优化和功能切片先在 macOS 完成文档、Fresh RED→GREEN 与风险相称的验证，阶段节点运行
  `pnpm verify:macos`；
- 需求暂时冻结、Mac 完整门全绿、无 P0/P1、工作树干净且精确 SHA 已 push 后，才执行一轮 Windows
  fresh install + `pnpm verify:windows`；
- DPAPI、PowerShell、注册表、SEA、Windows 安装器、Windows-only 故障、共享 Native Messaging/传输和
  Windows 发布操作会提前触发有界冻结点；相关修复可集中，最终仍须对最新 SHA 完整重跑；
- 旧 Windows 证据不覆盖之后的新提交；批次未执行时必须明确保留 Windows pending，不得宣称跨平台
  候选或发布已完成；
- 邮件、域名、DNS、Resend 与真实部署继续在独立任务处理，不纳入该批次。

## 2026-08-20：Windows Fresh 门固定 workspace source 解析与精确异步等待

- Fresh Windows 首个 RED 是根 `AGENTS.md` 12,404 字节超过 12 KiB；语义压缩至 12,287 字节后，门禁
  继续证明 Store Vite 与 coverage 不能依赖 workspace 包已预建 `dist`。两份配置改用同一组 workspace
  source alias，使 fresh checkout 与常规 workspace build/test 解析一致，不放宽 coverage 或发布审计；
- actual-bundle journey 的筛选动作必须重新选择当前视图中的条目，不能沿用切换到“已归档”前的详情；
  Google 离线 journey 也不再以默认 5 秒标题断言间接等待两个 API 和重定向，而是等待精确 Provider
  HTTP 200。targeted 9/9 通过，最慢 12.4 秒；
- 最终 Windows `pnpm verify:windows` 退出 0，覆盖 109/109 Playwright、Store coverage、9 个 build、
  development/Store release audits、无漏洞 production audit 与仓库外 SEA health；这些 shared/build/test
  修复不改变 Classic wire、Provider、权限、数据模型或任何外部发布边界；完整门证据提交
  `3aa143c7f60ba52a941f2a2db587bc93819427eb` 已普通 push，该分支无开放 PR 且 GitHub Actions 无分支
  run，因此远端 macOS/Windows CI 未触发。

## 2026-08-20：冻结 Phase 37-B Windows 离线验证交接

- 保留 Windows 支持；下一阶段只验证 Node.js 26+ 完整离线门、SEA package 与仓库外 `.exe` health，不把
  macOS fake 或历史 Windows 记录冒充当前 Cloud 候选证据；
- 新增独立交接文档，固定 `e9abf51` 候选祖先、同一远端分支、干净工作树、Fresh 结果、修复边界、最终
  全门、Conventional Commit、普通 push 和返回摘要；
- 明确废弃 windows-codex 项目不得恢复；Windows 使用 Codex App 原生任务；
- 邮件/域名/DNS/Resend、安装、真实 Chrome、DPAPI、Provider/词典、云部署和商店操作继续保持独立授权，
  不因 Windows 自动门通过而关闭。

## 2026-08-20：交付收口前补齐 Eudic deadline 与 fake 分支矩阵

- Phase 37-A 重算得到 613 个未跟踪 Cloud 交付候选；`.agents/skills/**` 150 个和 `artifacts/**` 8 张仍
  精确排除且保留。范围审计同时确认没有意外路径、生成目录、凭据文件、私钥、压缩包、symlink 或超过
  1 MB 的候选；
- 发布检查表的 fake model/mail/third-party 条目改用“能力实际定义的分支”矩阵，不为邮件或人工 Shanbay
  页面虚构模型额度/HTTP timeout；
- Store Cloud Eudic 默认 alarm/bridge signal 不会自行 abort，而 client 原先没有内部计时器，因此
  `timeout` 码不能保证触发。固定复用 Classic 的 10 秒请求 deadline，与 caller abort 合并；任何超时只
  形成稳定失败并等待显式 retry，不自动重复第三方写入；
- 另补 ExtensionQuery quota-before-provider、ExtensionQuery timeout 配置失败关闭，以及
  ExtensionQuery/suggestion/practice 实际 timeout abort 回归；不改变 Provider、价格、账本或公开契约。

## 2026-08-20：高频 worker 调度从 Vercel Cron 移到 Supabase Cron

- Vercel Hobby 不接受分钟级 Cron，因此 `apps/api/vercel.json` 不再声明四项 `* * * * *`；四个既有
  `CRON_SECRET` route、业务状态机、lease/fencing、批次上限和 Windows 支持均不改变；
- production 改由 Supabase `pg_cron + pg_net` 每分钟独立调用 password recovery、data rights、
  ExtensionQuery cleanup 和 duplicate suggestion cleanup。管理员运维 SQL 从 Vault 运行时读取正式 HTTPS
  API origin 与 cron secret，固定四路径 allowlist、search_path、超时与角色撤权，并以固定 job name
  幂等重装；local/preview 不自动安装；
- 该变更只解决高频调度适配，不能宣称整个 Cloud V1 已兼容 Hobby。Hobby 的个人非商业用途和 60 秒
  Function 上限、当前 DeepSeek 90 秒应用超时、Supabase Free 暂停/无自动备份及 `pg_net` Beta 仍须在
  独立部署任务裁决；本阶段不创建云资源、不配置域名/DNS/Resend、不运行真实服务；
- R3-C 安全通知不加入第五个 job，继续作为邮件与生产告警独立任务的发布阻塞项。完整方案见
  `vercel-hobby-supabase-cron.md`。

## 2026-08-20：R3-C 生产邮件前置条件延期，不以占位配置推进

- 用户确认当前没有自有正式域名、DNS 管理方、Resend 账号、verified sender、真实支持邮箱或告警
  目的地；这些外部条件全部保持待处理，本阶段不购买域名、不注册邮件服务、不创建 API key、不添加
  DNS 记录，也不继续真实 sender/CRON/告警实现；
- fake sender、PGlite 和 actual-bundle 只保留为离线契约证据，不得据此关闭 R3-C 或宣称生产密码恢复
  通知可用；
- 后续恢复时暂定优先评估 Cloudflare Registrar + Cloudflare DNS、独立 `notify.<root-domain>` 与
  Resend；国际支付或账号条件不便时评估腾讯云域名 + DNSPod。购买前必须重新核验域名可用性、注册/
  续费价格、Resend 配额/价格、支持邮箱和告警责任人，并取得用户明确批准。

## 2026-08-14：Cloud 候选与代理辅助资产分开盘点

- 当前未跟踪 Cloud 交付候选按精确目录/文件规则计为 610 个；该集合包含根 Prettier 门禁配置、
  API/Store Extension/Web、Cloud ADR/文档、Cloud/domain packages 与 release scripts；
- `.agents/skills/**` 150 个文件不在 workspace、产品运行时或发布包，继续排除出 Cloud 候选；
  `artifacts/**` 8 张未被源码/文档引用的 Classic/本地 UI 截图也不作为 Cloud 发布证据；两组均保留，
  不因本次盘点删除；
- 盘点不等于版本控制纳入。本轮不执行 Git 暂存/提交；候选实际纳入后必须重新统计、运行 tracked diff
  检查和候选发布审计。

## 2026-08-14：DeepSeek V4 Flash 按 durable dispatch 固定实际分时价格

- 官方非流 thinking 响应允许可选 `completion_tokens_details`；严格 Provider schema 接受空对象或可选
  非负 `reasoning_tokens`，但公共 usage/日志/账本不新增 reasoning 字段，output 继续使用
  `completion_tokens`；
- 2026-08-16T16:00:00Z 前使用 legacy 三价；生效后 UTC `[01:00,04:00)` 与 `[06:00,10:00)` 使用
  peak，其余使用 off-peak。部署环境不再提交任意单价，只提交三个互异不可变价格 UUID；
- begin 不是计费时间：pre-dispatch lease reclaim 可以跨窗。新 generation 先按 peak 上限 reservation，
  紧邻 fetch 的 durable dispatch transition 才以同一个服务端 UTC `now` 选择、校验并持久化实际快照；
  settlement 与 post-dispatch 恢复永远复用该 UUID；
- 分析 request 增加最小 `dispatched_at` 内部列以区分安全释放与不确定费用；公开 `/v1`、Cloud contracts、
  Classic wire v7、Native Host 和浏览器权限不变。完整方案见 `deepseek-v4-billing.md`。

## 2026-08-14：Store `unlimitedStorage` 由正式本机数据和耐久恢复证明保留

- Chrome 官方语义确认该权限解除 `chrome.storage.local`、IndexedDB、Cache Storage 与 OPFS 配额，并
  使扩展免于通常的存储驱逐；当前产品只以实际使用的 `storage.local` 和 IndexedDB 作为申请理由，不用
  未使用的 Cache Storage/OPFS 扩大理由，也不承诺无限物理磁盘或绝对不丢数据。
- LocalLexiconEntry 是独立正式本机数据；其 IndexedDB 没有总词条或总字节 cap。外部词典耐久状态另有
  最多 20,000 项 outbox。`storage.local` 中 SubmissionOutbox 与本机批量导入各允许约 5 MiB 明文、加密
  后可同时存在，连同 DeviceVault/session/设置会超过无该权限时的 10 MiB 总配额。
- 删除 `unlimitedStorage` 会重新引入 quota rejection 和 IndexedDB 常规 eviction 风险，改变本机词库
  local-first 与任务重启恢复语义，因此 Phase 33 裁决保留。`storage`、`alarms`、三个精确 HTTPS API
  host 也保留；当前只读 tab ID/创建固定 URL 标签页/发送固定消息不要求新增 `tabs`。
- 该源码审阅不替代正式候选的一致性门禁：Huayi API origin 固定后仍须加入精确 host/CSP，重跑发布
  审计并在目标 Chrome 复核实际候选包。

## 2026-08-14：完成度按七条产品成功标准与六层证据重新判定

- 完整 V1 不再用 A/B 等级或已实现功能域反推；七条成功标准必须各自绑定 production source、
  strict contract、database/RLS test、actual-bundle 用例、fresh 命令和剩余外部门禁，任一缺失层
  都要显式写出。
- 密码恢复 R3-C 的真实安全通知 sender、通知 CRON 生产组合和告警尚未实现；邮件厂商、
  verified sender/域名、联系方式和告警渠道也尚未决策。因此它同时是生产代码与外部决策缺口，不得
  误记为纯验证 pending。
- `git diff --check` 只检查已跟踪差异；当前尚有未跟踪 Cloud V1 交付文件，因此候选交付范围
  确认、入库及入库后重跑仍是发布前门禁。

## 2026-08-14：正式候选 ready 与开发态 expected-blocked 使用独立门禁

- `check:cloud-release` 继续只回答正式候选是否 ready，不改变配置、返回结构或退出语义；
- 新增显式开发态入口，只在真实工作树的发布审计 blocker 与版本化九项集合完全一致时成功；少一项代表
  部分候选化，多一项代表新增漂移，两者均失败；
- 开发态集合只含固定安全 code，不新增持久数据、不读取 secret、不访问网络，并在双平台聚合门禁的
  build 后运行。它不能替代真实候选、部署、Chrome、Provider 或第三方服务证据。

## 2026-08-14：根质量门只排除代理技能资产，产品工作树继续全量受检

- `.agents/skills/**` 被确认是 Codex/ClaudeKit 设计技能、参考资料、模板与独立 CommonJS 脚本；它不在
  pnpm workspace，不被产品源码/构建引用，也不进入 Huayi 运行时或发布包，因此不属于产品格式/lint
  质量门。
- 排除范围固定为精确 `.agents/skills/**`，不得扩大到 `.agents/**`；`apps/**`、`packages/**`、
  `scripts/**`、产品文档、根配置、manifest 与 lockfile 继续由根门禁检查。
- Fresh RED 中剩余 3 个 Web 源文件、跨平台文档与 lockfile 必须以现有 Prettier 机械修复，不通过新增
  ignore、规则降级或手工语义改写绕过。完整需求、技术路线、测试与验收见
  `root-quality-gates.md`。

## 2026-08-14：SubmissionOutbox 将 adapter 缺失与授权失效分离

- 有效 extension session 与 Huayi 数据同意仍在时，production API adapter 缺失只表示当前构建无法
  提交，不表示用户撤回授权或账号失效；既有账号绑定密文必须保留，不能在 `enqueue/process/status`
  任一路径清除。
- 公共 `not-configured` 在存在保留项时携带有界 count/oldest，使 Popup 明确显示密文仍在本机并允许
  二次确认清空；该状态禁用手动/自动重试，不暴露正文、幂等键、session 或 endpoint。空队列仍返回
  无聚合字段的 `not-configured`。
- 撤回同意、session 缺失/过期或鉴权失败、设备断开/换号仍是清除边界；426 继续使用独立耐久版本
  阻塞。测试必须先用有效 session + 同意 + `api=null` 的 Fresh RED 证明误删，再验证这些安全边界未被
  放宽。

## 2026-08-14：完整离线完成度必须补语义建议与可计算 AA 证据

- production Web 路由齐全不等于完整 V1 离线完成；产品要求的语义重复建议仍固定失败关闭，不能用 fake
  model、merge 事务或组件测试冒充 production suggestion→preview→confirm 闭环。
- 语义建议是平台计费调用，必须使用独立 owner-scoped durable request、Idempotency-Key、quota
  reservation、dispatch mark、usage ledger、lease/fencing 和保守失败恢复；不能直接把现有 model seam
  接到 DeepSeek，也不能复用 Practice/Analysis 的不同资源状态机。
- S2 外部 interface 固定只暴露 `suggest(command)`；Provider 的实际费用以 `billedCalls[]` 传递，durable
  repository 用 `acquired/resolved/busy` 和 boolean dispatch fencing 表达内部状态，避免 HTTP caller 学习
  quota、lease 或结算顺序。当前单次调用的 reservation ceiling 不得被未来 repair call 静默复用。
- 相同 owner/Idempotency-Key 的有效 terminal 必须先于当前部署价格检查重放，不能因后来价格变化破坏
  原响应；只有新 generation 才在新 reservation 前精确校验价格版本，并由共享 quota transition 在 fetch
  前执行 kill switch 与额度检查。价格/kill/quota 失败不得创建第二次 Provider 调用或自动切换 BYOK。
- 模型只见最多 50 个 server-owned 同类型最小候选别名；最多 10 个 bounded public suggestion 可为精确
  replay 在 forced-RLS 数据库短时保留 24 小时，独立 CRON 有界清理，账号删除级联且不进入内容导出。
- Web 失败不自动重试；每次用户再次点击使用新 key，item/revision 变化清除候选并抑制迟到 response。
  浏览器验收必须经过 actual production bundle 的 suggestion→preview→显式 confirm→server reread，且
  公开 snapshot/Web Storage 不得出现正文、prompt、raw output、reservation 或 task。
- 测试文档不得声称不存在的 Playwright 语义合并或 AA 对比度检查。AA 必须按 WCAG sRGB 相对亮度对
  真实 semantic token 组合计算，不能以字号假设或静态字符串检查替代。
- 完整矩阵与阶段方案见 `offline-completion-audit.md` 和 `semantic-duplicate-suggestions.md`。

## 2026-08-14：普通 Google 登录使用独立契约并固定 callback 防泄漏 header

- `POST /v1/auth/google/login/start` 的 strict 空对象属于 identity 领域，不再复用同形的
  AccountDataExport request schema；JSON 只接受 `{}`，原生 form body 必须为空。
- 普通/邀请 Google start 与共用 OAuth callback 明确 `private, no-store`；callback 成功和失败另固定
  `Referrer-Policy: no-referrer`，防止短时 flow/code 作为 Referer 进入 Web 或第三方。
- production-bundle 离线验收必须覆盖 active→full、disabled→data-rights、未登记 google method→零
  Cookie；不以 fake Provider 冒充真实 Google/Supabase。完整方案见
  `google-authentication-acceptance.md`。

## 2026-08-14：密码恢复是未登录的一次改密授权，不是登录或身份绑定

- PasswordRecovery 公开 start 对 unknown/Google-only/非 active/eligible 账号统一 202；只有既有
  active+password method 才调用 Supabase PKCE recovery，不能按相同邮箱新增 Huayi method。
- 恢复使用独立 `password_recovery_flows` 与 purpose-scoped HttpOnly Cookie，不复用邀请/login/link
  `auth_flows` 或普通 Web session。邮件 callback 只取得一次改密能力，不获得账号数据访问。
- 公开 start 不等待外部 Provider；eligible 请求只建立本地 requested flow，由 trusted worker 在调用
  Provider 前耐久写 dispatch。可能已发信但丢失回执的任务不得自动重发，只能由用户显式新请求替换。
- 邮件 GET 不直接消费 Provider code，只渲染 no-store/no-referrer、无外链脚本且 form-action 固定 self 的
  惰性确认页；用户显式 POST 后才 exchange，降低邮件 scanner 抢先消费风险。
- 完成改密后撤销全部 Huayi Web/Extension sessions、清 recovery Cookie、写耐久安全通知并要求用户显式
  重登；不从 Provider recovery session 派生 Huayi session。
- Provider 发信/state 保存和改密/stage 提交是跨系统窗口，必须如实依赖用户显式重试，禁止后台透明
  改密或宣称 exactly-once。完整方案见 `password-recovery.md`。
- 统一 start 响应预算由原则性要求校准为：有效且未限速的 202 从 handler 起点起至少 250ms；发布前用实际
  部署分布复核，不能据此声称密码学不可区分。
- 改密完成后的安全通知固定为独立 120 秒 lease、有界指数退避，真实 sender 使用 outbox notification ID
  作为厂商幂等键。邮件厂商、verified sender、支持联系方式与告警未确定前，不挂载伪 production sender。

## 2026-08-14：Supabase identity 不能直接等同 Huayi 登录授权

- 官方能力复审确认 Supabase 会按相同已验证邮箱自动链接 OAuth identity，而产品明确禁止静默合并；现有
  provider user ID→Huayi session 直通不足以执行该边界。
- 新增 owner-scoped `account_sign_in_methods` 作为 Huayi 授权 fence：邀请只登记实际注册方式，普通登录
  必须先验证 method 已登记；上游 auto-link 不自动创建 profile、method 或 Huayi session。
- 显式 Google/password 绑定拆成 recent-auth、purpose/session/user-bound flow；V1 不提供解绑。密码恢复
  是未登录 purpose-bound 流程，另立阶段。完整路线见 `account-sign-in-methods.md`。
- `api.md` 的“所有写请求带 Idempotency-Key”收窄为各资源显式声明的 replayable mutation；认证、邀请、
  pairing approval 与一次性 auth/link flow 使用各自状态机恢复。
- 密码近期重认证不先消费当前 refresh token：服务端从已验证 Huayi session 读取规范邮箱，以
  `signInWithPassword` 创建新 provider session，核对同一 user ID 后原子替换 Huayi session 与 encrypted
  refresh ciphertext。这避免 password 校验失败或数据库提交中断把旧 ciphertext 留在已消费 generation。
- Google 近期重认证同样不消费当前 refresh：start 用 path-scoped HttpOnly SameSite=Strict one-time intent
  Cookie 保持公开 `continuePath` 为常量，continue 绑定当前 Web session 后发起新的 Google OAuth；callback
  只有在 purpose、
  发起 session 与 Supabase user ID 全部匹配时才轮换 Huayi session。只有 manual Google linking 使用当前
  encrypted refresh 的 purpose-bound 单写 lease。
- 绑定授权不能只看 `reauthenticated_at`：普通登录也会产生新时间，若无 provenance 就可绕过“以当前密码/
  Google 显式重认证”。`web_sessions` 因此新增内部 `reauthenticated_method`；普通登录/邀请为 null，显式
  reauth 写 password/google，link 同时校验规定来源与 15 分钟窗口。
- Google manual link 不允许在单次 continue GET 中先 refresh 再直接 link：进程中断会让数据库持有已消费的
  旧 token。状态机拆成 claimed→refreshed→provider-started→completed；新 encrypted refresh/provider
  state 先持久化，manual link 后置，重试按数据库 stage 恢复且同一 session 只有一个 open flow。内部
  30 秒 hashed lease 固定每个 refresh generation 只能由一个 worker 推进；租约不进入公开契约。
- Google→password 绑定也不能把 `refreshSession`、`updateUser({password})` 与数据库 method 写入拼成一个
  不可恢复 POST。新增独立 link-password purpose：claimed→refreshed→provider-updated→completed；先持久化
  rotated refresh/state，明文密码不持久化，Provider/数据库中断按 stage 重试。不得用 service-role 管理员
  改密绕过 authenticated session 与 Supabase secure-password-change 策略。
- 重复绑定不能伪装成认证失败，也不能在 proof 验证前泄漏 method 状态：active/full Cookie、固定 Origin、
  CSRF 与目标绑定要求的 recent-auth provenance 经数据库锁定验证后，固定返回 409
  `sign_in_method_already_linked`，不创建 flow、不调用
  Provider、不改变任何 session；Web 通过服务器重读恢复 stale view。

## 2026-08-14：密码 actual-bundle 验收必须经过邮箱确认 callback

- 密码注册不得把 202 `emailConfirmationRequired` 或预种 Cookie 解释成登录成功；默认离线验收使用本地
  fake mail/provider 页面要求用户显式点击，再由固定 API callback 消费 auth flow、完成邀请并设置
  HttpOnly Cookie。
- 同一 production bundle 旅程在清除会话 Cookie 后从 `/login` 覆盖错误密码重试与正确密码的新 session；
  公开 authority snapshot 不保存邮箱、密码、claim ticket、flow/code、Cookie 或 CSRF。
- 密码注册/登录响应与 callback/CSRF 一致增加 `Cache-Control: private, no-store`；不改变 body、Cookie、
  CORS、Supabase adapter 或 Postgres 状态机。完整方案见 `password-authentication-acceptance.md`。

## 2026-08-14：配对审批是一次性转换，以 GET approved 恢复丢失响应

- 校正 `api.md` 单点漂移：approve 使用 Web Cookie+Origin+CSRF 与 strict body 内的
  `expectedPreferencesRevision`，不使用 Idempotency-Key/If-Match 或 mutation replay。
- pending→approved 与可选偏好更新在同一事务；revision conflict 零部分写。丢失 204 后 GET pairing
  返回 approved，客户端不得重放 approve；ExtensionSession 仍只由 state+PKCE exchange 创建。
- production `/pair-extension/:id` 需新增 actual-bundle 组合证据，但不得把 fake Web authority 冒充 Store
  exchange、token vault、真实 Chrome 或部署验证。完整方案见 `pairing-approval-acceptance.md`。

## 2026-08-14：分析历史发布证据必须覆盖正交状态与 linked capture 删除

- contracts、Postgres 和组件测试不能单独证明 production `/history` 的 bootstrap、筛选、详情焦点及
  Cookie/CSRF/revision/幂等组合；新增 actual Web bundle 离线验收层。
- linked StudyCapture 记录必须依次验证 pendingReview→reviewed、archive、restore 与默认同时删除 capture；
  archive/restore 不得改变 reviewState，每次 mutation 后必须服务器重读，不能本地乐观推断。
- 专用 strict helper 只记录聚合与脱敏请求事实，不记录正文、结果、token 或 key；真实 Postgres/RLS、
  身份和部署保持独立目标环境验收。完整方案见 `analysis-history-acceptance.md`。

## 2026-08-14：练习历史发布证据必须覆盖生产入口与跨资源删除不变量

- contracts、API/Postgres 和 React 组件测试不能单独证明 `/practice/history` 的 production bootstrap、
  Cookie/CORS、筛选、详情焦点、两步删除及写后服务器重读；新增 actual Web bundle 离线组合层。
- 该旅程必须用 completed dialogue 的完整公开投影，并在删除后返回 `/practice`，证明 PracticeSession
  历史消失而两个 LearningItem 与 ScheduleState 保持可读；不得只依赖成功文案推断跨资源不变量。
- 新 helper 复用 strict 公共 schema 与主 authority 写证明，公开 snapshot 不记录答案、feedback、正文、
  token 或幂等键；真实数据库/RLS、身份和部署仍是独立目标环境验收。完整方案见
  `practice-history-acceptance.md`。

## 2026-08-14：管理台离线验收必须经过 actual Web bundle 与 Operator access

- React 组件注入 fake API 不能单独证明 `/admin` 的 production bootstrap、Cookie/CORS、Admin adapter、
  一次性邀请 fragment 生命周期或 access 失败关闭；新增 actual bundle Operator/非 Operator 离线层。
- Operator journey 必须服务器重读 usage/users/invitations/audit，并覆盖筛选、停用、一次性邀请和 kill
  switch 的二步确认/写证明；非 Operator 在 access 403 后不得继续读取管理数据。
- 一次性 fragment 刷新后必须消失且不进入 Web Storage/公开 snapshot。本地 strict authority 不证明真实
  角色、近期认证、告警渠道、备份恢复或部署完成；完整边界见 `admin-operations.md`。

## 2026-08-14：账号删除 accepted 后由 Cloud App 统一切换未登录态

- 数据权利页只拥有导出/删除交互，不拥有全局会话；删除 API accepted 后必须发出
  `onAccountDeleted`，由 Cloud App 清空当前 CSRF 并进入统一 signed-out 视图，不能继续保留账号控件或
  只显示“已退出”文案。
- actual Web 验收必须覆盖服务器重读 ready、新窗口短时签名下载、双重删除确认、清 Cookie 和后续
  数据 API 401；签名 URL/token 不进入主页面、Web Storage 或公开 authority snapshot。
- 该校准不改变 AccountDeletionJob 顺序、receipt replay、Supabase/Vercel 边界或真实环境验收要求；
  权威需求与完整 TDD 矩阵见 `account-data-rights.md`。

## 2026-08-14：Store 断开必须先撤销当前服务器设备会话

- “本机断开”升级为 DeviceDisconnect“断开此设备”：当前 token 只能撤销自身 DeviceSession，服务器
  统一 204 后才清本机会话、pending pairing 与账号绑定队列；不影响其他设备、Web、本机词库或 BYOK/
  外部词典凭据。
- 网络、超时或 5xx 保留 token 和账号绑定正文并提示联网重试；拒绝先清 token，因为这会永久丢失远程
  撤销能力。用户仍可从 Web 设备页撤销离线设备。
- 新 `DELETE /v1/extension-session` 不接受 session/owner/body，固定 Extension Origin、token shape 与
  strict version；退出不受最低版本 426 阻断。随机、过期、已撤销 token 统一 204，避免状态枚举。
- 详细需求、事务、测试和验收见 `extension-session-disconnect.md`，取舍见 ADR-0022。

## 2026-08-14：已练习学习项删除固定为内容抹除与最小墓碑

- 新增 `LearningItemErasure` 与 `LearningItemTombstone`，不再把 practiced-item 删除解释为归档或
  PracticeSession cascade；完整方案见 `learning-item-erasure.md`。
- 已练习 item 必须先归档，且所有引用 session 已终态、已完成自评并无生成/反馈 lease，才可清正文、
  canonical identity、来源、标签、系统属性和排期；非安全引用继续返回 `learning_item_in_use`。
- LearningItem detail/list 增加服务器 `hasPracticeHistory`，避免用仅覆盖 completed+rating 的
  `recentPractice` 猜测删除入口。PracticeSession 保留且公开 item 增加 `learningItemDeletedAt`；账号导出
  不生成墓碑 learning-item record，
  只在保留的 session 中解释 opaque item ID。删除最后一条引用 session 后清理墓碑。
- DELETE 成功响应增加 `deletionKind=hard-delete|erased`；新增稳定错误
  `learning_item_must_be_archived`。failed session 视为可单独删除的终态记录，非终态仍失败关闭。
- 该裁决释放已抹除 canonical identity，相同内容重建为新 LearningItem、新 ID 和新排期，不连接旧历史。

## 2026-08-14：学习项归档与不可逆删除必须分离

- LearningItemArchive 固定为可逆状态：归档项退出默认学习库、今日队列和新练习入口，但完整保留内容、
  排期、来源、标签与既有练习关系；恢复沿用原排期。
- public detail/export 增加 `archivedAt`，列表以服务器 `archived=false|true` 分开筛选；canonical identity
  不因归档释放，归档项不能编辑、语义建议或合并。
- 已练习项 hard-delete 仍被阻止；当时将 tombstone 的会话、导出和删除权裁决留给独立切片，不能用 FK
  cascade 冒充。该后续现由 `learning-item-erasure.md` 固定；归档方案仍见 `learning-item-archive.md`。

## 2026-08-14：当前账号聚合不得伪造账号级 consent

- `GET /v1/account` 固定为 active/full Web 的 owner snapshot：规范邮箱、完整五项 AccountPreferences、
  当前有效 ExtensionSession 公开投影和部署公开最低插件版本；quota 继续由独立端点/模块计算。
- 删除旧孤立契约中的 `consentVersion` 与恒定 `status`。配对勾选只证明本次批准动作；首次联网及
  Eudic/Shanbay recipient consent 都是各安装的本机版本化设置，不属于 HuayiAccount。
- 账号页使用聚合偏好初始化表单，避免同页重复读取；偏好更新、设备列表/撤销仍保留资源专用 seam，
  聚合不成为客户端缓存权威。完整方案与测试门槛见 `account-profile.md`。

## 2026-08-13：插件查询、学习采集与本机生词拆成独立权威

- BYOK 明确为 Store Extension 的一种模型执行模式，不是“插件版”产品线。账号登录后默认使用
  `platform`，用户只能在 Web 把账号全部插件显式切成 `byok`；各设备仍独立保存 Provider/Key，任何
  配额、网络、Key 或 Provider 失败都不得自动切换路径。
- 新增三项账号级插件偏好：查询模式默认 platform、StudyCapture 默认 manual、CloudWordCopy 默认
  enabled。配对批准原子展示/修改三项值；插件只读缓存，不能按设备覆盖。
- ExtensionQueryResult 是当前卡片的精简查询产物。BYOK 结果不上传；平台结果只在服务器保留最多一
  小时用于当前请求恢复，之后只留无正文 UsageLedger。两条路径使用同一 ResultCard schema，均不写
  AnalysisRecord、ReviewInbox 或分析历史。
- 新增 StudyCapture 保存原始 phrase/sentence/passage 学习意图。sentence/passage 可按账号设置在查询
  开始时自动加入，phrase 仅手动；exact NFKC/引号/空白规范化去重，created-only 当前卡撤销，关闭卡片
  后不恢复撤销。Web 先在 CaptureInbox 明确发起平台深度分析，再进入 ReviewInbox。
- WebDeepAnalysis 固定翻译+教学讲解，只接受 phrase/sentence/passage；V2 结果覆盖自然翻译、主干/
  从句/成分、语法/时态/语态、关键表达、适用时的省略/语气/言外之意，并且只产生 Expression 与
  SentencePattern 候选。旧 Store compact result、word 和 action 不再是 Web 分析输入。
- 插件本机 LocalLexiconEntry 是每个安装的正式独立数据，不属于 HuayiAccount。单词永远先本机保存；
  CloudWordCopy 只把以后新词的最小副本异步写入 Web，历史本机词条只能经数量预览和二次确认批量
  导入。登录、退出、换号与 Web 编辑都不改写本机词库。
- 历史批量导入的“数量”明确为词条数和全部语境数；一次确认后自动按最多 100 词/1,000 语境分批，
  零语境词条也创建云端 WordEntry，多语境和欧路无释义语境全部保留。任务使用独立加密进度与稳定
  幂等键；单条 future copy 与 batch import 共享本机内容指纹，跨路径精确去重且不覆盖 Web notes。
- 旧 `/v1/analyses:import`、`analysis-import` SubmissionOutbox 和“登录 BYOK/平台结果进入待整理”的
  产品路径被废止。新 outbox 只接受 `study-capture | cloud-word-copy`；Phase 22–26 相关绿灯保留为
  历史实现证据，必须在新契约上重新 RED→GREEN，不能作为当前候选完成声明。
- Web 分析内部引用统一为通用 `analysisUnitId=u1..u40` 与 `unitCount`，不再用 sentenceId 把 phrase
  伪装成句子。首次分析失败恢复 pending；reanalysis 失败保持 analyzed 与旧 latest。
- 完整 AccountDataExport 新增导出快照时尚未过期的平台 ExtensionQueryGeneration 公共投影，形成八类
  strict NDJSON record。用户确认生成的导出文件是最多保留 24 小时的独立私有副本；它不延长原
  generation 的一小时期限，也不把临时查询变成可浏览历史。
- ExtensionQuery 的一小时删除从 owner 请求顺带清理升级为独立 trusted cron。新增 durable
  `dispatched_at` 边界：未 dispatch 的过期调用释放额度且不记账，已 dispatch 的过期调用按预留上限
  保守结算；两者先形成失败终态，只有 terminal 到期后才可硬删正文/结果。
- Store 查询消息移除可携带相邻 DOM 的泛化 context，只允许精确选区、word/phrase 的必要单句语境和
  不含正文的可信边界证据。关联设备每次查询、采集或生词副本前有界同步偏好；配对披露只授权该
  DeviceSession，不成为第四项账号偏好。
- 详细权威方案见 `extension-query-and-study-capture.md`，并由 ADR-0019、ADR-0020、ADR-0021 记录资源
  所有权、无 fallback 与本机/云端词库边界。

## 2026-08-13：426 必须形成可恢复的本机升级阻塞而非网络重试

- 登录 BYOK import 的 426 不再归类普通 transient；SubmissionOutbox 保留加密正文、session 与原幂等
  键，只在加密 state 内记录触发阻塞的客户端版本，同版本 process 在 fetch 前停止。
- Popup 严格聚合响应新增 `client-upgrade-required`，只显示条数/最早时间与“更新划译”文案，禁用重试
  但保留二步本机清空；Content/Overlay/Options 不获得新 interface。
- 新客户端版本读取旧阻塞时只解除标记并恢复显式重试，不伪造服务器兼容成功；详细设计与数据兼容
  见 `store-upgrade-recovery.md`。
- Phase 27 strict union 下，current-card undo 只删除匹配项；队列仍有其他 item 时必须保留同版本升级
  阻塞。删除一条本机意图不能被当作“客户端已升级”，也不能重新触发同版本网络请求。

## 2026-08-13：Cloud ready 必须证明 API Extension 身份与候选版本策略一致

- Phase 26A 让 API 运行时强制固定 Extension ID/最低版本后，Phase 21 release audit 不能继续只验证
  候选 ID 格式而把部署值留给人工比对。
- `check:cloud-release` 现在同时接收候选 ID、API 公开 ID 与最低版本；两个 ID 必须相同，候选 Manifest
  版本必须按安全整数三元组大于或等于最低版本，任一缺失、非法或不一致都阻塞 ready。
- API environment 同步拒绝超出安全整数的最低版本，避免部署启动成功后才把所有 Extension 请求变成
  426；脚本与 runtime 不互相依赖，但由相同边界回归锁定语义。
- 这些值是公开发布元数据，不是 secret；离线一致性仍不能替代 Chrome Dashboard、真实部署环境和
  目标 Chrome Origin 证据。详细方案见 `release-runtime-consistency.md`。

## 2026-08-13：Extension 业务 token 必须绑定发布 Origin 与最低版本

- 既有 API 文档声明 client-version/固定 Extension Origin，但运行时只有 token。Phase 26A 将三个 Store
  business adapters 统一到 session-header interface，并在 production principal auth 查询 token 前验证
  `HUAYI_STORE_EXTENSION_ID` 和 `HUAYI_MIN_SUPPORTED_EXTENSION_VERSION`。
- CORS 只增加精确发布 Extension Origin 与 Authorization/client-version headers，不接受通配 Chrome
  Origin；Extension 请求继续 `credentials=omit`，身份归属仍只来自高熵 token。
- 陈旧/非法版本返回 426 `client_upgrade_required`。BYOK SubmissionOutbox 保留密文和原幂等键等待升级，
  不把兼容错误当永久正文错误删除；真实 Chrome Origin 行为仍需目标环境验证。

## 2026-08-13：分析浏览器验收必须从 SSE completed 进入服务器待整理权威

- Phase 25 不允许预种 AnalysisRecord 或由 preview/客户端表单拼出待整理结果；actual `/analysis` 只有
  strict completed event 才能完成，随后 Inbox 和学习库必须分别通过服务器 GET 重读。
- browser streaming authority 只接受计划中的 `manual + passage` strict fixture，并复用 production
  Cookie/Origin/CSRF/Idempotency proof；same-key 重放不创建第二条记录，different-body 稳定冲突。
- LearningItem 已有可信 SourceExample，因此学习库详情开始只读呈现来源标题、原文与翻译；仍不允许
  编辑/删除单条来源或在客户端建立第二权威。真实 Provider、quota、代理和数据库证据保持独立待办。

## 2026-08-13：邀请到学习项浏览器验收不得绕过邮箱确认

- 产品要求邮箱密码必须验证邮箱，因此默认离线 journey 不允许让 password register fake 直接建立
  session，也不允许预种 Cookie 冒充 onboarding 完成。
- Phase 24 改走同样受邀请约束的 Google 注册：claim ticket 仅经固定 API 原生 POST，fake Provider 只见
  opaque flow，callback 设置 HttpOnly Cookie 后再由 production Web adapter 手动创建 LearningItem。
- fake Provider 和 Web/API 保留域均由 Playwright 本地 fulfill，不访问真实 Google/Supabase；该证据只
  证明浏览器组合，不替代真实身份、部署 Domain/TLS 或邮件验证。完整方案见
  `web-onboarding-acceptance.md`。

## 2026-08-13：练习浏览器验收复用同一脱敏 CloudAuthority

- Phase 23 的造句/对话浏览器验收继续使用 Phase 22 actual Web bundle 与同站 HTTPS fake authority，不另建
  React-only harness 或第二个 API 权威；这样 Cookie/Origin/CSRF/revision/幂等与账号 quota 重读仍在同一
  浏览器拓扑中证明。
- authority 只新增聚合 `practiceProviderCallCount`，用于证明 pending 页面零自动调用和已完成操作的额度
  变化；公开 snapshot 禁止暴露答案、operation、task、reservation、模型输入或 Header。
- fake authority 不模拟 PlatformGeneration、RLS 或账本事务；这些继续由 Phase 23 unit/PGlite 证明。Web
  E2E support 同时纳入 strict TypeScript 门禁，避免运行时转译掩盖 fixture 类型漂移。

## 2026-08-13：付费练习生成必须在 Provider dispatch 前持久化

- 五类平台练习调用不能只复用可过期的领域 generation lease；Phase 23 新增独立 PlatformGeneration 与
  `practice_generation_tasks`，在 Provider HTTP 前固定 task、价格、额度预留和 durable dispatch mark。
- `claimed|reserved` 尚无外部副作用，可安全接管；`dispatched` 已可能计费，worker 丢失只允许最坏预留
  保守结算并 abandoned，不透明调用第二次；`ready` 保存 strict output 并零调用重放到领域事务。
- 句子题目与对话开场都先建立可恢复 pending session，不能用占位 prompt 冒充正式内容。Provider 只见
  有界正文/别名，usage 进入现有 UsageAllowance；生产组合只通过统一 PaidPracticeGenerator 调用固定
  DeepSeek adapter，缺失或非法价格、额度、模型配置继续 fail-closed。详见 ADR-0018 与
  `paid-practice-generation.md`。

## 2026-08-13：Cloud 候选 readiness 必须由独立证据审计判定

- 既有 Store 包审计证明自包含 BYOK 基线，不证明 Cloud API/Web origin、公开 privacy URL、运行时
  常量、Manifest 与披露一致。Phase 21 增加独立 `check:cloud-release`，当前 null-origin 开发态必须
  fail closed。
- 候选配置只含公开 origin、Extension ID 和 privacy URL；审计器不得读取或输出部署 secret，也不得
  访问网络。ready 只证明本地产物一致，不能代替真实服务、Dashboard 或商店人工预审。
- 既有 `check:store-release` 默认 Store 1.0 profile 保持不变；Cloud 只通过显式 expected hosts/CSP
  扩展其深模块，避免把未知 Huayi host 放宽成任意 endpoint。

## 2026-08-13：Cloud 跨端离线验收必须进入实际浏览器组合

- 组件测试、adapter 单测与 Extension fixture 不能证明 Web production bundle、浏览器 CORS/Cookie/CSRF、
  SPA 跳转及 Store import 后 Web 可见；Phase 22 增加 actual bundle + stateful fake authority 旅程。
- fake authority 只承担浏览器组合 seam，不复制 Postgres RLS/事务；Store harness 只替换 Provider、
  session/vault 与时钟，实际使用 packaged Content Script、AnalysisSession、SubmissionOutbox/alarm 和
  Cloud import adapter。
- 离线 route interception 不等于真实 Vercel/Supabase、Manifest host 权限或 Chrome extension process；
  对外完成声明继续要求真实环境和双平台 Chrome 证据。
- Phase 22 初稿的 `http://127.0.0.1` Web preview 会人为制造 HTTPS API 的第三方 Cookie 场景；实现前改为
  `web.huayi.invalid`/`api.huayi.invalid` 同站 HTTPS 保留域并全部本地 fulfill，既覆盖浏览器 CORS，又不
  混入与生产 session 不同的 Cookie 拓扑。

## 2026-08-13：Cloud 隐私页必须公开且先于 API 配置/登录分流

- Cloud V1 不复用旧 Store 1.0 的“无账户、无自有后端、端到端加密本地词库”商店口径；新 listing
  必须披露 Huayi API、服务器可读学习内容、账号、跨设备和平台模型，同时保留 BYOK/欧路凭据只在
  DeviceVault 的准确边界。
- Web 精确 `/privacy` 在 API Origin 解析和登录 bootstrap 前渲染，不能因部署配置或 Cookie 失效而
  不可访问，也不能从远端加载政策正文。
- 生产外部事实未核验前，页面明确标记预发布并列出运营主体、联系、区域和备份期限缺口；不得使用
  猜测值伪装 Chrome Web Store 已就绪。

## 2026-08-13：管理端是受限 Operator 投影，不是 service-role 超级后台

- Phase 19 固定 Operator 只能读取 email、账号状态、设备数、额度、无正文聚合与审计；禁止正文检索、
  代登录、任意 SQL 和用 Supabase service role 枚举用户作为普通管理查询。
- `user_profiles` 保存最近一次成功 Supabase 身份验证返回的规范化邮箱，使账号列表、游标、状态事务和
  审计位于同一 Postgres 快照；邮箱变化在下次登录刷新，并纳入完整账号导出/删除。见 ADR-0017。
- 管理 GET 要求 full session、operator 与最近认证但不要求 CSRF；mutation 另要求固定 Origin、CSRF 和
  Idempotency-Key。邀请 token 由服务器 secret + actor/key/strict request hash 稳定派生，数据库只存 hash
  和无秘密 snapshot。
- 停用改为严格 active→disabled，并原子撤销 Web/Extension session 与 pending/approved pairing；
  deleting 不可恢复，Operator 不能停用自己。kill switch 读写和审计进入同一运营深模块。

## 2026-08-13：账号完整导出使用私有任务，删除任务独立于账号正文

- Phase 18 把 AccountDataExport 定义为 strict 版本化 NDJSON，不再用同步 JSON 或 WordListExport 冒充
  完整备份；owner-RLS job 生成 private object，object ready 后设置 24 小时 expiry，每个 signed URL 最长
  15 分钟且不能越过 object expiry；到期先停止签发，删除失败保留内部 key 并告警重试。
- AccountDeletionJob 不引用 user_profiles FK。删除请求成功前先置 deleting 并撤销所有 Web/Extension
  session/pairing；worker 用 lease fencing 按 export objects→主库→Supabase Auth 顺序恢复，完成后清除
  subject UUID。主库步骤还处理 invitation/audit/runtime control 等没有 FK 的直接 UUID。
- 当前 runtime 缺 service-role Auth/Storage adapter 与受信 worker 入口；实现必须补齐并在任何配置缺失时
  production 启动失败关闭。官方核对后 worker 固定为 Vercel Cron GET + `CRON_SECRET`，不假设平台失败
  重试。详细方案与文档自审见 `account-data-rights.md` 和 ADR-0016。
- 现有 disabled 账号不能再登录，与“停用不阻止导出/删除”冲突；Phase 18 增加 DataRightsSession，
  disabled 重新验证后仅可导出、删除和退出，普通业务认证仍要求 active+full，deleting 继续拒绝登录。
- 现有 Google OAuth 只有邀请注册。为保证 Google-only 账号可重新认证，新增 `auth_flows.kind=login` 与
  普通 Google start/callback；它只接受既有 profile，不消费邀请、不自动注册或绑定新 identity。
- 删除请求在撤销 session 后若丢响应，原 Cookie 可用同 key/body 在 24 小时内重放固定 accepted receipt；
  job 只保存 pepper-hash proof，该通道不恢复 session、不返回任务或账号数据，过期后清除。
- 离线实现已接通 strict contracts、owner-RLS 导出任务、带 lease fencing 的导出/清理/删除 worker、
  Vercel Cron bearer 验证、Supabase private Storage/Auth service-role adapter、普通 Google 登录、
  DataRightsSession 与 Web `/settings/data`。生产配置缺失继续启动失败关闭；真实服务与浏览器联合验证
  仍是发布前门槛。

## 2026-08-13：词表下载是最小互操作导出，不是备份

- `GET /v1/words:export` 只在 owner transaction 中按 canonical key/id 排序输出 UTF-8 词头，每行一词、
  LF 换行；非空文件末尾恰好一个换行，空词库返回空文件。
- 响应文件名固定为 `huayi-words.txt`，Web 只接受固定 MIME/Content-Disposition。文件不含 notes、语境、
  释义、来源、任务、回执、账号字段或凭据，产品文案不得称其为完整备份。

## 2026-08-13：外部词典导入页与导出 item 使用不同租约载荷

- 原公共 lease response 只有 WordEntry entries，无法表达尚未进入 CloudAuthority 的 Eudic page；原
  `external_wordbook_items.word_entry_id` 也不能作为导入前置。Phase 7 改为 import 领取 job cursor，
  成功页才原子 upsert WordEntry/context/item；export 在创建任务时快照 item。
- 云端 ExternalWordbookJob/ExportOutbox 是唯一正式任务权威。Store production 不再向旧本地 outbox
  写新任务，也不把旧本地队列伪装成云任务上传。旧实现仅保留为迁移回归材料直至测试被新深模块替换。
- lease 使用 Extension 随机 nonce、服务器 HMAC-signed token 和 nonce-hash-only 持久化；Shanbay
  Content Script 只获得本机批次/item 别名，云 token 留在 Service Worker/独立 DeviceVault 加密 lease
  vault。
- Eudic export 最小化为 headword+可选原句，Shanbay 只有 headword。取消后的 export 可记录已发生副作用
  的迟到回执；取消后的 import page 不再创建词条。详细阶段、状态机和验收见 `external-wordbooks.md`。

## 2026-08-13：手动生词 upsert 不接受客户端来源或时间权威

- 未接线的旧 upsert 请求曾复用完整 ContextObservation 形状，允许浏览器提交 sourceType/observedAt；现
  收紧为手动正文/释义/标题，服务器固定 `manual`、now 与 ID。未来 Eudic import 使用独立任务入口。
- 同 canonical 的既有 WordEntry 保留 headword/notes；notes 仅创建时采用，新增非重复语境才推进既有
  revision。语境 hash 不含 observedAt，因此重复内容不制造第二条记录。
- 响应区分 word created/existing 与 context created/duplicate/omitted；`word.upsert` 按 key/hash 快照重放，
  Web 写后重读服务器权威。无新表；bootstrap 0001 只需扩 fixed operation allowlist。

## 2026-08-13：账号偏好采用窄服务器投影

- 新增 `GET/PATCH /v1/account/preferences`，只投影 `user_profiles.timezone/daily_goal`；不为尚未完成的
  `GET /v1/account` 伪造 consent、版本或 session 聚合字段。
- GET 只接受 Web Cookie，PATCH 还要求固定 Origin 与 CSRF；owner 只来自 session，Postgres 在 forced-RLS
  transaction 内读写。当前无 profile revision，最后一次通过严格 schema 的提交生效。
- Web `/settings/account` 保存失败时保留草稿，成功采用服务器响应；设置仅影响后续 daily queue，不改写
  已有 PracticeSession。未新增 migration，真实登录/部署浏览器 journey 仍待。

## 2026-08-13：Popup 可脱敏管理 Cloud SubmissionOutbox

- Store-domain 新增三个无参数内部命令：status、retry、clear；Service Worker 只接受当前扩展精确
  `popup.html` sender，响应仅含有界 state/outcome，以及 queued 时的 count/oldestQueuedAt。
- Popup 云端卡显示本机待提交条数与最早日期；重试复用加密队列内原幂等键并沿用 alarm，清空需二次
  确认且只删除本机 SubmissionOutbox，不影响云端权威、session、Provider 凭据或本地词库。
- API 未配置、联网同意关闭、session 无效或本机断开会清除旧账号绑定 payload；Content Script、
  Options、Overlay、Manifest 和 Cloud API 均未扩权。真实断网与 Store→API→Web Chrome journey 仍待。

## 2026-08-13：平台额度只投影服务器账本，BYOK 明确排除

- 登录 Web 通过 Cookie-only `GET /v1/quota` 读取当前 UTC 月 strict QuotaSummary；客户端不能提交 owner、
  时间或 Extension token，响应不缓存。完整 `/v1/account` profile/consent 聚合仍待，不伪造缺失字段。
- percent 只反映已结算使用，80% 进入 warning；used+active reservation 达限额时优先 exhausted，remaining
  同时扣除二者。无 grant 是 0 limit/exhausted 的诚实空配置。
- `/settings/account` 明确 BYOK 不进入平台 reservation/ledger；额度用完只停平台模型，不停浏览、手动
  录入、已有数据或本机 BYOK。

## 2026-08-13：分析历史 Web 维护区分写入事实与刷新结果

- Web `/history` 复用现有 owner-scoped history authority，展示服务器支持的搜索/状态/来源/选区筛选、
  签名游标分页、完整结构化 AnalysisRecord、候选与公开模型信息，不建立本地历史副本。
- 归档与 reviewState 始终独立；nothing-to-save、归档、恢复和二次确认删除沿用 revision/幂等接口。
  严格 mutation response 代表写入已完成，随后的 server reread 失败单独报告，不能把完成误报为失败。
- list/detail/action 都以 generation guard 抑制迟到响应；模型与来源内容仅作为纯文本投影，不渲染 HTML。

## 2026-08-13：生词维护保持词头与语境快照不可变并保护外部任务历史

- WordEntry 的 headword/canonical key 保持 identity，Web 仅编辑/清除 notes；ContextObservation 作为来源
  快照只读。word 与 context 各用资源隔离签名 cursor，context cursor 另绑定 word ID。
- 删除整个词条会级联 contexts，但已有 ExternalWordbookItem 引用时返回 `word_entry_in_use`，不借现有
  FK cascade 静默删除任务 item/receipt；未引用删除不触 AnalysisRecord、LearningItem 或 Practice。
- patch/delete 都锁 row/revision 并使用 owner operation/key/path-bound hash；删除后同请求从严格 snapshot
  重放。未发布 bootstrap 0001 只扩 `word.patch|word.delete` allowlist，既有开发库必须重建。

## 2026-08-13：练习历史如实投影未完成状态，单次删除不回滚排期

- 历史列出全部已持久化正式 PracticeSession，并明确 active、awaiting-feedback、failed、completed；
  completed_at 在最终反馈首次完成时固定，评分不改写。列表以独立签名 cursor 稳定分页，详情按类型返回
  造句答案/反馈或对话计划、轮次、最终逐项反馈与自评，不返回 owner 或内部 lease/reservation。
- 当时只有 completed 会话可经 Web 二次确认删除；LearningItemErasure 后续把无 lease 的 failed 也纳入
  可删除终态，active/pending 或任一 worker lease 仍统一 409。删除只级联 session items/turns/attempts，
  不删除或回写 live 学习项、排期与来源，也不倒推 due/level/streak/rating；最后引用可清墓碑。
- `practice.delete` 使用 owner operation/key/hash 和删除前严格响应快照；同请求在源行删除后仍可重放，
  不同 body 冲突。未发布 bootstrap 0001 增加 `completed_at` 与 operation allowlist，既有开发库必须重建。

## 2026-08-13：学习库维护以历史保留为先并只开放显式安全合并

- PATCH 重新规范 canonical，保持 item type/identity，原子替换 core/content、系统属性和规范化标签；
  exact duplicate、revision 与 idempotency 冲突均保留 Web 草稿。
- 当前不借 FK cascade 删除练习历史：有任一 practice 引用的 LearningItem 返回
  `learning_item_in_use`；未练习项目二次确认后硬删 item/schedule/source/tag joins，Tag 行保留复用，
  删除后的同 key 重放来自幂等响应快照。
- manual merge 只允许同 owner/type/current revisions 且 source 从未练习、level -1；target identity/core/
  schedule 保留，source metadata/examples/tags 去重追加后 source 硬删，无 redirect。preview 可过期，
  confirm 必须事务重验，不自动或跨类型合并。
- semantic model 只返回 bounded ID/reason/confidence，服务端从 owner-scoped current same-type 候选 hydrate；
  production 保持 model_unavailable，接 quota/claim/lease 前不调用真实模型。
- 未发布 bootstrap 0001 只扩固定 maintenance 幂等 operation allowlist；既有开发库必须重建，不能把
  0001 当增量 migration 重放。

## 2026-08-13：受约束对话以 turn-first 与 generation lease 落地

- PracticeSession 新增 strict DialoguePlan、pendingGeneration 和覆盖全部 items 的逐项 feedback；Daily Queue
  从单 `currentItem` 平滑升级为有序 `currentItems`，可恢复 1–3 项会话。
- start 先保存 DB reservation/lease；用户 turn 先落库，assistant turn 与 final feedback 均显式 retry、
  expired takeover、token fencing，模型调用期间不持事务。完成 3–5 round 后才允许 final；中途不纠错。
- Web `/practice` 增加多项选择、对话、pending 恢复、逐项反馈/来源与一次提交全部 ratings；窄屏、焦点、
  live region 和 reduced-motion 沿用现有 shell。production 模型仍 fail-closed，无真实额度/网络验证。
- 根审阅补齐丢失 turn 响应后的服务器重读和草稿裁决，并让 pending dialogue-start 省略未生成的 prompt，
  不把内部占位符公开成正式题目。
- 未发布 bootstrap 0001 增加 dialogue plan/feedback/generation lease；既有开发库必须重建。history/delete、
  quota ledger 接线与真实登录浏览器 journey 仍未完成。

## 2026-08-13：Phase 8 根审阅收紧日期、恢复与并发评分

- Daily queue 不再接受浏览器日期；服务端从可信时钟和账号 IANA timezone 计算本地日，并返回匹配的
  current session/item。
- active、awaiting-feedback 和 completed-but-unrated 均可刷新恢复；提交响应丢失时 Web 重读服务器
  权威，来源与自评不会因刷新消失。
- rating 在读取会话前取得行锁，跨幂等键的并发评分仍只推进一次；反馈 retry 只在 fenced completion
  成功后写幂等响应，活跃 lease 不会被缓存成永久结果。

## 2026-08-13：句子创作以 PracticeAttempt 和反馈租约落地

- 今日队列按服务器时钟与账号时区选择本地日内到期项，created/id 稳定排序后用新项补 dailyGoal；只对
  active owner 开放。`active | awaiting-feedback` 共同占用唯一活跃会话。
- 句子答案不再借用 dialogue turn：先原子写 PracticeAttempt，再调用反馈模型。initial/retry 共用
  attempt feedback lease；活跃 lease 抑制第二调用、过期可接管、completion/failure 按 token fencing。
- Web `/practice` 提供队列、句子作答、显式反馈重试、反馈后 SourceExample 和三档自评。production 模型
  仍 fail-closed，不宣称真实生成可用；dialogue/history/delete 未实现。
- 未发布 bootstrap 0001 新增 practice_attempts、反馈 lease 与唯一活跃索引；既有开发库必须重建，不能
  把 0001 重放当增量升级。

## 2026-08-13：句子创作区分作答、反馈与用户自评

- PracticeAttempt 是用户提交的一次句子创作答案，不是 dialogue turn；提交后即成为练习会话正式记录，
  即使模型反馈失败也不能丢弃或自动产生第二次付费调用。
- PracticeFeedback 只在作答提交后生成正确性、自然度与改进建议，不提供精确分数，也不替代用户的
  “不会／勉强／掌握”自评。只有完成反馈后才允许自评，ScheduleState 只由自评事务推进。
- 页面关闭或停止等待不等于服务器 PracticeSession 取消；V1 最小句子创作闭环不得伪造取消语义。

## 2026-08-13：学习库手动收录保持服务器单一权威

- strict `POST /v1/learning-items` 以 Web Cookie+Origin+CSRF、Idempotency-Key 和 tenant transaction
  原子创建 LearningItem、level -1 ScheduleState、规范化复用标签与 join；相同请求优先重放，不同 body
  冲突，同 owner/type/canonical 精确重复返回 409。
- Web 类型专属表单显式录入 Expression 或 SentencePattern（含槽位），成功后重读 server list/detail
  并聚焦/播报，精确重复保留草稿。edit/delete/merge/semantic/practice 仍未实现。
- Cloud 尚未发布且当前只有 bootstrap migration 0001；本变更扩其内部幂等 operation allowlist，既有
  开发数据库必须重建，不能把 0001 重放当作增量升级。
- 根任务 UI 复审区分了“创建请求失败”和“创建已成功但权威列表/详情刷新失败”：后一种必须明确告知
  已经收录并保留草稿供用户确认，不能诱导再次创建。当前筛选排除新条目时，页面仍显示 owner-scoped
  详情回读，并把空态表述为“当前筛选下没有学习项”，不误报整个学习库为空。

## 2026-08-13：学习库首个切片只读复用 Postgres CloudAuthority

- strict list/detail view 返回完整 LearningItem、ScheduleState 与最近一次 completed practice 的最小
  `{sessionId,type,completedAt,rating}` 摘要，不返回练习正文、反馈、owner 或内部排期 revision。
- type、规范化 tag、systemAttribute、字面 query、`due=new|due` 都在 owner tenant transaction/RLS 内
  过滤；new 取 level -1，due 由服务器当前时间判断。学习库使用独立 HMAC 签名 keyset cursor，不能把
  客户端筛选、时间或 offset 变成权威。跨账号详情与不存在统一 404。
- Web `/library` 只投影服务器列表/详情，覆盖筛选、分页和恢复状态，不持久化第二份学习库。本切片不
  开放 create、patch、delete、merge、语义建议或练习动作。
- 根任务安全复审为分析历史与学习库 cursor 的 HMAC 增加不同的签名上下文，即使生产共用同一密钥，
  两类合法 cursor 也不能跨资源复用；Web 列表、翻页和详情读取使用运行代次抑制旧响应，避免快速筛选
  或连续选择时让较早的网络结果覆盖用户最后一次操作。

## 2026-08-13：Web 粘贴分析复用服务器 SSE 与待整理权威

- `/analysis` 只构造 strict manual 请求：用户提供英文、可选标题、动作和内容类型；userId、Provider、
  model、quota 与 endpoint 不进入表单或请求权威。现有 Web adapter 继续注入 Cookie、固定 Origin、CSRF
  和每次运行的新幂等键。
- started/preview/completed/failed 以可访问状态渐进显示，preview 只存在当前页面内存；严格 completed 或
  owner-scoped request status 确认完成后才交接到既有 `/app` Inbox，不建立第二份客户端记录。
- 取消通过 AbortSignal 停止本页消费并使旧运行代次失效，迟到 preview/terminal 不再更新页面。V1 没有
  平台任务取消端点，因此文案明确服务器可能继续并落入待整理；started-only 的 `running` 状态不伪装
  成完成，也不允许立即重复提交。失败重试保留输入并使用新 key。

## 2026-08-13：Cloud SubmissionOutbox 由 Service Worker 独占并绑定扩展会话

- 只有活动 extension session 与固定 API 配置同时存在时，严格完成的本机 BYOK 结果才先加密排队再
  以稳定幂等键导入；未登录、过期或未配置保持 local-only。现有 Store 结果可按公共 Schema 原样导入，
  没有 Candidate 时保留空数组，不能补造表达或句型。
- Web 配对批准在 session 签发前重新披露 Huayi Cloud 接收的英文选区、完整分析、来源类型、公开模型
  版本和待整理用途，明确排除页面 URL、完整页面与 API Key，并要求用户显式勾选。
- Cloud outbox 不复用 Options 可见的外部词典 outbox；它使用 DeviceVault DEK、独立 storage key、
  AAD 和严格 envelope，只有 SW 持有 payload、幂等键和 session token。Content Script/Options 消息
  契约不扩展，Manifest 不增加权限。
- transient 失败由 alarm 以同一 key 重试；永久无效 payload 逐项丢弃；401/403、session 过期、本机
  断开、新 session 建立或撤回联网同意会在后续请求前清除账号绑定队列，避免跨账号或撤回后正文
  泄露。当前不向浮层宣称云端成功，逐项人工管理、脱敏状态、真实离线/Chrome journey 与发布 API
  origin 仍待后续。

## 2026-08-13：邀请领取后清除 URL，Google 启动使用严格原生 POST

- 安全复审将邀请链接从 `/join/<token>` 收紧为 `/join#<token>`：fragment 不随首个 HTTP 请求发送，
  避免托管/CDN path 日志记录密钥；领取请求使用 `no-referrer`，成功后立即以 `replaceState` 清除
  地址栏。claim ticket 仅在当前
  组件内存和 Google 原生 POST 的单个隐藏字段短暂存在，不进入 query、hash、local/session storage
  或日志。注册成功后页面清除 ticket。
- Google start 保留原有严格 JSON 行为，并增加浏览器顶层 302 导航所需的严格 form-urlencoded 分支；
  只接受一个合法 `claimTicket`，拒绝额外、重复、缺失、非法、过长字段及其他 Content-Type。
- Web 表单 action 只由经过验证的固定 HTTPS API origin 构造。当前实现提供邀请绑定的 Google 注册
  启动与邮箱密码注册/登录，不把 Supabase client 放入 Web，也不伪造 provider 成功；普通 Google
  登录、身份绑定和真实 Supabase/Google/邮件 journey 仍需后续受控验证与切片。

## 2026-08-13：服务器设备撤销与扩展本机断开是两个明确动作（已由 DeviceDisconnect 更新）

- Web 设备页通过账号 Cookie 列出服务器仍有效的 Extension session，只显示设备标签、创建、最近
  使用和到期时间，不返回 token、install ID、hash 或其他设备秘密。
- Web 撤销必须经过显式二次确认，并以固定 Origin + CSRF 删除当前账号拥有的指定 session；跨账号
  ID 返回 not_found。撤销成功后该 token 立即失效，不能由客户端 userId 改变归属。
- 当时 Store Popup 的“本机断开”只删除本机加密凭据，不伪装成服务器撤销。2026-08-14 已按该条预留的
  独立端点升级为 remote-first DeviceDisconnect；历史边界不再是现行产品行为。

## 2026-08-13：配对客户端秘密仅由 Service Worker 持有，公开轮询不暴露 consumed

- Web 只用 HttpOnly Cookie + Origin + CSRF bootstrap 确认登录态，并在固定配对路由显式批准设备；
  本切片不伪造 Google、密码或邀请流程，未登录页明确提示登录流程仍未接线。
- Extension 的 state、PKCE verifier 和 session token 使用 DeviceVault DEK 下的独立严格 envelope
  加密持久化，只有 Service Worker 组合该窄 vault；Content Script、Options 和通用 CredentialSlot
  均不获得读取能力。稳定 install ID 可明文持久化，但出站只发送其 SHA-256。
- 无认证轮询只返回 pending/approved/expired；成功 exchange 后再次轮询得到 not_found，不序列化
  consumed 或设备标签。Popup 仅消费脱敏状态，生产 API/Web origin 缺失时保持 not-configured。
- 当时 Popup 的“本机断开”只删除本地 pairing/session 秘密，不伪装成服务端设备撤销；服务器设备列表
  与撤销由 Web 账号页承担。该历史实现现由 2026-08-14 DeviceDisconnect 条目取代。

## 2026-08-13：候选确认使用类型路由、显式精确合并和原子批次

- WordCandidate 只进入 WordEntry/ContextObservation；Expression 与 SentencePattern 只进入
  LearningItem/SourceExample。来源正文、译文、类型和标题复制自可信 AnalysisRecord 句子快照。
- create 遇到同 owner/type/规范键时返回 `exact_duplicate`，不自动合并；merge 必须显式指向同
  owner/type/key 目标，保留已有核心字段，仅追加去重的来源、用户标签和系统属性并递增 revision。
- 整批确认以 analysis revision、Idempotency-Key/hash 和 RLS 归属原子提交；任一选择失败无副作用，
  成功后才把分析置为 reviewed。Web 与 Store 已有共享契约 HTTP adapter，但 UI、语义重复建议和跨端
  journey 仍是后续工作。

## 2026-08-13：Store 的 Web 入口采用无参数命令并在发布地址缺失时失败关闭

- Content Script/浮层只能发无参数、版本化的 `open-web-workspace` 命令，不能携带 URL、analysis ID、
  token 或模型结果；固定 HTTPS 目标只由 Service Worker 的发布配置拥有。
- 目标未配置、响应不严格或 sender 不是本扩展时不创建标签页，并向浮层显示失败状态；不得使用
  `.example` 等保留域名伪装成功。该入口无需新增 `tabs` 权限。
- 候选编辑、标签、确认和合并继续只存在于 Web，Store 浮层只显示查询结果、云状态和打开入口。

## 2026-08-13：分析历史采用签名 keyset 分页与原子 revision/幂等写入

- 历史默认排除归档，以 `(created_at,id)` 降序和签名版本化 cursor 分页；筛选支持整理状态、归档、
  来源、选择类型和字面正文/标题 query，不允许 `%`、`_` 改变查询含义。
- nothing-to-save、归档、恢复、删除统一要求 Idempotency-Key、If-Match 与匹配的 expected revision；
  Postgres 原子保存严格响应，delete 后仍可重放，同 key 不同 hash 和旧 revision 均无副作用。
- 删除 AnalysisRecord 只删除未确认 Candidate；已复制 SourceExample 保留并把分析引用设空。Web 与
  Store adapter 使用同一 Cloud 契约，但本阶段不新增完整历史 UI。

## 2026-08-12：平台分析采用持久租约、重放和保守过期终态

- 平台分析用独立 `analysis_requests` 持久化 owner/key/request hash、运行租约、精确价格版本、预留和
  terminal event；跨实例同 payload 只允许一个 worker 调用模型，不同 payload 在 SSE 前冲突。
- 生成租约固定 4 分钟，额度预留固定 5 分钟，以容纳初次与一次修复调用。完成、失败和恢复统一按
  request→reservation 锁序，并在任何记录/账本写入前验证 fencing token。
- 过期生成不透明重试，因为旧 worker 可能已经产生供应商费用；恢复事务以原价格和预分配账本 ID
  保守结算并持久化失败事件。terminal 请求可重放；用户再次生成必须使用新幂等键。

## 2026-08-12：Web 与 Store Extension 改为双端同步推进

- Store 当前开发阶段已经提交，后续不再采用“先完成全部 Web、再开始 Store”的严格串行顺序。
- 共享契约/API 先达到单个纵向切片的可消费门禁，随后 Web 与 Store 在同一切片内同步开发；两端保留
  独立 focused gate，合并前必须通过共享 fixture、API 集成和跨端 journey。
- 这只改变开发协作与验收顺序，不改变 CloudAuthority、产品边界、一次性开放策略或 Classic 冻结状态。

## 2026-08-12：Phase 3 基础实现收口

- API 生产依赖 `postgres` 用于无 prepared statement 的 Supabase transaction-pooler 访问；相较直接
  使用 Supabase Data API，它能表达事务、角色切换、advisory lock 和 SECURITY DEFINER 调用。连接串
  只在服务端环境，业务连接为 NOBYPASSRLS 角色。
- `@supabase/supabase-js` 仅作为 Auth adapter，替代自行实现 OAuth/密码协议；使用 publishable key，
  PKCE 暂态状态经 AES-256-GCM 加密后持久化，不把 service role 或 refresh token 发往客户端。
- 测试依赖 PGlite 在默认离线门禁中执行真实 PostgreSQL 方言迁移、RLS 与事务函数；它替代脆弱的 SQL
  字符串假实现，但不宣称替代真实多连接 Supabase/Postgres 或目标区域验证。

## 2026-08-12：Phase 2 主任务验收修正

- `PracticeSession` 响应从单纯 `itemIds` 改为携带有序 `items`，每项包含排期前快照以及可选的
  自评和排期后快照；提交答案中的 `itemIds` 只能引用本会话项目。这样公共资源才能完整表达
  `practice_session_items`，并保证重放与历史审计不依赖当前排期状态。
- Phase 2 退出 fixture 由 API、Web 和 Store Extension 各自通过 `cloud-contracts` 公开入口解析，
  不以包内自测替代跨客户端兼容证据。

## 2026-08-12：Phase 1 主任务验收修正

- 固定共享纯规则的方向为 `store-domain -> learning-domain`；`cloud-contracts` 只依赖
  `learning-domain`，避免云端公共契约反向耦合 Store 客户端包。
- Vercel 当前原生 Hono 检测要求认可入口默认导出 app，因此只允许
  `apps/api/src/server.ts` 作为平台适配器例外；其他业务模块继续只使用命名导出。
- workspace 的 `test` 命令改为运行对应 Vitest project，避免未来新增测试被首个样例文件掩盖。

## 2026-08-12：建立 Cloud V1 基线

- Store Extension 直接演进为 Cloud 客户端，Classic 0.13 冻结；不并存两个 Store 扩展。
- 产品由 Extension 查询入口与 Web 学习工作台组成，同一 HuayiAccount 和 API 是学习数据唯一权威。
- Store 尚未发布且没有本地词库真实用户，取消旧 WordEntry 数据迁移和双写兼容。
- Extension 保留本机 OpenAI/DeepSeek BYOK；Web 只使用平台 DeepSeek V4 Flash。
- 未登录 BYOK 只做临时查询；登录后的 BYOK/平台分析都上传完整已校验结果并进入 Web 待整理区。
- Extension Overlay 不承担候选选择、编辑或合并，所有整理与学习活动转到 Web。
- BYOK 与欧路凭据继续只存本机 DeviceVault；华译 API 不接收或代理。
- 单词进入云端统一管理但不参加 Huayi 复习；Expression 与 SentencePattern 才是主动练习项，原句只
  是 SourceExample。
- V1 练习包含句子创作和 3–5 轮受约束文字对话，保存完整练习历史，使用透明固定间隔阶梯。
- 平台全部模型功能共用每 UTC 月默认 1 美元额度；管理后台可以按账号覆盖。
- 邀请链接不绑定邮箱，72 小时、单次使用；Web 支持 Google 与邮箱密码。
- Web/API 采用 React+Vite/Hono，Supabase Auth/Postgres 与 Vercel 双项目；服务器可读但正文不进日志。
- V1 复用现有华译设置页视觉，仅预留语义 token；主题切换延后。
- 工程按阶段实现，但完整功能通过后才一次性向邀请用户开放。
