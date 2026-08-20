# Phase 21 Cloud 候选证据审计方案

## 1. 问题与目标

Cloud V1 已有 Store 包审计、全量测试和发布检查表，但“正式 API/Web origin、Extension ID、隐私 URL、
运行时代码、Manifest、商店披露、Web 构建”仍靠人工逐项比对。当前 Store runtime 明确把 Cloud API 与
Web URL 设为 `null`，Manifest 也没有 Huayi API host；这是安全的开发态，却不能仅凭一次构建绿灯误判为
候选可发布。

Phase 21 新增显式 `check:cloud-release`：输入一组只含公开标识的候选配置，读取已经构建的 Store/Web
产物与版本化材料，返回结构化阻塞项。它不部署、不上传、不读取 secret、不访问网络，也不把尚未配置
的开发态改成假候选。

## 2. 范围与非目标

审计覆盖：

- Store 既有自包含包审计及 Cloud 候选额外 API host/CSP；
- Store 源码与 bundle 中固定 API origin、固定 Web workspace URL；
- Web `dist` 只使用本地脚本/样式，包含公开隐私页，不含服务端 secret 名称；
- 公开隐私 URL 必须是 Web origin 的精确 `/privacy`；
- 隐私政策、Cloud listing 与 Manifest 当前权限/host、API/Web origin 一致；
- 候选/API Extension ID 只接受 Chrome 的 32 位 `a`–`p` 小写格式且必须相同；
- API 最低 Extension 版本必须是严格数字三元组且不能高于候选 Manifest 版本；
- 结果只输出稳定 code 和固定安全文案，不输出环境值、bundle 内容或用户数据。

不覆盖：真实 TLS/DNS、Vercel/Supabase 区域、OAuth callback、备份恢复、Chrome Dashboard 问卷、商店
上传或人工截图审核。这些仍需要外部环境和单独批准。

## 3. 深模块与接口

审计逻辑集中在 `scripts/check-cloud-release.mjs` 的一个深模块，调用方只需仓库根目录和公开配置：

```ts
interface CloudReleaseConfiguration {
  apiExtensionId?: string;
  apiOrigin?: string;
  extensionId?: string;
  minSupportedExtensionVersion?: string;
  privacyUrl?: string;
  webOrigin?: string;
}

interface CloudReleaseViolation {
  code: string;
  message: string;
}

interface CloudReleaseAudit {
  ready: boolean;
  violations: CloudReleaseViolation[];
}

auditCloudRelease(repositoryRoot, configuration): Promise<CloudReleaseAudit>
```

缺配置是普通阻塞结果，不是异常。异常只表示文件无法读取等审计器自身故障。CLI 从以下非秘密环境变量
读取配置，不接受任意路径或动态命令：

- `HUAYI_RELEASE_API_ORIGIN`
- `HUAYI_RELEASE_WEB_ORIGIN`
- `HUAYI_RELEASE_PRIVACY_URL`
- `HUAYI_RELEASE_EXTENSION_ID`
- `HUAYI_STORE_EXTENSION_ID`
- `HUAYI_MIN_SUPPORTED_EXTENSION_VERSION`

后两项就是准备写入 API 部署的公开配置；审计器直接要求 API ID 与候选 ID 相同，并要求候选 Manifest
版本满足最低版本。真实部署值与 Chrome Dashboard 仍由外部发布证据确认。

全部通过时静默退出 0；有阻塞时按 code 排序写 stderr 并退出 1。不得输出输入值。

## 4. 审计规则

### 4.1 配置

- API/Web 是无 userinfo、query、fragment 且 path 为 `/` 的 HTTPS origin；二者不能相同；
- privacy URL 必须等于 `${webOrigin}/privacy`；
- 候选/API Extension ID 必须精确 `[a-p]{32}` 且相同；
- 最低 Extension 版本必须是无前导零的三个安全整数；
- 候选 Manifest 版本必须大于或等于最低版本，使用数值三元组比较；
- 任一缺失分别返回稳定 `release-config-*` code。

### 4.2 Store

- 复用现有 `auditStoreRelease` 的文件集、MV3、权限、远程代码、动态执行和 Classic 隔离；仅通过显式
  expected hosts/CSP 参数扩展 Cloud API host，默认 Store 1.0 审计行为不变；
- `HUAYI_CLOUD_API_ORIGIN` 必须是候选 API origin 字符串；`HUAYI_WEB_WORKSPACE_URL` 必须是
  `${webOrigin}/app`；不接受 `null`、`.invalid`、`.example` 或测试 origin；
- packaged service worker 必须包含两个固定值，Manifest host_permissions/CSP 必须包含 API origin；
- bundle 不得包含 `VITE_API_ORIGIN` 等可由网页输入替换的 endpoint seam。

### 4.3 Web

- `dist/index.html` 的可执行 script/style 必须是相对或同源本地资产；禁止远程脚本、stylesheet、inline
  executable script 和 event handler；
- `dist/assets` 不得出现服务端 secret 名称：数据库 URL、DeepSeek key、refresh encryption key、pepper、
  Supabase service role 或 cron secret；
- bundle 必须包含公开隐私页标题和 Limited Use 文本，证明页面进入候选构建；
- Vercel SPA rewrite 必须继续把 `/privacy` 交给 `index.html`。

### 4.4 政策与 listing

- 正式候选不得保留“草案、预发布、运营主体待补、联系方式待补、区域待补、备份期限待补”等状态；
- 隐私政策必须包含 Limited Use、服务器可读、本机 BYOK/欧路 secret、本机词库独立权威、平台插件
  查询一小时保留、StudyCapture/CloudWordCopy 和账号导出/删除；
- listing 必须逐字包含 Manifest permission、每个 host hostname、API/Web origin、公开 privacy URL，且
  不能用纯本地 Store 的“无账户/无自有后端/Cloud 端到端加密”作正向陈述，也不能声称登录后上传
  BYOK 完整结果。

Phase 27 还要求 release audit 在候选材料中找到三项账号偏好、平台/BYOK 无自动 fallback、
StudyCapture 原始意图和本机词库/CloudWordCopy 的独立边界；旧 `analyses:import`、`pendingReview import`
或“登录 BYOK 结果上传”文案必须成为固定阻塞项。

## 5. TDD

### RED

1. 当前仓库 + 空配置返回四个 config 阻塞，并明确 runtime origin 仍未配置；
2. 完整 fake 候选 fixture 先因审计模块缺失失败；
3. fixture 分别注入远程 Web script、服务端 secret 标记、Manifest host 漂移、runtime origin 漂移、
   预发布政策和 listing 漂移，要求稳定 code；
4. 既有 `check-store-release` 默认 fixture 保持通过，显式 Cloud expected host fixture 才接受额外 host。

### GREEN 与门禁

- 最小实现深模块、CLI 和 package script；
- script tests、当前真实构建的“预期 blocked”回归、既有 Store release tests；
- full test/typecheck/build、architecture/instructions、受影响 ESLint/Prettier、diff check；
- 不运行真实网络、商店上传或 Provider smoke。

## 6. 验收

- 当前开发态运行 `pnpm check:cloud-release` 必须失败并只显示安全 code/文案；
- 完整 fake 候选通过，所有单点漂移 fail closed；
- 不读取或打印任何 secret 环境变量；
- 既有 `pnpm check:store-release` 和双平台离线流程行为不变；
- 只有审计为 ready 也不能替代真实环境/人工证据，release checklist 仍需逐项完成。

## 7. 实现记录（2026-08-13）

> 本节记录 Phase 21–26 的旧产品契约证据。其当时尚缺的 Phase 27 政策关键字和禁止旧 import 文案
> 已在下方 7.1 补齐；下述旧通过数字仍不能直接转用为当前候选证据。

- `scripts/check-cloud-release.mjs` 已实现上述深模块与 CLI；`package.json` 暴露
  `pnpm check:cloud-release`，不读取 secret、不访问网络；
- `scripts/check-store-release.mjs` 只增加显式 expected hosts/CSP 参数，既有无参数 Store 1.0 profile
  仍由 `pnpm check:store-release` 验证；
- fake 完整候选、缺配置、Store/Web/政策/披露漂移、等价账号导出文案与旧 Store 口径回流均有 Node
  回归；
- 当前开发态按预期返回 `privacy-not-final`、六个 `release-config-*`、`store-api-origin` 与
  `store-web-workspace-url`，不会为了通过审计填入虚构值；
- 当前阻塞由正式运营事实、生产 URL/Extension ID 和候选 Store 接线共同解除；解除后仍需真实环境、
  Dashboard、双平台 Chrome 与商店人工预审证据。
- 最终离线门禁：107 个脚本测试、362 个 Vitest 文件（2,424 passed/12 skipped）、全 workspace
  typecheck/build、66/66 Playwright、instructions/architecture、受影响 ESLint/Prettier 与 diff check
  通过；全仓 lint/format 仍只被用户已有 `.agents/` 资产及既有
  `docs/cross-platform-development.md` 格式阻断，未改写无关文件。

### 7.1 Phase 27 fresh evidence（2026-08-14）

- `check:cloud-release` 现要求公开隐私/商店材料共同明确账号偏好、platform/BYOK 不自动回退、
  StudyCapture 只提交原始学习意图，以及本机词库与 CloudWordCopy 的独立边界；任一缺失返回固定
  `phase-27-disclosure-required`；
- 候选材料出现 `/v1/analyses:import`、`pendingReview import` 或“登录后上传 BYOK 完整结果”旧口径时，
  固定返回 `phase-27-legacy-import`。两条规则均有 self-consistent fixture、单点缺失和旧口径 RED→GREEN；
- 当前开发态 fresh 审计只返回预期的 `privacy-not-final`、六个公开配置缺失和两个 Store null-origin
  阻塞，没有 Phase 27 误报，也不会输出配置值；
- fresh 离线门禁为 114/114 Node 脚本、404 个 Vitest 文件（2,549 passed / 12 skipped）、93/93
  Playwright，以及全 workspace typecheck/build、instructions/architecture；本任务精确 ESLint/Prettier
  通过；
- 当时全仓 `format:check` 仍被 71 个既有文件阻断；全仓 `lint` 仍被 `.agents/skills/**` CJS 资产和既有
  `apps/web/src/identity-api.test.ts` 共 145 个错误阻断，后续产品 lint 已先修复，剩余根阻断由 Phase 29
  关闭。真实候选公开配置、最终隐私事实、部署、双平台 Chrome 与外部服务仍需另行批准和验证。

### 7.2 Phase 28 本地完成证据（2026-08-14）

- production 语义建议已组合固定 DeepSeek adapter、paid generator、forced-RLS Postgres authority 与
  `CRON_SECRET` cleanup；价格、kill switch 与额度在新 Provider fetch 前失败关闭，terminal replay 不因
  后续价格配置变化而失效；
- actual `/library` production bundle 已完成 suggestion→preview→显式 confirm→target GET server reread，
  并证明公开 snapshot/Web Storage 不含正文、prompt、raw output、reservation 或 task；AA semantic token
  组合另有可计算 WCAG 回归；
- S5 完整离线门禁为 114/114 Node 脚本、443 个 Vitest 文件（2,714 passed / 12 skipped）、Playwright
  109/109，以及 workspace typecheck/build、instructions/architecture 全绿；15 份目标文档 Prettier 通过。
  当时根级 `format:check` 仍由 70 个既有文件阻断，根级 `lint` 仍由 `.agents/skills/**` 的 143 条既有错误
  阻断；该历史例外已由 Phase 29 关闭；
- 这些是本地离线实现证据，不改变候选审计的外部门禁：正式隐私事实、公开 origin/Extension ID、真实
  DeepSeek 费用、Supabase/Vercel、双平台 Chrome 与商店人工预审仍须逐项完成。`check:cloud-release`
  不会因 Phase 28 的 fake Provider/authority 证据而把开发态判定为 ready。

### 7.3 Phase 27F-R SubmissionOutbox 保留回归（2026-08-14）

- 完成度源码复审发现有效 session/同意与 `api=null` 组合会误清账号绑定密文，并让未计数的
  `not-configured` 隐藏用户清空入口；权威状态机、测试与变更记录已先校准；
- 首轮 Fresh RED 为 5 expected failures / 24 baseline passes；实现后复审又以第二轮 2 expected failures /
  17 baseline passes 固化同版本 426 前先校验 session，以及 adapter 缺失时仍执行七天裁剪；
- 最终 focused 6 files / 32 tests、Store-domain+Store 110 files / 524 tests；根侧完整门禁为 114/114 Node
  脚本、444 个 Vitest 文件（2,721 passed / 12 skipped）、Playwright 109/109、全 workspace
  typecheck/build、Store release audit、Store coverage 97 files / 480 tests 与 instructions/architecture 全绿；
- 当前 `not-configured` 只在有保留项时投影 count/oldest，Popup 禁用 retry、允许二次确认 clear；授权撤回、
  session/account 失效仍清正文。真实 Service Worker 生命周期、断网恢复和双平台 Chrome 仍是外部门禁。

### 7.4 Phase 29 根级离线质量门证据（2026-08-14）

- Fresh RED 为 format 70 个文件（65 个代理技能资产、5 个真实门内文件）与 lint 143 条错误（全部来自
  7 个代理技能 CommonJS 脚本）；配置测试为 2 passed / 1 expected failure；
- `.prettierignore` 与 ESLint 只精确排除 `.agents/skills/**`，配置测试断言没有排除 `.agents/**`；3 个
  Web 源文件、跨平台文档与 lockfile 使用既有 Prettier 机械修复，`--debug-check` 保持可解析结构；
- GREEN 为根 format/lint、配置测试 3/3、115/115 Node 脚本、444 个 Vitest 文件（2,721 passed / 12
  skipped）、Playwright 109/109、全 workspace typecheck/build 与 instructions/architecture；
- 该本地门禁关闭不改变候选外部阻塞：正式隐私事实、公开 origin/Extension ID、真实 Provider/部署、
  双平台 Chrome 与商店人工预审仍须逐项批准和验证。

### 7.5 Phase 30 macOS 聚合离线门禁证据（2026-08-14）

- 在 macOS 真实执行 `pnpm verify:macos`，命令以退出码 0 完成；没有拆分执行后拼接为平台通过声明；
- 聚合门禁覆盖 instructions、根 format/lint、workspace typecheck、115/115 Node 脚本、444 个 Vitest
  文件（2,721 passed / 12 skipped）、Store coverage 97 files / 480 tests、architecture、workspace build、
  Playwright 109/109、Store release、生产依赖审计与 `git diff --check`；
- `pnpm audit --prod --audit-level high` 返回 `No known vulnerabilities found`；该联网只查询包管理器安全
  公告，没有运行 Huayi、Provider、词典、认证或部署请求；
- 本证据只关闭 macOS 自动化离线聚合门禁。真实安装、真实 Chrome、Provider/词典 smoke、
  Supabase/Vercel、邮件和多连接 Postgres 竞争仍须单独授权与验证；Windows 也必须独立执行
  `pnpm verify:windows`，不得由本结果推断通过。
- `git diff --check` 只检查已跟踪差异；当前仍有未跟踪 Cloud V1 文件，因此它不能证明版本控制交付
  范围完整。未跟踪产品文件已由根 format/lint、typecheck、test、build 和发布审计覆盖行为与格式，但
  候选提交前仍须确认应发布文件全部进入版本控制后再运行 diff 检查。

## 8. Phase 26B 运行时一致性扩展（2026-08-13）

- release configuration 新增 API Extension ID 与最低客户端版本；CLI 读取准备部署的同名公开值，
  不读取 secret；
- fake 候选证明 ID 漂移、候选低于最低版本、前导零/非三段/超安全整数和词典序陷阱全部失败关闭；
- 详细需求、数据边界、自审、TDD 与 fresh 门禁见 `release-runtime-consistency.md`。

## 9. Phase 31 开发态阻塞基线（2026-08-14）

### 9.1 产品边界

正式候选继续只由 `pnpm check:cloud-release` 判定：全部候选证据一致时 `ready=true` 并退出 0，任何阻塞
都退出 1。Phase 31 另提供显式 `pnpm check:cloud-development-blocked`，只用于证明未注入候选公开配置的
真实开发工作树仍准确失败关闭；该命令成功不表示候选 ready，也不得用于商店提交。

开发态命令只在发布审计返回以下九个且仅以下九个 code 时退出 0：

1. `privacy-not-final`；
2. `release-config-api-extension-id`；
3. `release-config-api-origin`；
4. `release-config-extension-id`；
5. `release-config-min-extension-version`；
6. `release-config-privacy-url`；
7. `release-config-web-origin`；
8. `store-api-origin`；
9. `store-web-workspace-url`。

集合少一项意味着开发树被部分候选化，多一项意味着出现新的发布漂移；两者都必须失败。比较按去重后的
code 集合完成，不依赖审计返回顺序。

### 9.2 技术与数据方案

- `auditCloudRelease` 的参数、返回结构、正式候选 `ready` 语义和现有 CLI 环境变量全部保持不变；
- 同一深模块导出开发态期望 code 与纯集合判定函数，开发态 CLI 复用真实仓库审计结果，不复制审计规则；
- 开发态成功保持静默；失败只输出固定安全 code/文案，不输出 origin、Extension ID、环境值、文件内容
  或异常细节；审计器自身异常继续使用固定失败文案；
- 不新增数据库表、迁移、网络数据或持久状态。唯一新增“数据”是版本化的九项 code 常量，作为当前开发
  工作树的可审查发布阻塞基线；
- macOS/Windows 聚合门禁都在 `build` 之后运行该入口，确保审计读取刚生成的 Store/Web `dist`；正式
  `check:cloud-release` 不进入无候选配置的开发态聚合门禁。

### 9.3 TDD 与验收

Fresh RED 必须先证明：缺少开发态入口；精确九项应成功；少一项、多一项、重复掩盖缺项和任意乱序集合
均按集合语义处理；失败输出只含稳定安全 code；双平台步骤都在 `build` 后立即调用新入口。最小实现后
运行脚本 focused tests、真实工作树开发态入口、format/lint/typecheck/build、instructions/architecture；
时间允许再运行全量 `pnpm test` 与当前 macOS 聚合门禁。

验收成立需要同时满足：真实工作树精确九项时新入口退出 0；任意少/多项 fixture 退出非零；正式候选
fixture 与 `check:cloud-release` 的 ready 行为完全不变；聚合门禁在 build 后验证开发态基线；所有输出
仍不泄露候选值或 secret。真实候选、部署、Chrome、Provider 和第三方服务继续是外部门禁。

### 9.4 实现与证据

- Fresh RED 为 2 baseline passes / 3 expected failures：发布审计测试因开发态导出缺失而加载失败，macOS
  与 Windows 顺序测试都证明 build 后尚未调用新入口；
- 最小实现首次 GREEN 让 focused 17/17 通过，同时真实工作树按设计因集合不一致失败，并只输出
  `development-blocker-missing` 与 `development-blocker-unexpected`。据正式审计的安全 code 复核后，固定
  九项校准为 `privacy-not-final`、六项 `release-config-*`、`store-api-origin` 和
  `store-web-workspace-url`；没有把 `store-bundle-origin` 误写进空配置时不会执行的 bundle 分支；
- 校准后的真实 `pnpm check:cloud-development-blocked` 在 build 后静默退出 0；少项、多项、乱序、重复和
  不回显不可信 code/message 均有单元证据；完整 fake 正式候选仍返回 `ready=true`；
- GREEN 门禁为 focused 17/17、118/118 Node 脚本测试、444 个 Vitest 文件（2,721 passed / 12 skipped）、
  目标 Prettier/ESLint、全 workspace typecheck/build、instructions/architecture；
- 更新后的完整 `pnpm verify:macos` 以退出码 0 完成，并实际在 build 后运行新入口，随后通过 Store
  coverage 97 files / 480 tests、Playwright 109/109、Store release、生产依赖审计与 `git diff --check`。
  该结果不替代 Windows、真实候选、部署、Chrome、Provider 或第三方服务验证。

## 10. Phase 32 完成度证据校准（2026-08-14）

- `offline-completion-audit.md` 已按 `product.md` 七条必须同时满足的成功标准重建矩阵，每条分别
  绑定 production source、strict contract、database/RLS test、actual-bundle 用例关键词、Phase 31
  fresh `pnpm verify:macos` 和剩余外部门禁；不再使用 A/B 折叠缺失证据层。
- 第 6 条可运营账号闭环仍有 R3-C 代码缺口：真实安全通知 sender、独立通知 CRON 生产
  route/composition 与告警尚未实现；邮件厂商、verified sender/域名、联系方式与告警渠道
  又是必须先明确的外部决策。因此完整 V1 不可声称开发测试验收完成。
- Phase 31 中 `git diff --check` 通过只证明已跟踪差异无 whitespace error。当前工作树仍含未跟踪
  Cloud V1 交付文件，候选提交前必须确认交付范围、纳入版本控制并重跑该检查。

## 11. Phase 33 Store 权限必要性审阅（2026-08-14）

### 11.1 结论与官方依据

结论为：保留 `storage`、`unlimitedStorage`、`alarms` 和当前三个精确 HTTPS API host；不新增 `tabs`。
Chrome 官方资料直接证明：

- [`chrome.storage`](https://developer.chrome.com/docs/extensions/reference/api/storage) 要求 `storage`；
  `storage.local` 默认总量为 10 MiB，`unlimitedStorage` 会忽略该值，越界写入否则拒绝；
- [权限列表](https://developer.chrome.com/docs/extensions/reference/permissions-list) 明确
  `unlimitedStorage` 覆盖 `chrome.storage.local`、IndexedDB、Cache Storage 与 OPFS；
- [扩展存储概念](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies) 明确该权限
  同时解除常规 quota 与 eviction；这里不把它误述为无限物理磁盘、备份或绝对不丢数据；
- [`chrome.alarms`](https://developer.chrome.com/docs/extensions/reference/api/alarms) 明确要求 `alarms`；
- [跨源请求](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests) 说明 Extension
  Service Worker 向外部 origin 发 `fetch` 需要 host permission；
- [`chrome.tabs`](https://developer.chrome.com/docs/extensions/reference/api/tabs) 说明创建标签、发送消息及不读取
  URL/title 等敏感字段的查询通常无需 `tabs` 权限，与当前只使用 tab ID 的实现一致。

### 11.2 当前存储与调用证据

| 能力/后端                    | 当前生产源码                                                               | 容量或用途边界                                                                  | 审阅结果                 |
| ---------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------ |
| `chrome.storage.local`       | `chrome-vault-storage.ts:15-50`、`service-worker.ts:64-117,193-203`        | 设置、DeviceVault/凭据、Cloud session、三类耐久任务；只向 trusted contexts 开放 | `storage` 保留           |
| 本机词库 IndexedDB           | `browser-lexicon-repository.ts:19,236-246`、`lexicon.ts:35-42`             | 每词最多 1,000 语境；没有总词条数/总字节上限                                    | `unlimitedStorage` 保留  |
| 词典任务 IndexedDB           | `production-wordbook-export-engine.ts:8-28`、`wordbook-state.ts:22-28`     | 最多 20,000 outbox item、10,000 seen ID                                         | `unlimitedStorage` 保留  |
| SubmissionOutbox             | `submission-outbox.ts:20-22,122-126`、`submission-outbox-vault.ts:25-53`   | 20 项、5 MiB 明文 JSON、8,000,000 字符密文 envelope、7 天保留                   | `storage.local` 耐久状态 |
| 本机批量导入                 | `local-word-import-vault.ts:8-18,57-63,113-135`                            | 5,000,000 bytes 明文、8,000,000 字符密文 envelope                               | 可与 outbox 并存         |
| 外部词典 lease/Cloud session | `external-wordbook-lease-vault.ts:7-31`、`extension-session-vault.ts:9-33` | 分别 64,000 与 16,384 字符密文 envelope                                         | `storage.local` 有界状态 |
| `alarms`                     | `service-worker.ts:180-203,355-383`                                        | 配对轮询、SubmissionOutbox、本机批量导入、词典任务恢复                          | 保留                     |
| OpenAI/DeepSeek host         | `provider-requests.ts:10-13`、`browser-analysis-engine.ts:42-46`           | 两个固定 HTTPS endpoint；BYOK Service Worker fetch                              | 保留精确 host            |
| Eudic host                   | `eudic-client.ts:8-9,143-152,184-200,208-250`                              | 两个固定 HTTPS endpoint；授权不允许调用者指定 URL                               | 保留精确 host            |

当前没有 Cache Storage 或 OPFS 调用，因此它们只是 Chrome 对同一权限授予的附带能力，不是申请理由。
本机词库“无总量产品上限”只表示 schema 不设总词条/总字节 cap；它仍受实际磁盘、卸载、损坏和 I/O
失败约束。删除 `unlimitedStorage` 会同时产生两项语义变化：IndexedDB 正式本机数据重新受常规 quota/
eviction 影响；两个可并存、base64 后各可接近 6.7 MiB 的 `storage.local` 任务再叠加凭据/session/设置，
会超过默认 10 MiB 并使耐久写入直接失败。因此该权限不是预防性占位，不能删除。

### 11.3 审阅范围与剩余验收

- 本阶段只审阅当前源码、Manifest 和 Chrome 官方文档，不运行安装、真实 Chrome、Provider/词典 smoke
  或远端服务，也不更改 Manifest/运行时代码；
- Phase 33 关闭“当前权限是否仍必要”的源码审阅项，不关闭正式候选包的一致性门禁；生产 Huayi API
  origin 固定后仍须加入精确 HTTPS host/CSP，并在目标候选重新执行 `check:cloud-release` 与逐项人工复核；
- 候选实测仍应确认普通站点/YouTube 内容脚本、alarm 恢复及本机数据在升级/重启后的行为，但这些实测
  不再是判断当前 `unlimitedStorage` 是否必要的前置证据。

## 12. Phase 34 DeepSeek V4 Flash 分时计费校准（2026-08-14）

- 官方事实已校准到 `deepseek-v4-billing.md`：非流 thinking usage 的可选
  `completion_tokens_details.reasoning_tokens`，2026-08-16T16:00:00Z 生效点，UTC
  `[01:00,04:00)`/`[06:00,10:00)` peak，以及 legacy/off-peak/peak 三套精确 micro-USD；
- 实现先按 peak reservation，再由 durable dispatch 的同一可信 UTC `now` 选择并在 fetch 前精确校验
  数据库快照；analysis、ExtensionQuery、semantic suggestion、practice 的 Provider 成本与 settlement
  都复用已固定 UUID，pre-dispatch 恢复不会错误沿用 begin 时窗；
- Fresh RED 分三组：schedule module 缺失；合法 reasoning details 被 strict schema 拒绝；production
  semantic suggestion 从 03:59:59.999 begin 跨到 04:00 dispatch 时错用非 dispatch 时刻。首轮 API RED
  是 2 个预期失败、108 files / 387 baseline tests 通过；dispatch-boundary RED 是 1 个预期失败、3 个
  baseline tests 通过；最终范围自审另以 1 个预期失败、11 个 baseline tests 证明导出价格常量尚未冻结，
  随后冻结常量。这些是 Fresh RED 覆盖，其他四路径用 GREEN regression 固化，未伪称都有独立 RED；
- GREEN focused 为 7 files / 55 tests；最终 API full 为 110 files / 407 tests。API strict typecheck/build、
  全 workspace typecheck/build、目标 ESLint、目标 TypeScript/Markdown Prettier、instructions 与 architecture
  均 fresh 通过；SQL migration 没有 Prettier parser，由 API full 中的 migration/PGlite lifecycle 回归验证；
- 追加根级 `pnpm lint` 与 `pnpm format:check` 通过；首次 `pnpm test` 发现 Phase 33 已把权限口径校准为
  “正式候选包权限一致性复核”，但 Web 发布材料测试仍断言旧词“候选包前重审”。Root 以该真实失败为
  RED，只更新过期断言；focused 2/2 后，完整 `pnpm test` 为 118/118 脚本、445 个 Vitest 文件、
  2,741 passed / 12 skipped；
- Root 随后真实运行当前工作树 `pnpm verify:macos` 并以退出码 0 完成：同一聚合门覆盖 instructions、
  format、lint、全 workspace typecheck、上述完整 test、Store coverage 97 files / 480 tests、architecture、
  build、固定九项 development blocker、Playwright 109/109、Store release audit 与 production dependency
  audit；这份当前证据记为 `F2`，取代 Phase 31 的 `F1` 作为完成度矩阵的新鲜本地证据；
- 未发布 bootstrap 只新增 `analysis_requests.dispatched_at` 与原子 dispatch transition，其他 task 复用
  既有列。`model_price_versions`、UsageLedger 外键和 append-only trigger 继续保留历史；
- 本证据不包含真实 DeepSeek 请求、API key、账单、生产数据库行、部署、安装或 Chrome。生产三个 UUID
  行的受控插入、部署配置与真实账单对账仍是发布门禁。

## 13. Phase 35 未跟踪交付候选盘点（2026-08-14）

- `git ls-files --others --exclude-standard` 的 2026-08-14 当时结果中，交付候选共 610 个：`.prettierignore` 1 个、
  `apps/api/**` 292 个、`apps/store-extension/**` 75 个、`apps/web/**` 152 个、`docs/adr/**` 14 个、
  `docs/cloud-v1/**` 42 个、`packages/cloud-contracts/**` 22 个、`packages/learning-domain/**` 1 个、
  `packages/store-domain/**` 9 个、`scripts/check-cloud-release*` 2 个；
- 明确不纳入 Cloud 候选的未跟踪资产为 `.agents/skills/**` 150 个代理辅助技能文件，以及
  `artifacts/**` 8 张未被源码/文档引用的 Classic/本地 UI 截图；未删除这些用户资产；
- 本轮只完成只读范围盘点，没有执行 `git add`、commit、push 或删除。候选进入版本控制后仍须重新核对
  文件数、运行 `git diff --check` 并以候选配置重跑正式 release audit；当前 tracked diff 的退出码不能
  证明这 610 个文件会被交付。该历史 pending 已由下方 Phase 39 的 613 个候选 staged evidence 取代。

## 14. Phase 38 Vercel Hobby + Supabase Free 调度适配（2026-08-20）

- `apps/api/vercel.json` 已移除四项分钟级 cron；四个既有 `CRON_SECRET` production route 仍由 composition
  test 固定，不改变 worker 状态机、Classic/Native Host、公开 API 或 Windows 支持；
- `apps/api/operations/configure-supabase-cron.sql` 是 production-only 管理员运维脚本，不进入 migration 或
  应用启动。它幂等启用 `pg_cron`、`pg_net`、Vault，从 Vault 读取两个命名值，校验 HTTPS origin 与
  32–512 字符 secret，只允许四个精确 path，并撤销公开/业务角色执行权；
- Fresh RED 为 SQL 不存在 2 条、Vercel 仍含 crons 1 条，另外 2 条 route/composition 基线通过；GREEN
  focused 为 2 files / 5 tests；
- 首次 API full 发现与本阶段无关的日期漂移：dispatch-price 测试 lease 固定在 2026-08-17。保持固定
  dispatch 计费边界、只把 lease 改成当前时间后 4 分钟后，该文件 5/5，API full 111 files / 409 tests；
- API strict typecheck/build、目标 ESLint、目标 TypeScript/JSON/Markdown Prettier、instructions 与
  architecture 已 fresh 通过。SQL 没有 Prettier parser，以静态安全契约与人工 diff review 覆盖；
- 根级 format/lint/typecheck/build、118/118 Node 脚本、446 个 Vitest 文件（2,743 passed / 12 skipped）
  通过；Playwright 首轮唯一 fake Google consent 导航超时经单条 1/1 与完整重跑 109/109 关闭，未改认证
  产品行为；
- 证据不包含真实 Vercel/Supabase、Vault、HTTP、域名/DNS/Resend、Provider、安装或 Chrome。正式任务仍
  须运行 SQL 两次并确认恰好四项，观察失败恢复，并裁决 Hobby 个人非商业/60 秒、DeepSeek 90 秒、
  Supabase Free 暂停/无自动备份与 `pg_net` Beta。

## 15. Phase 39 交付候选与 fake/third-party 矩阵（2026-08-20）

- 按 Phase 35 的相同 allowlist 重算为 613 个未跟踪交付候选：`.prettierignore` 1、API 294、Store
  Extension 75、Web 152、ADR 14、Cloud 文档 43、Cloud contracts 22、learning-domain 1、store-domain
  9、Cloud release scripts 2；继续排除且不删除 `.agents/skills/**` 150 个与 `artifacts/**` 8 张截图；
- 另审查 90 个 tracked 修改、依赖 diff、secret pattern、生成目录、symlink、文件大小和类型。候选中
  没有 secret、私钥、环境文件、构建输出、覆盖率或超大文件；只在两条 Provider 测试中保留明确命名的
  dummy bearer value；
- `testing.md` 2.1 把 fake matrix 收敛为能力实际定义的 success/failure/cancel/timeout/quota。Fresh RED
  为 2 个预期失败 / 19 个基线通过：Eudic 缺固定内部 deadline，ExtensionQuery 接受 90,001ms；其余
  quota/abort 回归是 characterization，不伪称行为 RED；
- GREEN 后每次 Eudic HTTP request 都以调用者 signal 与固定 10 秒内部 deadline 合并，超时会 abort
  fetch/body reader 并稳定映射为 `timeout`；ExtensionQuery 只接受 1–90,000ms。另固定
  ExtensionQuery quota-before-provider 与 ExtensionQuery、semantic suggestion、practice 的 stalled abort；
- focused 5 files / 21 tests、Store Extension full 97 files / 481 tests、API full 111 files / 413 tests，
  两包 strict typecheck/build 与目标 ESLint 均 fresh 通过；
- 首次完整 Playwright 在当前墙钟刚越过 harness 固定的 `2026-08-20T10:00:00Z` session expiry 后，
  以 8 failed / 101 passed 暴露本机批量导入先返回 `session-unavailable`、随后词典 authority 连锁 idle。
  这不是 Eudic deadline 回归；测试 session 改用共享长期有效常量后，原始首条 1/1、受影响 8/8、完整
  109/109 与 macOS 聚合内 109/109 均通过；
- 精确 staged manifest 为 705 个文件：613 个新增候选 + 92 个相关 tracked 修改；剩余未跟踪恰好为
  150 个 `.agents/skills/**` 与 8 张 `artifacts/**`，两者零暂存。staged candidate 无生成/秘密路径，
  `git diff --cached --check` 通过；
- 根级 instructions/architecture/format/lint/typecheck/build、118/118 Node 脚本、446 个 Vitest 文件
  （2,748 passed / 12 skipped）、固定九项 development blocker、Store release 和 production dependency
  audit 全绿；`pnpm verify:macos` 退出 0，并再次覆盖 Store coverage 与 Playwright 109/109；
- 本阶段没有真实 Provider/词典、部署、安装、Chrome、邮件、域名、DNS 或 Windows 目标机操作。Windows
  支持和 CI/SEA 契约保留，实际 `verify:windows` 与 SEA health 进入下一阶段。

## 16. Phase 40 Windows 回流与品牌候选复验（2026-08-20）

- 拉取并线性整合 Windows 修复/证据提交 `3aa143c`、`313b5d4` 与“语见 / Seen & Said”品牌提交；
  `AGENTS.md` 合并后为 12,206 bytes，低于 12 KiB 上限；
- 首次隔离 macOS 全门在 Playwright 得到 107/109：Store cold Vite discovery 触发同页 reload，Cloud
  学习库在第二次 archive mutation 完成前切换 archived filter。前者通过显式扫描两组 E2E HTML entry
  在冷启动预发现依赖，后者等待 mutation 的“恢复学习项”可见状态后再筛选并重选条目；
- 品牌提交把 Web 隐私页改为 `语见 Cloud V1 隐私说明`，release audit 仍检查旧公共名称而新增
  `web-privacy-artifact`。测试夹具先改名取得 7 expected failures / 6 baseline passed，再只校准 artifact
  marker；固定九项 development blocker 和全部安全/发布阈值保持不变；
- focused GREEN：Playwright source/release audit 17/17、目标 journeys 连续 10/10；最终
  `pnpm verify:macos` 退出 0，覆盖 446 个 Vitest 文件（2,748 passed / 12 skipped）、Store coverage
  97 files / 481 tests、Playwright 109/109、9 个 build、完整静态门、release audits 与 production
  dependency audit；
- Windows 11 上的上一候选 `verify:windows` 与 SEA health 证据仍有效地证明 `3aa143c`；但当前品牌与
  shared harness/audit 修复晚于该 HEAD，因此当前精确候选仍需 Windows/远端 CI 重验。未运行安装、
  真实 Chrome、凭据、Provider/词典 smoke、邮件/域名/DNS 或部署。

## 17. Phase 42 Cloud 数据边界公开披露一致性（2026-08-20）

- 复审确认 actual `/privacy` 仍含“登录 BYOK 上传/严格结果上传 Huayi”旧语义，与现行 BYOK Key/精简
  结果不发送语见、platform 临时保留、StudyCapture/CloudWordCopy 独立执行的产品事实冲突；
- Fresh RED 为 focused Vitest 3 files / 3 expected failures / 10 baseline passes 与 actual bundle 2 个
  expected failures；最小实现只校准 PrivacyPage、配对摘要与对应回归，没有改协议、API、数据库、
  Provider 或 Extension runtime；
- GREEN 为 focused Vitest 3 files / 13 tests、Web full 42 files / 192 tests、actual bundle 2/2、Web
  strict typecheck/build、目标 ESLint/Prettier、instructions/architecture 与 diff check 全绿；
- `pnpm verify:macos` 退出 0，覆盖 121/121 Node 脚本、Store coverage、全部 workspace build、109/109
  Playwright、release audits 与 production dependency audit；本机 actual `/privacy` 的 DOM 与全页截图
  检查没有溢出或布局异常；
- 当前状态为 `implemented and verified on macOS; Windows batch validation pending`。未运行 Windows、
  真实 Provider/词典、安装、Chrome 扩展、邮件、域名、DNS 或部署。

## 18. Phase 43 Web 工作台外壳与主导航（2026-08-20）

- Fresh RED 为 focused 4 个 Web 文件：WorkspaceShell module 缺失，另有 5 个预期行为失败与 12 个基线
  通过，固定今日练习错误目标、tab 切换丢壳、设备/词典 active 漂移和 data-rights-only 导航泄露；
- 最小实现由 `CloudApp` 在 bootstrap 后只组合一次 WorkspaceShell，删除 `PracticeShell` 与页面复制外壳；
  普通账号一级导航恰好七项，练习历史、外部词典、设置子页正确归组，运营和受限账号不扩张导航；
- actual-bundle 首轮发现 closed details 的桌面子树即使 CSS 为 flex 仍不可见，最终以 48rem media query
  控制同一 details：桌面 open、移动默认 closed。Workspace journey 1/1 覆盖 390px 键盘/指针展开、七项
  顺序/跳转、子页 active、桌面重排与无水平溢出；
- GREEN 为 focused 4 files / 20 tests、Web full 43 files / 196 tests；完整 Playwright 首轮的两条旧移动
  journey 未展开导航而失败，按真实用户展开修正后 focused 2/2，最终 Mac 聚合门为 110/110 Playwright；
- Web strict typecheck/build、目标 ESLint/Prettier、instructions、architecture、diff check 与最终
  `pnpm verify:macos` 均通过。状态为
  `implemented and verified on macOS; Windows batch validation pending`；
- 未运行 Windows、真实 Provider/词典、安装、Chrome 扩展、邮件、域名、DNS、Resend 或部署。
