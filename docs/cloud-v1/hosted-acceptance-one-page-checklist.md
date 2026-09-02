# Hosted 验收一页式操作清单

> 当前检查点：2026-09-02。Cloud V1 仍是 `implemented; validation pending`，不能开放
> production 或宣称 Chrome Web Store 就绪。

## 现在停在哪里 / 你现在要做什么

现在停在**账号已建立、Phase 94 已完成并双关闭、新 Store/自动发布候选仍仅在本地**。0023 backup/migration、两轮
Phase 93 Vercel 部署、fresh recovery readiness、同一邀请 token recovery、一次六位码重发、注册 completion
snapshot 与密码重登均已有真实结果；`account_finalized_exact|t`、`safe_route_state|account-established`。
正式 post-relogin 诊断已证明目标账号唯一 Web session 已 revoked、活动数为 0，其他三个活动 Web session
全部属于 Operator，最终 verdict 为 `other-active-only`；此前浏览器页面不是目标账号活动 session 的证据。

Phase 94 已完成 exact-SHA API→Web 上线、最终回读和双项目 disarm，旧 state 不得重放。新候选已在本地实现
固定 Hosted Store ID/profile、直接消费 Keychain 的 DeepSeek production loader，以及可恢复的
plan/status/advance/recover 发布协调器；但尚未 commit、push、运行新双平台 CI 或部署，Hosted Store
capability 仍 disabled。下一步先完成本地全门并冻结候选，再单独批准本次 push/deployment；协调器会等待
同一 SHA 的 macOS/Windows CI 后串行部署 API→Web。部署后才加载真实 Chrome、配对并依次关闭下面的业务门。
目标账号 session 验收只允许在隔离浏览器上下文
重新登录后，在普通 macOS Terminal 复跑：

```text
pnpm acceptance:hosted:identity:post-relogin:diagnose
```

首次使用前，用户在普通 macOS Terminal 运行
`pnpm acceptance:hosted:credentials:configure`，由系统无回显界面一次配置四项基础设施凭据；之后
`credentials:status` / `credentials:diagnose` 只输出固定状态，受控消费者直接从 login Keychain 读取，
不再重复提示管理员数据库密码或 Token。post-relogin 诊断不需要退出当前浏览器会话，不接受邮箱、Cookie、
UUID 或 token，也不写数据库；结果只用于区分目标账号活动 session、其他账号活动 session、当前数据库零
活动 session 或合同漂移。禁止为了刷新结果重发 OTP、轮换邀请、创建账号或删除 session。

## 谁做什么

- **Codex**：运行零网络 plan、检查 Git/SHA 和脱敏输出、准备受控命令、核对证据和更新清单。
- **用户 · Terminal**：首次把四项 Hosted 基础设施凭据配置到固定 login Keychain account；运行会连接
  Hosted 或写入的命令仍逐次获得批准。Operator 登录密码等业务凭据继续只输入专用无回显 TTY。
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
- **Vercel one-shot**：Phase 92、Phase 93、独立 fresh-CSRF 与 Phase 94 的 API arm/observe → API
  disarm/verify → Web arm/observe → Web disarm/verify 均已完成，两个项目均已关闭，历史 state 全部不可
  重放。后续普通候选只使用新的 release coordinator/state，不能调用旧命令或只重跑其中一步。
- **身份**：不得创建第二张普通邀请、删除现有 Auth user、重做 First Operator、bootstrap 或用 SQL 绕过。

## 1. Auth 与六位 OTP

**去哪里**：Terminal、Supabase 的 Auth 配置状态页面、Hosted Web 的现有 join 页面、当前邀请邮箱。

**做什么**：先完成 0022 backup/status/dry-run/apply/post 与 API/Web exact-SHA 部署。随后另行批准一次
真实 resend，只接受一封新邮件中的六位 ASCII OTP。邮件链接可被扫描或重复 GET，但只有用户在 Web 显式
POST OTP；完成后退出并用密码重新登录。

**成功标志**：Auth 配置 status 通过；新邮件恰好六位 OTP；重复 GET 零副作用；同一 invitation、user、
identity 保持唯一；Web 落到 `/practice`，密码重登成功。该旅程已于 2026-09-02 完成。随后在普通 macOS Terminal 运行
`pnpm acceptance:hosted:identity:snapshot`，至少得到唯一 invitation consumed、唯一 claim finalized、唯一
registration flow consumed、`account_finalized_exact|t` 与 `safe_route_state|account-established`；第二张普通
邀请会使收口失败。post-relogin 诊断当前为 `other-active-only`；只允许隔离登录目标账号并复跑诊断，预期
`subject-active`，不得用新的 OTP、邀请或账号刷新该证据。

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

**做什么**：先运行 `pnpm acceptance:hosted:cron:bootstrap:plan`。首次环境先在 `/recover` 只提交一次，
再运行受控 bootstrap provision；它只接受 R3-C 为空且唯一 recovery 可 claim，在 Vault 创建或复用秘密，
并直接写入 Vercel Sensitive，用户不复制或查看明文。发布同一 exact SHA 后运行 bootstrap recovery，要求
密码恢复 worker `sent → idle`；用户完成改密后运行 bootstrap deliver，要求 R3-C worker `sent → idle`，
并确认收件箱恰好一封安全通知。随后运行 `pnpm acceptance:hosted:cron:status`；只有
`cron_preflight_ready=t` 才运行带精确确认的 `pnpm acceptance:hosted:cron:apply`，并观察至少两个周期。
发送恢复邮件前还必须运行 `pnpm acceptance:hosted:auth:password-recovery:status`；若旧模板待迁移，只能在
单独批准后运行 `pnpm acceptance:hosted:auth:password-recovery:apply`，再回读 status。公开 202 只表示请求
已安全受理；Cron absent 的首次引导阶段必须由 bootstrap recovery 明确投递，不能把入队当成已发信。

**成功标志**：preflight ready；完整 operations SQL 连续两次事务成功；postflight 为 exact 五个 active job、
零 unmanaged；五条 route 有界响应，并观察 401/5xx/timeout 后恢复。

**立即停止条件**：既不是“R3-C 为空+唯一 claimable recovery”也不是“唯一 claimable R3-C”、Cron 已是
partial/exact、Vercel upsert 不确定、exact-SHA API 尚未 Ready、recovery/deliver 不是 sent→idle、用户未
收到或收到重复邮件、status 不是 ready、要求读取/打印 Vault 值、任一事务或 postflight 失败、job 数不为
五、或出现 unmanaged job。失败后先重跑只读 snapshot/status，不粘贴修复 SQL。

## 4. 一笔 Cloud DeepSeek 应用请求

**去哪里**：Terminal、Hosted Web、`/admin`、Vercel deployment/账单状态页。

**做什么**：先运行 `pnpm acceptance:hosted:deepseek:plan`。真实 executor、exact-SHA 双平台 CI、Auth、R3-C、
Cron 都通过后，用户另行批准一次小额费用，并在 executor 的无回显提示中输入当前 Operator 密码；Vercel
Token 和数据库管理员密码由受控消费者从固定 Keychain account 读取，不再次提示。executor 使用普通 Web
session 与正常 HTTP 合同，独占“登录并 recent-auth →
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
