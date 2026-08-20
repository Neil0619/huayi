# Phase 26C Store 客户端升级恢复方案

日期：2026-08-13
校准日期：2026-08-14
状态：离线实现、Phase 27 payload rebaseline 与实现后复审已完成；
`implemented; target-platform validation pending`

> Phase 27 已移除 BYOK 完整结果上传。当前 SubmissionOutbox item 是严格
> `study-capture | cloud-word-copy` union；旧 `analysis-import` v1 与未发布 StudyCapture-only v2 envelope
> 均直接安全清除，绝不能解密后猜测或上传为 AnalysisRecord。Phase 26C 的旧 payload 证据只保留为历史。

## 1. 问题与需求

Phase 26A 已让陈旧 Store 客户端收到 HTTP 426 `client_upgrade_required`，并要求当时的 BYOK
SubmissionOutbox 不丢正文、session 或原幂等键。当前 adapter 却把 426 压成普通 `transient`：

- alarm 每分钟重复同一个必然失败的请求；
- Popup 手动重试只显示“稍后自动重试”，没有告诉用户必须升级；
- SW 重启后没有脱敏、持久的失败原因，无法诚实恢复 UI；
- CloudAnalysis 尚未 production composition，Overlay/Content 也不应因此获得队列或兼容状态 interface。

Phase 26C 为当时的登录 BYOK outbox 增加持久、脱敏的升级阻塞与恢复体验。Phase 27 已决定平台/BYOK
选择，并把相同恢复机制迁移到 StudyCapture/CloudWordCopy；它仍不启用
生产 URL，不修改云端数据、Manifest、Classic 或 Host。

## 2. 技术路线与深模块

### 2.1 HTTP adapter

当前 `StudyCaptureClient`/`CloudWordCopyClient` 将 426 独立分类为 `client-upgrade-required`，仍不解析或
回显 response body。401/403
继续清账号 session/队列；网络/429/5xx 继续 transient；正文 4xx 继续 permanent。

### 2.2 SubmissionOutbox 深模块

升级状态只存在于 SW 的 outbox interface 后面。`process()` 遇 426 时：

1. 保留全部 items、正文、session 与原 idempotency key；
2. 在同一个加密 state 中记录当前公开客户端版本；
3. 返回 `pending:false/status:"client-upgrade-required"`，alarm 不再重排；
4. `status()` 只投影 count、oldestQueuedAt 和 `state:"client-upgrade-required"`。

`createSubmissionOutbox` 新增 `clientVersion` 依赖。若后续运行版本与记录版本不同，`status()` 原子清除该
标记并重新投影普通 `queued`；用户可显式重试，同一幂等键不变。若仍不满足服务器最低版本，下一次
请求会再次 426 并记录新版本。版本变化是“允许重新探测”而不是成功权威。

同版本捕获更多 StudyCapture/CloudWordCopy 意图时可继续在既有上限内加密排队，但返回
`client-upgrade-required`，不为每条新 item 重排必然失败的 alarm。

current-card undo 只删除匹配 `localQueueId`。若同一队列仍有其他 item，必须保留
`clientUpgradeRequiredAtVersion`；删除单项不能被解释为客户端升级，也不能让同版本重新 fetch。仅删除
最后一项时清整个 envelope。

### 2.3 Store-domain 与 Popup

严格无参数消息保持不变。聚合响应增加：

```ts
type SubmissionOutboxQueuedState = "queued" | "client-upgrade-required";

{
  state: SubmissionOutboxQueuedState;
  count: 1..20;
  oldestQueuedAt: canonical ISO timestamp;
  outcome: "client-upgrade-required" | existing outcomes;
}
```

仍禁止 payload、sourceText、result、token、idempotency key、HTTP body、URL 或服务器 message。Popup 在
升级阻塞时显示“请先更新划译；待提交内容仍加密保存在本机”，禁用“重试”、保留二步“清空”；动态状态
继续使用 polite live region。新版本读取为普通 queued 后重试自动恢复可用。

Overlay/Content 不增加消息、DOM 或状态；用户通过现有 Popup 管理聚合队列，避免网页上下文观察账号兼容
状态。无需新增视觉依赖，沿用现有 token、40px 控件、360/320px 布局和全局 reduced-motion。

## 3. 数据结构与迁移

当前 AES-GCM envelope 为 `kind=huayi-store-learning-outbox/version=3`，固定 AAD 为
`huayi-store-learning-outbox-v3`；加密明文 strict schema 为：

```ts
interface SubmissionOutboxState {
  clientUpgradeRequiredAtVersion?: string; // strict safe-integer major.minor.patch
  items: SubmissionOutboxItem[]; // existing max 20
}
```

- 字段不含服务器最低版本、URL、token、用户正文或错误消息；
- `items` 只接受 `study-capture | cloud-word-copy`，旧 state 无升级字段时正常读取；升级字段只在至少一个
  item 存在时保存；队列清空时整个 envelope 删除；
- `huayi-store-submission-outbox/version=1` 与 `huayi-store-study-capture-outbox/version=2` 都属于未发布历史
  envelope，识别后直接删除，不尝试用新 schema 解密、迁移或上传；
- v3 已是当前候选数据契约；未来已发布后再改变 envelope 必须走显式版本迁移与回滚策略；
- 无数据库、Cloud contract 或账号数据 migration。

## 4. 单元测试与 TDD

### 当前回归矩阵

1. StudyCapture/CloudWordCopy 426 应分类 `client-upgrade-required`，不能压成普通 `transient`；
2. outbox 426 应持久化版本、保留 item/session/key、返回 pending false，当前返回 retry/pending true；
3. alarm 遇升级阻塞不得 schedule；
4. 同版本 `status` 应恢复严格升级聚合，新版本应清标记并投影 queued；
5. blocked 状态下新增 item 不 schedule，仍遵守 20 条/5 MiB/7 天；同版本 `process()` 也必须先把
   超过 7 天的密文项持久删除，再返回阻断；
6. blocked 队列删除一个 current-card item 后，剩余 item 继续保持相同版本阻塞、零 fetch；删除最后一项
   才清 envelope；
7. store-domain parser 接受唯一新增聚合 shape，拒绝 clientVersion、serverVersion、URL、token 与正文；
8. handler 把升级 outcome 原样投影且不 schedule；
9. Popup 显示升级文案、retry disabled、clear enabled/二步确认，DOM 无私密字段；
10. 320px/reduced-motion CSS 契约与既有焦点/live region 保持。

### GREEN 与门禁

- 最小修改 adapter、加密 state schema、outbox/handler/message 与 Popup；
- focused store-domain/Store tests，先 build 公开 package 再跑 Store；
- full test/typecheck/build、74 条离线 Playwright；
- targeted ESLint/Prettier、instructions、architecture、`git diff --check`；
- 不运行真实网络、Provider smoke、Chrome 安装或商店上传。

## 5. 验收标准

- 426 不再进入一分钟自动重试循环；
- 待提交正文、session 和幂等键在升级阻塞时完整保留且继续加密；
- Popup 明确要求升级，不把本地队列称为已上传；
- 同版本不能手动重试，新版本恢复一次显式重试能力；
- current-card undo 不得解除剩余 item 的同版本升级阻塞；
- clear 仍只删除本机队列且必须二次确认；
- Popup response/DOM/snapshot 不含正文、token、key、URL、原始错误或最低版本；
- Overlay/Content/Options 不获得新 interface，Manifest/权限不变；
- 文档、变更记录、项目状态和 fresh gates 同步。

## 6. 方案自审

- **需求诚实**：区分可恢复网络失败与必须升级，修复错误 UX 和无意义重试；
- **interface 深度**：HTTP 分类、持久阻塞、版本恢复和聚合投影都封装在现有 adapter/outbox seam，Popup
  不学习 HTTP 或 vault 细节；
- **隐私最小化**：公开面只多一个枚举状态，版本记录留在加密 SW state，Content/Overlay 不扩权；
- **恢复语义**：版本变化只解除阻塞并允许重新探测，不伪造兼容成功；
- **数据兼容**：未发布队列的 v1 明文增加可选字段，旧数据可读，无数据库或远端迁移；
- **无障碍/响应式**：既有 live region、二步确认焦点、40px 控件和 320px 布局继续作为验收对象；
- **范围控制**：外部词典升级提示和未来 platform CloudAnalysis 的统一全局兼容状态，在其 production
  composition 后再设计；本阶段不让未接线功能驱动新的全局权威；
- **结论**：Phase 27 payload 与 UI 已重新落在当前 strict union；升级恢复技术路线仍合理。实现后复审
  发现并以 fresh RED 复现 `remove(localQueueId)` 丢失剩余队列升级标记的问题；修复后单项删除保留标记，
  同版本继续 fail-before-fetch，未扩大 interface 或数据格式。

## 7. 实现记录

> 以下是 Phase 26C 旧 `analysis-import` payload 的历史证据，只用于解释来源；当前完成结论必须使用后续
> Phase 27 strict union 与本轮回归证据。

- fresh RED：6 个套件中 7 个预期失败、22 个既有断言通过；失败精确命中 426 分类、vault strict
  schema、持久/恢复、消息白名单、handler 停调度与 Popup 提示；
- 最小实现新增 adapter 独立分类、AES-GCM 明文可选版本标记、outbox 阻塞/新版本解除、严格聚合消息与
  Popup upgrade 状态；Overlay/Content/Options/Manifest 未改；
- 实现后自审发现仅 UI/alarm 停重试仍允许可信调用者重复 `process()`；新增回归先 RED，再把同版本
  fail-before-fetch 下沉到 outbox interface；
- 最终自审另发现 fail-before-fetch 不能跳过 7 天保留期清理；新增回归复现过期密文仍留在 Vault，修为
  阻断前持久化裁剪，且仍保持零 fetch、原 session 与未过期 item/key；
- focused 7 files / 30 tests 与 Store-domain/Store typecheck 已通过；最终 fresh 复验为 112/112 repository
  script tests、368 个 Vitest 文件（2,452 passed / 12 skipped）、全 workspace typecheck/build、74/74
  离线浏览器 E2E、instructions/architecture、受影响 ESLint/Prettier 与 `git diff --check` 全绿；
- 未运行真实 426 服务、Chrome 更新、生产网络、Provider smoke、安装或商店上传。

### Phase 27 当前实现证据

- outbox vault 已升级为 strict v3 learning envelope，只允许 StudyCapture/CloudWordCopy，并分别回归删除
  legacy v1/v2 envelope；
- 两个 HTTP adapter 都把 426 分类为 `client-upgrade-required`，不读取服务器正文；outbox 已覆盖持久阻塞、
  同版本零 fetch、版本变化解除、继续有界 enqueue、七天裁剪、聚合消息和 Popup；
- 2026-08-14 实现后复审确认上述主链已存在，同时捕获 current-card undo 会误解除剩余队列阻塞的缺口；
  fresh RED 观察到第二次 API 调用，最小修复后剩余 item 保留原版本标记并维持零 fetch；
- 当前 focused 8 个文件、38 项通过；workspace typecheck、411 个 Vitest 文件（2581 passed / 12 skipped）、
  build、93/93 Playwright、instructions/architecture 与任务文件 ESLint/Prettier 通过；
- 真实 426 服务、Chrome 更新、生产网络与双平台目标环境仍未运行，因此状态保持
  `implemented; target-platform validation pending`。
