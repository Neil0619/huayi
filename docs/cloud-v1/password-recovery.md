# PasswordRecovery 密码恢复方案

## 1. 状态与全局校准

影响平台为 `shared`。当前产品已实现邀请密码注册、邮件确认、密码登录、登录后近期重认证、
Google→password 显式绑定，以及 PasswordRecovery 的离线 Web 入口与浏览器验收。
`privacy-policy.md` 已声明邮件提供商用于密码恢复，
`account-sign-in-methods.md` 又明确恢复必须是未登录、email-enumeration-safe、purpose-bound temporary
session，不能复用已登录 identity-link flow。本方案补齐这项独立能力，当前状态为
`R3-C production notification code offline implemented; real Resend/DNS delivery and R5
target-platform validation pending`。

2026-08-14 复核的 Supabase 官方行为是：`resetPasswordForEmail` 支持 PKCE，并把用户带回配置的固定
redirect URL；回调 code 必须与同一 PKCE flow 的 verifier 一起交换，code 短时且单次；更新密码仍要求
一个已验证的 Provider session。官方“同一浏览器”限制针对 verifier 保存在浏览器 storage 的默认客户端
形态；Huayi 将 verifier 加密保存在服务端 flow，因此推断邮件链接可在另一浏览器建立新的 purpose
session，但仍必须携带同一短时 flow+code。生产 redirect 应使用精确路径，不使用通配目标。参考：

- [Supabase resetPasswordForEmail](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail)
- [Supabase password reset guide](https://supabase.com/docs/guides/auth/passwords#resetting-a-password)
- [Supabase PKCE flow](https://supabase.com/docs/guides/auth/sessions/pkce-flow)
- [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase PKCE email-link scanner guidance](https://supabase.com/docs/guides/troubleshooting/pkce-flow-errors-cannot-parse-response-or-zgotmplz-in-magic-link-emails-433665)
- [OWASP Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)

Huayi Web 继续不直接持有 Supabase client、access token、refresh token 或 PKCE verifier。Provider
session 和 PKCE state 只在 API adapter 与加密临时记录中流转；浏览器只得到短时、purpose-scoped、
HttpOnly recovery Cookie 和一次性 CSRF。

## 2. 产品需求与非目标

### 2.1 用户行为

1. `/login` 提供“忘记密码？”链接；公开 `/recover` 页面可提交规范邮箱；
2. 无论邮箱不存在、账号不是 active、未登记 password method，还是符合条件并已请求邮件，页面都只
   显示同一文案：“如果该邮箱可恢复，我们已发送邮件”；
3. 用户可在能够安全访问该邮箱的浏览器打开邮件链接。链接先到固定 API 惰性确认页；只有用户显式点击
   “继续重置密码”后才 POST callback、交换 code，并在该浏览器建立 recovery session，随后进入 Web
   `/recover?continue=1`，不直接创建 Huayi 登录 session；
4. Web 以短时 recovery Cookie 读取恢复状态，要求两次输入相同、至少 12、最多 256 字符的新密码；客户端
   只向 API 发送一份匹配后的 password。成功后清除密码输入、recovery Cookie 和所有既有 Huayi Web/
   Extension sessions，再要求用户从 `/login` 重新登录；
5. 过期、重复、旧邮件、错误 code/flow、错误 Origin/CSRF、账号状态变化或 Provider user 不匹配，都
   显示同一可重新发起的恢复失败，不回显账号、method、Provider 或 token 细节；
6. 成功修改密码产生一条耐久的安全通知任务；邮件发送失败不回滚已完成的改密与会话撤销，但发布前
   必须验证通知重试和告警。

### 2.2 身份边界

- 只有 active Huayi profile 且已登记 `password` method 的规范邮箱才可创建 Provider recovery；
- Google-only、未知、disabled、deleting 或孤立 Supabase identity 都得到相同 202，但不创建 flow、
  不调用 Provider，也不能借恢复新增 password method；
- Provider callback 返回的 user ID 和规范邮箱必须同时匹配 flow owner；相同邮箱或 Provider session
  本身不是 Huayi 授权；
- recovery session 只授权“为同一 owner 修改一次密码”，不能读取账号、学习数据、额度、登录方式或
  数据权利资源，也不能转换成 full/data-rights Huayi session；
- 成功恢复不改变 `account_sign_in_methods`、profile、偏好、学习数据或 Extension 本机数据。

### 2.3 非目标

- 不提供账号查找、邮箱更换、验证码输入登录、magic link 登录、Google identity 恢复或解绑；
- 不在 Web local/session storage、URL fragment、公开 JSON 或日志保存 provider token、flow secret、
  PKCE verifier、新密码或完整邮箱；
- 不用 Supabase service-role 管理员改密绕过 authenticated recovery session；
- 不要求发起 start 的浏览器保存 PKCE verifier；verifier 由 API 加密保存。邮件链接是短时 bearer proof，
  用户必须像保护一次性登录链接一样保护它；
- 不把 fake mail、PGlite 或 actual bundle 解释成真实 Supabase、邮件投递、域名 Cookie 或双平台 Chrome
  证据。

## 3. 公共 HTTP 契约

| Method/path                                | 公开行为                                                       |
| ------------------------------------------ | -------------------------------------------------------------- |
| `POST /v1/auth/password/recovery`          | strict `{email}`；总是 202 `{accepted:true}`，符合条件才发信   |
| `GET /v1/auth/password/recovery/confirm`   | `flow`+`code`；只渲染惰性本地确认页，不消费 code               |
| `POST /v1/auth/password/recovery/callback` | exact form `flow`+`code`；单次 exchange；固定 302 Web recovery |
| `GET /v1/auth/password/recovery/session`   | recovery Cookie+Web Origin；返回短时 `{csrfToken,expiresAt}`   |
| `POST /v1/auth/password/recovery/complete` | Cookie+Origin+CSRF+strict `{password}`；成功 204 并清 Cookie   |
| `GET /internal/password-recovery/run`      | CRON bearer；每次有界领取一个待发邮件 flow                     |

五个公开响应都固定 `Cache-Control: private, no-store`；confirm/callback 另固定
`Referrer-Policy: no-referrer`。confirm HTML 固定 CSP
`default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`，不加载脚本、图片、字体或
第三方资源；GET 不读取 flow state、不交换 code、不设置 Cookie。start 的 202 不设置 recovery/Web Cookie，
不返回 flow、过期时间、账号存在性或 Provider 结果。callback 的成功和预期失败都只跳转固定 HTTPS
`/recover?continue=1`；flow/code 只短暂存在于 API callback URL，不进入 Web URL。

recovery Cookie 名为 `huayi_password_recovery`，属性固定为
`HttpOnly; Secure; SameSite=Lax; Path=/v1/auth/password/recovery; Max-Age=900`。部署必须保证 Web 与 API
属于同一 site；否则现有 Huayi Web session 与本 recovery Cookie 都无法按当前 Cookie 模型工作。session
GET 只返回 32–256 字符一次性 CSRF 和 ISO expiry，不返回 owner/email/method/stage。complete 不使用
Idempotency-Key：它由 recovery session、CSRF、数据库 stage 与 lease 提供一次性恢复语义。

公共错误继续复用：非法 JSON/字段为 400 `invalid_request`，无效 recovery proof 为统一 401
`authentication_required`，错误 Origin/CSRF 为 403 `forbidden`，限速为 429 `rate_limited`。不得新增
`account_not_found`、`password_method_missing` 或 Provider 原始错误。

## 4. 技术路线与深模块

### 4.1 生产流程

```text
Web /recover
  -> POST recovery {email}
  -> always 202 accepted; no Cookie
  -> eligible owner only: atomically create hashed requested flow
  -> trusted worker marks dispatch before Provider resetPasswordForEmail
  -> save encrypted PKCE/provider state as sent; never retry ambiguous dispatch

user explicitly opens the latest email in a browser
  -> GET API recovery/confirm?flow=<opaque>&code=<opaque>
  -> inert no-store/no-referrer page; user explicitly POSTs exact flow+code form
  -> POST API recovery/callback
  -> exchange code with protected state
  -> verify owner userId + normalized email + active/password method
  -> rotate one recovery-session hash + CSRF hash
  -> Set-Cookie purpose-scoped; 302 fixed Web /recover?continue=1

Web recovery completion
  -> GET recovery/session with Cookie + Origin
  -> POST recovery/complete {password} with Cookie + Origin + CSRF
  -> claim 30-second lease; decrypt provider state; updateUser({password})
  -> atomically complete flow, revoke all Huayi Web/Extension sessions,
     enqueue password-reset-completed security notification
  -> 204 + clear recovery Cookie -> user explicitly returns to /login
```

### 4.2 模块接口

HTTP handler 只做 strict parsing、固定 header/Cookie/redirect 和错误映射。业务语义收在一个
`PasswordRecoveryModule`，Provider 与存储通过窄 ports 注入：

```ts
interface PasswordRecoveryModule {
  request(command: { email: string; ipBucket: string }): Promise<void>;
  dispatchNext(): Promise<"failed" | "idle" | "sent">;
  callback(command: { code: string; flowId: string }): Promise<RecoveryBrowserSession>;
  readSession(command: { origin: string; recoverySessionId: string }): Promise<RecoverySession>;
  complete(command: {
    csrfToken: string;
    origin: string;
    password: string;
    recoverySessionId: string;
  }): Promise<void>;
}

interface PasswordRecoveryProvider {
  begin(command: {
    email: string;
    redirectTo: string;
  }): Promise<{ authState: Readonly<Record<string, string>> }>;
  exchange(command: {
    authState: Readonly<Record<string, string>>;
    code: string;
  }): Promise<{ authState: Readonly<Record<string, string>>; email: string; userId: string }>;
  updatePassword(command: {
    authState: Readonly<Record<string, string>>;
    password: string;
  }): Promise<{ authState: Readonly<Record<string, string>>; userId: string }>;
}

interface SecurityNotificationSender {
  sendPasswordResetCompleted(command: { email: string; idempotencyKey: string }): Promise<void>;
}

interface SecurityNotificationRepository {
  claim(): Promise<{
    attemptCount: number;
    deliveryDeadline: Date;
    email: string;
    leaseToken: string;
    notificationId: string;
  } | null>;
  complete(command: { leaseToken: string; notificationId: string }): Promise<void>;
  retry(command: { availableAt: Date; leaseToken: string; notificationId: string }): Promise<void>;
}
```

`request()` 对不符合条件的邮箱正常返回且不入队；符合条件时只在本地 trusted transaction 创建
`requested` flow，不等待 Provider，因此公开响应不携带外部网络时延差异。每次符合条件的新 request
原子终结同 owner 的旧未消费 flow/recovery session，因此只有最新邮件可用。`dispatchNext()` 由固定
CRON bearer 触发，每次最多领取一个 flow；claim 会再次验证 active profile+password method，账号状态或
method 在 request 后改变时直接终态化且零 Provider。worker 在 Provider 前耐久写 `dispatchAt`，发信成功后
才保存 protected state 并进入 `sent`。dispatched worker 丢失属于“可能已发信”，不得透明二次发送；flow
标记 failed，用户可显式重新请求。callback/complete 可以返回统一失败，因为持有邮件或 recovery proof
的调用者已经处于恢复流程中，但仍不披露具体原因。

### 4.3 Provider adapter

- `begin()` 使用 server-created Supabase client、PKCE、`persistSession=true` 和私有内存 storage 调用
  `resetPasswordForEmail(email,{redirectTo})`，只返回 storage state；
- `exchange()` 使用保存的 state 调用 `exchangeCodeForSession(code)`，要求 session/user/email 全部存在，
  再返回更新后的 state；
- `updatePassword()` 只用恢复 session 的 auth state 调用 `updateUser({password})`，不使用 service role；
- adapter 将 Provider error 全部映射为固定 `authentication_required`，不得把 error/message/status 写入
  公共响应或普通日志；
- production composition 逐请求创建 Auth client，禁止模块级共享 user-specific storage。

## 5. 数据结构与状态机

新增独立 `password_recovery_flows`，不复用邀请/登录/link 的 `auth_flows`：

| 字段                               | 语义                                                              |
| ---------------------------------- | ----------------------------------------------------------------- |
| `flow_hash`                        | 主键；邮件 callback 中 opaque flow ID 的 keyed hash               |
| `owner_user_id`                    | 仅由规范 email+active profile+password method 的 trusted 查询确定 |
| `stage`                            | requested、sent、verified、provider-updated、completed、failed    |
| `provider_state_ciphertext`        | PKCE verifier、Provider recovery/refresh session 的加密状态       |
| `callback_flow_ciphertext`         | worker 构造固定 callback 所需的 flow secret 加密值                |
| `recovery_session_hash`            | callback 后浏览器 purpose Cookie 的 keyed hash；可空、唯一        |
| `csrf_hash`                        | session GET 轮换的短时 CSRF keyed hash；可空                      |
| `dispatch_lease_hash/expires_at`   | worker 发信前的 60 秒 claim；dispatch 前过期可安全接管            |
| `completion_lease_hash/expires_at` | complete 的 30 秒单写 lease；与 dispatch lease 分 purpose         |
| `dispatch_at`                      | 邮件 Provider 调用前耐久写；存在时禁止透明再次发信                |
| `expires_at`                       | request flow 最多 30 分钟                                         |
| `browser_expires_at`               | callback 后最多 15 分钟；可空                                     |
| `consumed_at/created_at`           | 单次终态与审计时间                                                |

约束：每 owner 最多一个未消费 flow；新 request 先终结同 owner 的旧 flow；stage 单向推进；两个 lease 的
hash/expiry 各自必须同时为空或同时存在且不能跨 purpose 使用；sent 前必须有 dispatchAt 和 protected
state，verified 前不能出现 recovery session/CSRF；completed 必须有 consumedAt；表启用 forced RLS，业务 role 无
SELECT/INSERT/UPDATE/DELETE，只能调用 fixed-search-path SECURITY DEFINER 函数。账号删除级联 flow。所有
secret 只存 keyed hash 或加密 ciphertext，明文 email、code、Cookie、CSRF、新密码和 Provider token 不入表。

另新增通用 `security_notification_outbox`：`id`、owner、固定 kind、status、attempt count、23 小时
`delivery_deadline_at` 与 available/sent/created timestamps。恢复成功事务只写
`kind=password-reset-completed`，不写密码、token、IP、user agent 或 Provider detail；worker 发送时从
active/disabled profile 读取当前规范邮箱。通知失败可重试并告警，不回滚密码变化。通知 worker 每次只领取
一条、使用 120 秒 keyed lease；最多 8 次，发送失败按
`min(deadline, 6 hours, 60 seconds * 2^(attemptCount-1))` 退避。到期行在 Provider 前进入 `failed`，尝试
耗尽行在 Provider 前或最后一次失败后进入 `dead-letter`；一次 claim 最多终态化 100 条。邮件 port 只接收规范
邮箱、outbox notification ID 形式的幂等键和固定 `password-reset-completed` 模板意图，不接收 flow、
token、IP、密码或 Provider detail；真实 sender 必须把该 ID 映射为厂商幂等键，使“已投递但本地 complete
失败”的 lease 接管不会重复发信。该
outbox 后续可复用登录方式绑定通知，但不会与 recovery flow 合并。无正文 alert port 只接收固定 reason 与
1–100 的 count；不得接收 email、owner、notification ID、正文或原始异常。

R3-C 仓库代码固定使用 Resend `https://api.resend.com/emails`、notification ID 幂等键、20 秒请求上限和
固定“密码已重置”模板；API key、from 与 Reply-To 只从 hosted secret 环境读取。独立
`GET /internal/security-notifications/run` 只接受 CRON bearer 并只返回 bounded outcome。production
Supabase operations SQL 安装第五个独立 minute job。本机验收只能显式使用
`disabled-local-acceptance`，且该模式被三个固定 localhost origin 限定；route 返回 idle，不读取 outbox、
不调用 Resend。真实 verified sender/DNS、分离 credential 与托管配置已完成；Resend 真实投递、重复投递
观测、监控目的地和对应 Dashboard 结果仍是外部发布门禁。

### 5.1 2026-08-20 外部前置条件延期

用户确认当前没有自有正式域名，也没有可管理的 DNS、邮件发送账号、verified sender、真实支持邮箱或
告警目的地；R3-C 因此外显为待处理项。本阶段不购买域名、不注册或配置 Resend、不创建 API key、不添加
DNS 记录，也不实现真实 sender/CRON/告警。现有 fake sender 与离线证据不得被解释为生产邮件能力。

后续恢复该阶段时，暂定选型顺序如下，但仍须由用户在购买前最终批准并重新核价：

1. 首选 Cloudflare Registrar + Cloudflare DNS，原因是注册与续费按 registry/ICANN 成本收费、DNSSEC 和
   WHOIS redaction 随服务提供，并可使用 Resend 的 Cloudflare 自动 DNS 配置；若国际支付或账号条件不便，
   备选腾讯云域名 + DNSPod，并接受实名认证与手工复制 DNS 记录；
2. 主域优先选择可长期代表 Huayi 品牌的普通 `.com`，不要购买容易混淆的相似域；邮件仅使用独立
   `notify.<root-domain>` 子域，子域无需另购；
3. Resend 暂作首选发送厂商。2026-08-20 官方公开价为 Free `$0/月`、3,000 封/月且最多 100 封/日；
   Pro `$20/月` 含 50,000 封，超额 `$0.90/1,000` 封。早期密码恢复预计可从 Free 起步，但正式开放前
   必须按真实用户量、服务条款与当日价格重审；
4. 恢复条件至少包含：已购买主域、明确 DNS 管理方、Resend 账号与计划获批、验证
   `notify.<root-domain>`、确定可监控的 Reply-To/支持邮箱和 dead-letter 告警目的地；API key 只能进入
   部署 secret，不得写入仓库、文档或对话。

### 5.2 2026-08-21 外部前置条件恢复

用户现已确认可以注册自有域名、Resend 并配置 DNS，5.1 的延期记录保留为历史但不再代表当前执行
状态。hosted acceptance 使用 `notify.acceptance.<root-domain>`，未来 production 保留
`notify.<root-domain>`；Supabase Auth 的 Resend custom SMTP 负责恢复链接，应用 R3-C 的 Resend HTTP
sender 负责消费 `security_notification_outbox`，两者使用不同 credential。域名/SPF/DKIM/SMTP 验证都
不能替代 R3-C 的仓库门禁。sender adapter、通知 CRON、厂商幂等窗口、terminal/dead-letter 与无正文告警
已完成 Fresh RED→GREEN；verified sender、分离 SMTP/HTTP credential、Supabase Custom SMTP 与 API R3-C
通知变量子集也已配置，受控真实投递、重复投递观测与监控接收方仍待 hosted 验收。

Resend 当前只保留 idempotency key 24 小时；实现因此固定 23 小时 delivery deadline、最多 8 次、
failed/dead-letter 终态与超窗零发送告警，并覆盖“Provider 已发送、数据库 complete 失败”只在窗口内以
同 notification ID 重放以及超窗后不再调用 Provider。完整厂商事实见
[Resend Idempotency Keys](https://resend.com/docs/dashboard/emails/idempotency-keys)。

参考当前官方资料：

- [Cloudflare Registrar](https://developers.cloudflare.com/registrar/)
- [Resend 价格](https://resend.com/docs/knowledge-base/what-is-resend-pricing)
- [Resend 域名验证](https://resend.com/docs/dashboard/domains/introduction)
- [Resend Cloudflare DNS 配置](https://resend.com/docs/knowledge-base/cloudflare)
- [腾讯云域名定价说明](https://cloud.tencent.com/document/faq/242/3708)

状态转换：

```text
requested --durable dispatch + provider begin--> sent
sent --valid single callback--> verified
verified --lease + provider update--> provider-updated
provider-updated --DB finalize--> completed

ambiguous dispatch/provider failure -> failed -> restart with a new user request
invalid/replayed/cross-owner proof -> no transition
```

Provider 更新成功到 `provider-updated` 提交之间存在不可消除的跨系统窗口。系统不得后台透明改密；用户
显式重试时可再次提交其当前输入，Provider 调用仍必须核对同一 user ID。`provider-updated` 已提交但最终
事务失败时，重试跳过 Provider，直接撤销 Huayi sessions、写通知并完成。

## 6. 安全、隐私与运维约束

- start 每 IP 每小时最多 10 次、每个 keyed normalized-email bucket 每小时最多 3 次；429 只反映调用者
  提交的 bucket 频率，不反映账号存在。公开成功 body、status、header 和文案完全一致；
- start 不调用外部 Provider；eligible/ineligible 都执行同一规范化、限速和 trusted lookup，有效且未限速
  的 202 从 handler 起点起至少等待 250ms 再返回。数据库或运行时超过该预算时仍可能有时延差异，因此
  测试固定 floor，不声称密码学不可区分；发布前另以实际部署分布复核预算是否需要提高；
- callback code/flow 单次、短时、精确 redirect；响应禁止缓存和 Referer。Web 首次读取 session 后立即
  `history.replaceState("/recover")` 清除固定 `continue=1` 标记；
- 邮件 GET confirm 不消费 code，只显示本地、无脚本/外链的显式 POST 按钮；这降低邮件 scanner 造成的
  提前消费风险。callback 只接受恰好两个字段的 form-urlencoded POST，拒绝 JSON、额外/重复字段；
- complete 在 Provider 前再次锁定 flow、profile active、password method、browser expiry、Origin、CSRF
  与 lease；Provider user ID 再次匹配 owner，任何失败都不创建 Huayi session；
- 成功事务撤销全部 Huayi Web/Extension sessions，包括发起恢复前的浏览器；LocalLexicon、BYOK/Eudic
  本机凭据不删除，账号绑定 outbox 按既有断开规则停止；
- 日志只允许 request ID、`recovery.request|callback|complete` stage、稳定 outcome 和聚合时延；不记录
  email/hash、flow/code、Cookie/CSRF、auth state、Provider error 或密码；
- cleanup 每次最多处理 100 条过期/完成超过 24 小时的 flow；通知 outbox 使用独立有界 lease。真实邮件
  模板必须说明“不是你操作则联系支持”，但正式支持联系方式仍是发布前外部事实门禁。

## 7. TDD 与验收矩阵

### 7.1 Contracts 与 HTTP

- strict email/start response/session response/password request；未知字段、非法 email、短/长密码拒绝；
- start 对 unknown/Google-only/disabled/deleting/eligible 都是相同 202/no-store/no Cookie，前四类零 flow/
  dispatch，eligible 请求也在公开响应前零 Provider；IP/email bucket 限速稳定 429；
- confirm GET 只渲染 inert CSP 页面且零 state/Provider/Cookie 写；callback POST 对缺失/重复/非法/额外
  flow/code、错误 Content-Type、过期、replay、provider mismatch、错误 method/status 全部统一失败，成功
  只设置 purpose Cookie、no-referrer 并固定 redirect；
- session GET 与 complete 覆盖缺失/错误/过期 Cookie、Origin、CSRF；complete 204 清 Cookie、无 JSON
  身份投影，不设置 Huayi session。

### 7.2 深模块、Provider 与 Postgres

- Provider fake 固定 worker begin→callback exchange→complete update 顺序，证明 dispatch mark 先于 begin、
  state 加密后才持久化、密码只出现在 update 调用；
- Supabase adapter 覆盖 `resetPasswordForEmail` 精确 redirect、PKCE storage、exchange/update 严格 user/email
  投影和全部错误收敛；
- 内存与 PGlite 覆盖每 owner 单 open flow、30/15 分钟 expiry、callback 单次、30 秒 complete lease、过期
  接管、旧 lease fencing、provider-updated 恢复；worker 另覆盖单次 claim、dispatch 后崩溃零透明重发、
  新请求使旧邮件失效；
- provider mismatch、profile/method 状态变化、并发 complete 与 DB 失败均无跨 owner/部分 Huayi session
  写；成功撤销全部 Web/Extension sessions、method 不变、通知恰好一条；
- forced RLS、业务 role 零直接权限、账号删除级联、cleanup 100 条边界与通知 worker lease。

### 7.3 Web 与 actual bundle

- `/login` 可键盘访问“忘记密码”，`/recover` email/new-password/confirm-password 使用正确 label/
  autocomplete，两次密码不匹配在客户端拒绝且零 API；统一 status/alert、提交时禁用、失败保留可修正
  输入、成功清空密码；
- start 202 不导航、不登录、不在 DOM/Storage/snapshot 回显 email；fake mailbox 必须由用户显式点击；
- actual confirm GET 必须停在惰性 API 页面，用户点击后 callback 才处理 Cookie/302；valid continue 显示
  新密码；新浏览器打开最新邮件同样只能取得一次改密 session，过期/旧邮件/replay 显示统一重新发起；
- complete 后 authority 中全部 Web/Extension session 归零、通知 count=1，Web 返回 `/login`，旧 Cookie
  不能访问 `/app`，新密码必须经一次显式登录才取得新 session；
- 390px、reduced-motion、焦点转移、polite live status、无横向溢出；最终 URL、DOM、Storage 和公开
  request facts 不含 email/password/flow/code/Cookie/CSRF/provider state。

### 7.4 门禁与目标环境

默认离线门禁：focused tests、API/Web strict typecheck/build、目标 ESLint/Prettier、migration PGlite、
全量 `pnpm test`、`pnpm test:e2e`、instructions、architecture 和 diff check。不得访问真实 Supabase、邮件、
Google、部署、Chrome 安装或付费服务。

目标环境另行批准后验证：Supabase PKCE recovery、精确 redirect allowlist、邮件模板与投递/重复链接、
email scanner 行为、secure-password-change 配置、Cookie same-site/domain/TLS、Vercel no-store、通知重试与
告警、真实 session 失效，以及 macOS/Windows Chrome。未完成前状态最多为
`implemented; target-platform validation pending`。

## 8. 分阶段实施

1. **R0 文档与审查（已完成）**：同步产品/API/数据/安全/测试/计划/变更记录；固定枚举安全与不创建
   Huayi session；
2. **R1 contracts + Provider seam（离线已完成）**：RED→GREEN 增加五条公开 route 的 strict 输入/输出、
   internal bounded outcome 和独立三操作 Provider port；Supabase adapter 使用共享的逐 flow PKCE storage，
   固定 exact redirect，严格投影规范邮箱/user ID，并把异常、Provider error 和畸形 identity 收敛到同一
   `authentication_required`。focused 证据为 contracts 5/5、Supabase recovery+既有 auth adapter 8/8；
   完整包证据为 contracts 62/62、API 327/327，双方 typecheck 与目标 Prettier/ESLint 均通过；
3. **R2 recovery 深模块 + Postgres（离线已完成）**：深模块与内存状态机用 RED→GREEN 固定 request 零
   Provider、durable dispatch-before-provider、最新 flow、同 owner callback、30/15 分钟 expiry、60/30 秒
   lease、provider-updated 恢复、dispatch/complete 前 eligibility 重检、全 session 撤销与单通知。独立
   `password_recovery_flows`、`security_notification_outbox`、12 个 recovery fixed-search-path
   SECURITY DEFINER
   转换、forced RLS、业务 role 零直访、100 条 cleanup 与 Postgres adapter 已实现；深模块+内存 11/11，
   migration+PGlite adapter 19/19，其中 recovery 专属 PGlite 7/7，当时 API 99 files、345/345；
4. **R3 HTTP + workers/outbox（仓库内离线已完成）**：R3-A 五条公开 route、internal dispatch route、250ms
   start floor、Cookie/Origin/CSRF/rate-limit/no-store/no-referrer 与 production recovery composition 已完成；
   R3-B 独立通知 worker port、notification-ID sender 幂等键、120 秒 Postgres lease、有界退避与 fake sender
   已完成。R3 focused 为 HTTP 8/8、通知 worker/adapter 6/6、通知 PGlite 1/1，完整 API 102 files、360/360，
   typecheck/build/目标 lint/format 通过。R3-C 又补齐 Resend sender、23 小时/8 次状态机、0011、独立
   bounded route、第五个 Cron 与无正文 alert port；真实 verified sender、分离 credential、Custom SMTP
   与 API 完整 Production environment 已完成，受控投递、监控接收方和首次 deployment 仍受外部门禁约束；
5. **R4 Web + actual bundle（离线已完成）**：Web strict client 已接入 start/session/complete；`/login` 与
   独立 `/recover` 页面覆盖统一 start、query 清理、两份 new-password 输入、本地 mismatch 零请求、失败
   保留输入、成功清空并返回登录。focused Web 单元 17/17；production bundle + fake mail Playwright 1/1
   覆盖 390px/reduced-motion、另一浏览器消费最新邮件、GET confirm 零副作用、旧邮件/replay 统一失败、
   purpose Cookie、全 Web/Extension session 归零、单通知、旧密码失败和新密码显式重登。route-fulfilled
   fake HTTPS 文档在 Chromium 中是 opaque origin，因此邮件确认上下文仅为提交表单启用 `bypassCSP`；测试
   仍逐项断言生产 `form-action 'self'` CSP/no-store/no-referrer header，HTTP 单元另验证 exact HTML；
6. **R5 离线总审与目标验收（离线审查已完成，目标验收 pending）**：Web 184/184、完整 Playwright
   105/105、`check:instructions`、workspace typecheck/build、`pnpm test`、目标 ESLint/Prettier 与
   `git diff --check` 通过。根级 `format:check` 仍被既有 70 个文件阻塞，根级 `lint` 仍被既有
   `.agents/skills/**` 143 条 CJS 环境错误阻塞；本阶段没有扩大或顺手改写这些不相关文件。真实服务、邮件
   投递/监控接收与双平台矩阵必须另行批准和配置后执行。

## 9. 实现与审查结论

- **已修正复用错误**：恢复不复用 `auth_flows` 的邀请/login/link kind，也不使用普通 Web session；独立表
  和 purpose Cookie 让接口更窄，避免 recovery proof 获得账号读取能力。
- **已修正隐式身份提升**：只有既有 password method 可恢复；Google-only 即使 Supabase 同邮箱 identity
  存在也不能借 reset 建立 Huayi password 授权。
- **已修正“回调即登录”风险**：邮件证明只取得一次改密能力，成功后撤销全部 Huayi sessions并要求重登，
  不从 recovery session 派生 full/data-rights session。
- **已修正 scanner 先消费**：邮件 GET 只显示 inert confirm，用户显式 POST 才 exchange；confirm/callback
  都禁止缓存、Referer、外部资源和任意 redirect。
- **已记录跨系统窗口**：异步 worker 在发信前写 durable dispatch，丢失后不得自动重发；Provider 发信仍
  早于 state durable save，Provider update 也早于数据库 stage，二者都不能被伪装成 exactly-once；失败
  依赖用户显式重试，禁止后台透明发信或改密。
- **已分离安全通知**：通知通过耐久 outbox 后置发送，不让邮件暂时失败回滚已经生效的密码；仓库内
  sender/终态/Cron/告警投影已完成，但真实投递仍是发布门禁。
- **R4 审查结论**：Web 只依赖三个窄 recovery 方法，不读取 Supabase token 或账号身份；continuation query
  首次渲染即清除，React StrictMode 只读一次 session；密码不一致在客户端失败且不触发 API。actual bundle
  证明确认页 GET 不消费 proof，显式 POST 才建立 path-scoped Cookie；成功完成后没有自动登录，必须以新
  密码重新取得 Huayi session。公开 request facts、DOM 与 Storage 不含邮箱、密码、flow/code、Cookie 或
  CSRF 值。
- **结论**：方案与邀请、method fence、recent-auth、Cookie/RLS 和隐私边界一致。R1 独立 Provider seam、
  R2 深模块/内存/Postgres、R3-A HTTP/dispatch、R3-B 通知核心、R3-C production notification code 与
  R4 Web/actual bundle 均已通过离线回归，R5 离线总审也未发现新的权限提升、秘密持久化或任意 redirect。
  hosted acceptance 的真实 DNS/verified sender、分离 credential、Supabase Custom SMTP 与 API R3-C
  通知变量子集已通过；Resend 真实投递/监控接收方、完整应用/邮件部署和双平台 Chrome 仍未验证，整体
  状态只能是 `implemented; target-platform validation pending`。
