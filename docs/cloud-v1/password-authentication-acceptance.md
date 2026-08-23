# PasswordAuthentication 生产入口验收方案

## 1. 状态与校准结论

影响平台为 `shared`。产品、架构和安全文档要求：新账号必须先持有效邀请，密码注册必须完成邮箱验证；
已注册账号以后可直接从 `/login` 登录。当前 strict contracts、Web 路由/组件/identity adapter、API、
Supabase Auth adapter、Postgres invitation/auth-flow/Web-session 事务与分层测试都已实现，Google 邀请注册
也已有 actual-bundle 证据。缺口是密码注册和密码登录尚未经过同一个 production Web bundle 浏览器闭环。

全局复审另发现一个窄安全漂移：callback 和 `/v1/auth/csrf` 已明确返回
`Cache-Control: private, no-store`，但密码注册/登录响应尚未设置该策略。注册响应携带认证阶段，登录响应
携带 CSRF token；本切片统一给两个响应增加相同缓存禁止，不改变 body、Cookie、CORS 或身份状态机。

2026-08-14 已完成 API header 与 actual-bundle RED→GREEN、实现后复审和完整离线浏览器门禁，当前状态为
`implemented; target-platform validation pending`。

## 2. 用户需求与边界

一个受邀的新用户必须能完成：

1. 从 `/join#<token>` 领取一次邀请；首个 document request 不含 fragment，成功后地址栏变为 `/join`；
2. 以规范邮箱和至少 12 字符密码提交注册，看到“检查邮箱”，此时不得创建 Web session 或进入工作台；
3. 经外部邮件提供方的确认链接回到固定 API callback；callback 单次消费 auth flow、完成 invitation、设置
   hardened HttpOnly Cookie，并只重定向固定 Web `/app`；
4. 在回到未登录浏览器状态后，从 `/login` 先经历一次错误密码并保留可修改邮箱，再以正确密码取得新
   Cookie session 并进入 `/app`；
5. 注册/登录请求严格拒绝未知字段和非法 body；密码错误使用统一认证错误，不回显账号存在性或供应商
   细节；
6. invitation token、claim ticket、密码、provider flow/code、Cookie 和 CSRF 不进入 URL（callback 所需
   opaque flow/code 除外）、Web Storage、公开 DOM 文本、日志或 authority snapshot。

离线 fake mail/provider 只模拟“用户必须显式点击确认链接”和固定 callback navigation，不证明邮件投递、
邮箱归属、Supabase 项目设置、真实 TLS/Cookie Domain 或目标网络。密码登录 actual-bundle 只证明 active
账号的 `full` 路径；disabled→`data-rights`、deleting→拒绝继续由 API/Postgres 分层测试负责，并在真实
身份环境验收。

## 3. 技术方案

### 3.1 production 路径

```text
Web /join#token
  -> POST /v1/invitations/claim (strict JSON, no-referrer)
  -> history.replaceState("/join")
  -> POST /v1/auth/password/register (claimTicket,email,password)
  -> 202 {emailConfirmationRequired:true}; no Cookie; private,no-store
  -> user opens local fake mailbox and opens inert confirmation page
  -> repeated GET /v1/auth/password/confirm?flow=<43-char> has zero side effects
  -> user enters email + six-digit OTP
  -> POST /v1/auth/password/callback (exact form)
  -> invitation consumed + private,no-store + no-referrer
  -> Set-Cookie HttpOnly/Secure/SameSite=Lax + 302 /app
  -> GET /v1/auth/csrf with Cookie + Origin

browser returns to signed-out state
  -> Web /login
  -> wrong POST /v1/auth/password/login -> generic 401
  -> correct POST /v1/auth/password/login
  -> strict {access:"full",csrfToken}; rotated Set-Cookie; private,no-store
  -> location.assign("/app") -> authenticated bootstrap
```

生产 Web 仍只调用固定 HTTPS API origin；不引入 Supabase browser client，不把 invitation proof 发给
provider，不把 session 放进 JavaScript storage。API 的 provider state 继续由现有 encrypted auth-flow
记录持有，refresh token 继续只进入服务端 Web session。

### 3.2 actual-bundle authority

- 新增独立 `password-authentication` seed 与 `CloudBrowserPasswordAuthenticationAuthority`；主 authority 只
  组合共同 CORS、Cookie authentication、CSRF bootstrap 和脱敏 request facts；
- helper 持有最小 `invitation -> claim -> pending confirmation -> active account` 状态及一次性 callback；
- `/register` 和 `/login` body 必须经 `@huayi/cloud-contracts` strict schema；helper 只比较测试专用邮箱/
  密码，公开 snapshot 不投影它们；
- `mail.huayi.invalid` 是 Playwright 本地 fulfill 的保留域页面，只显示“确认邮箱”动作；页面 URL 只带
  测试邮箱无关的固定入口，确认链接中的 flow/code 只发往 API；
- callback 和登录成功都由浏览器真实处理 `Set-Cookie` 与导航；不预种登录 Cookie、不用 localStorage
  token、不让 registration 202 冒充认证成功；
- 浏览器用清除当前 Cookie 表示“之后从一台未登录浏览器回来”，不会修改 authority 的已确认账号状态。

### 3.3 数据与状态机

本切片不修改公共 schema、migration 或生产身份数据结构。测试内部最小状态为：

```ts
interface PasswordAuthenticationState {
  invitation: "available" | "claimed" | "consumed";
  registration: "none" | "confirmation-pending" | "confirmed";
  callback: "available" | "consumed";
  account: "absent" | "active";
}
```

生产权威仍是 `invitations`、`invitation_claims`、`auth_flows`、Supabase Auth identity、`user_profiles` 与
`web_sessions`。浏览器 helper 不复制 RLS、hash/pepper、加密或 session rotation 实现。

## 4. TDD 与自动化矩阵

### 4.1 Fresh RED

1. 先为 API 密码注册/登录响应补 no-store 断言，确认现有实现失败；
2. 新 actual-bundle spec 先用旧 `empty` seed，从 `/join#token` 无法取得邀请，确认缺口属于组合层；
3. 再新增专用 helper/seed 并最小接线，不修改生产认证语义；
4. 若测试只能靠 registration 直接 Set-Cookie、预种 Cookie 或 Web Storage token 变绿，则路线无效。

### 4.2 浏览器断言

- invitation：首个 document URL 无 token；StrictMode claim 恰好一次；成功后 URL 清理；
- registration：label/autoComplete/minLength 正确；202 后显示检查邮箱，页面未跳转，API Cookie 为空；
- confirmation：用户在 fake mail 页显式点击；callback 才设置 hardened Cookie 并进入 `/app`；callback
  request fact 为未认证 `write-valid`，随后 CSRF bootstrap 为认证 Web `read`；
- returning login：清除 Cookie 后 `/login` 可见；错误密码显示统一 alert、邮箱仍可修改且零 Cookie；正确
  密码后进入 `/app`，登录 POST 共两次且都只记录脱敏 path/proof；
- strictness：register/login 必须是 JSON、固定字段、固定 API origin；成功响应为 private/no-store；
- privacy：最终 Web URL、visible DOM、local/session storage 与 snapshot 不含 token/ticket/password/email/
  flow/code/Cookie/CSRF；callback URL 只短暂携带其必需的 opaque flow/code，密码只允许在用户正在编辑的
  `type=password` 控件和值对应 request body 中短暂存在；
- accessibility/layout：390px、reduced-motion、labelled form、polite status/alert、无横向溢出。

### 4.3 门禁

- focused API/component/Playwright；Web strict typecheck；目标 ESLint/Prettier；
- 完整 `pnpm test:e2e`、`pnpm test`、instructions、architecture 与 diff check；
- 不运行真实 Supabase/邮件/Google、安装、Chrome load-unpacked、付费 smoke 或部署写入。

## 5. 验收标准

- actual Web production bundle 完成 invitation→password registration→pending confirmation→callback Cookie→
  `/app`，并在清 Cookie 后完成 wrong password→correct password→新 Cookie→`/app`；
- 202 pending confirmation 不登录，只有 confirmation callback 完成邀请和 session；
- register/login adapter、真实浏览器 CORS/preflight、Cookie 和 navigation 均参与，不由组件 fake 替代；
- API 两个密码响应均明确 `Cache-Control: private, no-store`；
- request facts 证明 claim/register/callback/login 的顺序与认证边界，公开证据零秘密；
- 离线门禁通过后状态只能是 `implemented; target-platform validation pending`；真实邮件、Supabase、部署
  Cookie、active/disabled/deleting 账号与双平台 Chrome 仍需单独批准验证。

## 6. 实现前审查

- **需求一致**：该路线补上密码入口，但没有否定 Phase 24 选择 Google 作为默认离线 onboarding；密码
  路线现在通过 fake mail 的显式 callback 证明验证门槛，不用 202 冒充成功。
- **证据分层**：浏览器负责 production bundle、preflight、Cookie、导航和 UI；contracts/API/PGlite 继续
  负责 tenant、并发、账号状态和 Supabase adapter 语义；两者不互相冒充。
- **安全收敛**：新增的生产变化只有两个 no-store header。helper 不公开邮箱、密码或 provider material，
  不新增契约字段、日志或持久客户端状态。
- **恢复语义**：注册后页面清除 claim ticket，用户依赖邮件 callback 完成；callback/flow 一次性由既有
  identity 层保证。真实邮件延迟、重复投递和跨系统孤立身份继续由既有分层测试及目标环境验证。
- **结论**：文档间没有剩余冲突，技术路线可实施。若 Secure HttpOnly Cookie 或 callback 只能靠脚本
  注入才能工作，应保持 RED 并报告环境限制。

## 7. 实现与复审记录

- API RED 精确证明密码注册/登录缺少 no-store；最小实现把 header 放在 strict parse/provider 调用之前，
  因此成功与规范化错误响应都禁止缓存。focused API 11/11 通过；
- actual-bundle RED 使用旧 `empty` seed，在邀请验证处按预期失败；新增 210 行独立 password authority 与
  专用 seed 后，没有修改 production Web 路由、组件、contract、Supabase adapter 或 migration；
- actual `/join#token` 已证明首个 document request 无 fragment、单次 claim、地址栏清理、strict 密码
  register 202、零 Cookie 与待确认文案；用户必须在本地 fake mailbox 显式点击，callback 才设置
  Secure/HttpOnly/SameSite=Lax Cookie 并进入 `/app`；
- 清除浏览器 Cookie 后，actual `/login` 先以错误密码获得统一 401 并保留邮箱，再以正确密码设置不同的
  hardened session Cookie 并重新 bootstrap `/app`；两个密码响应都从浏览器观察到 private/no-store；
- claim/register/callback 各一次且为未认证 `write-valid`，两次 login 均为未认证 `write-valid`；StrictMode
  允许重复只读 CSRF bootstrap，但所有事实都必须是认证 Web `read`；
- 390px、reduced-motion、label/autoComplete/minLength、无横向溢出、空 Web Storage 与 snapshot 零秘密
  通过；原 focused journey 1/1、Web strict typecheck、目标 ESLint/Prettier 和当时完整 Playwright 100/100
  通过；后续 AccountSignInMethods Phase A 在同文件加入未登记 method 失败关闭旅程，当前为 2/2、全量
  101/101；
- 实现后复审未发现新增生产状态漂移。真实 Supabase email confirmation、邮件投递/重复链接、部署 TLS/
  Cookie Domain、active/disabled/deleting 账号与双平台 Chrome 仍未验证，不能由本地 fake mailbox 替代。
