# AccountSignInMethods 身份绑定与登录授权方案

## 1. 状态与问题校准

影响平台为 `shared`。产品要求 Google 与密码身份只能在已登录且重新认证后显式绑定，不能按相同邮箱
静默合并；实施计划也曾把身份绑定列为 pending。实现前的全局源代码审计确认当时没有 sign-in method
资源、绑定契约、数据库权威、API 或 Web UI，且密码/Google 登录只根据 Supabase 返回的 user ID 创建
Huayi session；后续 Phase A/B 实现均以这项审计为起点，不能把该历史描述误读为当前缺口。

2026-08-14 对当前 Supabase 官方文档的复审暴露了更早的安全兼容问题：Supabase Auth 默认会把具有相同
已验证邮箱的 OAuth identity 自动链接到既有 user，而 manual identity linking 仍需项目显式开启。仅在
Huayi UI 隐藏绑定按钮不能满足“不静默合并”，因为普通 Google login 或邀请 Google registration 已可能
先在 Auth 层发生自动链接。参考：

- [Supabase Identity Linking](https://supabase.com/docs/guides/auth/auth-identity-linking)
- [Supabase linkIdentity](https://supabase.com/docs/reference/javascript/auth-linkidentity)
- [Supabase refreshSession](https://supabase.com/docs/reference/javascript/auth-refreshsession)

本方案增加 Huayi 自有 sign-in method 授权权威：Supabase 可以完成身份验证，但只有已登记到同一
HuayiAccount 的 provider 才能创建 Huayi Web session。这样即使上游发生 email-similarity auto-link，也
不能绕过邀请或显式绑定取得 Huayi 数据访问。当前状态为
`Phase A implemented; Phase B offline implementation complete; target-platform validation pending`；
PasswordRecovery 拆为后续独立方案，不与 identity linking 共用 purpose/session 状态机。

## 2. 产品行为与安全不变量

### 2.1 登录授权

1. 邀请注册完成时只登记实际使用的首个 method：`password` 或 `google`；
2. 普通密码/Google 登录在 provider 成功后还必须验证 `(userId,method)` 已登记；缺失统一返回
   `authentication_required`，不得创建 Huayi session、profile 或 method；
3. 邀请 finalization 遇到既有 profile 必须失败，除同一已消费 invitation 的幂等恢复外，不得把邀请用于
   登录既有账号或补绑 method；
4. 相同邮箱不是 HuayiAccount identity proof；email 只作为规范登录邮箱投影；
5. disabled 的已登记 method 可创建 data-rights session，deleting 仍拒绝；未登记 method 在任何状态都
   不能登录。

### 2.2 显式绑定

- 账号页只显示 `password`/`google` 两种 method 是否已连接，不显示 provider subject、identity ID、token
  或 metadata；
- 绑定前要求 active/full Cookie、可信 Origin、CSRF，以及 15 分钟内由目标前置方式产生的显式重认证来源：
  password→Google 必须是 `reauthenticatedMethod=password`，Google→password 必须是
  `reauthenticatedMethod=google`；普通登录虽然会刷新时间，但来源为 null，不能冒充绑定授权；
- password 账号以当前密码重新认证后才可开始 Google linking；Google OAuth callback 必须返回同一
  Supabase user ID，随后才能登记 `google`；
- Google-only 账号先通过独立 Google reauthentication flow 刷新 `reauthenticatedAt`，再设置至少 12 字符
  密码并登记 `password`；不能用已有 Cookie 本身冒充重新认证；
- V1 只新增绑定，不提供解绑。避免唯一 method 删除、账号锁死和跨设备 session 语义扩散；
- 每次成功绑定撤销除当前 Web session 外的全部 Web/Extension session，并发送 provider 安全通知；当前
  session 轮换 ID/CSRF/refresh token。若通知配置或实际交付未验证，发布保持 blocked。

### 2.3 上游自动链接隔离

上游 provider 成功但 Huayi method 缺失时：

- API 不签发 Huayi Cookie，也不修改 `account_sign_in_methods`；
- invitation flow 不消费 invitation、不复用既有 profile；
- 只记录无 email/provider subject 的稳定安全事件与 request ID；
- 不依赖立即 unlink 上游 identity 才保持 Huayi 数据安全。unlink 可作为受控补偿，但不能成为授权正确性
  前提；
- Dashboard 必须开启 manual linking、邮箱确认、identity-linked/password-changed 安全通知，并在目标
  Supabase 项目验证 auto-link containment。

## 3. 数据与契约

### 3.1 数据表

```sql
account_sign_in_methods (
  owner_user_id uuid references user_profiles(user_id) on delete cascade,
  method text check (method in ('google','password')),
  linked_at timestamptz not null,
  primary key (owner_user_id, method)
)
```

表启用/强制 RLS，但普通业务 role 不直接写；邀请 finalization 与显式 link 使用 SECURITY DEFINER 函数在
锁定 profile/session 后原子插入。公开资源固定为：

```ts
type AccountSignInMethods = {
  methods: Array<{ method: "google" | "password"; linkedAt: string }>;
};
```

列表最多两项，按 `password,google` 固定顺序；不返回 owner、provider identity ID、email、subject 或
`isPrimary`。账号导出可包含这两个非秘密登录方式及 linkedAt；账号删除随 profile 删除。

### 3.2 auth flow 与 session

`auth_flows.kind` 扩展为 `invite-registration | login | reauthenticate-google | link-google`。后三者无 invitation
ticket；reauth/link flow 绑定 `owner_user_id`、发起 `web_session_hash` 与 purpose，单次、15 分钟过期。
callback 必须同时匹配 flow purpose、当前 Supabase user ID 和发起 session；不能把普通 login callback
升级成 link。

Google start POST 不把 flow ID 放进 JSON/URL：API 生成 opaque intent、只存 hash，并设置
`HttpOnly; Secure; SameSite=Strict` 的 15 分钟 intent Cookie，Path 仅限固定 continue route；响应仍只返回
常量 `continuePath`。顶层 GET 同时携带当前 Web Cookie 与 intent Cookie，数据库原子把该 flow 标为
started 后才 302 Provider，并立即清 intent Cookie。Provider callback 使用服务端 flow query 与当前 Web
Cookie 完成 purpose/session/user 三重校验；intent、provider state、code、token 均不进入 Web URL、Storage
或公开响应。

现有 encrypted `web_sessions.refresh_ciphertext` 必须支持 provider session 的单次切换，但密码与 Google
使用不同策略：

- password reauthentication 先用当前 full session 在服务端读取规范邮箱并确认 password method，再由
  `AuthProvider.signInWithPassword(email,password)` 创建一条新的 provider session；只有返回同一 user ID
  后，数据库才在同一事务撤销旧 Huayi session、写入新 refresh ciphertext，并轮换 session ID/CSRF。
  错误密码、不同 user ID、Provider 失败或旧 session 已被并发轮换时均不得修改旧 Huayi session；
- Google reauthentication 通过新的 Google OAuth 登录显式证明用户控制权，callback 必须返回与发起
  Huayi session 相同的 Supabase user ID；成功才原子轮换 Huayi session 与 callback 返回的新 encrypted
  refresh。它不先消费当前 refresh token。
- Google linking 才使用当前 encrypted refresh token 恢复 provider session并调用 manual link。该流程必须
  先对 session 建立 purpose-bound 单写 lease，再调用 provider refresh/link；成功提交新 ciphertext，失败
  或超时按可恢复状态机处理，不能让两个并发请求重复推进同一 refresh generation。

这样避免为了验证密码而先消费旧 refresh token：Supabase 的密码验证入口是 email+password 登录，而
refresh token 默认单次轮换；若先 refresh 再校验，Provider 成功而数据库未提交会留下 ciphertext stranded
窗口。两种流程失败都不得推进 `reauthenticatedAt`。

`web_sessions` 同时保存内部 `reauthenticated_method password|google|null`。普通登录/邀请 session 固定为
null；password/Google reauth 的原子轮换分别写 password/Google。绑定事务必须同时校验该来源和
`reauthenticated_at >= now()-15 minutes`，不能仅凭一个新创建的 Cookie 或普通登录时间授权。

Google manual link 的 refresh lease 固定为可恢复四阶段，而不是一次 GET 内的不可恢复外部调用：

1. `claimed`：link flow 绑定 password provenance 的当前 session，并以数据库唯一 open-flow 约束取得该
   session refresh generation 的单写权；
2. `refreshed`：API 解密当前 refresh，`AuthProvider.refreshSession` 取得新 session/state；数据库先替换
   当前 encrypted refresh 并保存 protected provider state，旧 token 的 parent-reuse 只作网络恢复边界；
3. `provider-started`：`AuthProvider.beginGoogleLink` 从已持久化 state 调用 manual `linkIdentity`，数据库
   保存更新后的 PKCE state 后才 302；进程中断可从 refreshed state 重试，不重复 refresh；
4. `completed`：callback exchange 后在同一事务校验 flow/session/user，插入 google method、轮换当前
   session、撤销其他 Web/Extension sessions并消费 flow。错 user/replay 不写 method/session。

flow 需要 `stage claimed|refreshed|provider-started|completed`（终态仍以 consumed 时间为准）、30 秒单写
lease 和受保护 state；lease 只保护内部推进，不进入 Cookie/URL/公开响应。数据库/日志/公开 schema 不保存
clear refresh/access token。expired open flow 由新 start/维护任务安全终结，不能永久阻止重试。

Google→password 也不能在一个 POST 中直接 refresh→`updateUser({password})`→登记 method，否则 Provider
refresh 成功、数据库未提交时同样会 stranded。它使用独立 `link-password` purpose 和四阶段：

1. `claimed`：校验 Google provenance、password 尚未登记、Cookie/Origin/CSRF，并取得当前 refresh
   generation 的 30 秒单写 lease；
2. `refreshed`：`AuthProvider.refreshSession` 后先原子替换 encrypted refresh，并保存 protected provider
   session state；明文新密码不保存；
3. `provider-updated`：从 persisted state 调 `updateUser({password})`，核对同一 user ID 后保存无秘密 stage；
   若外部成功与 stage 提交之间中断，用户以同一密码重试是幂等更新，不重复 refresh；
4. `completed`：事务插入 password method、轮换当前 Huayi session、撤销其他 Web/Extension session并消费
   flow。数据库失败后可从 provider-updated 重试，不再次发送密码到其他系统。

Supabase “Secure password change” 对不够新的 provider session 可能要求邮件 nonce；本流程前置 Google
reauth callback 创建新 provider session，但仍必须在目标项目验证 Dashboard 设置、24 小时 recent-session
判断与 `reauthentication_needed` 错误，不能在离线 fake 中假设。

### 3.3 HTTP

| Method/path                                       | 语义                                                         |
| ------------------------------------------------- | ------------------------------------------------------------ |
| `GET /v1/account/sign-in-methods`                 | active/full Cookie；strict 两项以内投影                      |
| `POST /v1/auth/reauthenticate/password`           | Cookie+Origin+CSRF；`{password}`；轮换当前 session           |
| `POST /v1/auth/reauthenticate/google/start`       | Cookie+Origin+CSRF；strict `{}`；返回固定同 API continuePath |
| `GET /v1/auth/reauthenticate/google/continue`     | 当前 Cookie+one-time intent；302 provider                    |
| `POST /v1/account/sign-in-methods/google:start`   | recent auth+CSRF；返回固定同 API continuePath                |
| `GET /v1/account/sign-in-methods/google:continue` | 当前 Cookie+one-time intent；302 provider                    |
| `POST /v1/account/sign-in-methods/password`       | recent Google reauth+CSRF；`{password}`；登记 password       |

start mutation 返回的 `continuePath` 是 strict 相对常量，不返回第三方 URL；浏览器随后顶层导航到同 API GET，
API 才 302 provider。所有响应 private/no-store。认证/start/link 不是可重放资源写，不使用
Idempotency-Key/If-Match；数据库 one-time intent/flow 与 method 唯一键提供 exactly-once 边界。

重复绑定使用稳定 HTTP 409 `sign_in_method_already_linked`，不折叠为认证失败。该判定只能在同一数据库
函数已经锁定并验证 active/full session、Origin/CSRF 与目标绑定要求的 recent-auth provenance 后发生；
未认证、普通登录、错误 recent-auth、已撤销或跨账号请求仍统一
`authentication_required`，不得用 already-linked 探测账号。already-linked 不创建 flow、不调用 Provider、
不轮换 session，也不撤销其他 session；Web 收到后重读 canonical method list，并显示“已绑定”而不是要求
重复重认证。

这也校正 `api.md` 的过宽通用句：“所有写请求”并非都使用幂等 header；只有各资源契约显式声明的可重放
mutation 使用 Idempotency-Key，认证、邀请、一次性 pairing/link flow 按专用状态机恢复。

## 4. 模块路线

1. `cloud-contracts` 定义 method resource、reauth/link request/response 和固定 route；
2. migration 增加 method 表、flow purpose/owner/session 绑定、邀请 finalization method 参数、login method
   authorize 与原子 link/session-rotation functions；
3. password reauth 复用 `AuthProvider.signInWithPassword` 创建新 provider session；Google 路线再增加
   purpose-bound provider session refresh/link 与 callback 结果。adapter 使用服务端临时 storage，token
   只进入 encrypted state/session；
4. Hono 按 route 拆 `AccountSignInMethodsApp`，foundation 只保留邀请/login 组合；所有失败使用稳定安全码；
5. Web `/settings/account` 增加窄 `SignInMethodsPanel`，production identity adapter 只接上述 routes；
6. actual-bundle authority 分别覆盖 password→Google 与 Google→password，且普通 login auto-link containment
   必须有失败关闭 journey。

## 5. TDD 顺序与测试矩阵

### 5.1 Phase A：登录授权 fence（已实现）

- RED：密码注册只登记 password；Google 注册只登记 google；现有普通 login 未检查 method；邀请可对既有
  profile finalization；
- contracts 拒绝 owner/subject/identityId/token/未知 method；
- PGlite 覆盖 invitation new-only、same-flow replay、existing-profile rejection、method RLS/唯一键；
- password/Google login provider 成功但 method 缺失时零 session；已登记 active/disabled/deleting 分别为
  full/data-rights/reject；
- 回归现有 invitation/password/Google actual-bundle journey，确保测试 seed 明确登记 method。

### 5.2 Phase B：显式绑定

- password reauth 正确/错误/限速、provider 返回不同 user、Huayi session/refresh ciphertext/CSRF 单次原子
  轮换与并发旧 session 失败关闭；
- Google reauth/link 的 intent/flow purpose、15 分钟、session owner、callback user ID、replay 与错误 provider；
- password→Google、Google→password 原子登记，重复绑定诚实返回 409
  `sign_in_method_already_linked`；
- stale/wrong reauth、disabled/deleting、缺 Cookie/Origin/CSRF、不同 callback user、并发绑定均无 method/session
  部分写；
- 成功撤销其他 Web/Extension sessions，当前 session 继续且 method list server reread；
- Web loading/error/retry、二步确认、焦点/live region、390px/reduced-motion；DOM/URL/Storage/snapshot 零
  password/token/provider subject/flow material。

### 5.3 外部验证

- Supabase Dashboard manual linking、Confirm Email、redirect allowlist 和安全通知；
- 真实 password-only、Google-only 与同邮箱冲突账号；
- provider 取消、重复 callback、邮件通知、refresh token rotation 与多标签并发；
- macOS/Windows Chrome 的 Cookie/CORS/top-level redirect。

## 6. 验收标准

- 未登记 provider 永远不能创建 Huayi session，即使 Supabase 返回既有 user ID；
- 邀请不能登录既有 profile或静默补 method；新注册只登记实际 method；
- 两种显式绑定都要求近期重新认证，成功后 method list 从服务器重读且其他 sessions 撤销；
- callback purpose/session/user 三重绑定，provider/token/subject 不进入 Huayi public schema/log/Web；
- contracts/API/PGlite/Web/actual-bundle 与全量离线门禁通过；
- 真实 Supabase auto-link containment 与 manual linking 未验证前状态保持
  `implemented; target-platform validation pending`，不得开放邀请。

## 7. 实现前审查

- **发现的问题必须先处理**：现有架构把 Supabase user ID 直接当 Huayi 登录授权，无法落实“不按同邮箱
  静默合并”。在此基础上直接加 `linkIdentity()` 会扩大问题，Phase A authorization fence 必须先于 UI。
- **选择独立方法权威**：不从可变 provider metadata 即时推断 Huayi 权限；两行 owner 数据足够表达 V1
  登录能力，也可由账号删除/RLS/导出统一治理。
- **不自行实现 OAuth**：继续复用 Supabase PKCE/manual linking；Huayi 只增加 authorization fence、flow
  purpose 与 server-side refresh rotation。若目标 Supabase 无法可靠支持该组合，必须回到产品层选择
  “单一不可变登录方式”或替换 Google Auth 架构，不能放宽静默合并要求。
- **与密码恢复分离**：恢复是未登录、email-enumeration-safe、purpose-bound temporary session；绑定是
  已登录 recent-auth mutation。共享接口会诱发权限提升，因此另立后续方案。
- **结论**：Phase A 已按本审查路线完成；Phase B recent-auth、双向 purpose/session/user-bound flow 与
  账号页 UI 已复用同一 fence 落地，不能直接依据 Supabase identity metadata 授权。实现后复审发现的
  stale tab 重复提交问题也已校准：只有完整 Web proof 与目标要求的 recent-auth provenance 都成立后，
  已绑定 method 才返回稳定 `sign_in_method_already_linked`；无效认证仍保持统一 401。因此 Phase B
  离线实现已完成，剩余项是明确列出的目标环境验证，而不是已知离线契约缺口。

## 8. Phase A 实现与实现后复审

- contracts 新增固定 route、`password|google` enum 与 1–2 项 canonical strict projection；未知 method、
  重复/乱序、owner、subject、identity ID 和 token 全部拒绝；账号导出新增同一无秘密 method 投影；
- 内存与 Postgres 都把 profile 和 method 分成独立权威；密码邀请只登记 password，Google 邀请只登记
  google。邀请碰到既有 profile 固定失败，同一邀请只能以原 method 幂等恢复，不能借 replay 补绑；
- 普通密码登录在 provider 成功后、创建 Huayi session 前调用 method authorization；普通 Google callback
  在 login flow 内做同一检查。active/disabled 分别可继续取得 full/data-rights，deleting 与未登记 method
  均返回 `authentication_required` 且零 Cookie；
- migration 新增 `account_sign_in_methods`、forced RLS、owner policy、级联删除与 SECURITY DEFINER
  finalization/authorization。`huayi_business` 只有 SELECT，没有 method INSERT/UPDATE/DELETE；PGlite 已
  证明直接补 method 被拒绝、跨租户矩阵生效、邀请失败不消费 invitation；
- Postgres 与内存 method 逻辑分别拆入窄 adapter，生产源文件保持架构行数门禁；actual Web bundle 新增
  “provider 密码正确但只登记 Google”失败关闭旅程，统一 401、private/no-store、零 Set-Cookie；
- fresh 离线证据：114/114 Node scripts、414/414 Vitest files（2,593 passed / 12 skipped）、全 workspace
  typecheck/build、101/101 Playwright、目标 ESLint/Prettier、instructions/architecture 均通过。Web build
  仍只有既有的 500 kB chunk warning；真实 Supabase auto-link containment、manual linking、安全通知、
  邮件、部署与双平台 Chrome 未执行，因此不能开放邀请或宣称整体身份绑定完成。

## 9. Phase B 当前进度

- 只读 `GET /v1/account/sign-in-methods` 已接入 production account settings：active/full Cookie 认证后在
  forced-RLS owner transaction 内查询，按 password、google 固定顺序返回 strict/no-store 投影；Web
  identity client 同样 strict 解析，秘密形状和空 method 集合失败关闭；
- recent-auth/link contracts 已 RED→GREEN 固定六条 purpose-specific route、strict 空 Google start body、
  固定同 API continuePath，以及只含 password 的重认证/设置请求；email、userId、returnTo 和未知字段在
  provider 调用前拒绝；
- password reauthentication 已按文档校准后的安全路线 RED→GREEN：当前 active/full Cookie+Origin+CSRF
  解析服务端规范邮箱并确认 password method；每 IP+owner 每分钟五次；Provider password sign-in 必须
  返回同一 user ID。成功由内存/Postgres 同一深 seam 原子写新 encrypted refresh、session ID、CSRF 与
  `reauthenticatedAt` 并撤销旧 session；错误密码、错 user、未登记 method 与旧 session 重放均零写；
- Google reauthentication 也已 RED→GREEN：strict start 只返回固定 continuePath，opaque flow 仅进入
  HttpOnly Secure SameSite=Strict、continue-path-scoped intent Cookie；数据库将 15 分钟 flow 绑定
  purpose/owner/session，continue 单次启动 OAuth，callback 同 user 才原子消费 flow并轮换 encrypted
  refresh/session/CSRF，错 user 消费 flow但保留旧 session，callback replay 固定失败；
- recent-auth provenance 已补齐并复审：普通登录/邀请 session 写 null，password/Google reauth 分别写对应
  method；内存与 PGlite 同时验证错误来源和超过 15 分钟失败，后续 link 必须调用同一深 seam，不能只看
  `reauthenticatedAt`；
- manual Google link 已从 Provider seam 推进到可恢复深模块与 production Postgres adapter：strict start 使用
  独立 path-scoped intent；continue 取得 30 秒 purpose/session-bound 单写 lease，claimed 时只 refresh 一次并
  先原子保存新 encrypted refresh/state，refreshed 重试不再消费 generation；manual `linkIdentity` 返回的
  PKCE state 也在 302 前保存。callback 同 purpose/session/user 才插入 google method、轮换当前 Cookie并
  撤销其他 Web/Extension session，错误 lease/open-flow/replay 零部分写；
- Google→password 也已从 stranded-window 校准推进到 production 实现：独立 purpose 的
  claimed/refreshed/provider-updated/completed flow 与 30 秒 lease；authenticated provider state 上调用
  `updateUser({password})`，明文密码不持久化；内存/Postgres 最终事务新增 password method、轮换当前
  Cookie并撤销其他 sessions，provider/database 失败从已提交 stage 恢复；
- Web `/settings/account` 已接入窄 `SignInMethodsPanel`：服务器读取 canonical method list；password-only
  账号必须在同一表单以 `current-password` 重认证后才开始 Google link；Google-only 账号先经独立 Google
  reauth 顶层跳转，再以 `new-password` 提交。绑定密码后不信任 mutation body 推断状态，而是重新
  bootstrap 轮换后的 Cookie/CSRF 并重读 method list；loading/error/retry、live status、可见 label、390px
  单列和 reduced-motion 沿用现有账号页约束，错误不把 password/provider detail 写入 DOM；
- actual Web bundle 已新增三条离线旅程：完整 password→Google fake provider callback、Google
  reauth→password，以及 stale password-link 收到 409 后重读服务器权威；它们验证 production
  route/client、Cookie/CSRF 轮换、服务器重读与 DOM 零密码；
- fresh 证据为 contracts 5/5、两种 link HTTP 12/12、两种深模块恢复 2/2、两种 link PGlite 4/4、
  Supabase adapter 4/4、Web identity 16/16、Web component 4/4 与 Web 包 38 文件/175 测试。API 包保持
  94/94 文件、323/323 测试；API/Web strict typecheck/build、目标 ESLint/Prettier、
  instructions/architecture/diff-check 均已通过；组合与 migration 最后改动另有
  focused 20/20 回归。完整离线门禁复跑结果见项目状态；Phase A 全量证据保持有效但不冒充本增量全量
  证据；
- 实现后审查确认 already-linked 已由公共 strict code、HTTP 409、内存/Postgres 深 seam 和 stale Web
  恢复共同覆盖；错误 CSRF/无效 session 不获得该披露，且不创建 flow、不调用 Provider、不轮换或撤销
  session。provider 安全通知和真实 Supabase manual-link/auto-link/secure-password-change containment 仍
  pending，因此不能把当前离线实现解释成目标环境验收完成。
