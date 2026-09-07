# 邮箱验证后设置密码

影响平台：shared（Web/API）。状态：implemented; target-platform validation pending。
本次只实现并离线验证，未部署、未执行远端迁移、未发送真实邮件。

## 用户流程

1. 原邀请领取后，在 `/join` 只填写邮箱并发送验证码。
2. 页面立即切换为六位验证码输入，显示服务端规范化的邮箱，无需再次填写邮箱或点击邮件链接。
3. 验证成功后显示“密码”和“确认密码”。沿用 12–256 字符规则，两次输入一致才提交。
4. 密码设置、身份校验和邀请建档成功后，创建 Web session 并进入工作台。

验证码错误留在当前步；重发有 60 秒按钮倒计时，服务端继续限流。验证码和密码不写入 Web Storage。
刷新 `/join` 从专用 Cookie 恢复当前步骤，密码字段始终为空。邮件中的新流程链接只跳回固定 `/join`，
GET 不验证验证码或创建会话；跨浏览器打开时提示回到发起注册的浏览器。

## 服务端边界

- `POST /signup/start` 只接收 claimTicket/email。使用高熵随机临时密码发起 Supabase signup，绑定
  Provider user/email；临时密码不持久化或返回浏览器。返回 strict `{email,step,csrfToken}` 与
  `huayi_signup` Cookie（HttpOnly、Secure、SameSite=Lax，Path `/v1/auth/password/signup`，最长一天）。
- `GET /signup/session` 只投影绑定邮箱、当前步骤和专用 CSRF。Cookie 包含 flow 和独立随机浏览器证明；
  邮件中的 flow 无法替代该证明。所有端点都要求固定 Web Origin、无 query、private/no-store/no-referrer。
- `/signup/verify` 只接收 token，使用服务端邮箱调用 email OTP 验证；返回身份必须匹配已绑定 user/email。
  只把 Provider state 加密保存到 auth flow，绝不提前签发 Web session。
- `/signup/resend` 只接收空 JSON，通过绑定邮箱重发。verify/resend/complete 均要求 Cookie+Origin+CSRF，
  strict body 拒绝 email、owner、flow、额外密码或跳转地址等字段。
- `/signup/complete` 只接收 password，通过验证后保存的 Provider state 设置密码。再次证明相同身份后，
  调用现有 `complete_auth_flow(...,'password')` 完成邀请，再设置 Web Cookie 并清除注册 Cookie。
- verify 使用与旧 callback 相同的 IP（10/小时）和邮箱（5/小时）限流；resend 共享旧 IP 限流（5/小时），
  增加绑定邮箱 3/小时；start 为 IP+邮箱 5/分钟，complete 为 IP+邮箱 5/分钟。

阶段为 pending → verifying → verified → setting-password → password-set。resending 临时占用 pending；
密文 CAS 阻止旧请求覆盖新状态。未完成的验证/重发锁两分钟后可恢复，设置密码重试必须匹配此前提交
的密码 hash。Provider 更新响应丢失时，只有该密码的真实登录证明可以继续；错身份失败关闭。

`0026-email-first-password-signup.sql` 与 Supabase 镜像逐字一致，不增加表或列。两个函数仅允许
huayi_context_setter 调用；读取不续期，每次状态写入按 flow/claim/invitation 顺序锁定并续期短票据。
恢复窗口不超过原 claim 创建后 24 小时和原邀请期限；已消费、撤销、未绑定或超窗均失败关闭。
Provider state 只使用现有服务端加密机制，不进入响应、URL、日志或公开页面。

旧 `/register`、旧邮件表单与已有中断恢复仍兼容；新 flow 被旧 callback 拒绝，不能绕过设置密码。
新 API 和迁移必须先于新 Web 部署；本次没有修改邮件模板或 Hosted/production 配置。

## 验证

- Web 回归验证顺序、邮箱沿用、密码一致性、验证码错误、刷新恢复与单飞；adapter 测试验证 strict 字段、
  leading-zero OTP、Cookie/CSRF 请求及拒绝响应中的私有字段。
- API 回归验证密码前无业务账号/会话、Cookie/Origin/CSRF 失败早停、绑定身份、限流、并发、失败重试、
  短票据到期恢复、24 小时上限，以及新流程邮件 GET/旧 callback 的边界。
- PGlite 验证密文 CAS、恢复期限、撤销/消费/绑定条件、最小授权与完整迁移链；不代表真实多连接竞争验收。
- Playwright 使用 actual Web bundle 与离线 authority，覆盖手机验证码页、桌面双密码页、刷新/重发、
  完成进入工作台及后续密码重登。未验证真实 SMTP 投递、托管 Supabase 或线上 TLS/Cookie 配置。
