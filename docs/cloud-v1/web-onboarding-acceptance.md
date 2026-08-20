# Phase 24 邀请注册到学习项浏览器验收方案

## 1. 目标与边界

Phase 5 已分别具备邀请领取、Google/密码入口、Cookie bootstrap、手动学习项写入和学习库页面，但尚无
actual Web production bundle 证据证明这些能力能在一个新账号旅程中组合。Phase 24 补齐以下用户结果：

1. 新用户从 `/join#<token>` 打开邀请，首个 Web 请求不携带 token；
2. 邀请只领取一次，成功后地址栏立即清除 fragment；
3. claim ticket 只进入固定 API 的原生 Google POST body，不进入 URL、Web Storage、DOM 文本或日志；
4. Google callback 由 API 设置 HttpOnly session Cookie，并只重定向到固定 Web `/app`；
5. 新账号进入学习库，手动收录一个 Expression，随后从同一 CloudAuthority list/detail 重读；
6. 所有浏览器 mutation 使用既有严格 contract、固定 origin、Cookie/CSRF、Idempotency-Key；公开测试
   snapshot 不含邀请、claim ticket、Cookie、CSRF、正文或幂等键。

本阶段不访问真实 Google、Supabase、邮件或部署网络，不验证 Google 品牌审核、真实邮箱归属、真实 Cookie
Domain/TLS、数据库 RLS 或运营邀请创建。那些分别由外部环境和现有 API/PGlite 测试负责。

## 2. 路线裁决

### 2.1 选择 Google 邀请注册

产品要求邮箱密码注册必须验证邮箱。让 fake `/password/register` 直接返回已登录 session 会证明一个与产品
相反的流程；让测试直接修改“邮箱已确认”内部状态又不能证明浏览器 callback。因此本阶段使用同样受邀请
约束的 Google 注册路线，并以离线 fake Provider 页面表示外部 Google 授权：

```text
Web /join#token
  → POST /v1/invitations/claim
  → history.replaceState("/join")
  → native form POST /v1/auth/google/start (claimTicket only)
  → 302 accounts.google.invalid/consent?flow=<opaque>
  → user confirms fake provider page
  → GET /v1/auth/callback?flow=<opaque>&code=<opaque>
  → Set-Cookie: huayi_session=...; HttpOnly; Secure; SameSite=Lax
  → 302 Web /app
  → GET /v1/auth/csrf with Cookie + Origin
  → Web /library manual capture
  → POST /v1/learning-items with Cookie + Origin + CSRF + Idempotency-Key
  → list/detail reread
```

`accounts.google.invalid` 是 IANA 保留域，只由 Playwright `page.route` 本地 fulfill；浏览器不访问 DNS/TLS。
Provider 页面只接收 opaque flow，不接收邀请 token 或 claim ticket。

### 2.2 被否决的替代路线

- **密码注册直接登录**：违反“邮箱密码必须验证邮箱”，否决；
- **Playwright 预先种 Cookie**：只能证明已登录页面，不能证明邀请、callback 或 session rotation，否决；
- **React component test 串接 fake functions**：不能证明原生 form、重定向、Set-Cookie、CORS 或 SPA，否决；
- **把 claim ticket 放 query/hash 传给 fake Provider**：扩大秘密传播面并违反现有安全设计，否决；
- **从真实 Google/Supabase 运行默认 E2E**：会引入账号、网络和外部状态，不属于 secret-free 默认门禁，
  否决。

## 3. 技术方案

### 3.1 复用 actual bundle 与 CloudBrowserAuthority

- 继续使用 Phase 22/23 的 `web.huayi.invalid` actual production bundle 和 `api.huayi.invalid` stateful
  authority；不新建第二份 Web/API harness；
- 新增 `invitation-onboarding` seed 和小而深的 `CloudBrowserOnboardingAuthority`，只拥有邀请 claim、
  Google start、fake Provider consent 与 callback 状态；
- 主 authority 继续拥有 Cookie 认证、CSRF、LearningItem 与脱敏 request facts；onboarding seam 不读取
  analysis、practice 或 Store 状态；
- LearningItem create 使用现有 public request/response schema 和规范键规则，成功后加入同一 list/detail
  authority；不复制 Postgres tag、RLS、幂等存储实现。

### 3.2 浏览器与认证状态机

```text
invitation=available
  claim exact token → claimed + claimTicket(memory only)
  repeated claim → invitation_consumed

claimed
  exact form {claimTicket} → auth-flow-created + 302 provider
  missing/extra/duplicate/body mismatch → invalid_request

auth-flow-created
  provider consent → callback(flow, code)
  callback exact unused flow/code → account-created + invitation-consumed + session Cookie
  replay/wrong flow/code → not_found/invalid_request

session Cookie
  bootstrap exact Origin → rotated CSRF
  learning.create exact proof → new level=-1 item
  list/detail → same item
```

测试 authority 只在内存保存 one-time 状态。所有 API JSON response 在 fulfill 前经 `cloud-contracts` parse；
Google form 按 urlencoded exactly-one 字段解析。callback 只返回固定同站 Web destination。

### 3.3 数据与公开证据

本阶段不修改生产 schema、migration、contract 或权限。测试内部最小状态为：

```ts
interface OnboardingState {
  invitation: "available" | "claimed" | "consumed";
  claimTicket: string | null;
  flow: "created" | "consumed" | null;
  accountCreated: boolean;
}
```

它不是产品领域模型，不进入 production export。公开 `CloudBrowserAuthoritySnapshot` 继续只返回聚合计数和
脱敏 `{authenticatedAs, method, path, proof}`；不新增 email、token、flow、code、正文或 Header。

## 4. TDD 顺序

### 4.1 Fresh RED

1. actual bundle 打开 `/join#token` 后，现有 authority 对 claim 返回 401/404；
2. 原生 Google form 无可用 provider route，不能完成 callback/Set-Cookie；
3. 新账号进入 `/library` 后，现有 authority 没有 `POST /v1/learning-items`；
4. snapshot 无法证明 claim 仅一次、callback 成功和学习项写入 proof；
5. Web E2E strict tsconfig 必须编译新 spec/support，防止 fixture 类型漂移。

### 4.2 自动化矩阵

- URL：首屏 URL 含 fragment；claim 成功后 URL 精确为 `/join`，页面/Storage 不含 token/ticket；
- claim：StrictMode 下浏览器只产生一个 claim 请求；错误 token/重复领取失败关闭；
- native form：request 为 `application/x-www-form-urlencoded`，恰好一个 claimTicket；Provider URL 不含
  token/ticket；
- callback：fake Provider 必须由用户点击，callback 才设置 session；随后 `/app` bootstrap 获得 full
  access；
- capture：`/library` 初始空，手动 Expression 写入后 list/detail 重读并聚焦详情；
- proof：LearningItem POST 记录为 authenticated web + write-valid；缺 CSRF/Origin/key 仍由已有 authority
  失败关闭；
- privacy：URL、Storage 和可见 DOM 不包含 invitation token、claim ticket、Cookie 或 CSRF；snapshot JSON
  还不得包含 email、密码或学习正文。用户刚录入的学习内容按产品要求会在学习库 DOM 中显示，不能把
  “不显示正文”伪装成隐私验收。

### 4.3 门禁

- focused onboarding Playwright；完整 `pnpm test:e2e`；
- Web strict E2E typecheck、Web/full workspace build；
- 全量 unit/integration、instructions、architecture、受影响 ESLint/Prettier 与 diff check；
- 不运行 real Google/Supabase/DeepSeek、安装、smoke 或商店上传。

## 5. 验收标准

- 新用户在 actual Web bundle 中从 invitation fragment 到 HttpOnly session，再到 LearningItem 完成一个可见
  闭环；
- invitation token 不进入首个 HTTP path/query，claim ticket 不进入任何 URL/Storage/可见文本；
- native Google POST、provider consent、callback、Set-Cookie 与固定 Web redirect 均由真实浏览器执行；
- Cookie bootstrap 与 learning create 使用生产 adapter；LearningItem 从同一 authority list/detail 重读；
- claim 只一次，callback/写入 proof 可从脱敏 request facts 证明；
- 默认门禁零外部网络、零真实账号、零 secret；文档明确不替代真实部署和 Google/Supabase 验收；
- 不放宽 CORS、Origin、CSRF、schema、Cookie、redirect、CSP 或 API origin 才能通过。

## 6. 方案自审

- **与产品一致**：选择已支持且邀请约束完整的 Google 注册，不绕过邮箱确认；学习项通过手动录入证明
  account→authority 写入闭环，模型分析仍由独立 journey 验收。
- **证据范围准确**：actual browser 能证明 fragment/form/navigation/Cookie/CSRF/SPA；不能证明 Supabase
  identity、邮件投递、部署 Domain 或数据库多租户，因此完成声明保持离线限定。
- **安全边界不扩大**：fake Provider 只见 opaque flow；claim ticket 留在 API POST body；公开 snapshot
  不增加秘密字段。
- **模块边界合理**：onboarding 状态与分析/练习 fixture 分离；主 authority 只做路由组合和共同 proof，
  避免单文件超过 400 行。
- **结论**：路线可实施。若浏览器无法从 route-fulfilled 302 接受安全 Cookie，应停止并记录环境限制，
  不以 localStorage token、JS 注入 Cookie 或预种已登录状态替代。

## 7. 实现记录（2026-08-13）

- `invitation-onboarding` seed 已拆到独立 authority；严格校验 claim JSON、无 Referer、urlencoded
  exactly-one claimTicket、opaque flow/code、callback 单次消费与固定 redirect；
- route-fulfilled callback 的 Secure/HttpOnly/SameSite=Lax Cookie 已被真实 Chrome 接受，后续 actual Web
  bundle 通过 `/v1/auth/csrf` 取得 full session；没有使用预种 Cookie、Web Storage 或 JS 写 Cookie；
- 新账号从空 Inbox 进入 `/library`，使用 production adapter 创建 Expression；authority 在同一内存状态
  以 strict create response/list/detail 重读，重复 invitation claim 返回 409；
- 旅程固定 390px 与 reduced-motion，验证 labelled 控件、成功详情焦点和无横向溢出；公开 snapshot 只含
  聚合计数/request facts，不含邀请、claim ticket、Cookie、email 或学习正文；
- 主 authority、onboarding、practice 与 request helpers 均保持 400 行以内，Web E2E strict typecheck 通过；
- focused onboarding 旅程 1/1、完整离线浏览器门禁 73/73 通过；全仓非浏览器门禁数字同步记录在
  `project-status.md`。
