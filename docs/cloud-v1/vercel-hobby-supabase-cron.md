# Vercel Hobby + Supabase Free 高频任务调度方案

## 1. 状态与范围

本方案校准 Cloud V1 五个生产 worker 的调度适配层，影响平台为 `shared`；macOS 与 Windows
客户端支持均保留。本阶段不创建 Vercel/Supabase 项目，不购买域名，不配置 DNS、Resend、密钥或真实
生产环境，也不调用任何外部服务。

2026-08-24 Phase 79 在该既有 SQL 之上增加 Hosted 受控运维工具。工具已完成离线 TDD，但尚未连接真实
Supabase，也没有安装或触发任何 job；下文“本阶段不创建资源”继续描述这次代码/文档阶段，真实 apply
仍必须等待 R3-C 产品路径投递、重复观测与无正文告警接收全部通过。

2026-08-26 候选 `1caf9dcf21f24a4410043a8356a9b2a1dbf8f8d6` 又收紧了 runtime snapshot 与 Cron
status/apply 的秘密、来源和进程边界。该候选只完成本地与双平台 CI 门；加固后没有运行真实 Hosted
runtime snapshot、Cron status 或 Cron apply，也没有输入用户秘密。

2026-09-02 当前候选进一步把 Vercel/Vault 连续性收敛为可恢复的受控引导：Supabase Vault 是唯一秘密
来源，Vercel Sensitive Production 变量只接收同一值；工具不要求用户复制、记忆或查看
`CRON_SECRET`。该候选仍须先通过质量门和 exact-SHA 发布，真实通知、Cron 安装与周期观察不得由离线
测试提前宣称完成。

目标是移除 `apps/api/vercel.json` 中 Hobby 不接受的分钟级 Vercel Cron，把五个 HTTPS GET
触发器放入生产 Supabase 的 `pg_cron + pg_net`。业务 route、`CRON_SECRET` 鉴权、lease/fencing、批次
上限和幂等状态机都保持不变；开发和 Preview 环境继续只允许人工触发，不自动安装任务。

这不是“整个 Cloud V1 已兼容 Vercel Hobby”的声明：

- Vercel Hobby 仅面向个人、非商业用途；后续商业化必须重新选择和验收套餐；
- Phase 38 当时按未启用 Fluid Compute 的 legacy Hobby 上限记录了 60 秒 Function 与 90 秒应用超时
  冲突；Phase 45 已用显式 Fluid 配置和 120 秒入口上限取代该口径，真实部署验证仍待独立任务；
- Supabase Free 项目可能因低活动被暂停，且不含自动备份；它适合当前开发/个人验证基线，不等于生产
  可用性与恢复策略已经验收；
- `pg_net` 当前为 Beta；正式候选必须观察请求响应、失败率和扩展升级兼容性。

## 2. 固定任务集合

生产数据库只安装以下五个独立、每分钟运行的任务：

| Job name                             | 固定路径                                           | 既有责任                         |
| ------------------------------------ | -------------------------------------------------- | -------------------------------- |
| `huayi-password-recovery`            | `/internal/password-recovery/run`                  | 密码恢复邮件 worker              |
| `huayi-data-rights`                  | `/internal/data-rights/run`                        | 导出与账号删除 worker            |
| `huayi-extension-query-cleanup`      | `/internal/extension-queries/cleanup`              | ExtensionQuery 过期终态化与清理  |
| `huayi-duplicate-suggestion-cleanup` | `/internal/learning-duplicate-suggestions/cleanup` | 语义重复建议 lease/terminal 清理 |
| `huayi-security-notifications`       | `/internal/security-notifications/run`             | 密码重置安全通知发送             |

五个任务必须保持独立，不能合并为一个“大扫除” route。调度器只提供 at-least-once 触发；实际并发、
重试和重复调用仍由各业务状态机处理。按 30 天估算，五个分钟任务约产生 216,000 次 Function 调用；这低于
当前 Hobby 每月 1,000,000 次包含量，但用户请求、CPU、内存、带宽和其他函数同样消耗套餐资源，不能把
该估算当作容量保证。

R3-C 的第五个任务已进入 operations SQL；它只触发仓库内 sender 状态机。真实 DNS、verified sender、
Resend 投递与监控目的地仍属于外部发布阻塞项。

## 3. 安装 SQL 与安全边界

仓库提供可审计的运维 SQL：`apps/api/operations/configure-supabase-cron.sql`。它不是应用 migration，
只能由生产 Supabase 管理员在正式 origin 与 secret 已写入 Vault 后显式运行。

SQL 必须满足：

1. 幂等启用 `pg_cron`、`pg_net` 和 Supabase Vault，并使用固定 schema；
2. 运行时只从 Vault 读取 `huayi_api_origin` 和 `huayi_cron_secret`，仓库、任务 command、响应和日志都不
   出现真实 secret；
3. 配置缺失、origin 非 HTTPS、origin 含路径/查询/片段/空白、secret 少于 32 或多于 512 字符时，在安装
   任务前失败关闭；
4. 私有 `SECURITY DEFINER` adapter 固定 `search_path`，只接受上表五个精确路径；`PUBLIC`、`anon`、
   `authenticated` 和 `service_role` 都没有直接执行权限；
5. 请求带 `Authorization: Bearer <CRON_SECRET>` 与 `Accept: application/json`，使用不超过 55 秒的
   `pg_net` timeout，作为五个有界 worker/cleanup 调度请求自身的故障隔离上限；
6. 安装前按固定 job name 取消旧任务，再各安装一次。重复运行后的结果仍只能是五个任务，不制造重复
   schedule。

应用账号、owner session、Web 或 Extension 身份都不能调用该 adapter。Vault 值轮换后，下一次触发应读取
新值；若同步轮换 API `CRON_SECRET`，先更新 Vault，再更新 API 环境并立即做一次受控人工调用，避免长期
鉴权失败。

### 3.1 Hosted 受控运维接口

Hosted acceptance 不再要求用户把本文件的长 SQL 粘贴到 Dashboard，也不要求手工输入 job ID：

- `pnpm acceptance:hosted:cron:plan` 是零网络、零写入计划；
- `pnpm acceptance:hosted:cron:bootstrap:plan` 给出固定
  `provision → exact-SHA API release → recovery → 用户改密 → deliver → inbox confirmation → apply`
  顺序，本身零 I/O；
- `pnpm acceptance:hosted:cron:bootstrap:provision
--confirm-provision-hosted-cron-secret-for-bootstrap-kpadiulxkgckskcfydry` 只在专用 Cron status 精确为
  `absent`，且状态为“R3-C 为空+恰好一个可 claim recovery”或“恰好一个可 claim R3-C”时，创建或复用
  两个固定 Vault 名称；bearer 固定为 64 个小写十六进制字符，只在本进程内送入 Vercel
  `CRON_SECRET` 的 Production Sensitive upsert。写入响应必须零 failed、恰好一个精确对象，再回读
  名称/type/target；任何响应不确定都固定失败。成功后必须发布同一 clean exact SHA，环境变更才会进入
  新 API deployment；
- `pnpm acceptance:hosted:cron:bootstrap:recovery:deliver
--confirm-deliver-hosted-password-recovery-after-secret-release-kpadiulxkgckskcfydry` 从 Vault 读取同一值，
  调用密码恢复 worker 并要求 `sent → idle`，随后用不含邮箱、owner、flow 或密文的四项聚合确认唯一
  recovery 为 sent；already-sent 重跑只接受一次 `idle`；用户随后打开最新邮件并完成改密；
- `pnpm acceptance:hosted:cron:bootstrap:deliver
--confirm-deliver-hosted-r3c-after-secret-release-kpadiulxkgckskcfydry` 从 Vault 在有界进程内读取该值，调用
  正常产品 worker 两次并要求 `sent → idle`；若首次响应丢失但数据库已经 sent，重跑只接受一次
  `idle`。随后独立快照必须证明唯一通知已进入 sent 终态。工具从不输出 bearer；用户仍须亲自确认只收
  到一封安全通知；
- `pnpm acceptance:hosted:cron:status` 固定 Singapore project ref，复用管理员 transaction pooler、临时
  CA 文件与 `verify-full`，先从固定官方 URL 获取并严格校验 CA，再从固定管理员 Keychain account 读取
  密码，最后只运行一个有 30 秒进程上限的 `BEGIN READ ONLY` 事务；
- `pnpm acceptance:hosted:cron:apply <exact-confirmation>` 先验证 project-specific confirmation、operations
  SQL 的精确 SHA-256
  `09a074addefdf352ff256ff958bb87a6775b911a7da9475ef697b04d2a64d604`，以及 clean worktree、
  `HEAD==upstream` 的仓库候选；三个 Git 读取各有 10 秒上限。只有这些来源门先通过，才获取 CA、读取密码
  并进入数据库 preflight。它原样执行完整
  `apps/api/operations/configure-supabase-cron.sql` 一次，再原样执行第二次，最后用独立只读 status 要求
  exact 五个 active minute job、函数/ACL/extension 全部一致。

status/apply 都拒绝环境对象自身拥有 `PGPASSWORD` 或 `SUPABASE_DB_PASSWORD`，不因值为空或 `undefined`
而放行；管理员密码按 UTF-8 byte length 接受 12–512 bytes，并拒绝 NUL、CR、LF。密码只进入一次性
`0600 .pgpass`，child 只取得 `PGPASSFILE`。全部 runtime/Cron psql 调用固定 30 秒上限；snapshot/status
parser 只接受精确 final LF 且任何 CR 都失败。上述规则不会把密码、CA 或数据库错误写入输出。

status 只输出固定 boolean、`absent|partial|exact` stage 和 64-bit 非负聚合计数。它只查询
`vault.secrets.name`，不查询 `vault.decrypted_secrets`，也不输出 Vault 值、Authorization、邮箱、owner、
正文、request/job ID 或原始错误。preflight 允许“尚未安装”或可由固定 SQL 修复的受管状态，但遇到未知
`huayi-*` job、额外函数 overload/不可修复 owner/ACL、错误 extension schema、非管理员连接、migration
漂移、Vault 名称缺失，或 R3-C 数据库侧门不通过时失败关闭。

Vercel Sensitive Environment Variable 不能解密回读，因此 status **不能**通过比较明文证明当前 API
`CRON_SECRET` 与 Vault 值相等。bootstrap 以“同一 Vault 值完成 Vercel upsert → 后续 deployment → API
鉴权成功并真实发送 → 重复调用 idle”的产品行为证明连续性，不把 masked metadata 当成值证明。apply 的
exact confirmation 只记录该链和真实收件证据已经完成；缺任一项不得 apply。数据库侧
`r3c_sent_count>=1`、零非终态/失败终态和数据合同只是附加门，不能替代真实收件、重复观测或告警接收。

两次 operations SQL 各自保留原来的 `BEGIN; ... COMMIT;`。第一次成功后若第二次或 postflight 失败，
第一次不会被工具虚构为已回滚；CLI 只报告固定 `first-apply|second-apply|postflight-*` stage，操作者必须
先重新运行只读 status，再决定重试或停用。operations SQL 自身的失败会在对应事务内回滚，且其固定
unschedule/schedule 语义保证安全重跑。

## 4. 运维与恢复

安装前：

1. 确认正式 API origin 已启用 HTTPS，且不带尾随路径；
2. 通过正常密码恢复完成路径产生恰好一条可 claim 的 R3-C 通知；
3. 运行 bootstrap provision，发布同一 exact SHA，再运行 deliver；用户确认一封且仅一封真实邮件；
4. 运行 status，要求 `cron_preflight_ready=t`；
5. 用精确 confirmation 执行 apply，并确认固定五项、schedule 均为 `* * * * *`。

停用时按固定 job name 调用 `cron.unschedule`；不要删除业务数据、lease 或 ledger。调度中断后恢复只需重装
任务，worker 会从数据库状态继续处理。观测 `cron.job_run_details` 和 `net._http_response` 时只能记录 job、
request ID、HTTP status、耗时和有界计数，不复制 Authorization、用户正文或模型内容；同时注意 `pg_net`
响应为短期诊断数据，不是永久审计账本。

Supabase Free 暂停或额度耗尽会使任务停止。正式发布前必须决定付费等级、备份/恢复、告警和容量阈值，
并完成一次暂停或故障后的恢复演练。

## 5. TDD 与验收

离线自动化先取得 Fresh RED，再以最小实现转绿：

- `production-app.test.ts` 证明五个内部 route 保留，同时 `vercel.json` 不再声明 `crons`；
- 五条 route 共用一个常量时间 Bearer 认证 seam；production composition 与各 route 回归必须同时证明
  缺失/错误 Bearer 为 401、零 worker 调用，并且 401 与成功响应都固定 `private, no-store`；
- `supabase-cron-operations.test.ts` 静态审计扩展、Vault、配置失败关闭、私有权限、精确 allowlist、请求
  header、timeout、固定任务集合和重跑去重语义；
- Hosted 控制面回归锁定 exact operations SQL hash、clean `HEAD==upstream`、10 秒 Git 与 30 秒 psql
  上限、official CA→固定管理员 Keychain account 顺序、12–512 byte 密码、继承 secret 拒绝、一次性
  `0600 .pgpass` 和 strict LF parser；
  transaction 内插入 `DROP TABLE` 仍保留旧 `BEGIN`/`COMMIT`/五次 schedule 浅形状的变体必须因 hash
  不匹配失败；
- API full、strict typecheck/build、目标 lint/format、instructions/architecture 必须通过；SQL 没有
  Prettier parser，以静态契约测试、diff review 和后续真实 Supabase 验收覆盖。

候选 `1caf9dc…` 的 focused 回归 23/23、runtime/Cron 零 I/O plan、继承 secret 的 package entry 失败门、
完整 `pnpm verify:macos` 与 GitHub Cross-platform quality run `32970024964` 均通过；该 run 的
`headSha` 精确为上述完整 SHA，`macos-quality` 与 `windows-quality` 均为 success。独立审查没有发现
P0/P1/P2。自动证据仍不代表真实 Hosted 已连接或 Cron 已安装。

本阶段完成只能标记为“调度适配已实现、真实部署待处理”。正式验收仍需要独立部署任务在受控环境中：

1. 经 exact confirmation 运行受控 apply；证据必须显示完整 SQL 两次均成功，postflight 始终恰好五个
   任务；
2. 等待至少两个周期，确认五个 route 均返回预期状态且无 secret/正文泄漏；
3. 分别制造一次 401、5xx 和网络超时，确认下一周期恢复且业务状态机没有重复费用或越权；
4. 核对 Vercel Function 时长、调用量与 Supabase Cron/pg_net 诊断；
5. 完成 Supabase Free 暂停、无自动备份，以及 Vercel Fluid/120 秒配置的真实上线核验。

Phase 45 只关闭仓库内 Function 执行模型与时长配置缺口；Dashboard 和实际部署仍须按
`vercel-fluid-function-duration.md` 核验。

## 6. 官方依据（2026-08-21 复核）

- [Vercel Cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- [Vercel Hobby plan](https://vercel.com/docs/plans/hobby)
- [Vercel Functions duration](https://vercel.com/docs/functions/configuring-functions/duration)
- [Vercel Fluid Compute](https://vercel.com/docs/fluid-compute)
- [Supabase Cron](https://supabase.com/docs/guides/cron)
- [Schedule Edge Functions with pg_cron and pg_net](https://supabase.com/docs/guides/functions/schedule-functions)
- [Supabase pg_net](https://supabase.com/docs/guides/database/extensions/pg_net)
- [Supabase Free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)
- [Supabase backups](https://supabase.com/docs/guides/platform/backups)
