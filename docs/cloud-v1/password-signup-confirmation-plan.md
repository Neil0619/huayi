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

- [ ] 只读确认 project/domain/source 与当前 interrupted state；
- [ ] migration dry-run 只列出本次一条，用户确认后实际 push；
- [ ] migration-chain/0013 structure+ACL diagnostic、application verifier 与精确
      `registration-interrupted` 通过；pristine foundation verifier 在当前非空状态下不得作为前置门；
- [ ] 用固定 `acceptance:hosted:operator:pepper:verify` 只读证明 Keychain Production pepper + 原邀请 token
      匹配当前有效 Bootstrap invitation；只接受 bounded pass/fail；
- [ ] 写入并回读五条 query-aware Redirect URLs；
- [ ] 保存并回读 OTP Confirm sign up 模板，确认 Resend tracking disabled；
- [ ] 双关闭下提交并推送受审查候选；API-only arm→记录 deployment→立即独立 disarm→验证零额外
      deployment，确认 API 已关闭后 Web 才执行同样顺序；两者绝不同时 armed；
- [ ] API/Web 来自同一受审查候选 lineage；arm/disarm 后 deployment source SHA 可不同，不把“同一
      lineage”误写成“完全相同 SHA”；
- [ ] 用原 invitation token + 原密码恢复当前 confirmed user；
- [ ] 完成 registered/Operator verifier 与新用户 OTP journey。

任何外部写入前重新核对目标。若原邀请已过期，阶段 E 停止并另行设计受保护的破坏性恢复；禁止临时
SQL 绕过。
