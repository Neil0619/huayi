# 语见 Cloud V1 运营与故障恢复

## 环境

- `local-acceptance` 使用 Supabase CLI/Docker 的本机 Postgres/Auth/Storage/Mailpit、可重放 migration、
  虚构 seed 和受控首个账号 bootstrap；公开端点只经 loopback 受信任 HTTPS，不得读取开发者真实账号
  秘密或向局域网/公网暴露。
- `hosted-acceptance` 使用独立 Supabase project、Vercel Web/API、自有根域下的
  `app.acceptance`/`api.acceptance` 子域、OAuth callback 和平台小额度；域名未就绪时同源 gateway 仅作
  备用。数据、密钥、账号、Storage、额度和调度不能与 production 共用。
- `seen-said.cn` 在腾讯云注册、实名和续费；权威解析使用 Cloudflare DNS Free，不称为 Cloudflare
  Registrar。Vercel 与 Resend Dashboard 是 CNAME/TXT/MX 值的唯一来源；切换 NS 前先处理旧 DNSSEC/DS，
  Cloudflare Active 后再按其提供值恢复 DNSSEC。
  `notify.acceptance.<root-domain>` 专用于验收 Resend 事务邮件，production `notify` 保留。Supabase Auth
  SMTP credential 与 R3-C HTTP API key 分开保存且仅在 secret store。仓库内 sender、通知 CRON、幂等、
  终态和无正文告警 port 已实现；DNS/verified sender/真实投递与监控目的地通过前仍保持 unavailable。
- `production` 的 Web/API 是独立 Vercel project，数据库迁移由审批后的 CI job 执行。每个环境启动
  时只校验必需变量名和格式，不输出值。
- hosted acceptance 与 production 的 API/Web/Supabase 配置只能使用不带凭据、路径、query、fragment 或
  尾随 `/` 的精确 HTTPS origin；API 与 Web origin 必须不同。API 进程和 Web bootstrap 都在任何网络请求
  前失败关闭，不能通过改用 HTTP、宽泛 base URL 或同 origin 值绕过 Cookie/CORS/OAuth 边界。
- hosted acceptance 必须显示环境和 commit、支持从 migration + seed 重建，并记录每轮用户反馈、修复、
  回归与人工重验。它不能因长期使用自动升级为 production；完整运行与退出门见
  `user-acceptance-environment.md`。
- API project 必须从 `apps/api/vercel.json` 应用 `fluid: true`，并把唯一 `src/server.ts` Function 的
  `maxDuration` 固定为 120 秒。静态配置不替代 Dashboard/部署核验；部署后必须确认 Fluid 已启用、生成
  Function 上限为 120 秒，并在 Observability 区分 90 秒应用 abort 与平台终止。
- Cloud API 运行时固定 Node.js 22 或更高版本，以满足当前 Supabase SDK 的运行时约束；这不改变
  Classic workspace 仍保留的 Node.js 18 工具链下限。

秘密至少包括 Supabase URL/anon key/service role、application 数据库 DSN、base64 编码的 Supabase
数据库 CA、Web session encryption key、token hash pepper、
DeepSeek key、Google OAuth、`HUAYI_RESEND_API_KEY` 和邮件凭据。production 必须设置
`HUAYI_SECURITY_NOTIFICATION_MODE=resend`、固定 from 与 Reply-To；
`disabled-local-acceptance` 只允许三个固定 localhost origin。生产值只存在部署平台 secret store，按供应商事故、人员
变更或疑似泄露轮换；Extension/Web 构建扫描不得包含它们。

公开 API 配置必须显式包含 `HUAYI_STORE_EXTENSION_CAPABILITY=enabled|disabled` 与
`HUAYI_MIN_SUPPORTED_EXTENSION_VERSION`，缺失或非法值在 composition 前失败关闭。`enabled` 还必须
提供真实 `HUAYI_STORE_EXTENSION_ID`，并等于 Cloud release audit 的 `HUAYI_RELEASE_EXTENSION_ID`；
`disabled` 必须省略 ID，API 不开放 Store origin、token 或专用路由。完整 Store 候选只接受 `enabled`，
并自动验证 ID 相等和候选 Manifest 版本满足最低版本；真实部署仍需核对平台配置。

平台模型组合要求 `HUAYI_DEEPSEEK_API_KEY` 及
`HUAYI_DEEPSEEK_LEGACY_PRICE_VERSION_ID`、`HUAYI_DEEPSEEK_OFF_PEAK_PRICE_VERSION_ID`、
`HUAYI_DEEPSEEK_PEAK_PRICE_VERSION_ID` 三个互不相同的不可变价格 UUID。单价与
2026-08-16T16:00:00Z 生效的 UTC 峰谷窗口属于受审计代码常量，不接受部署环境任意覆盖。新 generation
先按 peak 上限 reservation；紧邻 Provider fetch 的 durable dispatch transition 再用同一个服务端 `now`
选择实际快照并原子持久化 UUID 与 dispatch 时间。数据库 UUID/provider/model/三价任一不符都在 fetch 前
失败关闭。精确边界、旧价和恢复语义见 `deepseek-v4-billing.md`。

## 数据库与发布

### 本机验收运行手册

依次运行 `pnpm acceptance:local:doctor`、`acceptance:local:start`、`acceptance:local:migrate`、
`acceptance:local:bootstrap`、`acceptance:local:build` 与 `acceptance:local:dev`。`migrate` 只把已启动
数据库前移到仓库 migration head，不 reset；`bootstrap` 幂等建立本机角色、价格、kill switch 与 private
export bucket。最后一个命令把三个 HTTPS 入口作为脱离当前终端的后台进程启动；用
`acceptance:local:dev:status` 复核 HTTPS 健康，用 `acceptance:local:status` 复核 Supabase 容器。Web、
API、Supabase 固定为 `https://app.acceptance.localhost:8443`、
`https://api.acceptance.localhost:8444`、`https://supabase.acceptance.localhost:8445`。首个用户只通过
`pnpm acceptance:local:invite` 取得一次性 `/join#...` 链接；链接、密码、Cookie 和本机环境文件不得进入
文档、日志或提交。需要停机时先运行 `acceptance:local:dev:stop`，再运行
`acceptance:local:stop`；`acceptance:local:dev:foreground` 只供开发者观察故障，不能作为交付给用户的
持续环境。后台 PID 文件必须 ignored、权限 `0600`，`start/status` 必须使用系统信任 CA 验证三个入口；
已记录进程不健康时 `start` 必须清理并重建。不得直接执行原生 `supabase start`，也不得用 `-k`、放宽
Cookie/CORS 或 OrbStack LAN forwarding 绕过失败关闭。

本机 bootstrap 把 `model_kill_switch` 幂等设置为关闭，只允许固定零网络模拟 Adapter 穿过共享
production 状态机；它不配置或调用真实 Provider。hosted acceptance/production 不运行该 bootstrap，
必须保留各自 Operator 控制和失败关闭策略。若分析失败后数据库出现租约已过期、未 dispatch、未
reservation 的 `running` 请求，只调用既有恢复函数精确终态化；不得 reset、删账号或手工伪造完成记录。

### Hosted acceptance foundation 运行手册

`pnpm acceptance:hosted:bootstrap --plan` 只检查固定执行入口并输出无副作用结论，不连接远端。实际
foundation 只允许 project ref `kpadiulxkgckskcfydry` 的 Singapore transaction pooler，并要求精确确认参数
`pnpm acceptance:hosted:bootstrap --confirm-hosted-foundation-kpadiulxkgckskcfydry`。管理员数据库密码只从
`PGPASSWORD` 读取；新的
application role 密码只从 `HUAYI_HOSTED_APP_DATABASE_PASSWORD` 读取，均不得放入参数、文档、日志或
聊天。该密码在 Vercel project 创建后只进入 secret store；脚本不创建本机 secret 文件。

hosted 管理脚本与 Vercel application runtime 固定使用 transaction pooler `6543`；只有 application
隔离验证器使用 session pooler `5432`，从而让同一个 psql 连接在两个已提交事务中确定落到同一 backend。
两类命令行 DSN 均固定 `/postgres?sslmode=verify-full`。命令行从 Supabase 官方 Singapore CA 地址读取 PEM
到进程变量 `HUAYI_HOSTED_DATABASE_CA_CERTIFICATE`，脚本只把它写入权限 `0600` 的临时 root certificate，
强制 `PGSSLMODE=verify-full` 与 `PGSSLROOTCERT`，并在退出时删除；调用者环境不能降级。Vercel 运行时使用
`HUAYI_DATABASE_TLS_CA_BASE64`，由 postgres.js 显式设置 CA 与 `rejectUnauthorized=true`。只设置
`sslmode=require`、关闭 hostname 验证或依赖系统根证书都不满足门禁。SQL 不使用 `pg_stat_ssl` 证明客户端
TLS：经 Supavisor 时它观察的是 pooler 到 PostgreSQL 的 backend 链路，不是 psql 到 pooler 的客户端链路。

当前仓库脚本在同一事务验证完整 12 条 migration、42 张 public 表、2 张 private 表、33 张 tenant forced
RLS 表、三个
NOLOGIN/NOBYPASSRLS 迁移角色，以及 Auth/profile/admin/invitation 空状态。Storage 只允许完全空，或允许
重跑时已经存在唯一 private `account-exports-acceptance` bucket 且无对象；任何部分状态或额外资源失败。
随后只建立
`huayi_hosted_acceptance_login`、三条固定 acceptance 价格 UUID、显式启用的模型 kill switch 和 private
`account-exports-acceptance` bucket。既有 role 不旋转密码；价格、kill switch 或 bucket 与契约冲突时整笔
回滚。脚本不执行 migration、seed、reset、邀请、Operator 晋升、Provider、Cron、SMTP 或部署。

Supabase 托管 `postgres` 具有管理员能力但不是 superuser；preflight 精确要求当前数据库角色为
`postgres` 且具有 CREATEROLE，不要求或尝试取得 superuser。application runtime 后续使用 Supavisor 时，
用户名按 `<role>.<project-ref>` 组成且密码必须 URL-encode；真实 DSN 只进入 Vercel secret store。

PostgreSQL 17 下，三个 `NOINHERIT` 成员角色的产品直接边必须各自唯一且为
`admin=false / inherit=false / set=true`。`postgres` 作为 CREATEROLE creator 可能因角色创建历史拥有到
四个固定 Huayi role 的 creator-control 边；这些边不要求固定数量，存在时只能为
`admin=true / inherit=false / set=false`。除此之外的直接边、错误 option 或同角色对的重复产品 grantor
全部失败关闭。bootstrap、管理员 verify 与 diagnostic 共用同一 membership SQL 契约，不再按相关边裸
总数判断。

写入后使用管理员进程级 `PGPASSWORD` 运行
`pnpm acceptance:hosted:verify --verify-hosted-foundation-kpadiulxkgckskcfydry`。verify 只执行一个只读
布尔查询并输出固定通过/失败，不显示表计数、UUID 以外的行、密码或 SQL 错误。随后改用 application
role 密码运行
`pnpm acceptance:hosted:application:verify --verify-hosted-application-login-kpadiulxkgckskcfydry`：它必须
在强制 verify-full 与固定 CA 的客户端连接上分别执行权限 contract 与 context contract：六项权限结果证明
application login 当前具备 runtime member 能力且不能在 public 建对象、直接设置 owner context 或切换
postgres；精确的 login→runtime→business/context-setter 角色图、额外 membership 与 ADMIN OPTION 由前置
foundation 管理员 verify 证明，不把它们误归给 application verifier。session pooler 的同一 psql 连接必须让第一个事务提交 owner context，再在同一
backend 的第二事务证明 context 为 NULL。`SET LOCAL ROLE postgres` 只有 psql 精确返回 SQLSTATE `42501`
和 exit code `3` 才算预期拒绝，连接失败不能冒充通过。Vercel runtime 仍使用 transaction pooler `6543`，
不得把验证器专用 `5432` DSN 写入运行时环境。

application verify 失败时，运行
`pnpm acceptance:hosted:application:diagnose -- --diagnose-hosted-application-login-kpadiulxkgckskcfydry`。
诊断先用固定 `SELECT true` 证明 verify-full 客户端连接，再把权限 contract、context contract 与 postgres
越权拒绝拆成固定阶段，只输出 allowlisted `name|fixed-value`；布尔项固定为 `t/f`，四个 exit class 只允许
`ok`、`client_fatal`、`connection_error`、`script_error`、`process_error`、`unexpected_error` 或
`not_run`。它不输出 stderr、SQL、SQLSTATE、PID、密码或动态数据库内容。
`client_tls_verified`、`contract_execution_completed`、`contract_output_valid`、
`context_execution_completed` 与 `context_output_valid` 用于定位失败层级，不能代替正式 verify。

管理员 verify 失败时，可在相同 CA 与进程级 `PGPASSWORD` 下运行
`node scripts/acceptance-hosted-diagnose.mjs --diagnose-hosted-foundation-kpadiulxkgckskcfydry`。该命令只在
`BEGIN READ ONLY` 中输出固定顺序的 allowlisted `name|t/f`，不输出 catalog row、grantor、密码或 SQL
错误；任一 `f` 仅用于定位，不能作为通过证据。完成修复后仍必须重跑正式 verify，不能用 diagnostic
代替门禁。

2026-08-22 用户已执行 foundation bootstrap，随后在 0012 push 前完成过当时版本的管理员只读与
application login 复验；这证明 TLS、application 登录和事务隔离路径当时可用。0012 实际 push 后，新的
只读 diagnostic 显示 migration chain、schema/RLS、价格、kill switch、Storage、空 Auth/identity 与 0012
结构均为真，只剩旧版 `membership_edges_exact` / `membership_options_exact` 为假。根因是旧校验误把
PostgreSQL 17 `NOINHERIT` 产品边要求成 `inherit=true`，并把合法 creator-control 边计入固定总数；这不是
远端 migration 失败或需要修改角色图的证据。仓库已改为上方共享契约；用户随后运行修正版管理员远端
只读复验并得到 `Hosted acceptance foundation verification passed.`，再运行固定 Operator status 并得到
`Hosted first Operator status: empty.`。当前状态为
`applied; corrected PostgreSQL 17 remote verification passed; first Operator empty`。这只关闭数据库
foundation 门，不能单独证明 Vercel、DNS、Auth、SMTP、应用 deployment 或邀请状态；这些门必须读取各自
后续证据。

2026-08-23 应用密码轮换后，最小 application 登录曾通过，但旧组合式 application verify 失败；第一版
诊断确认 `psql_connection_ok=t` 且 SQL 执行未完成，排除“密码错误或重试锁定”。审查同时发现
`pg_stat_ssl` 不是 Supavisor 客户端 TLS 证据，文本函数签名权限探测也可能先触发 schema 名称解析；因此
移除前者、把后者改为固定 catalog OID，并将正式 verify/diagnostic 拆成上述 contract 阶段。用户随后运行
新 diagnostic，22 个固定字段全部符合预期，再得到
`Hosted acceptance application login verification passed.`；application 数据库角色与隔离门现已关闭。
该结果证明修订后的完整 contract，但没有单独重放旧文本探针，因此不把某一个旧表达式伪装成唯一已隔离
根因。首次 Vercel Rotate 的 `HUAYI_DATABASE_URL` 被误写为固定变量名并在 runtime 启动时失败；纠正 Rotate
才使用当前密码、percent-encoded transaction-pooler `6543` 与 `sslmode=verify-full`，并同时取得 dialog
关闭、固定成功回执和 `Updated just now`。验证器的 session pooler `5432` DSN 从未写入 runtime；系统与
浏览器剪贴板在纠正后均已清空。

Vercel API 当前有 10 条 Production deployment 记录，Latest/Current 为 deployment
`DyqRzj5UMN8BRpSeZyohXprnAkaT`、source `7577cdd7658fe966e85e8c8b4346e3291089e4e1`；Web 仍无
Production deployment。API/Web Git deployment 均已关闭。运行态复核必须分层：

1. `/health` 只关闭 custom domain、TLS、进程启动、固定 JSON 与 `x-vercel-id` 门，不执行 SQL；
2. DB-backed smoke 才关闭 application role、CA、轮换密码、RLS/context 与数据库 runtime composition 门；
3. 纠正 Rotate 后 `DyqRzj5UMN8BRpSeZyohXprnAkaT` 已通过前两层；此前包含固定错误值的 deployment 不能
   作为该层证据。

首个无写入 DB-backed 探针固定为 `GET /v1/quota` 加非空随机 `huayi_session` Cookie。精确预期是 HTTP
401、`authentication_required` 与 `The Web session is invalid.`；它会执行 application-role 认证 SQL，
而请求期 DSN/TLS/role 失败归一为 400 `invalid_request`。纠正 deployment 已返回精确 401 并关闭该门；
探针未记录 Cookie，也不能扩大为 tenant context/RLS、Supabase Auth 或 DeepSeek 已通过。

首张 hosted 邀请和首个 Operator 使用 `first-operator-bootstrap.md` 的两阶段协议：先在 API/Web/Auth 已
可用后发行唯一 BootstrapInvitation，用户走正常注册，再由项目管理员 complete 精确绑定账号。离线实现
已通过完整 macOS 门，forward migration 也已完成 dry-run、明确确认和 actual push，不得重跑。不得复用
虚构 seed、手工插入长期假 Operator、接受任意 userId 或新增公开 bootstrap HTTP route。邀请 URL 丢失时
只有零 claim/零 identity 才能走显式 replace-unclaimed；其他状态必须停止调查，不能 reset。

当前远端已经实际推送完整 12 条 migration，diagnostic 的 `first_operator_empty` 为真且 0012 columns、
constraint、functions、trigger 均为真；固定 Operator status CLI 也已返回 `empty`，修正版只读 foundation
verify 已通过。不得重跑 migration 或 foundation bootstrap；API/Web/Auth 可用前仍不得发行邀请。

三个主机名同时解析到 `127.0.0.1` 与 `::1`；每个 HTTPS 端口必须同时建立 IPv4/IPv6 loopback
listener，禁止使用 `0.0.0.0` 或 `::` 代替。若浏览器报告 connection refused，分别运行带本机 CA 的
`curl -4` 与 `curl -6` probe；不能以单一地址族返回 200 宣称入口健康。代码切换仍只使用下述 deploy
协调器，不手工启动第二套进程。`acceptance:local:dev:status` 自身也对三个 URL 分别检查 IPv4/IPv6；
旧 IPv4-only 进程在首次 deploy 前会因此返回失败，这表示候选尚未激活，不表示数据库丢失。

破坏性重建只能由用户在明确接受本机验收数据全部丢失后运行
`pnpm acceptance:local:reset --confirm-local-data-loss`。命令不接受远端、URL、project ref、seed 路径或
其他参数；它会先停 HTTPS，再固定重放全部 local migration 与仓库虚构 seed，随后 bootstrap/build 并
恢复三个 HTTPS health。旧账号、Auth identity、邮件、学习数据和邀请均不可恢复；成功后运行
`pnpm acceptance:local:invite` 取得新的单次链接。失败时不要手工跳过阶段：先运行 doctor、Supabase
status 和 dev status，修复后重新执行完整 reset。普通 start/migrate/bootstrap/build/test 永不隐式 reset。

非破坏性完整停启使用 `pnpm acceptance:local:restart:verify`。该命令不接受参数，会短暂停止三个 HTTPS
入口与本机 Supabase；它在停止前后于数据库服务器内部比较覆盖业务表、Auth、Storage 和 migration 的
不透明持久化指纹，完全一致后才恢复 HTTPS。命令不运行 seed/reset/bootstrap/build，不显示表计数、
digest、用户内容或认证材料。失败后先运行 `acceptance:local:status` 与
`acceptance:local:dev:status`，不要手工启动部分阶段后宣称 persistence 通过。当前邀请注册前运行一次；
注册并创建真实学习数据后再运行一次。

HTTPS 进程启动时固定读取一个 Web bundle 内存快照并只加载一次 API composition。已激活该运行时后，
build/full gate 可以在旧版本在线期间生成磁盘候选，不会改变 8443/8444；用户空闲后只运行
`pnpm acceptance:local:deploy --confirm-local-downtime` 同步 cutover。快照运行时的首次部署也使用同一
命令，由协调器固定执行 runtime verify → HTTPS stop → acceptance build → HTTPS start；旧进程逐请求
读取 `dist`，所以首次 build 必须位于 stop 后。两种更新都不停止
Supabase、不运行 reset/seed/bootstrap/migrate，也不生成或消费邀请。成功后先检查 Web 全页面“本机验收
· 模拟模型”横幅，再验证 API health 和一条模拟分析；横幅缺失或结果未带模拟标记都应停止模型验收。
模拟 usage/ledger/export 不是 DeepSeek 账单证据。

deploy 只接受精确 `--confirm-local-downtime`。任何失败都停止后续阶段；如果已经 stop，则保持 HTTPS
离线，不能启动可能部分写入的 bundle。检查并修复后重跑同一命令；不要用 reset、persistence restart、
手工 Supabase 命令或跳过 build 恢复。CLI 只输出固定成功/失败消息，不转发构建输出或本机材料。

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
- 密码恢复和安全通知 worker 各自保留独立 minute job。五项生产调度由管理员显式运行
  `apps/api/operations/configure-supabase-cron.sql` 安装；脚本从 Vault 读取正式 HTTPS API origin 和 cron
  secret、限制精确 path、撤销业务角色执行权，并以固定 job name 重装实现幂等。Vercel
  `vercel.json` 不再声明分钟级 crons；开发/Preview 不自动安装。完整边界、停用与真实验收见
  `vercel-hobby-supabase-cron.md`。
- Vercel Fluid/Function 时长的仓库契约、应用预算和真实验收见
  `vercel-fluid-function-duration.md`；不得用 Hobby 的 300 秒平台能力放宽 90 秒 Provider deadline。
