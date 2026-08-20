# Phase 26A Extension Cloud 请求证明方案

日期：2026-08-13
校准日期：2026-08-14
状态：离线实现与实现后复审完成；`implemented; target-platform validation pending`

> **Phase 27 校准**：固定 Origin、客户端版本和 Extension session proof 仍是所有 Extension 业务请求的
> 公共安全前置；旧的 BYOK full-result import route 已被移除。后续 adapters 是平台插件查询、
> StudyCapture、CloudWordCopy 与 external wordbook，不能再把 request proof 的历史测试理解为允许上传
> BYOK 结果。

## 1. 问题与需求

`api.md` 已要求 Extension 业务请求同时携带随机 session token、`X-Huayi-Client-Version` 和固定
`Origin: chrome-extension://<published-id>`，但当前实现只有 token：

- Store `CloudAnalysisApi`、当时的 BYOK import 与 external wordbook adapter 没有统一版本头；
- API production auth 没有发布 Extension ID 或最低兼容版本配置；
- 有效 token 从任意 Origin、缺版本或陈旧客户端都能进入业务 module；
- `client_upgrade_required` 已在公共错误契约中，但没有运行时入口。

Phase 26A 修复这项 shared 安全/兼容前置，不改变平台/BYOK 的产品选择，不启用生产 URL、不修改
Manifest/权限/数据库/Classic/Host。

## 2. 技术路线

### 2.1 Store 深模块

新增一个 SW/analysis 共用的 Extension session header 模块，接口只接收 `sessionToken` 与
`clientVersion`，内部完成严格 token 长度、`major.minor.patch` 版本和固定 Header 名：

```ts
extensionSessionHeaders(token, version)
  -> { Authorization, "X-Huayi-Client-Version" }
```

Phase 26A 当时的 BYOK import、platform analysis 与 external wordbook adapters 都通过此 interface；
Phase 27 当前由 platform extension query、StudyCapture、CloudWordCopy、Cloud identity/preferences 与
external wordbook adapters 复用；production composition 只从 `chrome.runtime.getManifest().version` 注入
公开版本。Origin 是浏览器 transport-owned header，客户端不能自行伪造或把 Extension ID 当 secret 写入
请求 body。

### 2.2 API 深模块

把 production principal authentication 从大 composition 文件拆到独立 module。环境新增两个公开配置：

- `HUAYI_STORE_EXTENSION_ID`：严格 32 位 `[a-p]` Chrome Extension ID；
- `HUAYI_MIN_SUPPORTED_EXTENSION_VERSION`：严格 `major.minor.patch`。

Extension token 分支在访问身份库前先验证：

1. Authorization 必须是单一精确 `HuayiExtension <token>`；
2. Origin 必须精确等于配置生成的 `chrome-extension://<id>`；
3. client version 必须是严格三段非负安全整数且不低于最低版本。

Origin/token 证明错误返回 `forbidden`；缺失、非法或过旧版本返回稳定
`client_upgrade_required`（HTTP 426）。Web Cookie/Origin/CSRF 路径保持原语义。分析和外部词典生产
composition 复用同一 module，不在各 route 分叉规则。

`DELETE /v1/extension-session` 是安全退出特例：仍要求 exact Extension Origin、严格 token shape 和合法
三段版本，但故意不套最低版本 426 gate，避免旧客户端无法撤销自身。它只接受当前 token 并统一 204，
不属于一般业务数据读写的 principal authentication seam。

### 2.3 CORS 与失败语义

公共 CORS allow-header 加入 `X-Huayi-Client-Version`；Web origin allowlist 不放宽到任意 Chrome
Extension。Chrome privileged SW 的跨域能力仍由 reviewed Manifest host permission 决定，API 自己再验证
请求 Origin。

任一当前账号绑定 outbox item 遇 `client_upgrade_required` 必须保留加密队列和原幂等键，不能把正文当
永久非法 payload 删除，也不能清除仍有效的账号 session。当前实现形成持久升级阻塞：同版本零 fetch/
零 alarm，版本变化后才恢复一次显式探测，Popup 显示脱敏升级提示；详见
`store-upgrade-recovery.md`。

## 3. 数据与安全边界

- 不新增业务实体或数据库列；版本和 Extension ID 是公开部署配置；
- session token 仍只在 SW 内存/加密 vault 与 Authorization header，不进入日志、DOM、Content 或 snapshot；
- client version 不是身份权威；只有 token 验证后服务器才确定 owner；
- Origin 是固定客户端证明而非秘密，不能替代 token，也不能接受通配 `chrome-extension://*`；
- 版本比较按整数三元组，不使用词典序、预发布标签或宽松 semver coercion。

## 4. TDD 计划

Fresh RED：

1. Store shared-header tests 要求所有 authenticated adapters 都通过同一函数发送版本；
2. API environment tests 要求 Extension ID/min version，当前 strict schema 拒绝；
3. production auth tests 要求正确 Origin/version，当前 token-only 错误通过；
4. 错 Origin不得调用 `authenticateExtension`；旧版本返回 `client_upgrade_required`；
5. Cloud foundation error mapping 把该错误投影为 426；
6. StudyCapture/CloudWordCopy 426/strict upgrade error 保留为 blocked/retry 类，不丢 outbox。

随后运行 Store/API focused tests、两个 workspace typecheck/build、全仓 test/typecheck/build、浏览器回归、
ESLint/Prettier、instructions 与 architecture。

## 5. 验收标准

- 所有 authenticated Extension business adapters 统一发送 client version；
- production extension-query/StudyCapture/CloudWordCopy/preferences/external-wordbook token 分支统一验证固定
  Origin 和最低版本；
- 旧客户端稳定 426 + `client_upgrade_required`，token 无效仍 401；
- 错 Origin/缺 proof 在身份库前失败，Web auth 行为无回归；
- upgrade failure 不删除当前 StudyCapture/CloudWordCopy SubmissionOutbox 正文或清 session；
- 生产 API/Store URL 继续 null/fail-closed，无 Manifest、migration 或 Classic/Host 改动；
- 文档、实现记录和 fresh gates 同步。

## 6. 方案自审

- **范围正确**：Phase 26A 修复了文档与运行时漂移；Phase 27 已另行完成平台/BYOK 产品决策；
- **interface 有深度**：客户端两参数生成全部 proof，服务端一个 authentication module 封装解析、比较、
  Origin 和错误；删除 module 会让复杂度重新散到三个 adapters/多个 routes；
- **失败安全**：Origin/version 先于 token DB 查询；upgrade 不损坏可恢复队列；
- **不夸大 Origin**：它是 defense-in-depth 与发布绑定，不被描述成不可伪造身份；
- **发布兼容**：Cloud 尚未发布，新增必填环境可以 fail closed；正式配置必须与 release audit 的公开 ID
  一致；Phase 26B 已把离线输入一致性纳入 release audit，真实部署验收仍另行证明；
- **结论**：方案合理且当前离线实现与 Phase 27 adapter inventory 一致；实现后复审未发现绕过共享 header
  或直接调用 token repository 的生产路径。若 Chrome 真实目标环境不发送预期 Origin，应在发布验收中
  停止，不降级为通配 Origin 或客户端自填 Origin。DeviceDisconnect 的无 minimum gate 是已审阅的安全
  退出例外，不得扩散到业务数据路由。

## 7. 实现记录

> 以下 BYOK import 条目是 Phase 26A 历史实现证据；Phase 27 必须删除旧 import adapter，并把同一 proof
> 回归迁移到 platform query、StudyCapture 和 CloudWordCopy 后，才能形成当前发布证据。

- fresh RED：Store shared-header module 与 API production-auth module 不存在；environment strict schema
  拒绝新配置；token-only auth 错误放行；BYOK import 把 426 误判为 permanent；
- Store 新增共用 `extensionSessionHeaders`，BYOK import、CloudAnalysis 与 external wordbook adapters 都
  注入 manifest `1.0.0`；E2E Store harness 也走相同 interface；
- API 新增独立 production principal authentication module，固定 Extension Origin、严格 token、数字
  三元版本与最低版本；环境新增 Extension ID/min version，analysis/import/wordbook composition 统一复用；
- Hono CORS 只允许固定 Web 与发布 Extension 两个 origin，并显式允许 Authorization/client-version；
  upgrade error 映射 426，BYOK outbox 将其保留为可重试；
- 最终自审发现客户端 token 只检查长度的漂移；新增回归先证明含空白 token 会错误通过，再把客户端
  token/version 校验收紧到与服务端相同的非空白长度和安全整数三元组，非法 proof 现在必定
  fail-before-fetch；
- focused API/Store 9 files、43 tests 与两个 workspace typecheck 已通过；最终 fresh 复验为 109/109
  repository script tests、368 个 Vitest 文件（2,447 passed / 12 skipped）、全 workspace typecheck/build、
  74/74 离线浏览器 E2E、instructions/architecture、受影响 ESLint/Prettier 与 `git diff --check` 全绿。
  未运行真实 Chrome 安装、真实服务、Provider smoke 或部署验证。

### Phase 27 与 2026-08-14 当前证据

- production Store source 中 `HuayiExtension` 只在 `extensionSessionHeaders` 生成；platform query、
  StudyCapture、CloudWordCopy、identity/preferences、external wordbook 与保留的 analysis adapter 均调用该
  seam，非法 token/version fail-before-fetch；
- production API 只有 `authenticateProductionPrincipalRequest` 进入 `identity.authenticateExtension`；
  exact Origin、token shape 与数字版本在数据库查询前完成，CORS 只回显 reviewed Web/Extension origin；
- DeviceDisconnect 独立回归证明合法旧版本可 self-revoke，同时 body/query/Cookie/CSRF/idempotency 与错误
  Origin/token/version syntax 被拒绝；
- 当前 focused、workspace typecheck/build、411 个 Vitest 文件（2581 passed / 12 skipped）及 93/93
  Playwright 均通过；真实 Chrome Origin、Dashboard ID 与部署环境仍待受控验收，状态保持
  `implemented; target-platform validation pending`。
