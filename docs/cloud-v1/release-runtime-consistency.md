# Phase 26B Cloud 发布运行时一致性审计方案

日期：2026-08-13
状态：离线实现与实现后复审已完成；`implemented; target-platform validation pending`

## 1. 问题与需求

Phase 26A 已让 production API 按 `HUAYI_STORE_EXTENSION_ID` 与
`HUAYI_MIN_SUPPORTED_EXTENSION_VERSION` 校验 Extension 请求，但 Phase 21 的
`check:cloud-release` 仍只接收候选 `HUAYI_RELEASE_EXTENSION_ID`：

- 审计只验证候选 ID 是 32 位 Chrome ID，不能证明 API 部署配置使用同一个 ID；
- 审计不接收最低兼容版本，也不能证明本次 Store 候选不会在发布后立即收到 426；
- API 环境 schema 只检查版本正则，超出 JavaScript 安全整数的三元组仍能通过启动，和 request-proof
  比较及候选审计的严格语义不一致；
- `release-evidence.md` 与 `operations.md` 只能要求人工比对，自动 `ready` 仍可能在公开配置漂移时通过。

Phase 26B 把这两个公开运行时事实纳入同一个离线候选审计。它不读取 secret、不访问部署平台、不修改
Store runtime URL、Manifest 权限、数据库、Classic 或 Host，也不替代真实 Chrome/部署验收。

## 2. 技术路线与深模块

继续使用 `scripts/check-cloud-release.mjs` 的既有深模块，不另建只透传环境变量的浅 module。API
environment schema 同时把最低版本的每一段收紧为安全整数，使部署在 composition 前失败，而不是等到
每个请求再返回 426。release-audit 外部 interface 扩展为：

```ts
interface CloudReleaseConfiguration {
  apiOrigin?: string;
  apiExtensionId?: string;
  extensionId?: string;
  minSupportedExtensionVersion?: string;
  privacyUrl?: string;
  webOrigin?: string;
}
```

CLI 只读取公开值：

- `HUAYI_RELEASE_EXTENSION_ID`：Chrome Dashboard/候选审批确认的发布 ID；
- `HUAYI_STORE_EXTENSION_ID`：准备写入 API 部署的同名公开运行时配置；
- `HUAYI_MIN_SUPPORTED_EXTENSION_VERSION`：准备写入 API 部署的最低客户端版本。

审计模块自行读取 source Manifest；既有 Store package audit 已证明 source/dist Manifest 完全一致。版本
比较使用严格、无前导零的 `major.minor.patch` 三个安全整数，不引入宽松 semver 或预发布标签。

规则：

1. 两个 Extension ID 都必须严格匹配 `[a-p]{32}`，并且完全相同；
2. 最低版本必须是严格数字三元组；
3. 候选 Manifest 版本必须大于或等于最低版本；
4. 缺失/非法 API ID 返回 `release-config-api-extension-id`；
5. 缺失/非法最低版本返回 `release-config-min-extension-version`；
6. 候选低于最低版本返回 `store-client-version-policy`；
7. 结果继续只包含固定 code/安全文案，不回显任何输入值。

API `parseApiEnvironment` 复用同一外部语义：非三段、前导零或任一段超出安全整数都拒绝启动。本阶段不
跨 package 导入脚本实现，也不创建共享 runtime 依赖；两处通过相同边界回归锁定一致行为。

`auditCloudRelease` 仍是唯一测试 surface。删除这项实现会把 ID/版本比对重新散回发布人员、运营文档和
部署平台，因此该 interface 增量具有实际深度与 locality。

## 3. 数据结构与安全边界

本阶段无业务数据或 migration。新增的三个输入都是公开发布元数据：

| 字段                           | 来源                      | 用途                      | 是否进入构建                        |
| ------------------------------ | ------------------------- | ------------------------- | ----------------------------------- |
| `extensionId`                  | Chrome Dashboard/候选审批 | 发布身份基准              | 不写入 Web；Store ID 由 Chrome 决定 |
| `apiExtensionId`               | API 部署公开配置          | 生成固定 Extension Origin | API runtime 环境                    |
| `minSupportedExtensionVersion` | 兼容策略审批              | 426 最低版本门槛          | API runtime 环境                    |
| candidate version              | Store source Manifest     | 证明候选可被 API 接受     | 已有 Store package                  |

审计器不得读取部署 secret、请求网络或自动修改 Vercel/Chrome 配置。ID 相等只能证明本次输入一致；正式
发布仍必须以目标部署与 Chrome Dashboard 的外部证据确认这些输入真实。

## 4. 单元测试与 TDD

### Fresh RED

1. 完整 fake 候选增加 API Extension ID 与最低版本，当前 audit interface 会忽略它们；
2. API ID 与候选 ID 不同必须得到 `release-config-api-extension-id`，当前会错误 ready；
3. 最低版本高于 Manifest 必须得到 `store-client-version-policy`，当前会错误 ready；
4. 缺失、前导零、非三段或超出安全整数的最低版本必须得到
   `release-config-min-extension-version`；
5. 空配置的固定阻塞集合从四个扩为六个，并继续证明结果不回显 origin/ID/version；
6. 相等 ID 且 `minimum <= candidate` 的完整 fixture 保持 ready。
7. API environment 对超出安全整数的最低版本先 RED，修复后在 production composition 前拒绝。

### GREEN 与回归

- 最小扩展现有配置解析、Manifest 版本读取与稳定 violation；
- `check-cloud-release` Node tests、当前真实开发态 expected-blocked 命令；
- 完整 `pnpm test`、typecheck、build、74 条离线 Playwright；
- targeted ESLint/Prettier、instructions、architecture、`git diff --check`；
- 不运行真实服务、Provider smoke、Chrome 安装或商店上传。

## 5. 验收标准

- Cloud release audit 不能在 API Extension ID 漂移时返回 ready；
- Cloud release audit 不能在候选版本低于 API 最低版本时返回 ready；
- API 不能以审计器会拒绝的最低版本配置成功启动；
- 严格版本比较覆盖主/次/补丁位、前导零和安全整数上限；
- 当前 null-origin/无正式配置开发态继续失败关闭且只输出固定安全消息；
- 既有 Store package、Web 构建、政策和披露审计行为不回归；
- 文档、实现记录、项目状态和 fresh gates 同步；
- 外部 Dashboard/部署真实性仍明确 pending，不用离线结果冒充生产验收。

## 6. 方案自审

- **需求完整性**：同时覆盖“候选是谁”“API 接受谁”“API 最低接受哪个版本”，修复 Phase 26A 留下的
  发布审批断点；
- **技术路线**：复用一个已有深模块和一个配置 interface，没有增加远程 adapter 或第二权威；
- **数据诚实性**：所有输入是公开发布元数据，无表、无 secret、无用户正文；
- **版本语义**：只实现当前产品已经规定的数字三元组，不引入 semver 范围或自动兼容推断；
- **失败安全**：缺失、非法、不一致或候选过旧全部阻塞 ready，错误不回显输入；
- **非目标清晰**：离线一致性不能证明 Chrome 实际 Origin、Dashboard ID、部署环境值或升级 UI；
- **结论**：本阶段运行时一致性路线合理；平台/BYOK 交互已经在 Phase 27 明确为账号全局显式模式、
  默认 platform、无自动 fallback，发布审计不得再把该选择列为未决项。

## 7. 实现记录

- 初始 fresh RED：8 个 Cloud release tests 中 3 类行为失败，证明空配置少两个阻塞项、API ID 漂移与
  候选低于最低版本都会错误 ready；
- 实现中最终审阅发现 API environment 的安全整数语义未与审计器一致，先修订本方案再增加环境 RED，
  不把偏差留给每请求 426；
- `check-cloud-release` 现读取 API Extension ID/最低版本，读取候选 source Manifest，并用严格安全整数
  三元组比较；新增三个固定阻塞 code，不回显任何输入；
- API environment 同步在 production composition 前拒绝超安全整数的最低版本；无 Manifest、数据库、
  Store runtime、Classic 或 Host 变更；
- focused Cloud/Store release tests 17/17、API environment + release audit 9/9 通过；最终 fresh 复验为
  112/112 repository script tests、368 个 Vitest 文件（2,447 passed / 12 skipped）、全 workspace
  typecheck/build、74/74 离线浏览器 E2E、instructions/architecture、受影响 ESLint/Prettier 与
  `git diff --check` 全绿；
- 未运行真实 Dashboard、Vercel/Supabase、Chrome 安装、Provider smoke 或商店上传。

2026-08-14 全局校准确认顶部“可以进入 TDD”是陈旧状态，并非实现缺口；当前审计器仍读取 API
Extension ID/最低版本并以固定 code 失败关闭，API environment 仍拒绝超安全整数版本。本轮完整门禁为
411 个 Vitest 文件（2581 passed / 12 skipped）与 93/93 Playwright；真实 Dashboard、部署配置和 Chrome
证据仍待批准，因此不把状态提升为已发布。
