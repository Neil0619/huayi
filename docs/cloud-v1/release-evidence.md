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
  storeExtensionCapability?: "enabled" | "disabled";
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
- `HUAYI_STORE_EXTENSION_CAPABILITY`

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
- 当前开发态按预期返回 `privacy-not-final`、七个 `release-config-*`、`store-api-origin` 与
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
  十项校准为 `privacy-not-final`、七项 `release-config-*`、`store-api-origin` 和
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
- 第 6 条可运营账号闭环在 Phase 32 当时仍有 R3-C 代码缺口：真实安全通知 sender、独立通知 CRON 生产
  route/composition 与告警尚未实现。该代码缺口后由 Phase 48 关闭；邮件厂商、verified sender/域名、
  联系方式、真实投递与告警接收仍是外部门禁。因此完整 V1 仍不可声称开发测试验收完成。
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

- `apps/api/vercel.json` 已移除四项分钟级 cron；本段记录 Phase 38 当时的四个 `CRON_SECRET` production
  route。Phase 48 后当前 route/operations SQL 已增为五项，不改变 Classic/Native Host 或 Windows 支持；
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
- 证据不包含真实 Vercel/Supabase、Vault、HTTP、域名/DNS/Resend、Provider、安装或 Chrome。正式任务现在
  须运行 SQL 两次并确认恰好五项、观察失败恢复；Phase 45 后改为核验 Fluid/120 秒实际部署，并继续
  裁决 Hobby 个人非商业、Supabase Free 暂停/无自动备份与 `pg_net` Beta。

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

## 19. Phase 44 Web 语义设计 Token 收口（2026-08-21）

- docs-first 已冻结 `web-design-token-contract.md`：唯一 registry、primitive → semantic → component、
  受控属性和结构性例外均有可执行定义；
- 实现前审计确认 `--red-600` 未定义，data-rights/privacy/StudyInbox 与少量共用组件保留原始主题值，
  而旧 `styles.test.ts` 未读取全部生产 CSS；
- Fresh RED 为 2 个预期失败 / 7 个基线通过：引用闭包报告 1 个未定义 Token，受控属性报告 33 个原始
  颜色/间距/圆角/阴影或 primitive 颜色直访；
- 最小 GREEN 保持既有视觉值，只把原本失效的危险区边框绑定既有 danger 色；静态契约 9/9、focused
  4 files / 18 tests、Web full 43 files / 198 tests、Web strict typecheck/build 和目标 lint/format 全绿；
- actual production bundle 3/3 覆盖 `/app`、`/settings/data`、`/privacy`，证明 390px tabs、有效危险边框、
  隐私渐变、公共页零 API 与无横向溢出；
- 最终 `pnpm verify:macos` 退出 0，覆盖 121/121 Node 脚本、447 个 Vitest 文件、Store coverage 97 files /
  481 tests、Playwright 110/110、全 workspace format/lint/typecheck/build、instructions/architecture、发布
  审计、`git diff --check` 和无已知漏洞的 production audit；
- 状态为 `implemented and verified on macOS; Windows batch validation pending`；
- 不运行 Windows、真实 Provider/词典、安装、Chrome 扩展、邮件、域名、DNS、Resend 或部署。

## 20. Phase 45 Vercel Fluid 与 Function 时长（2026-08-21）

- docs-first 已冻结 `vercel-fluid-function-duration.md`，并由源码复审确认 90 秒是一次 DeepSeek 生成的
  总 Provider budget，可选结构修复共用同一个 timer；
- Fresh RED 为 `production-app.test.ts` 2 个预期失败 / 3 个基线通过，分别证明当前配置缺少 `fluid` 与
  `functions["src/server.ts"]`；最小 GREEN 只写入 `fluid: true` 与 `maxDuration: 120`，不恢复 Vercel
  Cron，不改 Provider timeout、公开 API、账本、lease 或依赖；
- GREEN focused 为配置与四条 DeepSeek deadline 5 files / 25 tests；API full 111 files / 415 tests、API
  strict typecheck/build、目标 lint/format 全绿；
- 最终 `pnpm verify:macos` 退出 0，覆盖 121/121 Node 脚本、447 个 Vitest 文件（2,757 passed /
  12 skipped）、Store coverage 97 files / 481 tests、Playwright 110/110、全 workspace
  format/lint/typecheck/build、instructions/architecture、发布审计、production audit 与 diff check；
- 当前状态为
  `runtime configuration implemented and verified on macOS; real deployment and Windows batch pending`。
  真实 Vercel project、Dashboard、部署产物、Observability、Windows、邮件、域名、DNS、Resend、Provider、
  安装和 Chrome 均未运行。

## 21. Phase 46 第二批候选冻结结果（2026-08-21）

- Phase 46 当时完成度复核没有发现新的本地产品代码纵切：七条成功标准中第 1–5、7 条已有 production/
  contract/database/actual-bundle 离线证据；第 6 条当时唯一代码缺口是依赖已延期邮件/域名/告警决策的
  R3-C，该代码缺口后由 Phase 48 关闭；
- 冻结账本真实 mismatch 是仍写 `2a035ee` 与两个累计提交，而 Phase 45 代码锚点已为
  `15306b46b4129682278c7dcecc47ac45bbfa7f7d`；当前远端仍为
  `313b5d409e5fa49e9a0391b6e7d791eea8a28893`；冻结提交前本地 ahead 7，本节提交后 ahead 8；
- 从上次 Windows 完整门验证的代码 `3aa143c` 到该锚点共有 8 commits、111 files、`+3007/-1175`。
  累计范围含品牌/Manifest/Native Host 文案、跨平台 E2E 稳定性、公开披露、Web 工作台/Token 与 API
  Vercel 配置；没有协议包、wire/schema version、依赖锁、DPAPI、PowerShell、注册表、SEA、Windows
  安装器或 Native Messaging 传输变化。最终候选再增加本节所在的 docs-only 冻结提交，因此相对上次
  Windows 代码共 9 commits；
- `git diff --check 3aa143c..15306b4` 通过；added-line secret-shaped 扫描和路径审计未发现凭据、生成物、
  打包产物或可执行文件；
- 最终交接文档工作树的 `pnpm verify:macos` 退出 0：121/121 Node 脚本、447 个 Vitest 文件（2,757
  passed / 12 skipped）、Store coverage 97 files / 481 tests、Playwright 110/110；instructions、format、
  lint、全 workspace typecheck/build、architecture、development blocker、Store release、production audit
  与 `git diff --check` 同次通过；
- 当前状态为 `candidate prepared locally; push and Windows validation pending`。未运行 Windows、
  push、CI、安装、Chrome、凭据、真实服务、Provider/词典、部署、邮件、域名、DNS 或 Resend。

## 22. Phase 47 可用测试环境路线校准（2026-08-21）

- **用户纠正**：离线自动化和 Mac/Windows 门不是可用测试环境，不能从开发完成直接跳到 production；
- **仓库事实**：Playwright `*.invalid` 只由 route fulfill；当前没有 Supabase local manifest、seed/bootstrap、
  start/reset、loopback HTTPS、持久 migration 路线或 Store acceptance profile；
- **路线结论**：第二批 Windows 验证已由用户回传完成；先实现 Mac local acceptance 并让用户边用边改，
  主流程稳定后再部署独立 Supabase/Vercel hosted acceptance；
- **域名拓扑**：用户现可注册域名和配置 DNS，hosted acceptance 首选自有根域下同站 Web/API 子域；
  `*.vercel.app` 同源 gateway 降为域名未就绪时的备用方案，不放宽 Cookie/CORS；
- **邮件边界**：`notify` 子域和 Resend 恢复为托管准备项；本机 Mailpit、DNS verified 或受控测试账号都不
  冒充 R3-C sender/通知 CRON/告警完成；
- **生产门**：至少一个跨多日自然使用周期、P0/P1 清零、P2 有结论、最新 Mac/Windows 批次门全绿且
  用户明确批准后，才进入 production candidate。

文档校准后的 `pnpm verify:macos` fresh 退出 0：121/121 Node 脚本、447 个 Vitest 文件（2,757 passed /
12 skipped）、Store coverage 97 files / 481 tests、Playwright 110/110，以及 instructions、format、lint、
typecheck、architecture、build、development blocker、Store release、production audit 和 diff check 全绿。
这只证明最终规划工作树未破坏离线候选；没有创建云资源、账号、secret 或部署，没有调用 Provider、安装
或 Chrome，也没有把尚不存在的验收环境标为 ready。

## 23. Phase 47 本机验收第一纵切（2026-08-21）

- **Fresh RED**：`node --test scripts/acceptance-local-doctor.test.mjs` 因
  `acceptance-local-doctor.mjs` 不存在退出 1，精确证明仓库缺少可执行前置条件契约；
- **最小 GREEN**：root 精确 pin Supabase CLI `2.115.0`，新增 local Supabase manifest、secret-free
  `.env.acceptance.example`、精确 ignore 与 `acceptance:local:doctor`；5/5 focused 通过；
- **安全行为**：doctor 只返回固定 blocker code/message，不回显命令 stderr、环境或路径；真实运行仅报告
  `docker-daemon` 与 `local-ca`，退出 1，没有伪报 ready；Supabase config 已由 CLI 解析到 Docker health
  阶段；
- **完整门**：`pnpm verify:macos` fresh 退出 0，覆盖 126/126 Node 脚本、447 个 Vitest 文件（2,757
  passed / 12 skipped）、Store coverage 97 files / 481 tests、Playwright 110/110、全 workspace
  format/lint/typecheck/build、instructions/architecture、development blocker、Store release、production audit
  与 diff check；
- **未运行**：没有启动 Docker、拉取 Supabase images、安装/信任本机 CA、创建账号/secret/云资源、调用
  Provider/Resend、配置 DNS、部署、安装 Extension 或控制 Chrome。状态只能是
  `local acceptance contract implemented; runtime prerequisites pending`。

## 24. Phase 47 本机验收第二纵切（2026-08-21）

- **系统前置**：用户明确授权后启动 OrbStack，`docker info` 返回 Server `29.4.0`；Homebrew 安装
  `mkcert 1.4.4`。后台 `mkcert -install` 因 macOS 不允许无交互管理员授权而失败，随后
  `security verify-cert` 仍退出 1；未读取、请求或记录管理员密码；
- **安全中止**：首次 `supabase start` 仅进入官方镜像下载，审查发现 OrbStack LAN port forwarding 风险后
  立即发送 SIGINT。现场 `docker ps`、`lsof` 证明没有 Supabase 容器和 54320–54324 listener；下载缓存不
  构成服务启动证据；
- **Fresh RED**：focused 4/5，唯一失败为缺少
  `supabase/migrations/20260821000000_cloud_v1_foundation.sql`，证明旧 `schema_paths` 不能充当 runtime
  migration；
- **最小 GREEN**：新增与 `apps/api/migrations/0001-cloud-v1-foundation.sql` 字节一致的时间戳 baseline、
  漂移测试、`acceptance:local:start|status|stop` 和 loopback network 启动器；专用 network 的实测 option
  为 `127.0.0.1`，focused 8/8；
- **失败关闭**：真实 doctor 当前只报告 `local-ca`；安全启动器不会在 CA 未信任时继续启动 Supabase。
  Web/API/TLS proxy、seed/bootstrap、Store profile 和 reset 仍未实现，不能声明 local-ready；
- **外部决策**：根域固定为腾讯云 registrar 的 `seen-said.cn`，权威解析使用 Cloudflare DNS Free，邮件
  使用 Resend Free。未购买域名、未创建 Cloudflare/Resend/Supabase/Vercel 资源，未写 DNS 或 secret。

## 25. Phase 47 本机 runtime 与 HTTPS 纵切（2026-08-21）

- **系统与 TLS**：OrbStack/Docker Server `29.4.0` 运行，`mkcert 1.4.4` 的本机 root CA 已通过
  `security verify-cert`；忽略的证书只覆盖 `app.acceptance.localhost`、`api.acceptance.localhost` 与
  `supabase.acceptance.localhost`，私钥权限为 `0600`；
- **安全 runtime**：Supabase CLI `2.115.0` 在专用 Docker network 启动 11 个容器，全部 published port
  为 `127.0.0.1`；`status` 与 HTTPS `dev` 均重新读取项目容器 network/port 并失败关闭，不信任仅由启动
  命令形成的约定；
- **数据库与配置**：migration history 只有 `20260821000000 cloud_v1_foundation`；生成的本机环境文件为
  `0600` 且 ignored，无 DeepSeek key；业务 login role 无 superuser/BYPASSRLS，bootstrap 写入三条价格
  快照并保持 model kill switch 开启；
- **真实入口**：production Web/API build 通过；系统信任 TLS 下 Web 8443、API 8444、Supabase 8445 均
  返回 200，三者只监听 loopback；Chromium 打开 `/app` 得到“需要先登录”、零 page error；
- **生命周期回归与修复**：用户首次打开邀请链接时 8443 拒绝连接；Supabase 仍健康且三个 HTTPS 端口均
  无 listener，证明旧 `dev` 进程随 Codex 前台命令结束而退出，不是 DNS、证书或数据库故障。Fresh RED
  先证明缺少持久生命周期模块，并补充“存活但不健康的旧 PID 必须替换”回归；最小修复增加
  `dev|dev:status|dev:stop` 后台生命周期和诊断专用 `dev:foreground`。真实复核中服务进程 PPID 为 1，
  8443/8444/8445 均为 loopback listener，三个系统信任 HTTPS probe 返回 200；
- **TDD 与加固**：migration/runtime、bootstrap、静态路径、端口部分启动清理、容器 LAN 暴露拒绝、邀请
  token 只存 hash 和 API provider blocking 均有 focused 回归；`supabase/.temp/**` 只从 ESLint/Prettier
  精确排除，migration/config 仍在门内；
- **完整门**：首次 `pnpm verify:macos` 暴露旧 quality-gate 测试仍只允许一个 ignore，未继续误报；生命周期
  精确回归后最新 fresh 重跑退出 0：142/142 Node scripts、448 个 Vitest files（2,758 passed / 12 skipped）、
  Store coverage 97 files / 481 tests、Playwright 110/110，以及 format/lint/typecheck/build、instructions、
  architecture、development blocker、Store release、production audit 与 diff check 全绿；
- **该检查点真实边界**：`acceptance:local:invite` 已创建一个 72 小时一次性本机注册链接。用户当时尚未
  完成注册、Mailpit 确认、登录、默认 quota、核心学习流、Store acceptance、reset/增量 migration 或
  重启持久化；默认 quota 与第一条增量 migration 已由下一节关闭，其余仍 pending。该检查点只能称
  `local runtime operational; first-user journey pending`。未调用 Provider/Resend、未购买域名、未写 DNS、
  未创建托管资源、未安装 Extension 或控制用户 Chrome。

## 26. Phase 47 首账号初始化与第一条前向迁移（2026-08-21）

- **需求校准**：密码和 Google 邀请注册必须在 profile/登录方式的同一数据库事务中建立当前 UTC 月
  `source=default`、`limit_micro_usd=1000000` grant；重放不重复，已有同月 admin grant 不覆盖，未来月份
  自动续期保留为独立额度生命周期需求；
- **Fresh RED / GREEN**：新增 migration 契约首次 3/3 失败，精确证明 API/Supabase `0002` 缺失；最小 SQL
  后 3/3 通过。bootstrap export bucket 与 runtime migrate 入口同样先失败，最终 bootstrap 3/3、doctor
  5/5、runtime 7/7，script focused 共 15/15；database migration/auth focused 共 18/18；
- **安全与升级**：API canonical `0002-account-default-quota.sql` 与 Supabase 时间戳副本字节一致；helper 为
  `SECURITY DEFINER`、固定 `pg_catalog` search path，且 PUBLIC/business/context-setter/runtime 均无 execute。
  `acceptance:local:migrate` 在 pinned CLI migration-up 前后都重新审计 loopback runtime，不打印 URL、
  credential、SQL 正文或容器环境；baseline 未修改，也未 reset；
- **真实数据证据**：升级前 profile/grant/export bucket/未消费邀请为 `1/0/0/1`，升级并连续执行两次
  bootstrap 后为 `1/1/1/1`；history 同时存在 `20260821000000 cloud_v1_foundation` 与
  `20260821010000 account_default_quota`，唯一 grant 为 `default / 1000000 / 1`，bucket 为 private，HTTPS
  三入口持续健康；
- **边界**：本次没有打开或消费用户邀请、创建真实 Supabase Auth identity、调用 Provider、安装 Store、
  写 DNS、创建 Resend/Vercel/Supabase 托管资源。真实注册/Mailpit、登录、核心学习闭环、seed/reset、
  Store acceptance、重启持久化和未来月份续期仍 pending；
- **完整门与门后状态**：`pnpm verify:macos` 退出 0：145/145 Node scripts、449 个 Vitest files
  （2,761 passed / 12 skipped）、Store coverage 97 files / 481 tests、Playwright 110/110，以及 format、lint、
  typecheck、build、instructions、architecture、development blocker、Store release、production audit 与 diff
  门全绿。门后 `dev:status` 成功，app/API/Supabase HTTPS 均返回 200，数据仍为 `1/1/1/1`，两条 migration
  与 `default / 1000000 / 1` 保持不变。

## 27. Phase 47 受控 reset 与虚构 seed（2026-08-21）

- **需求与安全边界**：reset 只接受精确参数 `--confirm-local-data-loss`，只调用 pinned Supabase CLI 的
  local reset 和仓库固定 `seed.sql`；不接受 database URL、linked project、project ref 或调用者 seed。
  preflight 或 HTTPS stop 失败时数据库保持不变；stop 成功后的任一失败都停止后续阶段，不自动暴露部分
  重建环境；
- **Fresh RED / GREEN**：Fresh RED 为 3 个预期失败，分别证明 reset 模块、doctor seed 契约和 reset/seed
  artifact 缺失；最小 GREEN 后 reset/doctor/bootstrap/lifecycle/runtime focused 31/31、完整 scripts
  156/156、seed migration 4/4、database focused 19/19 通过。固定 seed 只建立虚构 Operator/profile/admin
  role/default grant，不建立 Auth user、登录方式、邀请、session、学习正文、Provider 结果或 secret；
- **真实零副作用证据**：只执行过不带确认参数的 reset 命令，固定拒绝并退出 1；执行前后
  profile/default grant/private export bucket/未消费邀请均为 `1/1/1/1`，app/API/Supabase HTTPS 均为 200，
  migration history 仍只有 `cloud_v1_foundation` 与 `account_default_quota`。未执行真实破坏性 reset，当前
  邀请仍有效且未消费；
- **门禁稳定性修复**：首次完整门在 12 逻辑核默认全仓并行下有 6 个 PGlite 文件只在 `beforeEach`
  建库处越过 10 秒；同 6 文件 32/32、API 项目 420/420 单独通过，排除 migration/业务回归。仓库测试
  入口以 Fresh RED→GREEN 固定全仓 Vitest 最多 4 workers，保留文件并行和原 10 秒超时；修复后完整
  Vitest 449/449 文件通过；
- **完整门与门后状态**：最终 `pnpm verify:macos` 退出 0，覆盖 156/156 Node scripts、449 个 Vitest files
  （2,762 passed / 12 skipped）、Store coverage 97 files / 481 tests、Playwright 110/110，以及全部
  instructions、format、lint、typecheck、architecture、build、development blocker、Store release、
  production audit 与 diff 门。门后 Supabase runtime 运行，app/API/Supabase HTTPS 均为 200，数据仍为
  `1/1/1/1`，两条 migration 未漂移；
- **剩余边界**：真实 destructive reset/rebuild 仍需用户另行明确授权；真实注册与 Mailpit 确认、登录、
  核心学习闭环、Store acceptance、跨进程重启持久化和 hosted acceptance 仍 pending。未运行 Windows、
  Provider、Chrome、安装、域名、DNS、Resend、Vercel 或托管 Supabase 操作。

## 28. Phase 47 非破坏性重启与持久化指纹（2026-08-21）

- **文档校准**：修正 `user-acceptance-environment.md` 中 seed/reset 仍缺失和 bootstrap 创建测试 Auth user
  的过期表述；真实身份继续只能由邀请注册产生，不增加测试登录后门；
- **安全设计**：`acceptance:local:restart:verify` 不接受参数，目标固定为当前 local project；PostgreSQL
  服务器内部为全部 public tables、Auth users/identities、Storage buckets/objects 和 migration history
  生成逐行 SHA-256、排序聚合指纹。Node 只解析 relation/count/digest 并常量时间比较，不输出 snapshot、
  用户字段、password hash、token、credential、SQL 错误或 digest；
- **Fresh RED / GREEN**：Fresh RED 7/7 失败；最小 GREEN 后 restart 编排/解析/命令边界 16/16、
  acceptance/lifecycle/runtime focused 57/57。测试覆盖任意参数零副作用、9 个阶段失败点、snapshot 缺失/
  重复/格式错误，以及 before/after 不一致时不恢复 HTTPS；
- **真实停启证据**：真实只读 snapshot 先通过；随后命令完整执行 runtime verify → before snapshot → HTTPS
  stop → Supabase stop/start → forward migration → runtime verify → after snapshot → equality → HTTPS start，
  退出码 0。前后显式聚合状态均为
  `1/1/1/1/0/0/0/2`（profile/default grant/private bucket/unconsumed invite/Auth user/sign-in method/
  learning item/migration），两条 migration 名称和版本不变；
- **完整门与门后状态**：`pnpm verify:macos` 退出 0，覆盖 172/172 Node scripts、449 个 Vitest files
  （2,762 passed / 12 skipped）、Store coverage 97 files / 481 tests、Playwright 110/110，以及全部
  instructions、format、lint、typecheck、architecture、build、development blocker、Store release、
  production audit 与 diff 门。门后 Supabase/HTTPS lifecycle 均健康，app/API/Supabase/Mailpit 均为 200；
- **边界**：本证据只证明注册前初始化状态、邀请和空 Auth/学习状态跨完整停启；真实账号、登录方式和
  学习数据目前仍为 0。用户完成注册、Mailpit 确认、登录并创建学习数据后必须再次运行同一命令。未运行
  destructive reset、Windows、Provider、Chrome、安装、域名、DNS、Resend、Vercel 或托管 Supabase。

## 29. Phase 47 本机验收模拟模型（2026-08-21）

- **文档与架构审查**：新增 `local-acceptance-simulated-provider.md`，将本机需求、唯一 fetch seam、零网络
  边界、strict request/response、可见环境标识、TDD 和人工验收收敛到同一来源；拒绝为四类调用各建一套
  fake 状态机、扩展 production provider enum 或隐藏模拟身份。模拟器位于 acceptance composition 的
  DeepSeek HTTP Adapter 内，production quota、durable dispatch、schema、ledger、lease/fencing 和数据库
  状态机保持原路径；技术兼容 metadata/price 不能作为真实 DeepSeek 质量、usage 或账单证据；
- **Fresh RED / GREEN**：API RED 证明模拟模块缺失并暴露 phrase trusted assembly 既有缺陷，Web RED
  证明横幅和 strict build mode 缺失，build contract RED 证明 acceptance build 未固定注入模式。最小实现后
  API focused 37/37、Web focused 17/17、build contract 1/1；API 全量 114 files / 447 tests、Web 44 files /
  201 tests、Node scripts 173/173 全绿；
- **当前工作树安全门**：`pnpm check:instructions`、`pnpm check:architecture`、`pnpm format:check`、`pnpm lint`、
  `pnpm typecheck`、`git diff --check` 均退出 0；根级 `pnpm test` 451/451 files 通过，2,792 passed /
  12 skipped，Node scripts 176/176；Store coverage 97 files / 481 tests、隔离 4173 服务上的 Playwright
  110/110 均通过；`pnpm audit:prod` 无已知漏洞。真实
  mkcert CA probe 证明当前旧 bundle 的 `/join` 与 API health 均为 200，Supabase 与 HTTPS lifecycle
  status 均健康；未打开或消费邀请；
- **半部署防护**：审查确认旧 HTTPS Web server 逐请求读取 live `dist`，build 可能形成新 Web + 旧 API。
  Fresh RED 因缺 bundle snapshot export 失败；路径复审的第二个 RED 证明 URL 预规范化会吞掉点段。最小
  GREEN 5/5 固定启动时内存快照、磁盘改写后旧字节不变、SPA fallback 同版本、缺入口失败关闭和原始
  traversal 先于 fallback 拒绝。当前旧进程尚未加载该修复，因此首次 build 仍等待空闲窗口；
- **隔离 Mac 候选门**：用户可能正在注册；为避免触碰旧 live `dist`，当前 Git 可见文件被复制到排除
  ignored secret/运行数据的系统临时候选目录；`pnpm install --offline --frozen-lockfile` 零下载，随后原样
  `pnpm verify:macos` 首次以 176/176 Node scripts 退出 0。部署协调器与双栈修复完成后，对新的精确可见
  文件候选再次离线安装，277 个包全部复用、下载 0；第二次聚合门退出 0，覆盖 187/187 Node scripts、
  451/451 Vitest files（2,792 passed / 12 skipped）、Store coverage 97 files / 481 tests、全部 workspace
  build、Playwright 110/110、development blocker、Store release、production audit 与 diff 门。门后 rsync
  checksum 仍只有目录时间/组元数据差异，零文件内容差异，候选 Git 状态干净；
- **部署协调器候选**：文档先冻结唯一命令和四阶段边界；Fresh RED 因模块/package entry 缺失失败，最小
  GREEN focused 9/9 覆盖精确确认、固定顺序、逐阶段失败、异常归一化和 package contract。真实无参数
  调用退出 1，旧 HTTPS 随后仍健康；完整 Node scripts 在后续双栈修复后为 187/187；
- **IPv6 connection-refused 根因与候选修复**：用户打开邀请时浏览器再次拒绝连接；现场证明域名解析顺序
  含 `::1`、`127.0.0.1`，旧进程只监听 IPv4，`curl -4` 为 200 而 `curl -6` 立即拒绝。Fresh RED 因双栈
  endpoint export 缺失失败，第二个 RED 复现提前清理与迟到 listen 的竞态；GREEN 7/7 固定
  8443/8444/8445 各自绑定 IPv4/IPv6 loopback，并等待全部绑定结果后统一回收失败组；没有绑定通配或
  局域网。根级 `pnpm test` 随后以 187/187 Node scripts、451/451 Vitest files、2,792 passed / 12
  skipped 退出 0；instructions、architecture、format、lint、typecheck 与 diff 门也全部退出 0。当前尚未
  deploy，所以这是候选代码证据，不是 live 修复证据；
- **双地址族 health gate**：Mac 候选门后复审发现 lifecycle 只发起一次 hostname probe，可能由 DNS 顺序
  掩盖另一地址族失效。Fresh RED 因缺双栈 probe export 失败，GREEN focused 7/7（新增 2 项）固定三个
  URL × IPv4/IPv6，任一失败整体为 false。随后第三次精确候选以零下载 offline install 重建，
  `pnpm verify:macos` 退出 0：189/189 Node scripts、451/451 Vitest files（2,792 passed / 12 skipped）、
  Store coverage 97 files / 481 tests、全部 workspace build、Playwright 110/110、development blocker、
  Store release、production audit 与 diff 全绿；checksum 零文件内容差异且候选 Git 干净。旧 IPv4-only
  进程被新 status 拒绝是未部署的准确证据，不是数据或进程已停止；
- **真实部署与首个注册缺陷证据**：用户明确授权后，
  `pnpm acceptance:local:deploy --confirm-local-downtime` 退出 0；runtime/dev status 通过，三个入口分别以
  IPv4/IPv6 返回 200，运行中 Web bundle 固定指向 `api.acceptance.localhost:8444` 并包含“本机验收 ·
  模拟模型”。邀请领取随后成功，但首次邮箱注册在 Supabase Auth 以 422 拒绝；数据库证明 claim/API 已
  到达而 Auth user 为 0，脱敏日志定位本机 `letters_digits` 超出 Cloud 12 至 256 字符契约。doctor artifact
  Fresh RED→GREEN 5/5 将本机配置固定为最小 12、空字符要求；完整 persistence restart 重跑退出 0，容器
  等效配置、现有邀请和活动 claim 均保留，HTTPS/Supabase status 恢复。用户注册重试、Mailpit 确认与核心
  模拟旅程仍待人工完成；Windows 继续按关键冻结批次执行。

## 30. Phase 47 首次真实邮箱确认回调修复（2026-08-21）

- **现场事实**：Supabase Auth 脱敏日志证明 signup 200、verify 303、PKCE token exchange 200；数据库聚合
  证明 Auth user/identity 与 profile 已建立、邀请已消费、flow 已完成，但 Web session 为 0，且邮箱账号
  错误只有 `google` method。第二次点击确认链接过期符合单次 code 语义；
- **根因**：密码注册复用了 Google callback，completion 和旧 5 参数数据库函数硬编码 `google`；完成
  profile 后，Web-session adapter 又以 context-setter 直接 UPDATE forced-RLS profile，Postgres 因无权
  执行 owner-context 函数而中止 session 创建；
- **回归与最小实现**：API RED 精确得到错误 callback path；migration RED 精确得到缺失 6 参数 completion
  与缺失 `refresh_profile_email`。实现拆分固定 password/Google callback，显式登记 method，并以只授权
  context-setter 的窄 SECURITY DEFINER 刷新规范邮箱；focused API/migration 26/26 与 API typecheck 已
  通过；
- **数据修复边界**：`0003` 只把“已完成邀请 + Supabase email identity 存在 + Google identity 不存在 +
  password method 不存在”的错误 google method 改为 password；不重置 Auth、邀请、profile、额度或学习
  数据；
- **完整门与 live 修复**：`pnpm verify:macos` 退出 0，覆盖 189/189 Node scripts、453/453 Vitest files
  （2,797 passed / 12 skipped）、Store 481/481、Playwright 110/110、全 workspace build、架构、发布和生产
  依赖审计。`acceptance:local:migrate` 随后应用第三条 migration；只读聚合为 migration 3、callback
  migration 1、confirmed Auth user 1、profile 2、password/google method 1/0、Web session 0、消费/可用邀请
  1/1，证明错误 method 已修复且账号/邀请保留；
- **部署与当前状态**：第一次同步 deploy 在启动阶段安全失败，显式 build 与前台启动诊断均健康；恢复后台
  lifecycle 后同一 deploy 命令完整重跑退出 0。最终 Web/API/Supabase 在 IPv4/IPv6 六个探测均为 200，
  新 password callback 缺参数按契约返回 400。现只待用户在 `/login` 使用原邮箱密码创建首个 Web
  session；不重复点击确认邮件。

## 31. Phase 47 首次真实模拟分析失败修复（2026-08-21）

- **现场事实**：用户登录成功后提交首个 passage；四次点击全部产生 `running` request，但
  AnalysisRecord、reservation、ledger 和 dispatch 均为 0。Postgres 在每次请求先记录
  `model unavailable`，随后记录 `permission denied for function current_owner_user_id`；
- **根因**：local bootstrap 仍把共享 `model_kill_switch` 幂等开启，阻断固定零网络模拟 Adapter；失败
  terminalization 调用 quota summary 时又以 context-setter/trusted 直接查询 forced-RLS quota 表，第二个
  权限错误覆盖正常失败收尾；
- **Fresh RED / GREEN**：bootstrap contract RED 精确观察 `true`，GREEN 固定 local-only `false`；新增
  PGlite baseline + 真实角色/owner context 的 quota RLS RED 精确复现函数权限错误，GREEN 改由 tenant
  transaction 查询。focused 为 bootstrap 4/4、API quota/analysis 16/16；
- **现场恢复**：只选择租约已过期、未 dispatch、未 reservation 的四条请求调用既有
  `abandon_analysis_request`，恢复后 `running=0`、`failed=4`；未 reset Auth、profile、Web session、邀请、
  grant 或学习数据，也没有产生外部网络和费用；
- **完整门**：`pnpm verify:macos` 退出 0，覆盖 190/190 Node scripts、454/454 Vitest files（2,798
  passed / 12 skipped）、Store 481/481、Playwright 110/110，以及全部 instructions、format、lint、
  typecheck、architecture、build、development blocker、Store release、production audit 与 diff 门；
- **bootstrap 与 live deploy**：幂等 bootstrap 后 kill switch=false，running/reservation/ledger/record 为
  0、failed=4、活动 Web session=1。首次 deploy 在后台 start health 阶段安全失败；同一构建以前台启动
  证明 IPv4/IPv6 六入口均 200，干净停止后完整 deploy 重跑退出 0。最终 runtime/dev status 与六入口均
  通过，聚合状态不变；
- **剩余边界**：只待用户新发起一次分析并继续核心模拟旅程；未运行 persistence restart、Windows、真实
  Provider、Chrome 安装或外部部署。

## 32. Phase 47 模拟候选持久化与取消等待缺陷（2026-08-21）

- **用户症状**：状态长期为 running；手动检查无可见变化；取消等待后提交禁用，编辑正文却能解锁；再次
  提交得到失败；
- **无正文现场证据**：analysis request 总数 7，其中 failed 6、running 1；唯一 running 已 dispatch 且有
  active reservation，AnalysisRecord/ledger 均为 0。数据库先拒绝 `candidate-1` 写入 UUID candidate 列，
  再拒绝 fallback failure settlement，后续两次 reserve 命中 active-generation 唯一约束；
- **确认根因**：private model candidate alias 未在 trusted module 重键；post-model commit 异常进入 catch
  后丢失已生成 usage/cost；Web cancel 清除 request ID，同时 input onChange 错误解除 cancelled/waiting
  fence；
- **Fresh RED / GREEN**：API RED 为 2 failed / 12 passed，分别证明 private alias 未重键和 commit 失败后
  billing facts 丢失；Web RED 为 2 failed / 4 passed，分别证明取消后 request fence 丢失、手动 running
  status 无可见反馈。最小实现后 API module/HTTP/segmentation 18/18、Web 6/6；HTTP 流测试改为从真实完成
  record 读取服务端 candidate ID，不再把 model alias 当公开标识；
- **安全恢复**：等待唯一 dispatched request 的 lease 到期后，仅对 expired + running + reserved +
  dispatched 行调用既有 `abandon_analysis_request`；恢复后 request `running=0`、`failed=7`，reservation
  active=0、settled=1，recovery ledger=1。未 reset Auth、profile、Web session、邀请或学习数据，也未按
  “模拟免费”提前释放不确定 dispatch；
- **完整门**：第一次全量门准确拦截旧 HTTP 测试仍提交 model alias；校准后 `pnpm verify:macos` 退出 0，
  覆盖 190/190 Node scripts、455/455 Vitest files（2,800 passed / 12 skipped）、Store 481/481、Playwright
  110/110、全部 workspace build、instructions、format、lint、typecheck、architecture、development blocker、
  Store release 与 production audit；
- **live 非破坏部署**：第一次同步 deploy 在后台 start health 阶段安全失败，Supabase 仍健康且 HTTPS 已
  停止；同一构建以前台启动并通过 IPv4/IPv6 六入口 200，干净停止后完整 deploy 重跑退出 0。最终
  runtime/dev status 与六入口均通过，request running=0、active reservation=0、active Web session=1、
  AnalysisRecord=0；账号/会话/邀请/学习数据未 reset。仅待用户刷新 `/analysis` 后单次复验。

## 33. Phase 47 真实 PostgreSQL 核心闭环与练习结算修复（2026-08-22）

- **分析现场根因**：真实 `postgres` 驱动把已 `JSON.stringify` 的 billed calls 再编码为 JSON scalar，
  `settle_quota_reservation` 因此拒绝 success/failure；PGlite 接受同一字符串而漏检。adapter RED→GREEN
  证明只解析显式 `$N::jsonb` 参数，production composition 随后留下 completed request、AnalysisRecord、
  candidate、usage ledger 与 settled reservation；
- **失败 fallback**：固定金额可能超过较小 reservation。`0004` 新增只供 context-setter 调用的
  `analysis_reservation_amount`，按 owner/request/lease/reservation 读取 active 预留；API/Supabase forward
  migration 字节一致，PUBLIC/business 无执行权；
- **真实页面继续暴露的角色缺陷**：第一次练习开始在保存 `practice.start` 幂等响应时得到
  `permission denied for table idempotency_records`；修复测试 adapter 每次恢复真实角色后，句子和对话
  两个 RED 均稳定复现。全部 owner-scoped 直接幂等写入改走 tenant，begin/replay 仍走 trusted function；
- **练习终态结算**：第二次 RED 精确得到 context-setter 无权更新 `practice_generation_tasks`。`0005`
  新增 `settle_practice_generation_quota`，tenant 先更新 task，trusted function 再校验 owner、终态、
  reservation、价格和调用事实后原子写 ledger/settle quota；过期 dispatched 任务按同一路径保守结算。
  baseline 和 forward 的 API/Supabase 副本一致，function 仅 context-setter 可执行；
- **Fresh GREEN**：真实角色的 sentence/dialogue 两条完整 repository 旅程通过；migration/privilege 2/2，
  受影响的学习库、删除、历史、StudyCapture、单词与外部词典共 8 files / 23 tests 全绿；API typecheck
  通过；
- **实际浏览器闭环**：Codex 使用本机一次性邀请和虚构邮箱账号，完成 Mailpit 确认、密码登录、passage
  分析、候选确认、学习库回读、句子题目、答案反馈、“掌握”自评和练习历史回读。所有页面持续显示
  “本机验收 · 模拟模型”，没有第三方模型网络或费用；
- **最终无正文聚合**：completed analysis 1、running analysis 0、AnalysisRecord 1、LearningItem 1、
  completed practice 1、open practice task 0、active reservation 0；未 reset 用户既有账号或学习数据。
  本节取代第 32 节的 `one user replay pending`，核心本机纵切已由 Codex 实际完成；Windows 仍按下一个
  关键冻结批次统一验证。
- **生命周期竞态与实际恢复**：完整门的普通 Web build 后切回 acceptance build 时，旧未登记前台进程
  继续响应六入口，新 detached child 因端口冲突退出；旧 start 只看 endpoint 而错误记录已退出 PID。
  Fresh RED 精确覆盖“endpoint 由其他进程响应、child 在稳定窗口退出”，GREEN focused 8/8；health 现在
  首次成功后等待并再次确认 child 与六入口。精确停止旧进程后，持久 start/status 均退出 0；真实浏览器
  刷新 `/practice/history` 后登录仍有效且完成记录 1 可见；
- **最终完整门**：`pnpm verify:macos` 退出 0，覆盖 190/190 Node scripts、460/460 Vitest files（2,808
  passed / 12 skipped）、Store 481/481、Playwright 110/110，以及全部 instructions、format、lint、
  typecheck、architecture、workspace build、development blocker、Store release 与 production audit。
  门后重新构建 acceptance bundle 并启动持久 HTTPS；最终聚合仍为 completed/running analysis `1/0`、
  record/learning/completed practice `1/1/1`、open task/active reservation `0/0`，usage ledger 7。
- **门后 stop 语义校准**：最终切回 acceptance bundle 时，真实 stop 在强制信号发出后进程稍晚退出，旧
  实现瞬时检查而误报失败。补充 Fresh RED 后，lifecycle focused 9/9 固定强制信号后的第二段有界等待；
  这项门后窄脚本修复再经 Prettier、ESLint、`git diff --check` 和真实 stop→start→dev/runtime status
  验证。浏览器再次刷新仍位于 `/practice/history`，验收横幅与完成记录 1 均可见。

## 34. Phase 47 本机实际功能扩展验收与数据导出修复（2026-08-22）

- **持久化与自然使用**：在首账号和学习数据存在后执行完整非破坏性 Supabase/HTTPS 重启，服务器指纹、
  登录会话和学习数据均保持；随后实际完成第二个表达、3 轮对话练习、逐项反馈、自评和历史详情回读；
- **学习与历史页面**：实际验证分析历史归档、归档筛选和恢复；修复详情页递归展示 UUID、revision、prompt
  与 schema 等开发字段的问题，改为按结果类型展示学习语义。学习库实际完成编辑并还原、归档并恢复、
  重复建议及含练习历史项目的合并阻断；单词库实际完成新建、编辑和删除临时词条；
- **真实 CORS 缺口**：学习项编辑首次因预检未允许 `PATCH` 失败；外部词表下载首次因浏览器读不到
  `Content-Disposition` 失败。API 现在显式允许 `PATCH` 并暴露下载文件名 header，两项均先由契约 RED
  固定后部署，并在实际页面重试通过；
- **账号与外部词典**：偏好页实际修改每日目标和自动收藏后保存并回读，再恢复原值；外部词典实际下载空
  互操作词表、完成 0 词 Eudic 导出任务，并创建后取消 Eudic 导入任务。设备页在无 Store Extension 时
  正确显示零设备，真实配对/撤销保留到经单独批准的 Chrome 验收；
- **账号数据导出根因与安全修复**：实际 worker 首次得到 `export-build-failed`，稳定根因是 business 路径
  无权调用私有 AnalysisRecord serializer。没有向业务角色开放原始函数；新增只授权 context-setter 的
  owner wrapper，同时校验显式 owner 与当前 owner context。真实回归又捕获直接给原始 serializer 授权会
  破坏分析 mutation，最终 `0007` 收回该授权并恢复内部函数边界；baseline、`0006/0007` 与 Supabase
  镜像均由 doctor 字节审计；
- **导出投影修复与真实产物**：Postgres `bigint` 的 `byte_length` 以字符串返回，旧投影错误拒绝 ready
  记录。新投影只接受非负安全十进制并转为 number，恶意/越界值 fail closed。worker 重跑后页面进入
  可下载状态；因最近认证窗口已过，本机只对当前验收账号更新 `reauthenticated_at`，没有读取或重置密码。
  一次性签名下载实际返回 200、7,939 bytes、9 条记录；类型含 manifest、偏好、登录方式、analysis、
  3 条 learning-item 和 2 条 practice-session，扫描未发现 authority、token、secret、session 等禁出字段；
- **额外分析与终态审计**：实际完成 phrase `follow up on` 分析并选择“无需收藏”；修复 owner wrapper
  后重新验证该 mutation 成功。最终只读聚合中 running analysis、active reservation、open practice、
  open duplicate、open wordbook job、open export、pending review 和 open practice session 全部为 0；
- **完整门**：最终 `pnpm verify:macos` 退出 0，覆盖 192/192 Node scripts、完整 workspace Vitest、Store
  481/481、Playwright 110/110、instructions、format、lint、typecheck、architecture、build、development
  blocker、Store release 与 production dependency audit；生产依赖无已知高危漏洞；
- **后续关闭**：本节当时保留的永久账号删除和服务端配对/撤销缺口已由第 35 节的一次性账号实测关闭；
  真实 Store Chrome vault/安装、Provider、Google、外部 Eudic/Shanbay 凭据、hosted Supabase/Vercel、
  域名/DNS/Resend、发布和最新 Windows 候选批次仍需各自的外部环境或单独批准。

## 35. Phase 47 身份、管理、删除与服务端配对实际验收（2026-08-22）

- **永久账号删除**：一次性账号实际完成注册确认、登录、账号数据导出（3 records、Storage 对象增量 1）
  和永久删除；worker 完成后 Auth identity/user、ExtensionSession、profile、登录方式、Web session 均为 0，
  Storage 对象回到原计数，完成 receipt 只增加 1；主验收账号未触碰；
- **密码恢复与防枚举**：另一一次性账号实际完成找回请求、worker 发信、Mailpit 链接、Supabase verify、
  惰性确认页、callback、purpose Cookie/CSRF 和新密码提交。旧 Web session 与旧密码均被拒绝，新密码登录
  成功；清理后 Auth/profile/session 为 0。随机不存在邮箱另行实测公开响应 202、worker `idle`、Mailpit
  增量 0；
- **服务端配对缺陷与修复**：首次 create→approve 后 exchange 400，但 pairing 已 consumed 且 session 已
  创建。根因是数据库函数提交后 adapter 又以无 owner context 的 trusted 事务读取 forced-RLS profile。
  `0008` 改为同一 SECURITY DEFINER statement 原子消费、创建 session 并返回偏好快照；profile 不可用时
  整体回滚，不扩大 PUBLIC/business grant；
- **配对实际重跑**：全新一次性账号完成 pending→approved→单次 exchange→偏好回读→设备列表→撤销，
  撤销 token 返回 401；先前幽灵 session、诊断 pairing 和全部临时账号精确清理，active ExtensionSession
  为 0；
- **管理与 data-rights**：实际 operator 账号完成用户列表、usage、邀请创建/撤销、额度调整、设备撤销、
  用户停用/启用和模型 kill switch 开/关；审计包含七类动作。停用用户的旧 session 与完整账号 API 被
  拒绝，登录降级为 `data-rights` 且仍可读取导出状态；启用后新登录恢复 full。最终 kill switch=false，
  operator/learner Auth、profile、role 均清理为 0；
- **学习与历史永久删除**：无练习引用的表达实际 DELETE 为 `hard-delete`；有已完成句子练习的表达先归档
  后 DELETE 为 `erased`，学习详情 404、练习历史保留且标签清空并标记 learning item deleted；随后删除
  练习历史，详情 404，未引用 tombstone 为 0；
- **重新认证与退出**：一次性密码账号实际回读唯一 sign-in method，密码 reauth 旋转 session，旧 session
  被拒绝；logout 清 Cookie 且 session 失效，再次密码登录成功。账号随后通过正常 deletion worker 清理；
- **完整门与部署**：最终 `pnpm verify:macos` 退出 0，覆盖 192/192 Node scripts、462/462 Vitest files
  （2,812 passed / 12 skipped）、Store 481/481、Playwright 110/110，以及全部 instructions、format、
  lint、typecheck、architecture、workspace build、development blocker、Store release、production audit
  与 diff 门；生产依赖无已知漏洞。随后 `acceptance:local:deploy --confirm-local-downtime`、runtime/dev
  status 和 doctor 均退出 0；
- **最终清理与只读聚合**：额外发现一个早期 Codex 空账号，仅在确认 learning/analysis/practice 均为 0 后
  通过正常登录→永久删除→worker 清理；最终 migration 为 8 条且最新 `20260821070000`，空 Codex profile
  0、停用/删除中 profile 0、active ExtensionSession 0、诊断 pairing 0、kill switch=false。running
  analysis、active reservation、open practice/task/duplicate/wordbook/export、pending review 和未引用
  tombstone 全部为 0；承载验收数据的账号仍有 LearningItem 3、AnalysisRecord 2、PracticeSession 2；
- **最终浏览器复核**：已登录实际 bundle 的 `/app` 与 `/settings/data` 均返回标题“语见 · Seen & Said”，
  持续显示“本机验收 · 模拟模型”；导出状态仍为“可以下载”，主验收会话和数据未因临时账号清理受损；
- **验证边界**：以上全部使用本机 production Web/API/Postgres/Auth/Storage/Mailpit 与一次性账号，不调用
  Google、真实 Provider、外部词典、Resend 或托管服务。真实 Store Chrome vault/安装与 Windows 手工
  验证仍在下一关键冻结批次。

## 36. Phase 47 Store 服务端全旅程与注销回执修复（2026-08-22）

- **实际服务端全旅程**：使用 production HTTPS/API/Postgres/Auth/Mailpit、本机模拟 Provider 和一个
  一次性账号完成邮箱确认、ExtensionQuery 完成与幂等重放、StudyCapture 创建/重放/existing、metadata
  patch、created-only undo、分析与重新分析、已分析 Capture 删除拒绝、CloudWordCopy 两词一上下文、
  设备自断开及永久账号删除。删除 worker 后该一次性账号的 profile、Auth user、活动 Extension/Web
  session、running query/analysis 均为 0；没有手工级联删除；
- **bodyless DELETE 根因与修复**：本机 Node HTTPS adapter 原先为没有正文的 DELETE 仍创建 ReadableStream，
  与 Fetch Request 契约冲突。Fresh RED 固定 bodyless DELETE 必须传 `body=null`；实现只在正数
  `Content-Length` 或存在 `Transfer-Encoding` 时创建 stream。真实自断开重跑为首次 204、同 proof 重放
  204、旧 token 401，设备列表由 1 变 0；
- **注销回执权限根因与修复**：账号删除首次请求成功，但同幂等键重放由 context-setter 直接读取
  `account_deletion_jobs`，生产角色没有表级 SELECT；原 PGlite adapter 以 superuser 运行而掩盖缺陷。测试
  校准为 `SET LOCAL ROLE huayi_context_setter` 后取得 `permission denied` RED；`0009` 新增只授权
  context-setter 的 `replay_account_deletion` SECURITY DEFINER，按 owner/key/request/session hash 返回未过期
  receipt，不向 PUBLIC/business 开表权限。投影同时把 SQL 标量 NULL 当未命中处理，不再对 NULL 调用
  `toISOString()`；API 与 Supabase baseline/forward migration 保持字节一致；
- **Fresh GREEN 与迁移**：账号删除/迁移 focused 10/10、local dev/doctor scripts 13/13、API typecheck、目标
  format/lint 均通过；`20260821080000_account_deletion_replay` 已前向应用，该检查点共 9 条 migration；
- **完整门**：`pnpm verify:macos` 退出 0，覆盖 193/193 Node scripts、463/463 Vitest files（2,814 passed /
  12 skipped）、Store 481/481、Playwright 110/110，以及 instructions、format、lint、typecheck、architecture、
  workspace build、development blocker、Store release 和 production dependency audit；无已知生产依赖漏洞；
- **最终运行态**：部署后 runtime/dev status 与 doctor 均退出 0；全局保留固定 Operator seed、一个含验收
  数据的用户账号和一个用户已注册但无学习数据的邮箱账号，后者仍有活动会话，因而没有当成脚本临时
  账号删除。主数据仍为 LearningItem 3、AnalysisRecord 2、PracticeSession 2；running query/analysis、
  active reservation、open practice/duplicate/wordbook/export、未完成 deletion、待审批 pairing 与 kill
  switch 全部为 0；
- **验证边界**：本节证明 Store 所依赖的服务器契约与持久状态，不冒充真实 Chrome Extension UI、vault、
  离线 outbox、安装/升级或普通网页/YouTube 手工旅程。Google、真实 Provider、外部词典凭据、Resend、
  hosted Supabase/Vercel、域名/DNS、发布和最新 Windows 候选批次仍是外部门禁。

## 37. Phase 47 隔离空库、迁移链与 destructive reset（2026-08-22）

- **隔离拓扑**：为避免触碰主验收数据，在系统临时目录创建独立 Supabase project、loopback network、
  容器、3 个 volume 和 `5532x`/`854x` 端口副本。使用 frozen lockfile 执行 offline install，结果为
  277 packages reused、0 downloaded；开始前没有容器、volume 或 workspace `dist`；
- **空库迁移链缺陷与修复**：首次真实 Supabase start 在应用 `0009` 时以
  `function "replay_account_deletion" already exists` 失败。根因是 current baseline 已包含该函数，而
  forward migration 仍使用普通 `CREATE FUNCTION`；旧单迁移测试又先删除函数，掩盖 fresh chain。
  新增 baseline→`0002`–`0009` 全链回归，并把 API/Supabase 两份 `0009` 同步改为
  `CREATE OR REPLACE FUNCTION`；3 个 migration test files、8/8 通过，两份 migration 字节一致；
- **clean build 缺陷与修复**：实际删除全部 workspace `dist` 后，旧 acceptance builder 只构建 API/Web，
  Web 无法解析 `@huayi/cloud-contracts`。Node RED 固定自包含顺序，builder 改为
  learning-domain→cloud-contracts→API→Web；2/2 focused tests 和真实无 dist build 均通过；
- **实际 reset**：隔离环境完成 start、doctor、bootstrap、build、HTTPS dev/status，并写入固定虚构 profile、
  邀请和学习项。reset 前 migration 9、profile 2、admin 1、邀请 1、学习项 1、价格 3、bucket 1；执行
  `acceptance:local:reset --confirm-local-data-loss` 后 migration 仍为 9 且最新
  `20260821080000`，固定 Operator/profile/admin/default grant、价格 3、bucket 1 恢复，邀请、学习、分析、
  练习、Auth user、running 和 kill switch 均为 0；
- **生命周期与清理**：reset 后 dev/status/doctor 再次通过，随后 dev stop 和 Supabase stop 均成功，停止态
  status 按契约返回非零。临时容器、3 个 volume、network 和目录已删除，只包含固定虚构数据且不可恢复；
- **主环境保护**：隔离演练后主项目仍为 migration 9、profile/Auth `3/2`、LearningItem/AnalysisRecord/
  PracticeSession `3/2/2`，active ExtensionSession、running analysis、kill switch 均为 0；runtime/dev status
  与 doctor 均通过，未执行主项目 reset；
- **验证门**：focused reset/runtime/doctor/build Node tests 25/25、migration tests 8/8 通过；最终
  `pnpm verify:macos` 退出 0，覆盖 194/194 Node scripts、464 个 Vitest files（2,816 passed / 12 skipped）、
  Store 481/481、Playwright 110/110，以及 instructions、format、lint、typecheck、architecture、workspace
  build、development blocker、Store release 和 production dependency audit；无已知生产依赖漏洞；
- **验证边界**：本节关闭本机 from-empty rebuild 与 destructive reset 缺口，但不冒充 hosted rollback、
  真实 Chrome/Store vault/outbox、Google、真实 Provider、外部词典、Resend、域名/DNS、生产发布或 Windows
  冻结批次。

## 38. Phase 48 完成度复审、时间边界加固与取消重试（2026-08-22）

- **复审发现**：production 源码对照当前需求后确认三个此前漏报的本机缺口：默认 1 美元 grant 只在
  注册时建立、下一个 UTC 月会耗尽；真实 Postgres reserve path 未实现 60 次/小时与 300 次/日；R3-C
  outbox 只有 pending/sending/sent 且无限 retry。AccountDataExport 的 24 小时到期实现存在，但缺对象
  删除和 Storage 失败的直接回归；
- **额度与限速 RED/GREEN**：Fresh RED 为 3 files / 11 tests / 5 failures；`0010` 最小实现 current-month
  default、forced-RLS `model_rate_limit_events` 和滚动 60/300 限速。管理员当月 grant 不被覆盖、同 request
  replay 不重复计数、quota/rate-limit 映射保持独立；最终 focused 4 files / 12 tests 与 RLS matrix 通过；
- **R3-C RED/GREEN**：Fresh RED 为 contracts 1 failure、API 8 assertion failures + 2 missing suites；
  `0011` 固定 23 小时 deadline、最多 8 次、failed/dead-letter、sender 前最多 100 条终态化、超窗零外调、
  同 notification ID 窗口内重放、Resend 固定 HTTPS/模板/20s、无正文 reason/count alert、独立 bearer route
  与第 5 个 Supabase CRON。focused contracts 6/6、API 12 files / 34 tests、contracts full 64/64、API full
  132 files / 493 tests 通过；本机固定 `disabled-local-acceptance`，全局 fetch 为 0；
- **导出清理证据**：worker 新增到期对象先删 Storage 再清 key，以及 Storage 失败保持可重试；PGlite
  真实 ready export 到期回归证明 object key 只在删除成功后清空。focused worker 4/4、Postgres 5/5；
- **取消重试 Fresh RED/GREEN**：新增“不编辑输入也能在取消后再次分析”回归首次得到 submit disabled
  `true` 的精确 RED。根因是 UI 把 `cancelled` 永久列入 disabled；最小 GREEN 只移除该条件，running/
  waiting 仍禁止重复，AbortSignal 与 generation fence 继续抑制迟到事件。Web focused 7/7；
- **主环境迁移与真实浏览器**：先 bootstrap 写入显式 local-disabled mode，再无 reset 应用 `0010/0011`
  并两次受控 deploy。status、dev status、doctor 均退出 0；只读聚合为 migration 11、最新
  `20260822020000`、profile 3、learning 3、practice 2、running analysis/active reservation/pending or failed
  notification 全为 0。实际登录浏览器先后完成新分析，部署后结果明确进入待收藏；本机模拟 Provider
  在取消按钮可操作前已经完成，因此人工取消不冒充通过，取消竞态以可控延迟回归证明；
- **Fresh F5**：`pnpm test` 为 194/194 Node scripts、470 个 Vitest files（2,841 passed / 12 skipped）；
  migration/通知/额度/导出/发布材料 root focused 为 19 files / 69 tests。完整 `pnpm verify:macos` 还覆盖
  format、lint、typecheck、architecture、workspace build、Store 481/481、Playwright 110/110、development
  blocker、Store release、production dependency audit 与 diff；无真实 Provider、Resend 或第三方网络调用；
- **剩余门禁**：对话中曾粘贴的 Resend key 必须撤销，不能用于部署；新 key 只能进入 secret store。真实
  DNS/verified sender/投递/监控接收方、hosted Supabase/Vercel、Google/DeepSeek/词典、真实 Chrome/
  Dashboard、Windows 最新冻结批次、隐私运营事实、多日自然使用与最终签字仍未由本节替代。

## 39. Phase 49 Hosted acceptance 精确 origin 失败关闭（2026-08-22）

- **审查发现**：hosted 拓扑文档要求固定 HTTPS Web/API/Supabase origin，但 API 与 Web schema 仍使用
  通用 URL；错误值可在启动时通过，之后才表现为 Cookie、CORS、callback 或路由故障；
- **Fresh RED/GREEN**：API/Web focused 首次均各失败 1 个；最小 schema 修复拒绝 HTTP、凭据、路径、
  query、fragment、尾随 `/`，并拒绝 API=Web。固定本机验收 origin 和模拟模式保持通过，最终 6/6；
- **完整门**：`pnpm verify:macos` 退出 0，覆盖 194/194 Node scripts、470/470 Vitest files
  （2,843 passed / 12 skipped）、Store 481/481、Playwright 110/110，以及 instructions、format、lint、
  typecheck、architecture、workspace build、development blocker、Store release 和 production dependency
  audit；无真实服务或第三方网络调用；
- **本机同步**：门后受控 acceptance deploy 退出 0，只 cutover Web/API，不停止/reset Supabase；runtime、
  HTTPS status 与 doctor 再次全部通过；
- **边界与下一门**：静态失败关闭不证明托管 TLS、Cookie/CSRF/SSE、OAuth 或 Dashboard 配置。仓库内
  预部署审查后，下一项必须由用户先购买并实名 `seen-said.cn`；域名所有权确认后才继续 Cloudflare DNS
  zone、独立 Supabase/Vercel acceptance 资源和 Resend 配置。

## 40. Phase 50 域名所有权与 Cloudflare 权威委派（2026-08-22）

- **用户事实**：用户确认 `seen-said.cn` 已在腾讯云购买并实名；不在仓库记录注册人、邮箱或控制台
  secret；
- **公开只读证据**：CNNIC WHOIS 与 `.cn` 父区指向 `kim.ns.cloudflare.com` /
  `malcolm.ns.cloudflare.com`；Cloudflare DoH 与 Google DoH 交叉返回相同 NS，Cloudflare SOA 可回答；
- **DNSSEC**：父区无该域 DS，WHOIS 为 unsigned；当前不存在旧 DS 冲突。未来启用必须先由 Cloudflare
  生成 DS，再回填腾讯云，不能反序；
- **记录边界**：`app.acceptance.seen-said.cn` 的两家 DoH 均返回 NXDOMAIN，说明尚未写入 Vercel
  记录；本机网络的 `198.19.0.0/16` 映射被明确排除为证据；
- **结论**：域名购买、实名与 Cloudflare 权威委派通过；下一门为独立 Supabase Free acceptance project。
  DNS Active 不证明 Vercel、TLS、Resend、应用或生产就绪。
- **Supabase 资源纠错**：首次项目因用户在新页面提交默认表单而误建在 `us-east-1`；删除前已核验无用户、
  Storage bucket、migration 或 backup，用户明确确认后永久删除 project ref `wyvehjwcdjmgupldykuv`；
- **正确项目**：Free 组织 `Seen & Said` 下创建 `seen-and-said-acceptance`，project ref
  `kpadiulxkgckskcfydry`，URL `https://kpadiulxkgckskcfydry.supabase.co`，Primary Database 实测为
  `ap-southeast-1 / Southeast Asia (Singapore)`；Data API 创建后仍关闭，自动 RLS 未启用；
- **可用性证据与边界**：首页状态卡最终为 `Healthy`；Connect 已启用，Auth 返回 0 用户，Database 返回
  `public` schema 无表，HTTPS gateway 对无 key 请求按预期拒绝。Dashboard transaction pooler 指向
  Singapore shared pooler / 6543；故意错误测试密码得到预期认证失败，只证明路径可达。尚未使用真实密码，
  也未应用 migration、bootstrap、Storage bucket 或 secret，未创建 Vercel/Resend 资源；
- **远端 migration dry-run**：用户在本机终端以进程级 `PGPASSWORD` 执行
  `supabase db push --dry-run --skip-vault`，成功列出全部 11 条 canonical migration 且无额外项。密码未
  进入聊天、仓库、参数或输出；dry-run 未改库；
- **实际 push 前复核**：聚焦迁移/RLS 首次并行得到 7 个统一 5 秒 PGlite 超时，字节一致性与其余行为无
  失败；单 worker、20 秒上限重跑为 11 files / 37 tests 全绿，local doctor 5/5；
- **实际 push 与只读验收**：用户明确确认后以进程级 `PGPASSWORD` 执行
  `supabase db push --yes --skip-vault`。Dashboard migration history 精确显示全部 11 条记录，最新为
  `20260822020000_security_notification_delivery`；Schema Visualizer 出现业务表，Roles 出现
  `huayi_business`、`huayi_context_setter`、`huayi_runtime`，Policies 显示 tenant owner RLS 且 Data API
  Disabled。首页仍为 `Healthy`；Auth 明确为空，Storage 仍无 bucket；
- **Phase 50 当时边界**：migration 已关闭，bootstrap 尚未执行。`acceptance:local:bootstrap` 会关闭 kill switch，
  `supabase/seed.sql` 会创建固定虚构 Operator，二者均不得用于 hosted。下一步先实现默认
  `model_kill_switch=true`、无虚构 identity 的 hosted bootstrap，再单独申请远程写入确认。
- **Hosted foundation Fresh RED/GREEN**：首个 Node test 因 hosted bootstrap 模块不存在按预期失败；最小
  实现新增固定 Singapore project/pooler、三条 acceptance 价格 UUID、无副作用 `--plan`、精确确认 apply
  与只读 verify。focused 为 7/7，其中真实 package `--plan` 证明零联网退出 0；SQL 在单事务内验证
  migration/schema/forced RLS/角色/空 identity，既有
  role 不旋转密码，kill switch 保持 true，bucket/价格冲突失败关闭；
- **Foundation 完整门**：`pnpm verify:macos` 原样退出 0，覆盖 201/201 Node scripts、470/470 Vitest
  files（2,843 passed / 12 skipped）、Store coverage 481/481、Playwright 110/110、全部 workspace build、
  development blocker、Store release 和 production dependency audit；随后单独 fresh 重跑 Node scripts
  仍为 201/201。该门只使用离线/模拟 authority，未执行 hosted foundation 或访问第三方 Provider；
- **Operator 边界**：foundation 不创建 Auth/profile/admin/invitation。现有首张邀请要求既有 Operator，
  当时 deployment bootstrap authority、正常注册与真实账号晋升协议尚未冻结；不得以虚构 seed 或公开后门
  绕过。该条是 Phase 50 写入前快照；实际 foundation apply 与 hardened pending 状态见 Phase 51。

## 41. Phase 51 Hosted foundation 写入与 hardened verification 加固（2026-08-22）

- **远端写入事实**：用户以进程级管理员密码和新 application 数据库密码运行受确认 bootstrap，终端返回
  `Hosted acceptance foundation bootstrap completed.`；紧随的初版管理员 verify 返回 passed。之后使用
  application role 密码连接 transaction pooler，初版 application login verify 也返回 passed。密码、DSN
  密码部分和 SQL 错误均未进入仓库或文档；
- **初版证据边界**：初版结果证明 foundation 写入与 application 登录路径可用，但不能关闭安全门。只设置
  `sslmode=require` 不验证 CA/hostname；membership 包含判断不能排除额外边或 ADMIN OPTION；rollback 内
  读取 context 不能证明 transaction pooler 在 COMMIT 后不会把 owner 泄漏给下一事务。因此两条 passed
  被记录为 superseded preliminary evidence；
- **Fresh RED/GREEN**：安全加固前 Node hosted tests 精确失败 2 条；API runtime/environment 新回归先因
  TLS CA/verify-full 支持缺失失败。最小实现把 CLI 与 runtime 固定到显式 Supabase CA + verify-full，校验
  6543 pooler 与 API project ref 一致；bootstrap 支持 pristine/精确已应用 bucket 两种幂等前态，并验证
  exact membership、价格时间、唯一 control/bucket/object；application verify 增加 TLS、权限、越权
  SQLSTATE `42501` + exit `3` 与同 backend 两事务隔离。另补 PGlite COMMIT 后 context 为 NULL 回归；
- **当前自动证据**：API environment/runtime/production 与 migration integration 聚焦回归通过，hosted Node
  scripts 8/8 通过；其中实际 database integration 已证明 owner context 在前一事务提交后不会保留。首次
  完整门仅因一个旧本机 DSN fixture 与新固定角色/端口不一致失败，fixture 对齐后相关 2 files / 3 tests
  通过；fresh `pnpm verify:macos` 最终覆盖 202/202 Node scripts、472/472 Vitest files（2,847 passed /
  12 skipped）、Store coverage 481/481、Playwright 110/110、全 workspace build、architecture、development
  blocker、Store release 与 production dependency audit（无已知漏洞），原样退出 0；
- **远端结果与后续更正**：用户随后运行顺序式 `set -e` 命令并到达
  `Hosted acceptance application login verification passed.`；这证明当时前置 admin 查询与 application
  TLS/最小权限/事务隔离路径均可运行。0012 实际 push 后，管理员 verify 再次失败；只读 diagnostic 的
  migration/schema/RLS/价格/Storage/Auth/identity/0012 predicates 全为真，仅旧版
  `membership_edges_exact` 与 `membership_options_exact` 为假。调查确认旧 SQL 错把 PostgreSQL 17
  `NOINHERIT` 产品边要求为 `inherit=true`，又以固定 incident 总数拒绝合法 creator-control 边；因此此前
  `hardened remote verification passed` 一度降级为修复前历史证据。未重跑 bootstrap，也没有据此修改远端
  角色图；共享契约修复后的正式只读通过证据见第 44 节。

## 42. Phase 52 首位 Operator 两阶段部署引导（2026-08-22）

- **领域与取舍**：`CONTEXT.md` 新增 DeploymentBootstrapAuthority、FirstOperatorBootstrap 与
  BootstrapInvitation；ADR-0023 选择两阶段、无公开 endpoint 的部署引导，部署管理员不伪装成 Operator
  audit actor；
- **权威文档**：新增 `first-operator-bootstrap.md`，并同步 product/architecture/data-model/api/security/
  testing/operations/implementation-plan/change-log。协议固定正常邀请/Auth/profile/method/default quota，
  complete 不接受 userId/email，丢失 token 仅可在零 claim/零 identity 时 replace；
- **文档门**：上述文件经 Prettier targeted check 全部通过，并全局检索旧 pending/actor 口径后同步当前
  状态；文档自审发现私有 operator UUID 外键会阻断账号删除，最终改为删除时清除 UUID、记录删除时间且
  永不重新开放 bootstrap；
- **离线实现**：baseline 与新的 `0012-first-operator-bootstrap.sql`/Supabase timestamp mirror 已加入邀请
  issuer 约束、私有 singleton、issue/replace/complete 三条 project-admin-only function 和账号删除清理
  trigger。CLI 固定 project/pooler/CA/verify-full，只接受明确确认参数；complete 不接受 userId/email；
- **Fresh RED/GREEN**：数据库协议 8/8、CLI 5/5、hosted/local scripts 18/18、既有认证/管理/migration
  38/38、账号删除 15/15 通过；迁移镜像字节一致，known secret/token scan 与 `git diff --check` 通过；
- **完整门**：fresh `pnpm verify:macos` 原样退出 0，覆盖 207/207 Node scripts、473/473 Vitest files
  （2,855 passed / 12 skipped）、Store coverage 481/481、Playwright 110/110、全部 workspace build、
  architecture、development blocker、Store release 和 production dependency audit（无已知漏洞）；
- **远端 0012 与证据边界**：第 12 条 migration 已按 dry-run、明确确认和 actual push 的顺序完成；后续
  diagnostic 证明完整 12 条 chain、0012 columns/constraint/functions/trigger 与空 first Operator record；
  用户随后又实际运行修正版 foundation verify 与固定 Operator status，分别返回 passed 和 `empty`。
  Vercel API/Web/Auth 配置、邀请发行、真实注册、complete 和 `/admin` 浏览器验收仍未完成。

## 43. Phase 53 Hosted application deployment contract（2026-08-22）

- **Docs-first 与审查**：新增 `hosted-application-deployment.md`，固定两 Vercel project/root、Hono/Vite、
  Singapore API Function、production-only environment、五条 Auth redirect、分离 Resend key、DNS/部署/五项
  CRON/FirstOperatorBootstrap 顺序；全局校准旧 R3-C/四项 CRON/hardened pending 口径；
- **Fresh RED/GREEN**：API config 因缺 Hono/Singapore 精确失败 1 条；Web 因缺 Vite/build/dist、Hosted
  environment/identity 及公网误开 simulated 失败 3 tests + 1 missing suite；deployment Node 因模块缺失失败。
  GREEN focused 为 API 1 file / 5 tests、Web 5 files / 15 tests、Node 4/4；
- **部署深模块**：`acceptance:hosted:deployment --plan` 零网络/零写入，只列 project、变量名、五条 redirect、
  SMTP/DNS/CRON/邀请顺序；`--verify-environment` 直接复用 production API schema，再固定 project/origin/
  application role/价格/bucket/Store 非占位，成功或失败均只输出固定文案；
- **Web 与 Vercel**：API `vercel.json` 固定 `framework=hono`、`regions=[sin1]` 并保留 Fluid/120 秒；Web
  固定 Vite/build/dist/SPA。Hosted Web 只接受 exact acceptance API origin、`hosted-acceptance`、40 位
  Vercel commit 且无 simulated，持续显示 short SHA 并保留完整 SHA DOM 证据；
- **实际构建与全量证据**：合成 Hosted Web build 的身份与 server-secret marker scan 通过；当前 Vercel
  schema 识别固定字段。API full 136 files / 506、Web full 45/45 / 208、Node 211/211 通过。最终
  `pnpm verify:macos` 退出 0：211/211 Node scripts、474/474 Vitest files（2,859 passed / 12 skipped）、
  Store 481/481、Playwright 110/110、全部 format/lint/typecheck/build/architecture/release/audit 门全绿；
- **远端 0012 dry-run、授权与 actual push**：用户以进程级 `PGPASSWORD` 执行
  `supabase db push --dry-run --skip-vault`，结果只列出
  `20260822030000_first_operator_bootstrap.sql` 并正常结束，未改库；随后明确确认先提交并推送当前候选，
  再实际推送这一条 migration。候选已提交推送，0012 随后已实际应用；
- **证据边界**：自适应路由的只读部署审查以 `full-checks` 记录 passed；没有创建 Vercel project、DNS、
  Auth/SMTP/secret 或 deployment，也没有调用 DeepSeek/Resend。0012 后的 diagnostic 暴露 PostgreSQL 17
  membership verifier 误判；共享契约修复后，用户已运行正式只读 foundation verify 与固定 Operator
  status，分别得到 passed 和 `empty`。数据库 foundation 门已关闭，但 Vercel/DNS/Auth/SMTP/secret/
  deployment 与邀请门仍关闭。此前部署候选范围审计仍作为提交前历史证据保留，不替代当前修复 diff 的复核；

## 44. PostgreSQL 17 hosted membership verifier 更正（2026-08-22）

- **根因**：旧版 bootstrap/admin verify/diagnostic 同时假设三条产品 membership 为
  `admin=false / inherit=true / set=true`，并要求所有涉及四个 Huayi role 的 catalog row 总数恰好为三。
  PostgreSQL 17 对 `NOINHERIT` 成员默认形成 `inherit=false` 的 grant；CREATEROLE creator 还可能拥有
  `postgres`→新角色的 `admin=true / inherit=false / set=false` 控制边，因此远端安全状态被错误拒绝；
- **RED 与最小修复**：新增回归先因共享 membership 模块缺失而 Fresh RED；实现按角色对要求三条产品边
  各自唯一 `false/false/true`，只允许存在的 `postgres` creator-control `true/false/false`，并禁止其他
  相关直接边。不同 grantor 的重复产品 row 由每个角色对的分组计数拒绝，不再用裸 incident 总数；
- **防漂移**：bootstrap、admin verify 与 read-only diagnostic 现在嵌入同一个 SQL renderer；diagnostic
  保留 migration/identity/0012 有界 predicates，并把旧的两个 membership verdict 收敛为共享
  `membership_contract_exact`；
- **离线验证与证据边界**：hosted foundation + first Operator focused 为 15/15；本机 PostgreSQL 17.6
  事务探测证明预期角色图返回 true，额外产品边或错误 `inherit=true` 均返回 false，三次探测全部
  rollback。fresh `pnpm verify:macos` 随后原样退出 0，覆盖 213/213 Node scripts、474/474 Vitest files
  （2,859 passed / 12 skipped）、Store coverage 481/481、Playwright 110/110、全 workspace
  format/lint/typecheck/build、architecture、development blocker、Store release 与 production dependency
  audit（无已知漏洞）。实现修复时不连接远端、不执行 migration/bootstrap，也不修改 Supabase 角色；
- **远端正式复验**：用户随后在当前工作树运行
  `pnpm acceptance:hosted:verify --verify-hosted-foundation-kpadiulxkgckskcfydry`，得到
  `Hosted acceptance foundation verification passed.`；紧接着运行
  `pnpm acceptance:hosted:operator:status --status-first-operator-kpadiulxkgckskcfydry`，得到
  `Hosted first Operator status: empty.`。两条均为正式固定 CLI 的只读结果，关闭 migration 0012 后的
  foundation/空 Operator 数据库门；它们不证明或代替 Vercel、DNS、Auth、SMTP、secret、deployment、真实
  邮件、邀请发行或实际 Operator 引导。

## 45. Hosted 首轮 Store-disabled capability（2026-08-22）

- **部署选择**：用户明确选择首轮禁用 Store。公开配置新增必填
  `HUAYI_STORE_EXTENSION_CAPABILITY=enabled|disabled`；hosted verifier 固定 `disabled` 并拒绝任何
  Extension ID，local acceptance 保持显式 `enabled`。用户同时确认 Reply-To 可用、已有 hosted DeepSeek
  key 并批准少量真实验收费用；邮箱和 key 值不进入仓库、计划或测试输出；
- **失败关闭组合**：disabled 时 production API 的 CORS 只含 Web origin，路由表不注册 pairing/session/
  preferences/query/cloud-copy/self-disconnect 等 Store 专用 surface；分析、StudyCapture、外部词表等混合
  路由也在 identity 查询前拒绝 `HuayiExtension` token。enabled 仍要求严格 `[a-p]{32}` ID 和最低版本；
- **发布一致性**：完整 `check:cloud-release` 新增 `release-config-store-capability`，只接受 enabled 的完整
  Store 候选；Web-only hosted runtime 不能冒充 Store ready。Classic、Windows、Store 客户端与数据库均
  未修改；
- **TDD 与 fresh 证据**：environment/capability 与 disabled composition 先出现预期失败，最小实现后
  focused 18/18 Vitest、22/22 Node 通过；API 全包 136 files / 509 tests。根审查校准外部输入状态后又通过
  focused 15/15 Vitest、18/18 Node；最终 `pnpm verify:macos` 原样退出 0，覆盖 214/214 Node、474/474
  Vitest files（2,862 passed / 12 skipped）、Store 481/481、Playwright 110/110、workspace
  format/lint/typecheck/build、instructions、architecture、development blocker、Store release 与 production
  audit，且无已知 production 漏洞。一次并发重复启动 API 全包导致既有 5 秒 migration test 超时；该文件
  单独 5/5 通过，随后无并发完整重跑 509/509 通过。未连接 Vercel/Supabase/Resend/DeepSeek，未提交或
  推送。

## 46. Vercel Git 连接零 deployment 保险（2026-08-22）

- **Fresh RED**：API/Web 真实 `vercel.json` 的 focused assertions 均因缺少
  `git.deploymentEnabled=false` 失败；deployment plan 测试因缺少空 shell、settings PATCH、Production
  Branch、Git connect 与后续审查提交解锁顺序失败；
- **最小 GREEN**：两份配置临时禁用所有分支 Git deployment，离线 plan 同步输出零部署保险和受控解锁
  条件；不改业务代码、runtime、数据库或 Classic/Windows/Store；
- **离线验证**：配置 focused Vitest 为 2 files / 12 tests，deployment Node 为 4/4，Cloud release verifier
  单测为 14/14；全 workspace Prettier、ESLint、typecheck、build 与 `git diff --check` 通过。无 production
  candidate environment 直接运行 `check:cloud-release` 按设计拒绝缺失配置和首轮 Store-disabled runtime，
  未把该失败关闭结果冒充为 Store release 通过；
- **完整 macOS 门禁复核**：`pnpm verify:macos` 通过；Node 214/214、Vitest 474/474 files
  （2,863 passed / 12 skipped）、Store coverage 481/481、Playwright 110/110，architecture、build、
  development-blocked、Store release 与 production dependency audit 全部通过，且无已知 production
  漏洞；
- **外部状态边界**：本节只记录仓库候选与待执行 runbook，不声称已创建 Vercel project、连接 repository、
  安装/运行 Vercel CLI、配置环境变量或产生 deployment；真实外部证据必须在后续步骤单独记录。

## 47. Vercel 空 project REST bootstrap（2026-08-22）

- **官方契约复核**：只使用 Vercel 官方 REST 文档，并按官方 `vercel/sdk` 当前生成模型交叉确认
  `GET /v2/teams`、`POST /v11/projects`、`GET/PATCH /v9/projects/{idOrName}`、
  `GET /v7/deployments` 及 Root/Framework/Node/source-outside-root/Preview/resource settings 字段；没有向
  `api.vercel.com` 发请求，也未安装 Vercel CLI；
- **Fresh RED/GREEN**：新增测试先因 bootstrap 模块缺失按预期失败；最小实现以 fake fetch 覆盖 exact
  URL/method/query/body、name-only create、settings PATCH、零 deployment 前后检查、无 Git、精确 team、
  幂等既有 project、部分失败重跑、只读 status、Token 与第三方错误不回显；
- **失败关闭边界**：两个 project 在首个写入前一起预检；已有 Git、deployment、environment、alias/
  integration 或部分配置漂移时不覆盖。创建请求从不携带 `gitRepository`，实现中不存在 deployment POST；
- **Dashboard 事实边界**：官方 PATCH 支持 Preview 禁用，但当前官方 project GET schema不返回该字段，故
  仍要求 Dashboard 回读；Production Branch 也只在 Dashboard 设置。脚本不创建 production environment、
  domain、Git link 或 deployment；
- **外部状态**：用户已在 Vercel 侧生成短期 Access Token，但本实现没有读取、显示或持久化它；截至本节
  尚未运行真实 `apply`；
- **离线验证**：Fresh RED 后新 bootstrap/security 测试 11/11、与既有 hosted deployment 合并 15/15、
  `pnpm test:scripts` 225/225 通过；无 Token 的 package plan、format、lint、typecheck、build、instructions、
  architecture 与 `git diff --check` 均通过；
- **完整 macOS 门禁复核**：`pnpm verify:macos` 原样退出 0；Node 225/225、Vitest 474/474 files
  （2,863 passed / 12 skipped）、Store coverage 481/481、Playwright 110/110，workspace
  format/lint/typecheck/build、instructions、architecture、development blocker、Store release 与 production
  audit 全部通过，且无已知 production 漏洞。

## 48. Vercel bootstrap 首次外部调用的 CLI 参数修复（2026-08-22）

- **用户可见症状**：按 runbook 执行 `pnpm acceptance:vercel:projects:apply -- --confirm-...` 后，pnpm
  实际启动 `node ... apply -- --confirm-...`，CLI 只输出固定 operation failed 并退出 1；没有足够信息判断
  是本机参数、Token、Team scope 还是远端 REST 阶段；
- **确认根因与外部边界**：package script 已固定 `apply`，pnpm 又原样转发单个 `--`，形成三个 Node 参数；
  旧实现只接受两个参数，因此在 Token 校验和首个 fetch 前确定失败。该次尝试没有读取远端状态、没有创建
  project，也没有产生 Git link、environment 或 deployment；
- **Fresh RED/GREEN**：fake HTTP 接缝用真实参数形状 `apply, --, --confirm-...` 精确复现 exit 1；修复只移除
  `apply/status` 后精确位置的单个分隔符，随后仍严格校验固定确认参数。相同测试转绿并完整经过 exact Team、
  两 project 预检、name-only create、settings PATCH 和零 deployment 模拟；
- **安全诊断**：CLI 失败只输出白名单 stage/reason 与有界 HTTP status。403/500、transport、response、
  scope、preflight 和 verification 均不回显 URL、请求体、Token、team 数据或远端正文；未知异常固定降级为
  `internal/unexpected/unavailable`。focused bootstrap/security 13/13、完整 `pnpm test:scripts` 227/227、
  受影响 ESLint/Prettier 与 diff check 均通过；修复后真实外部 `apply` 仍待用户使用进程级 Token 重跑。

## 49. Vercel name-only create 安全默认值兼容（2026-08-22）

- **真实症状**：修复参数后，外部调用到达 `POST /v11/projects` 并以
  `stage=create-api; reason=preflight-rejected; status=not-applicable` 停止；API project shell 已创建，后续
  PATCH、Web create 和任何 deployment 未执行；
- **确认根因**：Dashboard 只读证据为 Connect Git、无 Production/Preview deployment、Framework=Other、
  Build/Output/Root 为空、Node 24.x，但 Vercel 默认开启 `sourceFilesOutsideRootDirectory`。旧
  `isBlankShell` 精确要求该值不能为 `true`，因而拒绝了与最终冻结目标一致的安全平台默认值；
- **Fresh RED/GREEN**：deterministic fake create response 使用当前官方 create schema 的必需默认字段，随后
  canonical GET 返回 root 外 source=true 的零 Git/零 environment/零 alias/零 integration 空 shell。修复前
  单测稳定复现同一 `create-api/preflight-rejected`；修复后接受该布尔默认值、PATCH 冻结设置并验证零
  deployment；
- **契约加固**：POST response 只确认 create 成功，不再当完整 project 投影；脚本随后按 exact team/name
  调用 canonical GET，再执行原有 identity、Git/environment/custom environment/alias/integration、配置与
  Deployments API 检查。除 root 外 source 的 `false|true` 安全布尔默认外，其他部分漂移仍失败关闭；
- **外部状态边界**：当前 API shell 可能被下一次幂等重跑复用；尚未配置 settings、创建 Web shell、连接
  Git、写入环境变量/domain 或产生 deployment。修正版真实重跑仍待执行。

## 50. Vercel 空 project bootstrap 与 Dashboard 零部署回读（2026-08-22）

- **真实 bootstrap**：修正版 `acceptance:vercel:projects:apply` 已完成两个 name-only project shell 的
  settings PATCH 与 canonical GET，固定输出 `zero deployments verified`；未创建 Git link、environment、
  domain、secret 或 deployment；
- **Dashboard project settings**：API 回读为 Hono、Root=`apps/api`、Node 22、root 外 source enabled；Web
  回读为 Vite、Root=`apps/web`、build=`pnpm build`、output=`dist`、Node 22、root 外 source enabled；
- **独立环境回读**：两个 project 的 `Settings → Environments` 均显示 Preview=`Disabled`，Deployments
  均显示 `No Production Deployment`；这关闭了 GET schema 无 Preview 字段留下的人工门；
- **顺序校准**：两个 Production environment 均显示 `No branch configuration`，Git settings 均未连接
  repository。真实 UI 证明 Production Branch Tracking 只能在 Git link 后设置，因此后续顺序改为逐项目
  Git connect → 零 deployment → Production Branch Tracking=`codex/settings-configuration` → 再次零
  deployment；
- **回归与完整门禁**：更新后的离线 plan 专项 16/16 通过；`pnpm verify:macos` 原样退出 0，覆盖 Node
  231/231、Vitest 474/474 files（2,863 passed / 12 skipped）、Store coverage 481/481、Playwright 110/110，
  format/lint/typecheck/build、instructions、architecture、release 与 production audit 均通过且无已知
  production 漏洞；
- **边界**：本节仍未连接 Git、设置 Production Branch、写入环境变量、配置域名或发起 deployment。

## 51. Vercel Git 与 Production Branch 零部署回读（2026-08-22）

- **精确 repository**：`seen-said-acceptance-api` 与 `seen-said-acceptance-web` 均已连接 GitHub
  repository `Neil0619/huayi`，没有接受 GitHub App permission upgrade；
- **双重 environment 门**：两个 project 的 Preview environment 均继续显示 `Disabled`，Production
  Branch Tracking 均显示 `codex/settings-configuration`；两个 Production environment 均显示
  `No Environment Variables Added`；
- **独立零部署回读**：Root 在连接和 Branch Tracking 保存后独立回读两个 project 的 Git、Environment 与
  Deployments 页面；两边均显示 `No Production Deployment`，且页面没有任何 deployment 记录；
- **外部动作边界**：本轮没有配置 domain 或 environment variable，也没有触发 deployment。Production-only
  environment、domain、Resend、Supabase Auth/SMTP 与首次 API/Web deployment 仍待后续明确门禁；
- **失败关闭保持**：API/Web 仓库配置中的 `git.deploymentEnabled=false` 没有改变，所有 Git deployment
  仍禁用。Git connection 与 Production Branch Tracking 已完成不表示首次 deployment 已武装；解锁仍必须
  由 production-only 配置全部复核后的另一次受审查提交完成。

## 52. Hosted acceptance DNS 与 TLS 回读（2026-08-22）

- Cloudflare saved/readback：`api.acceptance` → `7cb58e1372474614.vercel-dns-017.com.`，`app.acceptance` → `f0cbaadacf303110.vercel-dns-017.com.`；两条均 DNS only、Proxy disabled、TTL Auto；1.1.1.1、8.8.8.8、9.9.9.9 均返回精确 CNAME；
- Vercel 两个 custom domain 均 properly configured；两个 HTTPS host 的 `curl ssl_verify_result=0` 通过并在尚无 deployment 时返回预期 404；zero deployments 仍为零；
- 该证据只关闭 DNS/domain/TLS 配置门，不声明应用部署或 production readiness。Resend verified sender
  subdomain/DNS、production-only environment、Supabase Auth/SMTP 与真实应用部署仍 pending；对话中
  泄露的旧 Resend key 撤销状态尚未核验，必须视为已泄露且不可使用。

## 53. Hosted acceptance Resend sender 域名与 DNS 回读（2026-08-23）

- **固定范围**：Resend sender domain 为 Tokyo (`ap-northeast-1`) 的
  `notify.acceptance.seen-said.cn`。future production sender `notify.seen-said.cn` 仍不在本阶段范围；
- **DNS 证据**：Cloudflare `seen-said.cn` 保存并回读 Resend 指定的 DKIM TXT、
  `send.notify.acceptance` priority 10 feedback MX、同名 SPF TXT 和 `_dmarc` monitoring TXT；公共递归
  解析同步返回四条精确记录。既有 `api.acceptance` / `app.acceptance` DNS-only CNAME 未修改；
- **厂商状态**：Resend Dashboard 显示 `Domain verified: Your domain is ready to send emails`；两个 Vercel
  acceptance project 同时仍显示 `No Production Deployment`；
- **证据边界与后续门**：后续 Phase 63 已完成旧 key 撤销、分离 SMTP/HTTP credential、Custom SMTP 与
  R3-C 部分 Production 配置；真实邮件、完整 Production environment、API/Web deployment、DeepSeek、Cron
  与邀请仍未运行。

## 54. Hosted acceptance 邮件凭据分离与托管配置（2026-08-23）

- **撤销证据**：Resend Dashboard 已不再保留对话中泄露的旧 `seensaid` key；误建的 Full access R3-C key
  与因工具诊断暴露的临时 domain-scoped R3-C key 也都在未使用前撤销。证据不包含 token、prefix 或 secret
  value；
- **最小权限分离**：Dashboard 当前只保留 `seen-said-acceptance-supabase-auth-smtp` 与
  `seen-said-acceptance-r3c-http`；两把 key 均为 Sending access、仅限
  `notify.acceptance.seen-said.cn`，用途分别固定为 Supabase Auth SMTP 与应用 R3-C HTTP；
- **Supabase 配置**：project `kpadiulxkgckskcfydry` 已启用 Custom SMTP，host/port 为
  `smtp.resend.com:465`、username=`resend`、sender=
  `语见 <accounts@notify.acceptance.seen-said.cn>`；独立 SMTP password 不可回读；
- **Vercel 配置**：API project `seen-said-acceptance-api` 的 Production 当时已存在 Sensitive
  `HUAYI_RESEND_API_KEY`，并配置 `HUAYI_SECURITY_NOTIFICATION_MODE=resend`、固定 security sender 与用户
  确认的 Reply-To。Web project 在本 Phase 当时未改，API Deployments 仍显示 `No Production Deployment`；
- **仓库与零动作证据**：`pnpm acceptance:hosted:deployment --plan` 退出 0；外部配置前工作树为 clean。
  本阶段未发送真实确认/恢复/R3-C 邮件，未发起 API/Web deployment，未运行 DeepSeek，未安装或触发 Cron，
  未发行邀请；
- **后续状态**：Phase 64 随后完成 API/Web 完整 Production environment 结构与 Auth exact URL；Phase 65
  已产生 API Production deployment 历史，Web 仍未部署。当前剩余门为轮换后受控 API deployment 与真实
  runtime smoke；随后才验收 Web、Auth 邮件、R3-C 通知、Cookie/CORS/SSE/Storage、五项 Cron 与
  FirstOperatorBootstrap。

## 55. Phase 64 Hosted acceptance Auth 与完整环境结构（2026-08-23）

- **Supabase Auth exact 配置**：Site URL 已固定为 `https://app.acceptance.seen-said.cn`；redirect allowlist
  只含 contract 中五条 `https://api.acceptance.seen-said.cn` exact callback URL，无通配符；
- **Vercel Production environment**：`seen-said-acceptance-api` 为 21/21，精确 9 项 Sensitive、12 项
  public；`seen-said-acceptance-web` 为 2/2 public。全部只属于 Production。曾误设 Sensitive 的三项通知
  public 变量因 Vercel 不支持原地关闭，已删除并按原值重建为 Production-only public，最终结构复核通过；
- **禁止变量与值边界**：`HUAYI_STORE_EXTENSION_ID`、`VITE_ACCEPTANCE_MODEL`、
  `VITE_DEPLOYMENT_COMMIT` 与人工 `VERCEL_GIT_COMMIT_SHA` 均不存在。数据库 DSN 与 DeepSeek key 由用户
  直接安全输入，系统剪贴板随后清空；本文不记录任何值。Reply-To 只记录为“用户确认地址”；
- **本地恢复材料**：三项本地生成 Secret 只保存在 macOS login Keychain，service 为
  `huayi-hosted-acceptance-refresh-encryption`、`huayi-hosted-acceptance-secret-pepper`、
  `huayi-hosted-acceptance-cron-secret`，account 均为 `kpadiulxkgckskcfydry`；只记录名称与 project ref；
- **Phase 64 当时的零部署与验证边界**：两个 project 均仍为 `No Production Deployment`，仓库
  `git.deploymentEnabled=false` 未改，未触发 deployment。`acceptance:hosted:deployment --plan` 退出 0；
  Vercel Sensitive 值不可回读，不能据此重跑 `--verify-environment`，也不为重跑而旋转已托管 Secret。
  后续 API deployment 的启动与 `/health` gate 仍负责验证真实 composition；
- **最新离线门**：`pnpm verify:macos` 退出 0：231/231 Node script tests、474/474 Vitest files
  （2,863 passed / 12 skipped）、Store 97 files 481/481、Playwright 110/110；build、architecture、
  cloud-blocked、Store release、production audit 均通过，production dependencies 无已知漏洞；
- **Phase 64 当时的下一门**：完成文档审查后形成首次部署解锁的受审查提交；不在本阶段修改
  `vercel.json` 或部署。之后
  固定 API first → health/TLS/CORS/Cookie/SSE/Auth/Storage/真实 DeepSeek 小额 smoke → Web → 真实邮件与
  R3-C → Cron → first Operator invitation。该历史顺序已由 Phase 70 取代；当前不再要求在 Web 零部署、
  首账号不存在且 kill switch 开启时先运行 Auth/DeepSeek。

## 56. Hosted application 登录验证分段诊断（2026-08-23）

- **已排除密码与锁定**：用户轮换 application 数据库密码后，最小 psql 登录验证曾通过；最新 diagnostic
  返回 `psql_connection_ok=t` 且组合 SQL `application_execution_completed=f`。因此当前失败位于 SQL
  执行层，不是密码错误、网络不可达或多次重试后的账号锁定；
- **证据校正**：审查确认 `pg_stat_ssl` 经 Supavisor 只能观察 pooler 到 PostgreSQL 的 backend 链路，不能
  证明 psql 到 pooler 的客户端 CA/hostname 验证。该判据已移除；真实 TLS 门继续由固定
  `sslmode=verify-full`、不可降级的 `PGSSLMODE`、权限 `0600` 的临时 CA 与成功连接共同证明；
- **Fresh RED/GREEN**：回归先因缺少 split parser 与 catalog OID privilege probe 精确失败；最小实现把
  正式 verify 拆成六项权限 contract、同一 session-pooler 连接的三项 context contract 和独立 postgres
  越权拒绝。`set_owner_context(uuid)` 权限检查不再通过可能触发 schema 权限错误的 text/regprocedure 名称
  解析，而是从 `pg_namespace + pg_proc` 固定找到 UUID 参数函数 OID；函数缺失仍失败关闭；
- **诊断边界**：diagnostic 依次执行固定 `SELECT true`、权限、context 与 postgres 越权探针，只返回固定
  布尔项和 psql exit class 枚举；原始 stderr、SQL、SQLSTATE、PID、密码和动态数据库内容均不输出。聚焦
  Node 回归当前 14/14 通过；
- **完整离线门**：instructions、format、lint、typecheck、235/235 Node script tests、474/474 Vitest files
  （2,866 passed / 12 skipped）、Playwright 110/110 与全部 workspace build 均通过；build 只有既有的 Web
  chunk size 提示；
- **远端关闭证据**：用户运行新 diagnostic 后，连接/TLS、六项权限、三项 context、同 backend 和 postgres
  越权拒绝全部符合固定预期，随后正式 verifier 返回
  `Hosted acceptance application login verification passed.`。这关闭 application 数据库角色与隔离门；
- **因果与部署边界**：远端通过证明 catalog OID + split contract 的修订路径有效，但没有单独重放旧文本
  探针，因此 text/regprocedure 名称解析仍是最强解释，不记录成唯一已隔离根因。Vercel
  `HUAYI_DATABASE_URL` 随后已用新密码成功 Rotate 为 Production Sensitive transaction-pooler `6543` DSN，
  但现有 Latest deployment 早于 Rotate；轮换后受控 deployment 与数据库 smoke 前，runtime database
  composition 仍不能记为通过。

## 57. Hosted API deployment 历史与 application DSN Rotate（2026-08-23）

- **DSN Rotate**：Vercel API project 的 `HUAYI_DATABASE_URL` 已通过 Sensitive Rotate 更新；Dashboard 回读
  为 Production、Sensitive、`Updated just now`。旧 application 密码此前已经撤销，操作未点击 Redeploy；
  系统剪贴板随即清空，本文不记录 DSN 或密码；
- **部署历史**：API Dashboard 有 7 条 Production 记录。六个 branch source 依次为 `ac06dba`、`aa747fc`、
  `2380f2d`、`9c6fd44`、`e216ef2`、`0c04130`，均是当前分支线性祖先；另有一次 `0c04130` redeploy。
  三个中间修复为 Error，其余四条为 Ready。Web 保持 `No Production Deployment`；
- **候选提交前身份基线**：冻结本候选前，本地 HEAD、远端跟踪分支与 Vercel Latest source 均为
  `0c0413085a9dc78e7dc772cdee2eff2ce446ae04`。Latest/Current deployment ID 为
  `BAC8nKdfjGH9Qtp1wdwi1j4376bN`，custom domain 为 `api.acceptance.seen-said.cn`；
- **健康证据**：custom-domain `/health` 返回 HTTP 200、TLS verify result 0 与固定
  `{"service":"huayi-cloud-api","status":"ok"}`，`x-vercel-id` 以 `sin1::sin1` 开头。该 endpoint 不访问
  数据库，且 deployment 早于 DSN Rotate；它不证明新 DSN、DeepSeek、Auth、Cookie/CORS/SSE 或完整
  runtime composition；
- **候选时配置门**：API/Web Production Branch Tracking 均为 `codex/settings-configuration`，Preview 均为
  `Disabled`。当时 API 仍 armed，Web 仍全分支关闭；下一次只允许一个 SHA 匹配的轮换后 API deployment。

## 58. Rotate 后 exact-SHA API deployment 与立即关闭（2026-08-23）

- **受控 deployment**：候选提交 `7577cdd7658fe966e85e8c8b4346e3291089e4e1` push 后，API Dashboard
  新增唯一 Production deployment `3fxCRe2xku5qzZ8kdbFo4GivGiRL`，状态 Ready，source 精确匹配候选；API
  历史总数由 7 增为 8，Web 仍为 `No Production Deployment`；
- **立即关闭**：新记录出现后未先运行 smoke；唯一后续 push 为独立提交 `00beea8`，把 API
  `git.deploymentEnabled` 恢复为 `false`。Dashboard 刷新确认该提交没有新增 API deployment，Web 也没有
  deployment；
- **当前边界**：Git 自动部署窗口已关闭，保留的 `7577cdd` deployment 使用 Rotate 后 Sensitive 环境，现可
  进入 `/health` 与 DB-backed runtime smoke。Ready 本身不证明数据库、DeepSeek、Auth、Cookie/CORS/SSE；
- **回归待闭合**：关闭配置使旧 armed 断言按预期失败；后续测试/文档修复 push 必须继续回读 API 总数为 8、
  Web 为 0，以证明 `deploymentEnabled=false` 持续生效。

## 59. Sensitive DSN 纠正与 runtime 数据库门（2026-08-23）

- **启动失败证据**：`3fxCRe2xku5qzZ8kdbFo4GivGiRL` 的 custom-domain `/health` 返回 HTTP 500，Vercel
  runtime 日志在 `environment.ts` 的 URL 校验处显示输入为固定变量名
  `HUAYI_SECURITY_NOTIFICATION_MODE`。这证明此前“正确 DSN 已进入 runtime”的描述无效，但没有暴露密码、
  DSN、CA 或其他 secret；
- **失败重试保留**：第一轮纠正没有取得变量更新时间，exact-source Dashboard redeploy
  `CHnaZQuohoNiTM4ukQqY1NXQZv2V` 仍以同一固定错误失败。该 Ready deployment 和 500 日志均保留为证据；
- **正确 Rotate 证据**：第二轮只在 `HUAYI_DATABASE_URL` 的 Rotate dialog 内填写经结构校验的 6543
  transaction-pooler DSN；提交后 dialog 关闭、Dashboard 显示 `Rotated HUAYI_DATABASE_URL` 和
  `Updated just now`。系统与浏览器剪贴板随后均清空，不记录密码或完整 DSN；
- **纠正 deployment**：API/Web Git deployment 全程为 `false`。从精确候选
  `7577cdd7658fe966e85e8c8b4346e3291089e4e1` 进行一次无缓存 Dashboard redeploy，得到 Production
  deployment `DyqRzj5UMN8BRpSeZyohXprnAkaT`，状态 Ready；API 历史总数为 10，Web 仍为零；
- **健康门**：custom-domain `/health` 返回 HTTP 200、固定
  `{"service":"huayi-cloud-api","status":"ok"}`，`x-vercel-id` 为
  `sin1::sin1::ftzls-1787473912756-ba19a54971b6`；
- **数据库门**：随机无效 session 的 `GET /v1/quota` 返回精确 HTTP 401、
  `authentication_required`、`The Web session is invalid.`，`x-vercel-id` 为
  `sin1::sin1::rvdmw-1787473926428-f9a857274998`。Cookie 未记录；该无写入结果证明 runtime 已完成
  DB TLS/login、transaction、role switch 与认证 SQL，但不证明 tenant context/RLS、DeepSeek、Auth 或邮件。

## 60. Phase 70 Web-only armed candidate（2026-08-23）

- **顺序校准**：交叉审查确认 Cloud DeepSeek 必须依赖真实 Web session，hosted kill switch 又在 Provider
  fetch 前阻断；真实 Auth/SMTP 则必须经 BootstrapInvitation、API callback 与 Web 落点。因此当前权威
  顺序固定为 Web deployment → 独立 disarm → 零账号公开 smoke → Auth/SMTP/首位账号 → Operator
  complete → 受审计 kill switch 切换 → 一笔真实 Cloud DeepSeek 应用路径 smoke；Classic Native Host 的
  `pnpm smoke:deepseek` 不替代该门；
- **现有 API 公共前置证据**：对 `/v1/quota` 运行无写入 OPTIONS；
  `https://app.acceptance.seen-said.cn` 返回 HTTP 204、精确 allow-origin、credentials=true 且允许 GET，
  `https://example.invalid` 同为 204 但没有 allow-origin。该结果不扩大为 Cookie、CSRF、Auth、SSE、模型
  或业务写入已通过；
- **Fresh RED**：旧 Web `deploymentEnabled=false` 下，hosted deployment plan 为 1 fail / 3 pass；Web
  release materials 为 1 fail / 4 pass，失败值精确为布尔 `false` 而非 exact-branch map；
- **最小 GREEN**：API 配置保持布尔 `false`；Web 仅增加 `"**": false` 与
  `"codex/settings-configuration": true`。deployment plan 4/4、Web release materials 5/5 通过；hosted
  environment/notice/public-bootstrap 3 files 8/8 通过；
- **构建与秘密边界**：以 hosted public origin、`hosted-acceptance` 和冻结基线 SHA 构建 Web 成功；bundle
  包含 hosted 标识与完整 SHA，服务端数据库、CA、Supabase service role、DeepSeek、Resend、pepper、Cron
  变量名均不存在。工作树 diff 的 Resend key、Provider key、含密码 DSN 与 JWT 扫描均为 clear；
- **完整离线门**：`pnpm verify:macos` 原样退出 0：235/235 Node script tests、474/474 Vitest files
  （2,866 passed / 12 skipped）、Store 97 files 481/481、Playwright 110/110；instructions、format、lint、
  typecheck、architecture、workspace build、development blocker、Store release、production audit 均通过，
  production dependencies 无已知漏洞；
- **首次远端结果**：candidate `c9ee267cee943b888fc02e360dee4300d955c5d2` 只产生 Web Production
  deployment `87fk9rqpGH2sUcGrzCf68tuXjyu8`；source 精确匹配，状态 Error，API 仍为原 10 条且 Latest
  仍是 `DyqRzj5UMN8BRpSeZyohXprnAkaT`；
- **独立 disarm**：Error 记录出现后没有查看日志或运行 smoke；唯一后续 push 为 `26022a9`，把 Web
  `deploymentEnabled` 恢复为布尔 `false`。Dashboard 回读仍只有上述一条 Web Error，API 列表未变化；
- **错误与本地复现**：disarm 后 Build Logs 显示 Vercel 直接运行 `pnpm build`，Vite 在 30 modules 后因
  `@huayi/cloud-contracts` 的 package entry 无法解析而失败。本地临时移走 `packages/cloud-contracts/dist`
  后，旧 Web build 在 0.5 秒内复现同一 resolver error；
- **Fresh RED/GREEN 修复**：发布材料回归先以 actual `pnpm build` / expected `pnpm build:vercel` 精确失败；
  最小修复在 Web package 增加专用命令，先构建 learning-domain、cloud-contracts，再运行 Vite，并让
  `vercel.json` 覆盖 Dashboard 的历史 build setting。回归 5/5 通过；在 cloud-contracts `dist` 缺失条件
  下专用构建成功；
- **修复完整门**：`pnpm verify:macos` 原样退出 0：235/235 Node script tests、474/474 Vitest files
  （2,866 passed / 12 skipped）、Store 97 files 481/481、Playwright 110/110；instructions、format、lint、
  typecheck、architecture、workspace build、development blocker、Store release 与 production audit 均通过，
  production dependencies 无已知漏洞；
- **fix-only push 边界**：commit `aba1cc07a4bea87074068148f672424f3e615f31` 已在 API/Web
  `deploymentEnabled=false` 下推送。Dashboard 等待并回读后，Web 仍只有 `87fk9rqpGH2sUcGrzCf68tuXjyu8`
  一条 Error，API 仍为 10 条且 Latest 未变；下一次 reviewed re-arm 尚待完成。

## 61. Hosted Web Ready、独立 disarm 与零账号公共门（2026-08-23）

- **提交前门**：第二次 re-arm diff 仍严格只有 Web `vercel.json` 与发布材料回归；API 保持布尔
  `deploymentEnabled=false`，Web 保留 `buildCommand=pnpm build:vercel` 并仅允许 exact production branch。
  第一次完整门的 110 条 E2E 中一条 Shanbay 时序用例收到 idle；同用例随后连续 3/3 通过，完整
  `pnpm verify:macos` 原样重跑并退出 0：235/235 Node scripts、474/474 Vitest files（2,866 passed /
  12 skipped）、Store 97 files 481/481、Playwright 110/110，全部 format/lint/typecheck/build/release/audit
  同轮通过，production dependencies 无已知漏洞；
- **受控 deployment**：re-arm commit `b87ef03d948934fad7faf50418e0b79a1914af30` push 后只新增 Web
  Production deployment `6AAAVXP175oviEhrjULxH48eQjPu`，source 精确匹配并在 21 秒后 Ready；custom
  domain 为 `app.acceptance.seen-said.cn`，构建日志确认 Web Vite 转换 202 modules 并完成发布；
- **立即关闭**：新 Web 记录出现时仍为 Building，未先查看日志或运行 smoke；独立提交 `c5c25f5` 随即把
  Web 恢复为 `deploymentEnabled=false`。Dashboard 等待回读后 Web 仍恰好两条历史记录（首次 Error、本次
  Ready），API 仍为 10 条且 Latest 仍是 `DyqRzj5UMN8BRpSeZyohXprnAkaT`；disarm 没有产生新 deployment；
- **Web/TLS/identity**：`https://app.acceptance.seen-said.cn/` 与 `/privacy` 均返回 HTTP 200、TLS verify
  result 0；实际页面显示 `Hosted 验收 · b87ef03` 与真实托管说明，不显示本机模拟模型。首页无会话时只
  显示登录入口，隐私页无需 API/Cookie 即完整渲染；
- **bundle secret scan**：下载并只在内存扫描 HTML、`index-CXF6XyPL.js`、`index-CAOsJwyc.css` 共三项
  发布产物；Resend/provider key、含凭据 PostgreSQL DSN、private key 与 Vercel token 形态均为零命中；
- **公共 API 边界**：API `/health` 为 200 与固定 service/status JSON；Web origin 下无 Cookie 的
  `/v1/auth/csrf` 返回 401 `authentication_required` / `Web session proof is required.`，无 Cookie 的
  `POST /v1/analyses:stream` 返回 401 `authentication_required` / `A session is required.`。缺 flow/code 的
  `/v1/auth/password/callback` 返回 400 `invalid_request` / `Authentication callback is incomplete.`，同时
  带 `Cache-Control: private, no-store` 与 `Referrer-Policy: no-referrer`；
- **零新增数据库证据**：Supabase SQL Editor 只执行未保存的 `count(*)` 联合查询并随后丢弃临时 snippet。
  `auth.users`、`auth.identities`、`user_profiles`、`admin_roles`、`invitations`、`invitation_claims`、
  `analysis_requests`、`analysis_records`、`usage_ledger`、`model_rate_limit_events`、`audit_events` 与
  `huayi_private.first_operator_bootstrap` 共 12 项均为 0；因此本门没有创建账号/邀请、调用 Provider、写
  usage 或改变首位 Operator 状态；
- **下一门**：Phase 70 公共门已关闭。下一步只发行首张 BootstrapInvitation，让用户通过正常密码注册、
  Resend Custom SMTP 确认、API callback 与 Web 落点完成首位账号；完成 Operator 后才允许受审计切换 kill
  switch 并运行一笔真实 Cloud DeepSeek 应用路径 smoke。

## 62. Phase 71 邀请前 authentication hardening 候选（2026-08-23）

- **审查阻塞**：Phase 70 Ready Web 在 hosted Google Provider disabled 时仍显示 join/login Google 动作，
  account settings 也显示 link/reauth；API Google route 会在 Provider 失败前创建 flow。密码待确认文案又与
  callback 自动 Cookie + `/app` 冲突，actual-bundle fake mail 仍使用旧共用 callback；
- **Fresh RED**：Web component/environment 4 个断言失败；API environment/route/production composition
  3 个断言失败；post-completion verifier 因缺 export/script 失败；密码 actual-bundle 等待 dedicated
  callback 超时。这些失败分别锁定 UI、server composition、CLI 和真实 bundle 导航缺口；
- **最小 GREEN**：新增 API/Web strict optional Google capability，缺失时 API 不挂载全部 Google routes、
  Web 不渲染 join/login/settings Google 动作；只有 E2E Vite 构建显式 enabled。本机 acceptance 保持缺失；
- **密码路径**：精确文案改为“打开验证邮件中的链接；验证成功后会自动进入工作台”；fake mail、request
  fact 与 browser response 统一 `/v1/auth/password/callback`，并观察到 no-store/no-referrer、hardened
  Cookie 与最终 `/app`；
- **Operator 验证**：新增固定 `acceptance:hosted:operator:verify`；admin pooler/verify-full CA 上的单个
  read-only boolean 检查 completed bootstrap、邀请/claim/confirmed Auth/password profile/default quota/
  Operator/consumed flow/full session、开启 kill switch 与零业务使用。成功/失败输出固定，不接收或输出账号；
- **完整离线门**：focused Web 16/16 与后续能力补充 11/11、API 18/18、Operator/foundation/local scripts
  23/23、密码 actual-bundle 1/1、API/Web strict typecheck 均已通过；随后 fresh `pnpm verify:macos`
  以 exit 0 完成 instructions、format、lint、typecheck、architecture、237 项 Node script tests、根测试
  474 files / 2,872 passed / 12 skipped、Store 97 files / 481 passed、build、110 项 Playwright E2E、
  development-blocked、Store release、secret audit 与 production audit（无已知 high vulnerability）；
- **门禁反馈修复**：第一次完整门发现 `production-app.ts` 达 401 行，第二次发现
  `cloud-foundation-app.ts` 达 401 行；分别抽出 production principal authentication、Google
  authentication composition 与共享 cloud callback/session 深模块，相关 API 24/24 回归与完整门均通过；
- **候选与受控部署**：candidate `eb57887` 在双项目关闭状态推送且零 deployment。API re-arm
  `f1186a63a6f4147fd1d171e32262909aa374ad1c` 只新增 Production deployment
  `8XRLHd9B3bFk6cLeGMG8hspQDPVW` 并 Ready；记录出现后立即推送 disarm
  `837ec0dba028b76493e73dc180ec5288c55460fc`，API 保持恰好 11 条、Web 2 条。随后 Web re-arm
  `beac29d7de4ee2712cb06a7c28cc53dd53002f5f` 只新增 Production deployment
  `FxmMSypN7cV7UPXQb3XUQU1JGD8L` 并 Ready；立即 disarm
  `b52992e30d7f36111a1011c337c12ef03e9a3c92` 后 Web 恰好 3 条、API 11 条。两个 disarm 均零新增；
- **远端 hardening smoke**：API 九条 Google invitation/login/callback/link/reauth route 全部精确 404；
  Supabase 单个 read-only boolean 再证 Auth/profile/admin/invitation/analysis/usage/rate-limit/audit 与
  FirstOperatorBootstrap 共 12 项全部为 0，临时 SQL 已丢弃。Web `/login` 的完整
  `data-deployment-commit` 精确为 Web re-arm SHA，显示 `Hosted 验收 · beac29d`、密码专用文案，零 Google
  form/control、零本机模拟提示；线上 1 个 JS asset 的含凭据 DSN、provider/Resend key、private key、
  Vercel token 形态均为零命中；
- **邮件模板门**：Supabase `Confirm sign up` 保存态源码只读回读为动态
  `href="{{ .ConfirmationURL }}"`，无硬编码 HTTP URL、localhost/127.0.0.1、测试域或旧密码
  `/v1/auth/callback`；Save 保持 disabled。API `signUp` 继续通过 `emailRedirectTo` 注入专用
  `/v1/auth/password/callback?flow=<opaque>`；依据 Supabase 定义，`ConfirmationURL` 自身携带该动态
  `redirect_to`，无需在模板再暴露第二条 `.RedirectTo` 链接；
- **Phase 71 结论已被真实验收修正**：首张邀请实际发行后，Provider user/email identity 已确认，但 API
  callback、profile/method/quota/session 未完成；邮件点击落到 Site URL `otp_expired`，普通登录也因语见
  method fence 失败。此前动态 `ConfirmationURL` 门不能证明 scanner-safe，不能再作为当前发布证据。
- **Phase 72 候选与零部署**：受审查候选 `be38942` 已在双项目 disarmed 时推送；推送后 Vercel 默认 6/7
  状态筛选下 API/Web 仍分别可见 14/3 条 deployment，新增均为 0，两份 Vercel 配置的
  `deploymentEnabled` 均保持 `false`；
- **真实只读预检与 dry-run**：2026-08-24 Operator status 精确为 `registration-interrupted`，Hosted
  application login verifier 通过；Supabase migration dry-run 只列出
  `20260823010000_password_signup_interruption_recovery.sql`，数据库未修改；
- **0013 实际应用证据**：明确确认后只应用
  `20260823010000_password_signup_interruption_recovery.sql`；migration-chain、0013 recovery function/ACL
  diagnostic 为 true，随后 Hosted application verifier 通过；Operator status 仍精确为
  `registration-interrupted`。当前非空状态未运行 pristine foundation verifier。
- **Hosted Auth 配置回读**：Site URL 保持 `https://app.acceptance.seen-said.cn`；Redirect URL 列表恰好五条，
  均为固定 path + literal `\?flow=` + 恰好 43 个 `?`，无 `*`/`**`、localhost、preview 或额外 URL。
  Confirm sign up 保存并重新加载后精确包含一次 `{{ .Token }}` 和一次 `{{ .RedirectTo }}`，CTA 的唯一
  `href` 为 `.RedirectTo`，不含 `.ConfirmationURL` 或硬编码 URL。Custom SMTP 未改，Resend tracking 仍
  disabled，本步骤未轮换密钥、未发送邮件。
- **Phase 72 串行部署证据**：配置门文档提交 `59d04e2` 在双关闭状态推送后，默认 6/7 非 Canceled 可见数
  仍为 14/3。API arm
  `39094d0` 只新增 Production/Ready deployment `9jbyfnAvZwpa3Ci7YU6s6asmNZNG`；记录出现后唯一后续 push
  是独立 API disarm `88c9b09`，计数保持 15/3。确认 origin API/Web 均为 false 后，Web arm `b18d804`
  只新增 Production/Ready deployment `Bks2JvgrNidQ1CRjmUiwz9RTfhjF`；独立 Web disarm `2744757` 后默认
  可见数保持 15/4。默认 6/7（排除 Canceled）可见数在各目标项目 arm 时分别为 API 14→15、Web 3→4；
  在各项目自身 arm 窗口，7/7 全状态数分别为 API 19→20、Web 13→14。双 disarm 后、证据文档提交前的
  7/7 检查点为 API 22、Web 14，状态分布为 API Ready 12 / Error 3 / Canceled 7、Web Ready 3 /
  Error 1 / Canceled 10。API 列表中 `39094d0` 为 Ready、`b18d804` 与 `2744757` 为 Canceled、无
  `88c9b09`；Web 列表中 `b18d804` 为 Ready、`39094d0` 与 `88c9b09` 为 Canceled、无 `2744757`。
  因此两个 disarm 均未在其目标项目新增 deployment，但各自在另一仍 disarmed 项目留下一条 Canceled
  审计记录；后续双关闭下的证据文档 push 只允许增加 Canceled 审计记录，不得新增非 Canceled
  deployment。两个项目任何时刻未同时 armed，最终两份 `vercel.json` 均为
  `deploymentEnabled=false`。custom-domain API `/health` 与 Web `/` 均为 TLS 验证通过的 HTTP 200；本阶段
  未修改 Supabase、Custom SMTP、DNS、环境变量或密钥，未发送邮件、未运行 DeepSeek smoke。
- **当前下一门**：用原邀请 + Provider 密码证明原子恢复当前账号，并以新邀请验证 inert GET + 显式 OTP
  POST。真实 pepper continuity 由浏览器自动提交内存中的原邀请 token，API 用 Production pepper hash，
  0013 在写入前验证 active invitation、精确中断状态与 hash；不要求用户手工提取 opaque token。恢复前
  不得删除 Auth user、重新领取 bound claim、完成 Operator 或运行 DeepSeek smoke。
- **`/admin` recent-auth 缺口（本地证据）**：后续顺序已更正为恢复 `registered` → complete →
  post-completion verifier → `/admin` 密码重新认证 → 普通邀请 OTP。Web 组件回归先 RED 证明旧页面只显示
  拒绝页，再 GREEN 证明首次统一 `forbidden` 显示可重试密码表单、调用既有 password reauthentication、
  使用轮换 CSRF 重读权限并创建邀请；密码不进入渲染文案或新存储。此项尚无部署或 Hosted 浏览器证据。
- **First Operator 真实完成证据**：2026-08-24 浏览器恢复成功进入 Hosted workspace；只读 status 先精确为
  `registered`，随后受控执行 First Operator completion，最终 status 精确为 `completed`，完整
  post-completion verifier 通过。普通邀请尚未创建，`/admin` recent-auth 与 OTP journey 仍待后续门。
- **`/admin` 受控部署与用户门**：后续 Web arm
  `3fcc8322ff6387a1ff7d49fb72582562a3d65c16` 只新增 Production/Ready deployment
  `FxRmiGZMzotoqiSmU7hSHfonbeV8`；独立 disarm `8dea25c` 后 Web 没有新增非 Canceled deployment，API 最新
  受控 source 仍为 `39094d0`，两项目 `deploymentEnabled=false`。最终 7/7 状态分布为 API Ready 12 /
  Error 3 / Canceled 9、Web Ready 4 / Error 1 / Canceled 10。custom-domain Web/域名健康与 bundle exact
  arm SHA 已验证；真实 `/admin` 已显示当前密码重新认证门。用户尚未亲自提交密码，因此不能把页面可见性
  写成四区、Cookie/CSRF、角色权限或管理 mutation 已验收，普通邀请与 scanner-safe OTP journey 仍 pending。
- **当前仓库基线校准**：0013 应用后仓库与 Hosted forward migration head 均为 13 条；当前
  `CLOUD_DEVELOPMENT_BLOCKER_CODES` 为 10 项。旧章节中的“12 条 migration”或“固定九项”只保留为其
  所属阶段的历史快照，不代表当前基线。

## 63. Hosted Web 安全响应头受控部署（2026-08-24）

- **部署前基线**：安全头候选 `3c0af44f73f769da829c4218bf8fc69ef571f133` 已推送但未部署；仓库干净，
  HEAD/origin 一致，API/Web `deploymentEnabled` 均为布尔 `false`。Vercel 默认 6/7 非 Canceled 列表中
  API/Web 分别为 15/5；最新 Ready source 分别为 `39094d0` / `3fcc832`；
- **唯一 Web deployment**：只修改 Web policy 的 arm commit
  `b80c7930b8d4a9a87f8c27e500316899adbbdc53` 新增且只新增 Production deployment
  `7zNFzM4LHHGwyKxbwoDLfWoYGfve`，source 精确匹配，15 秒后 Ready。Web 默认可见数 5→6，API 保持 15；
  API 从未 armed；
- **独立关闭**：Ready 后立即推送独立 disarm
  `0e7ef5271b2f97cd9b3743275292e4037bd0f801`。等待后 Web/API 非 Canceled 数仍为 6/15，最新 source 分别
  保持 `b80c793` / `39094d0`；两份 Vercel 配置均为布尔 `false`，关闭提交没有产生额外非 Canceled
  deployment；
- **公网 header/TLS**：custom domain `/`、`/privacy`、`/admin` 与实际
  `/assets/index-Cl8ZwtXY.js` 全部返回 HTTP 200、TLS verify result 0；四处 CSP 都精确等于仓库候选，另有
  `Referrer-Policy: no-referrer`、`X-Content-Type-Options: nosniff`、
  `Permissions-Policy: camera=(), microphone=(), geolocation=()`，并保留
  `Strict-Transport-Security: max-age=63072000`；
- **渲染与构建身份**：Root、隐私页和 `/admin` 均完成实际浏览器渲染，显示
  `Hosted 验收 · b80c793`；`/admin` 稳定进入密码重新认证门，浏览器 error log 为空。实际 JS bundle
  恰好包含一次完整 arm SHA，不含未部署候选完整 SHA；
- **边界**：本阶段没有修改 Supabase、Custom SMTP、DNS、Vercel environment 或密钥，没有发送邮件、
  调用 DeepSeek 或武装 API。响应头验收不替代用户亲自输入当前密码后的 `/admin` 四区、普通邀请与 OTP
  journey。

## 64. Hosted Operator 四区与普通邀请生命周期缺口（2026-08-24）

- **真实只读证据**：用户亲自完成 Hosted 密码重新认证后，`/admin` 显示运营概览、账号管理、邀请、无
  正文审计四区；页面无 alert，浏览器 warning/error 为 0。概览只显示当前 UTC 月聚合，账号区只有一个
  active Operator 的白名单 metadata，邀请区四行只显示 ID/expiry，审计为 0。本轮没有点击 kill switch、
  额度、设备、账号、创建或撤销；
- **根因**：strict `InvitationResource`、Postgres `admin_list_invitations` 与 Web API 已包含
  `createdAt/expiresAt/consumedAt/revokedAt`，产品与 Phase 19 也明确要求撤销；`admin_execute` 已有
  Operator/recent-auth、幂等撤销与 `invitation.revoked` 空 safeDetails 审计。Web 列表却只渲染 ID/expiry，
  并仅用 consumed/revoked 决定按钮，导致所有终态无标签且过期项仍可能显示撤销；
- **Fresh RED/GREEN**：新增组件矩阵在旧实现精确 1 fail / 8 pass，四行 `[aria-label=邀请状态]` 均缺失；
  最小实现从既有时间戳投影可领取/已领取/已撤销/已过期，只对可领取项显示二步撤销，并在撤销当前创建项
  时清除一次性 output。最终审查再以 1 fail / 9 pass 证明不确定 DELETE 曾保留 output；修复后确认发起即
  清除 output、关闭重复撤销并要求重读列表。无需 migration、公开 route、wire 字段或角色 grant；
- **纵向回归**：API Hono 覆盖 DELETE mutation/no-store，Postgres 覆盖 list→same-key revoke replay→单一
  空审计→新 key 终态拒绝，Web adapter 覆盖 Cookie/CSRF/key DELETE；actual production bundle fake
  journey 覆盖 create→可领取→revoke→已撤销→refresh/audit，且 fragment 不进入 snapshot/Web Storage；
- **边界与下一门**：本节的本地候选已经由第 65 节受控 Web-only deploy/disarm；仍未创建/撤销 Hosted
  真实普通邀请。用户重新输入当前密码后只允许先完成历史四态只读复核；通过后仍需用户明确提供不同于
  Operator 的授权收件人，才创建唯一普通邀请并进入 scanner-safe OTP/Auth SMTP。

## 65. Hosted 普通邀请生命周期 Web 受控部署（2026-08-24）

- **基线**：clean candidate/upstream 为 `526fb8bf57a51b602cb73e2fc81f10f8787fc065`，API/Web
  `deploymentEnabled` 均为布尔 `false`。默认排除 Canceled 的 Vercel 6/7 视图中，Web 为 6 条
  （5 Ready / 1 Error），Latest `b80c793` / `7zNFzM4LHHGwyKxbwoDLfWoYGfve`；API 为 15 条
  （12 Ready / 3 Error），Latest `39094d0` / `9jbyfnAvZwpa3Ci7YU6s6asmNZNG`；
- **唯一武装与部署**：只把 Web production branch 武装并提交
  `bb218178b45a7216ac247860f15dd94052f58a72`；Vercel 只新增一条 Production deployment
  `2D2o6cYZJWSRKLHKQQB7XXxZRAt1`，source 精确匹配 arm SHA，14 秒后 Ready。Web 默认非 Canceled 数
  6→7（6 Ready / 1 Error），API 保持 15；
- **立即关闭**：Ready 后先于任何其他检查把 Web 恢复为 `false`，独立 disarm 提交
  `636968d72b016e95cf5114c56c53ff49670efed5` 已推送。关闭后 Web/API 默认非 Canceled 数仍为 7/15，
  Latest 仍分别是 `bb21817` / `2D2o6cYZJWSRKLHKQQB7XXxZRAt1` 与 `39094d0` /
  `9jbyfnAvZwpa3Ci7YU6s6asmNZNG`，两项目最终均为 `deploymentEnabled=false`；
- **live 只读边界**：custom-domain `/admin` 已显示 `Hosted 验收 · bb21817`，证明新 bundle 生效。部署执行
  会话刷新后曾精确进入 recent-auth 重新确认门且 warning/error 为 0；独立复核使用用户此前亲自完成密码
  重新认证、仍有效的浏览器会话读取到完整四区、一条“已领取”和三条“已撤销”，所有终态行均无撤销
  入口，浏览器 warning/error 仍为 0。本轮没有读取或填写密码，没有点击创建、撤销、kill switch、额度、
  账号或设备控制，也没有修改 Supabase/DNS/environment/secret、发送邮件或调用 DeepSeek；
- **未完成门**：现有数据没有“可领取”或“已过期”行，因此这两种 live 标签及“只为可领取项显示二步
  撤销”不能由历史终态行冒充。仍须用户明确授权不同于 Operator 的收件人，随后创建恰好一张普通邀请，
  以新 active 行关闭该 DOM 门并继续 scanner-safe OTP/Auth SMTP。

## 66. Cloud Web UI 合并、全门与 Web-only 受控部署（2026-08-24）

- **任务来源与合并**：读取任务“重审并升级UI设计”后核实唯一 UI 提交 `0fff445`，merge-base 为
  `87212ff`；当前验收分支领先 5 个提交。`merge-tree` 对 6 个并发文件零结构/文本冲突，合并提交
  `524a55b35dadfd1e8bd1ef89b0abc2baadf69066` 同时保留邀请四态、安全响应头、Phase 72 与双项目
  `deploymentEnabled=false`；
- **合并后门禁**：focused Web 224/224、API 串行 529/529、关键 Playwright 33/33、Web/API typecheck 与
  Web build 通过；完整 `verify:macos` 再通过 240/240 脚本测试、476 个 Vitest 文件（2,899 passed / 12
  skipped）、Store 481/481 与 92.66% statements、Playwright 111/111、全仓 build 和零 high production
  vulnerability；首次并行 API 检查的四个 10 秒 hook timeout 经单独串行重跑全部通过；
- **真实部署**：推送双关闭候选后 Web/API 保持 7/15 条非 Canceled。只 arm Web 的独立提交
  `f3feff1252673e715a5624c9539f04d8078a5d4b` 仅产生 Production deployment
  `DU6wE2r9ZLeSSoAMZAbsQihBjC72`，source 精确匹配且 15 秒 Ready；记录出现后立即推送独立 disarm
  `d6d901c`。最终 Web/API 为 8/15，Web latest 仍为该 arm deployment，API latest 仍为
  `39094d0` / `9jbyfnAvZwpa3Ci7YU6s6asmNZNG`，两份配置均为布尔 `false`；
- **live 只读结果**：真实 `/practice` 返回 `Hosted 验收 · f3feff1`，显示七项分组导航、今日练习内容优先
  空态与新视觉，无管理或外部 mutation。`/admin` 仍保持已登录 session，但部署耗时使 15 分钟密码
  recent-auth 自然过期，页面准确回到“重新确认 Operator 身份”；后续必须由用户本人重新输入当前密码；
- **边界**：本阶段未修改 API deployment、Supabase、DNS、Vercel environment 或密钥，未创建/撤销
  邀请、发送邮件、切换 kill switch 或调用 DeepSeek。普通邀请、OTP/Auth SMTP、R3-C、Cron 与 Cloud
  DeepSeek 依赖链不因 UI 部署而被标记完成。

## 67. Hosted 剩余门代码审计与 Provider/Cron 校准（2026-08-24）

- **审计范围**：逐项复核 R3-C worker/Resend sender/production composition、五项 Supabase Cron、四条
  DeepSeek 付费路径、Hosted 动作账本与发布清单；未访问 Supabase/Resend/DeepSeek/Vercel，也未读取或
  修改任何密钥；
- **DeepSeek Fresh RED**：Provider envelope 的 `model` 过去只要求非空，parser 丢弃该字段；新增回归用
  其他非空模型取得了错误的成功结果，并显示元数据仍被强制写成 `deepseek-v4-flash`。GREEN 在四条付费
  路径共用的 response schema 处改为 exact literal，错误模型现在失败关闭；
- **Cron Fresh RED**：API environment 过去接受 513 字符 `CRON_SECRET`，与 Supabase SQL 的 32–512
  契约不一致；GREEN 增加 512 上限并覆盖 31/32/512/513 边界。Cron SQL 回归还精确提取五个
  unschedule 名称并要求每个 job/path 在 allowlist 与 schedule 中各出现一次；
- **生产组合补证**：PGlite acceptance 现在同时证明 durable dispatch、request/ledger 价格 UUID 一致、
  reservation settled、64/0/32 usage、实际 cost、单条 succeeded ledger 和 model metadata，而不再只统计
  records/candidates/ledger 行数；
- **完整验证**：focused 7 files / 32 tests、Hosted deployment script 4/4、API full 138 files / 531
  tests、API strict typecheck/build 与目标 lint 通过；完整 `pnpm verify:macos` 原样退出 0，覆盖 240/240
  scripts、476 个 Vitest files（2,901 passed / 12 skipped）、Store 481/481、Playwright 111/111、全仓
  format/lint/typecheck/build/architecture/release/audit/diff；
- **边界**：真实 R3-C、Cron 安装/重复执行、DeepSeek 90 秒 timeout/实际账单、备份、目标网络与 Windows
  最终批次继续保持 pending。

## 68. Hosted runtime 安全只读快照与运营台复核（2026-08-24）

- **真实运营台只读证据**：用户在 Hosted `/admin` 重新提交当前密码后，同一会话显示完整四区、1 个
  active account、0 个 Extension device、当月 1,000,000 μUSD、邀请 1 条已领取/3 条已撤销；终态行
  均无撤销入口。kill-switch 按钮仍显示“关闭模型熔断”，因此熔断保持开启；页面无可见 alert/error；
  本轮未点击任何创建、撤销、额度、账号、设备或 kill-switch 控件；
- **工具与数据最小化**：新增 `acceptance:hosted:runtime:plan|snapshot`。snapshot 固定 Singapore project
  ref，只用一个 verify-full `BEGIN READ ONLY` 事务，输出 31 个有序 boolean/enum/count；只读 Vault 的
  两个名称，不输出 secret、邮箱、用户/请求/通知 ID、原文、result、金额或原始错误；
- **三组门**：R3-C 覆盖五类状态、claimable/超窗/max attempts 与 23 小时/8 次/lease/sent 合同；Cron
  覆盖三个 extension、exact 五项 active minute job/command、函数合同与 ACL；DeepSeek 自动选择 latest
  request，核对 dispatch、Hosted 三价、settled reservation、1–2 个连续 billed call、逐 call cost、
  ledger outcome、terminal record 与固定 `deepseek-v4-flash`/prompt/schema metadata；
- **Fresh RED 与复审修正**：先证明模块缺失；实现后又捕获并修复 boolean `true/false` 与 parser `t/f`
  不一致，以及 3+ billed calls 仍可能误报 reconciled 的缺口。CLI/parser 151 行、SQL 313 行，均低于
  400 行；恶意、额外、乱序或越界数据库输出全部固定失败且不反射；
- **完整验证**：新增 Node 回归 5/5、scripts 245/245；`pnpm verify:macos` 原样退出 0，覆盖 476 个 Vitest
  files（2,901 passed / 12 skipped）、Store 481/481、Playwright 111/111、全仓 format/lint/typecheck/
  build/architecture/release/audit。实际 Hosted snapshot、邮件、Cron、DeepSeek、Supabase/Vercel 写入均
  未执行，真实外部门继续 pending。

## 69. Phase 78 API-only one-shot deploy/disarm（2026-08-24）

- **只读基线**：执行前本地 HEAD、upstream 均为
  `f0ae5acdf8c588090451a7caaf62ebe825a57d9b`，工作树干净，API/Web
  `deploymentEnabled=false`。Vercel 默认排除 Canceled 的 API/Web 计数为 15/8，in-flight 均为 0；
  Latest API 为 `39094d0c557b829138ec6f70b6fc838f4594ab9b` /
  `9jbyfnAvZwpa3Ci7YU6s6asmNZNG`，Latest Web 为
  `f3feff1252673e715a5624c9539f04d8078a5d4b` / `DU6wE2r9ZLeSSoAMZAbsQihBjC72`；
- **唯一 API 武装**：arm commit `4f1ce4a458fe138aeee6fb455b2dcc398a55555a` 只修改
  `apps/api/vercel.json`，Web 始终保持关闭；该提交于 UTC 00:47:17--00:47:20 推送。UTC 00:47:40
  出现唯一 API Production deployment `6QeRbqxgA88cFXggKekkr2axH9JM`，source 精确等于 arm SHA，
  首次回读处于 Building/Queued；
- **记录出现即独立关闭**：没有先等待 Ready、运行 smoke 或推送其他改动；独立 disarm
  `020e21efa13bafb795d70a369e4512e76c7f7ab6` 同样只修改 `apps/api/vercel.json`，于 UTC
  00:48:07--00:48:10 推送。该 deployment 于 UTC 00:48:46 Ready，构建时长 37 秒；
- **零额外 deployment 复核**：UTC 00:49:37 二次回读确认 API 非 Canceled 15→16、Latest 仍为上述
  Ready deployment，arm source 恰好 1 条、disarm source 0 条、in-flight 0；Web 仍为 8 条且 Latest
  不变，arm/disarm source 均为 0、in-flight 0。UTC 00:49:57 本地、远端与 upstream 均精确位于 disarm
  SHA，两份配置均为 `deploymentEnabled=false`，工作树干净；根侧独立复核得到相同计数、Latest、Ready
  与 disarm 零记录结论，production-app focused 回归 8/8 通过；
- **公网无写入 smoke**：UTC 00:53:19，custom-domain `GET /health` TLS/HTTP2 200，body 精确为
  `{"service":"huayi-cloud-api","status":"ok"}` 并返回 HSTS；无 Cookie 且带 exact Web Origin 的
  `GET /v1/auth/csrf` 精确 HTTP2 401 / `authentication_required`，同时返回 exact
  `Access-Control-Allow-Origin`、`Access-Control-Allow-Credentials: true` 与 `Vary: Origin`。该探针不
  写数据库、不发送邮件、不调用 DeepSeek；
- **边界与下一门**：本轮没有武装 Web，没有修改 Supabase、Custom SMTP、DNS、Vercel environment 或
  密钥，也没有创建邀请、发送邮件、切换 kill switch 或运行付费模型。Phase 76 API runtime 修复已上线；
  唯一普通邀请与 scanner-safe OTP/Auth SMTP 仍是下一道外部门，R3-C、Cron、DeepSeek、备份、自然使用
  与 Windows 最终批次仍保持 pending；
- **工具漂移已修复**：零网络 `acceptance:hosted:deployment --plan` 的 Fresh RED 精确捕获旧 API
  `39094d0` / 15 条及重复 `/admin` pending 门；最小 GREEN 现固定 Latest API `4f1ce4a` /
  `6QeRbqxgA88cFXggKekkr2axH9JM`、API/Web 16/8、独立 disarm `020e21e` 零新增和双关闭。当前依赖链从
  “明确授权一个收件人→创建唯一普通邀请”开始；Phase 77 snapshot 仍未连接 Hosted，普通邀请/OTP、R3-C、
  Cron、DeepSeek、备份、自然使用与 Windows 最终批次仍 pending。

## 70. Phase 79 Hosted Supabase Cron 受控运维工具（2026-08-24）

- **范围**：只修改 shared scripts/tests/package 与权威文档；未连接 Supabase/Vercel/Resend/DNS，未读取或
  修改实际 secret/environment，未发送邮件、调用 DeepSeek、安装或触发 Cron；基线保持 Phase 78
  API/Web 16/8 与双项目 `deploymentEnabled=false`；
- **Fresh RED**：新增测试先导入尚不存在的 `scripts/acceptance-hosted-cron.mjs`，`node --test` 精确因
  `ERR_MODULE_NOT_FOUND` 退出 1；
- **深模块**：plan 零联网；status 固定 Singapore project-ref，以一个 verify-full `BEGIN READ ONLY`
  事务输出 18 个有序 boolean/stage/count；apply 只接受 exact confirmation，按 preflight→完整 SQL 第一次
  →完整 SQL 第二次→独立 postflight 执行，且保留两次权威事务边界；
- **失败关闭**：preflight 在写前拒绝 migration/R3-C/Vault 名称/extension schema/unmanaged job/函数
  owner-overload-ACL 或 schema 任意额外 ACL edge 漂移；first/second/postflight 任一失败停止并只回固定
  stage。Vault status 只查名称，stdout/stderr、Authorization、身份、正文和 ID 均不反射；
- **continuity 边界**：Vercel Sensitive 不可回读，工具没有伪造 API/Vault `CRON_SECRET` 相等证据；真实
  apply 仍要求同源外部 continuity 与完整 R3-C 门，且第一次已提交后后续失败必须先 status，不能声称
  自动 rollback；
- **离线验证**：新回归 10/10，连同 Hosted deployment ledger focused 为 14/14；scripts 255/255、零网络
  plan、format、lint、全 workspace typecheck、instructions、architecture、development-blocked 与 Store
  release check 均通过；根任务随后完成 `pnpm verify:macos`，其中 111 条 Playwright E2E、全 workspace
  build 与 production dependency audit 也通过。真实 status/apply、五 job、两周期与故障恢复仍 pending。

## 71. Phase 80 普通邀请唯一性预检与同键恢复加固（2026-08-24）

- **真实预检停止写入**：Hosted `/admin` 对授权地址的精确搜索命中现有 First Operator 账号。普通邀请
  注册状态机要求新 profile，数据库 email 也唯一，因此本轮没有点击创建、没有新增邀请或发送邮件；
  下一次必须由用户明确授权一个未使用且不同于 Operator 的邮箱；
- **Fresh RED**：Web adapter 每次 mutation 都生成新 Idempotency-Key，创建按钮在 pending 时也未禁用；
  快速双击会发出多个创建请求。任意网络错误又错误显示“邀请未创建，请重试”，服务器已提交但响应
  丢失时会诱导以新键创建第二张邀请；
- **GREEN**：创建动作以 ref 单飞并禁用；adapter 在闭包内保存单次 UUID，模糊失败只允许同键恢复，
  strict 成功后才清除；新尝试开始先清除旧的一次性 path。UI 只显示“创建结果未知”和“安全恢复邀请
  结果”，不使用 Storage、不记录 key/token；
- **运营防误操作**：Hosted current action ledger 现在明确要求账号精确搜索为零且邮箱不同于 Operator；
  Vercel 空 project plan 显式标为历史 bootstrap-only，当前已有部署的 project 禁止运行其 apply/status；
  项目状态校准到 Phase 79，旧密码恢复计划中已完成/已取代的 Hosted 门不再显示为 pending；
- **验证与边界**：focused Web 16/16、Hosted/Vercel scripts 16/16、目标 Prettier 与 diff check 通过；
  完整 `pnpm verify:macos` 也通过，其中 111/111 Playwright E2E、全 workspace build、Store release
  check 与 production dependency audit 均通过，audit 报告无已知漏洞；
- **受控部署**：候选 `946e132` 在双关闭状态推送且零部署。Web-only arm
  `9b0860a91940e4f78968b3882af91ef5bf923b8a` 只新增 Ready Production deployment
  `V3NzjTYXtH7fb3WC2P6hpWR1twhb`，Web 非 Canceled 8→9；记录出现后立即以独立
  `1d1f5675ad461e9692358fd055dcf89973c1c25b` disarm，二次回读证明 disarm source 零 deployment、Web
  仍为 9 且无 in-flight。API 全程保持 16、Latest `4f1ce4a` / `6QeRbqxgA88cFXggKekkr2axH9JM`、无
  arm/disarm source 或 in-flight；最终 HEAD/upstream 为 `1d1f567` 且两份配置均为 `false`；
- **公网只读回归**：Hosted `/admin` 返回 200，HSTS/CSP 精确通过；实际
  `assets/index-uBOjGG5r.js` 显示 `Hosted 验收 · 9b0860a`，包含“安全恢复邀请结果”和结果未知文案，
  bundle secret scan 通过。Operator recent-auth 已自然过期，页面正确显示 15 分钟密码重新认证门；本轮
  没有代输密码、创建邀请或发送邮件。真实普通邀请仍等待未注册邮箱，本节不把本机 GREEN 冒充
  OTP/Auth SMTP 已完成。

## 72. Phase 81 Hosted Email OTP 位数漂移修正（2026-08-24）

- **真实故障**：唯一普通邀请提交密码注册后，Supabase Confirm sign up 邮件实际显示 8 位 OTP，而语见
  strict contract、API confirmation form、Web 文案与本地 config 均固定 6 位；前六位和后六位都不是
  有效验证码；
- **根因**：Hosted Supabase Authentication → Email 的 Email OTP length 实际为 8。Resend 仅承担 SMTP
  投递，不生成或裁剪 `{{ .Token }}`；Phase 72 只回读了 Redirect URLs 与模板，漏掉这一独立 Hosted
  Auth 值；
- **受控修正**：用户明确授权“仅修改这一项”后，只把 Hosted Email OTP length 从 8 保存为 6；独立
  页面重新加载回读为 6，Email OTP expiration 仍为 3600。未修改 Site URL、五条 Redirect URLs、Confirm
  sign up 模板、Custom SMTP、DNS、环境变量或密钥，也未发送邮件；
- **漂移防护**：新增 `acceptance:hosted:auth:status|apply`。status 对固定 Singapore project 只读 GET
  并精确要求 6；apply 需要 exact confirmation、仅 PATCH `mailer_otp_length`，随后重新 GET 验证，且
  输出不反射 access token；
- **本机候选验证**：同邀请 resend 与 0014 候选已通过 focused scripts 30/30、focused Vitest 8 files /
  67 tests、actual Web bundle Playwright 2/2，以及完整 `pnpm verify:macos`；完整门内 Node scripts
  262/262、Vitest 478 files、Store coverage 97 files / 481 tests、Playwright 111/111、workspace build、
  architecture、release checks 与 production audit 全部通过。API/Supabase 0014 镜像 byte-identical，
  `git diff --check` 与 tracked/untracked 敏感值模式扫描通过；
- **剩余门**：已发出的 8 位 OTP 不会被配置更新转换。当前注册仍须在同一 invitation claim/bound Auth
  identity 上安全重发新的六位 OTP；该能力完成并受控部署前，不创建第二张邀请、不删除 Auth user、
  不截取旧码，也不把 OTP/Auth SMTP journey 写成通过。

## 73. Phase 82 Hosted 重要批次备份与可重建证据门（2026-08-24）

- **审计缺口**：Supabase Free 没有可依赖的自动备份，但 Phase 81 ledger 仍直接从 0014 apply 开始，把
  “backup”留到后续发布项；migration dry-run、0014 离线回归或远端 head=13 都不能证明当前验收数据可恢复；
- **Fresh RED**：先新增深模块接口测试，
  `node --test scripts/acceptance-hosted-important-batch-backup.test.mjs` 首次以 `ERR_MODULE_NOT_FOUND` 失败；
  随后给 deployment ledger 增加 pre-0014 依赖断言，旧 plan 因缺
  `acceptance:hosted:backup:preflight` 及 pre-backup/rebuild 文案再次失败；最终安全审查新增 dirty worktree
  fixture，旧 verifier 5/6 通过、精确错误放行该 case，补 clean-candidate guard 后转绿；
- **离线 GREEN**：新增固定 project `kpadiulxkgckskcfydry`、batch `phase-81-0014` 的
  `acceptance:hosted:backup:plan|preflight|complete`。plan 零 filesystem/Git/network/write；两个 verifier
  只读本机 fixed artifacts，拒绝动态 project/path/operation，不提供 capture/restore；
- **证据合同**：pre/post dump 必须位于 ignored 且 `0700/0600` 的固定目录，manifest 与 dump filename/
  size/SHA-256、clean current HEAD、pre/post migration head 精确；工作树漂移、未知/partial/symlink/权限
  过宽/未 ignored/stale 一律失败。真实 dump 明确为 raw sensitive backup，不伪装脱敏且不进入
  stdout/log/Git；
- **可重建合同**：独立 scratch 只从 repository migrations + fictional seed 重建，manifest 只保存固定布尔与
  commit/migration head；必须证明 Hosted data absent 并先销毁 scratch。command exit、dump listing、静态
  migration tests 或手写 manifest 不能关闭该门；
- **账本接线**：当前顺序改为单独批准 pre capture/rebuild → `backup:preflight` → 0014 apply → post capture →
  `backup:complete` → API/Web 串行 deploy/disarm。focused 新模块与 ledger tests 10/10，完整 Node scripts
  268/268、instructions、全仓 format、ESLint 与全部 workspace typecheck 通过；真实 plan 只输出固定合同，
  实际 preflight 在当前 dirty candidate 且证据不存在的条件下按设计固定失败。真实 dump、restore、scratch
  rebuild、Supabase connection、0014 apply、邮件与部署均未执行，两个 evidence gate 仍 pending。
- **Executor readiness Fresh RED**：后续同一阶段先增加
  `acceptance-hosted-important-batch-backup-executor.test.mjs`，首次运行以目标 module
  `ERR_MODULE_NOT_FOUND` 失败；没有先补实现或把静态 plan 当成 capture；
- **工具事实校准**：本地 `supabase db dump --help` 证明 2.115.0 没有 custom-format flag，默认/`--data-only`/
  `--role-only` 是 Supabase-filtered SQL 路径；本机 `pg_dump`/`pg_restore`/`psql` 均为 14.6，而仓库/Hosted
  目标为 PG17。OrbStack Docker daemon 当前未运行，仓库也无 pinned scratch image digest；未启动 daemon、
  未 pull image、未连接 Supabase；
- **失败关闭 readiness GREEN**：新增固定 executor plan 与 pre/rebuild/post 三个 exact readiness interface。
  plan 零 I/O；readiness 只读 clean HEAD/ignore 与 allowlisted runtime verdict，任何动态 project/path/operation、
  dirty/unignored、PG17 runtime/scratch pin 缺失均 fixed failure。即使测试注入所有 runtime 为 ready，也因
  write executor 未 pinned 继续失败，证明不能写 dump/CA/partial/manifest/scratch；focused backup + executor
  当前为 18/18；Docker 检查强制使用本机 `unix:///var/run/docker.sock`，不继承可能指向远程 daemon 的
  `DOCKER_HOST`/`DOCKER_CONTEXT`；
- **覆盖声明纠偏**：未来 full-database custom archive 可在 coverage contract 后覆盖应用数据、migration
  history、Auth database rows 与 Storage metadata，但不包含 Storage object bytes、global roles 或 Hosted
  Auth provider/SMTP/DNS/Edge/environment config。Storage objects 必须证明为零，否则需单独 export；CLI
  roles/schema/data SQL 与 postgres-custom 不再混称；
- **仍未关闭**：当前没有 repository-pinned PG17 dump/restore runtime、pinned isolated-scratch image digest 或
  reviewed write executor；所以没有生成 pre/post dump 或 rebuild manifest，既有 evidence verifier 仍应失败，
  0014 仍不 ready。真实网络、数据库写、邮件、部署、migration、DeepSeek、DNS、SMTP、environment 与 key
  均未触碰。
- **离线复核**：focused executor + verifier + deployment ledger 18/18、完整 Node scripts 276/276、instructions、
  全仓 Prettier、ESLint 与全部 workspace typecheck 通过；本地 runtime inspector 只返回
  `dockerDaemonReady=false`、`pinnedPostgres17RuntimeReady=false`、`pinnedScratchRuntimeReady=false`、
  `supabaseCliPinned=true` 四个 allowlisted boolean，没有输出版本命令 raw stdout/stderr、路径、身份或秘密。

## 74. Phase 83 Hosted backup pinned runtime 与完整 platform lock 门（2026-08-24）

- **Fresh RED**：executor regression 先要求导出固定 PostgreSQL image、只检查 local digest/FileVault，并证明
  真实 child 不继承 `DOCKER_HOST`/`DOCKER_CONTEXT`；旧模块因缺少
  `hostedImportantBatchPostgresImage` export 直接 `SyntaxError`，不是先改实现后补测试。deployment ledger
  断言随后也因旧的“仓库没有 pinned PG17 runtime”文案 Fresh RED；
- **数据库 runtime 已固定**：唯一候选为
  `docker.io/supabase/postgres:17.6.1.159@sha256:86a2e078779e5bdccda1f6f6c5063aa9779a322d1fface5fb408d051909b230f`。
  该 tag 来自 pinned Supabase CLI 2.115.0，digest 通过只读 registry manifest inspection 取得；运行时不信任
  host PG14.6，只允许固定 `--host unix:///var/run/docker.sock` 的 daemon/local image inspect，不能 pull；
- **完整 scratch 仍失败关闭**：现有 migrations 读取 `auth.users`/`auth.identities`，Storage contract 读取
  `storage.objects`；只启动 PostgreSQL image 不能诚实证明 Supabase Auth/Storage platform baseline。CLI local
  stack 还会使用额外服务镜像；未把所有实际 digest 固定、local-only 验证并禁止隐式 pull 前，
  `pinnedScratchRuntimeReady=false`，write executor 也继续 unpinned；
- **秘密与静态加密契约**：未来 container writer 不把 `PGPASSWORD` 放入 Docker env/argument，而只允许固定
  `0600 .pgpass`/CA read-only mount 和固定 `PGPASSFILE`/`PGSSLROOTCERT` path；当前 macOS gate 只接受
  `fdesetup status` 精确 `FileVault is On.`。partial/fsync/atomic rename/directory fsync/manifest-last 与固定
  cleanup 仍是必选，不是调用者参数；
- **离线 GREEN 与边界**：executor focused 9/9，backup+executor+deployment 19/19。真实 runtime inspector 的
  fake-Docker regression 在父进程故意设置 remote selector 时观察到两个 Docker child 均为 `unset|unset`；
  allowlisted verdict 新增 `artifactEncryptionReady`。本阶段没有启动 OrbStack、pull/run image、连接 Supabase、
  dump/restore、生成 evidence、执行 migration/dry-run、部署、发邮件、调用 DeepSeek 或修改任何 Hosted 配置。
- **独立回读与完整门**：根审查从 Docker Hub registry manifest API 只读回读 tag，响应为 OCI image index 且
  `Docker-Content-Digest` 精确等于上方固定 digest；未 pull image。最终 `pnpm verify:macos` 原样退出 0，覆盖
  Node scripts 277/277、Vitest 478 files / 2917 tests（12 个预期 skip）、Store coverage 97 files / 481 tests、
  build/architecture、Playwright 111/111 与 production audit 零已知漏洞。

## 75. Phase 84 Hosted Supabase 完整 platform image lock（2026-08-24）

- **Fresh RED**：新增 platform-lock interface test，首次运行因目标
  `acceptance-hosted-supabase-platform-lock.mjs` 不存在而以 `ERR_MODULE_NOT_FOUND` 失败；
- **完整集合证据**：只读 clone 官方 `supabase/cli` tag `v2.115.0`（source commit
  `18ae43a34a2257458197b62f74e2a97e2b5cf7f9`），由 embedded Dockerfile、默认 config、start gate/service
  source 与仓库 `supabase/config.toml` 联合派生，不使用手写清单或 binary strings 充当 complete proof。
  固定 config 无 exclude/env/version override，14 个 service 精确为 11 active + 3 disabled；
- **双平台 digest**：11 个 active exact tag 只通过 Docker Hub Registry v2 primary endpoint 回读；每个响应的
  `Docker-Content-Digest` 与响应 body SHA-256 一致。lock 同时保存 OCI/Docker index digest 与
  `linux/amd64`、`linux/arm64` platform manifest digest；Bearer token 只存在于请求进程内，未输出或落盘；
- **离线门**：静态 verifier 零 Docker/零 network，校验 CLI/version/source provenance、config gate、无 env/
  `.temp/*-version` override、service 完整性与所有 digest；根任务补充 Fresh RED，证明旧 verifier 会接受
  合法格式但错误的 digest，随后以独立 SHA-256 tripwire 绑定完整 lock 内容并转绿。local verifier 只生成固定
  `docker --host unix:///var/run/docker.sock image inspect ... <repo>@<index-digest>` argv，不继承 remote
  selector，也没有 pull/build/run/start/registry manifest interface；
- **仍失败关闭**：CLI 的 cache-miss resolver 会 pull，因此普通 `supabase start` 仍禁止。当前没有启动
  OrbStack/daemon、没有获取或运行镜像，也没有本机执行 local-images verifier；reviewed write executor、真实
  dump/restore/rebuild/evidence 仍不存在，0014 仍不 ready；
- **根任务独立回查**：再次从 GitHub 官方 commit 回读六个 source，SHA-256 结果 6/6 一致；再次从 Docker
  Hub Registry v2 回读全部 active tag，11 个 index header/body digest 与 22 个 amd64/arm64 manifest 均零
  mismatch。该回查只读 registry，未 pull 或运行 image；
- **GREEN**：platform lock + executor/deployment focused 19/19，Node scripts 283/283；零网络静态命令
  `pnpm acceptance:hosted:backup:platform-lock:verify` 回报 11 active / 3 disabled。首次完整门仅因新脚本
  Prettier 排版失败；机械格式化后 `pnpm verify:macos` 原样退出 0，覆盖 instructions/format/lint/typecheck、
  Node scripts 283/283、全 Vitest、Store coverage 97 files / 481 tests、architecture/build、Playwright
  111/111、Store release 与 production audit 零已知漏洞。
- **提交与零部署**：候选以 `45f57bb`（`feat(build): lock hosted Supabase platform images`）提交并推送；随后
  从 Vercel Dashboard 只读回查，API 最新仍是 source `4f1ce4a` / deployment
  `6QeRbqxgA88cFXggKekkr2axH9JM`，Web 最新仍是 source `9b0860a` / deployment
  `V3NzjTYXtH7fb3WC2P6hpWR1twhb`，本批 push 零新增 deployment。

## 76. Phase 85 OrbStack socket 与真实 11-image local inspection（2026-08-24）

- **受控获取**：启动已批准的 OrbStack 后，只从 lock 读取 11 个 enabled `repository@indexDigest`，固定
  `--platform linux/arm64` 逐一 pull 成功；未使用 tag、未运行 container。获取结束后仓库仍为 clean
  `76303ea`，未连接 Supabase 或触发部署；
- **Fresh RED**：`pnpm acceptance:hosted:backup:platform-lock:local-images` 连续两次 exit 1；当前 OS 用户的真实
  `~/.orbstack/run/docker.sock` 是 Unix socket，而旧代码固定的 `/var/run/docker.sock` 不存在。
  回归测试先因新 resolver module 缺失与旧 argv 仍指向 `/var/run` 失败；
- **受控 resolver**：macOS 从 `os.userInfo().homedir` 派生当前用户 OrbStack 固定 socket，直接调用 app 内
  absolute Docker executable；Linux 保留 `/var/run/docker.sock` 与 `/usr/bin/docker`。不读取 `HOME`、不搜索
  `PATH`、不接受调用者/env socket；`DOCKER_HOST`/`DOCKER_CONTEXT`（包括空值）、非 socket、非 executable
  或不支持平台均在 spawn 前失败。共享 bounded process adapter 的 child env 只有 `LANG`/`LC_ALL`；
- **第二个 RED**：固定 socket 后，11 个真实 `image inspect` 均 exit 0、OS=linux、Architecture=arm64，但旧
  verifier 全部因 `RepoDigests` 不包含带 `docker.io/` 的 reference 而误判。Docker 本机会把 Docker Hub
  repository canonicalize，且 `library/kong` 进一步显示为 `kong`；测试改用真实 canonical shape 后旧实现
  精确失败；
- **GREEN**：verifier 只接受锁定 repository 的 Docker Hub canonical name + 相同 index digest；不接受 ECR
  alias。修复 executor 不再用 256-byte 版本探针截断完整 image-inspect JSON，platform module 保留 32 KiB
  bound。根任务 fresh focused local-Docker/platform/executor/deployment 25/25；真实 11-image local inspection
  通过，检查/修复复跑只有固定 `image inspect`，未追加 pull，也没有
  run/start/build/manifest-network；
- **失败关闭证明**：只读 harness 保留真实 Docker/FileVault/Supabase runtime，五项 allowlisted verdict 均为
  true；注入 clean repository state 后 exact pre-readiness 仍 exit 1、stdout 为空、只输出固定 failed-closed
  消息，证明 blocker 精确是 `executorImplementationPinned=false`。没有连接 Supabase、执行 migration、部署、
  发送邮件、调用 DeepSeek，或修改 Hosted/DNS/environment/key；
- **完整门**：`pnpm verify:macos` 原样退出 0，覆盖 Node scripts 289/289、Vitest 478 files / 2917 tests
  （12 个预期 skip）、Store coverage 97 files / 481 tests、build/architecture、Playwright 111/111、Store
  release 与 production audit 零已知漏洞；
- **提交与零部署**：候选以 `2804f3d`（`fix(build): support OrbStack backup inspection`）提交并推送；Vercel
  Dashboard 只读回查确认 API 最新仍是 source `4f1ce4a` / deployment
  `6QeRbqxgA88cFXggKekkr2axH9JM`，Web 最新仍是 source `9b0860a` / deployment
  `V3NzjTYXtH7fb3WC2P6hpWR1twhb`，本批 push 零新增 deployment。

## 77. Phase 86 Hosted 重要批次 writer 与隔离 rebuild（2026-08-24）

- **Fresh RED**：先新增 artifacts/capture/rebuild 三个行为测试，首次统一运行因三个目标 module 均不存在，
  精确以 `ERR_MODULE_NOT_FOUND` 失败；没有连接 Hosted、启动 Docker 或先写实现；
- **原子 evidence writer**：固定 evidence root/project/batch/phase，只创建受限 `0700` 目录和 `0600` 文件。
  archive 先写 partial，关闭后两次 `fsync` 包围固定 TOC 校验，再计算 size/SHA-256、atomic rename、目录
  `fsync`；canonical manifest 最后采用同样的 partial/fsync/rename/目录 fsync。失败会移除固定 partial 与
  本次未完成 final，既有 evidence 永不覆盖；
- **Hosted capture 边界**：pre/post 只暴露两个 exact-confirmation 参数，固定 Singapore session pooler
  `5432`、verify-full 管理员、migration head 与 Storage objects 零值检查。实际 argv 只含无 tag 的 PostgreSQL
  index digest 与 `--pull never`；管理员密码只从 TTY 进入 `0600 .pgpass`，CA 只进入 `0600` 临时文件，两者
  read-only mount 且不进入 child env/argv/stdout/stderr。custom archive 的固定 TOC 必须同时覆盖 Auth rows、
  Storage metadata、应用 data 与 migration history；
- **隔离 rebuild**：固定 scratch name 与 label，`--network none`、无端口、无 bind/named volume，唯一 PGDATA
  为固定 tmpfs。只从仓库精确 14 条 migration 与 SHA-256 pinned fictional seed 建库；固定 baseline、migration
  chain、fictional seed、runtime 与 Hosted-data-absence contract 全部通过后，先删除 scratch 并回查不存在，
  才允许写 body-free rebuild manifest。启动、migration、验证、销毁任一失败都不保留 evidence；
- **深模块与动作账本**：新增共享 digest-only/local-Docker bounded process contract、capture、artifact writer、
  rebuild 与 TTY secret reader；executor 从 `executorImplementationPinned=false` 转为受审查 writer，package
  只增加 pre capture/rebuild/post capture 三个确认入口。Hosted deployment action ledger 继续强制
  readiness → pre capture/rebuild → backup preflight → 0014 → post capture → completion → API/Web 串行部署；
- **根任务审查修复**：新增回归先证明旧 TOC matcher 会接受仅包含目标片段的伪造前缀行，再把四条 coverage
  约束为真实 `pg_restore --list` 完整行；另以 Fresh RED 证明未知 evidence entry 与 verify 期间同尺寸内容变更
  会被旧 artifact writer 放行，修复为连接数据库前目录精确为空、TOC 前后 size + SHA-256 均一致。原
  migration/verification failure fixture 实际在 runtime inspect 提前退出，也已校准为真正到达对应 SQL 分支；
  TTY secret reader 新增注入回归，固定缺 CA 时零 password read，且不得从 `PGPASSWORD` 或
  `SUPABASE_DB_PASSWORD` 取值。最后一个 Fresh RED 证明 `pg_dump` client timeout 时旧实现无法定位并清理
  仍在运行的容器；修复后每个 capture step 使用固定 name/label，启动前确认不存在，结束后只删除精确
  digest+label 的自身 identity 并再次 inspect；独立只读审查随后拦截三项真实缺陷：readline 在 TTY echo
  关闭后仍 redraw 密码、timeout 杀死 Docker client 后过早返回导致 daemon 可晚创建容器、rebuild start race
  会无条件删除未知同名容器。修复后 TTY 改为 echo-before-prompt 的隔离有界 byte reader，真实 macOS PTY
  证明虚构 marker 零回显；bounded process 等待 child `close`，capture 覆盖约 4.9 秒 late-create 窗口；
  rebuild 删除前校验完整 scratch identity；
- **离线 GREEN**：focused backup/executor/platform-lock/local-Docker/deployment 共 59/59，完整 Node scripts
  317/317；全仓 Prettier、ESLint 与全部 workspace typecheck 通过。测试只使用 fake process、fictional
  archive 与本机临时目录，覆盖 secret 隔离、digest-only/无隐式 pull、固定 source set、原子提交、所有失败
  cleanup 与 scratch-destroy-before-manifest；
- **完整 macOS 门禁**：三项独立审查修复后以及 OrbStack absent inspect 契约修复后均重新运行
  `pnpm verify:macos` 并原样退出 0；最新一轮覆盖 Node scripts 318/318、Vitest 478 files / 2917 tests
  （12 个预期 skip）、Store coverage 97 files / 481 tests、全 workspace build/architecture、Playwright
  111/111、Store release 与 production audit 零已知漏洞；
- **提交与零部署**：writer 候选以 `231f848`（`feat(build): add hosted backup writer`）提交并推送；Vercel
  Dashboard 只读回查确认 API 最新仍是 source `4f1ce4a` / deployment
  `6QeRbqxgA88cFXggKekkr2axH9JM`，Web 最新仍是 source `9b0860a` / deployment
  `V3NzjTYXtH7fb3WC2P6hpWR1twhb`，本批 push 零新增 deployment；
- **首次真实 rebuild 的安全失败与修复**：clean `68144c1` 上 readiness 通过，但 exact rebuild 在 scratch
  start 前 exit 1；固定容器数回查为 0、evidence 不存在、Git 保持 clean。真实 OrbStack absent inspect 为
  exit 1 + stdout 精确 `[]\n`，旧 guard 只接受 empty stdout。Fresh RED 在 settle、capture 与 rebuild 三处
  精确失败；共享 strict absent predicate 修复后 focused 17/17、Node scripts 318/318，并继续拒绝空白、无换行
  `[]`、其它 JSON/文本、exit 0 与未知同名 identity。修复阶段没有运行 Docker/rebuild/capture、连接 Hosted、
  发送邮件或部署；
- **第二次真实 rebuild 的安全失败与修复**：clean `b329e97` 上 readiness 通过，但 exact rebuild 仍在 scratch
  start 前 exit 1；固定容器数回查为 0、evidence 不存在、Git 保持 clean。随后五次只读 OrbStack inspect 均为
  exit 1 + stdout 精确单个换行 `\n`。Fresh RED 再次在 settle、capture 与 rebuild 三处精确失败；共享 predicate
  只加入这一种 exact 形态，继续拒绝其它空白、无换行 `[]`、JSON/文本、exit 0 与未知同名 identity。第二次
  失败未启动 scratch、未生成 evidence、未连接 Hosted、未发送邮件、未产生 deployment；
- **实际执行边界**：pre/post capture 从未调用，Hosted dump/restore、真实 evidence、0014 dry-run/apply、
  邮件、部署与 DeepSeek 均未执行；但 exact rebuild 已在 clean `68144c1` 与 `b329e97` 上各调用一次，且两次
  都在 scratch start 前安全失败，零 scratch、零 evidence、零 Hosted/Supabase 连接。当前 pre/post capture、
  成功的 isolated rebuild 与两个 evidence gate 仍缺运行证据，0014 仍不 ready；Hosted/DNS/SMTP/
  environment/key 均未修改。

## 78. Phase 81 0014 安全 dry-run 单命令入口（2026-08-24）

- **Fresh RED**：新增 0014 dry-run 行为测试，首次运行仅因
  `scripts/acceptance-hosted-migration-0014-dry-run.mjs` 不存在而以 `ERR_MODULE_NOT_FOUND` 失败；没有调用
  Supabase CLI、网络或数据库；
- **秘密输入边界**：入口只接受固定 project `kpadiulxkgckskcfydry` 与 migration
  `20260824010000_password_signup_otp_resend.sql` 的 exact confirmation。额外/错误参数或调用者环境含
  `PGPASSWORD` / `SUPABASE_DB_PASSWORD` 时，在 TTY password read 前失败；复用 Phase 86 的共享 TTY
  reader，不使用 readline redraw；
- **固定进程契约（已被 §80 校正）**：只调用仓库 `node_modules/.bin/supabase`；本节候选当时把参数固定为
  session pooler `5432` 的无密码 URL 与 `db push --dry-run --skip-vault --db-url`，后续安全审查确认管理员
  migration 必须复用 transaction pooler `6543`，`5432` 只允许 application 隔离 verifier。`shell:false`，child env 只有 `LANG=C`、`LC_ALL=C` 与该
  进程级 `PGPASSWORD`，stdin 忽略、stderr 丢弃、stdout 有 byte/time 上限，密码不进入 argv、URL、日志或
  持久文件；
- **严格结果契约**：只有 stdout 精确包含 dry-run header、连接 marker、唯一 0014 与 finished marker 且
  exit 0 才输出固定成功消息；extra/missing migration、apply-like、未知文本、overflow、timeout 或非零退出
  均固定失败，不反射 raw output/secret；
- **离线 GREEN 与完整门**：0014 dry-run + 共享 TTY 聚焦回归 10/10，完整 Node scripts 326/326；
  `pnpm verify:macos` 原样退出 0，覆盖 instructions/format/lint/typecheck、Vitest 478 files / 2917 tests
  （12 个预期 skip）、Store coverage 97 files / 481 tests、workspace build/architecture、Playwright 111/111、
  Store release 与 production audit 零已知漏洞；全部新进程测试使用 fake child，没有外部 I/O；
- **当前执行边界**：本节只记录实现与 fake-process GREEN；真实入口尚未运行，Hosted/Supabase 未连接，
  0014 未 dry-run/apply，未发送邮件、未部署、未执行 pre/post capture 或 blocked rebuild diagnosis。

## 79. Phase 81 0014 TTY 取消失败关闭修复（2026-08-24）

- **真实 RED 与根因**：macOS `/usr/bin/expect` 对 exact pnpm package entry 在隐藏密码提示发送 Ctrl-C；旧实现
  无固定失败消息且 child status 为 `0:0`。直接 Node 对照被 SIGINT 杀死，而 pnpm 在同一前台进程组接收信号
  后吞掉退出，证明同步 `/dev/tty` read 使脚本无法可靠进入 `finally`/固定失败路径；共享提示同进程第一次
  取消也直接终止，不能执行第二次提示；
- **修复边界**：共享提示先保存 exact `stty -g`，临时设置 `-echo -icanon -isig min 1 time 0`；无 secret
  argv/env/file 的隔离 reader 只经私有 fd 3 返回最多 512 bytes，把 `0x03` 视为取消。父进程等待 reader
  close 后恢复原终端状态并进入既有固定失败路径；密码仍不进入 stdout/stderr，正常输入不 redraw；
- **GREEN**：真实 PTY 覆盖 exact package Ctrl-C 后唯一固定失败与 exit 1、零 dry-run/connection 输出；共享
  helper 连续取消两次均恢复 echo/canonical/ISIG 且 SIGINT listener 差值为 0，正常虚构密码仍零回显。
  注入测试另证明取消时 `runSupabase` 调用数为 0。聚焦回归 13/13、完整 Node scripts 329/329；
  `pnpm verify:macos` 原样 exit 0，覆盖 instructions/format/lint/typecheck、Vitest 478 files / 2917 passed
  （12 个预期 skip）、Store coverage 97 files / 481 passed、workspace build/architecture、Playwright 111/111、
  Store release 与 production audit 零已知漏洞；
- **实际执行边界**：只运行离线测试与本机 PTY；没有输入真实密码，没有启动 Supabase CLI、网络、数据库、
  Hosted、邮件、deployment、migration、capture、rebuild 或模型调用。

## 80. Phase 81 0014 transaction-pooler verify-full 单命令修复（2026-08-24）

- **Fresh RED 与根因**：权威安全契约要求 Hosted 管理 CLI 使用 transaction pooler `6543`，并显式加载
  Supabase CA + hostname 校验；`5432` 只例外用于 application 隔离 verifier。0014 dry-run 旧实现却使用
  session pooler `5432`，URL 没有 `sslmode=verify-full`，child env 也没有 `PGSSLROOTCERT/PGSSLMODE`。首轮回归
  精确显示 URL 止于 `/postgres`；端口交叉审查的 Fresh RED 又精确显示 actual `5432`、expected `6543`。
  因此“dry-run 不改库”不能证明管理员凭据发往了正确数据库；
- **单命令接口**：保留用户唯一命令 `pnpm acceptance:hosted:migration:0014:dry-run`，不增加 CA 环境变量或
  长 shell。后续 secret-last 校准改为先从仓库既有固定 Singapore 官方 CA URL 执行 GET，成功后才显示
  密码提示；Supabase child 仍只在 CA 与密码都有效后启动；
  `redirect=error`、no-store/no-credentials/no-referrer、10 秒/16 KiB，并要求 HTTP 200、final URL 精确、
  fatal UTF-8 与单一严格 PEM。固定 URL 允许官方 CA 轮换，当前 digest 只作读证而不长期 pin；
- **连接与清理**：复用 foundation 管理员 transaction pooler `6543`；URL 与 child env 双重固定
  verify-full；CA 只进入随机私有目录下的 `0600 root.crt` 和
  `PGSSLROOTCERT`，密码仍只进 `PGPASSWORD`。正常、overflow、timeout、`mkdtemp`、`writeFile`、spawn 或
  cleanup 失败都由 CLI 输出同一固定失败；有 child 的 overflow/timeout 路线等待 close，已创建临时目录的
  路线都尝试清理。`rm` failure 不伪造删除
  证据：只证明 cleanup attempted，真实发生时进入本机 cleanup incident 并在重试前人工清理固定前缀；
  可能残留的 `0700`/`0600` 公开 CA 不含密码；
- **离线 GREEN**：core/TLS 聚焦回归 13/13；两个手写测试文件分别低于 400 行。fixed fetch 测试拒绝
  status/redirect/body/size/UTF-8/PEM/timeout 漂移，process 测试验证 exact argv/env、0600 内容与删除；
- **官方 CA 只读证据**：2026-08-24 回查固定 URL 为 HTTP 200、final URL exact、1367 bytes，严格 PEM 正则
  通过；SHA-256 `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7` 只记录本次
  响应身份，不作为阻断合法官方轮换的长期 pin；
- **执行边界**：实现/测试未调用默认 fetch 或 Supabase CLI；未读取真实密码，未连接数据库、修改
  Supabase、发送邮件、部署、arm Vercel、运行模型，也未触碰暂停中的 isolated rebuild 诊断。

## 81. Phase 81 0014 受控 apply 单命令与精确 postflight（2026-08-24）

- **权威顺序与唯一缺口**：`hosted-important-batch-backup.md` 已固定 readiness → pre capture/rebuild →
  backup preflight → 0014 apply → post capture → completion → API/Web 串行部署；但真实 dry-run 之后仓库只有
  手工 `supabase db push` 这条越过 evidence、source identity 与 postflight 的缝隙。新增唯一 package 入口
  `pnpm acceptance:hosted:migration:0014:apply`，不改变 pre/post evidence 尚未生成、因此当前仍不可 apply 的
  阶段事实；
- **Fresh RED → GREEN**：首次新增行为测试因 apply 模块不存在而以 `ERR_MODULE_NOT_FOUND` 精确失败；部署动作
  账本另有 3 pass / 1 fail，证明旧顺序没有 exact apply 入口。实现后审查再以 9 pass / 1 fail 精确证明
  postflight 尚未绑定约束名、表达式及函数参数/返回列；收紧后 apply + deployment 聚焦测试 14/14 通过；
- **mutation 前封闭漂移**：同一受控执行先运行 backup preflight，再以隐藏 TTY 密码和固定官方 CA 执行 exact
  0014 dry-run；mutation 紧前第二次重跑 preflight，并重新校验 Supabase/API 两份 0014 byte-identical 且命中
  固定 SHA-256。任一 evidence、clean HEAD、migration source 或 dry-run 输出漂移均在 `--yes` apply 前失败；
- **固定 apply 契约**：只调用仓库 `node_modules/.bin/supabase`，参数固定为
  `db push --yes --skip-vault --db-url`、Singapore transaction pooler `6543` 与 verify-full；密码只进入该 child
  的 `PGPASSWORD`，CA 只进入随机私有目录下的 `0600 root.crt`，stdout/stderr/stdin 均不承载数据库输出或
  secret，timeout、spawn、非零退出和 cleanup failure 都固定失败；
- **精确只读 postflight**：apply exit 0 后使用 `BEGIN READ ONLY` 回查完整 canonical 14 条 migration chain/head；
  `invitation_claims.bound_email` 的 nullable `pg_catalog.text`、无 default/identity/generated、唯一固定 check 名、
  单列 conkey 与规范化表达式；`bind_auth_identity(text,uuid)` 的 SECURITY DEFINER/search_path 与
  `bound_email` 变更；`renew_interrupted_password_confirmation(text,text,timestamptz)` 的三入参、一 TABLE
  output、record/set-returning、SECURITY DEFINER/search_path；以及 EXECUTE ACL 恰为 owner +
  `huayi_context_setter`、均不可转授且 PUBLIC/business/runtime 无权。输出只接受精确 `t\n`；
- **不安全重试保护**：apply child exit 0 但 postflight 未通过时也绝不输出完成；统一提示
  `do not retry until remote state is checked`，要求先回查远端状态，避免把“迁移已落库但验证失败”误当作可
  直接重试；
- **离线完整门**：`pnpm verify:macos` 首轮原样退出 0：Node scripts 343/343、Vitest 478 files / 2917 pass
  （12 个预期 skip）、Store coverage 97 files / 481 pass、Playwright 111/111；instructions、Prettier、ESLint、
  workspace typecheck/build、architecture、Store release 与 production audit 均通过；
- **执行边界**：本阶段仅运行 fake-process/只读仓库测试与本机完整门；没有读取或索取真实密码，没有调用
  默认 CA fetch/Supabase CLI，没有连接或修改 Supabase，没有运行真实 dry-run/apply/capture/rebuild 或已暂停
  的 isolated-rebuild diagnostic，没有发送邮件、arm/deploy Vercel 或调用 DeepSeek/模型。pre capture、成功
  rebuild、pre evidence gate、真实 0014 apply、post capture 与 completion 仍须严格按既定顺序分别批准执行。

## 82. Phase 81 pre/post capture 固定官方 CA 单命令校准（2026-08-24）

- **Fresh RED 与根因**：capture secret reader 的旧 interface 强制调用方准备
  `HUAYI_HOSTED_DATABASE_CA_CERTIFICATE`；新回归注入 fixed-fetch adapter 后精确得到 3 fail / 1 pass，证明
  旧实现忽略 fetch、继续信任 caller CA，且无法让既有 pnpm 命令自足；
- **共享深模块**：把 §80 的固定 URL、GET、redirect rejection、no-store/no-credentials/no-referrer、10 秒/
  16 KiB、HTTP 200/final URL/fatal UTF-8/strict PEM 实现下沉为
  `acceptance-hosted-official-ca.mjs`。0014 dry-run/apply 与 pre/post capture 共用同一 interface，删除专用
  fetch 复制，保留 official URL 轮换能力而不长期 pin 某个证书 digest；
- **secret-last 与命令契约**：`pnpm acceptance:hosted:backup:capture:pre|post` 的名称、exact confirmation、
  project/phase/session-pooler/digest runtime/evidence 契约均不变。executor readiness 通过后先获取并校验公开
  CA，成功才读取隐藏管理员密码；fetch failure 为零 password read、零 Docker/数据库 child。调用方 CA env
  即使存在也不使用；CA 与密码仍分别只进入 `0600` CA/`.pgpass` read-only mount；
- **离线 GREEN**：共享 CA/TLS、0014 dry-run/apply、secret prompt 与 backup executor 聚焦回归 39/39；exact
  pnpm Ctrl-C 通过 `NODE_OPTIONS --import` 的 process-local fake fetch adapter 保持真实 macOS PTY 与零网络，
  继续证明唯一固定失败、exit 1、零 Supabase child。`pnpm verify:macos` 原样 exit 0：Node scripts 343/343、
  Vitest 478 files / 2,917 passed + 12 skipped、Store coverage 97 files / 481 passed、Playwright 111/111；
  instructions、format、lint、typecheck、build、architecture、Store release 与 production audit 均通过；
- **执行边界**：本阶段没有运行默认 fetch、真实 pre/post capture、rebuild、preflight/complete、dry-run/apply，
  没有读取密码、连接或修改 Supabase、发送邮件、部署或运行模型。真实 evidence 状态不因离线实现而改变。

## 83. Phase 81 OTP resend 同渲染周期单飞修复（2026-08-24）

- **缺口分类与选择原因**：阶段审计将真实 Hosted/目标网络/Windows/Store/模型等列为未验证，把 restore
  drill 实现与正式运营材料列为功能缺失；其中多数需要用户秘密、外部写入或独立批准。当前可离线执行且
  直接影响下一次六位 OTP 验收的最高价值问题，是 Web resend 竞态：组件只用 React `busy` 状态呈现禁用，
  没有同步互斥；API 每次请求都会轮换唯一 flow 并发邮件，因此重复调用不能由服务端限流安全吸收；
- **Fresh RED 与根因**：在 `auth-page.test.tsx` 用 deferred Promise 保持第一次 resend pending，并在同一
  `act`/同一渲染周期对同一按钮连续 `click()` 两次。原实现稳定得到
  `expected spy to be called once, but got 2 times`，证明 DOM 尚未因状态更新同步 disabled，根因是把异步
  state 误当同步锁；
- **最小 GREEN**：`AuthPage` 增加专用 `resendInFlight` ref，在读取内存 invitation token 后同步检查并占位，
  成功/失败都在 `finally` 释放；既有按钮 busy 文案、token-only API、双限流、数据库 flow 轮换、内存/DOM/
  Storage 边界均不改变。相同回归转绿，Web focused 为 45 files / 231 tests；
- **执行边界**：本阶段只修改 Web 组件、回归与文档；没有读取秘密、发送邮件、连接或修改 Supabase，未运行
  0014 dry-run/apply/capture/rebuild 或已暂停的 allowlisted-stage 诊断，没有 arm/deploy Vercel，也没有调用
  DeepSeek/真实模型。`pnpm verify:macos` 原样 exit 0：Node scripts 343/343、Vitest 478 files / 2,918 passed
  - 12 skipped、Store coverage 97 files / 481 passed、Playwright 111/111；instructions、format、lint、typecheck、
    build、architecture、development blocker、Store release 与 production audit 全部通过，生产依赖零已知漏洞。

## 84. Phase 81 Web 认证 mutation 共享同步单飞复审（2026-08-24）

- **审查范围与真实副作用链**：逐一追踪 `AuthPage` 的 register/login/resume 与 resend 到
  `WebIdentityApi`、Hono handler、Supabase Auth 和 identity repository。register 会依次验证 ticket、写 Auth
  flow、调用 `signUp`、绑定 identity；resume 会先 Provider 密码登录，再原子恢复邀请并创建 Web session；
  login 会 Provider 登录、校验已登记 method 并创建 Web session；错误页 resend 则轮换 flow 并请求发信。
  因此这些动作不是可安全重复的纯读取；
- **四条 Fresh RED**：新增独立 `auth-page-single-flight.test.tsx`，用 deferred Promise 固定首个请求 pending，
  并在同一 `act`/render/tick 双触发 register、login、resume；旧实现三条都稳定得到 `called 2 times`。错误页
  先触发 resend、同 tick 再触发 resume 时两者各调用一次，证明原 resend 专用 ref 不能阻止跨动作竞态；
  精确 RED 为 1 file / 4 failed；
- **深而窄的 GREEN seam**：组件只保留一个页面级 `authMutation(action)` interface；它在执行 async action 前
  同步占位，在 `finally` 统一释放。register/login/resume/resend 全部通过该 seam，删除专用
  `resendInFlight`；claim 继续使用独立初始化单飞门。相同回归与既有 AuthPage 行为合并为 2 files / 15
  passed，失败后的登录/恢复重试、token-only resend、StrictMode claim 和 UI busy 文案均保持；
- **完整候选门**：fresh `pnpm verify:macos` 原样 exit 0；Vitest 479 files / 2,922 passed + 12 skipped、
  Store coverage 97 files / 481 passed、Playwright 111/111，instructions、format、lint、全部 workspace
  typecheck/build、architecture、development blocker、Store release 与 production audit 全绿，生产依赖零已知
  漏洞；
- **执行边界**：本阶段只运行离线 fake adapter、组件测试和仓库门禁；没有调用默认网络、Supabase、0014、
  capture/rebuild、邮件、Vercel deploy/arm 或 DeepSeek/真实模型。真实六位 OTP journey 与部署状态不因该
  本机修复改变。

## 85. Phase 81 important-batch readiness 固定阶段诊断（2026-08-24）

- **Fresh RED 与根因**：新 CLI 回归分别要求 repository-state 与 runtime-inspection 固定阶段；首次运行
  `node --test scripts/acceptance-hosted-important-batch-readiness-diagnostic.test.mjs` 为 3 tests / 1 pass /
  2 fail，两处 actual 都仍是旧 generic。根因是 executor 顶层 catch 抹平 repository/runtime 边界，而
  runtime inspector 又把 Docker target 与 platform lock/local images 聚合成无法回推来源的同组 false；
- **结构化 GREEN**：独立深模块只返回 frozen `ready/failedStage/candidateCommit`；stage priority 固定为
  repository state → Docker target → Docker daemon → Supabase CLI → FileVault → platform lock → local
  platform images，unexpected inspector rejection 只映射为 runtime-inspection。runtime inspector 分别输出
  target/daemon/CLI/FileVault/lock/local-images boolean，process/lock/image rejection 只降级为 false；
- **安全边界**：readiness CLI 只渲染内部 allowlist 的首个 stage，拒绝动态 stage，不输出 raw Error、
  stdout/stderr、路径、digest、secret 或 environment。capture/rebuild 在 readiness 或执行失败时仍只输出
  `Hosted important-batch executor operation failed closed.`；三个 readiness 保持零网络、零 evidence/数据库写；
- **离线验证**：聚焦 executor/diagnostic 为 17/17，全部 Node scripts 为 348/348；首轮
  `pnpm verify:macos` 原样 exit 0，Vitest 479 files / 2,922 passed + 12 skipped、Store coverage 97 files /
  481 passed、Playwright 111/111，instructions、format、lint、全部 workspace typecheck/build、architecture、
  development blocker、Store release 与 production audit 全绿，生产依赖零已知漏洞。本阶段不运行真实
  readiness、capture/rebuild、0014 dry-run/apply，不连接外部服务、不发送邮件、不部署或运行模型。

## 86. R3-C Resend sender 精确 20 秒取消信号回归（2026-08-25）

- **证据缺口**：生产 sender 已直接调用 `AbortSignal.timeout(20_000)`，但既有 fake-fetch 测试没有观察
  timeout factory 参数，也没有断言生成的 signal 是否真正进入本次 RequestInit，因此“20 秒上限”只由
  源码文本间接支持；
- **Fresh RED**：在现有 sender interface 注入一个无计时器的 fake timeout factory，要求 exact
  `20_000` 单次调用和返回 signal identity；旧实现聚焦运行 2 tests / 1 failed，精确失败为 factory
  `expected ... to be called once, but got 0 times`；
- **最小 GREEN**：sender 构造模块只增加一个可选内部 factory seam，默认仍委托原生
  `AbortSignal.timeout(milliseconds)`；固定 Resend fetch 直接使用 `createTimeoutSignal(20_000)` 的返回值。
  HTTP endpoint/body/header/幂等、固定错误和生产 composition 调用均未改变；
- **验证与边界**：同一聚焦测试转为 2/2 passed，API strict typecheck/build、目标 Prettier 与
  `git diff --check` 通过；完整 `pnpm verify:macos` 原样 exit 0，覆盖 Vitest 479 files / 2,922 passed +
  12 skipped、Store coverage 97 files / 481 passed、Playwright 111/111、instructions、format、lint、全部
  workspace typecheck/build、architecture、development blocker、Store release 与 production audit，生产
  依赖零已知漏洞。sender 回归使用 fake fetch/signal，零真实等待、秘密或产品网络；本阶段未发送邮件、
  连接 Supabase、运行 0014/capture/rebuild、操作 Vercel deployment 或调用模型。真实 Resend
  401/5xx/timeout 恢复与收件/重复/无正文告警门仍未关闭。

## 87. Phase 88 五项 Cron 深度审计与 401 禁缓存修复（2026-08-25）

- **源码矩阵**：固定 SQL 与 status SQL 逐项一致地定义五个 `* * * * *` job/path、两个 Vault 名、运行时
  secret 读取、Bearer/Accept header、55 秒 timeout、五路径私有 allowlist、函数/schema ACL 与重复安装前
  unschedule；五条 API route 的 strict bounded response 分别由共享契约或本地 strict schema 约束。worker/
  repository 回归覆盖 password recovery 的 dispatch-before-provider 与 ambiguous receipt 不重发、data rights
  lease/fencing、ExtensionQuery 并发 `SKIP LOCKED`、duplicate suggestion 未 dispatch release/已 dispatch
  保守结算与唯一 ledger、security notification 的 notification-ID Provider 幂等与 retry fencing；
- **伪缺口排除**：Hosted postflight 的 `cron_installation_exact` 已由 SQL 联合 extension、Vault 名、jobs、
  function 与 ACL，不是只检查 count；两次 operations SQL 是两个明确提交的事务，second/postflight 失败后
  固定 stage + 先 status 再裁决是有意边界，不伪造自动 rollback。真实两个周期与 401/5xx/network-timeout
  恢复仍必须观察 `cron.job_run_details`/`net._http_response`，不能以 fake adapter 关闭；
- **Fresh RED 与根因**：五条 route 都在 Bearer 成功后才设置 no-store。新增 missing/wrong Bearer 回归后，
  focused 精确为 5 files / 12 tests 中 5 failed + 7 passed；五个失败都收到 401，但
  `cache-control` actual 为 `null`。旧测试只断言状态码，未覆盖认证与缓存策略交叉面；
- **共享 GREEN seam**：新增唯一 `requireCronBearer`，先固定 `private, no-store`，再校验 exact Bearer 前缀、
  等长 secret 与 `timingSafeEqual`；五条 route 删除复制逻辑并保留各自固定错误文案。route 回归覆盖 missing/
  wrong/success，actual production bundle 再逐路证明 401 + no-store；认证失败后的 worker 总调用仍只有成功
  请求一次。focused route/composition 为 6 files / 20 tests 全绿；
- **聚合离线证据**：Cron SQL、五 route、production composition 与五类 worker/repository 共 15 files /
  56 tests 全绿；Hosted plan/status/preflight/apply/postflight 10/10 全绿。测试只使用 PGlite/fake adapter，未
  访问 Supabase/Vault/Vercel/Resend/DeepSeek；
- **完整 macOS 门禁**：`pnpm verify:macos` 原样 exit 0，覆盖 instructions/format/lint、全部 workspace
  typecheck/build、Node scripts 348/348、Vitest 479 files / 2,922 passed + 12 skipped、Store coverage
  97 files / 481 passed、Playwright 111/111、architecture、development blocker、Store release 与
  production audit；生产依赖零已知漏洞；
- **剩余外部门**：API/Vault `CRON_SECRET` 同源连续、真实 status/apply 两次、exact 五 job、至少两个周期、
  401/5xx/timeout 后下一周期恢复、`pg_net` Beta/诊断保留、Vercel Function 观测、暂停/容量/告警与业务
  状态机真实部署幂等仍未验证。本阶段未运行 Hosted Cron/Vault/Supabase/Vercel、未发邮件、未部署、未
  调用模型，也未触碰 0014/capture/rebuild。

## 88. Phase 89 DeepSeek ExtensionQuery 失败计费闭环（2026-08-25）

- **完成矩阵**：四条生产付费路径继续固定 `deepseek-v4-flash`、唯一 endpoint、同一次最多 90 秒、peak
  reservation、dispatch-time 三 UUID 价格快照、durable dispatch、最多两次调用、exactly-once settlement、
  lease fencing/recovery、kill switch/60-hourly/300-daily rate limit、body-free error 与 owner/RLS；真实
  Provider model/usage/账单/价格行仍是外部门，离线 evidence 不替代 smoke；
- **Provider Fresh RED**：首次 compact output 无效后 repair 返回 503；旧错误虽为
  `model_unavailable`，但 `billedCalls`、usage 与 cost 全部为 `undefined`。最小 GREEN 只在 repair call 边界
  重抛同 code 并附首次严格 usage/cost；repair envelope 缺 usage 同样保留首 call，两次严格输出失败保留
  两条 call。Provider focused 为 5/5；
- **PGlite Fresh RED**：durable dispatch 后无任何 usage/cost 的 immediate failure 被旧实现写成 cost `0`、
  三个 token `0`。GREEN 在同一 owner transaction 内按 forced-RLS 与精确 reservation/request/status 读取
  reservation `500`，最终写 cost `500`、三个 token `null`、reservation `settled`；PGlite focused 6/6；
- **原子与隔离**：generation 先 `FOR UPDATE`；reservation immutable amount 只经 business SELECT 读取，
  既有 SECURITY DEFINER settlement 才取得 reservation `FOR UPDATE`、校验 active/调用数/总额并原子写
  ledger+settled。跨 owner、错 request 和重复 terminal 不能读取或再次结算；module 透传回归 7/7；
- **执行边界**：所有回归使用 fake HTTP 与 PGlite；未读取真实 key、未调用 DeepSeek、Supabase、Vercel、
  Resend，未发送邮件、部署或运行 0014/capture/rebuild。fresh `pnpm verify:macos` 原样 exit 0，覆盖 Node
  scripts 348/348、Vitest 479 files / 2,928 passed + 12 skipped、Store coverage 97 files / 481 passed、
  Playwright 111/111，以及 instructions、format、lint、全部 workspace typecheck/build、architecture、
  development blocker、Store release 与 production audit 零已知漏洞。

## 89. Phase 90 账号数据权利生命周期加固（2026-08-25）

- **候选与范围**：Phase 90 代码锚点 `9ab2c90`（`fix(api): harden account data rights lifecycle`）影响
  shared + macOS；Windows 支持保持，该代码锚点的 Windows 冻结批次验证仍 pending；
- **Fresh RED**：复现七项真实缺口——数据权利错误响应缺 no-store、logout 只接受 full session、受限
  页面没有退出入口、删除失败重试更换 Idempotency-Key、删除回执沿用七天、对象 expiry 从 snapshot
  而非 ready 计算、signed URL 只校验 origin 而未拒绝同源错误 bucket；
- **GREEN 与复核**：公开错误路径先写 `Cache-Control: private, no-store`，data-rights session 可退出，
  Web 在丢响应后复用同一删除 proof 并按会话边界清除，删除回执固定 24 小时，对象期限从 ready 计算，
  URL 绑定配置的 private bucket。根侧 focused 复核 69/69 全绿；独立完整 `pnpm verify:macos` 原样退出 0；
- **外部门保持**：没有 migration、Supabase/Storage/Auth 外部写、邮件、Vercel deployment、DeepSeek、
  0014、capture 或 rebuild。真实 private Storage、Auth 删除、Hosted 浏览器旅程和 Windows 候选门仍 pending；
  现有 API/Web 远端 deployment/disarm 基线未由本次离线修复改变。

## 90. Phase 81 真实 0014 dry-run 回执（2026-08-25）

- **原始证据**：用户返回 Supabase child transcript，依次为 non-mutating dry-run header、remote database
  connection marker、`Would push these migrations:`、唯一
  `20260824010000_password_signup_otp_resend.sql` 与 `Finished supabase db push.`；没有第二条 migration、
  apply marker 或额外输出；
- **严格复核**：该五行 transcript 匹配 `parseHostedMigration0014DryRunOutput` 的 exact contract；项目符号无
  前导空格属于 parser 明确允许的两种规范形式之一。header 明确 migrations 不会 push，因此本次数据库未
  修改。用户提供的是 raw child transcript，未把未提供的 wrapper 固定成功行记录为已观察输出；
- **状态边界**：真实 0014 dry-run 已完成，但 pre capture、成功 isolated rebuild、
  `acceptance:hosted:backup:preflight`、0014 apply、post capture/completion、API/Web 串行部署和六位 OTP
  journey 仍 pending。dry-run 不生成 backup evidence、不使 0014 ready，也不构成 apply 授权；
- **副作用边界**：本次只记录用户提供的只读回执；文档校准没有连接 Supabase、执行 migration、运行
  capture/rebuild、发送邮件、部署或调用模型，也没有恢复暂停中的 isolated rebuild 诊断。

## 91. Phase 81 isolated rebuild 最终 postmaster readiness 修复（2026-08-25）

- **真实失败与授权边界**：clean `699d16e` 已删除错误 PGDATA override，后续修复又等待最终 PID 1
  postmaster；但 clean `8916af5` 上的 exact rebuild 等满五分钟后仍固定失败关闭，readiness 随后继续通过且
  rebuild evidence 为空。用户随后明确批准继续安全诊断；本阶段
  只操作本机 OrbStack Unix socket 和既有 fixed-digest PostgreSQL 镜像，所有诊断容器均 `--network none`、
  无端口、无 bind/named volume，并在回读后立即删除；没有连接 Hosted/Supabase/Vercel/Resend/DeepSeek，
  没有读取秘密、运行 capture/0014、发送邮件或部署；
- **前一根因证据**：镜像入口会先启动初始化临时 postmaster。local-only probe 在约 250ms 即观察到
  `pg_isready` 成功，但 Auth/Storage baseline 在旧 15 秒窗口内不成立；有界延长观察显示 init scripts 继续
  正常运行，约 170 秒后才停止临时 server 并以 PID 1 启动最终 PostgreSQL。旧实现因此在临时 server 上
  提前执行 baseline 并主动销毁 scratch，不是镜像退出、网络依赖或 digest/架构错误；
- **最终根因证据**：fixed digest 镜像为 Linux arm64，`Entrypoint=["docker-entrypoint.sh"]`、
  `Cmd=["postgres","-D","/etc/postgresql"]`、`WorkingDir="/"`、`Volumes=null`。最终 PID 1 为
  `postgres -D /etc/postgresql`，实际 PID 文件只有 `/var/lib/postgresql/data/postmaster.pid`，首行精确 bytes
  为 `31 0a`（`1\n`）；同一时刻 `pg_isready` exit 0 且 stdout 为空。镜像内 `head` 是 BusyBox 1.37，项目原
  probe 的 GNU 长选项 `head --lines=1` 实际 exit 1 且 stdout 为空，而 `head -n 1` exit 0 且 stdout 精确
  `1\n`。因此旧 probe 在五分钟内永远跳过 `pg_isready`，不是 PID、PGDATA、Docker stdout 或等待时长问题；
- **Fresh RED 与最小 GREEN**：先前回归让 `pg_isready` 从第一次就成功，同时让 postmaster PID 依次为临时
  值、带额外输出的伪 `1`、最后才是精确 `1\n`；旧实现以 generic rebuild failure 变红。最小修复在每次
  `pg_isready` 前先用固定 bounded `head` 读取 tmpfs `postmaster.pid`，只接受精确 `1\n`，并把总等待固定为
  五分钟；最终诊断再固定完整 BusyBox 兼容 argv，旧 `--lines=1` 以 generic rebuild failure 变红，只将参数
  改为 `head -n 1` 后同一回归转绿。所有其它 PID/额外输出/缺文件/超时仍失败关闭；
- **状态边界**：最终 debug 容器保持 `--network none`、零端口/volume/bind，验证新 probe 后已按精确
  image+label identity 删除并回查不存在；没有调用会生成 manifest 的真实 rebuild，evidence 目录继续为空。
  根任务提交 clean
  candidate 并重跑 readiness 后，才可再次执行唯一 exact rebuild；成功前不得运行 preflight 或 0014 apply。

## 92. Phase 81 isolated rebuild 脱敏阶段诊断候选（2026-08-25）

- **新确认的测试根因**：First Operator 邀请替换回归使用固定 `2026-08-25T01:00:00Z` expiry；系统时间越过
  该时刻后 `claim_invitation` 按生产规则返回 `NULL`，测试却没有断言领取结果，随后错误地期待 replacement
  被 claim 拒绝。测试改为相对当前事务时间生成 72 小时邀请，并先严格断言返回当前 invitation id；生产
  migration 未修改，focused Vitest 恢复 8/8；
- **诊断 Fresh RED → GREEN**：executor 回归先因不存在 `HostedImportantBatchRebuildStageError` export 失败；
  最小实现新增固定 stage 深模块，并让 rebuild 代码路径自行选择 source-validation、docker-target、scratch
  identity/start/runtime/readiness、baseline、migration ledger/application、fictional seed、final contract、scratch
  destroy 或 evidence persistence。CLI 只渲染该 allowlisted stage，raw Error/child output/路径/digest/secret/
  environment 全部丢弃；capture 与前置 write-readiness 仍 generic；
- **结构与本机 GREEN**：纯 baseline/ledger/final SQL 契约拆入独立模块，使主 rebuild writer 保持 400 行以下；
  focused Node 24/24 与 First Operator Vitest 8/8 通过。尚未提交 clean candidate，也尚未运行真实 exact
  rebuild；本节不证明 isolated rebuild、pre capture/preflight、0014、邮件或部署完成。

## 93. Phase 81 0014 真实失败的安全分类入口（2026-08-25）

- **已确认边界**：用户清除两个继承密码变量并重新运行 exact 0014 dry-run，隐藏提示后仍只得到 fixed
  fail-closed；数据库未修改，但原输出无法判断密码、TLS/连接、CLI exit 或 transcript drift。官方固定 CA
  随后只读获取成功，本机 pinned Supabase CLI 为 2.115.0；没有据此猜测密码错误；
- **Fresh RED → GREEN**：新增 exact diagnostic package entry 前先观察 module-not-found RED。实现后独立审查
  发现 Supabase CLI code 被错误套用 psql 语义、连接探针没有硬超时、throw 仍折叠为 generic；回归转红后
  分拆 classifier，连接固定 `connect_timeout=10` + 15 秒进程上限，并只报告六个内部 allowlisted failure
  stage。原始 stdout/stderr、Error、URL、路径、环境和密码一律不输出；
- **本机 cleanup**：发现 4 个历史 `huayi-hosted-0014-ca-*` 测试残留；逐个验证为 `0700`、仅含一个 119-byte
  虚构 PEM 后精确删除，回查剩余 0。没有删除未知目录或文件；
- **验证**：focused foundation/diagnostic/dry-run 36/36；完整 `pnpm verify:macos` 原样 exit 0，覆盖 Node
  scripts、Vitest 480 files、Store 97 files / 481 tests、Playwright 111/111、instructions/format/lint/typecheck、
  build/architecture/release/audit，生产依赖零已知漏洞；独立审查 route
  `961c41a2-3fae-476e-a78a-22849f8fa564` 已按 full-checks 记录通过；
- **待真实分类**：本阶段未读取管理员密码、未运行真实 diagnostic 的 connection/CLI probe，也未连接或
  修改 Hosted、运行 capture/rebuild/apply、发送邮件、部署或调用模型。操作者下一步只运行固定 diagnostic
  并返回五条脱敏 verdict；它不生成 backup evidence 或 apply 授权。

## 94. Phase 81 isolated rebuild 平台服务基线校准（2026-08-25）

- **真实阶段证据与根因**：脱敏阶段候选提交后，clean candidate readiness 通过，exact networkless rebuild
  精确失败在 allowlisted `baseline`。同 fixed-digest Postgres image 的本机只读 SQL 时间线稳定显示
  `auth.users` 与 Auth/Storage admin role 已存在，但 `auth.identities`、`storage.objects`、`storage.buckets`
  始终不存在；延长等待没有变化，排除单纯初始化时间不足。固定 platform lock/source 又确认 GoTrue migration
  以 `supabase_auth_admin` 执行，Storage migration 以 `supabase_storage_admin` 执行，服务表不是单一 Postgres
  image 自有初始化；
- **networkless proof**：一次性本机诊断保持 Postgres `--network none`、零 port/bind/volume，并让 digest-only
  GoTrue/Storage migration-only runner 依次共享 Postgres container network namespace。两者只经 loopback 使用
  固定虚构本地配置，完成后 `auth.users`、`auth.identities`、`storage.objects`、`storage.buckets` 与两个服务
  admin role 六项全部成立；所有诊断容器均按精确 identity 删除并回查 absent；
- **Fresh RED → GREEN**：新增 platform-baseline 测试先因 module 缺失变红；集成回归再精确证明旧 rebuild
  未等待 Postgres-image-owned schema、未运行服务 migration，也无法映射 service stage。实现后 readiness 在
  PID 1 + `pg_isready` 后继续要求 `auth.users`/`auth.schema_migrations`、`storage` schema 与两个 admin role；
  再严格执行 GoTrue `auth migrate` → Storage `migrate-call.js`。runner 固定 digest/name/label/command/env，
  `--pull never`、共享 networkless scratch namespace、零 port/bind/volume；成功回查 absent，timeout 只删除精确
  identity，且 timeout cleanup 还会核对固定 Entrypoint 与 environment identity；未知同名 identity 不删除；
  readiness 由尝试次数与真实五分钟单调时钟 deadline 双重限制。失败只报告 `auth-baseline` 或
  `storage-baseline`，销毁 scratch 且零 evidence；
- **离线验证**：platform baseline + rebuild + executor focused 27/27、全部 important-batch scripts 60/60；完整
  `pnpm verify:macos` 通过 instructions、Prettier、ESLint、typecheck、Node 368/368、Vitest 480 files / 2,935
  passed + 12 skipped、Store coverage 97 files / 481 tests、build、Playwright 111/111、Store release 与 production
  audit（零已知漏洞）。测试只使用 fake process/fictional config，没有运行真实 rebuild/capture/0014；
- **当前边界**：本节只完成离线实现、fake-process 回归与已批准的本机 networkless diagnosis；修复后的 exact
  rebuild、pre capture/preflight、0014 apply、post capture/completion、邮件、部署与模型均未运行。成功生成
  rebuild manifest 前，0014 仍不 ready。

## 95. Phase 81 fictional seed 静默执行校准（2026-08-25）

- **精确复现**：clean `13dee16` 的 exact networkless rebuild 通过 readiness、Postgres/Auth/Storage baseline、
  migration ledger 与 14 条 migration，随后固定失败在 allowlisted `fictional-seed`。同一固定镜像链路的
  有界分类只输出四个 predicate：seed 已执行、exit 0、stdout 非空、failure stage 为 fictional-seed；因此排除
  role/schema prerequisite、权限/search_path、镜像 architecture 与初始化时序；
- **根因与 Fresh RED**：`supabase/seed.sql` 顶层 `SELECT public.ensure_current_default_quota(...)` 返回随机
  quota UUID。事务和写入均成功，但 strict runner 同时要求 stdout 精确为空。源码回归先在旧 seed 上因存在
  顶层 `SELECT` 变红；
- **最小 GREEN**：只把该调用改为事务内匿名块的 `PERFORM`，固定虚构 profile/admin/quota 语义不变，并把
  rebuild 的 seed SHA-256 pin 更新为新内容。focused rebuild 9/9 与全部 important-batch scripts 61/61 通过；
- **根完整门**：`pnpm verify:macos` 通过 instructions、Prettier、ESLint、typecheck、Node scripts、Vitest
  480 files / 2,935 passed + 12 skipped、Store coverage 97 files / 481 tests、build、Playwright 111/111、Store
  release 与 production audit（零已知漏洞）；
- **真实本机 fixture**：同 digest-only Postgres→GoTrue→Storage、`--pull never`、networkless namespace、零
  port/bind/volume 的完整链路再次运行，seed exit 0 且 stdout 为空，final migration/seed/runtime/absence
  contract 全真，scratch destroyed。manifest 仅写入系统临时目录并在同一进程删除；三个固定容器均回查
  absent，仓库 rebuild evidence 文件仍为 0；
- **当前边界**：该 fixture 证明修复本身，但不替代 clean candidate 的正式 rebuild evidence。没有连接或修改
  Hosted Supabase、读取密码、运行 capture/preflight/0014、发送邮件、部署或调用模型；提交 clean candidate 与
  正式 rebuild 仍待继续。

## 96. Phase 81 current evidence 状态面与正式 rebuild 校准（2026-08-25）

- **正式 rebuild 证据**：clean `c61fa0b` 的 exact networkless rebuild 已通过 Postgres/Auth/Storage baseline、
  14 条 migration、fictional seed 与 final contract，随后销毁 scratch 并写入 strict canonical rebuild manifest；
  fixed scratch/Auth/Storage container 均回查 absent。该过程没有连接 Hosted/Supabase、读取管理员密码、运行
  pre/post capture 或 0014，也没有发送邮件、部署或调用模型；
- **Fresh RED**：质量门回查证明 `.prettierignore` 未排除 canonical evidence；backup plan 测试仍要求静态
  “have not yet completed successfully”；仓库没有 body-free status module/entrypoint。新增回归分别以 ignore
  mismatch、缺 export 与 `ERR_MODULE_NOT_FOUND` 变红；
- **最小 GREEN**：Prettier 只新增 `artifacts/hosted-important-batch-backups/**`，并由 guard 拒绝扩大成
  `artifacts/**`。plan 改为 state-neutral；新增 status 对 partial batch 的 present evidence 执行完整 strict
  validation，并只输出 pre/rebuild/post 的 present/valid/current 九个布尔值；参数、结构或读取异常均固定失败，
  不反射 path、timestamp、commit/hash、identity、dump metadata、raw error 或 secret；
- **真实只读回读**：本地 fixed status 在当前修改中的工作树输出 pre/post 均 absent，rebuild present+valid、
  current=false；这是当时 dirty-worktree 的历史快照，不对后续 ignored evidence 或 HEAD currentness 作任何
  推断。pre capture 与 isolated rebuild 已明确为可按任一顺序完成的独立 preflight prerequisite；
- **状态边界**：tracked release evidence 只保留上述历史回执；后续操作状态必须重新运行 `backup:status`，且
  preflight 前要求 `pre_current|t` 与 `rebuild_current|t` 同时成立。旧 manifest 不得覆盖、手改或冒充 current
  candidate evidence。未运行 Hosted write、0014、邮件、部署或 DeepSeek。

## 97. Phase 81 stale rebuild evidence 安全退役生命周期（2026-08-25）

- **发现的设计缺口**：候选推进会让 active rebuild manifest 保持 strict present+valid 但 current=false；writer
  又正确拒绝非空 leaf。既有合同只禁止覆盖、手改和冒充 current，没有既保留历史证据又释放 active leaf 的
  受控动作，操作者只能停住或违反证据合同；
- **Fresh RED → GREEN**：先新增 retirement 行为测试，首次因目标 module 不存在以
  `ERR_MODULE_NOT_FOUND` 变红；最小实现新增唯一 fixed-confirmation package entrypoint，要求 clean
  HEAD=upstream、active/history 双 ignore、active batch/leaf exact、strict canonical stale manifest 与
  `0700/0600`，并拒绝 current/invalid/extra/occupied evidence；
- **安全移动与失败关闭**：按 stale manifest 的 40-char candidate commit 建立不可覆盖的 clone-local
  `0700` history namespace，把整个 active rebuild leaf 原子 rename，fsync 两侧目录并保持 manifest `0600`。
  成功回归通过既有 status 证明 active rebuild absent；rename/fsync fault injection 证明至少保留 active/history
  中一份 evidence。所有 CLI 失败仅为 bounded fixed output，不反射 manifest body、路径、secret 或 raw error；
- **执行边界**：测试只使用系统临时目录、虚构 canonical manifest 与注入故障；没有运行真实 retirement/
  rebuild/capture/0014，没有连接或修改 Hosted、发送邮件、部署或调用模型。retained evidence 删除仍无入口，
  必须另行设计、批准和留证。

## 98. Phase 81 0014 不确定 apply 的只读三态状态入口（2026-08-25）

- **缺口与 Fresh RED**：真实 apply 返回固定“未产生 verified completion”，后续 safe diagnostic 只证明
  connection/dry-run 结果不再匹配 pending transcript，无法区分 migration 已应用、仍待应用或半应用；新增
  status 行为测试首次因 `acceptance-hosted-migration-0014-status.mjs` 不存在而以
  `ERR_MODULE_NOT_FOUND` 失败；
- **最小安全入口**：新增 fixed package confirmation，拒绝继承密码和动态 project/URL；内部顺序固定为
  official CA → hidden TTY → Singapore administrator transaction pooler `6543` 的 verify-full
  `BEGIN READ ONLY`。输出只可能是 `applied-exact`、`pending-exact` 或 fail-closed `uncertain`，不反射 raw
  psql/database/error/password；
- **catalog 三态证明**：PGlite 真实执行 baseline catalog 后，完整 13-chain 且 column/check/resend function
  absent、bind function 保持旧形态时返回 pending；应用 byte-identical 0014 并加入第 14 条 ledger 后，完整
  column/check、bind/resend function identity/security 与 owner/context-setter exact ACL 返回 applied；撤销
  context-setter ACL 后只返回 uncertain。该回归同时确认单 OUT-column `RETURNS TABLE` 在 `pg_proc` 的
  `prorettype` 为 `text`，不能错误断言为 `record`；
- **离线边界与真实回读**：Fresh GREEN 为 Node focused 47/47（其中包含 PGlite catalog 三态）与既有 0014
  API focused 4/4。随后操作者真实运行固定 status 入口，结果为
  `Hosted 0014 migration status: uncertain; do not retry apply.`；该结果不证明 applied 或 pending，因此没有重试
  apply、没有运行 post capture，也没有发送邮件、部署或修改 ignored pre/rebuild evidence。下一步只能运行下述固定
  只读诊断。

- **uncertain 后的可定位诊断**：为真实 status 的 `uncertain` 新增
  `acceptance:hosted:migration:0014:status:diagnose`。Fresh RED 同时固定新模块缺失，以及 apply postflight
  错把单 OUT-column `RETURNS TABLE` 的 `prorettype=text` 断言为 `record`；GREEN 后固定输出 query exit class、
  output exact、12 个 catalog `t/f` 和 final status。PGlite 覆盖 exact pending、exact applied 与单 ACL drift，
  注入测试覆盖 psql code `1/2/3/null/other` 和非法/额外输出，均不反射 private detail。本入口与 postflight
  修复只在本地测试，未运行 Hosted、apply 或 post capture。
- **真实连接分类与本地修复**：操作者运行 status diagnostic 得到
  `status_query_exit_class|connection_error`、`status_query_output_exact|f`、12 个 false 谓词和
  `final_status|uncertain`。该结果仅证明初版固定的 session pooler `5432` 在当前环境不可用；它没有证明密码
  错误，也没有执行 catalog SQL，因此全 false 不能解释为远端对象 absent。Fresh RED 精确显示两个只读入口
  actual `5432`、expected 已由管理员 dry-run/apply 验证的 transaction pooler `6543`；最小 GREEN 将两者统一
  到既有 `hostedAcceptancePoolerUrl`，保留 verify-full/`BEGIN READ ONLY`，diagnostic 另保留
  `connect_timeout=10` 与 30 秒上限。本地修复阶段没有再次连接 Hosted。
- **6543 真实 catalog 回读与 ACL 定位缺口**：修复后操作者再次运行固定 status diagnostic，得到
  `status_query_exit_class|ok`、`status_query_output_exact|t`、14-chain/column/check/bind function/renew
  function applied predicate 全 true，但 `bind_acl_exact|f`、`renew_acl_exact|f`，最终仍为 `uncertain`。这证明
  0014 migration ledger 与对象主体已经写入，禁止重跑 0014；它尚不能单独证明具体多余或缺失的授权边。
- **ACL 分解 Fresh RED/GREEN**：新增 Hosted 自动给 `anon`、`authenticated`、`service_role` 授予函数
  `EXECUTE` 的 PGlite 复现，初次运行 9 项 status-diagnostic suite 有 7 项失败；实现 12 个核心谓词加
  bind/renew 各 10 个固定 ACL 分解项及 4 个 Data API roles / 全部 public SECURITY DEFINER 函数全局谓词后
  9/9 通过。分解只输出 allowlisted `t/f`，不会泄露 raw `proacl`、OID、函数名或未知角色名；尚未运行新的
  Hosted 回读、数据库写入或 post capture。

## 99. Phase 91 0014 ACL 根因确证与 0015 docs-first 决策（2026-08-25）

- **最终 Hosted 只读回读**：操作者在修复后的 6543 固定入口返回 `status_query_exit_class|ok`、
  `status_query_output_exact|t`。14-chain、0014 column/check/functions、setter effective、owner + setter
  direct、business/runtime denied、PUBLIC absent 与 other-role absent 全部为 true；bind/renew 的
  `anon`、`authenticated`、`service_role` direct-absence 六项均为 false，Data API roles 存在且全部 public
  SECURITY DEFINER API-role absence 为 false；`final_status|uncertain`；
- **确定结论**：0014 migration ledger 与结构已经完整应用，禁止重跑、改写或回滚。安全 postflight 失败不
  是密码、连接、半应用或 Huayi role grant 错误，根因精确为 Supabase API-role function grants；Hosted
  Data API 仍关闭，未观察到公网 RPC 调用，但数据库最小权限仍未满足；
- **SQL 语义复核**：PGlite Supabase-default fixture 在 104 个 public SECURITY DEFINER 上复现三个 API
  roles 全部可执行。只执行 schema-scoped PUBLIC default revoke 后创建 probe，PUBLIC/API roles 仍可执行；
  PostgreSQL 官方契约说明 per-schema defaults 不能抵消 global PUBLIC default。global PUBLIC/API-role
  revoke + public per-schema API-role revoke 的组合则让 probe 仅 owner 可执行，并保留 0014 context-setter
  grants；
- **docs-first 产物**：新增 `public-function-acl-hardening.md`，冻结 Phase 91 / 0015 的精确 SQL、三态、TDD、
  备份、dry-run/apply 与验收标准，并同步 README、architecture、security、testing、change-log、deployment、
  operations、checklist、implementation plan 与 project status；
- **执行边界**：本阶段只运行本机 PGlite/文档审查与既有 Hosted 只读诊断结果解释。未创建 0015、未连接或
  修改 Hosted、未运行旧 post capture/completion、未发送邮件、未部署、未运行 DeepSeek/Cron/R3-C；Phase
  81 pre 保留，下一写入只能在 Phase 91 独立 pre/rebuild/preflight 与用户明确批准后进行。

## 100. Phase 91 0015 本地候选与独立重要批次工具链（2026-08-26）

- **migration Fresh RED → GREEN**：先以缺少 API migration、Supabase mirror 与第 15 条 chain 的失败固定
  缺口；新增 byte-identical `0015-public-function-acl-hardening.sql`，从全部现有 public functions 撤销
  PUBLIC/三个 API roles，并同时收敛 owner=`postgres` 的 global function defaults 与 public per-schema
  API-role defaults。PGlite 复现 0014 后 Supabase grants、证明 schema-only PUBLIC revoke 不足，并验证 0015
  后 existing/probe/default ACL safe、0014 Huayi grants preserved 和完整 15-chain；
- **Hosted 控制面 Fresh RED → GREEN**：新增独立 0015 status/dry-run/apply。status 只接受 exact pending
  14-chain + 已知 drift 或 exact applied 15-chain + existing/default ACL safe + 0014 grants preserved；dry-run
  只接受唯一 0015 transcript；apply 在 secret 前和 mutation 紧前重查 Phase 91 evidence/source/hash，使用
  同一 secrets 紧邻回读并只接受 pending-exact 后才 mutation，再只接受 applied-exact read-only postflight。
  applied/uncertain/读取失败回归均证明零 mutation；参数、继承密码、CA/TTY/process/output 失败固定关闭且不反射；
- **独立恢复证据链**：新增 `phase-91-0015-public-function-acl-hardening` 的 writer/verifier、pre/post capture、
  15-file source loader、networkless scratch rebuild、partial status 与 executor。pre 固定 head 14，rebuild/post
  固定 head 15；Phase 81 loader 会拒绝当前 15-file repo，两个 batch 的目录、container/runner identity、head、
  manifest 和 package 命令不能互换；
- **2026-08-27 后续边界**：0016 加入 repository 后，Phase 91 变为严格历史批次；其 15-file/head 0015
  contract 保持不变并主动拒绝当前 16-file source set。尚未建立或执行 0016 的新 backup/rebuild/status/
  dry-run/apply 批次，不得把 Phase 91 evidence 当作 0016 连续性证明；
- **本地证据**：格式化后重新运行 focused Node 控制面 181/181、API/PGlite migration 6/6、拆分后 rebuild
  23/23，以及 targeted ESLint、Prettier、`git diff --check` 均通过。重建主模块从 403 行拆为 346 行执行器与
  67 行只读 source 模块；最终审查又将 514 行 0014 diagnostic 拆为 188 行 CLI/parser 与 336 行只读
  SQL/predicate renderer，将新触及的测试文件拆到 400 行以内，并新增 1 条真实 Phase 91 platform-baseline
  identity 回归。随后完整 `pnpm verify:macos` 原样退出 0：Node scripts 523/523、首批 Vitest 340 files
  （2,386 passed / 12 skipped）、API 141 files 554/554、Store coverage 97 files 481/481、Playwright 111/111；
  instructions、format、lint、typecheck、architecture、workspace build、development blocker、Store release、
  production audit 和 diff check 同轮通过；
- **执行边界**：本节没有连接或修改 Hosted，没有读取真实密码，没有运行 Phase 91 capture/status/dry-run/
  apply/post，没有发送邮件、部署、调用 DeepSeek/Cron/R3-C，也没有 commit/push。下一步是最终 diff 审查、
  clean candidate 与双平台 CI；之后仍需逐项明确授权。

## 101. Hosted Auth OTP status 凭据诊断与正式回读（2026-08-26）

- **固定失败与根因定位**：首次 status、受控 apply 和 apply 后 status 均只返回固定失败，不能证明远端值或
  PATCH 结果。新增 `acceptance:hosted:auth:diagnose` 的 Fresh RED 因诊断参数导出缺失而失败；GREEN 后入口
  只做固定项目 GET，并输出 Token 格式、请求到达、HTTP、JSON record、OTP 分类与最终契约六项；
- **零网络证据**：操作者在未设置 Supabase PAT 的同一终端首先得到 `token_format_exact|f`、
  `request_reached|not_run`，其余均 `not_run`/false；这证明该次诊断在本地凭据门停止，不把此前固定失败
  冒充为 Hosted 配置漂移或已写入证据；
- **真实只读回读**：操作者随后从 Supabase account token 页面取得 PAT，以终端隐藏输入只导出进程环境，
  诊断精确返回 Token true、request reached、HTTP 200、JSON record、`otp_length_state|six` 与
  `contract_exact|t`；紧接着正式 `pnpm acceptance:hosted:auth:status` 返回
  `Hosted Auth email OTP length verification passed.`，据此关闭本次 OTP length 门；
- **交付与边界**：没有再次运行 apply，没有把失败 apply 写成成功 mutation，没有显示 PAT 或原始 Auth
  配置，也没有发送/重发邮件或创建邀请。诊断修复已提交为 `2d03bd8` 并推送；该 exact SHA 的手动
  Cross-platform quality run `32940041074` 中 macOS 与 Windows job 均成功。

## 102. Phase 91 0015 Hosted 执行与原始 completion 回执缺口（2026-08-26）

- **写前状态与恢复点**：固定只读 status 返回 `pending-exact`。历史候选 `78bfd05` 随后完成 head-14 pre raw
  backup；独立 networkless rebuild 应用完整 15-chain 与 fictional seed、通过 final contract，并在销毁 scratch
  后写入 manifest；
- **唯一 migration**：exact dry-run 只列出
  `20260825010000_public_function_acl_hardening.sql` 且明确数据库未修改。用户另行批准后，受控 apply 只
  应用上述 migration，并以 `applied-exact` postflight 验证完整 15-chain、现有/default function ACL 与 0014
  Huayi grants；随后 head-15 post backup 捕获成功；
- **证据回读**：`acceptance:hosted:phase91:backup:status` 现对 pre/rebuild/post 均返回 present=true、
  valid=true、current=false。三份 manifest 均绑定 `78bfd05`；仓库后续推进是 currentness 变化的原因，不使
  历史证据失效，也不授权覆盖、手改或重捕；
- **原始回执边界**：未观察到 `acceptance:hosted:phase91:backup:complete` 的固定成功输出，仓库当时也没有
  独立 completion receipt。因此本检查点只能写成 migration 与三份恢复证据完成；不得把 post capture 成功
  冒充 completion 成功。后续等价历史 closure 见第 105 节。

## 103. API→Web 严格串行 one-shot 完成（2026-08-26）

- **preflight**：凭据与 Vercel/Git 只读契约通过，基线 state 随后按固定状态机推进；
- **API 窗口**：API arm `da733e1` 只产生一条目标 Ready deployment，canonical identity 为
  `dpl_AWUiTdYGgmVHZ127xqGAVhQb2zCd`；直接子 API disarm `b69e8d4` 通过独立 verify；
- **Web 窗口**：API 关闭证据冻结后，Web arm `699fbe6` 只产生一条目标 Ready deployment，canonical
  identity 为 `dpl_J6vtHUqfkstdGZ5w1yZJyVbhF6Yc`；直接子 Web disarm `4f8f96b` 通过独立 verify；
- **终态**：clone-local state 的 phase 为 `complete`，两个项目均恢复
  `deploymentEnabled=false`，没有 in-flight。该证据只关闭本轮部署窗口；它没有替代 Phase 91 completion，
  后者由第 105 节独立关闭。OTP/Auth SMTP、R3-C、Cron 或 DeepSeek 门仍未关闭。

## 104. 同一普通邀请重发/恢复 401 观测（2026-08-26）

- **页面状态**：现有私密 join 页面先显示邀请验证失败/过期类错误，并提供“重新发送六位验证码”与中断注册
  恢复入口；浏览器中当前普通账号仍可使用，用户确认其登录邮箱与恢复表单所填邮箱相同；
- **唯一重发动作**：在用户按动作明确授权后，只点击一次六位验证码重发。HTTP 返回 401，UI 显示失败，且
  没有收到或发送新邮件；因此不能声称同邀请重发成功；
- **恢复动作**：用户自行填写邮箱和密码后提交恢复；浏览器观测到两次 resume 请求均为 401，页面继续失败。
  本证据不记录邮箱、密码、Cookie、invitation/verification token 或响应正文；
- **结论与下一门**：当前账号可用不等于原 invitation claim/Auth identity 映射已证明，也不等于
  scanner-safe 六位 OTP journey。下一步先运行固定脱敏只读 Hosted snapshot，确认 invitation、claim、Auth
  identity 与账号状态；随后再收紧模板/redirect 自动门和错误引导，最后决定保留现有账号的原邀请恢复或
  另行批准替代邀请。诊断前禁止继续盲重试、创建第二邀请或删除 Auth user。

## 105. Phase 91 等价历史 completion closure（2026-08-26）

- **独立合同**：提交 `96e19af` 新增
  `acceptance:hosted:phase91:backup:historical:verify`。原 `backup:complete` 继续要求 manifest candidate 与
  当前 clean HEAD 精确相同；历史入口没有弱化或替换该门；
- **严格历史绑定**：新入口重新读取 pre/rebuild/post 三份 canonical manifest，重算两份实际 dump SHA-256，
  要求三者绑定同一 40 位 candidate，post 时间不早于 pre/rebuild，并要求该 candidate 仍存在且是当前
  clean、HEAD=upstream 的祖先。目录、文件、权限、大小、migration head 与 exact-entry 约束继续复用原严格
  verifier；
- **真实固定输出**：`96e19af` 推送后，工作树精确 clean 且 HEAD=upstream，实际执行
  `pnpm acceptance:hosted:phase91:backup:historical:verify` 退出 0，并固定返回
  `Hosted Phase 91 historical completion evidence passed.`。本节把该输出持久化为等价历史 closure；
- **验证与边界**：提交前完整 `pnpm verify:macos` 退出 0，包含新增脚本回归、141 个 API 测试文件、Store
  coverage、workspace build、111 条 E2E、Store release 与 production audit。该操作没有连接 Supabase、没有
  写数据库、没有重捕或改写 evidence，也不声称原 `backup:complete` 在 post capture 后曾经运行。新增 shared
  脚本的最终 Cross-platform quality 仍需另行批准执行。

## 106. Hosted Auth 模板门禁与 401 停止恢复引导（2026-08-26）

- **配置门禁 Fresh RED → GREEN**：先以缺少 invitation status 参数、全配置 verifier 与 package 入口的
  失败固定缺口；新增只读 `acceptance:hosted:auth:invitation:status`，只对固定项目执行一次 Management API
  GET，要求 Site URL、五条 query-aware Redirect URLs、OTP length/expiration 与 Confirm sign up 模板全部
  精确。模板固定只有一次 `{{ .Token }}` 与一次 `{{ .RedirectTo }}`，且不含
  `{{ .ConfirmationURL }}`；失败只输出固定句，不反射配置、凭据或响应正文；
- **Web 401 Fresh RED → GREEN**：两个回归先证明 resend/resume 401 仍会显示全部恢复控件并诱导继续重试。
  Web 现只对明确 401 进入停止恢复状态，隐藏重新验证、重发与继续注册三个入口，并用普通中文要求停止
  点击、联系发送邀请的人检查状态；resume 同时清空内存中的密码。网络或其他非 401 失败继续保留原可重试
  行为，API 的防枚举错误边界未改变；
- **验证证据**：Node Auth/deployment 20/20、Web Auth/单飞 17/17 先行通过；新增配置契约与既有
  deployment plan 的五条 Redirect URL 运行时值逐条一致。随后完整 `pnpm verify:macos` 原样退出 0：
  Node scripts 551/551、主 Vitest 341 files（2,388 passed / 12 skipped）、API 141 files / 554 tests、Store
  coverage 97 files / 481 tests、Playwright 111/111；instructions、format、lint、typecheck、architecture、
  workspace build、development blocker、Store release、production audit 与 diff check 均通过；
- **执行边界**：本节只修改本地代码、测试和文档，没有连接 Supabase、读取真实 PAT/管理员密码、回读或
  修改 Hosted 配置、发送邮件、重试邀请、部署、运行 Cron/R3-C/DeepSeek。真实 Hosted 配置回读与身份
  snapshot 均继续等待各自的单独明确批准。

## 107. Hosted runtime snapshot 与 Cron 候选门加固（2026-08-26）

- **候选绑定**：提交 `1caf9dcf21f24a4410043a8356a9b2a1dbf8f8d6`
  （`fix(build): harden hosted runtime and cron gates`）统一收紧 runtime snapshot 与 Cron status/apply。
  三个入口都获取固定官方 Supabase CA，随后从 `/dev/tty` 无回显读取管理员密码；环境对象自身拥有
  `PGPASSWORD` 或 `SUPABASE_DB_PASSWORD` 即失败，密码只接受 12–512 bytes 且拒绝 NUL/CR/LF；
- **来源先于秘密**：Cron apply 在 CA、prompt 和数据库前验证 operations SQL SHA-256 精确为
  `09a074addefdf352ff256ff958bb87a6775b911a7da9475ef697b04d2a64d604`，并要求 clean worktree、
  `HEAD==upstream`。每个 Git child 上限 10 秒；全部 runtime/Cron psql 上限 30 秒。snapshot/status parser
  只接受 exact final LF 且拒绝任何 CR；该顺序明确取代第 70 节 Phase 79 记录的“先 preflight、后静态
  operations 检查”；
- **回归证据**：focused Node 回归 23/23。transaction 内加入 `DROP TABLE`、同时仍满足旧
  `BEGIN`/`COMMIT`/五次 schedule 浅形状的变体被 exact hash 拒绝；runtime/Cron plan 均证明零 I/O；继承
  secret 的 package entry 门固定失败且 CA fetch、TTY prompt、network 均为零；
- **完整本地门**：fresh `pnpm verify:macos` 退出 0，包括 Node scripts 559/559、主 Vitest 341 files
  （2,388 passed / 12 skipped）、API 141 files / 554 tests、Store coverage 97 files / 481 tests、Playwright
  111/111，以及 instructions、format、lint、typecheck、architecture、workspace build、development blocker、
  Store release、production audit 和 diff check；独立审查没有发现 P0/P1/P2；
- **双平台候选门**：GitHub Cross-platform quality run `32970024964` 的 `headSha` 精确为上述完整提交，
  `macos-quality` 与 `windows-quality` 均在 2026-08-26 成功；
- **执行边界**：该提交之后没有运行真实 Hosted runtime snapshot、Cron status 或 Cron apply，也没有输入
  用户秘密。实际 Cron apply 仍被真实 R3-C 收件/重复/无正文告警与 Vercel/Vault `CRON_SECRET` 连续性
  阻塞；OTP/R3-C、Cloud Web DeepSeek 付费路径、数据权利、macOS/Windows Chrome、外部词库、自然使用和
  最终发布审查仍 pending。

## 108. Hosted Cloud Web DeepSeek one-shot 本地候选与 CI 待验收（2026-08-26）

- **候选与离线契约**：已推送 `28f587e9769847777db2ed287851881d81422d03`。CLI 只有零 I/O plan，未提供
  真实 executor；契约固定原子单次 approval/operation、operation/request/owner/idempotency、90 秒应用
  deadline、10 秒 cleanup、durable pending cleanup/recovery，以及 deployment SHA/ID 与 settlement/ledger/post
  evidence 绑定；
- **本地验证**：TDD focused 24/24、`test:scripts` 583/583 与 fresh `pnpm verify:macos` 均通过；完整 macOS
  门包含主 Vitest 341 files / 2,388 passed / 12 skipped、API 141 files / 554、Store 97 files / 481、Playwright
  111/111，以及 build、Store release、production audit 与 diff check；
- **CI 状态，不作替代推断**：exact-SHA GitHub Actions run `32985730194` 的 attempt 1 是 startup failure，零
  jobs、零 logs；重跑请求已提交，但在已确认的 GitHub Actions major outage 期间仍 queued，API 尚未生成
  attempt 2。该瞬时外部状态不是产品事实，也不构成 Windows 验证。旧 `dfbcb8f` 的 exact-SHA run
  `32982393993` 虽 macOS/Windows success，但发生在本候选审查前，不能代替 `28f587e` 的 Windows CI；
- **执行边界**：本阶段没有连接 Hosted、运行真实模型、读取秘密、输入 recent-auth Operator 凭据、使用 Hosted
  key/quota、发起付费请求、操作 kill switch 或生成账单/ledger settlement。Cloud V1 和发布均未完成；上述真实
  Web session、账单 reconciliation 与 live restore 继续等待逐项明确批准和验收。
