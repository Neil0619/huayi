# Hosted 验收一页式操作清单

> 当前检查点：2026-09-01。Cloud V1 仍是 `implemented; validation pending`，不能开放
> production 或宣称 Chrome Web Store 就绪。

## 现在停在哪里 / 你现在要做什么

现在停在**Phase 93 deployment/readiness 控制面提交前**。0023 已真实完成 pre/rebuild/dry-run/
`pending-exact`/apply/`applied-exact`/post/completion，最新脱敏 snapshot 仍精确证明同一 expired ordinary
invitation/claim/flow、unconfirmed Auth user、唯一 email identity 和零账号数据。新增 Phase 93 独立 Vercel
one-shot/只读 diagnose 与 recovery-readiness 诊断已离线实现；没有访问 Hosted/Vercel/Supabase、写 state、
部署或执行 recovery。
下一步先完成离线全门、commit/push 与 exact-SHA 双平台质量门；随后才逐项批准：

```text
pnpm acceptance:hosted:phase93:deployment:one-shot:diagnose
pnpm acceptance:hosted:phase93:deployment:one-shot:preflight
```

这些不是一条可连续粘贴的命令块，每一步都需要新的批准和上一阶段的精确成功结果。需要管理员密码的命令
由用户在普通 macOS Terminal 运行并只在无回显提示中输入；Codex 底部终端不用于密码提示。apply 另行批准，
且任何 `uncertain` 都先诊断、禁止盲重试。

diagnose 与 preflight 精确后，部署只使用 `acceptance:hosted:phase93:deployment:one-shot:*` 独立入口，依次为
API arm observe、API disarm verify、Web arm observe、Web disarm verify；每次 arm/disarm commit/push 仍需
单独批准。双关闭后先运行 `acceptance:hosted:phase93:recovery:readiness`，只接受全部叶为 `t` 与
`eligible_verdict|eligible`。Phase 81/92 state 只作历史证据，不得重跑、覆盖或冒充 Phase 93 state。

## 谁做什么

- **Codex**：运行零网络 plan、检查 Git/SHA 和脱敏输出、准备受控命令、核对证据和更新清单。
- **用户 · Terminal**：运行会连接 Hosted 或写入的命令；密码只输入无回显 TTY，不放环境变量。
- **用户 · 邮箱**：读取新收到的六位 OTP、核对重复邮件和无正文告警；不把邮件正文或 OTP 发给 Codex。
- **用户 · 浏览器**：在真实 Hosted Web 完成 OTP、登录、产品旅程和 `/admin` recent-auth。
- **用户 · Dashboard**：只在对应产品的“查看配置状态 / 受控开关 / 账单”页面操作；不猜菜单路径。
- **共同规则**：Token、Cookie、密码、Provider key、数据库 DSN、邮件正文、备份和账单明细都不进聊天、
  命令行参数、文档、截图、Git 或测试输出。任何工具要求手输 request ID、UUID、邀请片段等 opaque ID，
  立即停止。

## 已冻结：禁止重跑

- **Migration**：`acceptance:hosted:migration:0014:{dry-run,apply}` 与
  `acceptance:hosted:migration:0015:{dry-run,apply}` 均已完成；不得再次 apply，也不为刷新证据重跑。
- **Backup capture**：既有 backup 与 Phase 91 的 pre capture、isolated rebuild、post capture evidence
  不得覆盖、删除或重捕；只允许既有只读 status / historical verifier。
- **0016–0021 边界**：Hosted DeepSeek 0016–0021 已完成 `applied-exact` 与独立 pre/rebuild/post completion；
  该 batch 保持不可变，不得重跑 apply、覆盖备份或用作 Phase 92 evidence。0022 另用
  `phase-92-0022-expired-invitation-recovery` batch。
- **Vercel one-shot**：`acceptance:hosted:deployment:one-shot:preflight` → API arm/observe → API
  disarm/verify → Web arm/observe → Web disarm/verify 已完成，两个项目均已关闭。当前不得重新 arm、disarm
  或部署；未来新候选必须另行审查并重新批准完整串行门，不能只跑其中一步。
- **身份**：不得创建第二张普通邀请、删除现有 Auth user、重做 First Operator、bootstrap 或用 SQL 绕过。

## 1. Auth 与六位 OTP

**去哪里**：Terminal、Supabase 的 Auth 配置状态页面、Hosted Web 的现有 join 页面、当前邀请邮箱。

**做什么**：先完成 0022 backup/status/dry-run/apply/post 与 API/Web exact-SHA 部署。随后另行批准一次
真实 resend，只接受一封新邮件中的六位 ASCII OTP。邮件链接可被扫描或重复 GET，但只有用户在 Web 显式
POST OTP；完成后退出并用密码重新登录。

**成功标志**：Auth 配置 status 通过；新邮件恰好六位 OTP；重复 GET 零副作用；同一 invitation、user、
identity 保持唯一；Web 落到 `/practice`，密码重登成功。随后在普通 macOS Terminal 运行
`pnpm acceptance:hosted:identity:snapshot`，至少得到唯一 invitation consumed、唯一 claim finalized、唯一
registration flow consumed、`account_finalized_exact|t` 与 `safe_route_state|account-established`；第二张普通
邀请会使收口失败。

**立即停止条件**：snapshot 不确定、0022 status 为 uncertain、invitation 已消费或无法精确恢复、再次 401、没有
新邮件、不是六位 OTP、需要第二邀请/删除账号/截取旧八位码、或任何秘密将被记录。

## 2. R3-C 真实通知

**去哪里**：Hosted Web 的正常账号安全操作、收件邮箱、告警接收渠道；前后可在 Terminal 运行
`pnpm acceptance:hosted:runtime:snapshot`。

**做什么**：Auth 门关闭后，由用户通过正常产品路径触发一次安全通知；观察真实收件、同 notification 的
重复处理，以及失败/耗尽时的无正文告警。Codex只比较脱敏聚合，不读取邮箱、owner 或正文。

**成功标志**：真实邮件收到一次，无重复投递；R3-C outbox 进入正确终态；重复只在 23 小时 / 8 次边界内，
告警只含固定 reason/count，不含正文。

**立即停止条件**：未先完成 Auth、sender 未验证、出现重复邮件、正文/身份出现在日志或告警、outbox 非终态、
或需要粘贴 Resend key。

## 3. 五项 Supabase Cron

**去哪里**：Terminal；Vercel 的 Production secret 状态页面；Supabase 的 Vault/Cron 状态页面。

**做什么**：先运行 `pnpm acceptance:hosted:cron:plan`；R3-C 通过后再运行
`pnpm acceptance:hosted:cron:status`。用户只从同一受控来源确认 Vercel `CRON_SECRET` 与 Supabase Vault
连续性；Codex复核后，用户再运行受控 `pnpm acceptance:hosted:cron:apply`，随后观察至少两个周期。

**成功标志**：preflight ready；完整 operations SQL 连续两次事务成功；postflight 为 exact 五个 active job、
零 unmanaged；五条 route 有界响应，并观察 401/5xx/timeout 后恢复。

**立即停止条件**：R3-C 未通过、secret 连续性无法证明、status 不是 ready、要求读取/打印 Vault 值、任一
事务或 postflight 失败、job 数不为五、或出现 unmanaged job。失败后先重跑 status，不粘贴修复 SQL。

## 4. 一笔 Cloud DeepSeek 应用请求

**去哪里**：Terminal、Hosted Web、`/admin`、Vercel deployment/账单状态页。

**做什么**：先运行 `pnpm acceptance:hosted:deepseek:plan`。真实 executor、exact-SHA 双平台 CI、Auth、R3-C、
Cron 都通过后，用户另行批准一次小额费用，并在 executor 的无回显提示中输入当前 Operator 密码、Vercel
token 和数据库管理员密码。executor 使用普通 Web session 与正常 HTTP 合同，独占“登录并 recent-auth →
登记恢复义务 → 临时关闭 kill switch → 发出唯一一笔请求 → 结算 → 恢复 kill switch → logout”的完整顺序；
用户不要在 `/admin` 手动切换开关，也不要另开浏览器手动发送分析请求。执行前后只比较脱敏 runtime snapshot。

**成功标志**：固定 `deepseek-v4-flash`；90 秒内完成或安全超时；request/completed/record 各增加 1；
1–2 个连续 billed call；reservation `settled`、ledger `succeeded`、usage/价格/模型元数据/实际账单一致；
kill switch 已真实恢复。

**立即停止条件**：真实 executor 或 exact-SHA CI 未通过、任一前置门未关、无 recent-auth、小额预算未批准、
模型错误、超时/结算不明、账本或账单不一致、出现第二笔请求，或 kill switch 无法恢复。不要运行 Classic
`pnpm smoke:deepseek` 代替 Hosted 证据。

## 5. 数据权利与目标网络

**去哪里**：Hosted Web 的“设置 → 数据”、批准的隔离测试账号、目标用户网络、浏览器下载目录。

**做什么**：用户验证 active/full 与 disabled/data-rights 两条登录路径；请求 AccountDataExport、在新窗口
下载、核对 24 小时过期清理；只对另行批准的隔离账号演练一次删除。再验证 Google OAuth、邮箱密码、SSE
和 Singapore 延迟。Codex只核对状态、计数和回执，不接收导出文件。

**成功标志**：导出是独立私有对象；签名下载不越过到期；ready 后 24 小时对象和主库记录删除；session
即时撤销；disabled 账号只能导出/删除/退出；目标网络四条旅程通过。

**立即停止条件**：没有可牺牲的隔离账号或单独删除批准、导出含不应出现的本机凭据/词库、对象公开、
过期后仍可下载、删除影响其他租户，或要求上传导出文件到聊天。

## 6. macOS / Windows Chrome 与外部词库

**去哪里**：两台目标系统的真实 Chrome、Store Extension、Hosted Web 生词页、欧路与扇贝客户端。

**做什么**：用户分别验证普通网页/YouTube、BYOK/平台、StudyCapture、撤销、离线 outbox、断开设备、
本机/云端生词和升级后旧标签失败关闭；再经独立批准验证欧路导入/导出和扇贝人工最终提交。Codex核对
候选 SHA、Manifest 与 Chrome Dashboard 当前 ID，不要求用户抄写 ID。

**成功标志**：两平台同一候选完整通过；BYOK 对语见零上传；队列可恢复且换号清理正确；断开只影响当前
设备；本机词库不丢；CloudWordCopy 失败不回滚本机；欧路往返与扇贝手工提交符合预览/二次确认。

**立即停止条件**：任一平台未实际验证、候选/SHA/ID 不一致、自动 fallback、上传 BYOK 结果、队列误称已
同步、本机数据丢失、或工具尝试自动点击扇贝最终提交。

## 7. Production 逻辑备份恢复演练

**去哪里**：Terminal、Supabase 的临时 recovery project 状态页、批准的私有备份位置。

**做什么**：Codex先运行 `pnpm acceptance:hosted:restore:plan`。用户另行批准同组织/同区/同 PostgreSQL
major 的全新隔离 target、费用、retention 与维护窗口后，严格按顺序运行：

```text
pnpm acceptance:hosted:restore:source:verify
pnpm acceptance:hosted:restore:target:verify-empty
pnpm acceptance:hosted:restore:execute
pnpm acceptance:hosted:restore:verify
pnpm acceptance:hosted:restore:cleanup
pnpm acceptance:hosted:restore:status
pnpm acceptance:hosted:restore:retention:verify
pnpm acceptance:hosted:restore:retention:close
```

archive、token 不进聊天。

**成功标志**：schema/data/Auth/Storage metadata、双租户 RLS、roles 与 body-free count HMAC 全绿；target、
credential、临时文件已删除并回读 absent；retained archive/object 到批准期限后有删除证据，lifecycle
最终为 `closed`。

**立即停止条件**：production adapter 未实现/审查，source 或 target identity 不确定，target 非空，区域/
PG major 漂移，Storage bytes 非零但无独立 export 方案，出现 outbound integration，cleanup/revoke 失败，
或 retention 尚未到期却要求提前关闭。

## 8. 跨多日自然使用与发布收口

**去哪里**：Hosted Web、两平台 Chrome、问题记录、GitHub Actions、发布检查表。

**做什么**：用户至少跨多日自然使用完整学习闭环；每个问题绑定 SHA、环境、场景和严重级别。Codex修复后
重新跑自动回归并部署同一候选，用户复验原场景；GitHub outage 恢复后重查 run `32985730194` 或本 SHA 的
有效替代 run，最后运行 `pnpm check:cloud-release`。

**成功标志**：一个跨多日周期完成；P0/P1 为零，P2 已修复或有用户接受的结论；macOS/Windows exact-SHA
CI、Hosted 全部外部门和 `pnpm check:cloud-release` 均通过；用户明确批准生产候选。

**立即停止条件**：CI 仍 queued/zero jobs、使用旧 SHA 证据、任一平台或外部门未验证、存在开放 P0/P1、
release check 未 ready，或有人把“离线测试通过”写成“Hosted 已验收”。
