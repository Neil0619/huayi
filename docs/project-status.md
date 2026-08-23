# 阶段成果与平台边界

## 当前基线

- 产品版本：`0.13.0`
- Native Messaging：`schemaVersion: 7`
- 浏览器：Google Chrome 普通 `http/https` 顶层网页及 YouTube `/watch` 英文字幕
- YouTube：可选择单词、短语和完整句的英文字幕；CC 旁“中”固定双语，按住 `Shift+Z` 或按住字幕角标临时查看 `zh-Hans`
  译文
- macOS：完整功能，默认 Provider 为已登录 Codex
- Windows：模型固定为 DeepSeek，不连接本机 Codex；支持欧路生词本
- 发布方式：从 GitHub 源码构建并加载，尚未发布 Chrome Web Store
- 验证方式：macOS/Windows 双平台 GitHub Actions 先以告警方式运行，稳定后再设为 `main`
  必需检查；系统原语仍需对应平台人工验收

以上是冻结维护的 Classic 0.13 基线。新的 Cloud V1 尚处于文档与实现阶段，不共享 Native Host、
wire 版本或完成声明。

## 已完成阶段

| 版本    | 阶段成果                                                          |
| ------- | ----------------------------------------------------------------- |
| 0.1–0.4 | TypeScript monorepo、MV3、严格协议、Native Host、流式展示和取消   |
| 0.5–0.7 | OpenAI、兼容 HTTP、DeepSeek Provider，以及独立凭据和诊断工具      |
| 0.8     | 单词翻译与解释职责分离，wire 升至 v5                              |
| 0.9     | 词典式浮层、稳定 DOM 更新和窄屏体验                               |
| 0.10    | Windows DeepSeek/DPAPI/SEA、欧路生词本，以及 YouTube 字幕取词基础 |
| 0.11    | 欧路全部英语收藏到扇贝的每日持久同步、角标和双平台断点批次        |
| 0.12    | 扇贝部分确认、离线词形还原、未解决词放弃/重排队及旧批次再审计     |
| 0.13    | 标准配置页、快捷弹窗、网站黑白名单、Provider 状态及可配同步/字幕  |

## 0.13.0 当前开发进度（2026-08-10）

- 新增五分区标准配置页与快捷弹窗；配置写入由 Service Worker 串行协调，避免弹窗与配置页并发
  保存时互相覆盖。缺失配置使用安全默认值，无效配置失败关闭。
- 网站策略支持默认允许或默认阻止，以及按 hostname 配置允许/阻止和子域继承；最具体规则优先。
  策略在 Content Script 和 Service Worker 两层执行，不改变 Chrome 网站权限。
- macOS 配置页可读取四种 Provider 的非敏感就绪状态并切换到已配置 Provider；Windows 仍固定
  DeepSeek。页面不读取、显示或传输 Key、endpoint、模型参数或在线测试结果。
- 生词本总开关、每日同步开关和本地小时，以及 YouTube 总开关、默认双语和可关闭/自定义快捷键
  均已进入本地配置。wire v7 新增本地状态/Provider 选择控制消息并明确拒绝 v6。
- macOS `verify:macos` 已通过，包括指令、格式、Lint、类型检查、1,529 条单元测试、构建和
  63 条浏览器 E2E。Native Host 已按个人扩展 ID
  `chanmjjealoeeheohofnljbbkkfgfnfm` 重新安装并保留既有 Provider/凭据状态；Chrome 已重载
  最终 `apps/extension/dist`，标准配置页的五个分区、`0.13.0` / Native Messaging v7 标识及
  本机 Provider 状态均实机显示正常，四种 macOS Provider 均显示为已配置，DeepSeek 为当前
  Provider。真实模型和欧路请求未运行，仍需另行批准外部数据发送及可能产生的费用。
- Windows 已使用 Node.js 26 或更高版本与 pnpm 10.12.4 通过 `verify:windows`：包括指令、
  格式、Lint、类型检查、89 条脚本测试、107 条 protocol 测试、991 条 native-host 测试
  （另有 67 条按预期跳过）、376 条 extension 测试、构建、SEA 独立 `health` 和 diff 检查；
  另行运行的 63 条 Chrome E2E 全部通过。
- Windows 已同步安装 `0.13.0` / wire v7 Extension 和 Host。当前加载路径的扩展 ID
  `kmeopbhijmkcjeckjicfinpdminhpbak` 与精确 HKCU Native Messaging 注册表项、manifest 唯一的
  `allowed_origins` 对齐，安装文件与已验证构建产物哈希一致。Chrome 实机已检查 Options 五个
  分区、Popup，以及无需联网的配置即时保存和刷新后持久化；配置页其他功能未发现问题。
- 真实 DeepSeek 验证没有通过：Windows 本地 DPAPI/PowerShell 凭据读取存在唯一已知延期问题，
  偶发约 5 秒超时；用户决定暂时忽略。真实 DeepSeek 和欧路 smoke 均未运行，仍需单独批准；
  本轮也未执行幂等卸载，因此不得据此声称整个系统集成清单或双平台发布已经完成。

## Classic 0.13 安全封存状态（2026-08-11）

- 0.13 保持个人源码加载版，不作为 Chrome Web Store 发布候选；后续只接受严重安全或兼容性修复。
- 本轮补齐设置页保存失败的错误边界及 Options/Popup 行为测试，并校正设置消息、可配置同步整点和
  Windows 验证状态的文档表述。
- 已知 Windows 限制保持不变：真实 DeepSeek 的 DPAPI/PowerShell 凭据读取偶发约 5 秒超时；真实
  DeepSeek/欧路 smoke 与幂等卸载未运行。因而 Classic 不声称完整发布或双平台系统集成验证完成。

## Store 1.0 本地候选历史状态（2026-08-11）

> 此候选从未发布且没有真实本地词库用户，已被 Cloud V1 取代。以下内容只保留为实现证据，不再是
> 当前产品、隐私或发布权威。

- 新的纯 MV3 Store Edition、加密 Vault/生词本、OpenAI/DeepSeek 分析、欧路/扇贝 Outbox、
  YouTube、设置、Popup 和站点生命周期已经形成离线实现闭环，与 Classic/Native Host 无运行时
  依赖。
- 自动发布工程已加入 Store 架构与循环检查、九个关键文件 85% 聚合覆盖率门、候选包审计、生产
  依赖审计，以及加载实际 Store `dist/content-script.js` 的离线 Chrome journey。macOS/Windows
  workflow 固定 Actions SHA，两个平台都执行 E2E。
- Classic 无秘密设置包导出和 Store Settings v5 原子导入已实现，且 Store 生产包已移除
  Zod 4 `Function` 构造器路径，不放宽的严格发布审计通过实际 dist。设置包不包含凭据、
  Provider、URL、页面标题、模型 payload 或生词；导入失败不修改 Store 原设置。
- 当前仍是 `implemented; target-platform validation pending`：真实双平台 Classic→Store 升级核对、
  候选模型、Chrome/Provider/欧路/扇贝、商店材料和新 Store ID 均缺少正式发布证据。不得把
  当前工作树或 `1.0.0` Manifest 版本解释为已经上架。

## Cloud V1 当前状态（2026-08-14）

2026-08-22 hosted 首轮部署已选择 Web-only：新增必填
`HUAYI_STORE_EXTENSION_CAPABILITY=enabled|disabled`，首轮固定 `disabled` 并省略 Extension ID。API
从 CORS/路由 composition 移除 Store 专用 surface，混合路由也拒绝 Extension token；完整 Store release
audit 仍只允许 `enabled`。这不代表 Store 产品或 Windows 支持被取消，启用时仍须真实 ID、版本和 Chrome
门禁。

> **当前校准检查点（Phase 33）**：Phase 28 已补齐 production 语义重复建议和
> 可计算 AA token 证据；2026-08-14 完成度源码审计发现的 SubmissionOutbox `api=null` 误清账号绑定
> 密文与未计数 `not-configured` 回归也已按 Fresh RED→GREEN 修复。Phase 32 按 `product.md` 七条
> 成功标准重建证据矩阵后，将总体状态校准为
> `core slices offline-evidenced; R3-C production implementation and external release gates pending`。
> C5 首轮 RED 为 5 expected failures / 24 baseline passes，终审第二轮 RED 为 2 expected failures / 17
> baseline passes；最终 focused 6 files / 32 tests、Store-domain+Store 110 files / 524 tests、两包 strict
> typecheck/build、目标 ESLint/Prettier 与 instructions/architecture 全绿。根侧完整门禁又通过 114/114
> Node 脚本、444 个 Vitest 文件（2,721 passed / 12 skipped）、Playwright 109/109、全 workspace
> typecheck/build、Store release audit 与 Store coverage 97 files / 480 tests；真实环境门禁未运行。
> Phase 29 随后关闭根 format/lint 例外：精确排除不属于产品 workspace/运行时/发布包的
> `.agents/skills/**`，真实修复其余 5 个门内格式文件；根 format/lint、115/115 Node 脚本、444 个 Vitest
> 文件（2,721 passed / 12 skipped）、Playwright 109/109、workspace typecheck/build 与 instructions/
> architecture 全绿。Phase 30 又在 macOS 真实执行完整 `pnpm verify:macos` 聚合门禁并以退出码 0
> 通过，覆盖上述检查、Store coverage/release、109/109 Playwright、生产依赖审计和
> `git diff --check`；依赖审计未发现已知漏洞。该证据不包含安装、真实 Chrome、Provider/词典 smoke、
> Supabase/Vercel 或多连接 Postgres，因此外部门禁不变。
> Phase 31 已完成正式候选 ready 与开发态 expected-blocked 的独立门禁：后者只允许真实工作树精确命中
> `privacy-not-final`、七项 `release-config-*`、`store-api-origin` 与 `store-web-workspace-url` 十项固定
> 安全 blocker；少项、多项均失败且不回显不可信诊断。Fresh RED 为 2 passed / 3 expected failures，
> GREEN focused 17/17；全量 118/118 Node 脚本、444 个 Vitest 文件（2,721 passed / 12 skipped）通过。
> 更新后的 macOS 聚合门禁也以退出码 0 证明 build 后真实入口、109/109 Playwright、Store release、生产
> 依赖审计与 diff 全绿。Windows 与真实候选/服务/Chrome 外部门禁不变。
> Phase 32 当时进一步明确：R3-C 缺真实安全通知 sender、独立通知 CRON 生产组合和告警实现，
> 且邮件厂商、verified sender/域名、支持联系方式和告警渠道尚未决策；这不是纯验证项。代码缺口后由
> Phase 48 关闭，当前只剩 verified domain/credential/真实投递/告警接收等外部门禁。当前
> Cloud V1 范围还含未跟踪文件，`git diff --check` 只检查已跟踪差异，候选交付范围入库后的重跑
> 仍 pending。逐条证据见 `docs/cloud-v1/offline-completion-audit.md`。
> Phase 33 又完成 Store 当前权限必要性源码审阅：Chrome 官方语义与实际后端共同证明应保留
> `storage`、`unlimitedStorage`、`alarms` 及 OpenAI/DeepSeek/Eudic 三个精确 HTTPS host，不新增
> `tabs`。正式本机词库和词典耐久状态使用 IndexedDB；前者没有总词条/总字节 cap。`storage.local` 中
> SubmissionOutbox 与本机批量导入任务各允许约 5 MiB 明文并可同时存在，删除权限会重新引入默认
> 10 MiB quota rejection 和 IndexedDB 常规 eviction，改变 local-first/耐久恢复语义。当前没有 Cache
> Storage/OPFS 调用，也不把 Chrome 的“无限配额”误述为无限物理磁盘。该结论只关闭当前源码审阅，
> Huayi API origin、正式候选 permission/host/CSP 一致性和双平台真实 Chrome 验收仍 pending。
> 2026-08-20 用户确认当前没有自有正式域名、DNS 管理方、Resend 账号、支持邮箱或告警目的地，R3-C
> 外部前置条件明确延期。本阶段不购买/注册、不创建密钥、不配置 DNS，也不继续真实通知 sender/CRON/
> 告警实现；暂定恢复时优先复核 Cloudflare Registrar + `notify` 子域 + Resend，国内账号/支付不便时
> 备选腾讯云域名 + DNSPod。R3-C 仍是未关闭的生产代码与外部决策缺口。
> 下方 Phase 3–27
> 条目保留各阶段当时的离线实现证据；凡涉及“登录 BYOK 完整结果上传、`/v1/analyses:import`、
> SubmissionOutbox analysis-import、Store 结果直接进入 pendingReview、云端替代本机词库”者均已被
> Phase 27 supersede，不能作为当前产品完成声明。
>
> 文档复审已完成：用户确认 AccountDataExport 是最多保留 24 小时的独立私有副本，可包含 snapshot
> 时尚未过期的平台查询；原 generation 仍按一小时硬删且不进入历史，隐私材料明确披露这一导出例外。
> Phase 27A–27D 已完成离线实现，27E/27F 的 StudyCapture 显式分析、断线恢复和 analysis/capture
> 删除关系与 Phase 27 八类账号导出 snapshot 已完成离线实现；CloudWordCopy 单条副本和显式本机批量
> 导入也已完成 contracts/API/Postgres/Store Options 的离线实现。TTL 已补齐 durable dispatch mark、
> security-definer `SKIP LOCKED` 批处理、未 dispatch 释放、已 dispatch 保守结算、terminal 到期硬删、
> CRON_SECRET 路由与 Vercel 每分钟调度；owner 按访问路径也不会误删尚未安全终态化的 running 行。
> 27H 已替换旧 analysis-import 浏览器 fixture：packaged Store Content Script 经 production
> StudyCapture outbox/API seam 手动采集句子，actual Web 从 CaptureInbox 显式深度分析进入 ReviewInbox，
> 再确认候选并从 Learning Library 重读；automatic journey 另证明 created-only 当前卡撤销和 exact
> existing 无撤销；双页面并发证明 stale revision 不误删，断网队列经 production alarm runner 恢复后可由
> Web 重读。platform query 另经 production QueryRouter/PlatformAnalysisEngine/HTTP SSE decoder 证明成功
> 不进入历史/待收藏/StudyCapture，quota exhausted 也不回退本地 BYOK。CloudWordCopy 联合 journey 证明
> 本机保存先成功、开启复制后可由 Web 重读、关闭复制时 authority 零写入，以及离线关卡后共享 outbox
> 可经 production alarm runner 恢复。显式历史导入另以 production Options controller、加密 runtime 与
> alarm runner 证明 201 词预览/二次确认、100+100+1 续传、Web 重读和本机不删除。完整离线 Playwright
> 账号断开 journey 另证明离线 CloudWordCopy 队列被清除、authority 零写入而本机词仍可重读。完整离线
> 换号 journey 再经 production CloudSessionManager 完成新配对交换，证明旧队列不跨账号、本机旧词保留、
> 新收藏使用第二个 session 写入。LocalEudicImport 再证明欧路页先只进本机，用户完成 2 词/1 语境预览
> 与二次确认后才创建 Web 副本。Cloud Eudic export/import 和 Shanbay 人工确认任务另通过 actual Web/
> Store production bridge 联合验收，证明 import 不写本机、Shanbay 不暴露云 capability；Eudic 稳定失败
> 需 Web 显式重试，Shanbay 两词可精确投影 1/2 部分成功，取消后的当前租约迟到回执也不会改变
> cancelled 权威。AccountDataRights actual bundle journey 另覆盖导出、下载、永久删除和 signed-out；
> AdminOperations 两条 actual bundle journey 覆盖 Operator 管理闭环与非 Operator access 失败关闭；密码
> actual-bundle 另覆盖邀请注册 202、显式确认 callback、错误密码与正确密码新 session；登录方式 fence
> 再证明 provider 密码正确但 Huayi 只登记 Google 时统一 401、零 Cookie；Phase B 双向绑定旅程再覆盖
> recent-auth、provider callback、Cookie/CSRF 轮换和服务器重读；stale password-link 在稳定 409 后重读
> canonical method list。完整离线 Playwright 104/104 通过。
> 当前全局生产路由覆盖复审已固定在 `docs/cloud-v1/browser-acceptance.md`：`/practice/history` 的生产入口
> 组合证据已完成；`/history` 的正交状态维护闭环、`/pair-extension/:id` 审批入口和密码认证入口均已
> 补齐，当前矩阵没有已知的 production Web 入口组合缺口。
> 后续账号能力审计发现 Supabase 同邮箱 auto-link 与“不静默合并”冲突。Huayi-owned method
> authorization fence 的 Phase A 已实现并完成实现后复审：邀请只登记实际 method，普通密码/Google 登录
> 未登记 method 时零 session，既有 profile 不能借邀请补绑。Phase B recent-auth 与双向可恢复显式绑定
> 后端与账号页双向 UI 已离线实现，真实验证仍 pending，详见
> `docs/cloud-v1/account-sign-in-methods.md`；不得把 Phase A 或离线实现解释为整体完成。
> Phase B 已继续完成 production method GET、forced-RLS owner 查询、Web strict client、recent-auth/link
> contract scaffold，以及 password recent-auth 的 Cookie+Origin+CSRF、限速、同 user 校验和原子 encrypted
> refresh/session/CSRF 轮换；Google recent-auth 的 path-scoped intent、purpose/session/user-bound flow、
> 单次 continue/callback 与同一原子轮换也已完成。Google manual link 已实现四阶段/30 秒单写 lease、
> refresh/state 先持久化、manual link、callback method 写入及其他 session 撤销；Google-only→password
> 也已实现独立四阶段/30 秒 lease、authenticated updateUser、method 写入和全局 session 撤销。账号页 UI
> 已接入 canonical method list、双向 recent-auth/link、Cookie/CSRF 刷新与服务器重读，两条 actual Web
> bundle 三条旅程已通过。session 已新增 password/google/null recent-auth provenance，普通登录
> 不能冒充绑定前置证明；Provider adapter 已把 session refresh 与 manual link start 拆成两个可持久化
> stage，数据库四阶段 flow 已接入 production Postgres adapter；重复已绑定请求现仅在完整 Web proof 与
> 正确 recent-auth provenance 后返回稳定 409 `sign_in_method_already_linked`，stale Web 页面会重读权威
> method list；当前状态为 `Phase B offline implementation complete; target-platform validation pending`。
> Store/Web E2E support 均已纳入 strict TypeScript
> 门禁。断开与换号不再是待处理矩阵；根 format/lint 阻塞已由 Phase 29 关闭，真实登录/部署、真实外部
> 服务与双平台验收仍待处理。
> PasswordRecovery 随后已完成全局审计、Supabase 官方 PKCE 行为复核和独立需求/技术/数据/测试/验收
> 方案审查。R1 已按 RED→GREEN 增加 strict contracts/internal outcome、独立三操作 Provider port、共享
> 逐 flow Supabase PKCE storage 与 recovery adapter；R2 已实现深模块、内存与 Postgres 状态机，覆盖本地
> request、dispatch-before-provider、同 owner callback、过期、单写完成、dispatch/complete 前 eligibility
> 重检、全 session 撤销和单通知事务。两张受限表、12 个 recovery 与 3 个 notification SECURITY DEFINER
> 转换、forced RLS、业务 role 零直访和 cleanup 已进入 migration。R3-A 又完成五条公开 HTTP、dispatch
> CRON、250ms start floor 与 production composition，R3-B 完成 notification-ID 幂等 sender port、120 秒
> Postgres lease、有界退避与 fake sender。R4 已接入 Web strict client、独立 `/recover` 状态机与
> production-bundle fake-mail journey；focused Web 17/17、专项 Playwright 1/1 覆盖另一浏览器最新邮件、
> 旧邮件/replay、显式 callback、purpose Cookie、全 session 撤销、单通知与旧/新密码重登。当前 contracts
> 62/62、API 102 files、360/360。真实 notification sender/CRON/告警受邮件厂商、verified sender、支持
> 联系方式和部署配置门禁约束，Supabase/邮件/部署与双平台 Chrome 仍待 R5；状态严格保持
> `R4 Web + actual bundle offline implemented; R3-C real notification sender and R5 target-platform
validation pending`。R5 离线总审已通过 Web 184/184、完整 Playwright 105/105、instructions、workspace
> typecheck/build、`pnpm test`、目标 lint/format 与 diff check；当时根级 format/lint 仍分别由既有 70 个
> 文件和 `.agents/skills/**` 143 条错误阻塞，后由 Phase 29 关闭。详见
> `docs/cloud-v1/password-recovery.md`。
> 普通 Google 登录随后完成独立全局审计、产品/技术/数据/TDD/验收方案和实现前后复审。登录 handler 已
> 改用 identity-owned strict 空 schema；普通/邀请 start 与共用 callback 固定 no-store，callback 成功/失败
> 固定 no-referrer。actual `/login` production bundle 新增 active→`/app` full session、disabled→
> `/settings/data` data-rights session、未登记 google method→统一失败/零 Cookie 三条 fake Provider
> 旅程，并证明 flow/code 不作为 Referer 进入 Web。专项 3/3、完整 Playwright 108/108 通过；状态为
> `implemented; target-platform validation pending`，详见
> `docs/cloud-v1/google-authentication-acceptance.md`。
> 随后的完整 V1 离线完成度审计不再以“production Web 入口矩阵无缺口”代替逐项证明。审计确认的两个
> 本地缺口——production 语义重复建议与 AA token 可计算证据——现均已完成离线闭环。需求/技术/数据/
> TDD/验收与实现前后审查已写入 `docs/cloud-v1/offline-completion-audit.md` 和
> `docs/cloud-v1/semantic-duplicate-suggestions.md`；当前状态为
> `Phase 28 S1–S5 implemented and verified; target-platform and real-service validation pending`。
> A1 Fresh RED 实测 tertiary/canvas 仅
> 3.27:1，
> 新增 slate-500 映射后 normal text 全部组合≥4.5:1、focus ring≥3:1；专项 2/2、既有 styles 7/7 与 Web
> strict typecheck 通过。S1 另完成语义建议 strict Idempotency-Key、Web 传键、API no-store/拒绝
> `If-Match` 和稳定 409/429/502 error status；focused contracts 3/3、Web 12/12、API 7/7 与三包 strict
> typecheck 通过。S2 已对照既有 paid Practice/Analysis 模式复审深 module seam，并完成固定 DeepSeek
> Provider、paid generator、空候选零调用与费用/dispatch/alias/error 回归；S2 focused 12/12、API
> 105 files / 374 tests、strict typecheck/build、instructions/architecture 与目标 lint/format 通过。Postgres
> S3 又完成 restricted forced-RLS Postgres authority、原子费用结算、dispatch 前释放重领、dispatch 后
> 保守失败、24h replay TTL 和 ≤100 cleanup；根侧复审补齐 CRON 未 dispatch 同 key 重领回归。focused
> 4 files / 23 tests、API 107 files / 383 tests、strict typecheck/build、instructions/architecture 与目标
> lint/format 通过。S4 已把固定 DeepSeek adapter、paid generator 与 Postgres authority 接入 production，
> 并挂载 `CRON_SECRET` 保护的每分钟 cleanup。相同 owner/key 先处理 terminal replay/busy/conflict；只有新
> generation 才执行精确价格预检、kill/quota-before-fetch、新 reservation 与 durable dispatch。Web 每次
> 显式点击使用新 key、不自动重试，稳定失败保留详情，item/revision 变化清除并抑制迟到 suggestion。
> actual `/library` production bundle 已走完 suggestion→preview→显式 confirm→target GET server reread，
> 并证明公开 snapshot/Web Storage 不含正文、prompt、raw output、reservation 或 task。S4 fresh evidence
> 为 API 109 files / 387 tests、Web 42 files / 191 tests、专项 Playwright 1/1、strict typecheck/build、目标
> lint/format 与 instructions/architecture 全绿；根侧 focused 复验另为 API 9 files / 38 tests、Web 2 files /
> 17 tests、Playwright 1/1。Cloud V1 可声明本地离线实现完成；真实 DeepSeek、Supabase/Vercel、邮件、
> 多连接 production Postgres、双平台 Chrome 与发布动作仍待独立批准和验证。
> S5 又完成 15 份权威文档收口，并以新鲜 workspace 证据通过 typecheck/build、114/114 Node 脚本、
> 443 个 Vitest 文件（2,714 passed / 12 skipped）、Playwright 109/109、instructions 与 architecture。
> 目标文档和本阶段文件的 lint/format 通过；当时根级 format/lint 仍分别由 70 个既有文件与
> `.agents/skills/**` 的 143 条既有错误阻断，不属于 Phase 28 回归；该历史阻断已由 Phase 29 关闭。

- 当前产品线是 Store Extension + Web App；BYOK 只是插件查询模式。账号级模式默认 platform，可在 Web
  全局切为 byok，各设备 Key/Provider 仍只在本机；任一失败都不自动 fallback。
- 插件 platform/BYOK 都只显示 compact ExtensionQueryResult。平台正文/结果最多保留一小时，BYOK 结果
  零上传；两者均不进入 AnalysisRecord/历史。Web 的 V2 深度分析独立消耗平台额度，只分析 phrase/
  sentence/passage，并只产生 Expression/SentencePattern 候选。
- 新 StudyCapture 只保存原始学习意图，支持 manual/automatic、exact dedupe、created-only 当前卡 undo、
  CaptureInbox→显式分析/reanalysis→ReviewInbox。分析请求在模型前持久化并锁住 capture revision；首次
  失败恢复 pending，重新分析失败保留旧 latest；刷新后可从脱敏 running requestId 查询同一请求。
- LocalLexiconEntry 是每个安装的独立正式数据。登录/换号不清本机词库；CloudWordCopy 是可关闭的
  future-only 独立副本，历史本机生词只经显式数量预览和二次确认导入。
- 文档权威入口为 `docs/cloud-v1/extension-query-and-study-capture.md`，ADR-0019/0020/0021 及 Cloud 核心
  文档。Phase 27 文档已复审；CloudWordCopy 与 TTL 定时清理已完成离线实现，首条 actual Web/Store
  StudyCapture 跨端 journey，以及 automatic/created undo/existing/offline/revision race journey 已通过；
  platform query 成功/额度失败无 fallback journey 也已通过；CloudWordCopy local-first、关闭零写入和离线
  恢复联合 journey 已通过；201 词显式历史批量导入和账号断开保留本机词也已完成离线 actual Store/Web
  联合验收；换号的新 session 隔离和本机保留也已完成。真实部署与双平台验收仍缺，因此不得据此开放
  邀请或发布。
- 本轮 fresh 离线门禁通过 instructions、architecture、全 workspace typecheck/build、114/114 Node 脚本、
  423 个 Vitest 文件（2,628 passed / 12 skipped）、104/104 Playwright，以及本任务文件的精确 ESLint/
  Prettier。当时根 `format:check` 仍被 70 个既有文件阻断，根 `lint` 仅被 `.agents/skills/**` CJS 资产的
  143 个错误阻断；本轮已清除同一受影响 Web 测试中的两个既有 lint 错误，未改动其余非本任务文件。该
  根阻断后由 Phase 29 关闭；目标平台验证仍未写成已完成。
- Phase B recent-auth/provenance/manual-link 当前 fresh 证据为两种 link HTTP 12/12、深模块恢复 2/2、
  专项 PGlite 4/4、Supabase adapter 4/4、API 包 94/94 文件与 323/323 测试；API strict typecheck/build、
  目标 ESLint/Prettier 与 instructions/architecture/diff-check 均通过，最后组合/migration 改动另有 focused
  20/20 回归。Web identity 16/16、登录方式 component 4/4、Web 包 38 文件/175 测试、三条 actual
  bundle journey 均通过；上一条 Phase A 全量证据保持有效但不冒充本增量全量
  证据。
- Cloud release audit 已补齐 Phase 27 公开材料规则：缺少账号偏好、无自动 fallback、StudyCapture 原始
  意图或本机词库/CloudWordCopy 独立边界时固定失败；旧 `analyses:import`、`pendingReview import` 和登录
  BYOK 完整结果上传口径也固定失败。当前开发态仍只因最终隐私事实、候选公开配置与 Store null-origin
  按设计失败关闭。
- `GET /v1/account` 已完成需求/技术方案复审与离线 TDD：聚合规范邮箱、完整五项偏好、当前有效
  Extension session 和公开最低版本；拒绝旧孤立契约伪造的账号 consent/status，quota 保持独立模块。
  Contracts 3/3、API 8/8、Web 28/28 focused 与 actual Web 账号页均通过，详见
  `docs/cloud-v1/account-profile.md`；真实登录/部署仍待。
- LearningItemArchive 已完成需求/技术/TDD 方案、领域术语、离线实现与实现后复审：归档只停止未来练习，
  完整保留排期、来源、标签和既有 PracticeSession，恢复沿用原排期；strict contract、bootstrap migration、
  Postgres 锁/幂等、queue/session、账号导出、Web 二次确认/筛选和 actual bundle 归档恢复旅程均已接线。
  不可逆删除已单列为 LearningItemErasure；归档状态为 `implemented; target-platform validation pending`，详见
  `docs/cloud-v1/learning-item-archive.md`。
- LearningItemErasure 已完成需求/技术/数据权/TDD 文档、实现前后复审与离线实现：已练习项须先归档，
  仅在引用 session 安全终态后清除正文、identity、来源、标签、系统属性和排期；PracticeSession 独立
  保留，最小墓碑在最后引用删除后清理。contracts、Postgres、Practice replay/history、账号导出、Web
  与 actual bundle journey 均已通过，状态为 `implemented; target-platform validation pending`，详见
  `docs/cloud-v1/learning-item-erasure.md`。
- Store DeviceDisconnect 已完成需求、技术、数据、安全、TDD、验收方案与 ADR-0022：动作由“只忘记
  本机”校准为当前 token singular self-revoke 204 后再清本机会话/账号绑定队列；网络失败必须保留撤销
  能力。contracts、SQL/API、Postgres adapter、Store manager、Popup 与 actual bundle 离线实现和实现后
  复审均已完成；focused 53/53、workspace Vitest 2580 通过/12 跳过、Playwright 93/93 通过。状态为
  `implemented; target-platform validation pending`，详见 `docs/cloud-v1/extension-session-disconnect.md`。
- Phase 19 AdminOperations 的 contracts/Postgres/API/Web 组件闭环仍有效；2026-08-14 全局复审发现并
  修复 actual Web production bundle 证据缺口。独立 strict helper 与两条 journey 已覆盖 Operator 四区、
  literal 筛选、停用、一次性邀请、kill switch、服务器重读和非 Operator access 403 后零下游读取；
  focused 2/2 与完整 Playwright 96/96 通过，状态为
  `implemented; target-platform validation pending`。真实角色、部署近期认证、告警与备份恢复仍 pending。

- 已确认 Extension 查询 + Web 学习工作台、云端学习数据唯一权威、React/Vite + Hono、
  Supabase/Vercel、DeepSeek 平台额度与本机 BYOK 并存的产品和技术路线。
- 已建立产品、架构、数据模型、API、安全、测试、运营、隐私、发布和分阶段开发文档，以及 superseding
  ADR；Phase 0 文档审阅与 Phase 1 工程骨架已经完成主任务验收。
- 已创建 `learning-domain`、`cloud-contracts`、`api` 和 `web` workspace，加入离线 fake、Vercel
  入口/环境 schema、runner 与架构夹具。Phase 2 已实现严格领域模型、规范键、候选确认与非覆盖合并、
  固定排期、micro-USD 计算、`/v1` Zod 契约和共享 fixture；Store 的既有分析结果与词头规范化通过
  `learning-domain` 公开 seam 复用。Phase 2 定向测试为 learning-domain 14、cloud-contracts 15、
  Store 兼容 32，API/Web/Store Extension 各 1 条共享 fixture；全量 typecheck、build、架构与定向
  ESLint/Prettier/diff 检查通过。
- Store 当前阶段已提交并成为后续双端同步开发的基线；最新 bundle budget 定向测试 4/4 通过，旧的
  两项 bundle 红灯不再是当前状态。根 `format:check` / `lint` 是否仍受用户已有、未跟踪的
  `.agents/skills/**` 设计资产影响，必须以每次全门禁的新鲜结果单独归因。
- Store Extension 现有本地候选代码将作为查询、Provider、DeviceVault 凭据、YouTube 和外部词典
  能力的迁移来源；不开发旧本地 WordEntry 用户数据迁移器。
- Phase 3 已实现 Hono→Postgres/Supabase adapter、核心迁移、强制 RLS、邀请/Auth flow、Web session、
  CSRF/CORS、Extension 配对、额度/价格/账本、限流与管理审计，PGlite 离线迁移与跨租户矩阵通过。
  Phase 3 定向 API 测试为 80/80；当时全量单元测试为 2,044 passed、12 skipped；全量 typecheck 和离线
  E2E 66/66 通过。当时根 format/lint 仍被未跟踪 `.agents/skills/**` 资产以及既有
  `docs/cross-platform-development.md` 格式阻断，受影响 API/契约/Cloud 文档范围的 ESLint/Prettier
  已通过；该历史阻断后由 Phase 29 关闭，真实服务、多连接数据库竞争与目标浏览器仍未运行。
  状态为 `Phase 3 foundation implemented; external production validation pending`。Phase 4 首个
  分析/历史切片已实现 fake-model 用例、SSE、断线状态、BYOK 导入、租户隔离历史，以及 Web/Store
  共用契约上的真流式 HTTP adapter；生产组合已将 AnalysisRecord、Candidate、UsageLedger 与额度结算
  放入同一 Postgres 事务，Web 写请求要求 Cookie+Origin+CSRF，插件请求使用可撤销设备 token。
  DeepSeek 平台 adapter 已离线实现固定模型、thinking high、严格 JSON、90 秒总超时、一次仅修结构、
  reasoning 丢弃、逐调用 token/费用账本，以及部署单价和不可变数据库价格快照完全一致的失败关闭；
  数据库请求生命周期已进一步实现跨实例运行中去重、terminal 重放、4 分钟租约 fencing、5 分钟
  额度预留和过期保守结算；完整分析历史 API 切片也已实现签名 cursor/keyset 分页、五类筛选、详情、
  nothing-to-save、归档、恢复、删除、revision/幂等事务及 Web/Store adapter。候选确认切片已实现
  Word/Expression/SentencePattern 严格路由、混合批次原子 create/merge、精确重复冲突、可信来源快照、
  revision/幂等/RLS 与 Web/Store adapter。API focused tests 为 127/127，cloud-contracts 为 19/19、
  learning-domain 为 15/15、Web 为 8/8，Store confirmation adapter 为 5/5；2026-08-13 候选确认切片
  根任务复验
  `check:instructions`、`check:architecture`、全 workspace typecheck/build、受影响范围 ESLint/Prettier、
  diff 检查、2,107 passed/12 skipped 全量单元与集成测试及 66/66 离线浏览器 E2E 均通过。随后首个
  Web/Store UI 切片完成，根任务再次复验为 2,127 passed/12 skipped，离线浏览器 E2E 仍为 66/66；
  并使用本地 fake API 在真实浏览器验证桌面、390px 窄屏、候选编辑/确认、空态、无横向溢出和零
  控制台错误。真实
  DeepSeek 模型/价格能力核验与跨端 journey 当时仍未完成；学习库/语义重复建议和完整历史 Web UI 后续
  已形成离线纵向切片，Phase 28 又补齐语义建议 actual-bundle；不得解释为可邀请注册、已部署、已通过真实
  DeepSeek/Supabase/Chrome 或已具备商店候选资格。
- Phase 5/6 首个 UI 切片已实现：Web 现在有复用三层品牌 token 的可访问 App Shell，以及待整理列表、
  详情、候选字段编辑/勾选、原子批量确认和无需收藏闭环；loading/empty/error、精确重复保留草稿、
  键盘焦点交接、窄屏与 reduced-motion 均有离线覆盖。生产入口以严格 `VITE_API_ORIGIN` 和 Cookie
  CSRF bootstrap 接线，缺配置失败关闭。本切片 Web focused tests 为 19/19，Web/Store/store-domain
  typecheck 与 build、Store 入口 focused tests 43/43、完整 Store + store-domain 离线测试 411/411、
  受影响 ESLint/Prettier、架构与 diff 检查均通过。
- Store 浮层在终态查询结果下显示“整理与收藏在 Web 完成”，只发送无 URL/analysisId/token 的严格
  命令，由 Service Worker 决定发布期固定 HTTPS 目标；当前正式 Web 目标尚未配置，因此入口会显示
  失败，不会打开 `.example` 或任意页面，Manifest 也没有增加 `tabs` 权限。完整登录/邀请、Extension
  配对/session、语义/精确查重目标选择、完整跨端 journey、真实 Vercel/Supabase/Chrome 环境仍未
  完成；本切片不得解释为 Phase 5/6 完成或可邀请用户使用。
- Phase 5/6 账号配对客户端纵向切片已离线实现：Web 以 Cookie + 固定 Origin 的 CSRF bootstrap
  区分登录态，并提供固定 pairing ID 的显式设备标签审批；未登录会进入真实密码登录页。API 复用
  既有 Postgres pairing/session authority，一次 exchange 后公开轮询返回
  404，不泄露 consumed 或设备标签。Store Service Worker 生成 state/PKCE、固定间隔有界轮询、交换并
  使用 DeviceVault DEK 下的专用 envelope 加密 pending/session；通用 CredentialSlot、Options 和
  Content Script 不获得 token 能力。Popup 只显示脱敏状态，并把本地删除明确标为“本机断开”。
  2026-08-14 复审另发现 `api.md` 对 approve 的 Idempotency-Key/If-Match 描述与一次性状态机不一致，现已
  校正为 body revision + GET approved 恢复；production `/pair-extension/:id` actual-bundle 审批旅程已按
  `docs/cloud-v1/pairing-approval-acceptance.md` 完成：披露文案、三项偏好、consent、一次批准与 reload GET
  approved 均通过，完整 Playwright 99/99。状态为
  `implemented; target-platform validation pending`。
- 生产 `HUAYI_CLOUD_API_ORIGIN` 与 `HUAYI_WEB_WORKSPACE_URL` 仍为 null，因此当前发布组合保持
  not-configured，不会调用真实服务或打开保留域名。真实 Supabase/Vercel/Google/邮件/Chrome
  journey、平台云分析和当时尚未开始的 outbox 仍未实现或验证；后续 BYOK outbox 切片状态见下文，
  不能据此宣称 Phase 5/6 完成或
  产品可用。
- 2026-08-13 根任务对账号配对切片再次执行全仓门禁：`check:instructions`、架构、全 workspace
  typecheck/build、2,145 passed/12 skipped 全量单元与集成测试及 66/66 离线浏览器 E2E 均通过；本地
  fake API 的真实浏览器验收也覆盖设备名输入、审批提交、品牌化成功态和零控制台错误。该次证据不
  替代真实登录、发布 origin 或 Chrome 跨端配对 journey；服务端撤销由后续账号设备管理切片覆盖。
- Phase 5/6 账号设备管理切片进一步实现 Web `/settings/devices`：登录 bootstrap 后严格列出服务器
  有效的 Extension session 元数据，覆盖 loading/empty/error/retry、窄屏、二次确认、焦点交接、撤销
  成功和失败保留。DELETE 继续要求 Cookie + 固定 Origin + CSRF；Hono 与 embedded Postgres 测试证明
  跨账号 ID 不可撤销，只有 owner 撤销后设备才从权威列表消失。页面不接收 token，并明确说明 Store
  Popup“本机断开”只删除本机凭据，不等同于服务器撤销。
- 2026-08-13 根任务对设备管理切片复验：`check:instructions`、架构、全 workspace typecheck/build、
  2,152 passed/12 skipped 全量单元与集成测试及 66/66 离线浏览器 E2E 均通过；本地 fake API 的真实
  浏览器验收覆盖设备元数据、二次确认焦点、服务器撤销、成功播报和空态。该证据不替代真实登录、
  Supabase/Vercel 或 Store↔Web 跨端撤销 journey。
- Phase 5/6 邀请与 Web 认证切片已离线实现：`/join#<token>` 的 fragment 不发送给托管/CDN，Web 以
  严格 JSON body 和 `no-referrer` 领取后立即清除地址栏，
  claim ticket 只在组件内存与固定 API 原生 Google POST 的隐藏 body 中短暂存在；Google start 同时
  保持严格 JSON 兼容，并拒绝 form 的额外、重复、缺失、过长/非法字段和错误 Content-Type。邮箱密码
  注册区分邮件验证等待与即时 Cookie session，`/login` 只在严格服务端成功后进入工作台；客户端不
  直接使用 Supabase，也不伪造 Google 成功。
- 2026-08-13 根任务安全复审发现并修复了最初 `/join/<token>` 可能进入托管/CDN path 日志的问题，
  改为 fragment 路由并增加旧路径拒绝、邀请响应契约和 `no-referrer` 回归。复验通过全 workspace
  typecheck/build、2,167 passed/12 skipped 全量单元与集成测试、66/66 离线浏览器 E2E，以及本地真实
  浏览器的品牌化登录页与旧邀请路径拒绝检查。
- 生产 API/Web origin 仍为 null，Store 本机断开也没有主动调用服务器退出。普通 Google 登录、双向
  身份绑定和邀请到学习项的 actual-bundle 离线组合已实现；真实 Supabase/Vercel/Google/邮件、部署
  Cookie/Domain、Chrome 跨端配对/撤销仍未验证，不能据此关闭 Phase 5/6、开放邀请或宣称产品可用。
- Phase 5/6 登录 BYOK SubmissionOutbox 切片已离线实现：Store Service Worker 只在固定 API 配置与
  活动 session 同时存在时，把严格终态、可信来源、公开 model/prompt/schema version 转成既有
  `/v1/analyses:import` 内容；现有结果没有 Candidate 时保持空数组，不伪造深度分析。正文以 DeviceVault
  DEK、独立 AAD/envelope 加密，限制 20 条/5 MiB/7 天，并由 alarm 使用稳定幂等键恢复 transient 失败。
- 401/403、过期、本机断开、新 session 或撤回联网同意会在请求前清除账号绑定队列；永久无效项单独
  丢弃。未登录、未配置和用户关闭后迟到的结果保持 local-only，Content Script/Options/Popup 消息与
  Manifest 均未扩权。API
  幂等接收后使用同一 CloudAuthority 保存 `pendingReview`，既有 Web Inbox 可见，不新增第二权威。
- 生产 `HUAYI_CLOUD_API_ORIGIN` 仍为 null，因此发布组合尚不会真实排队/上传；Popup 已可查看脱敏聚合
  状态、复用原幂等键手动重试并二次确认清空本机队列，但不提供逐项正文管理。真实断网恢复、
  Store→API→Web 浏览器 journey、远程撤销即时推送和平台模型客户端仍未完成
  或验证，不能据此关闭 Phase 5/6。
- 2026-08-13 根任务对 SubmissionOutbox 切片复验：`check:instructions`、架构、全 workspace
  typecheck/build、2,186 passed/12 skipped 全量单元与集成测试及 66/66 离线浏览器 E2E 均通过；独立
  审阅确认断开后晚到结果不捕获、撤回同意不上传、换号/过期/鉴权失败会清队列，且 Content/Options
  没有获得 token 或正文能力。该证据不替代真实离线恢复或 Store→API→Web Chrome journey。
- 2026-08-13 根任务对 Popup 脱敏 SubmissionOutbox 管理再次复验并补齐断开后的聚合重读、当时 API
  配置消失时清理旧队列和规范 ISO 时间校验；其中 adapter 缺失清理口径已由 2026-08-14 Phase 27F-R
  supersede 为保留密文与 counted `not-configured`：当时全 workspace typecheck/build、2,323 passed/12 skipped 全量
  单元与集成测试、既有 66 条离线浏览器 E2E、instructions/architecture、受影响 ESLint/Prettier 与
  diff 检查均通过。根 `lint`/`format:check` 仍只被未跟踪 `.agents/skills/**` 资产及既有
  `docs/cross-platform-development.md` 阻断；真实断网和 Store→API→Web Chrome journey 未验证。
- Phase 5 Web 粘贴分析切片已离线实现 `/analysis`：登录 bootstrap 后以 strict manual 请求、Cookie、
  固定 Origin、CSRF 和新幂等键消费既有 SSE；页面覆盖 started、临时 preview、completed、failed、
  保留输入重试、AbortSignal 取消/迟到抑制，以及 started-only 后 owner-scoped status 查询。只有严格
  完成才交接到既有 `/app` 待整理权威，不建立本地记录；running 不伪造完成或自动重跑。页面包含
  2,000/500 字符边界、键盘可达控件、live region、窄屏单列和 reduced-motion。当前取消只停止本页
  等待，不是服务器任务撤销；真实 DeepSeek/部署网络、真实登录账号和分析→整理浏览器 journey 仍未
  验证，Phase 5/6 与总体目标保持 open。
- 2026-08-13 根任务对 Web 粘贴分析切片复验：`check:instructions`、架构、全 workspace
  typecheck/build、2,196 passed/12 skipped 全量单元与集成测试，以及既有 66/66 离线浏览器 E2E
  均通过；受影响 Web/Cloud 文档的 ESLint、Prettier 和 diff 检查也通过。既有 E2E 只覆盖扩展离线
  journey，不替代 Web `/analysis` 在真实登录、SSE 代理、平台模型和部署环境中的端到端验收。
- Phase 5 学习库只读切片已实现 strict list/detail、服务器筛选与 due/new 时钟、Postgres tenant
  transaction/强制 RLS、最近 completed practice 最小摘要，以及 Web `/library` 列表、详情、筛选、
  分页和恢复状态。根任务复审进一步用 HMAC 上下文分离阻止分析历史与学习库 cursor 跨资源复用，并
  用运行代次抑制 Web 旧列表/详情响应覆盖最后一次操作。后续手动创建、维护安全子集与练习切片已接入；
  真实登录、部署 Postgres 查询计划与 Web 学习库浏览器 journey 仍待验证。
- 2026-08-13 根任务对学习库只读切片最终复验：全 workspace typecheck/build、2,212 passed/12 skipped
  全量单元与集成测试、既有 66/66 扩展离线浏览器 E2E、instructions/architecture、受影响
  ESLint/Prettier 与 diff 检查均通过。两条新增 RED 分别证明同密钥跨资源 cursor 原先会被接受、旧列表
  响应原先会覆盖新筛选；修复后双向 cursor 领域分离和列表/详情竞态均有回归覆盖。既有 E2E 仍不替代
  Web `/library` 的真实浏览器 journey。
- Phase 5 学习库首个只读切片已离线实现：共享契约新增 LearningItem + ScheduleState + 最近 completed
  practice 最小摘要的 list/detail 与固定 GET routes；API 深模块使用独立签名 keyset cursor，Postgres
  adapter 在 tenant transaction/forced RLS 中执行 type/tag/systemAttribute/query/due/new 筛选、详情和
  最近练习查询，跨账号 UUID 与不存在统一 404。Web `/library` 提供登录后列表、详情、服务端筛选、
  分页、loading/empty/error/retry、详情焦点/live region、窄屏和 reduced-motion；页面不建立第二权威。
  本切片没有修改 migration，也不实现 create/patch/delete/merge、语义建议或练习。真实部署账号、数据
  规模查询计划与浏览器 journey 仍未验证，总体目标保持 open。
- Phase 5 学习库手动收录切片已离线实现 strict POST + Idempotency-Key、Web Cookie/Origin/CSRF、
  Postgres tenant transaction 原子创建 item/level -1 schedule/规范化标签，以及两类 Web 表单、duplicate
  草稿保留和成功后的 server list/detail 重读。维护与练习由后续 Phase 10/8/9 安全子集补齐；真实部署
  仍未验证。Cloud 未发布 bootstrap 0001 的 allowlist 有变，既有开发库需重建。
- Phase 10 学习库维护切片已离线实现 strict PATCH/DELETE/semantic suggestion/merge preview+confirm、
  Postgres owner/RLS/revision/idempotency transaction，以及 Web 类型专属编辑、二次删除确认与显式合并。
  当前删除实现只开放未练习 hard-delete；安全合并 source 必须未练习且 level -1，target schedule 保留，删除/合并
  后同 key 从 response snapshot 重放。production 语义模型 fail-closed；已练习项目的可逆 archive 已于
  2026-08-14 完成离线实现与 actual bundle 旅程；不可逆 LearningItemErasure 也已完成实现前后复审、
  离线实现与 actual bundle 旅程，真实模型 quota/claim/lease、真实多连接数据库、登录/部署浏览器 journey
  尚未验证。bootstrap 0001 allowlist 有变，
  既有开发数据库需重建。
- Phase 8 最小主动练习已离线实现：strict daily queue/session/attempt/retry/rating contracts，Postgres
  timezone/due-first/new-fill、PracticeAttempt、反馈 lease fencing 和排期一次推进，以及 Web `/practice`
  队列→作答→反馈→来源→自评闭环。
- Phase 9 受约束对话已离线实现：strict 1–3 items、3–5 round、turn-first、start/assistant/final generation
  lease fencing、显式 retry、逐项反馈、刷新恢复与多项原子自评。production practice/dialogue model 明确
  fail-closed；quota ledger、历史与删除已在后续阶段接线，练习历史 actual-bundle 补充验收也已完成；
  当前只缺真实模型/登录部署浏览器验证。bootstrap 0001 有新字段/索引，既有开发库需重建。
- Phase 9 根审阅补齐对话请求丢响应后的权威重读与草稿保留/清空，并禁止 pending start 暴露内部
  prompt 占位；模型失败的成功 HTTP 投影也只播报处理中，不再误报“已更新”。
- Phase 11 练习历史与单次删除已离线实现：strict summary/detail/delete 契约，独立签名 completion cursor，
  2026-08-14 复审确认 contracts/API/Postgres/Web 组件证据仍有效，并按
  `docs/cloud-v1/practice-history-acceptance.md` 补齐 production `/practice/history` actual-bundle 组合旅程：
  删除后 history server reread 为空，LearningItem/ScheduleState 仍以两个 `DUE` 项由 `/practice` 重读；
  focused 1/1 与完整 Playwright 97/97 通过。状态为
  `implemented; target-platform validation pending`；真实身份、数据库和部署验证继续 pending。
  Postgres owner/RLS status/type 查询与完整造句/对话投影，Web `/practice/history` 的筛选、分页、详情和
  二次确认删除。历史如实包含未完成正式 session，但只允许删除无 worker lease 的 completed（已评分或
  未评分）；删除不回滚 LearningItem 排期或删除 SourceExample，同 key 从删除前 snapshot 重放。
  production origin 仍 fail-closed，真实登录/部署浏览器 journey 未验证；bootstrap 0001 有新字段/allowlist，
  既有开发库需重建。
- Phase 12 生词管理已离线实现：strict WordEntry core/list/detail/context-page/notes PATCH/whole-word DELETE，
  独立 word/context 签名 cursor，Postgres normalized literal 搜索、forced RLS、revision/幂等 snapshot，以及
  Web `/words` 搜索、分页、语境、备注和二次确认删除。ContextObservation 与词头 identity 不可编辑；
  ExternalWordbookItem 已引用时拒绝删除以保留任务历史，不实现单词 SRS。外部词典任务、真实
  Eudic/Shanbay、真实登录/部署浏览器 journey 尚未完成。bootstrap allowlist 有变，dev DB 需重建。
- Phase 17 手动生词收录已离线实现：strict POST 只接受词头、仅创建时 notes 与可选手动语境，服务器固定
  manual/now/ID；Postgres owner-RLS 事务按 canonical 收敛词条、内容 hash 去重语境、保留既有 notes，
  只在真实追加时推进 revision，并支持 `word.upsert` replay/conflict snapshot。Web `/words` 新增可访问
  表单、duplicate/created/existing 诚实状态、失败草稿保留与 list/detail 写后重读。无新表；bootstrap
  allowlist 有变，dev DB 需重建。单条 context mutation 与外部词典任务仍未开放。
- Phase 7 外部词典桥接已完成需求/技术复审并拆为 7A 云任务权威、7B Store Extension 桥接、7C
  WordListExport/联合验收；详见 `docs/cloud-v1/external-wordbooks.md`。复审确认旧 lease shape 与
  `word_entry_id` 前置无法表达 Eudic page，且旧 Store 本地 outbox 与 CloudAuthority 冲突；文档已改为
  import cursor lease、export snapshot item、nonce/hash-only fencing、Shanbay 本机别名和取消迟到语义。
  当前已离线实现 strict contracts、Postgres RLS/job/item/nonce lease/receipt authority、Web
  `/words/wordbooks`、Extension-only HTTP adapter、Eudic 云租约执行、Shanbay 独立加密 lease vault/本机
  别名，以及 owner UTF-8 互操作词表下载。Store production 已停止向旧本地 outbox 写入正式任务，Options
  只保留 Eudic credential 并指向云任务权威；production origin 仍 fail-closed。当前 actual Web/Store
  联合层已覆盖 Eudic export/import、稳定失败显式重试、Shanbay 人工确认/两词部分成功、active cancel
  与当前租约迟到回执，完整 Playwright 93/93 通过；真实 Eudic/Shanbay、真实登录/部署/Chrome
  与部署后联合 browser journey 未验证，因此不能声称真实第三方系统集成完成。
- Phase 13 完整分析历史 Web UI 已离线实现：`/history` 复用现有 strict history adapter，支持服务器搜索、
  reviewState/archived/sourceType/selectionKind 筛选、签名游标分页、完整 AnalysisRecord/候选/来源/公开模型
  元数据的纯文本结构化详情，以及 nothing-to-save、归档、恢复和二次确认删除。归档与整理状态独立；
  mutation 成功后重新读取服务器，刷新失败会如实保留“写入已完成”，list/detail/action 迟到响应均被
  generation guard 丢弃。2026-08-14 已按 `docs/cloud-v1/analysis-history-acceptance.md` 补齐 production
  `/history` actual-bundle 维护闭环：revision 1→2→3→4、review/archive 正交、四次有效写和默认 linked
  StudyCapture 删除均通过，完整 Playwright 98/98。状态为
  `implemented; target-platform validation pending`。未新增契约、API、表或 migration；真实登录/部署
  浏览器 journey 尚未验证。
- Phase 14 账号平台额度可见性已离线实现：fixed `GET /v1/quota` 只接受 Web Cookie，从现有 Postgres
  current grant、UsageLedger 与 active reservation 权威返回 strict UTC 月度投影；Web `/settings/account`
  显示 limit/used/reserved/remaining/percent、80% warning、committed exhausted、0 grant 空配置和 BYOK
  排除说明。production 继续使用严格 API origin/fail-closed 组合，未新增 migration。完整 `GET /v1/account`
  profile/consent、真实登录/部署浏览器 E2E 与平台模型真实额度消费仍未实现或验证。
- Phase 18 账号数据权利已完成离线实现与自动化验证：完整导出采用 owner-RLS job、strict
  NDJSON、24 小时 private object 和 15 分钟 signed URL；永久删除采用独立于 user_profiles 的可恢复
  AccountDeletionJob，在请求返回前撤销 session/pairing，再以 fenced worker 清理 export object、主库
  与 Supabase Auth，完成后清除 subject UUID。审阅拒绝同步 JSON、随账号级联删除 job、先删 Auth 和
  “签 URL 即下载完成”等不完整路线；另发现 disabled 账号当前无法行使数据权利，方案已要求新增只允许
  导出/删除/退出的 DataRightsSession，并补齐仅为既有 profile 建 session 的普通 Google login flow，确保
  Google-only 账号也可重新认证且不绕过邀请。当前 strict contracts、Postgres authority、可恢复
  worker/cron、Supabase service-role adapter、普通 Google 登录、DataRightsSession 和 Web
  `/settings/data` 均已接线。2026-08-14 实现后复审发现并修复 actual Web 导出下载/删除 journey 缺失及
  删除 accepted 后仍保留账号控件的问题：页面通过 `onAccountDeleted` 把会话转换交还 Cloud App，
  actual bundle 已验证 strict proof、服务器重读 ready、新窗口 signed URL、Cookie 清除、signed-out 与
  后续 401；focused Web 11/11、全 workspace 411 个 Vitest 文件（2,582 passed / 12 skipped）与完整
  Playwright 94/94 通过。状态为 `implemented; target-platform validation pending`；真实
  Supabase/Vercel、登录与部署数据库仍待验证，整体目标保持 open。
- 2026-08-13 根任务对 Phase 18 完成复验：101 个脚本测试、353 个 Vitest 文件（2,397 passed/
  12 skipped）、全 workspace typecheck/build、既有 66 条扩展离线浏览器 E2E、instructions/architecture、
  Phase 18 定向 ESLint/Prettier 与 diff 检查均通过。全仓 ESLint/Prettier 仍被用户已有未跟踪
  `.agents/` 设计技能资产和既有 `docs/cross-platform-development.md` 格式阻断；未擅自改写无关文件。
  这些离线证据不替代真实 Supabase Storage/Auth、Vercel Cron、部署 Cookie/CSRF 和账号导出/删除浏览器
  journey。
- Phase 19 管理运营台已完成需求/技术方案、只读审计和离线实现：固定受限 Operator、规范化登录邮箱
  投影、users/invitations/audit 独立签名 cursor、当前 UTC 月无正文 usage、幂等管理事务、严格账号
  状态机和 kill switch；旧非幂等 admin HTTP 写入已移除，停用会原子撤销 Web/Extension session 并过期
  pairing，deleting 不可恢复。Web `/admin` 已覆盖分区错误/重试、筛选/分页、一次性邀请 path、额度、
  设备、账号状态、无正文审计、二步确认、焦点/live region 与响应式边界。方案见
  `docs/cloud-v1/admin-operations.md` 与 ADR-0017；真实 Supabase/Vercel/Postgres、Operator 浏览器、告警
  和备份恢复演练仍 pending。
- 2026-08-13 根任务对 Phase 19 完成复验：101 个脚本测试、359 个 Vitest 文件（2,416 passed/
  12 skipped）、全 workspace typecheck/build、既有 66 条扩展离线浏览器 E2E、instructions/architecture、
  Phase 19 定向 ESLint/Prettier 与 diff 检查均通过。全仓 ESLint/Prettier 仍只被用户已有未跟踪
  `.agents/` 设计技能资产和既有 `docs/cross-platform-development.md` 格式阻断；未擅自改写无关文件。
  这些离线证据不替代真实 Supabase/Vercel/Postgres、Operator 浏览器、告警与备份恢复演练。
- Phase 20 公开信任页与商店披露已按方案审阅并离线实现：Web 精确 `/privacy` 在 API Origin 与登录前
  分流，登录页可达，页面不发远端请求且公开服务器可读、BYOK 本机秘密、第三方接收方、保留/数据
  权利和 Limited Use；Cloud 专用 listing 已取代旧纯本地产品口径，Manifest 权限/host 与披露矩阵进入
  自动回归。本机 Chrome 已检查桌面与 320px/reduced-motion，窄屏无横向溢出。方案与外部阻塞见
  `docs/cloud-v1/release-trust-surfaces.md`。
- 2026-08-13 根任务对 Phase 20 完成复验：101 个脚本测试、362 个 Vitest 文件（2,424 passed/
  12 skipped）、全 workspace typecheck/build、66/66 既有扩展 E2E、instructions/architecture、受影响
  ESLint/Prettier 与 diff 检查均通过。运营主体/联系方式、真实区域/备份期限、生产 URL、Dashboard
  问卷与商店人工预审仍 pending，因此页面保持“预发布”，不得宣称 Chrome Web Store 就绪。
- Phase 21 Cloud 候选证据审计已完成离线实现：新增独立 `check:cloud-release` 深模块，使用四个公开候选
  标识核对 Store 源码/bundle/Manifest/CSP、Web 本地资产与隐私页、正式政策和 Cloud listing；输出只有
  稳定 code/固定文案，不读取 secret 或访问网络。既有 `check:store-release` 的无参数 Store 1.0 profile
  保持不变，Cloud host 只能经显式 expected profile 接受。当前真实开发态按预期被预发布政策、四项
  缺失候选配置和两个 null runtime origin 阻断，未填入虚构生产值。方案与证据见
  `docs/cloud-v1/release-evidence.md`；ready 仍不能替代真实部署、Dashboard、双平台 Chrome 或商店人工
  预审。
- 2026-08-13 根任务对 Phase 21 完成复验：107 个脚本测试、362 个 Vitest 文件（2,424 passed/
  12 skipped）、全 workspace typecheck/build、66/66 既有离线浏览器 E2E、instructions/architecture、
  受影响 ESLint/Prettier 与 diff 检查均通过。`check:store-release` 继续通过；`check:cloud-release` 在真实
  开发构建上按预期只返回预发布政策、四项公开候选配置及两个 runtime origin 阻断。全仓 lint/format
  仍只被用户已有 `.agents/` 设计技能资产和既有 `docs/cross-platform-development.md` 格式阻断；未改写
  无关文件，也未运行真实服务、Provider、安装或商店上传。
- Phase 22 Cloud 离线浏览器联合验收已完成实现：Playwright 现在同时发现原 66 条 Extension journey 与
  4 条 Cloud journey；实际 Web production bundle 通过同站 HTTPS 保留域本地提供，stateful fake
  authority 严格裁决 CORS/Cookie/CSRF/revision/幂等，packaged Store Content Script 通过生产
  AnalysisSession、SubmissionOutbox、alarm/import adapter 导入同一 Web Inbox。旅程覆盖 Inbox
  confirm→Learning Library、Store import→nothing-to-save、公共隐私页零 API、signed-out 不读正文、缺
  proof 拒绝、same-key replay/different-body conflict 和 snapshot 脱敏。
- Phase 22 的 route interception 不证明真实 Vercel/Supabase、Manifest host 权限、Extension Service
  Worker 重启、真实账号 Cookie、双平台 Chrome load-unpacked 或第三方网络；这些发布证据继续 pending。
- 2026-08-13 根任务对 Phase 22 完成复验：108 个脚本测试、362 个 Vitest 文件（2,424 passed /
  12 skipped）、全 workspace typecheck/build、70/70 离线浏览器 E2E、instructions/architecture、受影响
  ESLint/Prettier 与 diff 检查均通过。全仓 lint/format 仍只被用户已有未跟踪 `.agents/` 设计技能资产和
  既有 `docs/cross-platform-development.md` 格式阻断；未改写无关文件，也未运行真实服务、Provider、
  Chrome 安装或商店上传。
- Phase 16 账号练习偏好已离线实现：strict `GET/PATCH /v1/account/preferences` 只投影 timezone/dailyGoal，
  GET 使用 Web Cookie，PATCH 还要求 Origin + CSRF；Postgres 在 owner forced-RLS transaction 内读写，
  Web `/settings/account` 覆盖载入、保存确认与失败草稿保留。设置只影响后续每日队列，无 migration；
  该阶段当时尚缺完整 `/v1/account` 聚合，现已由 2026-08-14 账号聚合切片补齐；真实登录/部署浏览器
  journey 仍待。
- 2026-08-13 根任务对账号偏好切片完成复验：101 个脚本测试、333 个 Vitest 文件（2,331 passed/
  12 skipped）、全 workspace typecheck/build、既有 66 条扩展离线浏览器 E2E、instructions/architecture、
  受影响 ESLint/Prettier 与 diff 检查均通过。该证据不替代真实 Web 登录、部署 Postgres 或浏览器设置
  journey；完整账号聚合当时保持 pending，现已由 2026-08-14 账号聚合切片补齐。
- Phase 8 根审阅已把本地日改为服务器时钟+账号时区权威，补齐 completed-but-unrated 与丢失提交响应
  恢复，并让评分在 session 行锁下裁决；浏览器不再提交日期，活跃反馈租约也不会形成永久 retry 响应。
- 2026-08-13 根任务对手动收录切片复验并补强成功后刷新失败/筛选排除新条目的诚实状态：101 个脚本
  测试、334 个 Vitest 文件（2,339 passed/12 skipped）、全 workspace typecheck/build、既有 66/66
  扩展离线浏览器 E2E、instructions/architecture、受影响 ESLint/Prettier 与 diff 检查均通过。上述 E2E
  不替代 Web 手动收录在真实登录、部署数据库和浏览器中的完整 journey。

## 0.12.0 当前开发进度（2026-08-10）

- YouTube 临时中文字幕已从 F8 调整为主键盘区按住 `Shift+Z`，并新增字幕卡右上角按住角标；选词浮层已
  完成暖色编辑词典视觉、分层动作卡、翻译／解释原句语境条和加载骨架。相关单元测试、62 条
  浏览器 E2E、Windows 视觉基线与 390px 窄屏实测均通过。
- Windows `verify:windows` 离线质量门已通过，包括指令、格式、Lint、类型检查、单元测试、构建与
  diff 检查；另行运行的 62 条浏览器 E2E 全部通过。Node.js 26 SEA 已完成打包和独立 `health`
  帧验证。
- Windows 已把本次 SEA 安装到 `%LOCALAPPDATA%\Huayi\native-host`，安装文件与已验证构建产物
  的 SHA-256 一致；精确 HKCU Native Messaging 注册表项和 manifest 均指向该安装，既有
  DeepSeek、欧路凭据及生词同步状态仍存在。当前 Windows 加载路径的扩展 ID
  `kmeopbhijmkcjeckjicfinpdminhpbak` 已与 manifest 唯一的 `allowed_origins` 对齐；安装后的 Host
  已通过直接 `health` 帧验证，并已被 Chrome 以该精确扩展来源成功拉起。
  Chrome 已重载最新 `0.12.0` 未打包扩展，真实 YouTube 已确认新版字幕 UI 注入；播放中选词后
  首击空白关闭并持续播放连续两轮通过，原暂停状态保持暂停，下一次普通播放器点击只切换一次。
  `Shift+Z` 由浏览器 E2E 覆盖，字幕角标按住由控制器集成单测覆盖；实机页面已确认两个入口
  可见。真实 DeepSeek
  和欧路请求未运行，仍需单独授权外部数据发送及可能产生的费用。
- macOS `verify:macos` 已通过，包括指令、格式、Lint、类型检查、1,500 条单元测试、构建和
  62 条浏览器 E2E。Native Host 已重新安装并只允许扩展 ID
  `chanmjjealoeeheohofnljbbkkfgfnfm`；安装 bundle 与已验证构建一致，既有 DeepSeek Provider
  配置保持不变。Chrome 已重载当前 `apps/extension/dist`，真实 YouTube 已分别验证人工英文轨和
  `kind: "asr"` 自动英文轨：完整句、固定双语、原生单词／短语选择、暂停所有权、首击空白关闭、
  CC 关闭／恢复、SPA 和剧院模式均通过。全屏 journey 已由 E2E 覆盖；实机快捷键进入全屏边界时
  浏览器控制会释放，重新接管后字幕 surface 仍存在。真实 DeepSeek 和欧路请求未运行，仍需另行
  授权外部数据发送及可能产生的费用。

## Cloud V1 Phase 34 DeepSeek V4 Flash 计费校准状态

- 官方 usage/price facts 已完成 docs-first 校准与实现前自审。`DeepSeekPriceSchedule` 固定 legacy、
  off-peak、peak 三套受审计代码单价，部署环境只接受三个互异价格 UUID；
- 四条平台付费路径都先按 peak 上限 reservation，再在 durable dispatch 的可信 UTC 时刻选择、精确校验
  DB 并固定实际 UUID；Provider billed calls、terminal settlement 和 post-dispatch 保守恢复不再跨窗漂移；
- analysis 未发布 bootstrap 新增内部 `dispatched_at` 与 transition，使 pre-dispatch 过期安全释放、
  post-dispatch 才保守入账；公开 API、Classic wire v7、Native Host、Store BYOK 与权限不变；
- strict Provider usage 现兼容空 `completion_tokens_details` 或可选非负 `reasoning_tokens`，但不公开或记录
  reasoning 字段。Fresh RED 覆盖 schedule、usage schema 与 production dispatch 边界；GREEN 为 focused
  7 files / 55 tests、API full 110 files / 407 tests，API strict 与全 workspace typecheck/build、目标
  lint/format、instructions/architecture 全绿；
- Root 关闭 Phase 33 权限文案与 Web 发布材料断言的旧词漂移后，完整 `pnpm test` 为 118/118 脚本、
  445 个 Vitest 文件（2,741 passed / 12 skipped）；当前 `pnpm verify:macos` 以退出码 0 完成，另含 Store
  coverage 97 files / 480 tests、Playwright 109/109、全 workspace typecheck/build、format/lint、
  instructions/architecture、development blocker、Store release 与 production dependency audit；
- 状态为 `implemented; real DeepSeek and production price-row validation pending`。未运行真实模型、密钥、
  账单、部署数据库、安装或 Chrome；生产三个 UUID 行与经批准实际对账仍未完成。

## Cloud V1 Phase 35 未跟踪候选范围状态

- 2026-08-14 当时盘点的未跟踪交付候选共 610 个：`.prettierignore` 1、API 292、Store Extension 75、Web 152、ADR 14、
  Cloud 文档 42、Cloud contracts 22、learning-domain 1、store-domain 9、Cloud release scripts 2；
- `.agents/skills/**` 150 个代理辅助资产和 `artifacts/**` 8 张未引用截图不属于 Cloud 候选，本轮未删除；
- 这是历史只读盘点；Phase 39 已按同一规则重算 613 个候选并关闭 staged delivery gate。

## Cloud V1 Phase 37 剩余工作规划状态（2026-08-20）

- 域名、DNS、Resend、verified sender、支持邮箱、通知告警和相关生产部署已由用户指定放到独立新任务；
  当前任务不实施该范围，R3-C 发布阻塞保持不变；
- 排除该范围后推荐的仓库交付收口已由 Phase 39 完成：613 个新候选与 92 个相关修改经过
  diff/secret/生成物边界、fake model/third-party 矩阵和完整 macOS 离线门禁审查；
- 后续依赖顺序为 Windows Node.js 26+ 离线门禁 → 生产 Supabase/Vercel/Postgres/Google 与数据权利演练
  → DeepSeek 真实计费对账 → macOS/Windows 真实 Chrome/升级 → 欧路/扇贝真实验收 → 运营材料、商店
  草稿和最终发布；每一项外部数据、费用、安装、Chrome、上传或不可逆操作均保持单独授权。
- Phase 37 当时状态为 `core slices offline-evidenced; R3-C production implementation and external release
gates pending`。Phase 48 后 production implementation 已关闭，外部门禁仍 pending；不能因代码完成
  宣称完整 V1 已完成。

## Cloud V1 Phase 38 Vercel Hobby + Supabase Free 调度适配状态（2026-08-20）

- Windows 支持保留；本阶段是 shared scheduler adapter。`apps/api/vercel.json` 已移除 Hobby 不接受的四项
  minute cron；这里记录的是 Phase 38 当时的四个 route，Phase 48 后正式 operations SQL/route 数量为五；
- 新增 production-only `apps/api/operations/configure-supabase-cron.sql`：管理员显式启用 Supabase
  `pg_cron + pg_net + Vault`，从 Vault 读取正式 API origin/secret，固定四路径 allowlist、search_path、
  角色撤权、55 秒 timeout 和固定 job name 重装；local/preview 不自动安装；
- Fresh RED 为 3 个预期失败/2 个基线通过；GREEN focused 2 files / 5 tests。修复一条已到期的历史测试
  lease 后，相关 lifecycle 5/5、API full 111 files / 409 tests、API strict typecheck/build、目标
  lint/format、instructions/architecture 全绿；根级 format/lint/typecheck/build、118/118 脚本、446 个
  Vitest 文件（2,743 passed / 12 skipped）与完整重跑 Playwright 109/109 也通过；
- 当时状态为 `implemented; real Vercel/Supabase deployment pending`。当时尚未解决未启用 Fluid 时 60 秒
  上限同 DeepSeek 90 秒超时的冲突；该仓库配置缺口后由 Phase 45 取代和关闭，但真实 Vercel 核验、
  Hobby 个人非商业、Supabase Free 暂停/备份、`pg_net` Beta、R3-C 邮件、域名/DNS/Resend 及其他外部
  发布门禁仍未关闭。本阶段未运行任何真实云服务。

## Cloud V1 Phase 39 交付候选与 fake/third-party 收口状态（2026-08-20）

- Phase 37-A 重算当前未跟踪交付候选为 613 个：API 294、Cloud 文档 43，其余分类保持 Phase 35
  allowlist；`.agents/skills/**` 150 个和 `artifacts/**` 8 张截图继续排除且不删除；
- fake matrix 已按能力真实语义审查。Fresh RED 为 2 个预期失败 / 19 个基线通过；GREEN 新增 Eudic
  每请求固定 10 秒内部 deadline、ExtensionQuery 90 秒配置上限、quota-before-provider 和四条 DeepSeek
  adapter stalled abort 回归；
- 当前局部证据为 focused 5 files / 21 tests、Store Extension 97 files / 481 tests、API 111 files /
  413 tests，两包 strict typecheck/build 和目标 ESLint 全绿；首次完整 E2E 发现 harness session 在当日
  10:00 UTC 日期漂移过期，修复后单条 1/1、受影响范围 8/8、完整 109/109 均通过；
- staged candidate 为 613 个新增 + 92 个相关修改，排除项 158 个零暂存；最终根级 118/118 Node、446 个
  Vitest 文件（2,748 passed / 12 skipped）、instructions/architecture/format/lint/typecheck/build、开发态/
  Store release/依赖审计全绿，`pnpm verify:macos` 退出 0；
- 当前状态为 `repository delivery candidate closed; Windows target validation pending`。没有运行真实服务、
  部署、安装、Chrome 或 Windows 目标机；Windows 支持保留，`verify:windows`/SEA health 是下一阶段独立证据。

## Cloud V1 Phase 37-B Windows 交接状态（2026-08-20）

- Windows 11 Pro build 26220 使用已核验 SHA-256 的官方 Node.js `v26.7.0` x64 portable 与 pnpm
  `10.12.4`，从 HEAD `c6af3c0bbdf94600d936a2a13394d705e9695d08` Fresh 执行完整门禁；首个 RED
  是根 `AGENTS.md` 12,404 字节超过 12 KiB 上限；
- 后续 Fresh 缺陷按最小 shared/build/test 范围修复：指令文件压缩至 12,287 字节；Store Vite 与 coverage
  补 workspace source alias，解除无 `dist` checkout 的解析失败；Web 归档 journey 显式重选条目；Google
  离线 journey 改为等待精确 Provider HTTP 200；受影响 targeted 9/9 最慢 12.4 秒；
- 最终 `pnpm verify:windows` 退出 0：脚本 118、各 workspace 测试全绿，native-host 991 passed / 67
  macOS skipped，Store coverage 97 files / 481 tests（statements/lines 92.66%、branches 87.87%、functions
  88.09%），Playwright 109/109 无 skip，9 个 build、development/Store release audits、production audit
  与 SEA 仓库外 health 全绿；聚合门内各次测试调用共 2,797 passed / 67 skipped，production audit 无漏洞；
- `Windows SEA health verified.` 已出现，health 为 schema 7、Host `0.13.0`、
  `deepseek-chat-completions` / `deepseek-v4-flash`、ready，且 `codexVersion=null`；
- 完整门所验证的修复 HEAD 为 `3aa143c7f60ba52a941f2a2db587bc93819427eb`，已无 force 普通 push
  至 `origin/codex/settings-configuration`；随后只提交验证结果文档，不把文档提交冒充完整门证据；
- 当前状态为 `Windows local offline validation complete; repair commit pushed; remote CI not triggered`。
  该分支无开放 PR，GitHub Actions 无该分支 run；没有运行安装、真实 Chrome、凭据、Provider/词典
  smoke、部署或其他外部操作。

## Cloud V1 Phase 41 macOS 优先与 Windows 批量验证状态（2026-08-20）

- 用户决定继续保留 Windows 支持，但取消“每个普通小提交后立即去 Windows 跑全量门”的节奏；日常需求
  优化和功能切片先在 macOS 完成，Windows 改为候选冻结节点的一次性批量验证；
- 最近一次 Windows 完整门覆盖代码 `3aa143c`；Phase 45 代码锚点已推进到 `15306b4`。从 Windows
  验证代码起累计 8 commits / 111 files，旧证据不覆盖它们；Phase 46 已停止继续加入本地产品切片并
  转入第二批冻结；
- 当前状态为 `implemented and verified on macOS; Windows batch validation pending`。只有需求暂时冻结、
  Mac `pnpm verify:macos` 全绿、无 P0/P1、累计 diff 已审、工作树干净且精确候选 SHA 已 push 后，才发起
  下一轮 Windows `pnpm verify:windows`；
- DPAPI、PowerShell、注册表、SEA、Windows 安装器、Windows-only 故障、Native Messaging/共享传输或
  Windows 发布操作会提前触发有界冻结点；相关小修复可集中，最终必须在最新 SHA 完整重跑；
- 下一项执行 Phase 41-C→41-D：完成最终 Mac 候选门和交接提交，用户普通 push 精确 SHA 后在 Windows
  一次性运行完整门。邮件、域名、DNS、Resend 与真实部署仍由独立任务处理。

## Cloud V1 Phase 42 公开数据边界一致性状态（2026-08-20）

- Phase 41-A 复审发现 actual `/privacy` 仍暗示“登录 BYOK 结果上传”，与现行 product/privacy/store/
  security 的唯一边界冲突；BYOK Key 与精简结果实际不发送语见；
- 已冻结四类独立动作：BYOK 查询、platform 查询、StudyCapture、CloudWordCopy。platform 查询最多保留
  一小时且不进入待整理/分析历史，后两者不能被称为 BYOK 结果上传；
- Fresh RED 为 focused Vitest 3 个预期失败 / 10 个基线通过与 actual bundle 2 个预期失败；GREEN 为
  focused 3 files / 13 tests、Web full 42 files / 192 tests、actual bundle 2/2、Web strict typecheck/build
  与目标静态门全绿；
- 最终 `pnpm verify:macos` 退出 0，覆盖 121/121 Node 脚本、Store coverage、全部 workspace build、
  109/109 Playwright、release audits 与 production dependency audit；本机 actual `/privacy` 的 DOM 与
  全页截图检查也无溢出或布局异常；
- 当前状态为 `implemented and verified on macOS; Windows batch validation pending`。本轮只修改公开披露
  与回归，不改 runtime 数据流；
- Web 主导航复制和菜单漂移另记为下一个 Mac 产品体验候选，不与本轮混改；Windows 在下一冻结候选
  批量验证。

## Cloud V1 Phase 43 Web 工作台外壳状态（2026-08-20）

- 已以 `CloudApp` 组合层的单一 WorkspaceShell 取代 `PracticeShell` 与页面复制外壳；普通账号一级导航
  固定七项，练习历史/外部词典/账号子页归组正确，运营和 data-rights-only 不暴露完整工作台导航；
- 48rem 以下使用同一原生 details 默认收起，桌面保持 open；actual bundle 已覆盖 390px 键盘/指针展开、
  七项顺序与跳转、子页 active、桌面重排和无水平溢出；
- Fresh RED 为缺 module、5 个预期行为失败与 12 个基线通过；GREEN 为 focused 4 files / 20 tests、Web
  full 43 files / 196 tests、最终 Playwright 110/110，Web 静态门与 `pnpm verify:macos` 全绿；
- 当前状态为 `implemented and verified on macOS; Windows batch validation pending`。Windows 继续在下一
  冻结候选批量验证；邮件、域名、DNS、Resend 与真实部署不纳入本阶段。

## Cloud V1 Phase 44 Web 语义设计 Token 状态（2026-08-21）

- 影响平台为 `shared + macOS`；Windows 支持保留并进入下一候选批次；
- docs-first 新增 `web-design-token-contract.md` 并完成自审；Fresh RED 以 2 个预期失败 / 7 个基线通过
  报告 1 个未定义引用和 33 个受控属性违规；
- 集中 registry 与静态 parser 已覆盖 `main.tsx` 全部生产 CSS；原始值等值迁移，原本无效的危险区
  `--red-600` 改用既有 danger 语义色；
- GREEN 为静态契约 9/9、focused 4 files / 18 tests、Web full 43 files / 198 tests、actual bundle 3/3；
  最终 `pnpm verify:macos` 退出 0，覆盖 121/121 Node 脚本、447 个 Vitest 文件、Store coverage
  97 files / 481 tests 与 Playwright 110/110；
- 当前状态为 `implemented and verified on macOS; Windows batch validation pending`；
- 不处理邮件、域名、DNS、Resend、部署、Provider、词典、安装或 Chrome。

## Cloud V1 Phase 45 Vercel Fluid 与 Function 时长状态（2026-08-21）

- 影响平台为 `shared + macOS`；Windows 支持保留并进入下一冻结候选批次；
- Vercel 当前 Fluid 模式下 Hobby Function 默认/最大均为 300 秒，但旧/导入项目不能依赖新项目默认；
  实现前 API `vercel.json` 只有 schema，仓库配置缺口真实存在；
- 四条 DeepSeek adapter 的 90 秒为一次生成总预算，可选结构修复共用 timer；目标是显式
  `fluid: true` 与唯一 `src/server.ts` 的 120 秒 Function 上限；
- Fresh RED 为 2 个预期失败 / 3 个基线通过；最小 JSON GREEN 后 focused 5 files / 25 tests、API full
  111 files / 415 tests，最终 `pnpm verify:macos` 退出 0，覆盖 121/121 Node 脚本、447 个 Vitest 文件、
  Store coverage 97 files / 481 tests 与 Playwright 110/110；
- 当前状态为
  `runtime configuration implemented and verified on macOS; real deployment and Windows batch pending`；
- 真实 Vercel 部署、Dashboard/Observability、邮件、域名、DNS、Resend、Provider、安装、Chrome 和
  Windows 均保持 pending。

## Cloud V1 Phase 46 第二批候选冻结状态（2026-08-21）

- 完成度复核确认没有新的本地产品代码切片；唯一生产代码缺口仍是已延期的 R3-C 邮件/告警，其他
  未完成项属于 Windows、CI、真实部署、Provider、Chrome、词典或运营事实；
- 上次 Windows 验证代码为 `3aa143c`，Phase 45 代码锚点为 `15306b4`，累计 8 commits / 111 files /
  `+3007/-1175`；本节 docs-only 冻结提交使最终候选相对上次 Windows 代码共 9 commits。当前远端仍是
  `313b5d4`，冻结提交前本地 ahead 7；
- 累计 diff、secret-shaped additions、依赖锁、生成物和跨平台敏感路径已审；没有 wire/schema、协议包、
  Windows 系统原语、SEA/安装器或 Native Messaging 传输变化，但品牌 Manifest、Native Host 文案、
  E2E 启动、Web/API 均需新的 Windows 完整门，旧证据不得外推；
- 最终交接文档工作树的 `pnpm verify:macos` 已退出 0：121/121 Node 脚本、447 个 Vitest 文件（2,757
  passed / 12 skipped）、Store coverage 97 files / 481 tests、Playwright 110/110，全部静态、构建、发布
  审计和 diff 门同次通过；
- 状态为 `candidate prepared locally; push and Windows validation pending`；冻结提交前相对远端 ahead 7，
  本节所在本地候选提交后为 ahead 8，完整 SHA 以任务交接报告为准；
- 未运行 push、Windows、CI、安装、Chrome、凭据、Provider/词典、部署、邮件、域名、DNS 或 Resend。

## Cloud V1 Phase 47 可用测试环境与持续用户验收状态（2026-08-21）

- 用户校准指出此前路线遗漏可实际使用的测试环境；离线 actual bundle、PGlite 和平台门禁不能直接推导
  production ready，Phase 46“没有新的本地产品切片”只适用于既有业务功能，不包含环境 composition；
- Phase 47 启动审计时仓库没有 Supabase local manifest、seed/bootstrap、start/reset、loopback HTTPS、
  forward migration 路线或 Store acceptance build；后续纵切的最新状态见本节下方；
- 第二批 Windows 验证已由用户回传完成；远端当前为 instruction size 修复提交 `d451122`。新顺序为：
  Mac 本机持久验收环境 → 用户边用边改 → 独立 Supabase/Vercel hosted acceptance → 用户签字 →
  production candidate；
- 用户现可注册域名、Resend 并配置 DNS；hosted acceptance 首选自有根域下的同站 Web/API 子域，
  Vercel 同源 gateway 降为备用，`notify` 子域用于隔离事务邮件信誉。该行是 Phase 47 当时状态；R3-C
  sender/CRON/告警代码后由 Phase 48 实现，当前等待真实外部投递验收；
- 当前状态为 `Windows batch returned complete; local acceptance implementation starting`。上一轮只更新文档，
  fresh `pnpm verify:macos` 退出 0，覆盖 121/121 Node、447 个 Vitest 文件（2,757 passed / 12 skipped）、
  Store coverage 97 files / 481 tests、Playwright 110/110 与全部静态/构建/发布审计门；未创建账号、资源、
  secret 或部署，未运行 Provider、安装或 Chrome。

## Cloud V1 Phase 47 本机验收第一纵切状态（2026-08-21）

- 第二批 Windows 本地离线验证已由用户回传在最终远端 `d451122` 完成；CI、真实 Chrome、安装和外部
  服务仍分别 pending；
- 域名/DNS/Resend 从延期项恢复：hosted acceptance 首选自有根域下 `app.acceptance` /
  `api.acceptance`，邮件使用 `notify.acceptance`，production `notify` 保留；Supabase Auth SMTP 与 R3-C
  HTTP sender key 分离；
- 第一纵切已新增 pinned Supabase CLI `2.115.0`、local manifest、secret-free 环境模板、精确 ignore 与
  失败关闭 doctor；Fresh RED 因模块不存在退出 1，GREEN focused 5/5；
- 真实 doctor 只报告 `docker-daemon`、`local-ca` 并退出 1；尚未启动 Docker 或安装/信任 CA，因此当前
  不是可使用环境；
- fresh `pnpm verify:macos` 退出 0：126/126 Node、447 个 Vitest 文件（2,757 passed / 12 skipped）、
  Store coverage 97 files / 481 tests、Playwright 110/110，以及全部静态、构建、发布和 production audit
  门；状态为 `local acceptance contract implemented; runtime prerequisites pending`。

## Cloud V1 Phase 47 本机验收第二纵切状态（2026-08-21）

- 用户授权启动 OrbStack、安装 `mkcert` 并建立本机信任；OrbStack/Docker Server `29.4.0` 已运行，
  `mkcert 1.4.4` 已安装；由于后台进程无法完成 macOS 管理员交互，CA 尚未信任，用户需在自己的 Terminal
  执行一次 `mkcert -install`；
- 首次 `supabase start` 在镜像下载阶段被安全审查主动停止：OrbStack 当前允许 LAN port forwarding，而
  旧入口未固定 loopback network；现场确认没有 Supabase 容器或 54320–54324 listener；
- Fresh RED 证明 `supabase/migrations` 与 runtime 入口缺失；GREEN 新增与 API `0001` 字节一致的时间戳
  baseline、漂移回归、`acceptance:local:start|status|stop` 和项目专用 Docker network。该 network 的
  `com.docker.network.bridge.host_binding_ipv4` 已实测为 `127.0.0.1`，所有启动必须显式传 `--network-id`；
- focused 8/8 通过；真实 doctor 目前只报告 `local-ca`，Supabase/Web/API/proxy 均未启动。状态为
  `runtime network and migration hardened; interactive local CA trust pending`；
- 域名固定为腾讯云购买/实名 `seen-said.cn`；Cloudflare DNS Free 只负责权威解析，不是 Cloudflare
  Registrar；Resend 使用 Free。验收子域固定为 `app.acceptance`、`api.acceptance` 与
  `notify.acceptance`，production `notify` 保留。

## Cloud V1 Phase 47 本机 runtime 与 HTTPS 状态（2026-08-21）

- macOS CA 已信任，Supabase 11 个容器已在专用 loopback network 运行；`status`/`dev` 每次复核容器
  network 与 published host，拒绝任何 LAN 暴露；
- baseline migration、非 BYPASSRLS 业务登录角色、三条价格行、kill switch、ignored `0600` 环境和证书
  已建立；Web/API production build 由 8443/8444 提供，8445 代理本机 Supabase；
- 三个 HTTPS health 均在系统信任下返回 200；headless Chromium 打开 `/app` 为“需要先登录”且无页面
  脚本错误；模型入口在 acceptance composition 中固定零外联失败；
- 用户首次打开邀请链接时 8443 拒绝连接；现场证明 Supabase 仍健康但旧 HTTPS 前台进程已随 Codex
  命令结束。现已改为 `acceptance:local:dev|dev:status|dev:stop` 管理 detached 后台进程，
  `dev:foreground` 仅供诊断；ignored `0600` PID、三入口 health、旧不健康 PID 替换均有回归，真实进程
  PPID 为 1 且三个 loopback HTTPS 入口重新返回 200；
- 一次性邀请入口已实现并创建首个 72 小时本机注册链接。在该检查点用户尚未完成注册/Mailpit、登录和
  核心旅程，Store acceptance、默认 quota、reset/增量 migration、重启持久化也 pending；默认 quota 与
  第一条增量 migration 已由下一节关闭，其余仍 pending，当前仍不是 Local-ready；
- fresh `pnpm verify:macos` 退出 0：142/142 Node scripts、448 个 Vitest files（2,758 passed / 12 skipped）、
  Store coverage 97 files / 481 tests、Playwright 110/110 及全部静态/构建/审计/diff 门通过；
- 腾讯云域名购买、Cloudflare zone/NS、Resend 账号与 DNS 均未代用户执行；它们不阻塞本机注册验收。

## Cloud V1 Phase 47 首账号初始化与前向迁移状态（2026-08-21）

- password/Google 邀请注册现在与 profile/登录方式同事务创建当前 UTC 月 1 美元默认额度；注册重放不
  重复，已有同月 admin grant 不覆盖，deleting profile 不回填；该检查点的未来月份自动续期缺口已由
  Phase 48 的 `0010` 关闭；
- 第一条 `0002` forward-only migration 已通过 API/Supabase 字节一致性、baseline→0002、权限与两条注册
  路径回归；`acceptance:local:migrate` 在 migration-up 前后审计 loopback runtime；
- private `account-exports-acceptance` bucket 已进入幂等 bootstrap，连续两次执行仍只有一条且不公开；
- 真实当前库未 reset：profile/grant/bucket/未消费邀请由 `1/0/0/1` 变为 `1/1/1/1`，migration history
  同时保留 baseline 与 `account_default_quota`，HTTPS 服务持续健康；
- Fresh RED/GREEN 后 script focused 15/15、API migration/auth focused 18/18。真实注册/Mailpit、登录、
  核心学习闭环、seed/reset、Store acceptance、重启持久化与未来月份续期仍 pending；当前状态为
  `persistent local runtime and first-account initialization operational; first-user journey pending`，不是
  Local-ready；
- 本纵切完整 `pnpm verify:macos` 退出 0：145/145 Node scripts、449 个 Vitest files（2,761 passed /
  12 skipped）、Store coverage 97 files / 481 tests、Playwright 110/110 与全部静态、构建、发布和 production
  dependency audit 门通过；门后 app/API/Supabase HTTPS 均为 200，数据和 migration history 未漂移；
- Windows 依用户要求留到下一个关键批次，不因本次 shared 数据库与本机 macOS 环境纵切要求立即重跑。

## Cloud V1 Phase 47 受控 reset 与虚构 seed 状态（2026-08-21）

- 新增 `acceptance:local:reset --confirm-local-data-loss`，只允许 pinned CLI、本机数据库和仓库固定
  `seed.sql`；固定顺序为 runtime verify → HTTPS stop → local reset/seed → runtime verify → bootstrap →
  build → HTTPS start，任一阶段失败立即停止；
- seed 只创建固定虚构 Operator/profile/admin role 与当前月默认额度，不创建 Auth identity、登录方式、
  邀请、session、学习内容、Provider 结果或 secret。reset 后必须重新创建邀请；
- Fresh RED 为 3 个预期失败；GREEN focused 31/31、scripts 156/156、seed migration 4/4、database focused
  19/19。首次全门发现全仓默认并行使 6 个 PGlite 建库 hook 越过 10 秒；目标 32/32 与 API 420/420
  单独通过后，将全仓 Vitest 固定最多 4 workers，保留原 hook timeout；
- 最终 `pnpm verify:macos` 退出 0：156/156 Node scripts、449 个 Vitest files（2,762 passed / 12
  skipped）、Store coverage 97 files / 481 tests、Playwright 110/110 与全部静态、构建、架构、发布、
  production dependency audit 和 diff 门通过；
- 本纵切没有执行真实 destructive reset。无确认参数的真实命令在任何副作用前固定拒绝；门后
  app/API/Supabase HTTPS 均为 200，profile/default grant/private bucket/未消费邀请保持 `1/1/1/1`，
  baseline 与 `account_default_quota` 两条 migration 未漂移；
- 当前状态仍是 `persistent local runtime and first-account initialization operational; first-user journey
pending`。下一产品验收重点是真实注册/Mailpit、登录和核心学习闭环；真实 reset 演练等待用户明确授权，
  Windows 继续留到关键批次。

## Cloud V1 Phase 47 非破坏性重启与持久化状态（2026-08-21）

- 新增无参数 `acceptance:local:restart:verify`，固定执行 runtime verify → server-side before snapshot →
  HTTPS stop → Supabase stop/start → forward migration → runtime verify → after snapshot → equality → HTTPS
  start；任一失败停止后续阶段，不 reset 或自动掩盖现场；
- snapshot 在 PostgreSQL 内覆盖全部 public tables、Auth users/identities、Storage buckets/objects 与
  migration history，Node 只接收固定 relation/count/digest 并在内存比较，不输出 digest、计数、用户内容、
  email、token、password hash、credential 或 SQL 错误；
- Fresh RED 7/7；GREEN restart 16/16、acceptance/lifecycle/runtime focused 57/57。真实命令完整停启并以
  退出码 0 证明 before/after 指纹一致；
- 前后显式聚合均为 profile/default grant/private bucket/unconsumed invite/Auth user/sign-in method/learning
  item/migration `1/1/1/1/0/0/0/2`，两条 migration 未漂移；app/API/Supabase/Mailpit 均为 200；
- 最终 `pnpm verify:macos` 退出 0：172/172 Node scripts、449 个 Vitest files（2,762 passed / 12
  skipped）、Store coverage 97 files / 481 tests、Playwright 110/110 与全部静态、构建、架构、发布、
  production dependency audit 和 diff 门通过；
- 这只关闭注册前初始化状态与邀请 persistence。真实账号、登录方式和学习数据目前仍为 0；用户完成
  注册/Mailpit、登录并创建学习数据后，再运行同一命令才可关闭真实用户 persistence。Windows 继续按
  关键批次验证。

## Cloud V1 Phase 47 本机验收模拟模型状态（2026-08-21）

- 文档审计确认固定 `model_unavailable` 不能支持用户边用边改；下一纵切以 acceptance composition 现有
  `providerFetch` seam 生成确定性 strict response，同时保留 production quota、durable dispatch、schema、
  ledger、lease/fencing 与数据库状态机；
- Web acceptance build 必须在邀请、登录、错误与工作台全部页面持续显示“本机验收 · 模拟模型”，正文
  再带 `【本机模拟】`，明确不是 DeepSeek、只用本机测试额度、不产生外部费用；
- 模拟器位于 DeepSeek HTTP Adapter 内，测试 metadata/price/ledger 保留技术兼容标识，不得作为真实模型
  质量、usage 或账单证据；不扩大 production provider enum；
- 完整需求/技术/TDD/人工清单已写入 `local-acceptance-simulated-provider.md` 并完成 seam 交叉审查；
  Fresh RED 命中模拟模块/横幅/build mode 缺失，并补出 phrase trusted assembly 回归；
- GREEN 后 API focused 37/37、Web focused 17/17、build contract 1/1、两个 workspace strict typecheck 与
  目标 lint/format/diff 通过；API 全量 114 files / 447 tests、Web 44 files / 201 tests、Node scripts
  173/173 全绿；
- 当前工作树根级 `pnpm test` 451/451 files 全绿（2,792 passed / 12 skipped），instructions、architecture、
  format、lint、typecheck 与 diff check 也已通过；当前 Node scripts 176/176、Store coverage 97 files /
  481 tests、Playwright 110/110 与 production audit 也已通过；这些先行检查本身不包含 build、development
  blocker 与 Store release，随后由隔离 Mac 聚合门统一关闭；
- 运行边界审查发现旧 HTTPS Web server 逐请求读取 live `dist`，可能在 build 时形成新 Web + 旧 API；
  snapshot Fresh RED→GREEN 5/5 后已改为启动时固定 Web bundle、缺入口失败关闭，并在 URL 规范化前拒绝
  原始 traversal；API 也只加载一次。当前旧进程尚未重启加载该修复，所以首次 live acceptance
  build/cutover 仍等待空闲窗口；后续迭代可在旧快照在线时构建；
- 用户当前可能正在注册，尚未执行会改写 live Web `dist` 的 acceptance build 或 HTTPS 重启，运行环境
  仍是旧的 Provider 失败关闭 bundle；
- 当前 Git 可见文件已复制到排除 ignored secret/运行数据的隔离候选，offline frozen install 零下载，
  原样 `pnpm verify:macos` 退出 0：176 Node scripts、451 Vitest files（2,792 passed / 12 skipped）、481
  Store coverage tests、全部 build、110 Playwright、development blocker、Store release、production audit
  与 diff 全绿；门后 checksum 复核零文件内容差异，候选 Git 干净；
- 状态更新为 `implemented and Mac-candidate-verified; local deployment pending idle window`。首次 live build/
  HTTPS cutover、横幅/模拟旅程、真实 Provider、Store acceptance、hosted 环境与 Windows 批次保持 pending。
- 唯一 deploy 协调器已实现并通过 focused 9/9，缺确认的真实 CLI 调用在零副作用下拒绝；随后用户邀请
  入口的 connection refused 已定位为域名双解析而旧进程只监听 IPv4。候选现为每端口同时绑定
  `127.0.0.1`/`::1`，focused 7/7、完整 Node scripts 187/187、451/451 Vitest files（2,792 passed /
  12 skipped）及全部静态门通过；运行中旧进程仍未切换，必须等明确空闲后 deploy，再以 IPv4/IPv6 CA
  probe 和浏览器复验关闭该缺陷。
- 包含部署协调器与双栈修复的最新可见文件已再次复制到隔离候选；offline frozen install 复用 277 个包、
  下载 0，`pnpm verify:macos` 退出 0：187 Node scripts、451 Vitest files、481 Store coverage tests、全部
  workspace build、110 Playwright、development blocker、Store release、production audit 与 diff 全绿。
  门后 checksum 零文件内容差异且候选 Git 干净；该证据关闭最新候选 Mac 门，仍不等于 live 部署。
- 门后 lifecycle 审查继续发现 hostname health 只命中一个地址族；已用 Fresh RED→GREEN focused 7/7
  固定三个 URL 的 IPv4/IPv6 双探针，单边失败不再返回 healthy。最新精确候选随后通过完整
  `pnpm verify:macos`：189 Node scripts、451 Vitest files、481 Store coverage tests、全部 build、110
  Playwright、发布与审计门全绿；checksum 零文件内容差异且候选 Git 干净。状态恢复为
  `implemented and latest-Mac-candidate-verified; live deploy pending confirmation`；旧 IPv4-only 进程会被新
  status 准确拒绝。
- 用户授权后真实 deploy 已退出 0；Supabase/HTTPS status 通过，Web/API/Supabase 三入口分别以 IPv4/IPv6
  返回 200，运行 bundle 已指向本机 API 并显示模拟模型标识。旧 `api.huayi.invalid` 与 IPv4-only 状态均
  已退出 live 环境；
- 首次真实邮箱注册进一步发现本机 Auth `letters_digits` 超出 Cloud 已冻结的 12 至 256 字符契约。数据库
  与脱敏 Auth 日志证明邀请已领取、注册 API 已到达、Provider 422、Auth user 仍为 0。doctor artifact
  Fresh RED→GREEN 5/5 后配置改为最少 12、空字符要求；完整 persistence restart 重跑退出 0，容器配置、
  邀请与活动 claim 均保留，服务恢复健康。用户仍需在原页面重试并完成 Mailpit 确认，当前不能声明
  Local-ready。

## Cloud V1 Phase 23 离线实现状态

- 五类平台付费练习生成已统一进入 PlatformGeneration：新增 ADR-0018、
  `cloud-v1/paid-practice-generation.md` 与 owner-RLS `practice_generation_tasks`；句子题目/反馈及对话
  开场/回复/最终反馈都先持久化领域输入和 task，再额度预留、durable dispatch、strict ready、
  UsageLedger settlement，最后由领域事务置 applied 并清除临时 output。
- PGlite 已覆盖 ready crash 零调用重放、claimed/reserved 过期接管、dispatched 过期保守结算且不透明
  重试、released reservation 迟到失败结算、quota 失败清理、旧 token fencing 与五类 domain apply。
  DeepSeek practice adapter 固定 endpoint/model/high thinking/JSON，只接收无 owner/UUID 的有界正文/别名，
  最多一次结构修复并逐 call 计价；production 已用现有价格/额度环境组合该 adapter。
- Phase 23 的两种 Playwright 练习旅程现已离线完成：actual Web bundle 覆盖 pending sentence 零自动调用
  →显式题目重试→反馈→来源→自评，以及两个学习项的三轮对话→逐项反馈→原子自评；两条旅程均重读
  `/settings/account` quota，公开 snapshot 不含答案、task 或 reservation。Web E2E support 也已纳入 strict
  TypeScript 门禁。
- Phase 23 仍是 `implemented; validation pending`：默认测试未访问真实 DeepSeek；真实部署 Cookie/数据库、
  并发多进程与真实费用变化仍待独立验证。Cloud 未发布，bootstrap 0001 变更要求既有开发数据库重建，
  不能当增量 migration 重放。
- 2026-08-13 根任务完成 Phase 23 浏览器验收复验：366 个 Vitest 文件（2,441 passed / 12 skipped）、
  全 workspace typecheck/build、72/72 离线浏览器 E2E、instructions/architecture、受影响 ESLint/Prettier
  与 diff 检查均通过。全仓 lint/format 仍只被用户已有未跟踪 `.agents/` 设计技能资产和既有
  `docs/cross-platform-development.md` 格式阻断；未改写无关文件，也未运行真实服务、Provider、安装或
  商店上传。

## Cloud V1 Phase 24 离线实现状态

- 新增 actual Web invitation onboarding journey：浏览器从 `/join#token` 开始，首个 document request 不含
  fragment；claim 在 StrictMode 下只发生一次并立即清理 URL，claim ticket 只进入固定 API 原生 POST。
- 独立 fake Google 页面只接收 opaque flow；用户显式继续后 callback 设置 Secure/HttpOnly/SameSite=Lax
  session Cookie 并固定回到 `/app`。新账号随后进入空学习库，以 production adapter 手动创建 Expression，
  再从同一 CloudAuthority list/detail 重读；重复邀请领取返回 409。
- 旅程在 390px/reduced-motion 下验证 labelled 控件、详情焦点和无横向溢出；snapshot 不含邀请、ticket、
  Cookie、email、正文或幂等材料。默认测试仍未访问 Google/Supabase/邮件/部署网络，真实身份与 Domain
  Cookie 行为保持 pending。
- 2026-08-13 fresh 复验：完整 `pnpm test` 为 366 个 Vitest 文件（2,441 passed / 12 skipped），全
  workspace typecheck/build、73/73 离线浏览器 E2E、instructions/architecture、受影响 ESLint/Prettier
  与 `git diff --check` 全绿。未运行真实 Google/Supabase、Provider smoke、安装或商店上传。

## Cloud V1 Phase 25 离线实现状态

- 新增 actual Web analysis→review journey：从空 authority 的 `/analysis` 提交 strict manual passage，
  browser-only streaming authority 验证 Cookie/Origin/CSRF/Idempotency 后输出 started→preview→completed；
  preview 只留在页面内存，completed AnalysisRecord 才进入 Inbox。
- 用户在 Inbox 编辑并确认 expression，随后 `/library` 通过 server list/detail 重读 LearningItem；学习库
  详情新增只读 SourceExample 区块，显示来源标题、原文和已有翻译，使用文本节点且不提供单条来源 mutation。
- journey 证明 start same-key replay 不新增记录、different-body 409、confirm revision proof、390px/
  reduced-motion、详情焦点、无横向溢出、Web Storage 为空和 snapshot 不含正文/preview/候选/凭据。
- focused Web 组件 154/154 与新 Playwright journey 1/1 通过；最终 fresh 复验为 366 个 Vitest 文件
  （2,441 passed / 12 skipped）、全 workspace typecheck/build、74/74 离线浏览器 E2E、
  instructions/architecture、受影响 ESLint/Prettier 与 `git diff --check` 全绿。真实 DeepSeek、代理缓冲、
  Vercel/Supabase/Postgres 和浏览器网络恢复仍 pending。
- 2026-08-14 全局校准确认顶部“Phase 27 重新验收待办”已过时：当前 journey 使用无 action/word 的
  strict manual passage、V2 AnalysisRecord/current candidates、completed-only authority 与服务器重读；
  本轮 411 个 Vitest 文件（2581 passed / 12 skipped）和 93/93 Playwright 通过。真实环境待办不变。

## Cloud V1 Phase 26A 离线实现状态

- 修复 Extension Cloud request proof 的文档/运行时漂移：Store BYOK import、CloudAnalysis 和 external
  wordbook adapters 现在共用 strict session-header module，从 manifest 注入
  `X-Huayi-Client-Version`，token/version 非法时 fail-before-fetch。
- production API 新增独立 principal authentication 深模块；环境必填发布 Extension ID 与最低版本，
  analysis/import/wordbook token 请求在身份库前验证精确 Chrome Origin 和数字三元版本。陈旧客户端返回
  426 `client_upgrade_required`；错误 Origin 返回 403；Web Cookie+CSRF 语义保持不变。
- CORS 只允许固定 Web 与发布 Extension 两个 origin，并允许 Authorization/client-version；BYOK outbox
  对 upgrade failure 保留加密队列和原幂等键。无 Manifest、migration、Classic 或 Host 变更，生产
  API/Store URL 仍 fail-closed。
- focused API/Store 9 files、43 tests 与两个 workspace typecheck 已通过；最终 fresh 复验为 109/109
  repository script tests、368 个 Vitest 文件（2,447 passed / 12 skipped）、全 workspace typecheck/build、
  74/74 离线浏览器 E2E、instructions/architecture、受影响 ESLint/Prettier 与 `git diff --check` 全绿。
  真实 Chrome 是否发送目标 Origin、部署 ID 一致性和升级 UX 仍 pending；未运行真实服务、Provider
  smoke、安装或部署验证。
- 2026-08-14 全局校准确认当前 Store production source 只有共享 header seam 生成 `HuayiExtension`，API
  只有统一 principal module 进入 token repository；platform query、StudyCapture、CloudWordCopy、identity/
  preferences 与 external wordbook 均在当前 proof 回归中。DeviceDisconnect 只豁免最低版本 gate，不豁免
  exact Origin/token/version syntax。focused 39/39 与本轮完整离线门禁通过；真实环境待办不变。

## Cloud V1 Phase 26B 离线实现状态

- Cloud release audit 现在直接接收候选 Extension ID、API 公开 Extension ID 与最低客户端版本；两个
  ID 必须严格相同，候选 source Manifest 版本必须按数字三元组大于或等于最低版本。
- 新增稳定 `release-config-api-extension-id`、`release-config-min-extension-version` 与
  `store-client-version-policy` 阻塞项；错误只返回固定安全文案，不回显 ID 或版本。
- fresh RED 证明 ID 漂移、候选版本过旧和空配置仍错误 ready；实现审阅又发现 API environment 会接受
  超安全整数版本，方案先修订后以环境 RED 收紧。最终 8/8 release tests 覆盖前导零、非三段、
  超出安全整数与 `1.10 > 1.9`。无 Manifest、数据库、Store runtime、Classic 或 Host 变更。
- 当前开发态继续按预期 blocked；最终 fresh 复验为 112/112 repository script tests、368 个 Vitest
  文件（2,447 passed / 12 skipped）、全 workspace typecheck/build、74/74 离线浏览器 E2E、
  instructions/architecture、受影响 ESLint/Prettier 与 `git diff --check` 全绿。真实 Dashboard ID、部署
  环境和 Chrome Origin 仍 pending；未运行真实服务、Provider smoke、安装或商店上传。

## Cloud V1 Phase 26C 离线实现状态

> 下列 BYOK import/outbox 数字是被 Phase 27 取代的历史基线；当前升级阻塞机制已迁移到 strict
> StudyCapture/CloudWordCopy union，旧 payload、route 和通过数字仍不计入当前完成项。

- BYOK import 将 426 独立分类为 `client-upgrade-required`；SubmissionOutbox 在现有 AES-GCM state 中
  持久一个可选客户端版本标记，保留全部 items、session 与原幂等键，同版本 `process()` 零 fetch/零
  alarm，新版本读取后解除阻塞并恢复显式重试。
- Store-domain 聚合状态只新增 upgrade 枚举；Popup 显示“更新划译/仍加密保存在本机”，禁用重试但
  保留二步本机清空与 polite live region。响应和 DOM 不含版本、正文、token、key、URL 或原始错误；
  Overlay/Content/Options/Manifest 未扩权。
- fresh RED 为 7 expected failures / 22 baseline passes；GREEN focused 7 files / 30 tests，Store-domain 与
  Store typecheck 通过。实现自审另补同版本直接 process 的 fail-before-fetch 回归，以及阻断前仍须
  持久删除超过 7 天密文项的保留期回归。
- 最终 fresh 复验为 112/112 repository script tests、368 个 Vitest 文件（2,452 passed / 12 skipped）、
  全 workspace typecheck/build、74/74 离线浏览器 E2E、instructions/architecture、受影响
  ESLint/Prettier 与 `git diff --check` 全绿。真实 426/升级后的 Chrome 恢复、生产 URL 和商店更新仍
  pending；未运行真实服务、Provider smoke、安装或商店上传。

- Phase 27 当前实现使用 v3 learning outbox、严格 StudyCapture/CloudWordCopy union，并直接清除 legacy
  v1 analysis-import 与 v2 StudyCapture-only envelope；426 分类、同版本零 fetch、版本变化恢复、七天裁剪、
  聚合消息和 Popup 已有当前回归。
- 2026-08-14 实现后状态机复审发现：blocked 队列 current-card undo 删除一项时会误清剩余 item 的升级
  标记。方案、架构、测试矩阵与变更记录先校准，再以 fresh RED 证明第二次 API 调用；最小修复后剩余
  item 保留原版本标记且同版本零 fetch。focused 38/38、workspace Vitest 2581 通过/12 跳过、Playwright
  93/93 通过；状态为 `implemented; target-platform validation pending`。

## Classic 0.13 仍然不支持

- Windows 上的 Codex、OpenAI 和 Compatible HTTP。
- Linux、Firefox、Edge、PDF、Chrome 内部页面、iframe 和编辑器区域。
- YouTube 直播、Shorts、OCR 和持久字幕历史；CC 关闭或当前活动轨非英文时不接管字幕。
- 分析历史记录、跨设备同步、后续对话、浏览器内密钥/端点设置和 Chrome Web Store 自动安装。

## 文档接手顺序

新的 Codex 项目从仓库根目录打开后，依次读取：

1. 根目录与目标模块的 `AGENTS.md`；
2. 本文件和 `README.md`；
3. `cross-platform-development.md` 和对应平台的 `setup-macos.md` 或 `setup-windows.md`；
4. `architecture.md`、`protocol.md`、`security.md` 和 `testing.md`；
5. 需要追溯设计决策时，再读取 `docs/superpowers/specs/` 与 `plans/`。

历史设计文档保留当时版本的边界，不代表当前发布状态；当前状态以本文件和主题文档为准。

## Cloud V1 Phase 47 首次真实邮箱确认回调状态（2026-08-21）

- 邮件确认本身已经成功：Auth user/identity、业务 profile、邀请消费与 flow 完成均有聚合证据；旧确认链接
  已单次消费，不应再次点击；
- 当前阻塞不是“邮箱未验证”，而是密码确认复用 Google callback 导致 method 错标，以及确认后的 profile
  邮箱 direct UPDATE 被 forced RLS 拒绝，最终没有创建 Web session；
- 独立 password callback、显式 method completion、`0003` 条件修复和窄 profile-email definer 已完成
  Fresh RED→GREEN；focused 26/26 与 API typecheck 通过；
- 完整 `verify:macos` 已通过：189/189 Node scripts、453 个 Vitest files（2,797 passed / 12 skipped）、
  Store 481/481、Playwright 110/110 及静态/构建/架构/审计全绿；
- `0003` 已前向应用，聚合证明第三条 migration 存在、已确认账号现在只有 password method，Auth/profile/
  邀请均保留且 Web session 仍为 0。同步 deploy 完整重跑退出 0，Web/API/Supabase 的 IPv4/IPv6 均 200；
- 当前下一步明确为：用户打开 `/login`，使用原邮箱和注册密码登录；不重发邀请、不重复确认。登录与核心
  模拟旅程通过后再执行注册后持久化验证。Windows 继续按冻结批次验证。

## Cloud V1 Phase 47 首次真实模拟分析失败状态（2026-08-21）

- 用户已成功建立 Web session；首次分析不是网络或输入问题。无正文数据库证据证明四次点击均在模型
  dispatch 和额度 reservation 前停止，没有 AnalysisRecord、ledger 或外部费用；
- 串联根因已确认：local bootstrap 错误保持 `model_kill_switch=true`；预检失败后 quota summary 又使用
  context-setter/trusted 读取 forced-RLS 表，权限错误阻止 terminal event 并留下 `running`；
- bootstrap 和 forced-RLS quota 回归均已取得 Fresh RED→GREEN，summary 现在通过 owner tenant
  transaction 读取；四条租约过期、未 dispatch、未 reservation 请求已由既有恢复函数精确终态化为
  `failed`，账号、会话、邀请、额度和学习数据未 reset；
- 完整 `verify:macos` 已通过：190/190 Node scripts、454 个 Vitest files（2,798 passed / 12 skipped）、
  Store 481/481、Playwright 110/110 及全部静态/构建/架构/发布/审计门；
- 幂等 bootstrap 已使 kill switch 为 false。同步 deploy 首次在后台 start health 阶段安全失败；同一构建
  前台启动与 IPv4/IPv6 六入口均健康，干净停止后完整 deploy 重跑退出 0。Supabase/HTTPS lifecycle、
  六入口、活动 Web session 1、running 0 均已复核；
- 当前状态为 `local simulated analysis fix deployed; one user replay pending`。请用户只重新发起一次分析，
  成功后继续候选→学习库→练习；Windows 留到下一关键冻结批次。

## Cloud V1 Phase 47 模拟候选持久化与取消等待状态（2026-08-21）

- 用户单次重试先长期显示 running；取消等待后开始按钮保持禁用，但编辑正文会错误解锁；再次提交返回
  通用失败，手动“重新检查状态”对仍 running 没有可见反馈；
- live 聚合为 request 7、failed 6、running/dispatched/reserved 各 1、record/ledger 0。固定 Postgres 错误
  确认 private `candidate-1` 写入 UUID 列失败，随后 fallback settlement `invalid settlement`；后续请求因
  active generation 唯一约束失败；
- API 先取得 2 个精确 RED、Web 取得 2 个精确 RED；实现后 API module/HTTP/segmentation 18/18、Web
  6/6。Analysis module 现在用服务端 ID 重键 candidate 及引用，并在 model 返回后立即保全 billed calls、
  usage 与 cost；Web cancel 保留 request fence，输入编辑不能解锁 duplicate，手动 running 检查有可见回执；
- 已等待 dispatched request lease 到期，再通过既有恢复函数保守终态化；当前 running=0、active
  reservation=0，未 reset 账号、会话、邀请或学习数据；
- 完整 `verify:macos` 已通过：190/190 Node scripts、455 个 Vitest files（2,800 passed / 12 skipped）、
  Store 481/481、Playwright 110/110 及全部静态/构建/架构/发布/审计门；
- 同步 deploy 首次在后台 start health 阶段安全失败；同一构建以前台启动并通过 IPv4/IPv6 六入口 200，
  干净停止后完整 deploy 重跑退出 0。最终 Supabase/HTTPS lifecycle、六入口、活动 Web session 1、
  running 0、active reservation 0 均已复核；
- 当前状态为 `fixed and deployed locally; one user replay pending`。请刷新 `/analysis`，只提交一次；成功后
  继续候选→学习库→练习。Windows 仍留到下一关键冻结批次，不因本次小批次单独往返。

## Cloud V1 Phase 47 真实核心闭环状态（2026-08-22）

- 第 32 节的用户复测待办已经关闭：Codex 在真实本机 Web/API/Postgres/Mailpit 环境完成邀请注册、邮箱
  确认、登录、分析、候选确认、学习库、题目、反馈、自评和历史回读；
- 分析修复包含真实 driver JSONB 参数规范化、reservation-bound fallback；练习修复包含 tenant 幂等写入
  和 context-setter-only `settle_practice_generation_quota`。没有通过放宽 RLS 或表 grant 绕过；
- 当前无正文聚合为 analysis completed/running `1/0`、record/learning/completed practice `1/1/1`、open
  practice task/active reservation `0/0`。核心本机体验状态为 `implemented and exercised locally`；
- 完整 `verify:macos` 已通过：190/190 Node scripts、460 个 Vitest files（2,808 passed / 12 skipped）、
  Store 481/481、Playwright 110/110 及静态、构建、架构、发布、审计门全绿。另修复旧未登记前台进程可
  掩盖 detached child 端口冲突的 lifecycle 竞态；持久 start/status 通过，浏览器重载后会话和练习历史
  仍在；门后又以 focused 9/9 修复强制停止后的延迟退出误报，真实 stop→start→status 全部退出 0；
- 仍待本阶段后续：注册后非破坏 persistence 重启、更多自然使用反馈、3–5 轮对话人工体验；Windows
  不因本次修复单独往返，留到下一关键冻结点。真实 Provider、Vercel/Supabase hosted、域名/DNS/Resend
  与发布仍是独立任务。

## Cloud V1 Phase 47 本机扩展功能验收状态（2026-08-22）

- 上一节的注册后 persistence 和 3–5 轮对话待办已经关闭：完整 Supabase/HTTPS 非破坏重启后会话与数据
  保持，实际完成第二个表达和 3 轮对话，反馈、自评及历史回读成功；
- 实际覆盖继续扩展到分析历史归档/恢复、学习库编辑/还原/归档/恢复/重复建议、单词 CRUD、账号偏好、
  外部词表下载、Eudic 空导出和导入取消、phrase 分析“无需收藏”；最终所有 running/open/pending 聚合为 0；
- 验收中修复分析历史泄露内部字段、CORS 缺少 `PATCH`、下载 header 未暴露、账号导出 serializer 权限
  边界和 Postgres bigint 投影五类缺陷。数据导出 worker 实际完成，一次性对象为 7,939 bytes / 9 records，
  严格扫描未发现禁出字段；原始 serializer 仍不对业务角色开放；
- 最终 `pnpm verify:macos` 退出 0：192/192 Node scripts、完整 workspace Vitest、Store 481/481、
  Playwright 110/110，以及全部静态、类型、构建、架构、发布和生产依赖审计门全绿；
- 当前状态为 `local acceptance exercised across primary non-destructive flows; external gates pending`。
  本轮没有删除主验收账号；设备配对/撤销需要真实 Store Extension。真实 Chrome、Provider、Google、外部
  词典凭据、hosted Supabase/Vercel、域名/DNS/Resend、发布和最新 Windows 批次仍是外部待办。

## Cloud V1 Phase 47 身份、管理、删除与服务端配对状态（2026-08-22）

- 主账号保持不变，使用隔离的一次性账号实际关闭永久账号删除、密码恢复、未知邮箱防枚举、密码重新认证、
  logout、operator 管理、停用 data-rights、学习项两类永久删除和练习历史删除；全部临时账号已通过正常
  deletion worker 或精确诊断清理；
- 服务端配对首次实测发现“HTTP 失败但 pairing 已 consumed/session 已创建”的非原子缺陷；`0008` 把
  consume、session insert 和 profile snapshot 收敛为一个 context-setter-only 数据库 statement，并已
  实际完成单次 exchange、偏好回读、设备列表、撤销及撤销 token 401；
- 管理审计覆盖邀请、额度、设备撤销、用户停用/启用和 kill switch，最终 kill switch=false；学习删除证明
  无历史 hard-delete、有历史 erase 保留历史以及随后历史删除的完整语义；
- 最终完整 macOS 门为 192 scripts、462 Vitest files（2,812 passed / 12 skipped）、Store 481、Playwright
  110，全构建、发布与 production audit 通过；最终 acceptance deploy、Supabase/HTTPS status 和 doctor
  通过。早期空 Codex 账号已按正常删除链清理，全部 open/running/pending 聚合为 0，验收账号的 3 条学习
  项、2 条分析和 2 条练习保持；浏览器 `/app` 与 `/settings/data` 登录态、模拟横幅和可下载导出均正常；
- 当前本机状态为 `primary and destructive disposable-account flows exercised locally`。真实 Store Chrome
  安装/vault、Google、真实 Provider/外部词典、hosted Supabase/Vercel、域名/DNS/Resend、生产发布和
  Windows 冻结批次仍是外部待办；本机主验收项目的 destructive reset 不属于本轮授权范围。

## Cloud V1 Phase 47 Store 服务端全旅程状态（2026-08-22）

- production HTTPS/API/Postgres/Auth/Mailpit 与一次性账号已实际覆盖 ExtensionQuery、StudyCapture、
  CloudWordCopy、设备自断开和永久账号删除；该一次性账号及其 Extension/Web session 已清理，主验收
  账号的 3 条学习项、2 条分析和 2 条练习保持；另一个用户已注册但无学习数据的邮箱账号及活动会话按
  用户状态保留，不误作临时账号删除；
- 实测修复 Node adapter 为 bodyless DELETE 错建 stream，以及 context-setter 重放账号删除时直接读取私有
  表的权限缺陷。`0009` 以窄 SECURITY DEFINER 返回匹配且未过期的 receipt，没有增加业务表权限；
- 完整 macOS 门为 193 scripts、463 Vitest files（2,814 passed / 12 skipped）、Store 481、Playwright 110，
  全部静态、类型、构建、发布与 production audit 通过；迁移共 9 条且最新为 `20260821080000`；
- 当前状态为 `Store server-side cloud services exercised locally; real Chrome and external gates pending`。
  真实 Chrome 安装/UI/vault/outbox、Google、真实 Provider/外部词典、hosted Supabase/Vercel、域名/DNS/
  Resend、生产发布与下一 Windows 冻结批次仍未由本节替代。

## Cloud V1 Phase 47 隔离空库与 destructive reset 状态（2026-08-22）

- 独立临时 Supabase project/network/ports 从无容器、无 volume、无 workspace dist 状态完成 pinned offline
  install（277 reused / 0 downloaded）、start、doctor、bootstrap、四层 build、双栈 HTTPS status、虚构状态
  写入、确认式 reset、重建聚合和 stop；
- 首次真实 start 发现 baseline 已含 `replay_account_deletion`，`0009` 普通 CREATE 导致 duplicate function；
  Fresh RED 同时覆盖单 migration 与 baseline→全部 `0002`–`0009` 链，修复为 CREATE OR REPLACE 后 4/4；
- 首次无 dist build 发现 builder 只构建 API/Web，隐式依赖完整门留下的 shared dist；Fresh RED 固定
  learning-domain→cloud-contracts→API→Web 顺序，修复后真实 clean build 与 HTTPS start 通过；
- reset 前隔离状态为 migration 9、profile 2、邀请 1、学习项 1；reset 后为 migration 9、固定 Operator 1、
  admin 1、价格 3、默认 grant 1、bucket 1，邀请/学习/分析/练习/Auth/running/kill switch 均为 0；
- 隔离 dev/runtime stop 成功，临时容器、3 个 volume、network 和目录已删除。主环境随后仍为 migration 9、
  profile/Auth `3/2`、LearningItem/AnalysisRecord/PracticeSession `3/2/2`，active Extension/running/kill
  switch `0/0/0`，runtime/dev status 与 doctor 全绿；
- 最终 `pnpm verify:macos` 退出 0：194/194 Node scripts、464 个 Vitest files（2,816 passed / 12 skipped）、
  Store 481/481、Playwright 110/110，以及全部静态、类型、架构、构建、发布和 production dependency
  audit 门；无已知生产依赖漏洞；
- 当前状态升级为 `local acceptance rebuild and destructive reset exercised in isolation; hosted, real Chrome
and Windows gates pending`。

## Cloud V1 Phase 48 本机完成度复审与时间边界状态（2026-08-22）

- 严格复审推翻了“唯一生产代码缺口是 R3-C”的旧结论：UTC 月切默认额度、production PostgreSQL
  60/小时与 300/日持久限速同样缺失；AccountDataExport 到期清理另有直接测试缺口；
- `0010` 已实现 current-month default 与跨实例持久限速，管理员 grant 和 idempotent replay 边界保持；
  `0011` 已实现 R3-C 23 小时 deadline、8 次上限、failed/dead-letter、固定 Resend adapter、无正文 alert、
  独立 bearer route 和第 5 个 Supabase CRON。本机 acceptance composition 显式禁用外发；
- 账号导出过期对象的 Storage 删除成功/失败路径已有 worker 与 PGlite 回归；取消等待后的按钮死锁取得精确
  RED 并最小修复，不再要求编辑输入才能重新提交，迟到事件 fence 保持；
- 主本机环境已无 reset 前向升级到 migration 11 / `20260822020000` 并重新部署；profile 3、learning 3、
  practice 2 保持，running analysis、active reservation 和 notification open/terminal error 均为 0。实际
  登录浏览器的新分析成功进入待收藏；模拟 Provider 太快，人工取消分支由可控延迟回归而非伪造点击证明；
- Fresh tests 为 Node 194、Vitest 470 files（2,841 passed / 12 skipped）、Store 481、Playwright 110；完整
  静态、类型、架构、构建、发布和依赖审计纳入最终 macOS 门。当前状态为
  `local code gaps closed and primary local flows exercised; external acceptance gates pending`；
- 对话中曾粘贴的 Resend key 必须撤销且不得部署，新 key 只能进入 secret store。真实 DNS/Resend/告警、
  hosted、真实 Provider/Google/词典、Chrome Dashboard/真实 Chrome、Windows 最新冻结批次、多日自然使用、
  正式隐私运营事实和用户最终签字仍是外部门禁。

## Cloud V1 Phase 49 托管验收配置失败关闭状态（2026-08-22）

- hosted acceptance 部署审查发现 API/Web 环境 schema 只校验通用 URL，与文档要求的固定 HTTPS origin
  不一致；HTTP、凭据、路径、query、fragment、尾随 `/` 和 API=Web 可能拖到浏览器阶段才失败；
- API 的 `HUAYI_API_ORIGIN`、`HUAYI_WEB_ORIGIN`、`SUPABASE_URL` 与 Web 的
  `VITE_API_ORIGIN` 已收紧为精确 HTTPS origin，API/Web 还要求不同；本机固定三 origin 继续通过；
- Fresh RED 为 API/Web 2 个失败测试，最小 GREEN 后 focused 6/6。最终 `pnpm verify:macos` 覆盖
  194/194 Node scripts、470/470 Vitest files（2,843 passed / 12 skipped）、Store 481/481、Playwright
  110/110，以及完整静态、类型、架构、构建、发布和生产依赖审计；
- 完整门后执行受控 `acceptance:local:deploy --confirm-local-downtime`，没有停止/reset Supabase；runtime、
  HTTPS status 与 doctor 均退出 0，本机验收环境已同步到该配置校验版本；
- 当前仓库内可在外部资源前关闭的部署入口缺口已关闭。下一门是用户在腾讯云购买并实名
  `seen-said.cn`；在域名所有权确认前不创建 Cloudflare zone、Vercel/Supabase hosted 资源、Resend
  sender 或任何新 secret。

## Cloud V1 Phase 50 域名与 Cloudflare 委派状态（2026-08-22）

- 用户已确认 `seen-said.cn` 在腾讯云购买并完成实名认证；注册商和续费继续留在腾讯云；
- `.cn` 父区、Cloudflare DoH 和 Google DoH 均返回 `kim.ns.cloudflare.com` /
  `malcolm.ns.cloudflare.com`，Cloudflare SOA 可权威回答；当前无 DS，DNSSEC 未启用，无旧 DS 冲突；
- `app.acceptance.seen-said.cn` 当前为 NXDOMAIN。此状态在 Vercel 尚未生成目标记录时正确，不添加
  占位 A/CNAME，也不使用当前网络环境映射出的 `198.19.0.0/16` 测试地址；
- Supabase Free 组织 `Seen & Said` 已创建；首次 `seen-and-said-acceptance` 因新开页面恢复默认而误建在
  `us-east-1 / East US (North Virginia)`。删除前已核验它无用户、Storage bucket、migration 或 backup；
  用户明确确认后已永久删除 project ref `wyvehjwcdjmgupldykuv`，原数据库密码随之失效；
- 正确项目已创建：project ref `kpadiulxkgckskcfydry`，URL
  `https://kpadiulxkgckskcfydry.supabase.co`，Primary Database 为
  `ap-southeast-1 / Southeast Asia (Singapore)`，Data API 创建后实测仍关闭，自动 RLS 未启用；
- 首页状态卡最终收敛为 `Healthy`；`Connect` 已启用，Auth 查询返回 0 用户，Database 查询返回 `public`
  schema 无表，HTTPS gateway 对无 key 请求按预期拒绝。Dashboard 给出的 transaction pooler 为 Singapore
  shared pooler / 6543；无密码 direct dry-run 未连接，pooler 使用故意错误测试密码得到预期认证失败，证明
  网络路径可达且没有改库；
- 用户在本机终端通过临时 `PGPASSWORD` 先完成 dry-run，再明确确认并实际执行
  `supabase db push --yes --skip-vault`。Dashboard 随后显示从 `20260821000000` 到
  `20260822020000_security_notification_delivery` 的 11 条完整 migration history，Schema Visualizer 已出现
  业务表，数据库角色包含 `huayi_business`、`huayi_context_setter`、`huayi_runtime`；tenant 表显示 owner RLS
  policy，Data API 继续关闭；
- 在 migration push 后、bootstrap 前的项目快照仍为 `Healthy`，最新 migration 为
  `security_notification_delivery`，Auth 明确显示 0 用户，Storage 是“Create a file bucket”空态。聚焦
  迁移/RLS 门此前的单
  worker、20 秒上限重跑为 11 files / 37 tests 全绿，doctor 5/5；
- 下一项不是复用 `acceptance:local:bootstrap` 或 `supabase/seed.sql`：hosted bootstrap 必须独立、默认保持
  `model_kill_switch=true`，只建立非 BYPASSRLS login role、三条不可变价格、private export bucket 和受控
  Operator 接管路线。独立 foundation plan/apply/verify 已取得模块缺失 Fresh RED 与 7/7 GREEN，其中真实
  package `--plan` 零联网退出 0；完整 `pnpm verify:macos` 为 201/201 Node scripts、470/470 Vitest files
  （2,843 passed / 12 skipped）、Store 481/481、Playwright 110/110 和全部构建/发布/依赖门。该处记录的是
  Phase 50 的 bootstrap 前状态；实际 apply 与后续 hardened 状态见 Phase 51。首张邀请仍需先冻结
  deployment bootstrap authority 与真实账号晋升协议；Vercel/Resend DNS、
  TLS、邮件投递和应用部署仍未开始。

## Cloud V1 Phase 51 Hosted foundation 写入与安全复验状态（2026-08-22）

- 用户已明确确认并实际执行固定 Singapore project 的 hosted foundation bootstrap；终端返回 bootstrap
  completed，初版管理员 verify 与 application login verify 均返回 passed。当前远端已建立
  `huayi_hosted_acceptance_login`、三条 acceptance 价格、开启的 kill switch 和唯一 private empty export
  bucket，Auth/profile/admin/invitation 仍保持为空；
- 安全审查确认初版验证不能作为最终门：`sslmode=require` 不验证 CA/hostname，membership 包含判断不能
  排除额外授权，rollback 内 context 也不能证明 transaction pooler 跨事务隔离。初版 passed 因此只保留为
  apply/login preliminary evidence；
- 仓库已加固为 Supabase 官方 CA + `verify-full` 与同 project ref；runtime 固定 transaction pooler `6543`，
  application 隔离 verifier 专用 session pooler `5432` 保证单连接复用同 backend。管理员复验检查精确
  membership/ADMIN OPTION、角色属性、价格生效时间、唯一 control/bucket/object；application 复验拆分检查
  public CREATE/direct context 权限、postgres 越权精确 SQLSTATE `42501`/exit `3` 与 COMMIT 后 context 清空。
  客户端 TLS 由 `verify-full`、固定 CA 与成功连接证明，不再以 `pg_stat_ssl` 观察 pooler 后端链路；
- bootstrap 也已修正为安全幂等：既允许 pristine 空 Storage，也允许精确唯一 private empty bucket 的已应用
  状态，部分或额外状态失败关闭。API/PGlite focused 与 hosted Node 8/8 已通过；fresh
  `pnpm verify:macos` 最终为 202/202 Node、472/472 Vitest files（2,847 passed / 12 skipped）、Store
  481/481、Playwright 110/110、全部 build/release/audit 门退出 0；
- 用户在 0012 push 前执行顺序式 `set -e` 命令并到达 application verification passed，证明当时 admin
  查询与 application TLS/最小权限/事务隔离路径均可运行。0012 push 后再次 admin verify 失败；只读
  diagnostic 除旧版 `membership_edges_exact` / `membership_options_exact` 外全部为真。根因是旧 SQL 错把
  PostgreSQL 17 `NOINHERIT` 产品边要求为 `inherit=true`，又以固定 incident 总数拒绝合法 creator-control
  边。仓库已抽共享精确契约修复，未修改远端角色图；用户随后运行修正版只读 verify 并通过，固定
  Operator status 返回 `empty`。当前状态为
  `hosted foundation applied; corrected PostgreSQL 17 remote verification passed; first Operator empty`。

## Cloud V1 Phase 52 首位 Operator 两阶段引导状态（2026-08-22）

- 已新增 `first-operator-bootstrap.md` 和 ADR-0023，并同步领域、产品、架构、数据、API、安全、测试、
  运维、实施计划与变更记录；文档自审选择两阶段、无公开 route 的 FirstOperatorBootstrap；
- DeploymentBootstrapAuthority 先发行唯一 BootstrapInvitation，用户继续走正常 Supabase Auth/profile/
  sign-in method/default quota，complete 只能从 finalized claim 推导唯一账号且不接收 userId/email；
- 部署动作由私有 bootstrap record 与邀请生命周期记录，不伪造 OperationalAuditEvent actor。邀请丢失仅在
  零 claim/零 identity 时允许显式替换，完成后永久封闭；
- baseline/forward migration、Supabase mirror、私有 bootstrap record、issue/replace/complete 数据库函数、
  account deletion 清理 trigger 与固定 hosted CLI 已实现；focused 数据库 8/8、CLI 5/5、hosted/local
  scripts 18/18、认证/管理/migration 38/38、账号删除 15/15 通过；
- fresh `pnpm verify:macos` 原样退出 0：207/207 Node scripts、473/473 Vitest files（2,855 passed /
  12 skipped）、Store 481/481、Playwright 110/110 和全部构建/发布/依赖门；迁移镜像、diff 与 known
  secret/token scan 通过；
- hosted foundation 的管理员 membership 校验已按 PostgreSQL 17 语义更正，修正版远端只读复验已通过；
  0012 后、application 密码轮换后的最新正式 application verifier 也已通过。0012 已按只列出
  FirstOperatorBootstrap 的 dry-run、候选 commit/push、
  明确确认和 actual push 完成；diagnostic 证明 12 条 migration、0012 结构与空 Auth/profile/admin/
  invitation/first Operator。固定 Operator status 已返回 `empty`；未执行 Vercel 部署、邀请发行、真实注册、
  complete 或 `/admin` 浏览器验收。

## Cloud V1 Phase 53 Hosted 应用部署契约状态（2026-08-22）

- 两个 Vercel project 的 Root/Framework/build/output 已冻结；API 仓库配置固定 Hono、`sin1`、Fluid/120s，
  Web 固定 Vite、`pnpm build`、`dist` 和 SPA rewrite；`.vercel/` 保持 ignored；
- Hosted Web 新增 `hosted-acceptance + short SHA` 持续标识，完整 Vercel commit 留作构建证据；simulated
  只能使用固定本机 API origin，公网组合在 bootstrap 前失败关闭；
- 新增 `acceptance:hosted:deployment --plan|--verify-environment`：plan 零网络/零写入，verifier 复用 API
  production schema 并固定 Singapore project/application role/origin/价格/bucket，任何错误都不回显值；
- Fresh RED/GREEN、API 136 files / 506、Web 45 files / 208、Node 211/211、合成 Hosted Web build/SHA/secret
  scan 和当前 Vercel schema 检查均通过；最终 `pnpm verify:macos` 为 211 Node、474 Vitest files（2,859
  passed / 12 skipped）、Store 481、Playwright 110 及全部质量/发布/依赖门退出 0；
- 当前状态为 `offline deployment contract verified; migration 0012 applied; corrected foundation verify
passed; first Operator empty`。候选已提交推送，0012 已实际 push；修正版 PostgreSQL 17 membership 只读
  复验已通过，固定 Operator status 已返回 `empty`。未创建 Vercel/DNS/Auth/SMTP/secret/deployment，未调用
  DeepSeek/Resend，也未发行邀请；不得重跑 migration 或 foundation bootstrap。
- PostgreSQL 17 membership 修复新增共享 SQL renderer 与 diagnostic 有界输出；hosted foundation + first
  Operator focused 15/15，本机 PostgreSQL 17.6 事务探测得到 expected=true、extra-edge=false、
  wrong-inherit=false 且全部 rollback。fresh `pnpm verify:macos` 为 213/213 Node、474/474 Vitest files
  （2,859 passed / 12 skipped）、Store 481/481、Playwright 110/110，全部质量、构建、发布和依赖门通过。
  修复实现阶段未连接远端；随后由用户运行的两道只读命令已补齐远端 foundation/Operator 状态证据。

## Cloud V1 Phase 54 Hosted 首轮 Store-disabled 状态（2026-08-22）

- 用户已选择首轮只验收 Web/API；hosted API 必填
  `HUAYI_STORE_EXTENSION_CAPABILITY=disabled`，且 `HUAYI_STORE_EXTENSION_ID` 必须不存在，不再填占位值；
- 用户已确认 Reply-To 可用、已有 hosted DeepSeek key 并批准验收环境产生少量真实费用；邮箱和 key 值均不
  写入仓库或计划输出，实际外部配置前仍逐项确认；
- disabled composition 已从 CORS 和路由表移除 Store 专用 surface，并在 identity 查询前拒绝混合路由的
  Extension token；enabled/local acceptance 与完整 Store release 仍保持真实 ID、最低版本和 Chrome
  门禁，Classic/Windows/Store 客户端未变；
- Fresh RED 后 focused 18/18 Vitest、22/22 Node、API 136 files / 509 tests 通过；根审查校准外部输入状态
  后又通过 focused 15/15 Vitest、18/18 Node。最终 `pnpm verify:macos` 原样退出 0：214/214 Node、
  474/474 Vitest files（2,862 passed / 12 skipped）、Store 481/481、Playwright 110/110，全部
  format/lint/typecheck/build、architecture、发布和 production audit 门通过且无已知 production 漏洞。
  Vercel project、环境变量、部署、真实 Provider 请求与邀请仍未执行。

## Cloud V1 Phase 55 Vercel Git 连接零 deployment 状态（2026-08-22）

- API/Web `vercel.json` 已用官方 `git.deploymentEnabled=false` 临时禁止所有分支的 Git deployment；首次
  GitHub 连接不能因为 push 或 repository connect 自动发布未配置完成的应用；
- 本阶段最初把 runbook 写为 Projects REST API 空 shell → REST PATCH settings → Dashboard Production
  Branch → CLI Git connect；Phase 59 的真实 Dashboard 证据证明连接前不存在 Branch Tracking，已将该顺序
  校准为 Preview 回读 → Git connect → 零 deployment → Production Branch → 再次零 deployment；
- Fresh RED 精确命中两份缺失配置和 plan 缺口；GREEN focused 为 Vitest 12/12、deployment Node 4/4、
  Cloud release verifier 14/14；完整 `pnpm verify:macos` 为 Node 214/214、Vitest 474/474 files
  （2,863 passed / 12 skipped）、Store coverage 481/481、Playwright 110/110，且全部
  format/lint/typecheck/build、architecture、发布和 production audit 门通过并无已知 production 漏洞；
- 当前只完成离线配置、测试和文档校准；未创建 Vercel project、未连接 repository、未配置 secret、未产生
  deployment，外部部署门仍关闭。

## Cloud V1 Phase 56 Vercel 空 project REST bootstrap 状态（2026-08-22）

- 新增 `acceptance:vercel:projects:{plan,apply,status}`：plan 完全离线；apply 需要精确确认参数且只从进程
  环境读取 Token；status 只输出 bounded state，不记录 Token、资源 ID 或第三方错误正文；
- 当前官方 REST 契约已固定为 token-scoped `GET /v2/teams`、name-only `POST /v11/projects`、
  `GET/PATCH /v9/projects/{idOrName}` 与零集合 `GET /v7/deployments`。脚本不会调用 deployment POST，
  create body 不含 Git repository；
- 两个 project 在任何写入前同时预检。已有 Git、deployment、environment、alias/integration 或配置漂移
  时失败关闭；不存在或安全空 shell 才按 API→Web 顺序冻结 Root/Framework/Node 22/monorepo 外部 source，
  Web 固定 build/dist，API 固定 Fluid/`sin1`/120 秒。中途失败立即停止并允许从安全空 shell 重跑；
- Preview 禁用使用官方 PATCH 字段，但当前官方 GET schema 不返回该字段，所以仍需 Dashboard 回读；
  Production Branch=`codex/settings-configuration` 也继续是 Dashboard 门，不能由脚本冒充已配置；
- Fresh RED 后 bootstrap/security 11/11、相关合并 15/15、完整 scripts 225/225 通过；最终
  `pnpm verify:macos` 为 Node 225/225、Vitest 474/474 files（2,863 passed / 12 skipped）、Store coverage
  481/481、Playwright 110/110，全部 format/lint/typecheck/build、architecture、发布和 production audit 门
  通过且无已知 production 漏洞；
- 当前只完成离线实现、fake-fetch 验证与文档校准；尚未执行真实 `apply`，未创建 project、Git link、domain、
  environment variable 或 deployment。外部 Vercel 门仍关闭。

## Cloud V1 Phase 57 Vercel bootstrap CLI 参数兼容修复状态（2026-08-22）

- 首次按文档运行 `apply` 已在本机失败；根因不是已观察到的 Token/权限/REST 故障，而是 package script
  固定 `apply` 后，pnpm 又把命令中的单个 `--` 原样传给 Node，旧 CLI 因三参数形状在任何 fetch 前拒绝；
- CLI 现在只规范化 `apply/status` 后精确位置的一次 pnpm 分隔符，固定确认参数、零 deployment、无 Git、
  两 project 写前预检和漂移失败关闭规则均保持不变；
- stderr 改为白名单 stage/reason/status，能够区分 input、credential、resolve-team、inspect/create/configure/
  verify 与 HTTP code，但不会显示 URL、请求体、Token、team 数据或第三方错误正文；
- 回归用真实参数形状先稳定得到 exit 1，再修复转绿；focused bootstrap/security 13/13、完整 scripts
  227/227、受影响 format/lint 与 diff check 均通过；
- 首次失败没有发出 Vercel REST 请求，也没有创建 project 或 deployment。修复后的真实 `apply` 尚未重跑，
  外部 Vercel 门仍关闭。

## Cloud V1 Phase 58 Vercel 空 shell 平台默认值修复状态（2026-08-22）

- 第二次真实 `apply` 已到达 API name-only create，并留下零 deployment、未连接 Git 的 API shell；Dashboard
  回查为 Framework=Other、Build/Output/Root 为空、Node 24.x，但 root 外 source 被 Vercel 默认开启；
- 旧空壳分类把 `sourceFilesOutsideRootDirectory=true` 当成部分漂移，因此在任何 settings PATCH、Web create
  或 deployment 前以 `create-api/preflight-rejected` 失败关闭；Token/team/HTTP 权限不是本次故障；
- 修复接受该与冻结目标一致的安全布尔默认，并在 POST 后重新 GET exact team/name canonical project，再
  复用原有无 Git/environment/custom environment/alias/integration、其余配置与零 deployment 检查；
- deterministic fake-fetch 回归先稳定复现用户同一 stage/reason/status，随后转绿并覆盖首次 create 与既有
  API shell 幂等重跑；修正版尚未真实重跑，Web shell、settings、Git、environment/domain/deployment 门仍
  关闭。

## Cloud V1 Phase 59 Vercel 空 project 与 Dashboard 零部署状态（2026-08-22）

- 修正版真实 bootstrap 已完成两个 Vercel project 的 settings PATCH 和 canonical GET，并固定验证零
  deployment；API/Web 的 Framework、Root、Node、root 外 source 与各自 build/output 均已按冻结契约回读；
- Dashboard 只读核验确认两个 project 的 Preview environment 均为 `Disabled`，Deployments 页面均为
  `No Production Deployment`，Git repository 均未连接；
- Dashboard 同时证明未连接 Git 时 Production environment 只显示 `No branch configuration`，不存在可保存
  的 Production Branch Tracking。runbook 已改为逐项目 Git connect → 零 deployment 回查 → 设置
  `codex/settings-configuration` → 再次零 deployment 回查；
- 更新后的计划专项 16/16 与完整 `pnpm verify:macos` 均通过；完整门覆盖 Node 231/231、Vitest 474/474
  files（2,863 passed / 12 skipped）、Store coverage 481/481、Playwright 110/110，以及全部
  format/lint/typecheck/build、architecture、release 与 production audit；
- 当前 Git、Production Branch、environment variable、domain、deployment、真实 Provider 请求和邀请仍未
  执行。下一外部门是先 API、后 Web 的受控 Git connection；任何一步出现 deployment 都立即停止。

## Cloud V1 Phase 60 Vercel Git 与 Production Branch 零部署状态（2026-08-22）

- `seen-said-acceptance-api` 与 `seen-said-acceptance-web` 均已连接精确 GitHub repository
  `Neil0619/huayi`；两个 Preview environment 均继续为 `Disabled`，两个 Production Branch Tracking 均为
  `codex/settings-configuration`；
- Root 独立回读两个 project 的 Git、Environment 与 Deployments 页面：两边均为
  `No Production Deployment` 且没有 deployment 记录，两个 Production environment 均为
  `No Environment Variables Added`；
- 本轮没有接受 GitHub App permission upgrade，也没有执行 domain、environment variable 或 deployment
  动作；Phase 59 的零部署状态在 Git connection 与 Branch Tracking 保存后仍保持；
- 仓库 `git.deploymentEnabled=false` 继续禁用所有 Git deployment，因此首次部署尚未武装。下一外部门是
  production-only environment、domain、Resend、Supabase Auth/SMTP 的配置与复核；全部通过后才允许另做
  受审查提交，收窄并解锁受控 production branch，再按 API→Web 发起首次 deployment。

## Cloud V1 Phase 61 Hosted acceptance DNS 与 TLS 验证状态（2026-08-22）

- Cloudflare `seen-said.cn` 已保存并回读两条 DNS-only CNAME：`api.acceptance` → `7cb58e1372474614.vercel-dns-017.com.`，`app.acceptance` → `f0cbaadacf303110.vercel-dns-017.com.`；两条均 Proxy disabled、TTL Auto；1.1.1.1、8.8.8.8、9.9.9.9 均解析到精确 CNAME；
- Vercel 两个 custom domain 均 properly configured。两个 HTTPS host 的 TLS 校验 `curl ssl_verify_result=0` 通过，部署前返回预期 404；zero deployments 仍保持；
- 本阶段不声明应用已部署或 production ready。下一门是 Resend verified sender subdomain/DNS、
  production-only environment、Supabase Auth/SMTP 与之后的受控 API→Web deployment；对话中泄露的旧
  Resend key 撤销状态尚未核验，必须视为已泄露且禁止重新使用或写入文档/环境。

## Cloud V1 Phase 62 Hosted acceptance Resend sender 域名验证状态（2026-08-23）

- Resend sender domain `notify.acceptance.seen-said.cn` 已在 Tokyo (`ap-northeast-1`) 创建；Cloudflare
  `seen-said.cn` 已新增并经公共递归解析核验四条 Resend 指定记录：
  `resend._domainkey.notify.acceptance` TXT、`send.notify.acceptance` priority 10 feedback MX、同名 SPF TXT，
  以及 `_dmarc` monitoring TXT；既有 `api.acceptance` / `app.acceptance` CNAME 未修改；
- Resend Dashboard 最终显示 `Domain verified: Your domain is ready to send emails`；两个 Vercel project
  仍为 `No Production Deployment`。本阶段仅关闭 sender-domain/DNS 门，不表示 API/Web 已部署，亦不代表
  Supabase Auth SMTP、R3-C HTTP sender、真实确认/恢复邮件、告警接收或 production ready；
- 后续 Phase 63 已完成旧 key 撤销、分离 SMTP/HTTP credential 托管与 Custom SMTP；Phase 64 又完成 Auth
  exact URL 与完整 API/Web Production environment 结构。真实邮件、API→Web deployment、Cron 与邀请仍未
  执行。

## Cloud V1 Phase 63 Hosted acceptance 邮件凭据与配置状态（2026-08-23）

- Resend Dashboard 已撤销对话中泄露的旧 `seensaid` key；一次误建的 Full access R3-C key 与一次因工具
  诊断暴露的临时 domain-scoped R3-C key 也均在未使用前撤销。当前仅保留
  `seen-said-acceptance-supabase-auth-smtp` 与 `seen-said-acceptance-r3c-http` 两把 Sending access、
  `notify.acceptance.seen-said.cn` domain-scoped key；未记录任何 token 或 prefix；
- Supabase project `kpadiulxkgckskcfydry` 已启用 Custom SMTP：`smtp.resend.com:465`、username=`resend`、
  sender=`语见 <accounts@notify.acceptance.seen-said.cn>`，密码使用独立 SMTP key 且不可回读；
- Vercel API project `seen-said-acceptance-api` 的 Production 已把 R3-C key 托管为
  `HUAYI_RESEND_API_KEY` Sensitive，并配置 notification mode=`resend`、固定 security sender 和用户确认的
  Reply-To。Web project 在本 Phase 当时未改；API 仍为 `No Production Deployment`；
- `pnpm acceptance:hosted:deployment --plan` 通过。本阶段没有发送真实确认/恢复/安全通知邮件，没有发起
  API/Web deployment，没有安装或触发 Cron，也没有发行邀请。后续 Phase 64 已补齐并复核全部 API/Web
  Production environment 结构与 Auth exact URL；下一门已推进为受审查解锁后按 API→Web 顺序首次部署和
  执行应用/邮件 smoke。

## Cloud V1 Phase 64 Hosted acceptance Auth 与完整环境状态（2026-08-23）

- Supabase Auth Site URL 与五条 exact redirect 已完成且无 wildcard；API Vercel Production environment
  已完成 21/21（9 Sensitive、12 public），Web 已完成 2/2 public，全部 Production-only；三项曾误设
  Sensitive 的通知 public 变量已删除并按原值重建，结构回读正确；
- 四项 forbidden variables 均不存在。数据库 DSN 与 DeepSeek key 由用户直接安全输入且未写入文档；三项
  本地生成 Secret 仅以固定 service 名和 project ref account 保存在 macOS login Keychain。Reply-To 仅
  记录为“用户确认地址”；
- 截至 Phase 64 完成时，两个 Vercel project 均仍为 `No Production Deployment`，
  `git.deploymentEnabled=false` 未改。
  `acceptance:hosted:deployment --plan` 与最新 `verify:macos` 通过；Sensitive 值不可从 Vercel 回读，因此
  未重跑完整值 `--verify-environment`，也不为此旋转 Secret；
- 该阶段退出状态是 `hosted configuration structure complete; deployment pending`，不是已部署或
  production ready；后续 Phase 65–67 已单独记录实际 API deployment 与 DSN Rotate。

## Cloud V1 Phase 65 Hosted acceptance API-only 部署解锁状态（2026-08-23）

- API `git.deploymentEnabled` 已收窄为 `"**": false` +
  `"codex/settings-configuration": true`；Web 继续全分支 `false`。该 policy 只按分支生效，不按变更文件生效；
- Fresh RED 已分别证明旧 API 布尔 `false` 和旧 deployment plan 不满足 API-only 解锁契约；最小实现与文档
  已同步；
- 实际 armed 窗口内，`ac06dba` 到 `0c04130` 的 6 个线性 commit 均产生 API Production 记录，另有一次
  `0c04130` redeploy；其中 3 条 Error、4 条 Ready。Web 仍为 `No Production Deployment`；
- 该结果证明 exact branch policy 保持了 API/Web 隔离，但没有实现“只产生一个 deployment”的流程目标。
  API 仍 armed，完成轮换后受控 runtime smoke 之前不得继续无关 push。

## Cloud V1 Phase 66 Hosted application 角色复验与 runtime DSN 状态（2026-08-23）

- application verifier 已把客户端 TLS、六项权限、三项 context 与 postgres 越权拒绝拆成固定探针；
  `pg_stat_ssl` 不再误作 Supavisor 客户端 TLS 证据，私有函数权限使用固定 catalog OID；
- 用户运行新 diagnostic，22 个固定字段全部符合预期，正式 verifier 返回
  `Hosted acceptance application login verification passed.`；application 数据库角色、最小权限和同 backend
  跨事务 context 清空门已关闭；
- 远端通过证明修订后的完整 contract 有效，但未单独重放旧 text/regprocedure 探针，因此不把单一表达式
  记录成唯一已隔离根因；
- Vercel `HUAYI_DATABASE_URL` 已用轮换后密码成功 Rotate 为 percent-encoded transaction-pooler `6543`
  DSN，仍为 Production-only Sensitive；剪贴板已清空且未点击 Redeploy；
- 现有 Latest API deployment 早于 Rotate，不能证明新 DSN 已被 runtime 使用。下一门是冻结候选并执行一次
  轮换后受控 deployment，而不是重做数据库验证或声称首次部署。

## Cloud V1 Phase 67 Hosted API 真实部署状态与轮换后门禁（2026-08-23）

- Dashboard 回读 API 共 7 条 Production deployment 记录；冻结本候选前的 Latest/Current deployment
  `BAC8nKdfjGH9Qtp1wdwi1j4376bN` 的 source 为当时本地/远端共同 HEAD
  `0c0413085a9dc78e7dc772cdee2eff2ce446ae04`，不是陌生代码；
- `https://api.acceptance.seen-said.cn/health` 返回 HTTP 200、TLS verify result 0 和固定
  `{"service":"huayi-cloud-api","status":"ok"}`，`x-vercel-id` 以 `sin1::sin1` 开头。该 route 不访问
  数据库，不能证明轮换后 DSN、DeepSeek 或 Auth composition；
- API/Web 的 Production Branch Tracking 均为 `codex/settings-configuration`，Preview 均为 `Disabled`；Web
  仍为 `No Production Deployment`。API 仓库配置仍 armed，Web 仍全分支关闭；
- 下一门：审查并提交当前候选，受控 push 只允许 API 产生一个 SHA 匹配的轮换后 deployment；新记录一旦
  产生，无论 Ready/Error 或 smoke 成败，唯一允许的下一次 push 都是以独立提交恢复 API
  `deploymentEnabled=false`。确认关闭提交没有产生 API/Web deployment 后，才完成数据库、DeepSeek、
  Auth/Cookie/CORS/SSE smoke。
