# Cloud V1 离线完成度审计

## 1. 状态与目的

影响平台为 `shared`。本审计以 `product.md` 的完整 V1 成功标准为目标，不把“没有已知 production Web
路由缺口”、单层单元测试或历史绿灯等同于完成。审计只判定当前工作树可证明的离线实现；真实
Google/Supabase/Vercel/邮件、Provider 费用、Chrome Dashboard 与双平台 Chrome 仍是独立外部门禁。

Phase 32 以下方 7 条成功标准重建证据矩阵。当前能证明主要产品切片已完成本地离线组合，但不能
声称完整 V1 已验收：密码恢复 R3-C 尚缺真实安全通知 sender、独立通知 CRON 生产组合与告警实现，
而邮件厂商、verified sender/域名、联系方式和告警渠道又是实现前必须确定的外部产品/运营决策。
另外，真实 Google/Supabase/Vercel/Provider/词典、多连接 production Postgres 和双平台 Chrome 仍是独立
外部门禁。

状态：`core slices offline-evidenced; R3-C production implementation and external release gates pending`。

## 2. Phase 32 证据矩阵方案

### 2.1 成功标准派生

本轮不再从已有模块反推完成度，而是保持 `product.md` 第 2 节的顺序和“必须同时满足”语义，
派生七条顶层验收项：

1. Web 粘贴与 StudyCapture 都能显式产生完整结构化教学分析；
2. 登录用户可按手动/账号自动设置提交原始内容到待分析区，compact 插件结果不冒充 Web 分析；
3. Expression/SentencePattern 可区分且可收藏，完整原句不会被当成 SentencePattern；
4. 用户可对到期项执行句子创作和 3–5 轮受约束对话；
5. 本机生词在登录前后保持可用，可选复制到 Web，且 WordEntry 没有记忆队列；
6. Google/邮箱密码、跨设备数据、月度额度、导出和删除形成可运营闭环；
7. Extension 保持独立就地查询用途，不依赖远程托管代码执行。

### 2.2 每行强制证据列

每条成功标准都必须分别列出 production source、strict contract、database/RLS test、
actual-production-bundle Playwright 路径与用例关键词、fresh 聚合命令和剩余 `X`。某层没有证据时写“缺失”；
不再用 A/B 或“tests”概括替代路径。`X` 只代表离线不可替代的外部事实，不得用它隐藏未实现的
生产代码。

### 2.3 矩阵更新前自审

- 原矩阵按十三个已实现功能域分行，没有与七条成功标准一一对应；A/B 又将完整证据和局部证据混在
  一个字母中，需要删除该折叠。
- `apps/api/src/production-password-recovery.ts` 只组合 recovery flow/dispatch CRON；
  `apps/api/src/security-notification-worker.ts` 只提供 sender port 和 worker 深模块。当前缺少真实 sender、通知
  CRON 生产 route/composition 和告警实现。这是“生产代码缺口 + 邮件/告警选型决策缺口”，不是纯验证项。
- 2026-08-14 Phase 35 的历史盘点把未跟踪范围分为 610 个交付候选、150 个 `.agents/skills/**` 代理辅助
  文件和 8 张未引用 `artifacts/**` 截图；2026-08-20 Phase 39 按同一规则重算为 613 个候选，并已精确
  暂存为 613 个新增 + 92 个相关修改。后两组 158 个资产仍明确排除且不删除，零暂存；
- Fresh 命令只证明当前工作树在该次执行覆盖下通过，不能代替真实 Provider、部署、费用、目标 OS/Chrome
  或人工运营事实。

## 3. 完整产品要求矩阵

历史聚合证据 `F1` 为 Phase 31，`F2` 为 Phase 34。当前聚合证据 `F3`：2026-08-20 Phase 39 在 macOS
精确 staged candidate 上执行 `pnpm verify:macos` 退出 0，其中 `pnpm test` 为 118/118 Node 脚本、446 个
Vitest 文件（2,748 passed / 12 skipped），`pnpm test:e2e` 为 109/109；同次聚合命令还包含 instructions、
format、lint、全 workspace typecheck、Store coverage、architecture、build、固定九项 development blocker、
Store release 和 production dependency audit。`F3` 取代下表的历史 `F2`；完整 staged manifest 为
613 个新增 + 92 个相关修改，排除的 158 个用户资产零暂存。

历史 `F2` 于 2026-08-14 Phase 34/root integration 在 macOS
工作树执行 `pnpm verify:macos` 退出 0，其中 `pnpm test` 为 118/118 Node 脚本、445 个 Vitest 文件
（2,741 passed / 12 skipped），`pnpm test:e2e` 为 109/109；同次聚合命令还包含 instructions、format、
lint、全 workspace typecheck、Store coverage 97 files / 480 tests、architecture、build、固定九项
development blocker、Store release 和 production dependency audit。

| `product.md` 成功标准                                         | Production source                                                                                                                                                                                                                                                                                                                                                                                                      | Strict contract                                                                                                                                                                                                                                   | Database/RLS test                                                                                                                                                                                                                                                                  | Actual production-bundle Playwright                                                                                                                                                                                                                                                                                                                                                      | Fresh 命令                                                    | 结论与剩余 `X`                                                                                                                                                                       |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Web 粘贴或 StudyCapture 显式产生完整教学分析               | `apps/api/src/production-analysis.ts`、`apps/api/src/analysis-app.ts`、`apps/api/src/study-capture-app.ts`、`apps/web/src/paste-analysis-page.tsx`、`apps/web/src/study-capture-inbox.tsx`                                                                                                                                                                                                                             | `packages/cloud-contracts/src/analysis-contracts.ts`、`packages/cloud-contracts/src/extension-learning-contracts.ts`、`packages/learning-domain/src/domain-schemas.ts`                                                                            | `apps/api/src/postgres-analysis-store.test.ts`、`apps/api/src/postgres-analysis-request-lifecycle.test.ts`、`apps/api/src/postgres-study-capture.test.ts`、`apps/api/src/database-operations-integration.test.ts`                                                                  | `apps/web/e2e/cloud-analysis-review-journey.spec.ts`：“a pasted analysis streams into Inbox…”；`apps/web/e2e/cloud-web-journeys.spec.ts`：“packaged Store content captures a sentence and Web explicitly deep-analyzes it”                                                                                                                                                               | `F3` 覆盖 unit/database 与 actual bundle                      | 离线 production composition 有证据；`X`：真实 DeepSeek 协议/费用、Supabase/Vercel 部署、目标网络 SSE                                                                                 |
| 2. 登录用户手动/自动提交原始内容，compact 结果不冒充 Web 分析 | `apps/store-extension/src/content/overlay/overlay-study-capture.ts`、`apps/store-extension/src/service-worker/study-capture-handler.ts`、`apps/store-extension/src/service-worker/submission-outbox.ts`、`apps/api/src/study-capture-app.ts`、`apps/web/src/study-capture-inbox.tsx`                                                                                                                                   | `packages/cloud-contracts/src/extension-learning-contracts.ts`、`packages/store-domain/src/study-capture-messages.ts`、`packages/store-domain/src/submission-outbox-messages.ts`、`packages/store-domain/src/analysis-results.ts`                 | `apps/api/src/postgres-study-capture.test.ts`、`apps/api/src/postgres-analysis-capture-deletion.test.ts`、`apps/api/src/database-operations-integration.test.ts`                                                                                                                   | `apps/web/e2e/cloud-web-journeys.spec.ts`：“automatic StudyCapture offers created-only current-card undo”、“an exact automatic recapture is existing”、“an offline automatic capture reconnects…”、“platform query…creates no analysis or capture”                                                                                                                                       | `F3` 覆盖 Store/API/database 与 actual bundle                 | 离线产品边界有证据；`X`：macOS/Windows 真实 Chrome 生命周期、断网/重启与账号设置同步                                                                                                 |
| 3. 区分并收藏 Expression/SentencePattern，完整原句不作为句型  | `apps/api/src/candidate-confirmation-module.ts`、`apps/api/src/learning-library-maintenance.ts`、`apps/web/src/candidate-editor.tsx`、`apps/web/src/learning-library-page.tsx`                                                                                                                                                                                                                                         | `packages/learning-domain/src/domain-schemas.ts`、`packages/learning-domain/src/normalization.ts`、`packages/cloud-contracts/src/learning-contracts.ts`                                                                                           | `apps/api/src/postgres-candidate-confirmation.test.ts`、`apps/api/src/postgres-learning-library.test.ts`、`apps/api/src/postgres-learning-library-archive.test.ts`                                                                                                                 | `apps/web/e2e/cloud-analysis-review-journey.spec.ts`：“…becomes a server-reread learning item”；`apps/web/e2e/cloud-web-journeys.spec.ts`：“confirms one candidate and rereads it from the learning library”                                                                                                                                                                             | `F3` 覆盖 domain/database 与 actual bundle                    | 离线 strict schema/确认事务有证据；`X`：真实模型输出质量抽检、多连接 Postgres 冲突、目标 Chrome                                                                                      |
| 4. 通过造句和 3–5 轮受约束对话使用到期项                      | `apps/api/src/production-app.ts`、`apps/api/src/practice-module.ts`、`apps/api/src/dialogue-practice-module.ts`、`apps/api/src/paid-practice-generator.ts`、`apps/web/src/practice-page.tsx`                                                                                                                                                                                                                           | `packages/learning-domain/src/practice-schemas.ts`、`packages/learning-domain/src/schedule.ts`、`packages/cloud-contracts/src/practice-contracts.ts`                                                                                              | `apps/api/src/postgres-practice-queue.test.ts`、`apps/api/src/postgres-practice-repository.test.ts`、`apps/api/src/postgres-dialogue-practice-repository.test.ts`、`apps/api/src/postgres-practice-generation-recovery.test.ts`                                                    | `apps/web/e2e/cloud-practice-journeys.spec.ts`：“pending sentence practice retries explicitly…”、“three-round dialogue returns per-item feedback and rates every item atomically”                                                                                                                                                                                                        | `F3` 覆盖 domain/database 与 actual bundle                    | 离线 durable paid generation/排期有证据；`X`：真实 DeepSeek 费用、timeout/usage、部署 worker 恢复和目标浏览器                                                                        |
| 5. 本机生词登录前后可用，可选复制到 Web，不建单词记忆队列     | `apps/store-extension/src/lexicon/browser-lexicon-repository.ts`、`apps/store-extension/src/service-worker/lexicon-message-handler.ts`、`apps/store-extension/src/service-worker/cloud-word-copy-client.ts`、`apps/api/src/production-cloud-word-copy.ts`、`apps/api/src/word-library-app.ts`、`apps/web/src/word-library-page.tsx`                                                                                    | `packages/store-domain/src/lexicon.ts`、`packages/cloud-contracts/src/extension-learning-contracts.ts`、`packages/cloud-contracts/src/word-contracts.ts`；WordEntry 不引用 `scheduleStateSchema`                                                  | `apps/api/src/postgres-cloud-word-copy.test.ts`、`apps/api/src/postgres-word-library.test.ts`、`apps/api/src/database-operations-integration.test.ts`                                                                                                                              | `apps/web/e2e/cloud-web-journeys.spec.ts`：“local word save succeeds first…”、“disabled CloudWordCopy keeps the local word and performs zero cloud writes”、“disconnect clears account queues but preserves the independent local lexicon”                                                                                                                                               | `F3` 覆盖 Store/API/database 与 actual bundle                 | 离线 local-first/云副本边界有证据；`X`：真实 Chrome IndexedDB/设备重启、Eudic/Shanbay 账号与人工最终提交                                                                             |
| 6. Google/邮箱密码、跨设备、月额度、导出/删除形成可运营闭环   | `apps/api/src/production-app.ts`、`apps/api/src/production-account-settings.ts`、`apps/api/src/production-account-data-rights.ts`、`apps/api/src/production-password-recovery.ts`、`apps/web/src/account-quota-page.tsx`、`apps/web/src/account-data-rights-page.tsx`；**缺失**真实安全通知 sender、通知 CRON production route/composition 与告警代码，`apps/api/src/security-notification-worker.ts` 只是 port/worker | `packages/cloud-contracts/src/account-contracts.ts`、`packages/cloud-contracts/src/password-recovery-contracts.ts`、`packages/cloud-contracts/src/account-data-rights-contracts.ts`、`packages/cloud-contracts/src/admin-operations-contracts.ts` | `apps/api/src/database-auth-flow-integration.test.ts`、`apps/api/src/database-password-recovery-integration.test.ts`、`apps/api/src/postgres-account-data-rights.test.ts`、`apps/api/src/postgres-admin-operations.test.ts`、`apps/api/src/postgres-security-notification.test.ts` | `apps/web/e2e/cloud-google-authentication-journey.spec.ts`：“an active existing Google account signs in…”；`cloud-password-authentication-journey.spec.ts`：“an invited learner confirms password registration…”；`cloud-password-recovery-journey.spec.ts`：“…latest confirmed mail”（fake mail）；`cloud-account-data-rights-journey.spec.ts`：“exports data and permanently deletes…” | `F3` 覆盖已组合部分与 fake-mail actual bundle；不证明缺失代码 | **未完成**；先决策邮件厂商、verified sender/域名、支持联系方式和告警渠道，再实现 R3-C。`X`：真实 Google/Supabase Auth/邮件、对象存储 24h 删除、备份残留、生产 grant/告警演练、跨设备 |
| 7. Extension 可独立就地查询，不依赖远程托管代码               | `apps/store-extension/src/analysis/production-analysis-engine.ts`、`apps/store-extension/src/analysis/browser-analysis-engine.ts`、`apps/store-extension/src/service-worker/query-router.ts`、`apps/store-extension/manifest.json`、`apps/store-extension/src/service-worker/production-query-engine.ts`                                                                                                               | `packages/store-domain/src/analysis-results.ts`、`packages/store-domain/src/analysis.ts`、`packages/cloud-contracts/src/extension-learning-contracts.ts`                                                                                          | platform 查询：`apps/api/src/postgres-extension-query.test.ts`、`apps/api/src/postgres-extension-query-maintenance.test.ts`；BYOK 为零 Huayi 数据库写入边界，无需数据库 repository                                                                                                 | `apps/extension/e2e/store-release-journeys.spec.ts`：“Store selection reaches a strict fake Provider result…”；`apps/web/e2e/cloud-web-journeys.spec.ts`：“platform query uses the production router but creates no analysis or capture”、“platform quota exhaustion never falls back to the local BYOK engine”                                                                          | `F3` 覆盖打包 Store journey、release audit 与数据库边界       | 离线打包代码/无远程代码审计有证据；`X`：真实 macOS/Windows Chrome、Dashboard permission/data-use 问卷、真实 BYOK/platform Provider                                                   |

矩阵结论：第 1–5、7 条有当前本地离线分层证据，但仍保留各自 `X`；第 6 条除了 `X` 还有
R3-C 生产代码缺口，因此完整 V1 开发、测试与验收均未完成。Phase 39 已精确暂存 613 个新候选和 92 个
相关修改，并以 `git diff --cached --check` 与 `F3` 聚合门验证该候选；版本控制交付缺口已关闭。

## 4. 校准出的本地缺口

### S：production 语义重复建议（已离线闭环）

`product.md` 要求用户核对同类型语义候选后显式 merge，且语义查重属于共享平台额度。S1 已补齐 strict
Idempotency-Key、no-store、Web 每次动作新 key 和稳定错误状态；S2 已补齐固定 DeepSeek Provider 与 paid
deep module，并验证空候选零调用、reserve/dispatch 顺序、alias 过滤、busy/replay、kill switch、quota
和计费失败；S3 已补齐 forced-RLS Postgres authority、原子 ledger/settlement、dispatch 前后恢复与有界
清理。

S4 已把上述 seam 组合进 production app：相同 owner/key 先处理 terminal replay/busy/conflict，真正的新
generation 才在新 reservation 前校验不可变价格，kill switch/额度在 Provider fetch 前失败关闭；独立
CRON route 每分钟清理且只返回有界计数。Web 不自动重试，item/revision 变化会清除并抑制迟到 suggestion。
actual production bundle 已完成 suggestion→preview→显式 confirm→target GET server reread，并证明公开
snapshot 与 Web Storage 不含正文、prompt、raw output、reservation 或 task。该切片的本地分层证据完整；
真实 DeepSeek、部署与目标平台继续作为 `X`。

### A1：AA token 对比度自动证据（已离线闭环）

审计时 `styles.test.ts` 只查 token 分层、响应式和 reduced-motion，`--text-tertiary` 指向
`--slate-400: #7a879c`；它在常用浅色 surface 上约为 3.1–3.6:1，不满足普通正文 4.5:1。因此先写纯函数
RED，按 WCAG 2.x sRGB 相对亮度计算语义前景/背景组合，再最小调整 primitive token；没有通过把文字
假设成“大号文本”或删除断言来绕过。

技术路线固定为无生产依赖的 node-environment Vitest：从 `styles.css` 解析 hex primitive 与 semantic
`var(...)`，按 sRGB 线性化和 `(L1+0.05)/(L2+0.05)` 计算。普通文本组合最低 4.5:1，focus ring 与相邻
surface 最低 3:1；半透明 surface 先合成到 `--surface-canvas`。测试必须先用当前 `--text-tertiary` 观察
RED，再只调整 primitive/semantic token，不修改组件字号或用例阈值。

实现记录：Fresh RED 实测 `text-tertiary on surface-canvas=3.27:1`；新增
`--slate-500: #5d6c84` 并把 `--text-tertiary` 从 slate-400 校准到 slate-500。普通文本全部组合现≥4.5:1，
focus ring 全部组合≥3:1；专项 accessibility 2/2、既有 responsive styles 7/7、Web strict typecheck 与
目标 ESLint/Prettier 通过。

## 5. 分阶段路线

1. **C0（已完成）**：从 product/API/data/security/testing/release 提取完整要求和证据标准；
2. **C1（已完成）**：建立完成度矩阵，记录 S1/A1 与外部门禁；
3. **C2（已完成）**：审查 S1 的 quota/dispatch/idempotency/data retention 与 A1 的 token 组合，更新
   change log；
4. **C3-A（已完成）**：A1 Fresh RED→GREEN，新增无依赖 contrast contract 并校准失败 token；
5. **C3-S（已完成）**：按 `semantic-duplicate-suggestions.md` 完成 contracts→provider→durable
   repository→production/API/Web→actual bundle，并完成实现后复审；
6. **C4（已完成）**：focused/full 离线门禁与文档回写已通过；真实服务和目标平台继续单独批准。
7. **C5（已完成）**：校准 SubmissionOutbox adapter 缺失状态机，以 Fresh RED 固化
   enqueue/process/status 密文保留和 counted `not-configured`，最小修复后重跑 Store 与仓库门禁。
8. **C6（已完成）**：按 `root-quality-gates.md` 保存根门 Fresh RED，精确排除非产品
   `.agents/skills/**` 辅助资产，机械修复 5 个门内文件并通过完整离线门禁。

C5 fresh evidence 为首轮 5 expected failures / 24 baseline passes、终审优先级第二轮 2 expected failures /
17 baseline passes；GREEN focused 6 files / 32 tests、Store-domain+Store 110 files / 524 tests、两包 strict
typecheck/build、目标 ESLint/Prettier 与仓库 instructions/architecture 全绿。撤回同意、session/account
失效、同版本 426 前的 session 校验和 adapter 缺失时的七天裁剪对照均通过。

根侧随后以当前工作树重跑完整离线门禁：114/114 Node 脚本、444 个 Vitest 文件（2,721 passed / 12
skipped）、Playwright 109/109、全 workspace typecheck/build、Store release audit 与
instructions/architecture 全绿；Store coverage 97 files / 480 tests，聚合 statements 92.66%、branches
87.87%、functions 88.09%、lines 92.66%。当时本次文件的 ESLint/Prettier 全绿，根级 `format:check` 与
`lint` 仍分别只由 70 个既有文件和 `.agents/skills/**` 的 143 条既有错误阻断；该历史例外已由 Phase 29
关闭。

C4 新鲜证据为 `pnpm typecheck`、`pnpm build`、instructions/architecture 全绿，114/114 Node 脚本、
443 个 Vitest 文件（2,714 passed / 12 skipped）与 Playwright 109/109。目标文档与本阶段文件的
Prettier/ESLint 通过；当时根级 format/lint 仍分别由 70 个既有文件与 `.agents/skills/**` 的 143 条既有
错误阻断，不属于 Phase 28 回归。Phase 29 已在保留产品全量检查的前提下关闭该阻断。

## 6. 审计验收

- 每个 product 成功标准都单独绑定 production source、strict contract、database/RLS test、
  actual-bundle 用例、fresh 命令和 `X`，缺失层明文写出；
- 文档不再声称不存在的 AA/Playwright 证据；
- 语义建议已在 production composition、可恢复付费结算和 actual bundle 分层通过；
- A1 只有在真实 token 值通过计算、测试对故意回退会 RED 后才完成；
- 根 format/lint 不再依赖 70/143 例外，且配置回归证明 ignore 没有扩大到 `.agents/**` 或产品资产；
- R3-C 在真实 sender、通知 CRON 生产组合和告警实现前保持生产代码缺口，不降级为验证项；
- Phase 39 staged manifest、`git diff --cached --check` 和 `F3` 聚合门已关闭版本控制交付缺口；
- 完整 V1 与发布检查表在所有 X 项完成前保持未完成。

## 7. Phase 42 公开披露漂移审计（2026-08-20）

Phase 41-A 复审发现本矩阵的运行时行为证据仍正确，但 actual `/privacy` 没有跟随 Phase 27 后的边界：
页面仍暗示登录 BYOK 结果可以上传，并使用公开 `Huayi`。权威 product/privacy/store/security 已一致规定
BYOK Key/精简结果不发送语见，StudyCapture/CloudWordCopy 是独立动作，platform 查询最多保留一小时且
不进入待整理/历史。

该缺口属于用户可见的隐私事实错误，不新增产品数据流。Phase 42 先通过三组 Fresh RED 固定四方披露，
再最小修改 PrivacyPage/配对摘要与材料测试。Fresh RED 为 focused Vitest 3 个预期失败 / 10 个基线通过
与 actual bundle 2 个预期失败；GREEN 为 focused 3 files / 13 tests、Web full 42 files / 192 tests、
actual bundle 2/2、目标静态门与 `pnpm verify:macos` 全绿。公开信任面的实现缺口已关闭；正式运营事实、
公开 URL、Windows 冻结候选验证及真实部署仍保持 pending。

## 8. Phase 43 工作台外壳漂移审计（2026-08-20）

源码共有一个 `PracticeShell`、四份完整 app-shell 复制和一份删减外壳；普通一级导航因此出现七项/八项/
五项三种集合。“今日练习”分别指向 `/`、不存在的 hash 或仅当前页 main，练习历史又错误沿用默认 active；
窄屏只是横向滚动。该缺口违反 `product.md` 固定导航与折叠语义，但不涉及业务数据流。

Phase 43 以 `CloudApp` 组合层的 WorkspaceShell interface 集中固定页面范围、七项 route/order、子页归组、
data-rights-only 受限形态和响应式 details；运营保持独立权限面，不加入一级导航。完成前不能声称 Web
工作台信息架构一致；邮件/域名/部署和 Windows 批次不纳入本阶段。

当前缺口已关闭：源码只剩 WorkspaceShell 一份一级导航定义；Fresh RED 为缺 module 加 5 个预期行为
失败，GREEN 为 focused 4 files / 20 tests、Web full 43 files / 196 tests。actual bundle 固定单一导航 DOM、
390px 原生折叠/键盘与指针展开、桌面 open、七项路由和子页 active；最终 Playwright 110/110 与
`pnpm verify:macos` 全绿。状态为
`implemented and verified on macOS; Windows batch validation pending`。

## 9. Phase 44 Web Token 漂移审计（2026-08-21）

产品已经要求颜色、间距、圆角和阴影全部经语义 Token，但生产 CSS 当前没有可执行闭包：
`account-data-rights-page.css` 引用 registry 不存在的 `--red-600`，使危险区边框色声明失效；同页、
`privacy-page.css`、`study-inbox.css` 与少量共用组件仍直接写主题值。现有 `styles.test.ts` 只读取六份
CSS，未覆盖全部 `main.tsx` 生产入口，也不验证引用定义或受控属性。

Phase 44 必须先以 `web-design-token-contract.md` 冻结三层 Token、结构性例外和 TDD，再让测试从生产
import 清单建立完整闭包。完成前不能把产品的 Token-only/危险操作视觉一致性标为已验收。该缺口是
本地 Web 产品代码与测试缺口，不是邮件、DNS、部署、真实 Provider、Chrome 或 Windows 外部项。

缺口已关闭：Fresh RED 为 2 个预期失败 / 7 个基线通过，精确报告 1 个未定义引用和 33 个受控属性
违规；GREEN 静态契约 9/9、focused 4 files / 18 tests、Web full 43 files / 198 tests。actual bundle 3/3
证明 390px 待整理 tabs、危险区有效 computed border、隐私渐变/零 API 和无横向溢出。最终
`pnpm verify:macos` 退出 0，覆盖 121/121 Node 脚本、447 个 Vitest 文件、Store coverage 97 files /
481 tests、Playwright 110/110、全 workspace 静态/构建门、发布审计和无已知漏洞的 production audit。
状态为 `implemented and verified on macOS; Windows batch validation pending`。
