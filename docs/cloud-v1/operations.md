# 语见 Cloud V1 运营与故障恢复

## 环境

- `local` 使用 fake DeepSeek/fake mail 和本地临时 Postgres/Supabase；不得读取开发者真实账号秘密。
- `preview` 使用独立 Supabase project、OAuth callback、API/Web origin、邮件域和平台小额度；数据不能
  与 production 共用。
- `production` 的 Web/API 是独立 Vercel project，数据库迁移由审批后的 CI job 执行。每个环境启动
  时只校验必需变量名和格式，不输出值。
- API project 必须从 `apps/api/vercel.json` 应用 `fluid: true`，并把唯一 `src/server.ts` Function 的
  `maxDuration` 固定为 120 秒。静态配置不替代 Dashboard/部署核验；部署后必须确认 Fluid 已启用、生成
  Function 上限为 120 秒，并在 Observability 区分 90 秒应用 abort 与平台终止。
- Cloud API 运行时固定 Node.js 22 或更高版本，以满足当前 Supabase SDK 的运行时约束；这不改变
  Classic workspace 仍保留的 Node.js 18 工具链下限。

秘密至少包括 Supabase URL/anon key/service role、Web session encryption key、token hash pepper、
DeepSeek key、Google OAuth 和邮件凭据。生产值只存在部署平台 secret store，按供应商事故、人员
变更或疑似泄露轮换；Extension/Web 构建扫描不得包含它们。

公开 API 配置还必须包含 `HUAYI_STORE_EXTENSION_ID` 与
`HUAYI_MIN_SUPPORTED_EXTENSION_VERSION`。前者必须等于本次 Cloud release audit 的
`HUAYI_RELEASE_EXTENSION_ID`，后者按 API→Web→Extension 发布顺序设置且至少保留当前和上一兼容
客户端；两者不是秘密，但缺失、非法或不一致时发布失败关闭。候选审批把这两个公开值直接传给
`check:cloud-release`，自动验证 ID 相等和候选 Manifest 版本满足最低版本；真实部署仍需核对平台配置。

平台模型组合要求 `HUAYI_DEEPSEEK_API_KEY` 及
`HUAYI_DEEPSEEK_LEGACY_PRICE_VERSION_ID`、`HUAYI_DEEPSEEK_OFF_PEAK_PRICE_VERSION_ID`、
`HUAYI_DEEPSEEK_PEAK_PRICE_VERSION_ID` 三个互不相同的不可变价格 UUID。单价与
2026-08-16T16:00:00Z 生效的 UTC 峰谷窗口属于受审计代码常量，不接受部署环境任意覆盖。新 generation
先按 peak 上限 reservation；紧邻 Provider fetch 的 durable dispatch transition 再用同一个服务端 `now`
选择实际快照并原子持久化 UUID 与 dispatch 时间。数据库 UUID/provider/model/三价任一不符都在 fetch 前
失败关闭。精确边界、旧价和恢复语义见 `deepseek-v4-billing.md`。

## 数据库与发布

- 每个 SQL migration 只前进、可在空库和上一 production schema 上验证；破坏性迁移使用 expand →
  backfill → switch → contract，不在同一发布删除仍被上一客户端读取的字段。
- API 先兼容部署，Web 随后，Extension 最后；`/v1` 至少兼容当前和上一 Cloud Extension。低于
  `minSupportedExtensionVersion` 的客户端失败关闭并显示升级入口。
- 回滚优先回滚 Web/API 代码并保留向后兼容 schema；数据库只通过新的修复 migration 前进，不执行
  未经验证的生产 down migration。

## 模型与额度

- DeepSeek 模型 ID、上下文、JSON、usage 和价格在上线前以官方文档和经批准 smoke 核验。价格变化
  新增代码快照与 `model_price_versions`，不修改历史行；settlement 始终使用 durable dispatch 已持久化
  UUID，不按完成时间重新选择。
- 全局 kill switch 可停止新的平台插件查询、Web 深度分析、学习库语义建议和平台练习生成；进行中的
  请求取消后按实际/保守用量结算。BYOK、本机词库和数据权利端点不受影响。kill switch 不触发
  platform→BYOK 自动 fallback，用户只能在 Web 显式修改以后查询使用的账号模式。
- Operator 在 `/admin` 只能通过受审计、幂等命令切换 kill switch；UI 必须同时显示当前状态和服务器
  更新时间。恢复开关不自动重跑旧失败请求，用户以新幂等键重新发起。权限、无正文概览与状态机见
  `admin-operations.md`。
- 告警只基于无正文指标：五分钟失败率、结构修复率、p95 延迟、小时费用、额度拒绝率、活跃 reservation
  过期和删除任务积压。
- UsageAllowance 是一个账号月度池，但运营账本按 `extension-query-translate`、
  `extension-query-explain`、`web-deep-analysis`、`learning-duplicate-suggestions` 和各 practice operation
  分开聚合；BYOK、StudyCapture
  数据写入和 CloudWordCopy 不消耗模型额度。

## 事故处理

1. 关闭相关写入或平台模型，不删除证据；
2. 撤销受影响 session/secret，使用 request ID 与安全审计定位范围；
3. 禁止把用户正文复制到 issue、聊天、日志或监控；
4. 修复后用 fake 回归和最小经批准 production probe 验证；
5. 记录影响、时间线、数据接收方、费用和用户通知结论。

## 备份、导出与删除

- 上线前确认 Supabase point-in-time/备份策略、恢复演练和残留期限，并同步公开隐私政策。
- 每季度在非生产环境从备份恢复并验证 RLS、行数和不可访问性；恢复样本不得复制真实用户正文到
  开发环境。
- 账号删除任务超过 1 小时告警，24 小时仍未完成升级为事故；session 撤销必须在请求返回前完成。
- AccountDataExport 私有对象在 ready 后设置 24 小时 expiry；签名下载最长 15 分钟且不能越过对象到期。
  当前对象存储没有可信“下载完成”回调，因此任务到期先变为不可下载的 expired，再幂等删除对象；清理
  失败保留内部 object key、告警并重试。下载事件只记录 job ID。
- 数据权利 worker 在 production 由 Supabase Cron 每分钟经 `pg_net` GET 调用并校验 API
  `CRON_SECRET` bearer；每次只 claim 一个 export 和一个 deletion，依赖 DB lease/fencing 与后续周期
  调用，而不是调度器 exactly-once/retry。service-role/cron secret 缺失时 production 启动失败关闭。
- ExtensionQuery maintenance 由独立 Supabase Cron job 每分钟 GET
  `/internal/extension-queries/cleanup`，校验相同 `CRON_SECRET` bearer。每次先以 `SKIP LOCKED` 安全终态化
  最多 100 条过期 running，再硬删最多 100 条到期 terminal；响应和日志只使用两个有界计数。调度失败
  依赖下一周期重试，不假设 exactly-once，且不得由 owner/Web/Extension 身份调用。
- Learning duplicate suggestion maintenance 由独立 Supabase Cron job 每分钟 GET
  `/internal/learning-duplicate-suggestions/cleanup`，只接受相同 `CRON_SECRET` bearer 并固定 no-store。
  一批总处理最多 100 条：未 dispatch 的过期 lease 释放 reservation 并删除旧 request，使相同 owner/key
  可再次显式 claim；已 dispatch 的过期 lease 按预留上限写唯一 failed ledger 并终态失败；到期 terminal
  再硬删。响应只含 `abandonedCount/deletedCount`，不得记录正文、alias map、response、task 或 reservation。
- 密码恢复 worker 同样保留独立 minute job。四项生产调度由管理员显式运行
  `apps/api/operations/configure-supabase-cron.sql` 安装；脚本从 Vault 读取正式 HTTPS API origin 和 cron
  secret、限制精确 path、撤销业务角色执行权，并以固定 job name 重装实现幂等。Vercel
  `vercel.json` 不再声明分钟级 crons；开发/Preview 不自动安装。完整边界、停用与真实验收见
  `vercel-hobby-supabase-cron.md`。
- Vercel Fluid/Function 时长的仓库契约、应用预算和真实验收见
  `vercel-fluid-function-duration.md`；不得用 Hobby 的 300 秒平台能力放宽 90 秒 Provider deadline。
