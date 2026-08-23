# Phase 19 管理运营台方案

状态：2026-08-13 已完成需求/技术方案、只读审阅和 19A + 19B 离线实现；2026-08-14 已补齐 actual
Web production bundle 的 Operator/非 Operator 离线 journey 并完成复审，状态为
`implemented; target-platform validation pending`。19C 的真实告警、备份恢复和部署浏览器演练仍待
外部环境验证；fake authority 不作为生产完成证据。

## 1. 目标与范围

本阶段让具有显式 `operator` 角色且刚完成身份验证的 Operator 在 Web `/admin`：

1. 查看账号、邀请、当前 UTC 月聚合用量和 OperationalAuditEvent；
2. 创建或撤销邀请，且创建成功时只显示一次邀请 fragment URL；
3. 停用或重新启用账号、撤销账号全部 Extension 设备；
4. 为当前 UTC 月设置账号平台额度；
5. 查看并切换全局平台模型 kill switch；
6. 在所有页面和响应中只获得白名单运营元数据，不获得用户正文、答案、模型结果、来源标题、
   凭据、session token、refresh token、设备 install ID 或任意内部 lease。

本阶段不提供管理员代登录、密码重置、邮箱修改、正文检索、任意 SQL、单条账本浏览、删除账号、
恢复 deleting 账号、直接调用 Supabase service role 浏览用户、角色管理或公开注册。

Phase 19 分为三个可独立验收的纵向切片：

- **19A Operator authority**：strict contracts、登录邮箱投影、签名分页、幂等管理事务、审计和 kill
  switch；
- **19B Web console**：`/admin` 的概览、账号、邀请和审计交互；
- **19C operations proof**：无正文指标回归、kill switch 恢复、runbook 与真实告警/备份演练清单。

本轮实现目标为 19A + 19B 的离线闭环；19C 中不依赖真实服务的 runbook 与测试同时完成，真实告警和
备份演练继续保持 pending。

## 2. 领域与权限

### 2.1 Operator

Operator 是普通 `HuayiAccount` 加显式 `admin_roles.role=operator`，不是绕过业务规则的超级用户。
权限固定为：

- 管理 GET：要求 active/full Web session、operator role、最近认证不超过 15 分钟；GET 不要求 CSRF；
- 管理 mutation：在上述条件外还要求固定 Web Origin、CSRF 和 `Idempotency-Key`；
- `DataRightsSession`、Extension session、过期 session 或缺少角色都不能访问 `/v1/admin/*`；
- production 只通过受控 Postgres module 读取白名单投影；Supabase service role 不用于管理页查询。

Operator 不能停用自己，避免唯一运营账号通过一次点击锁死管理入口。Operator 可以调整自己的额度和
撤销自己的 Extension 设备；这些动作不影响当前 Web session。角色授予/撤销仍是部署期受控操作，
不在 Web 暴露。

### 2.2 账号状态机

允许的管理迁移只有：

```text
active --disable--> disabled
disabled --enable--> active
deleting ----------------> （管理端不可改变）
```

停用必须在同一事务中撤销目标账号所有 Web session、Extension session，并把仍为 pending/approved 的
Extension pairing 置为 expired；完成后写一条 OperationalAuditEvent。重新启用只改变 profile 状态，
不恢复任何旧 session、pairing 或凭据。

### 2.3 审计

每个成功 mutation 恰好写一条不可变 OperationalAuditEvent。失败、revision/idempotency 冲突和未授权
请求不写审计。公开安全详情按 action 固定：

| action                  | safeDetails                                    |
| ----------------------- | ---------------------------------------------- |
| `invitation.created`    | `expiresInHours`                               |
| `invitation.revoked`    | 空对象                                         |
| `user.disabled`         | `webSessions`, `extensionSessions`, `pairings` |
| `user.enabled`          | 空对象                                         |
| `devices.revoked`       | `revokedCount`                                 |
| `quota.granted`         | `limitMicroUsd`, `periodStart`                 |
| `model.kill-switch-set` | `enabled`                                      |

审计不记录 email、邀请 token、请求体、IP、Cookie、CSRF、正文、SQL 或原始错误。

## 3. 公开投影与接口

### 3.1 列表投影

`AdminUserResource` 只含：

```ts
{
  id: string;
  email: string;
  status: "active" | "disabled" | "deleting";
  createdAt: string;
  deviceCount: number;
  quota: {
    periodStart: string;
    periodEnd: string;
    limitMicroUsd: number;
    usedMicroUsd: number;
    reservedMicroUsd: number;
    availableMicroUsd: number;
    percentUsed: number;
    warning: "available" | "warning" | "exhausted";
  }
}
```

`email` 是最近一次成功 Supabase 身份验证返回并经 trim/lowercase 规范化的登录邮箱；它不是用户学习
字段。用户列表支持 normalized email literal query 与 status，按 `(created_at,id) DESC` 使用独立 HMAC
cursor。`%`、`_`、`\\` 都按普通字符搜索。

邀请列表只含 id、createdAt、expiresAt、consumedAt、revokedAt；创建响应额外一次性返回
`invitationPath=/join#<token>`。列表按 `(created_at,id) DESC` 使用 invitation cursor。已消费或已撤销邀请
不能再次撤销；不存在和不可撤销统一返回 `not_found`，不泄露 token hash。

Web 必须把上述白名单时间戳明确投影为四个互斥状态：`revokedAt` 非空为“已撤销”，否则
`consumedAt` 非空为“已领取”，否则 `expiresAt <= now` 为“已过期”，其余为“可领取”。只有“可领取”
显示撤销入口；服务端仍重新验证真实状态，客户端投影不构成授权。状态不新增账号、token、claim 或
领取人信息。

审计列表只含 id、action、actorUserId、subjectId、safeDetails、createdAt，支持 action 过滤并按
`(created_at,id) DESC` 使用 audit cursor。三个 cursor 有不同签名 context，不能跨资源复用。

### 3.2 运营概览

`GET /v1/admin/usage` 返回服务器当前 UTC 月：

- 账号总数及 active/disabled/deleting 数；
- 当前 grant limit 总额、已结算费用、active reservation 总额和可用总额；
- UsageLedger succeeded/failed 调用数及费用；
- terminal AnalysisRequest 数、成功率和按 `updated_at-created_at` 计算的 p95 延迟；
- structure repair request 数和占完成分析请求比例；当前实现以同一 analysis request 出现
  `call_ordinal>0` 的 ledger 作为结构修复证据；
- kill switch 当前 `enabled` 与更新时间。

所有分母为零时返回整数 0，不返回 NaN/Infinity。概览不含 userId、email、requestId、provider 原始错误
或单条 ledger。BYOK、StudyCapture 数据写入与 CloudWordCopy 不进入模型 UsageLedger，因此自然排除；
平台插件查询与 Web 深度分析/练习进入同一月度池，但在无正文聚合中按 operation 分列，便于定位费用而
不暴露用户内容。

### 3.3 固定路由

| Method/path                               | 行为                                |
| ----------------------------------------- | ----------------------------------- |
| `GET /v1/admin/users`                     | 白名单账号列表                      |
| `GET /v1/admin/invitations`               | 邀请列表                            |
| `POST /v1/admin/invitations`              | 幂等创建邀请；一次返回 fragment URL |
| `DELETE /v1/admin/invitations/:id`        | 幂等撤销未消费邀请                  |
| `POST /v1/admin/users/:id/status`         | 幂等 active/disabled 状态迁移       |
| `POST /v1/admin/users/:id/devices/revoke` | 幂等撤销全部 Extension session      |
| `PUT /v1/admin/users/:id/quota`           | 幂等覆盖指定 UTC 月 grant           |
| `GET /v1/admin/usage`                     | 当前 UTC 月无正文聚合               |
| `PUT /v1/admin/runtime/model-kill-switch` | 幂等设置平台模型是否 enabled        |
| `GET /v1/admin/audit-events`              | 无正文审计列表                      |

所有响应使用 `Cache-Control: private, no-store`。资源 ID 在 fetch/SQL 前经 path-safe schema 验证。写请求的
request hash 必须绑定 operation、path target 和 strict body；同 key/same hash 重放同一公开响应，同 key/
different hash 返回 `idempotency_conflict`。

邀请 token 不写幂等 response。API 用服务器 secret 对 `actor + idempotency key + strict request hash`
做 HMAC 派生，得到稳定高熵 token；数据库只保存 token hash、公开 invitation snapshot 和幂等
response，因此丢响应可重放同一一次性 path，又不会把明文 token 持久化。

## 4. 数据结构与事务

### 4.1 `user_profiles`

新增 `email text NOT NULL UNIQUE`，要求长度 3–320 且为 lowercase。邀请注册 finalization 在创建 profile
时写入 email；普通密码/Google 登录在成功验证既有 identity 后刷新同一 userId 的规范化 email。邮箱
变化不创建第二账号，也不能由客户端独立 PATCH。

AccountDataExport 的 account record 增加 email；账号删除随 profile 删除。管理页不从 Supabase service
role 枚举 Auth 用户。该未发布 bootstrap migration 变更要求开发库重建，不能把 `0001` 重放当升级。

### 4.2 既有表

- `idempotency_records` 继续作为 7 天写入 snapshot；专用 `admin_execute` 只接受固定 admin operation
  allowlist，owner 使用 actorUserId，response 不含 token/secret；不把这些 operation 暴露给通用业务写入；
- `audit_events` 保持不可变；列表由受控 operator transaction 读取，不向业务 RLS 角色开放全表；
- `runtime_controls(name=model_kill_switch)` 是 kill switch 唯一权威；`enabled=false` 表示允许平台模型，
  `enabled=true` 表示阻止新的平台 reservation。Web 文案显示“平台模型已暂停/运行中”，避免反向语义；
- `invitations`、quota grant、session/pairing 表沿用现有结构，只补事务约束和幂等 snapshot。

### 4.3 深模块

API 只向 Hono adapter 暴露一个 `AdminOperationsModule` interface：

```ts
interface AdminOperationsModule {
  listUsers(query: AdminUserQuery): Promise<AdminUserList>;
  listInvitations(query: AdminInvitationQuery): Promise<AdminInvitationList>;
  listAuditEvents(query: AdminAuditQuery): Promise<AdminAuditList>;
  usage(): Promise<AdminUsageSummary>;
  execute(command: AdminCommand): Promise<AdminCommandResult>;
}
```

`execute` 使用 discriminated union 隐藏邀请、状态、额度、设备和 kill switch 的事务差异。Hono 负责
strict HTTP/认证映射；Postgres adapter 负责 role、recent auth、cursor、幂等、状态机、审计和原子写入。
Web 只依赖更窄的 `AdminConsoleApi`，不能获得 SQL、role mutation、service-role client 或正文查询 seam。

## 5. Web `/admin`

页面固定四区：运营概览、账号、邀请、审计。首次统一 `forbidden` 不能让客户端区分非 Operator 与
近期认证过期，因此先显示密码重新认证门；重新认证后服务端仍拒绝才显示统一无权限页面。页面不通过
隐藏导航作为授权，Operator 入口只在服务器证明角色后显示。

- loading/empty/error/retry 分区独立；一个区失败不清空其他已确认数据；
- 账号按 email/status 筛选并分页；详情卡只显示公开资源；
- 停用、设备撤销、邀请撤销、kill switch 都要求二步确认；停用明确说明会退出所有设备；
- 额度编辑使用 micro-USD 的人民币/美元文案换算只作显示，提交仍是整数 micro-USD；
- 创建邀请成功后 path 只保存在当前组件内存，明确“仅显示一次”；用户离开/刷新即丢弃；
- 邀请列表始终显示四态标签，只为“可领取”项显示二步撤销；确认发起撤销当前刚创建项时立即从组件
  内存移除一次性 path；若 DELETE 响应不确定，关闭确认和撤销入口，只允许先重读列表恢复权威状态；
- 一次性 path 丢失时不提供“重新显示”。Operator 先按公开 ID/创建顺序定位并撤销仍可领取项，再创建
  新邀请；无法唯一定位时撤销全部可能受影响的可领取项，禁止留下未知有效链接；
- mutation 成功先信任 strict response，再重新读取相关列表；刷新失败显示“操作已完成，但刷新失败”；
- list/detail/action 使用独立 generation guard，迟到响应不覆盖较新筛选或动作；
- live region、确认焦点、键盘可达、60rem/42rem 单列和 reduced-motion 进入组件测试/CSS contract。

页面不使用 raw HTML，不写 localStorage/sessionStorage，不缓存邀请 URL，不显示 stack/SQL/raw error。

## 6. TDD 顺序

1. contracts RED：fixed routes、strict list/cursor、usage、audit、write headers/request/response；
2. identity RED：Auth provider 返回 email，注册/登录刷新 profile email，旧 profile/非法 email fail closed；
3. Postgres RED：operator/recent-auth、三类 cursor、literal email、overview aggregation；
4. mutation RED：所有 admin write 的 same-key replay/different-hash conflict、一次审计、邀请 token 不持久化；
5. 状态机 RED：禁止 self-disable/deleting resurrection，disable 原子撤销 Web/Extension/pairing；
6. kill switch RED：set/replay/audit，关闭后新 reservation 拒绝，恢复后允许；
7. Hono RED：GET Cookie-only + recent role；mutation Cookie+Origin+CSRF+idempotency；strict no-store；
8. Web RED：四区状态、筛选/分页、一次性 path、二步确认、刷新失败、迟到响应、可访问性/窄屏；
9. production composition、migration/RLS、日志禁止正文和 shared fixture 回归；
10. actual Web bundle RED：strict fake authority 覆盖 Operator 四区、写证明、重读和非 Operator 拒绝；
11. focused → affected full → root offline gates，并记录未运行真实环境项。

## 7. 单元与集成测试

- schema 拒绝 owner、正文、token、URL（创建 response 的固定 fragment path 除外）、未知字段和非有限数；
- cursor 篡改、跨 users/invitations/audit 复用、非法 filter 在 SQL 前失败；
- operator 角色缺失、认证超过 15 分钟、data-rights/Extension session、GET 伪造 CSRF 都不能授权；
- 管理 mutation 缺 Origin/CSRF/key、same key 不同 path/body、重复响应和并发重复写；
- disable/enable 状态矩阵、自停用、deleting、session/pairing 撤销数量与单一 audit；
- quota current/future period 校验、kill switch reserve 阻断/恢复、无 grant 和零分母 usage；
- 邀请创建丢响应重放相同 path，数据库/log/audit 不含 token；撤销 consumed/revoked/unknown 一致；
- Web 对 active/consumed/revoked/expired 四态逐项显示，expired 不误显示撤销；撤销只产生一次空
  safeDetails 审计，同 key 重放不重复写；
- user list 只含白名单字段，email wildcard literal，跨租户正文 fixture 不出现在任何 admin response；
- Web 一次性邀请 path 不持久化，mutation 成功/刷新失败诚实状态，确认 focus 和 generation guard；
- PGlite 执行完整 bootstrap，证明业务角色不能直接全表读取 admin/audit/user projection。

### 7.1 2026-08-14 actual bundle 补充矩阵

- 新增独立 `admin-operations` browser authority helper，仅处理固定 `/v1/admin/*` route；主 authority
  继续拥有 Cookie/Origin/CSRF/Idempotency、CORS、固定错误和无正文 request facts，helper 不模拟 SQL/
  RLS、近期认证时钟或 Supabase；
- `operator-console` seed 只代表已由 API/PGlite 单独证明的 operator + recent-auth 前置条件。actual
  `/admin` 必须从 production `access/usage/users/invitations/audit` adapter 重读四区，而不是把组件
  props 直接种成成功态；
- Operator journey 覆盖 email literal 筛选、账号停用二次确认及焦点、一次性邀请 fragment、可领取
  状态、邀请撤销二次确认及焦点、kill switch 二次确认、服务器刷新后的邀请终态、disabled/enabled 状态
  和无正文 audit；所有 mutation 必须留下
  `write-valid` request fact；
- 刷新后一次性邀请 fragment 必须从 DOM 消失，不能进入 Web Storage 或公开 snapshot；用户/运营正文、
  Cookie、CSRF、幂等键和请求 body 同样不得进入公开证据；
- 非 Operator 使用有效 full Cookie 访问 `/admin` 时，首次 access 固定 403 并显示统一密码重新认证门；
  密码重新认证成功、CSRF 轮换后再次 access 仍固定 403，页面才显示统一拒绝视图，且全程不得请求
  usage/users/invitations/audit；
- 两条 journey 均覆盖 390px、reduced-motion、无横向溢出和空 Web Storage。它们只证明离线 bundle/
  adapter 组合，不替代真实 Operator 角色、部署 Cookie、告警或备份恢复演练。

## 8. 验收标准

离线完成必须同时满足：

1. Operator 可完成账号、邀请、额度、设备和 kill switch 闭环，所有成功写入各有一条审计；
2. 管理响应、DOM、日志和 AccountDataExport 边界与文档一致，不出现用户正文或秘密；
3. 所有写入可安全重放，邀请明文 token 不落库；
4. disabled/deleting 状态机、session/pairing 撤销和 kill switch 在数据库回归中成立；
5. contracts/API/Web full tests、workspace typecheck/build、architecture/instructions/diff 和受影响 lint/format
   通过；
6. 新增手写 source 小于 400 行，production 缺配置继续 fail closed。
7. actual Web Operator journey 重读四区并完成筛选、停用、邀请和 kill switch；非 Operator 在首次
   access 403 后只得到统一重新认证门，成功重新认证但再次 access 403 后失败关闭，且一次性邀请/正文/
   秘密不进入持久化或公开证据。
8. 邀请列表明确显示四态，丢失一次性链接可通过撤销对应可领取项安全收口；撤销响应丢失以 GET 恢复，
   不要求 token、不重复审计，也不扩大数据库角色权限。

真实完成另需：部署 Postgres 查询计划与并发、Supabase 登录邮箱更新、Vercel Web/API Cookie/CSRF、
真实 Operator 浏览器 journey、告警渠道、备份/恢复演练和 kill switch runbook 演练。未取得这些证据前，
不得宣称 Phase 9 或发布候选完成。

## 9. 2026-08-13 实现记录

- `cloud-contracts` 已提供 users/invitations/audit/usage/access 和全部管理 mutation 的 strict schema、固定
  route、write header 与资源专用 cursor 输入；账号登录邮箱已进入 profile 与 AccountDataExport account
  record，ADR-0017 记录该投影边界。
- API 已由单一 `AdminOperationsModule` 组合 Hono 和 Postgres adapter；旧 foundation admin HTTP route
  已移除，旧非幂等 Postgres function 不再授予运行角色。新 adapter 强制 Operator + 15 分钟近期认证，
  管理 GET 使用 Cookie，mutation 另要求 Origin、CSRF 和 Idempotency-Key。
- bootstrap `0001` 新增 profile email 约束与 admin list/usage/execute functions；停用在同事务撤销 Web/
  Extension sessions、过期 pending/approved pairing 并只写一条审计。quota 只接受当前或未来 UTC 月首日，
  kill switch 继续阻断新平台 reservation。
- Web `/admin` 已接生产组合：概览、账号筛选/签名分页、额度、设备撤销、状态迁移、邀请创建/撤销、
  审计分页和 kill switch；一次性邀请 path 只留组件内存。分区错误互不清空、mutation 先保留 strict
  response 再重读，二步确认焦点、live region、迟到抑制、窄屏和 reduced-motion 已进入组件/CSS 回归。
- 当前 Cloud 尚未发布且无增量 migration runner，因此这是未发布 bootstrap 更新；现有开发数据库必须
  重建，不能把 `0001` 重放成升级。真实 Supabase/Vercel/Postgres/Operator 浏览器、告警、备份和恢复
  演练仍 pending。
- 根任务最终离线复验通过 101 个脚本测试、359 个 Vitest 文件（2,416 passed/12 skipped）、全 workspace
  typecheck/build、66/66 既有扩展浏览器 E2E、instructions/architecture、Phase 19 定向 ESLint/Prettier
  与 diff 检查。全仓 lint/format 仅剩用户已有 `.agents/` 资产与既有
  `docs/cross-platform-development.md` 的范围外问题。
- 2026-08-14 actual bundle 补充层新增独立 admin authority helper 和两条 journey：Operator 从
  production adapter 重读四区，完成 literal email 筛选、停用、一次性邀请和 kill switch，再刷新
  disabled/kill-switch/audit 权威；2026-08-24 非 Operator journey 随 Phase 72 安全契约校准为首次 403
  显示统一密码重新认证门、成功重新认证后第二次 403 才显示无权限，且两次 access 间及之后均为零下游
  管理读取。邀请 token 刷新后不在 DOM，且从未进入 Web Storage/公开 snapshot。
- 本轮 focused Playwright 2/2、完整 Playwright 96/96、114/114 脚本、411 个 Vitest 文件（2,582 passed /
  12 skipped）、Web E2E strict typecheck、instructions/architecture 与受影响 ESLint/Prettier 均通过；
  production bundle 仍只有既有单 chunk >500 kB 警告。

## 10. 2026-08-14 实现后再审阅

19A/19B 的接口、事务、Web 组件与隐私边界仍与现行产品口径一致；没有发现需要改公共 contract、
Postgres 状态机或 production Web API 的需求。真实 Operator browser journey 继续属于部署证据，不能由
本地 route fulfill 替代。此前离线门禁只证明 React 组件注入 fake API；现已用独立 helper + 两条 actual
bundle journey 补齐 production bootstrap、Cookie/CORS、Admin adapter、一次性 fragment 生命周期和
access 失败关闭，且未放宽近期认证、角色、strict body 或写证明。

## 11. 2026-08-24 普通邀请生命周期显示校准

真实 Hosted `/admin` 完成密码重新认证并读取四区后，邀请区的四条历史记录只显示 ID 与过期时间；因为
这些记录没有可见撤销按钮，Operator 无法判断它们是已领取、已撤销还是已过期。审查确认这不是后端
能力缺失：strict resource、`admin_list_invitations` 与 Web adapter 已传递 `consumedAt/revokedAt`，
`admin_execute` 也已有 recent-auth/operator、Origin/CSRF/key、幂等撤销与空 safeDetails 审计。根因是 Web
渲染丢弃了状态字段，并且仅以“未领取且未撤销”决定按钮，连过期项也可能误显示为可撤销。

最小修复不新增 migration、公开 route、token 存储或角色 grant：Web 从既有五个公开字段投影四态，只为
可领取项显示二步撤销，并在撤销刚创建项时清除当前内存 path；API/Postgres 回归固定 same-key replay、
单一无正文审计和不可撤销终态，actual production bundle journey 固定 create→可领取→revoke→已撤销→
刷新后仍为已撤销且 token 不进入 storage/snapshot。候选 `526fb8b` 已通过 Web-only arm `bb21817` 的唯一
Ready Production deployment `2D2o6cYZJWSRKLHKQQB7XXxZRAt1` 上线，并以独立 `636968d` 关闭；live 已显示
新 bundle。独立复核使用用户仍有效的 recent-auth 会话读取到一条“已领取”和三条“已撤销”，终态行均
无撤销入口且 console error 为零。当前没有 active/expired 行；active 标签与二步撤销必须随唯一普通邀请
验证，expired 标签保留到真实过期行出现时验证。在此之前不创建或撤销真实普通邀请。

## 12. 2026-08-24 UI 合并后的 Hosted 复核

Cloud Web UI 重设计已合并为 `524a55b`，并通过 Web-only arm `f3feff1` 的唯一 Ready deployment
`DU6wE2r9ZLeSSoAMZAbsQihBjC72` 上线；独立 `d6d901c` disarm 没有新增非 Canceled deployment。
管理员页只同步 token 与排版，不改变 recent-auth、Operator、Origin/CSRF/Idempotency 或二步确认。

真实浏览器刷新 `/admin` 后显示 exact arm short SHA，但 15 分钟 recent-auth 已在合并、全门与部署期间
自然过期，因此准确回到密码重新确认页；登录 session 本身仍有效。下一项必须由 Operator 本人再次输入
当前密码。自动化不得读取、保存或提交密码，也不得把“曾进入控制台”当作无限期 recent-auth。重新进入后
先回读四区与邀请列表，再经用户即时确认创建唯一普通邀请。
