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
  `maxDuration` 固定为 120 秒。静态配置不替代 Dashboard/部署核验；当前 hosted acceptance 已回读 Fluid
  Enabled、`sin1` 和 Latest `/index` Node.js 24.x / `≤120s`。Observability 区分 90 秒应用 abort 与平台终止
  仍必须随获批的真实 Cloud DeepSeek 请求完成，不能由空页面推导。
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

### Hosted acceptance 自动发布 SOP

完整的迭代、测试、候选冻结、发布、恢复与交付边界以
[`hosted-iteration-release-sop.md`](hosted-iteration-release-sop.md) 为当前入口。本节保留协调器的执行细节。

Hosted acceptance 的常规代码发布由一个可恢复协调器串行完成，入口固定为：

```bash
pnpm acceptance:hosted:release:plan
pnpm acceptance:hosted:release:status
pnpm acceptance:hosted:release:advance
pnpm acceptance:hosted:release:recover
```

`plan` 为零 I/O；`status` 只读当前 clean candidate 与 clone-local state。`advance` 是需要单独明确批准的
远端变更：它绑定当前 `codex/settings-configuration` 的唯一 clean commit，运行完整
`pnpm verify:macos`，只推送该 SHA，再以 `candidate_sha + release_id` 派发唯一 Cross-platform quality
workflow。只有同一 SHA 的 macOS/Windows job 都成功后，协调器才把 Hosted API 的三个固定公开能力值
设置为 Store `1.0.0` / enabled / 固定 acceptance Extension ID，然后严格按 API Ready → Web Ready 顺序
创建 exact-SHA production deployment，最后回读两个 deployment identity、API health、Extension CORS
和 Web deployment metadata。不会并行部署 API/Web，也不会依赖 Vercel Git 自动部署。

每个边界写入 ignored 的
`artifacts/hosted-release/hosted-acceptance-<candidate-sha>/state.json`；目录为 `0700`、文件为 `0600`，
只包含 SHA、release/workflow/deployment ID 与 phase，不含 Token、环境变量或响应正文。在
CI dispatch、环境 upsert 或 deployment create 这类“请求可能已成功但本机尚未记账”的边界发生响应错误时，
同一次 `advance` 会先做最长一分钟的只读精确身份对账；只在找到唯一同 release/SHA 对象或环境值精确一致
时自动续跑，绝不重发不确定写入。进程真正中断、证据仍不可见或找到多个时才失败并保留不确定 phase，
随后只有 `recover` 可继续对账，不能盲目重跑 `advance`。

该协调器不执行 migration、backup、Cron、DeepSeek 请求或 Chrome 旅程，也不把部署完成解释为业务验收
完成。Vercel Token 只从 login Keychain 进入 Authorization header；任何旧明文 secret 环境变量都在外联
前失败。首次真实发布前仍需提交本地候选并取得本次 push/deployment 的明确批准。

发布完成后，验收用户在同一 exact SHA 运行：

```bash
pnpm acceptance:hosted:store:build
pnpm acceptance:hosted:store:status
```

随后在 Chrome `chrome://extensions` 开启开发者模式，选择“加载已解压的扩展程序”，加载
`apps/store-extension/dist`。页面显示的 ID 必须为 `hoijjhgcckfhbcefoclgbhkgninnkknd`；再登录
`https://app.acceptance.seen-said.cn` 并按 Web 配对流程连接。该 acceptance profile 与 Chrome Web Store
release manifest 隔离，不表示已上架，也不安装或替换 Classic Native Host。

### Hosted R3-C 与 Cron 同源引导

Vercel Sensitive 值不能解密回读，密码恢复、R3-C 与 Cron 不再要求操作者手工复制 `CRON_SECRET`。
首次 Cron 尚未安装时，用户先在 `/recover` 只提交一次恢复请求；公开 202 只表示任务已接受，不表示邮件
已投递。固定顺序为：

```bash
pnpm acceptance:hosted:cron:bootstrap:plan
pnpm acceptance:hosted:cron:bootstrap:provision \
  --confirm-provision-hosted-cron-secret-for-bootstrap-kpadiulxkgckskcfydry
pnpm acceptance:hosted:release:advance
pnpm acceptance:hosted:cron:bootstrap:recovery:deliver \
  --confirm-deliver-hosted-password-recovery-after-secret-release-kpadiulxkgckskcfydry
# 用户打开最新恢复邮件并完成改密
pnpm acceptance:hosted:cron:bootstrap:deliver \
  --confirm-deliver-hosted-r3c-after-secret-release-kpadiulxkgckskcfydry
# 用户确认恰好一封 password-reset-completed 安全通知且无正文告警
pnpm acceptance:hosted:cron:status
pnpm acceptance:hosted:cron:apply \
  --confirm-apply-hosted-supabase-cron-after-r3c-and-vercel-continuity-kpadiulxkgckskcfydry
```

provision 只接受“R3-C 为空且恰好一个仍有效、可 claim 的 recovery”或“恰好一个可 claim 的 R3-C”，
并要求 Cron 精确 absent；它要求当前 clean/pushed/disarmed exact SHA 尚无 release state，持有 release lock
完成 Vault→Vercel upsert 后才写带随机 `releaseAttemptId` 且
`provenance=cron-bootstrap-provision` 的 schema-v3 `candidate-recorded`。后续 release
必须从该 state 以 `forceNew=1` 新建 metadata 精确匹配该 attempt 的 exact-SHA API deployment 并推进到
`complete`；旧同 SHA/release deployment 不匹配 attempt，不能复用；只有 create 响应丢失后才按 attempt
回读对账。recovery 与 deliver 只接受 bootstrap-provenance schema-v3 complete，并在读取 Vault 前重新核对
同一 SHA 与 runtime attestation；普通 release 与 legacy schema-v1/v2 complete 仅保留 release status 只读
兼容。随后分别调用正常
产品 worker，要求首次 `sent`、重复 `idle` 并以独立只读聚合确认终态；
already-sent 恢复只做一次 idle 探针，不重发。恢复邮件完成改密后才会产生 R3-C。用户确认最终安全通知
收件后，Cron status 才应为 preflight ready，随后 apply 执行两次完整事务和独立 postflight。任一步不确定
都回到只读聚合/status，不能打印 Vault 值、邮箱/flow、手贴 SQL 或盲目重发。

### Hosted acceptance foundation 运行手册

首次使用任何 Hosted/Vercel 运维入口前，在 macOS login Keychain 配置四项固定基础设施凭据：

```bash
pnpm acceptance:hosted:credentials:configure
pnpm acceptance:hosted:credentials:status
pnpm acceptance:hosted:credentials:diagnose
```

service/account、轮换、删除、非 macOS 行为和授权边界见
`hosted-credential-operations.md`。凭据 `present/available` 不授权任何远端读取、migration、backup、
restore、Cron、deployment 或 smoke；各命令原有确认与用户批准门保持不变。

`pnpm acceptance:hosted:bootstrap --plan` 只检查固定执行入口并输出无副作用结论，不连接远端。实际
foundation 只允许 project ref `kpadiulxkgckskcfydry` 的 Singapore transaction pooler，并要求精确确认参数
`pnpm acceptance:hosted:bootstrap --confirm-hosted-foundation-kpadiulxkgckskcfydry`。管理员与 application
role 密码分别读取固定 Keychain account；不得放入参数、环境、文档、日志或聊天。application 密码在
Vercel project 创建后仍只进入部署平台 secret store；脚本不创建长期本机 secret 文件。

hosted 管理脚本与 Vercel application runtime 固定使用 transaction pooler `6543`；只有 application
隔离验证器使用 session pooler `5432`，从而让同一个 psql 连接在两个已提交事务中确定落到同一 backend。
两类命令行 DSN 均固定 `/postgres?sslmode=verify-full`。所有 Hosted 数据库 consumer 都由共享 fixed-URL
模块从 Supabase 官方 Singapore CA 地址有界读取并严格校验 PEM，调用者不准备 CA environment。脚本只把 CA 写入权限
`0600` 的临时 root certificate，强制 `PGSSLMODE=verify-full` 与 `PGSSLROOTCERT`，并在退出时删除；调用者
不能降级。Vercel 运行时使用
`HUAYI_DATABASE_TLS_CA_BASE64`，由 postgres.js 显式设置 CA 与 `rejectUnauthorized=true`。只设置
`sslmode=require`、关闭 hostname 验证或依赖系统根证书都不满足门禁。SQL 不使用 `pg_stat_ssl` 证明客户端
TLS：经 Supavisor 时它观察的是 pooler 到 PostgreSQL 的 backend 链路，不是 psql 到 pooler 的客户端链路。

当前仓库脚本的 canonical source set 已更新到完整 15 条 migration。首次 foundation bootstrap 的同一事务还
验证 42 张 public 表、2 张 private 表、33 张 tenant forced RLS 表、三个 NOLOGIN/NOBYPASSRLS 迁移角色，
以及 Auth/profile/admin/invitation 空状态。当前 Hosted 已是非空 acceptance 状态且第 15 条 ACL hardening 已
应用；不得重跑 pristine foundation verifier 或 bootstrap。Phase 91 pre/rebuild/post 是历史候选上的不可变
恢复证据，当前 HEAD 推进后 `current=false` 不构成重捕理由。Storage 只允许完全空，或允许重跑时
已经存在唯一 private `account-exports-acceptance` bucket 且无对象；任何部分状态或额外资源失败。
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

写入后使用已配置的管理员 Keychain account 运行
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

管理员 verify 失败时，可在相同 CA 与管理员 Keychain account 下运行
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
`Hosted first Operator status: empty.`。这是 0012 后的历史 foundation 检查点。Phase 72 后 0013 已作为
第 13 条 migration 应用，First Operator 已恢复并完成，最终 status 为 `completed`；当前非空状态不得再
运行要求空 Auth/profile/admin/invitation 的 pristine foundation verifier。Vercel、DNS、Auth、SMTP、应用
deployment 与邀请状态仍必须读取各自后续证据，不能由历史 foundation 结果代替。

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

Phase 67 的历史检查点为 API 10 条 Production deployment、Latest
`DyqRzj5UMN8BRpSeZyohXprnAkaT` / source `7577cdd7658fe966e85e8c8b4346e3291089e4e1`、Web 尚无
Production deployment；它只说明当时的 database runtime 门。当前 deployment/count/disarm 状态以
`pnpm acceptance:hosted:deployment --plan` 为准，不能用该历史快照覆盖。运行态复核必须分层：

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

远端在 Phase 52 时已经实际推送完整 12 条 migration，diagnostic 的 `first_operator_empty` 与 0012
columns/constraint/functions/trigger 均为真；固定 Operator status CLI 当时返回 `empty`，修正版只读
foundation verify 通过。随后 0013 已作为第 13 条 migration 实际应用，首张邀请账号已恢复并完成 First
Operator，最终 status 为 `completed`。不得重跑 migration 或 foundation bootstrap，也不得重新发行
BootstrapInvitation；真实 `/admin` 密码重新认证与四区只读复核也已经完成。

Phase 91 status/pre/rebuild/dry-run/apply/post 与 API→Web 串行 one-shot 已执行；不得沿用 Phase 53 的静态首次
部署顺序，也不得从已经完成的收件人/普通邀请步骤重新开始。Phase 91 等价历史 completion closure 已从不可变
evidence 独立验证并冻结。当前依赖链固定为：固定脱敏只读 Hosted snapshot → 收紧模板/redirect 自动门与注册
错误引导 → 在保留现有账号的前提下决定原邀请恢复或另行批准替代邀请 → scanner-safe 六位 OTP/Auth SMTP → R3-C
真实投递、重复与无正文告警 → 五项 Cron → 受审计 kill-switch 切换、一笔获批 Cloud DeepSeek 应用路径请求
和账本对账 → 恢复 kill switch → 目标网络、数据权利、双平台 Chrome、外部词库与自然使用/发布收口。用户密码、
Cookie、Token 与 secret 不进入自动化或发布证据。

2026-08-28 的固定脱敏 snapshot 已把当前普通注册锁定为：唯一 expired ordinary invitation、唯一
bound-expired claim、唯一 expired flow、同一未确认 Auth user/唯一 email identity，且账号与学习数据均为零。
因此不得创建替代邀请或删除 Auth user。forward-only 0022 只允许 API 使用原 invitation token，在该精确
状态下把原 claim/flow 续到同一最多 15 分钟的确认窗口、invitation 续到最多 30 分钟的 Provider 重试窗口并
轮换 flow；先完成独立备份、22-chain rebuild、
只读 pending status、exact dry-run 与受控 apply，随后重新部署 API/Web，最后才单独批准一次 OTP 邮件。

Phase 92 的固定执行顺序如下；每一条真实 Hosted 命令都需要单独批准，且含管理员密码的命令只在普通
macOS Terminal 中运行：

1. `pnpm acceptance:hosted:phase92:migration:backup:executor:pre:readiness`；
2. `pnpm acceptance:hosted:phase92:migration:backup:capture:pre`；
3. `pnpm acceptance:hosted:phase92:migration:backup:executor:rebuild:readiness`；
4. `pnpm acceptance:hosted:phase92:migration:backup:rebuild`；
5. `pnpm acceptance:hosted:phase92:migration:backup:preflight`；
6. `pnpm acceptance:hosted:migration:0022:status`，只接受 `pending-exact`；若为 `uncertain`，只能运行
   `pnpm acceptance:hosted:migration:0022:status:diagnose`，不得重试 apply；
7. `pnpm acceptance:hosted:migration:0022:dry-run`，只接受唯一
   `20260828010000_password_signup_expired_invitation_recovery.sql`；
8. 再次单独批准后运行 `pnpm acceptance:hosted:migration:0022:apply`；未得到 verified completion 时先回到
   第 6 步，只读判定状态；
9. applied-exact 后依次运行
   `pnpm acceptance:hosted:phase92:migration:backup:executor:post:readiness`、
   `pnpm acceptance:hosted:phase92:migration:backup:capture:post` 和
   `pnpm acceptance:hosted:phase92:migration:backup:complete`；
10. 为同一个 exact SHA 依次运行
    `pnpm acceptance:hosted:phase92:deployment:one-shot:preflight`，再分别批准 API-only arm
    commit/push、`api:arm:observe`、API-only disarm commit/push、`api:disarm:verify`、Web-only arm
    commit/push、`web:arm:observe`、Web-only disarm commit/push 与 `web:disarm:verify`。Phase 92 使用独立
    `phase-92-0022-state.json`，不得覆盖或续写 Phase 81 one-shot state；其 preflight 固定要求 Phase 91
    终态 API/Web 非 Canceled 为 17/10，latest 分别是
    `da733e172cc5859a4b9aea61c2e87a239e6843ed` / `dpl_AWUiTdYGgmVHZ127xqGAVhQb2zCd` 与
    `699fbe6c134c0b83347e0de3ce7c76dc4d520790` / `dpl_J6vtHUqfkstdGZ5w1yZJyVbhF6Yc`；
11. 最终 Web disarm commit 已推送、工作树干净且 `HEAD==upstream` 后，运行只读
    `pnpm acceptance:hosted:phase92:migration:backup:historical:verify`。它必须重验原 pre/rebuild/post 的
    `0700/0600`、dump hash、同一历史 candidate、post 时间边界以及 candidate 为当前 HEAD 的 ancestor；
    不连接 Hosted、不重捕或改写 evidence，也不倒推原 `backup:complete` 当时是否留下 receipt；
12. 双项目均验证 disarmed 且第 11 步通过后，才可单独批准在现有 join 页面点击一次“重新发送六位验证码”。用户只在邮箱
    与浏览器中读取、提交 OTP，不把 OTP、邮件正文或邀请 fragment 发给 Codex；
13. 注册完成、退出并用原邮箱密码重新登录后，在普通 macOS Terminal 运行
    `pnpm acceptance:hosted:identity:snapshot`。收口至少要求唯一普通邀请已 consumed、唯一 claim finalized、
    唯一 registration flow consumed、Auth user confirmed、email identity/profile/password/quota 精确，且
    `account_finalized_exact|t`、`safe_route_state|account-established`。任意第二邀请会强制收口失败。

pre/rebuild/post 必须来自同一 clean pushed candidate；Phase 91 与 DeepSeek backup 即使有效，也不能替代
Phase 92 evidence。migration-time preflight/completion 仍要求 candidate 为当时 current HEAD；后续部署提交
推进 HEAD 后，`current=false` 不会破坏不可变 evidence，只能由第 11 步的祖先链历史门收口。任何一步失败
都保留原目标和固定错误，不手工拼接 SQL、不盲目重试 apply。

Hosted DeepSeek Phase E/F 已在提交 `d9ffb4a03c984d2f94c37031660a146068f31a3a` 收口；exact-SHA
Cross-platform quality run `33076976013` 的 macOS/Windows 两 job 均成功。Phase 91 的 15-file
backup/rebuild 仍是 0015 的历史不可变证据，绝不能授权或证明 0016–0021。后续独立
`hosted-deepseek-0016-0021` 离线恢复/migration 控制面按 `hosted-deepseek-migration-batch.md` 固定 pre head
0015、21-chain rebuild/post、三态 status、六文件 dry-run 与 guarded apply；当前这部分仍是未提交工作树，
没有新 exact SHA/CI，也没有运行真实 readiness、backup、rebuild、status、dry-run 或 apply。真实
private-port loader 仍不存在。当前不得手工调用 0021 functions、拼接 SQL receipt，或把离线 PGlite/fake
HTTP 结果记作 Hosted 验收；新控制面提交推送并完成 exact-SHA 双平台门后，所有真实动作仍须逐项明确批准。

Phase 81 已在唯一普通邀请的真实注册邮件中发现 Hosted Email OTP length 为 8，而产品契约固定 6。用户只
授权把该字段保存为 6；独立重新加载确认 6、expiry 仍 3600，其他 Auth/SMTP/DNS/environment/secret 未改
且未发送新邮件。今后每次真实邀请前先运行 `pnpm acceptance:hosted:auth:status`；它失败时停止，不得截取
旧码或整份 push Auth config。固定失败文案无法区分本地 PAT、HTTP、响应结构与 OTP 漂移；只能运行
`pnpm acceptance:hosted:auth:diagnose` 做同一固定 GET。该入口固定输出 Token 格式、请求到达、HTTP 状态、
JSON record、OTP 长度分类与最终契约六项，不输出原始响应或其他 Auth 配置；诊断完成本身固定 exit 0，
必须读取 `contract_exact`。`token_format_exact|f` 与 `request_reached|not_run` 表示零网络，不得据此重试
apply；只有 `otp_length_state|six`、`contract_exact|t` 后再跑正式 status，status 通过才可继续。
0014 的唯一 dry-run 入口已经实现。2026-08-25 用户运行真实入口后提供的
Supabase child transcript 精确包含 non-mutating header、remote connection marker、唯一
`20260824010000_password_signup_otp_resend.sql` 与 finished marker，匹配仓库严格 parser；据此记录本次
dry-run 已完成且数据库未修改。用户提供的是 raw child transcript，不把未提供的 wrapper 固定成功行写成
已观察证据：
`pnpm acceptance:hosted:migration:0014:dry-run` 只接受固定 Singapore project 与
`20260824010000_password_signup_otp_resend.sql` 的内置 confirmation；拒绝继承的 `PGPASSWORD` /
`SUPABASE_DB_PASSWORD` 后，才读取固定管理员 Keychain account。它固定调用本仓库 Supabase CLI、管理员
transaction pooler `6543`、`db push --dry-run --skip-vault --db-url`；不得借用只供 application 隔离 verifier
使用的 session pooler `5432`。用户无需准备 CA 环境变量：密码输入有效后、
Supabase child 启动前，入口内部只从 `hostedAcceptanceCaCertificateUrl` 的固定 Singapore 官方 HTTPS URL
获取公开 CA；固定 GET、禁止 redirect、10 秒/16 KiB 上限，并要求 200、final URL 精确、fatal UTF-8 与
单一严格 PEM。固定 URL 支持官方 CA 轮换，不长期 pin 某一次证书 digest。URL 与 child 环境同时强制
`sslmode/PGSSLMODE=verify-full`，CA 只进入随机私有目录内的 `0600 root.crt` 和 child
`PGSSLROOTCERT`；密码只进入同一私有目录的 `0600 .pgpass`，child 仅取得 `PGPASSFILE`，不进入
URL、argv、环境或输出。任何 CA 下载、
临时文件、spawn、timeout、overflow 或 cleanup 失败都零成功回执并固定失败，不转发原始 stdout/stderr；
只有临时目录已创建的路线才有可删目标，并一律尝试删除。若 `rm` 自身失败，只能记录 cleanup attempted，不能宣称目录已删：按本机
cleanup incident 处理，在重试前人工检查并清理临时目录下固定 `huayi-hosted-0014-ca-*` 前缀。该残留若
存在，必须按潜在 secret incident 处理，因为目录可能含临时 `.pgpass`；不得读取或打印其内容。Keychain
缺失、锁定、拒绝或无效时固定失败且不会启动 Supabase。child stdout/stderr
分别只允许五条固定完整行的 canonical 子序列；跨双通道的 multiset 必须精确包含 dry-run header、connection
marker、list header、唯一 0014 与 finished marker 各一次，且每个非空通道必须以单一 final newline 结束。
两个 pipe 的全局实时 interleaving 不可确定，契约只验证每个通道的 relative order，不宣称恢复了全局发送
顺序。mid-line fragment、CR、blank、ANSI、duplicate/extra/missing/reversed line 或其他 migration 均失败
关闭；通过后 wrapper 才在自身 stdout 输出固定成功消息。dry-run 不写数据库，也不能代替 pre
backup/rebuild/preflight 或授权 apply。
若真实入口只返回固定失败，先运行
`unset PGPASSWORD SUPABASE_DB_PASSWORD && pnpm acceptance:hosted:migration:0014:diagnose`。该命令从
Keychain 读取同一个管理员密码，只执行官方 CA GET、固定只读 `SELECT` 与同一个 non-mutating dry-run；连接
探针同时固定 `connect_timeout=10` 与 15 秒 child 上限。输出只包含九条固定 verdict：连接 exit class、连接
输出是否精确、dry-run exit class、stdout 是否为空、stdout/stderr 行是否分别属于 allowlist、跨通道行
multiset 是否精确、每个通道 relative order 是否精确，以及最终 transcript predicate。连接失败时 dry-run
不运行且后七项固定为 false；
任何异常只显示一个 allowlisted stage。禁止改用 `--debug`、复制原始 stderr 或把 Supabase CLI exit 1 解释成
psql client-fatal。该诊断不生成备份证据，也不授权 0014 apply。最终 6543 ACL 分解已经确认 0014 完整应用，
多余权限精确来自 `anon`、`authenticated`、`service_role`；因此下面的 0014 apply 段落只保留为历史
runbook，不得再次执行。
实际 apply 也不得使用手工 Supabase 命令。只有真实 dry-run 已通过、pre capture 与 rebuild evidence 已生成且
`pnpm acceptance:hosted:backup:preflight` 对当前 clean HEAD 通过，并取得独立写入授权后，才运行
`pnpm acceptance:hosted:migration:0014:apply`。该入口在读取秘密前验证 preflight；随后用同一密码/CA 再次
dry-run 唯一 0014，mutation 前第二次验证 preflight 和固定 migration mirror SHA-256，才调用固定
`db push --yes --skip-vault --db-url`。apply exit 0 后必须通过只读 postflight，精确证明完整 14 条 canonical
migration chain、`bound_email` column/check、两条函数 identity 与 exact ACL，才输出固定成功。任何 apply/
postflight 失败只返回“不要重试，先检查远端状态”；此时禁止盲目重跑。即使成功，仍须另行批准 post capture
并由 `pnpm acceptance:hosted:backup:complete` 关闭批次后才能部署。
以下是 **Phase 81 / 0014 已中断批次的历史入口**，不得再作为当前动作运行。当时先运行零 I/O 的
`pnpm acceptance:hosted:backup:plan` 与 `pnpm acceptance:hosted:backup:executor:plan`；executor 已固定唯一
PostgreSQL 17.6.1.159 OCI index，但
完整 platform lock 现已由 `pnpm acceptance:hosted:backup:platform-lock:verify` 在零 Docker/零网络下校验：
14 个 CLI start service 精确为 11 active + 3 disabled，active image 同时固定 index 与 amd64/arm64 manifest。
CLI cache miss 会主动 pull，因此普通 `supabase start` 仍禁止；当前 11 镜像已按 digest 获取并完成本机
local-only inspection，Phase 86 writer 也已落地。tracked runbook 不记录 ignored evidence 是否存在、有效或
绑定当前 HEAD；只以 `pnpm acceptance:hosted:backup:status` 的固定 verdict 判断。该历史批次执行时的
pre/post capture 曾要求 TTY 输入管理员密码；当前同一受控消费者已改为固定管理员 Keychain account，
内部 CA 获取失败发生在 Keychain read 前，且调用方不准备 CA env。
当时先运行 exact readiness；只有其通过且单独批准的 pre raw logical dump 与
migrations+fictional-seed scratch rebuild 完成、且
`pnpm acceptance:hosted:backup:preflight` 通过后，才允许经受控 apply 入口应用 0014。真实 Phase 81 已在
0014 postflight ACL 漂移处中断，旧 post capture/completion 禁止重跑。后续 Phase 91 已建立独立
pre-0015/rebuild，应用唯一 forward-only 0015、捕获 post，并完成 API→Web one-shot。独立
`acceptance:hosted:phase91:backup:historical:verify` 已在 clean HEAD=upstream 上重验三份 manifest、实际 dump
hash 与历史 lineage，并返回固定成功输出；原 `backup:complete` 不倒推为当时已运行。三份 manifest 均不可变
且 current=false，不得重捕或手改。
Phase 91 只使用 `acceptance:hosted:phase91:backup:*` 专属 plan/status/readiness/capture/rebuild/preflight/
complete/historical:verify 入口；数据库只使用 `acceptance:hosted:migration:0015:status|dry-run|apply`。不得把 base
`acceptance:hosted:backup:*` 的 Phase 81 evidence 或命令替换参数后复用。当前本地工具链、`2d03bd8`
macOS/Windows CI 与真实 pre/status/dry-run/apply/post、`96e19af` 本地历史 closure 均已完成；新增 shared
脚本的最终双平台候选门继续单列。
scratch 使用的 Supabase PostgreSQL 镜像会在 init scripts 完成前启动临时 postmaster；操作入口不得把早期
`pg_isready` 当作初始化完成。受控 rebuild 使用 BusyBox/GNU 兼容的 `head -n 1`，只在 tmpfs
`postmaster.pid` 首行精确为 `1`、随后 `pg_isready` 成功，且固定 SQL 回读 `auth.users`、
`auth.schema_migrations`、`storage` schema 与两个服务 admin role 均存在时，才完成 Postgres-image
readiness，等待最多五分钟。之后严格依次运行 platform lock 中 digest-only GoTrue `auth migrate` 与 Storage
`migrate-call.js`；两个 runner 共享 networkless scratch namespace，只能经 loopback 访问 scratch，禁止端口、
bind、volume、pull、真实 credential 或 Hosted 网络。再通过包含 `auth.identities`、`storage.objects` 与
`storage.buckets` 的完整 baseline 后才应用仓库 migration。任一超时、输出或 identity 不精确均清理 runner、
销毁 scratch 并保持零 evidence。
执行失败时只允许输出代码路径选择的固定 stage（source validation、Docker target、scratch 生命周期、
auth/storage baseline、完整 baseline、migration ledger/application、fictional seed、final contract、destroy 或
evidence persistence），不得
输出捕获异常、SQL、child stdout/stderr、路径、digest、secret 或 environment。该阶段码用于决定下一条本机
诊断，不代表 rebuild、backup preflight 或 0014 已通过。
再由仍持有原私密邀请的 Web 自动重发；用户不输入 fragment/token，系统不创建第二邀请或删除 Auth user。

普通 Operator 邀请与 BootstrapInvitation 的丢失处理不同。创建普通邀请后只安全传递一次 fragment，并
保留非秘密 invitation ID 作为运营引用；不得把 URL 写入工单、日志或证据。若传递前或传递过程中丢失，
先停止继续创建，在 `/admin` 重新认证并重读邀请列表：目标仍为“可领取”时执行二步撤销，确认列表变为
“已撤销”且出现一条 `invitation.revoked` 无正文审计后，才创建替代邀请；目标已领取/撤销/过期则不再
撤销。若无法凭 ID 与创建顺序唯一定位，撤销所有可能受影响的可领取邀请再重建，不能从数据库、日志、
幂等表或 SQL 恢复 token，也不能留下未知有效链接。Operator 确认发起 DELETE 后客户端立即丢弃当前
一次性 path；响应不确定时关闭该行撤销入口，先 GET 恢复状态，再决定是否仍需撤销，不能盲目重复写或
创建。该流程不使用 First Operator 的 replace-unclaimed。

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

- Hosted 重要批次以 `hosted-important-batch-backup.md` 为权威契约。Phase 81/0014 原固定顺序是
  双 plan/executor prerequisite → 单独批准、可按任一顺序完成的 pre capture 与 isolated rebuild →
  `backup:preflight` → migration
  apply → post capture → `backup:complete` → API/Web 串行 deploy/disarm；readiness/preflight 失败时 migration
  不 ready。真实 0014 已应用但 postflight 因 API-role ACL 漂移中断；当前执行顺序由
  `public-function-acl-hardening.md` 的 Phase 91 pre/rebuild → 0015 → post → 独立 historical closure 接管，旧
  0014 apply、post capture 和 completion 禁止重跑。
- 离线 verifier 只读取
  `artifacts/hosted-important-batch-backups/phase-81-0014`，并验证当前工作树干净、Git HEAD、本克隆
  ignored、目录 `0700`、文件 `0600`、exact manifest、dump size/SHA-256 与 pre/post migration head。它不
  连接数据库、不创建备份，也不允许调用者传 project、路径或 operation。
- 真实 logical dump 是 raw sensitive backup，不能称为脱敏或把它复制到 Git、日志、聊天/工单。capture
  只允许固定 project/session pooler 5432 的 verify-full 管理员、TTY 输入密码、`0600 .pgpass`/CA read-only
  mount、无 tag digest-pinned PG17 database image、固定本机 Unix Docker socket，
  显式 custom-format partial、受验证的 at-rest protection、fsync/atomic rename/manifest-last 与完整失败清理；
  transaction pooler 6543 与 Supabase CLI filtered SQL 不得冒充 postgres-custom。只能运行三个 exact-confirmation
  package entrypoint，不能手写 manifest 或添加动态参数绕过。
- 数据库 archive 只有 coverage contract 通过后才可声称包含 Auth database rows 与 Storage metadata；它不
  包含 Storage object bytes、global roles 或 Hosted provider/SMTP/DNS/Edge/environment config。先证明
  Storage objects 为零，否则必须单独批准 object export。
- Phase 81 的既有 rebuild evidence 只从当时仓库 14 条 migrations + SHA-256 固定 fictional seed 在无网络、
  无端口、tmpfs-only 的 digest-only Supabase PostgreSQL scratch 生成，禁止导入 Hosted 数据；该证据保持不可变
  历史状态。当前 Phase 91 rebuild 使用专属 batch/命令面和完整 15-chain，不能读取、覆盖或冒充 Phase 81
  evidence。两者的固定 GoTrue/Storage migration-only runner 都只共享各自 scratch 的 network namespace 并使用
  虚构本地配置，不增加外联能力；必须在 platform baseline、migration/runtime/seed 聚合通过、确认 Hosted data
  absent 且 scratch 已销毁后再落严格 body-free manifest。静态测试、命令退出 0 或 dump listing 不能单独关闭
  该门。
- production logical-backup restore drill 以 `hosted-logical-backup-restore-drill.md` 为权威契约。它不是
  Phase 81/0014 的新增依赖；当前 Hosted 验收批次关闭并取得独立批准后，才可创建同组织/同区/同 PG major
  的全新临时 recovery project。真实 archive 只能从加密介质流向该隔离 project，禁止复制到 development、
  Git、日志、聊天或工单；本机 networkless fixture 不能冒充 Hosted 证据。
- 首次 production cutover 前、之后每季度以及 PG major/backup format/role graph/Auth-Storage schema 重大
  变更后执行恢复演练：先证明 target empty/outbound absent，再按 exact TOC 恢复 product schema/data、
  Auth rows 与 Storage metadata，以 target-local role/ACL 重建权限；body-free count HMAC、RLS 双租户隔离、
  Auth/admin/application role 与 Storage bytes 门全部通过后删除整个 project。archive 不含 Storage object
  bytes；非零 objects 需要独立加密 export/restore 批准。
- cleanup 必须回读 project 不存在、凭据撤销、临时文件/container 清空并先进入 `target-destroyed`；随后以
  独立 retention evidence 证明 archive 仍在批准保留期，才能进入 `retention-pending`。到已批准 deadline 后
  再删除 archive/manifest/object export 并留下 body-free disposition evidence；若 cleanup 时 deadline 已到，
  可从 `target-destroyed` 直接 close，但仍不得早于 deadline 或缺 cleanup proof。Supabase backup residual、
  evidence/archive retention 和公开隐私期限尚未由用户确认时停止，不能填写猜测数字。
- `pnpm acceptance:hosted:restore:plan` 是 production 控制面的零 filesystem/Git/network/write 命令；独立的
  `pnpm acceptance:hosted:restore:fictional:verify` 只在本机 fixed digest PostgreSQL 17 中创建两个
  networkless/tmpfs disposable fixture，生成、恢复并删除 custom archive，不连接 Hosted 或写 production
  evidence。source verify、target-empty、execute、verify、cleanup、retention verify/close 与 status 都使用固定
  confirmation；`verify` 只接受 `restored-verified`，cleanup 后改用 status/retention contract；
  在 private approved plan 和 reviewed production adapter 安装前固定失败，不能通过 dynamic project/path/env
  绕过。fictional 通过不证明 managed Auth/Storage baseline 或真实 archive 可恢复；安装 adapter 与真实运行
  分别需要再次审查和批准。
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
- 五条内部 route 统一通过 `requireCronBearer` 先固定 `private, no-store`，再做 exact Bearer 与常量时间
  secret 比较；缺失/错误 secret 的 401 也不可缓存且不进入 worker。该 API 门不替代 Vault/API secret 值
  连续、`pg_net` response 或真实两个周期的运维证据。
- Vercel Fluid/Function 时长的仓库契约、应用预算和真实验收见
  `vercel-fluid-function-duration.md`；不得用 Hobby 的 300 秒平台能力放宽 90 秒 Provider deadline。

## Phase 93 受控恢复顺序

0023 已依次完成 pre-backup、隔离 rebuild、dry-run、`pending-exact`、经明确批准的 apply、`applied-exact`、
post-backup 与 completion；pre/rebuild/post 九项均曾为 `present/valid/current=true`。随后 identity snapshot
再次证明唯一 ordinary invitation/claim/flow 为 expired/bound-expired/expired，同一 Auth user 未确认、唯一
email identity、零账号数据，且 `safe_route_state|otp-resend`。这些事实只关闭 migration/backup/identity 门，
不单独授权执行恢复。此后的 Phase 93 deployment diagnose/preflight、API arm/observe/disarm/verify、Web
arm/observe/disarm/verify 已按顺序真实通过；两个项目最终均已 disarm。

部署必须使用独立 `acceptance:hosted:phase93:deployment:one-shot:*` surface 和
`phase-93-0023-state.json`。先运行 `diagnose`，只在其证明 state absent、Git clean/pushed/disarmed、零
in-flight 且候选 API/Web 18/11 baseline 的 latest Ready 分别精确匹配 `ca6f5bd` 与 `b044dda` 后，才可运行
preflight；诊断只额外公开五个固定只读 request stage/status 与 request count，不公开 URL、响应体、token、
deployment id 或 commit。该 18/11 值在代码中仍是由 Phase 92 终态建立的候选，不得用离线测试冒充 fresh
Hosted 证据。
随后仍按 API arm/observe → API disarm/verify → Web arm/observe → Web disarm/verify 严格串行，每个
arm/disarm commit/push 单独批准。Phase 81/92 state 只读共存，不能被读取为 Phase 93 state 或覆盖。
该完整序列已于 2026-09-01 执行并关闭；再次部署仍必须重新开始 fresh diagnose，不得重放旧 state。

部署双关闭后，先运行 `acceptance:hosted:phase93:recovery:readiness`。该命令不接受 email、UUID、invitation
id 或 token，自动选择唯一 ordinary invitation，在单一 `REPEATABLE READ READ ONLY` transaction 内镜像
0023 的 invitation/claim/flow/Auth/email/token-hash、既有 recovery audit 与全部零记录表前置条件，只输出
固定布尔叶和 `eligible|not-eligible`。只有全部叶精确且 verdict 为 `eligible`，Operator 才可在 `/admin`
近期密码认证后二步确认执行一次恢复。不得重试 resend、创建第二邀请、删除 Auth user、把 token 写入工单，
或把新链接显示成功当作注册完成；最终仍需单独只读 snapshot 关闭 acceptance gate。

2026-09-01 的 readiness 已输出全部精确叶与 `eligible_verdict|eligible`。Operator 随后完成密码重新认证并只
确认一次恢复，但 POST 返回 403；页面显示服务器拒绝且没有新链接。只读部署日志证明 reauthentication 为
200、recovery preflight 为 204、recovery POST 为 403；源码复核确认管理员页缓存的 CSRF 已被其后的
`/v1/auth/csrf` 读取轮换。该结果是明确服务器拒绝，不属于可用原 key 恢复的未知响应；不得重试。先完成
fresh-CSRF 客户端修复的离线门、提交/push、exact-SHA 双平台 CI、API/Web 串行重新部署与 fresh readiness，
再请求新的 action-time 用户批准。

fresh-CSRF 修复已以 `882d3d4` 提交并推送，Cross-platform quality run `33499948406` 的 macOS/Windows
job 均为 success。随后只读重跑旧 Phase 93 diagnose 时，credential/Git/disarmed/五个 Vercel GET 均精确，
远端 API/Web 为 19/12 non-Canceled、latest Ready、零 in-flight，但旧 `phase-93-0023-state.json` 已是
`complete`，旧诊断仍固定 18/11 启动基线，因此按合同返回失败且 `state_write_attempted|f`。这不是凭据或
部署故障，也不得删除旧 state、改写旧基线或继续旧 preflight。

重新部署必须改用独立 `acceptance:hosted:phase93:fresh-csrf:deployment:one-shot:*` surface 与
`phase-93-0023-fresh-csrf-state.json`。每个非 plan 阶段先精确验证旧 Phase 93 completion，再以其 Ready
部署固定新的 19/12 baseline；diagnose 同时要求旧 state complete、新 state absent、Git clean/pushed/
disarmed、五个只读请求与远端 baseline 全部精确。该独立控制面已以 `3960389` 提交；fresh diagnose/
preflight 与 API arm/observe → disarm/verify、Web arm/observe → disarm/verify 均已按序真实通过，两个项目
最终均恢复 disarm。fresh recovery-readiness 再次输出全部精确叶与 `eligible_verdict|eligible` 后，Operator
取得新的 action-time 批准并只确认一次恢复，页面显示的新私有链接由用户保存。

用户随后只用该链接打开同一邀请、只重发一次六位验证码并完成注册。completion snapshot 精确得到唯一
invitation consumed、claim finalized、registration flow consumed、confirmed Auth user、active profile、
唯一 password method/current quota、`account_finalized_exact|t` 与
`safe_route_state|account-established`；密码退出重登的产品旅程也已人工通过。重登后的两次 identity snapshot
却都得到 `subject_active_web_session_count|0`，而同一浏览器仍可读取需认证的 `/practice`，并在 `/admin`
进入 Operator recent-auth 门。不得把两侧证据任一方单独解释成“没有登录”或“session 已精确闭环”。

该矛盾只允许通过 `acceptance:hosted:identity:post-relogin:diagnose` 继续只读判定。命令不接受 email、UUID、
Cookie、session/invitation token；它在一个 verify-full、`REPEATABLE READ READ ONLY` transaction 中自动
锁定唯一 finalized ordinary-invitation account，只输出全局/subject/other 的固定 session 计数、owner 与
partition 布尔合同、有限 latest state 和有限 verdict。`subject-active` 表示目标账号数据库侧存在唯一 full
active session；`other-active-only` 表示活动 session 只属于其他账号；`no-active-session` 表示当前数据库中
没有活动 session，需继续核对 API runtime database；其他 drift/multiple/non-full verdict 均失败关闭。本
诊断不写数据库，不要求用户退出当前会话，也不授权任何修复或 mutation。

仓库提供 Phase 93 专属的 plan/preflight/readiness/pre-capture/rebuild/status/dry-run/apply/post-capture/
completion/historical completion 命令，统一位于 `acceptance:hosted:phase93:migration:backup:*` 与
`acceptance:hosted:migration:0023:*`。`status` 只返回 `pending-exact`、`applied-exact` 或 `uncertain`；
`uncertain` 必须停止 apply，并仅用 `acceptance:hosted:migration:0023:status:diagnose` 的 allowlisted predicate
诊断。上述 0023 migration/backup、Phase 93 两轮 Vercel one-shot、fresh recovery readiness、同一邀请
token recovery、六位 OTP 注册、completion snapshot 与密码重登均已有真实结果。当前唯一未闭环的是
post-relogin Web session 的 snapshot/API 证据矛盾；先运行上述脱敏只读诊断，禁止为刷新证据再做恢复、
再发 OTP、创建邀请或删除 session。
