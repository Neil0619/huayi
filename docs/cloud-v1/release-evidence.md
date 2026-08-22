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
- 该证据只关闭 DNS/domain/TLS 配置门，不声明应用部署或 production readiness。Resend verified sender subdomain/DNS、production-only environment、Supabase Auth/SMTP 与真实应用部署仍 pending；旧 Resend key 已撤销且不可用。
