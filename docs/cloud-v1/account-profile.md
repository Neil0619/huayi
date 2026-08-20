# 当前账号聚合方案

状态：2026-08-14 离线实现与复验完成；目标环境验证待完成。本文固定 `GET /v1/account` 的产品边界、
深模块接口、数据结构、测试顺序与验收标准。Cloud V1 尚未发布，公共契约已直接校准，不保留旧的未接线
响应形状。

## 1. 问题与目标

校准前 Web 分别读取 CSRF/session access、五项账号偏好、平台额度和扩展设备列表，但规划中的
`GET /v1/account` 未接线。旧孤立 `accountResourceSchema` 仍包含没有数据库权威的
`consentVersion`，只含 timezone/dailyGoal，并漏掉邮箱与 Phase 27 的三项插件偏好；继续实现该旧形状会
制造虚假账号 consent 状态和第二套偏好投影。

本切片提供一个 active/full 账号的只读服务器快照：

1. 返回账号规范邮箱；
2. 嵌套复用完整五项 `AccountPreferences`，不复制字段定义；
3. 返回当前未撤销、未过期的扩展会话公开投影；
4. 返回部署公开的最低兼容 Store Extension 版本；
5. 让 Web `/settings/account` 用该聚合初始化账号摘要与偏好表单，并与额度并行读取。

本切片不增加表、不返回 owner UUID、Auth identity、Web session、refresh token、Extension token/hash、
install ID/hash、配对 ticket、审计事件、正文、额度或管理员字段。

## 2. 产品边界

- 仅 active + full Web Cookie 可读；disabled 的 data-rights session 仍只能导出、删除和退出，不能借本端点
  扩大普通账号读取权限；deleting 不建立会话。
- `consentVersion` 从账号资源删除。配对页勾选只证明当前批准动作；Store 首次联网与 Eudic/Shanbay
  recipient consent 是各安装的本机版本化设置，均不是 HuayiAccount 字段。
- `status` 从普通账号资源删除。成功认证已证明账号 active；返回恒定 `active` 没有信息价值，而 disabled/
  deleting 不能通过该接口观察。
- 平台额度继续由 `GET /v1/quota` 的 `AnalysisQuota.summary` 深模块计算，不塞入账号聚合；偏好 mutation
  继续使用窄 `PATCH /v1/account/preferences`，设备撤销继续使用资源专用 DELETE。
- 独立窄端点继续服务配对、设备页和局部重试；聚合不是客户端缓存权威，也不改变各资源 mutation seam。

## 3. 公共数据结构

```ts
type AccountResource = {
  email: string;
  extensionSessions: ExtensionSessionResource[];
  minSupportedExtensionVersion: string;
  preferences: AccountPreferences;
};
```

约束：

- strict object，未知字段失败关闭；
- `email` 复用规范化 `accountEmailSchema`；
- `preferences` 直接复用 `accountPreferencesResponseSchema`，包含 timezone、dailyGoal、
  extensionQueryModelMode、studyCaptureMode、cloudWordCopyMode、revision、updatedAt；
- `extensionSessions` 最多 100 项，按 `(createdAt,id)` 升序；每项只含 id、deviceLabel、createdAt、
  lastUsedAt、expiresAt；
- `minSupportedExtensionVersion` 复用安全整数三段版本 schema，不接受前导零、两段版本或超安全整数；
- 响应不包含 `consentVersion`、`status`、owner、token、hash、install ID 或 quota。

## 4. 深模块与 seam

外部 seam 只有一个读取接口：

```ts
interface AccountProfileModule {
  read(ownerUserId: string): Promise<AccountResource> | AccountResource;
}
```

HTTP adapter 只负责 active/full Web 认证、`Cache-Control: private, no-store` 和 strict response parse；它不
知道表、session 过滤、排序或部署配置拼装。Postgres adapter 在一个 owner-scoped repeatable-read snapshot
中读取 `user_profiles` 与 `extension_sessions`，隐藏 RLS、有效期过滤、字段映射和排序，再附加启动时已
strict 校验的公开最低版本。测试通过同一 module interface 使用 in-memory adapter；PGlite 直接验证
Postgres implementation，不把 SQL seam 暴露给 HTTP 或 Web。

删除该模块会迫使 HTTP、Web 与测试分别重建 profile/preferences/session/config 拼装，因此该小接口具有
足够 depth；不再额外建立只被一个实现使用的 profile/consent port。

## 5. 数据与事务

不新增 migration。Postgres adapter 使用现有 owner context 与 forced RLS：

1. repeatable-read snapshot 只读取 `status='active'` 的当前 `user_profiles` email 与五项偏好/revision/time；
   缺失或已停用统一 404，关闭认证与读取之间的状态竞态；
2. 同一 snapshot 读取 `extension_sessions` 中 `revoked_at IS NULL AND expires_at > now()` 的当前账号记录；
3. 按 `created_at,id` 升序并投影公开字段；
4. 在模块返回前由 strict public schema 再校验一次；
5. `minSupportedExtensionVersion` 来自已校验的 API environment，不写数据库、不按账号覆盖。

读取不更新 `last_used_at`，不会延长任何会话，不产生幂等记录或审计事件。并发撤销发生在 snapshot 之后时，
本响应仍是合法瞬时快照；客户端后续 mutation 必须重新经过服务器权威。

## 6. Web 行为

- `/settings/account` 并行读取 AccountResource 与 QuotaSummary；两者都成功后显示账号摘要和额度；任一失败
  明确提示“账号与额度载入失败”，用户可显式重试。
- 账号摘要显示规范邮箱、有效扩展设备数量和最低兼容插件版本，不显示内部 ID。
- 偏好表单直接使用 AccountResource.preferences 初始化，不再为同一页面额外 GET preferences；保存仍走
  原 revision/CSRF/idempotency mutation，成功响应成为新的表单权威。
- pairing 页面继续使用窄 preferences GET，设备页继续使用 session list GET；它们不为了复用而读取无关
  聚合字段。
- load generation、卸载抑制、失败重试、保存草稿与 revision conflict 行为保持现有规则。

## 7. TDD 与测试矩阵

### Contracts

1. 先让 account route 与新 strict AccountResource 因缺失失败；
2. 接受完整嵌套偏好、零/多 session 和安全整数三段版本；
3. 拒绝旧 `consentVersion/status`、漏掉三项插件偏好、额外字段、token/hash/install ID、非法 email/version；
4. 证明嵌套 preferences 与独立 preferences schema 是同一公共结构。

### API/module

1. HTTP adapter：缺 Cookie 401；active/full 返回 200 + no-store；非法 module 输出失败关闭；
2. PGlite：跨 owner 隔离；profile 缺失/disabled 404；五项偏好完整；只列未撤销且未过期 session；稳定排序；
3. 同一 snapshot 不更新 lastUsedAt，不返回 token/install hash；
4. production composition 注册精确 `/v1/account`，公开最低版本来自 environment；
5. 不开放 data-rights session，不改变 preferences/session 专用端点。

### Web

1. adapter 使用固定 HTTPS origin、Cookie GET、Accept JSON 和 strict parse；
2. 账号页并行读取聚合与 quota，显示 email/device count/min version；
3. 聚合偏好直接初始化表单，页面不额外 GET preferences；保存后继续使用 mutation 响应；
4. loading/error/retry、迟到 load 抑制、窄屏、焦点与 live region；
5. 页面和错误中不出现 session ID、token、hash 或 owner。

## 8. 验收标准

- 公共契约、API module、Postgres adapter、production composition 与 Web adapter/page 全部按上述顺序
  RED→GREEN；
- API/Web focused tests、PGlite 集成、两 workspace typecheck/build、精确 ESLint/Prettier、instructions/
  architecture 与全仓离线门禁通过；
- current docs 不再把 `GET /v1/account` 标为规划中，也不声称存在账号级 consentVersion；
- fake 浏览器账号页从 strict authority 重读聚合时，不暴露秘密且不替代真实登录/部署验证；
- 真实 Supabase/Vercel、真实 Cookie/domain 和 Chrome 仍保留为获批后的目标环境验收，不因离线绿灯关闭。

## 9. 方案复审

复审拒绝三个较浅方案：HTTP 并行调用 preferences/session repositories 会把 snapshot 和字段拼装散在 caller；
把 quota 塞进 AccountResource 会耦合独立额度事务与账号资料；保留 `consentVersion` 会为不存在的账号权威
制造字段。最终方案以一个 owner snapshot module 隐藏数据库复杂度，复用现有 strict 子资源，同时让
专用 mutation seam 保持独立，技术路线与当前产品、安全和 Phase 27 数据所有权一致。

## 10. 实现与复验证据

- 公共契约已加入固定路由、strict `AccountResource`、安全三段版本 predicate，并删除旧
  consent/status 形状；Contracts focused 为 3/3。
- API 已接入单方法 `AccountProfileModule`、active/full Web 认证、no-store HTTP adapter、Postgres
  repeatable-read owner snapshot 内的 active 再判定与 production composition；环境、组合、HTTP/PGlite
  focused 为 8/8。
- Web adapter 已使用固定 Cookie GET；`/settings/account` 并行读取账号与 quota，以聚合偏好初始化表单，
  不重复读取 preferences，并显示邮箱、有效设备数量与最低兼容版本；Web focused 为 28/28。
- actual Web 浏览器 authority 已严格返回账号聚合；既有练习→账号页旅程同时验证公开摘要、quota 重读、
  不显示设备标签和公开请求事实。完整离线 Playwright 为 93/93。
- 2026-08-14 fresh 全仓离线门禁为 114/114 Node 脚本、407 个 Vitest 文件（2,558 passed / 12 skipped）、
  全 workspace typecheck/build、instructions/architecture。真实 Supabase/Vercel、真实 Cookie/domain、Chrome
  与 macOS/Windows 目标环境仍未运行，因此状态保持 `implemented; target-platform validation pending`。
