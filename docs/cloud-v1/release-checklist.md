# 华译 Cloud V1 发布检查表

任何一项发布阻塞项未完成时，状态只能是 `implemented; validation pending`，不能开放邀请或宣称
Chrome Web Store 就绪。

## 自动门禁

- [x] `pnpm check:cloud-release` 在当前 null-origin/预发布政策开发态按固定安全 code 失败关闭；
- [x] `pnpm check:cloud-development-blocked` 在 build 后证明真实工作树恰好保留固定九项开发态阻塞，
      少项或多项均失败；
- [ ] 使用已核验的公开候选配置运行 `pnpm check:cloud-release` 并得到 ready；
- [ ] audit 输入中的候选/API Extension ID 与目标 Chrome Dashboard ID 相同，最低版本不高于候选版本；
- [x] 当前 macOS 工作树的 instructions、architecture、format、lint、typecheck、unit、API integration
      全绿；
- [x] 当前 Web 与 Store Extension Playwright 109/109 全绿；
- [x] 当前 macOS `pnpm verify:macos` 聚合门禁全绿；
- [ ] Windows Node.js 26+ 的 `pnpm verify:windows`、SEA health 与 CI 全绿；Phase 37-B 精确交接已冻结在
      `windows-validation-handoff.md`，Windows Codex 必须回写真实结果后才能勾选；
- [ ] 数据库空库/升级 migration、RLS 多租户矩阵和账号删除恢复通过；
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
- [x] Phase 28 语义建议已有 strict HTTP、固定 DeepSeek adapter、paid/Postgres durable authority、价格/
      kill/quota-before-fetch、CRON cleanup、Web 无自动重试及 actual-bundle suggestion→preview→显式
      confirm→server reread 离线证据；AA semantic token 组合也有可计算回归。

## 生产事实

- [ ] 先确定安全通知邮件厂商、verified sender/域名、支持联系方式与告警渠道，再实现并部署
      R3-C 真实 sender、独立通知 CRON production route/composition 和无正文告警；当前是产品代码 +
      外部决策缺口，不是单纯部署验证；
- [ ] R3-C 外部前置条件按 2026-08-20 用户决定保持延期：当前无自有域名/DNS/Resend 账号/支持邮箱/
      告警目的地；不得购买、注册、创建密钥或把 fake mail 当生产证据。恢复时优先复核 Cloudflare
      Registrar + 独立 `notify` 子域 + Resend Free 起步方案及届时价格，再取得逐项批准；
- [x] DeepSeek 官方文档事实已校准：固定 `deepseek-v4-flash`、thinking + JSON、非流
      `completion_tokens_details.reasoning_tokens`，以及 2026-08-16T16:00:00Z 起两个 UTC peak 窗口和
      legacy/off-peak/peak 精确价格；离线 adapter/分时账本实现与回归已完成；
- [ ] 生产环境插入并核对三个不可变价格 UUID 行，部署三个 UUID 配置，并以经批准真实请求核验模型、
      usage、timeout、实际账单与 UsageLedger 一致；
- [ ] 真实 DeepSeek 语义建议在受控小额度下核验固定 endpoint/model、usage、价格、timeout 和账本；不得
      用离线 fake fetch/authority 代替费用或网络事实；
- [ ] Supabase/Vercel 区域、备份残留、OAuth callback、CORS/Cookie 和 TLS 已核验；
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
- [ ] 单一用途说明以英文理解和学习闭环为中心，Web 不被描述为远程代码宿主；
- [x] Phase 33 已逐项绑定当前 permission/host 到源码调用；`unlimitedStorage` 由正式本机词库、词典
      IndexedDB 及可并存且合计可超过 10 MiB 的加密 `storage.local` 耐久状态证明仍需保留；当前没有
      不再需要而应删除的 Manifest 权限；
- [ ] 隐私政策有公开 HTTPS URL，并准确披露 Huayi、DeepSeek、Supabase/Vercel、Google、邮件和词典；
- [ ] 数据问卷、截图、商店文案、首次云端同意与产品行为一致；
- [ ] 披露分别说明 BYOK Provider、平台插件查询、StudyCapture、CloudWordCopy、本机词库和云端学习内容，
      且任何页面都没有“登录后上传 BYOK 完整结果”的旧文案；
- [ ] 草稿上传的权限/远程代码/数据预审通过；最终公开上传另行批准。
- [x] Phase 37-A 已将重算的 613 个未跟踪交付候选纳入本次精确 staged candidate：`.prettierignore` 1、API 294、Store
      Extension 75、Web 152、ADR 14、Cloud 文档 43、Cloud contracts 22、learning-domain 1、store-domain 9、Cloud
      release scripts 2；明确排除但不删除 `.agents/skills/**` 150 个代理技能资产和 `artifacts/**` 8 张
      未引用截图；staged manifest 为 613 个新增 + 92 个相关 tracked 修改，`git diff --cached --check`、
      完整离线门与 macOS 聚合门均通过，未使用宽泛 `git add .`。

## 完整 V1

- [ ] CaptureInbox 待分析、ReviewInbox 待收藏、Web V2 深度分析、学习库、生词、历史、两种练习、账号
      偏好、设备、额度、管理、导出/删除均可用；
- [ ] 所有已知高严重度安全/数据缺陷关闭，无未披露的正文日志；
- [ ] Classic 0.13 与 Native Host 没有被 Cloud 构建、部署或版本流程改动；
- [ ] 变更记录、项目状态、运行手册和回滚步骤与候选构建一致。
