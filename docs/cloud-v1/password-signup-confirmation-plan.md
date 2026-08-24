# 密码注册确认与中断恢复实施计划

## 阶段 A：文档、证据与方案审查

- [x] 记录 Hosted 部分成功状态，并排除“仅凭登录失败就判定密码错误”。
- [x] 以 Supabase redirect glob、Site URL fallback、email prefetch 与 `verifyOtp` 约束校准设计。
- [x] 放弃仍会暴露一次性 ConfirmationURL 的 fragment wrapper。
- [x] 确认 bound expired claim 必须保留，并需要新 migration 原子恢复。

退出标准：正常 OTP 注册与当前中断恢复是两条边界清楚、失败关闭、无需删除 Auth user 的路径。

## 阶段 B：Fresh RED

- [x] deployment plan 因旧 exact redirect/query wildcard 契约失败；
- [x] confirmation GET/POST 与 Provider `verifyOtp` 因缺失实现失败；
- [x] migration 因 bound claim 被删除且无原子恢复函数失败；
- [x] resume contract/API/Web 因缺失安全实现失败；
- [x] actual-bundle scanner-safe OTP journey 因旧 code callback 失败。

退出标准：原始 `otp_expired`、Site URL fallback、登录无法补建档、bound claim 被清理均有行为回归。

## 阶段 C：最小 GREEN

- [x] 固定五条 43-character query-aware allowlist pattern；
- [x] 实现 inert API OTP confirmation GET 与显式 POST；
- [x] Provider 实现 strict `verifyOtp({email,token,type:"email"})`；
- [x] 新 migration 保留 bound claim 并提供 atomic interrupted-registration recovery；
- [x] API/Web 恢复只使用 original invitation token + Provider password proof；
- [x] 删除未完成的 fragment confirmation 页面及宽松 `flow=*` 实现；
- [x] 更新 API/security/testing/hosted deployment/acceptance environment/change log/status。

退出标准：focused contracts/API/Web/migration/script/E2E 全绿，diff 与设计一致。

## 阶段 D：离线审查与完整门

- [x] 审查 OTP/password/invitation token 不进入 URL、Referer、Storage、bundle 或测试输出；
- [x] 运行 format、lint、typecheck、focused/full tests、build、`verify:macos`；
- [x] 审查 migration 与 Supabase timestamp mirror byte-identical，最终 diff 无越界变更。

退出标准：完整 Mac 门通过；Windows 按关键批次统一验证，不因本次 Hosted-only 修复单独执行。

## 阶段 E：Hosted migration、配置、部署与恢复

- [x] 双项目 disarmed 时提交并推送受审查候选 `be38942`；Vercel 默认 6/7 状态筛选下 API/Web 可见数
      保持 14/3，新增均为 0，
      两份 `vercel.json` 的 `deploymentEnabled` 仍为 `false`；
- [x] 只读确认当前 Operator status 精确为 `registration-interrupted`，application login verifier 通过；
      pristine foundation verifier 在当前非空状态下不得作为前置门；
- [x] migration dry-run 只列出
      `20260823010000_password_signup_interruption_recovery.sql`，数据库未修改；
- [x] 用户明确确认后实际 push 0013；migration-chain、0013 recovery function/ACL diagnostic 与 Hosted
      application verifier 均通过；
- [x] 写入并回读五条 query-aware Redirect URLs；Site URL 保持
      `https://app.acceptance.seen-said.cn`，列表恰好五条且每条 `flow=` 后均为 43 个单字符 wildcard；
- [x] 保存并重新加载回读 OTP Confirm sign up 模板：正文精确使用一次 `{{ .Token }}` 与一次
      `{{ .RedirectTo }}`，不含 `{{ .ConfirmationURL }}`；Resend tracking 仍 disabled；Custom SMTP 未改，
      本步骤未轮换密钥、未发送邮件；
- [x] 普通邀请真实邮件暴露 Hosted `mailer_otp_length=8` 漂移；已只把该字段保存为 6，独立重新加载
      回读为 6，expiration 仍为 3600，且未修改 Site URL、Redirect URLs、模板、Custom SMTP、DNS、
      环境变量或密钥；新增 status/apply verifier，旧 8 位 OTP 不截取、不继续用于产品确认；
- [ ] 为当前同一 invitation claim/bound Auth identity 提供受限重发，产生新的六位 OTP；完成前不得
      创建第二张邀请、删除 Auth user 或把旧 8 位 OTP 截成六位；
- [x] API-only arm `39094d0` 仅新增 Ready deployment `9jbyfnAvZwpa3Ci7YU6s6asmNZNG`，独立 disarm
      `88c9b09` 未在 API 项目新增 deployment；确认 API 已关闭后，Web arm `b18d804` 仅新增 Ready
      deployment `Bks2JvgrNidQ1CRjmUiwz9RTfhjF`，独立 disarm `2744757` 未在 Web 项目新增
      deployment；默认 6/7（排除 Canceled）可见数
      在各目标项目 arm 时分别为 API 14→15、Web 3→4，最终为 15/4；在各项目自身 arm 窗口，7/7
      全状态数分别为 API 19→20、Web 13→14。双 disarm 后、证据文档提交前的 7/7 检查点为 API 22、
      Web 14，Canceled 为 7/10；两个 disarm 均未在其目标项目新增 deployment，但各自在另一仍
      disarmed 项目留下一条 Canceled 审计记录；
- [x] API/Web 来自同一受审查候选 lineage；arm/disarm 后 deployment source SHA 可不同，不把“同一
      lineage”误写成“完全相同 SHA”；
- [x] 原计划“从仍持有原邀请 URL fragment 的浏览器页面恢复”已由后续受控替换邀请与 0013 原子恢复
      路径取代，旧 fragment 路径未执行且禁止重跑；最终恢复后 status 已进入 `registered`；
- [x] 确认 status `registered`，完成 First Operator，并先通过 post-completion verifier；最终 read-only
      status 精确为 `completed`；
- [x] 按 RED→GREEN 实现 `/admin` 密码重新认证：首次统一 `forbidden` 显示密码表单，成功后更新 CSRF 并
      重读权限；错误可重试且不在文案中泄露密码，认证后仍拒绝则失败关闭；
- [x] 受控部署上述 Web 修复并完成真实 `/admin` 密码重新认证与四区只读复核；普通邀请仍须使用不同于
      Operator 的未注册邮箱，scanner-safe OTP journey 继续 pending。

`acceptance:hosted:operator:pepper:verify` 不是用户门。它只在工程自动化已有安全 managed token source 时
作为可选非回显诊断；不得要求用户识别、复制或输入 URL fragment 中的 opaque token。

任何外部写入前重新核对目标。若原邀请已过期，阶段 E 停止并另行设计受保护的破坏性恢复；禁止临时
SQL 绕过。

## 阶段 F：普通邀请 OTP 位数漂移与同邀请重发

- [x] 真实邮件、Hosted Email provider 与仓库 strict contract 三方回查，确认根因是
      `mailer_otp_length=8`，不是 Resend 或 UI 截断；
- [x] 仅把 Hosted `mailer_otp_length` 保存为 6 并独立回读；新增只读 status 与单字段受控 apply；
- [x] Fresh RED：token-only resend contract/Provider/API/Web、0014 原子 flow 轮换、byte-identical mirror、
      ACL 与 actual-bundle journey；
- [x] 最小 GREEN：Web 内存保留 invitation token、StrictMode 独立单飞、API 双限流、Supabase signup
      resend、0014 同 invitation/claim/bound identity 唯一 flow 轮换；
- [x] focused/full macOS 门和安全 diff 审查；Windows 继续按最终关键批次统一验证；
- [x] Phase 82 补齐固定项目/批次的离线 backup plan、preflight/completion verifier 与严格 clean HEAD/
      manifest/权限/hash/migration+fictional-seed rebuild 契约；本项没有连接 Supabase 或生成真实 dump；
- [x] Phase 82 executor readiness 继续以 Fresh RED→GREEN 校准：固定 pre/rebuild/post readiness、session
      pooler 5432/verify-full/process-scoped secret+CA、PG17/custom archive 与 Storage metadata/object bytes
      边界；本机只有 PG14.6，且 pinned scratch image/write executor 缺失，因此固定失败且零 evidence；
- [x] Phase 83 固定 PostgreSQL 17.6.1.159 OCI index、本机 Unix Docker socket、local image/FileVault verdict，
      并把未来密码传递改为 `0600 .pgpass` read-only mount；未启动 daemon、pull/run image 或写 evidence；
- [ ] 先固定并审查完整 Auth/Storage platform image digest lock/write executor，并证明 Storage objects 为零
      或完成单独 object export；不得用 Supabase CLI filtered SQL 冒充 postgres-custom；
- [ ] 单独批准并完成 0014 前 raw logical dump 与隔离 scratch 重建，且
      `pnpm acceptance:hosted:backup:preflight` 通过；该门关闭前 0014 不得描述为 ready；
- [ ] 用户确认后只实际应用唯一 0014，再 API→Web 严格串行 one-shot deploy/disarm；部署完成前不发送
      新邮件；
- [ ] 0014 应用后完成 post raw logical dump，并由 `pnpm acceptance:hosted:backup:complete` 关闭重要批次；
- [ ] 系统打开最近的私密邀请，用户点击重发；只接受新邮件的六位 ASCII OTP，scanner GET 零副作用，
      显式 POST 完成同一 invitation/user，并回读 invitation/user/identity 唯一性。

退出标准：pre/post backup 与 migration+fictional-seed rebuild 证据完整；旧 8 位 OTP 不再用于产品确认，
重发后旧 flow 失效；同一普通邀请和同一 Auth user 在不要求用户输入 opaque token、不创建第二邀请/用户
的前提下收到新六位 OTP 并完成注册。
