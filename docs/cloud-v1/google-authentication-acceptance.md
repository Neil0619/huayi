# GoogleAuthentication 普通登录生产入口验收方案

## 1. 状态与校准结论

影响平台为 `shared`。普通 Google 登录的产品、`auth_flows.kind=login`、Supabase adapter、
AccountSignInMethods authorization fence、active/disabled/deleting access 裁决、Hono route 与 Web
`/login` 表单均已离线实现。现有 actual-bundle 证据覆盖邀请 Google 注册、密码登录和 Google recent-auth/
link，但没有从 production `/login` 走完“原生 POST→Provider→callback→Huayi session”的普通 Google
登录，也没有浏览器层证明 disabled 账号只进入数据权利页面、未登记 method 不产生 Cookie。

全局源代码复审还发现两项窄漂移：

1. `google-login-app.ts` 为解析 strict 空 JSON 错用了 `createAccountDataExportRequestSchema`，把身份入口耦合
   到无关的数据导出契约；应新增 identity-owned `googleLoginStartRequestSchema`；
2. 共用 `/v1/auth/callback` 虽然成功响应已有 `private, no-store`，但未固定
   `Referrer-Policy: no-referrer`，失败响应也没有 callback 专属 no-store/no-referrer。callback URL 短暂
   携带 flow/code，不能依赖浏览器默认 referrer policy 避免它们进入 Web 或第三方请求。

本切片不改变 Supabase identity、数据库状态机、账号邀请或 method 绑定语义。目标状态为
`implemented; target-platform validation pending`。

## 2. 用户需求与安全边界

1. 已有账号从 `/login` 选择“使用 Google 登录”；浏览器向固定 API origin 原生 POST 一个严格空表单，
   不携带 email、claim ticket、return URL、账号状态或用户输入；
2. API 每 IP 每分钟最多五次，创建 15 分钟 `kind=login` flow，持久化受保护 Provider state，再 302 到
   Provider adapter 返回的 HTTPS URL；目标不能来自 Web、query、form 或任意 header；
3. Provider 完成后只回到固定 API `/v1/auth/callback?flow=<opaque>&code=<opaque>`。callback 必须单次、
   no-store/no-referrer，并只接受已有 profile、已登记 `google` method 与相同 Provider user ID；
4. active 账号创建 `access=full`、`reauthenticatedMethod=null` 的 hardened Huayi Cookie，并固定进入
   `/app`；disabled 账号只创建 `access=data-rights` session并固定进入 `/settings/data`；
5. unknown、未登记 google method、deleting、过期/重放/错误 flow/code 或 Provider user 不匹配都统一
   认证失败，不创建 profile、method、邀请消费或 Cookie，不在 URL/DOM/日志返回具体原因；
6. 普通登录不能冒充 recent authentication。即使刚取得新 session，Google/password link 仍必须先走
   对应 purpose-bound reauthentication；
7. flow、code、Provider state/token、Cookie、CSRF、email 和 user ID 不进入 Web URL、Storage、公开
   authority snapshot 或普通日志。只有 API callback URL 可短暂携带 flow/code。

离线 fake Provider 只验证 production bundle、顶层 form navigation、redirect、Cookie、access 路由和
公开证据；不证明真实 Google consent、Supabase PKCE、账号归属、TLS/Cookie Domain 或部署 allowlist。

## 3. 技术开发方案

### 3.1 production 路径

```text
Web /login
  -> native POST /v1/auth/google/login/start (empty form only)
  -> create 15-minute kind=login auth flow
  -> beginGoogle({redirectTo: fixed API callback + opaque flow})
  -> persist protected provider state before 302
  -> Provider consent/authentication
  -> GET fixed API callback?flow&code
  -> completeCode + authorize existing (userId, google method)
  -> active: full Cookie + 302 /app
     disabled: data-rights Cookie + 302 /settings/data
     otherwise: generic no-store/no-referrer authentication failure, no Cookie
```

Web 不引入 Supabase client，也不解析 callback。`AuthPage` 继续只渲染固定 `googleLoginStartUrl` 的空原生
表单；API 拥有 flow、Provider state、callback、method fence 与 session 创建。

### 3.2 契约与 HTTP 校准

- `@huayi/cloud-contracts` 新增 `googleLoginStartRequestSchema = z.strictObject({})`；它只表达 Google
  login start，不复用 export、reauthentication 或 link 的同形 schema；
- JSON 与 `application/x-www-form-urlencoded` 都解析为该空对象；form body 必须精确为空，JSON 拒绝
  unknown key；其他 Content-Type 在 flow/Provider 前失败；
- login start、邀请 Google start 与共用 callback 从 handler 起点设置
  `Cache-Control: private, no-store`；OAuth callback 另固定 `Referrer-Policy: no-referrer`，因此成功、
  expected failure 和畸形输入都继承同一防泄漏 header；
- success redirect 仍只由服务器依据 session access 选择固定 `/app` 或 `/settings/data`；本切片不增加
  `returnTo`、错误 query、公开 flow resource 或 JSON token。

### 3.3 actual-bundle authority

新增独立 `google-authentication` authority seam，测试内部只持有：

```ts
interface GoogleAuthenticationState {
  account: "active" | "disabled" | "deleting";
  method: "google" | "password";
  flow: "none" | "started" | "consumed";
  webSessionCount: number;
}
```

fake Provider 使用保留 HTTPS origin，只显示一个显式继续按钮；flow/code 只在 Provider/API URL 与隐藏
表单中短暂存在。主 authority 只组合 route、Cookie authentication、CSRF bootstrap、数据权利 API 和脱敏
request facts，不公开测试邮箱、user ID、flow/code、Cookie 或 CSRF 值。

## 4. 数据结构与状态机

本切片不修改 migration。生产权威继续是：

- `auth_flows`：`kind=login`、`ticket_hash=NULL`、15 分钟 expiry、protected provider state、单次 used；
- `user_profiles`：已有 owner 与 `active|disabled|deleting`；普通登录不 INSERT profile；
- `account_sign_in_methods`：必须已有 `(owner_user_id,google)`；callback 不 INSERT method；
- `web_sessions`：active 写 `full`，disabled 写 `data-rights`，两者
  `reauthenticated_method=NULL`；deleting/失败零写；
- Provider refresh token 只以 encrypted ciphertext 进入服务端 session，浏览器只见不透明 HttpOnly Cookie。

```text
none --strict start + durable provider state--> started
started --valid callback + existing google method--> consumed + one Huayi session
started --invalid/missing method/deleting/mismatch--> consumed-or-rejected, zero session
expired/replayed/cross-purpose proof--> no session
```

是否消费错误 callback 的 flow 由现有 identity 状态机保持；无论具体失败点，公开结果都不能披露 profile、
method 或 Provider identity。

## 5. TDD 与验收矩阵

### 5.1 Fresh RED

1. contracts test 先导入不存在的 `googleLoginStartRequestSchema`，证明 identity contract seam 缺失；
2. HTTP tests 先要求 login/invitation start 与 callback 成功/失败均有 no-store，callback 另有 no-referrer；
3. actual-bundle spec 先引用不存在的 `google-authentication` seed，证明 production Web 普通 Google 旅程
   尚未组合；
4. 最小 GREEN 只新增专属 schema、header 和 fake authority，不重写既有 identity/Postgres/Supabase seam。

### 5.2 分层测试

- contracts：空对象成功，email/claimTicket/returnTo/userId/任意 unknown key 失败；
- HTTP：empty JSON/form 成功；非空 form、错误 Content-Type、限速在 beginGoogle 前失败；redirectTo 固定
  API callback；start/callback success/error header 一致；
- identity/Postgres：既有测试继续证明 active→full、disabled→data-rights、deleting/unknown/missing
  method→zero session、邀请不消费、method 不新增、flow expiry/replay；
- actual Web：390px/reduced-motion，从 `/login` 原生 POST 到 fake Provider；GET consent 页面不创建
  Huayi Cookie，显式继续后 active 进入 `/app`，disabled 进入 `/settings/data`；未登记 method 的 callback
  为统一失败且零 Cookie；
- privacy：最终 Web URL、DOM、Storage 与 authority snapshot 不含 email/userId/flow/code/Provider state/
  Cookie/CSRF；request facts 只保留 method/path/authenticatedAs/proof。

### 5.3 默认门禁

focused contracts/API/Web/Playwright，Cloud contracts/API/Web strict typecheck/build，目标 ESLint/Prettier、
`check:instructions`、architecture、diff check、`pnpm test` 与 `pnpm test:e2e`。全部默认离线，不访问真实
Google、Supabase、Vercel、邮件、Chrome 安装或付费服务。

## 6. 验收标准

- production `/login` 的真实 form action、API redirect、fake Provider、callback、Cookie 与 Web bootstrap
  共同参与，不用预种 Cookie或组件 mock 替代；
- active 与 disabled 分别落到固定 full/data-rights 页面；未登记 method 统一失败且零 Cookie；
- 普通 Google login 使用 identity-owned strict schema，API 不再导入数据导出 request schema；
- OAuth callback 的成功与错误响应都明确 no-store/no-referrer，flow/code 不作为 Referer 进入 Web；
- 普通登录 session 的 recent-auth provenance 保持 null，不能直接满足 identity-link 前置条件；
- 离线通过后最多声明 `implemented; target-platform validation pending`。

## 7. 实现前审查结论

- **需求一致**：普通 Google login 是已有账号认证，不是邀请注册、identity linking 或 password recovery；
  独立 `kind=login` 与 method fence 已表达正确边界。
- **修正浅耦合**：同为 `{}` 不代表同一领域命令；使用数据导出 schema 会让未来任一契约演进无关地破坏
  登录，专属 schema 是更窄、更稳定的公开 seam。
- **修正 callback 泄漏面**：flow/code 在 API URL 中不可避免，但不应继续成为 redirect Referer；固定
  no-referrer 比依赖浏览器默认策略更可验证，也不改变 callback body、Cookie 或 redirect。
- **证据分层**：浏览器证明导航/Cookie/access 页面；identity/PGlite 证明 tenant、status、method 与 replay；
  fake Provider 不冒充真实账号或 PKCE 配置。
- **结论**：无需新增表、权限、Provider 或依赖；技术路线可按上述 RED→GREEN 推进。真实 Google/
  Supabase/部署事实继续保持外部门禁。

## 8. 分阶段实施

1. **G0 审计（已完成）**：全局比对 product/architecture/data/API/security/testing 与当前 route、contract、
   identity/Postgres、Web/E2E；确认缺口只在 contract seam、callback header 与 actual-bundle 证据；
2. **G1 文档与审查（已完成）**：写明产品行为、技术路线、状态机、数据结构、TDD、验收和证据边界；
3. **G2 contracts + HTTP（已完成）**：Fresh RED 证明专属 schema 与 header 缺失；GREEN 后 contracts
   6/6、Cloud foundation HTTP 11/11 通过；
4. **G3 actual bundle（已完成）**：Fresh TypeScript RED 证明三个 production-bundle seed 尚未组合；新增
   独立 fake Provider authority 后专项 Playwright 3/3、完整离线 Playwright 108/108 通过；
5. **G4 总审与门禁（已完成）**：权威状态、秘密/权限/redirect 已复核，workspace test/typecheck/build、
   instructions、目标 lint/format、diff check 与完整离线 Playwright 均通过；真实目标环境另行批准。

## 9. 实现后审查

- production code 只新增 identity-owned strict schema 与响应 header，没有改变 migration、Provider port、
  session provenance 或账号状态机；
- actual-bundle authority 与 password/onboarding/link authority 分离，只向主 authority 提供 authenticated
  判断、route 处理和聚合 session count，没有把 flow/code、email、Provider user 或 Cookie 加入 snapshot；
- active/disabled/missing-method 三条浏览器证据分别证明 full、data-rights 与零 session，且 callback 的
  flow/code 不作为 Referer 进入 Web；
- 离线实现满足本方案；真实 Google consent、Supabase PKCE、部署 Cookie/Domain、目标网络与双平台
  Chrome 仍是外部门禁，因此整体目标继续保持 open。
