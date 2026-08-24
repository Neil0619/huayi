# 密码注册确认与中断恢复设计

## 1. 背景与已确认故障

Hosted acceptance 首次真实密码注册进入了可重复的部分成功状态：Supabase `auth.users` 与 email
identity 已创建且邮箱已确认，但语见 API 没有完成 invitation claim、`invite-registration` flow、profile、
password sign-in method、quota 与 Web session。普通密码登录即使通过 Provider 密码校验，也会被语见的
已登记 method 检查拒绝；因此当前现象不能归因于“密码一定错误”。

根因包含两个独立缺口：

1. API 传给 Supabase 的 `redirectTo` 包含动态 `?flow=<opaque>`，Hosted Auth allowlist 却只保存不带
   query 的 exact path。Supabase 对完整 URL 做 glob 匹配，未匹配时回退 Site URL；确认请求不会回到
   API。
2. `Confirm sign up` 模板直接链接 `{{ .ConfirmationURL }}`。邮件安全扫描器可能先访问并消费一次性
   token，用户随后点击只会得到 `otp_expired`。

本设计同时修复后续注册和已经中断的账号。只重发邮件、放宽到域级 `/**`、直接 SQL 补 profile、删除
Auth 用户重建，或把一次性链接藏入前端 fragment，都不能满足安全与可恢复性要求。

## 2. 产品行为

### 2.1 新注册确认

- 注册提交成功后显示“检查验证邮件”，不自动轮询或验证。
- Supabase `Confirm sign up` 邮件显示 `{{ .Token }}` 六位验证码；CTA 只进入语见 API 的 inert
  confirmation page，不直接链接 `{{ .ConfirmationURL }}`。
- API 注册时把 `emailRedirectTo` 固定为
  `/v1/auth/password/confirm?flow=<43-char-base64url>`。邮件 CTA 使用 `{{ .RedirectTo }}`，因此安全扫描器
  最多 GET 语见的无副作用页面，不能消费 Supabase token。
- confirmation GET 只严格校验 flow 并返回 email + 验证码表单；不读取/修改数据库，不调用 Supabase，
  不设置 Cookie。
- 只有用户显式 POST 表单后，API 才调用
  `verifyOtp({ email, token, type: "email" })`，再以既有 `complete_auth_flow(..., 'password')` 原子创建
  profile、password method、default quota，消费 invitation/claim/flow，创建 full Web session，并跳转
  `/practice`。
- email、验证码和密码不得进入 URL、日志、Referer、Storage 或错误响应。
- 六位不是仅由页面文案约定：Hosted Supabase Auth 的 `mailer_otp_length` 必须精确为 6，并在每次真实
  邀请注册前由只读门禁回读。Resend 只负责 SMTP 投递，不生成或改写 `{{ .Token }}`；Hosted 漂移为 8
  时必须停止验收并只修正该字段，不能放宽表单或截取验证码。

### 2.2 已中断注册恢复

- 重新打开原私密邀请时，若 claim 因“已绑定但未完成”而失败，页面显示专门的“继续中断注册”表单；
  普通 `/login` 仍只服务已经完成建档的账号。
- 恢复请求提交原 invitation token、email 和 password。API 先用 Supabase password sign-in 证明现有
  Auth identity 的控制权，再调用单个数据库原子函数；Provider user id/email 均取自 Provider session，
  不信任客户端身份字段。
- 原子函数仅接受：邀请仍有效且未消费/撤销、恰好一条已过期未 finalization 且已绑定到该 Provider user
  的 claim、恰好一条对应的已过期未消费 invite-registration flow、Auth user 已确认且只有 email identity、
  且不存在 profile/method/quota/session/admin/audit/business data 的状态。
- 成功时一次性创建 profile、password method、default quota，finalize claim，消费 invitation 和旧 flow；
  随后 API 创建 full Web session。
- 任何前置条件不满足都失败关闭，不设置 Cookie、不删除 Auth user、不创建第二个 identity，也不披露账号
  是否存在。若邀请已经过期，则停止并进入另一个明确授权的破坏性恢复流程。

### 2.3 未确认注册的同邀请 OTP 重发

- Web 在邀请 claim 成功后只从地址栏清除 fragment，原 invitation token 继续只留在组件内存；StrictMode
  单飞另用 in-flight ref，不能再通过清空 token 防重。注册最终完成前，token 不进入 DOM、Storage、
  Cookie、日志或错误文案；成功认证后立即清空。
- `POST /v1/auth/password/register/resend` 只接受 strict `{invitationToken}`，不要求用户识别/输入 fragment、
  email、password、旧 OTP 或 flow；响应只含固定 `{accepted:true}`，并使用 `private, no-store`、IP 与
  invitation 双限流。
- 新 0014 原子函数以 invitation token hash 定位同一 active invitation，要求恰好一条未 finalization、已
  绑定 Auth user 的 claim 与恰好一条未消费 invite-registration flow；Auth user 必须尚未确认、只有 email
  identity，且不存在 profile/method/quota/session/admin/deletion/audit/business data。
- 函数从 `auth.users` 内部读取规范化 email，不信任客户端 identity 字段；在同一事务内延长同一 claim、
  把唯一 flow 的 hash/expiry 轮换为新值，旧邮件 flow 立即失效，新 expiry 不超过 invitation 到期时间。
  不新增 invitation、claim、flow、Auth user 或 identity，只授予 `huayi_context_setter`。
- 数据库先准备新 flow，API 再调用
  `auth.resend({type:"signup",email,options:{emailRedirectTo}})`；Provider 失败只留下仍可再次轮换的未完成
  状态，不补建 profile/session，也不创建第二用户。用户只使用最新邮件的六位 OTP 与 CTA。
- 已经进入错误状态的浏览器由系统打开最近保存的私密邀请 URL；用户不手工复制 token。claim 因 bound
  identity 失败后，页面显示“重新发送六位验证码”与“邮箱已确认后继续中断注册”两条恢复路径。

### 2.4 claim 生命周期修正

`claim_invitation` 只能自动清理 `bound_user_id IS NULL` 的过期未完成 claim。已经绑定 Provider identity
的 claim 即使过期也必须保留，直到原子恢复成功或后续受保护的运维流程处理；否则会丢失唯一恢复证据并
允许同一邀请产生第二个 Auth identity。

## 3. 技术契约

### 3.1 Supabase Redirect URL allowlist

语见 opaque flow 固定由 32 bytes 随机值编码为 43 个 Base64URL 字符。Hosted acceptance 只允许以下
query-aware pattern；`\?` 是 literal question mark，后面的 43 个 `?` 每个只匹配一个非分隔符字符：

```text
https://api.acceptance.seen-said.cn/v1/auth/callback\?flow=???????????????????????????????????????????
https://api.acceptance.seen-said.cn/v1/auth/password/confirm\?flow=???????????????????????????????????????????
https://api.acceptance.seen-said.cn/v1/auth/password/recovery/confirm\?flow=???????????????????????????????????????????
https://api.acceptance.seen-said.cn/v1/auth/reauthenticate/google/callback\?flow=???????????????????????????????????????????
https://api.acceptance.seen-said.cn/v1/account/sign-in-methods/google:callback\?flow=???????????????????????????????????????????
```

不得使用 `*`、`**`、host/path wildcard、localhost 或其他域。API 同样要求 flow 恰好 43 个
Base64URL 字符且 query 不得重复或包含额外字段。

### 3.2 Supabase Confirm sign up 模板

模板必须显示 `{{ .Token }}`，CTA 仅指向 `{{ .RedirectTo }}`，不出现可点击或自动加载的
`{{ .ConfirmationURL }}`，并保持 Resend click/open tracking disabled。

```html
<p>你的语见验证码是：<strong>{{ .Token }}</strong></p>
<p><a href="{{ .RedirectTo }}">打开语见并输入验证码</a></p>
```

### 3.3 API confirmation

- `GET /v1/auth/password/confirm?flow=<43-char>`：严格 query；返回 `private, no-store`、
  `Referrer-Policy: no-referrer`、`default-src 'none'; form-action 'self' <exact Web origin>;
base-uri 'none'; frame-ancestors 'none'`；精确 Web origin 只用于允许确认后的 API → Web 跳转，
  不允许通配域名；页面只含 email、六位验证码和隐藏 flow。
- `POST /v1/auth/password/callback`：只接收 exact
  `application/x-www-form-urlencoded` 的 `flow/email/token`，拒绝重复/额外字段；按 IP 和 email 限流；
  显式验证 OTP 后完成既有 auth flow，设置 Web Cookie 并 302 到 Web `/practice`。
- GET 重复、预取或 scanner 访问必须保持零 Provider 调用和零数据库消费。

### 3.4 恢复 API

新增 `POST /v1/auth/password/register/resume`，strict body：

```ts
type PasswordRegistrationResumeRequest = {
  invitationToken: string;
  email: string;
  password: string;
};
```

成功响应复用 `{emailConfirmationRequired:false,access:"full",csrfToken}`。顺序固定为：rate limit →
Provider password proof → atomic interrupted-registration recovery → Web session。不得先重新 claim、创建新
auth flow、删除旧 claim 或接受客户端 user id。

### 3.5 恢复时的 pepper continuity

原 Bootstrap invitation token 始终留在原邀请 URL fragment 与 Web 内存中，不要求用户识别、复制或输入
opaque token。用户在恢复表单提交后，Web 才把内存中的 token 与 email/password proof 一并交给 API；API
使用当前 Production pepper 计算 hash，0013 原子函数同时要求 Operator status 精确为
`registration-interrupted`、当前邀请是仍有效且未消费/撤销的 `deployment-bootstrap` invitation，并在任何
业务写入前匹配保存的 hash。pepper 或 token 缺失、轮换不连续、邀请失效或状态漂移均失败关闭且零部分
写入；日志和错误不得返回 pepper、token、hash、DSN、email 或 user id。

`acceptance:hosted:operator:pepper:verify` 仅保留为可选工程诊断工具：只有自动化或受控运维已经具有安全、
非回显的托管 token source 时才能使用，不是用户验收步骤，也不得要求用户从 URL 手工提取 token。真实
恢复的权威 continuity gate 是上述 Web → API → 0013 系统管理路径。

### 3.6 OTP 重发 migration

0014 只增加未确认注册的 flow 轮换函数，不修改已应用 0013。API 与 Supabase migration 必须
byte-identical；函数对 wrong/expired/revoked/consumed invitation、unbound/finalized claim、已确认或多
identity Auth user、额外 profile/method/quota/session/admin/deletion/audit/business data 全部零写入失败。
并发请求在 invitation 行锁上串行；每次成功都替换当前唯一 flow，因此只有最后一次成功重发的邮件有效，
任意时刻数据库仍恰好一条 invitation/claim/flow/Auth user/email identity。

## 4. 测试与验收

### 4.1 离线 TDD

- deployment plan 固定五条 43-character query-aware allowlist pattern，并拒绝 `*`/`**`；
- confirmation GET 对 scanner/repeat 请求零副作用，POST 严格拒绝重复/额外字段与错误 content type；
- Supabase Provider 精确调用 `verifyOtp({email,token,type:"email"})`，并规范化失败；
- migration 证明 bound expired claim 不会被 `claim_invitation` 删除；只有唯一、仍有效邀请下的精确中断
  状态能原子恢复，其他状态不产生任何部分写入；
- API/Web 恢复使用 original invitation token，错误密码或状态不匹配不设置 Cookie；
- actual-bundle E2E 证明邮件 CTA 的首次 GET 不消费 token，显式 OTP POST 后才进入 `/practice`。

### 4.2 Hosted 验收

1. dry-run 并实际推送恢复 migration；migration chain/0013 structure+ACL diagnostic 与 application verifier
   通过。当前 identity/profile 非空，因此 pristine foundation verifier 不适用且不得宣称通过；
2. 回读五条 Supabase allowlist pattern、OTP 模板与 Hosted `mailer_otp_length=6`，确认 Resend tracking
   disabled；三项证据缺一不可；
3. 双项目保持 disarmed 时提交并推送受审查候选；随后 API-only arm→产生并记录 deployment→立即独立
   disarm→验证没有额外 deployment；确认 API 已关闭后，Web 才执行同样顺序，任何时刻不得同时 armed；
4. API/Web 部署必须来自同一受审查候选 lineage，但 arm/disarm 是后续独立提交，因此两次 deployment
   source SHA 不要求也不可能与候选提交或彼此完全相同；
5. 对当前 confirmed-but-unfinalized user 使用仍留在浏览器中的原私密邀请与原密码执行恢复；API/0013 在
   写入前完成 pepper continuity 与邀请状态验证，不删除账号；
6. read-only Operator status 为 `registered`，然后完成 First Operator bootstrap，并先通过完整
   post-completion verifier；
7. `/admin` 首次 access 因缺少 recent-auth 返回统一 `forbidden` 时，显示当前密码重新认证表单；成功后
   使用轮换后的 CSRF 重读 Operator 权限与四区数据，认证后仍被拒绝才显示无权限页；
8. 只有 `/admin` 重新认证完成后，才新建一条受控普通邀请，完成 scanner GET 无副作用 + OTP 显式提交 +
   登录 journey；
9. 上述真实验收完成后再推进 DeepSeek smoke。

2026-08-24 已完成的真实证据为：Operator status 从 `registration-interrupted` 恢复到 `registered`，
随后 First Operator bootstrap 完成，read-only status 精确为 `completed`，完整 post-completion verifier
通过；0013 已实际应用，migration-chain、recovery function/ACL diagnostic 与 application verifier 均通过。Supabase Site URL 保持
`https://app.acceptance.seen-said.cn`；五条 43-character query-aware redirect 已逐字符回读；Confirm sign up
保存后重新加载仍精确使用 `{{ .Token }}` + `{{ .RedirectTo }}`，不含 `{{ .ConfirmationURL }}`。Custom SMTP
未改，Resend tracking 仍 disabled，本步骤未轮换密钥、未发送邮件。API arm `39094d0` 与 Web arm
`b18d804` 各只新增一条 Ready deployment；独立 disarm `88c9b09` / `2744757` 均未在其目标项目新增
deployment，两个项目均恢复 `deploymentEnabled=false`。默认 6/7（排除 Canceled）可见数在各目标项目
arm 时分别为 API 14→15、
Web 3→4，最终为 15/4；在各项目自身 arm 窗口，7/7 全状态数分别为 API 19→20、Web 13→14。双
disarm 后、证据文档提交前的 7/7 检查点为 API 22、Web 14，Canceled 为 7/10；两个 disarm 均未在其
目标项目新增 deployment，但各自在另一仍 disarmed 项目留下一条 Canceled 审计记录。浏览器内系统管理的 pepper
continuity/recovery 仍待执行。

`/admin` 密码重新认证 UI 已在本地按 RED→GREEN 补齐：不新增存储，不改变 API recent-auth 门；失败文案不
回显密码或 Provider detail，成功响应的轮换 CSRF 同时更新 CloudApp session state 与当前管理页写请求。
First Operator complete 与 post-completion verifier 已取得真实 Hosted 证据；该离线实现仍不能替代受控
Web 部署和真实 `/admin` 浏览器验证。

若原 Bootstrap invitation 已过期，阶段立即停止；不得临时 SQL 绕过或直接删除部分账号。

## 5. 已知相邻边界

密码恢复邮件目前仍由 Supabase `/verify` 链接先到达 Provider，再进入语见 inert confirm page；因此不能
把现有 password recovery 宣称为端到端 scanner-safe。本修复不扩张其行为，后续需要单独设计同样的
显式验证码或等价机制。

## 6. 官方约束

- [Supabase Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase Email Templates - email prefetching](https://supabase.com/docs/guides/auth/auth-email-templates#email-prefetching)
