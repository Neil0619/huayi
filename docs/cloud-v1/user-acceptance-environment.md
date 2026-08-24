# Phase 47：可用测试环境与用户验收循环

## 1. 决策

Cloud V1 不得从离线自动化门禁直接进入 production。正式上线前必须先提供一个用户可以持续实际操作的
隔离验收环境，并经历“使用 → 记录问题/需求 → 文档校准 → Fresh RED → 最小修复 → 回归 → 重新部署”
循环。只有用户明确确认验收环境中的产品行为已经稳定，才能冻结生产候选。

环境采用两层而不是二选一：

1. `local-acceptance` 是可重建的 Mac 本机持久化环境，用于先让用户高频使用、快速修复和重置数据；
2. `hosted-acceptance` 是第二阶段托管环境，用于验证真实 TLS、Vercel/Supabase、跨设备和持续远程使用。

本机环境不能替代真实托管 Cookie、Vercel Function、Supabase 托管能力和跨设备；云端验收也不能替代
单元/PGlite/Playwright、macOS/Windows 门禁或最终生产演练。

## 2. 当前缺口

Phase 47 启动审计时仓库只有离线自动化夹具和生产构建配置，没有可直接交给用户使用的环境。当前纵切
已补入 pinned Supabase CLI、local manifest、canonical migration 副本一致性门、失败关闭 doctor、
loopback-only runtime、生成式 secret/bootstrap、受信任 HTTPS Web/API/Supabase 入口、一次性本机邀请、
首账号默认额度、私有导出 bucket 和第一条 forward-only migration；
以下尚未完成项继续作为后续纵切输入；本节后续章节保留各次历史检查点，当前状态以本列表和发布证据
第 55 节为准：

- Playwright 的 `web.huayi.invalid` / `api.huayi.invalid` 由本机 route fulfill 提供，不执行 DNS、TLS、
  Supabase、Vercel、真实 Provider 或真实扩展进程；
- 仓库已有固定虚构 seed 与显式授权 reset；真实 destructive reset 已在独立 project/network/ports 的空
  volume 环境执行并完成重建聚合，主验收数据未触碰。密码注册、Mailpit 确认、注册后持久化重启及十一条
  migration 的前向升级也已实际完成；
- API 的 host-only `Secure; SameSite=Lax` session Cookie 与两个独立 Vercel project URL 不能组成可靠的
  跨站浏览器会话；把 Cookie 改为 `SameSite=None` 会引入第三方 Cookie 依赖，不作为修复；
- Store acceptance build 与 API/Web/CSP 配置已经具备，服务器侧 ExtensionQuery、StudyCapture、
  CloudWordCopy 和断开已在 production 本机服务实际通过；真实 Chrome 安装、vault、离线 outbox、UI、
  普通网页/YouTube 与稳定发布 Extension ID 仍待手工验收；
- bootstrap `0001` 与 `0002`–`0011` 均已有 API/Supabase 镜像并在不重置当前库的前提下真实前向升级；
  `0009` 已改为可在 current baseline 后重放，完整链有自动测试和真实 Supabase 空库证据。固定虚构 seed
  与 destructive reset 已真实重建；仍待发布前 production rollback 演练；
- Operator、邀请、三条价格快照、local-only 关闭的 kill switch 和 private export bucket 已有受控幂等
  bootstrap；密码注册已实际建立 Auth identity/profile、password method、当前 UTC 月默认额度和学习样例，
  Google OAuth 仍是独立验收需求；未来 UTC 月默认额度已由数据库按需幂等补齐，管理员当月 grant 不被
  覆盖；
- acceptance composition 已部署明确标识的本机模拟模型，完整经过 production
  quota/dispatch/schema/ledger 且不伪装成真实 DeepSeek；bootstrap 必须把共享 kill switch 关闭才能启用
  该固定零网络路径，hosted/production 不继承该值。分析、候选、学习、练习、历史与 Store 服务端旅程
  已实际完成，真实 Provider 质量/计费仍须单独批准；
- 邮件通知 R3-C 的 23 小时 deadline、8 次上限、持久终态、固定 Resend sender、独立通知 CRON 和无正文
  告警 port 已实现并离线验证；本机 composition 明确禁用外发。hosted sender 域名/DNS、分离 credential、
  Custom SMTP 与完整 API Production environment 已配置；真实 Resend 投递、重复投递观测和告警接收方仍是
  hosted-acceptance 外部门禁，不能被 fake mail、域名验证或配置完成冒充为真实投递完成。

因此当前状态为
`hosted API deployed; runtime DSN rotated; post-rotation runtime and real acceptance pending`。本机核心学习
闭环、持续重启和服务端 Store 契约已通过，托管 Auth 与环境结构也已配置；API 当前 `/health` 可用且 Web
仍未部署，但现有 API deployment 早于 DSN Rotate，不得据此宣称数据库/Provider/Auth 已验收、真实 Chrome
或 production ready。

## 3. 推荐拓扑

### 3.1 本机持续验收层（先实现）

使用固定版本的 Supabase CLI + Docker-compatible runtime 启动本机 Postgres/Auth/Storage/Mailpit。仓库提交：

- `supabase/config.toml`、冻结的 canonical baseline 和后续 forward-only migration 入口；
- 只含虚构内容的 `supabase/seed.sql` 或等价受控 seed；
- `.env.acceptance.example`，只列变量名、格式、生成命令和用途，不含任何真实值；
- `pnpm acceptance:local:start|status|stop` 管理 Supabase，`acceptance:local:migrate` 只执行 forward
  migration，`acceptance:local:bootstrap|build` 生成本机配置和产物；
  `acceptance:local:dev|dev:status|dev:stop` 以独立后台进程管理三个 HTTPS 入口，不能依赖 Codex 任务或
  开发终端生命周期，`dev:foreground` 只供诊断；`acceptance:local:invite` 只在终端返回一次性本机
  注册链接；`acceptance:local:reset` 只在精确数据丢失确认后重建，
  `acceptance:local:restart:verify` 用于非破坏性停启持久化演练；
  `acceptance:local:deploy --confirm-local-downtime` 是唯一代码 cutover 协调器；
- 本机 Node HTTPS adapter 必须按请求头保留真实 Fetch body 语义：GET/HEAD 及没有正数
  `Content-Length`、没有 `Transfer-Encoding` 的 bodyless DELETE 传入 `null`；仅在请求确实携带 body 时
  创建 stream。Store 自断开实际验收必须覆盖首次 DELETE 204、同 proof 重放 204、旧 token 后续 401；
- 固定虚构 seed 只创建 Operator profile/admin role/default quota；幂等 bootstrap 创建数据库 login role、
  三个价格 UUID、私有导出 bucket、local-only 关闭的 kill switch 与生成式本机 credential。真实 Auth
  user、登录方式和邀请
  只能由用户注册/显式 invite 产生，不添加身份后门；重复运行不在 stdout 输出密码、token 或正文；
- acceptance-only API/Web composition 和 Store build profile；本机默认 fake/disabled Provider 且证明零外联，
  不能把 fake 输出展示为真实模型结果；
- Supabase Mailpit 只验证注册/确认等开发邮件。它不是 R3-C sender 或生产投递证据。

Supabase CLI 作为 root devDependency 精确 pin：用途是让 macOS/Windows checkout 使用同一 local stack
schema 和命令；不采用全局 CLI 是为了避免版本漂移，不手写第二套 Docker Compose 是为了避免偏离托管
Supabase。该依赖不进入任何 production bundle，optional 平台二进制由 lockfile 固定；升级时必须重跑
doctor/config 回归和 production dependency audit。安装依赖不自动启动 Docker、拉镜像、登录 Supabase 或
读取云端项目。

Web、API 与本机 Supabase 都通过只绑定 loopback 的受信任 HTTPS proxy 暴露；Store clients、Cookie 和导出
signed URL 不因本机环境放宽 HTTPS。Supabase CLI 必须使用项目专用
`seen-said-local-acceptance` Docker network，且
`com.docker.network.bridge.host_binding_ipv4=127.0.0.1`；即使 OrbStack 全局允许 LAN port forwarding，项目
脚本也必须显式传 `--network-id` 并在启动后审计全部 listener。Supabase、数据库、Mailpit 与 API 不对
局域网或公网暴露。

HTTPS 生命周期使用 ignored、`0600` 的 PID 状态文件。`start` 只有在三个入口都通过系统信任 CA 返回
200 后才成功；重复启动复用健康实例，已记录实例仍活着但不健康时必须停止并重建。`status` 同时验证
PID 与三个入口，`stop` 有界等待后才允许升级终止信号。服务日志不得因此落入仓库或输出 secret。

### 3.1.4 本机模拟模型与在线使用隔离

本机模拟模型的完整需求、技术、TDD 与人工验收见
[`local-acceptance-simulated-provider.md`](local-acceptance-simulated-provider.md)。它只在 acceptance API
composition 的既有 `providerFetch` seam 后生成 strict DeepSeek-compatible response，四类生产生成路径的
quota reservation、durable dispatch、schema、ledger 和持久化保持不变；不建立第二套业务状态机。

Web acceptance build 在全部页面持续显示“本机验收 · 模拟模型”，主要结果字段再带 `【本机模拟】`。
本机 metadata/ledger 为演练生产 DeepSeek Adapter 而保留技术兼容标识，但没有真实网络或费用，相关记录
和导出不得作为 DeepSeek 质量/账单证据。用户正在注册或使用时不停止当前 HTTPS；源码和门禁完成后只在
空闲窗口重建 bundle、重启 API/Web，不停止或重置 Supabase。

HTTPS 服务启动时把 Web bundle 读入固定内存快照，API composition 也只加载一次；磁盘上的后续 build
只是候选，不改变当前 8443/8444 运行版本。缺失 `index.html` 或 bundle 含非普通文件时失败关闭，SPA
fallback 始终来自同一快照。快照运行时首次激活仍需空闲窗口；激活后可让旧版本在线完成后续完整构建
门，再用一次 HTTPS stop/start 同时切换 Web/API，避免半部署。

代码切换只使用 `pnpm acceptance:local:deploy --confirm-local-downtime`。协调器在确认参数精确后依次复核
loopback runtime、幂等停止 HTTPS、构建 acceptance API/Web、启动并 health-check 三入口；不停止
Supabase、不 migrate/reset/seed/bootstrap、不生成或消费邀请。任一阶段失败停止后续动作；stop 后失败
保持离线，修复后重跑同一命令，不能以可能部分写入的 bundle 自动恢复。

### 3.1.1 首账号初始化与第一条前向迁移

可访问邀请页仍不足以开始核心验收。密码或 Google 邀请注册在创建 `user_profiles` 与登录方式的同一
数据库事务中，必须为当前 UTC 月创建 `source=default`、`limit_micro_usd=1_000_000` 的 QuotaGrant；
重放同一注册不得产生第二条有效 grant，已有当前月 admin grant 不得被默认值覆盖。第一条 `0002`
forward-only migration 对既有非 deleting profile 幂等补齐当前月默认 grant，并替换两条注册函数；不得
修改已执行 baseline 的 version、重置本机数据库或消费当前邀请。

本机 Supabase Auth 的密码策略必须与 Cloud contract 相同：12 至 256 个字符，不另加字母、数字、大小写
或符号组合规则。`config.toml` 固定最小长度 12、空 required characters；doctor 和真实容器配置复核都要
覆盖这两个值。hosted acceptance/production 配置也必须对齐，不能让 Web 接受后再由不同环境的 Provider
以额外规则拒绝。

仓库提供独立 `acceptance:local:migrate`：只在 Supabase runtime 仍通过 loopback network/host 审计后，
调用 pinned CLI 的 local migration-up，再复核 runtime。命令输出保持固定且不回显数据库 URL、secret、
SQL 错误正文或容器环境。API `0002` 与 Supabase 时间戳副本必须字节一致，并在空 baseline→0002 与当前
本机库两条路线验证。

本机 bootstrap 另负责幂等创建 private `account-exports-acceptance` Storage bucket。bucket 不公开、只由
service-role 数据权利 worker 使用；它不是 portable PostgreSQL domain migration，也不证明 hosted
acceptance/production bucket 已配置。重复 bootstrap 不得改变既有对象或输出 credential。

### 3.1.2 受控 reset 与虚构 seed

`acceptance:local:reset` 是唯一允许销毁本机验收数据的仓库入口。它必须要求唯一精确参数
`--confirm-local-data-loss`；缺失、多余或拼写不同均在任何 stop/reset 前失败。命令固定操作当前仓库的
`--local` Supabase project，禁止接受 `--db-url`、`--linked`、`--project-ref`、任意路径或远端参数，也不
读取云端登录态。

确认后固定顺序为：复核 loopback runtime → 停止三个 HTTPS 入口 → pinned CLI `db reset --local --yes`
并显式只加载仓库 `seed.sql` → 再次复核 runtime → 幂等 bootstrap → 重建 API/Web → 重启并验证三个
HTTPS 入口。任一步失败都停止后续阶段且只输出固定诊断：preflight 或 HTTPS stop 失败时数据库完全
不动，服务状态须由 status 复核；HTTPS 已成功停止后，后续任一步失败都不自动重启，不把半重建环境
交给用户。数据库 reset 成功后旧账号、学习数据、Auth identity、邮件和邀请全部失效，必须另行运行
`acceptance:local:invite` 生成新链接。

seed 只建立固定 UUID 的虚构本机 Operator/profile/admin role，并经 `0002` helper 建立当前月默认额度；
不建立 Supabase Auth 用户、登录方式、邀请、session、学习正文、Provider 结果或 secret。Storage bucket、
价格快照、数据库 login role、kill switch 和生成式 credential 继续只由 bootstrap 建立。seed 可重放但
不得在普通 start/migrate/build/test 中自动执行。当前用户验收库在用户明确要求 reset 前不得运行该命令；
仅实现与离线测试不能勾选真实 reset/重建验收。

### 3.1.3 非破坏性重启与持久化指纹

`acceptance:local:restart:verify` 是完整停止并恢复 Supabase 与三个 HTTPS 入口的非破坏性验收入口。它不
接受参数、远端目标、数据库 URL、project ref、调用者 SQL 或 snapshot 路径；任何多余参数都必须在读取
数据库或停止服务前失败。命令会造成短暂本机停机，只能操作当前仓库固定 local project。

固定顺序为：复核 loopback runtime → 在数据库服务器内计算 before 指纹 → 停 HTTPS → 停 Supabase →
使用 pinned runtime 重新启动 → 执行 forward-only migration-up → 再次复核 loopback runtime → 计算
after 指纹 → 常量时间比较 → 只有完全一致才重启并验证 HTTPS。任一步失败或指纹不同都停止后续阶段；
HTTPS 已停后不得为了掩盖失败自动恢复服务，用户按 status 检查现场后重跑完整命令。

指纹覆盖全部 `public` 持久表、Supabase Auth users/identities、Storage buckets/objects 和 migration history；
每张表在数据库内按 canonical row JSON 先逐行散列、排序后再聚合，只把固定 relation name、row count 与
不可逆 digest 返回本机 Node 进程。命令只在内存比较并输出固定成功/失败文本，不把 digest、计数、表行、
邮箱、正文、credential、token、password hash 或 SQL 错误写入终端/文件。该指纹证明停启前后所覆盖的
持久状态逐字节等价，但不能替代备份恢复、并发或 hosted 多连接验证。

当前邀请未消费时先运行一次，证明初始化数据、邀请、Auth/Storage 空状态和 migration history 可保留；
用户完成注册和核心学习项后必须再运行一次，才能把“真实账号与学习数据跨重启持久”勾为通过。

Store 使用 acceptance-only Manifest/profile：固定公开开发 `key` 获得稳定 ID，精确声明本机 host/CSP，
并把该 ID 绑定到 API allowlist。它不能修改或污染 release Manifest，也不安装/替换 Classic Native Host。

### 3.2 云端持续验收层（本机主流程稳定后实现）

使用一个独立 Supabase Free project，以及隔离的 Vercel Hobby Web 与 API project。用户现可准备自有根
域名，首选拓扑改为同一 registrable domain 下的两个精确 HTTPS origin：

```text
browser / Store
       |
       |-- https://app.acceptance.<root-domain> --> acceptance Web project
       `-- https://api.acceptance.<root-domain> --> acceptance API project
                                                     |
                                                     `--> acceptance Supabase project
```

两个子域属于同站但不是同源：保留 host-only `Secure; SameSite=Lax` Cookie，Web 只以 credentials 模式访问
精确 API origin，API 只允许精确 Web origin 并继续执行 CSRF。`HUAYI_API_ORIGIN`、
`HUAYI_WEB_ORIGIN`、`VITE_API_ORIGIN` 与 Store API/Web 入口都指向这两个固定子域，不依赖第三方 Cookie。
Vercel Dashboard 显示的实际 CNAME/TXT 值是 DNS 唯一来源，不在仓库中猜测或硬编码。

若域名注册或 DNS 传播尚未完成，可临时退回一个稳定 `*.vercel.app` 同源 gateway 代理 Web/API；gateway
不得缓存认证、SSE、导出或 `/v1/*`，也不得记录正文。它只是备用过渡方案，不再是目标拓扑。

acceptance 使用 `app.acceptance` / `api.acceptance`，production 以后使用独立 `app` / `api` 子域；不得把
验收 Cookie、OAuth callback、CORS allowlist 或 secret 直接提升到 production。Supabase/Vercel 资源必须
使用带 `acceptance` 的名称，不能与 production 共用数据库、Auth、Storage、OAuth client、secret、
Provider Key、额度或调度。

Supabase Free 可能因低活动暂停且没有自动备份；验收数据不作为唯一副本，每个重要批次前后执行受控的
raw sensitive logical dump，并验证从 migration + fictional seed 在隔离 scratch 重建。dump 不是脱敏导出，
只能进入 ignored 且严格权限的安全目录；离线 evidence verifier 还要求 clean current candidate。真实
capture/restore 必须单独批准。Vercel Hobby 只适用于个人、非商业验收；用途变成商业运营前必须重新选择
套餐。

hosted foundation 使用独立 `acceptance:hosted:bootstrap` / `acceptance:hosted:verify`，不能调用任何
`acceptance:local:*` 或 `supabase/seed.sql`。foundation 固定当前 Singapore project，只建立 application
login、三条 acceptance 价格、`model_kill_switch=true` 与 private export bucket，并保持 Auth/profile/
Operator/invitation 为空。用户已于 2026-08-22 明确确认并完成远端 bootstrap；初版 admin/application login
验证返回 passed，证明写入和登录可用。安全审查随后发现 require-only TLS 与包含式 membership 验证不足，
现已改为显式 Supabase CA + verify-full、精确角色图、预期越权 SQLSTATE/exit code 和 session pooler
同一 backend 跨事务 context 清空验证；用户随后运行顺序式 `set -e` 命令并到达 application passed，证明
当时 admin 查询与 application hardened 路径均可运行。Vercel runtime 仍只接受 transaction pooler `6543`；
验证 SQL 不再用只能观察 Supavisor backend 链路的 `pg_stat_ssl` 证明客户端 TLS。0012 push 后 diagnostic 暴露旧 membership SQL
错误要求 PostgreSQL 17 `NOINHERIT` 产品边 `inherit=true`，并错误拒绝 creator-control 边；仓库已修正。
用户随后运行修正版远端只读 verify 并通过，固定 Operator status 当时返回 `empty`。该 foundation 检查点
为 `applied; corrected PostgreSQL 17 remote verification passed; first Operator empty`。Phase 72 后 0013
已作为第 13 条 migration 实际应用，First Operator 已恢复、complete 并通过 post-completion verifier，
最终 status 为 `completed`。Vercel API/Web、Auth URL/SMTP 与 Production environment 已配置；后续真实
`/admin` 密码重新认证与四区只读也已通过，普通邀请 OTP、真实邮件与 Cron 仍须读取各自后续证据。

首个 Operator 不由 foundation 创建。Phase 52 已冻结两阶段 FirstOperatorBootstrap：
DeploymentBootstrapAuthority 发行唯一 BootstrapInvitation，正常注册完成后只晋升该邀请最终绑定的账号；
不得把本机固定虚构 Operator 带入 hosted，也不得用 service role、任意 userId 或公开 HTTP 后门绕过。
离线实现、focused 回归与完整 macOS 门已完成；远端第 12 条 migration 已实际 push，diagnostic 当时显示空
first Operator record；修正版 foundation verify 已通过、固定 Operator status 当时返回 `empty`。Phase 72
随后应用第 13 条 migration 并完成实际恢复、First Operator completion 与 post-completion verify，最终
status 为 `completed`。`/admin` recent-auth 与四区只读复核随后已完成；当前仍未完成的是经明确收件人
授权创建唯一普通邀请后的 OTP journey，详见 `first-operator-bootstrap.md`。

## 4. 域名、DNS 与 Resend 准备

用户已于 2026-08-22 确认在腾讯云购买并实名 `seen-said.cn`。注册商、续费和实名均留在腾讯云；权威
DNS 使用 Cloudflare DNS Free。这里不使用 Cloudflare Registrar：Cloudflare 只承担解析。`.cn` 父区、
Cloudflare DoH 与 Google DoH 已一致返回 `kim.ns.cloudflare.com` /
`malcolm.ns.cloudflare.com`，Cloudflare 已权威回答该 zone；当前没有 DS，DNSSEC 保持未启用。

历史上 `app.acceptance.seen-said.cn` 在 Vercel project 创建前保持 NXDOMAIN，未添加占位 A/CNAME；当前
Web/API 与 Resend Dashboard 生成的记录均已按实际值写入并完成回读。未来启用 DNSSEC 时，只能在
Cloudflare 给出 DS 后回填腾讯云。

2026-08-22 已在 Supabase Free 组织 `Seen & Said` 创建独立 hosted acceptance project：project ref
`kpadiulxkgckskcfydry`，URL `https://kpadiulxkgckskcfydry.supabase.co`，Primary Database 实测位于
`ap-southeast-1 / Southeast Asia (Singapore)`。Data API 创建后仍关闭，自动 RLS 未启用；用户明确确认后
已实际应用 11 条 canonical migration，Dashboard 已复核完整 history、业务表、运行角色与 tenant owner
RLS，首页仍为 `Healthy`。第 12 条 FirstOperatorBootstrap 与第 13 条密码注册中断恢复 forward migration
均已完成各自 dry-run、明确确认与 actual push。foundation bootstrap 后 Storage 为唯一 private
`account-exports-acceptance` bucket 且 0 object，application login 与三条价格已建立，kill switch 保持开启；
First Operator 最终 status 为 `completed`。两个 Vercel project、Git/Branch、custom domain 与 TLS 已建立；
Phase 78 API-only arm `4f1ce4a` 对应 Ready deployment `6QeRbqxgA88cFXggKekkr2axH9JM`，独立
`020e21e` disarm 零新增；Latest Web 已更新为 Phase 80 arm `9b0860a` 对应
`V3NzjTYXtH7fb3WC2P6hpWR1twhb`，独立 `1d1f567` disarm 零新增。默认非 Canceled API/Web 为 16/9，两项目当前
`deploymentEnabled=false`。Tokyo
(`ap-northeast-1`) 的 Resend sender domain `notify.acceptance.seen-said.cn` 也已完成 DNS 与 Dashboard
verified。旧泄露 key 与两把未使用的错误/临时 R3-C key 均已撤销；两把 sending-only/domain-scoped
SMTP/HTTP key 已分离托管，Supabase Custom SMTP、Auth Site URL/五条 exact redirect、API 21/21 与 Web
2/2 Production-only environment 均已配置并完成结构回读。历史 Rotate 后 source `7577cdd` / deployment
`DyqRzj5UMN8BRpSeZyohXprnAkaT` 已关闭 application-role 数据库路径；Phase 78 disarm 后 custom-domain
`/health` 再次返回 TLS/HTTP2 200 与固定 JSON，无 Cookie Web-origin `/v1/auth/csrf` 返回精确 401、
`authentication_required` 与 exact credentialed CORS。上述均为无写入探针；邮件投递与完整应用验收仍
未完成。

`.cn` 域名实名认证是启用解析的必需项。验收环境继续使用 Vercel/Supabase 境外托管资源时，ICP备案不
作为当前启动前置；未来迁入中国大陆服务器、使用中国大陆 CDN 或其他境内接入资源前，必须重新设置备案
门。`acceptance` 命名本身不构成备案豁免。

固定 DNS 职责如下，具体 record value 只复制 Vercel/Resend Dashboard 的当前值：

| 名称                             | 用途                           | 管理方                  |
| -------------------------------- | ------------------------------ | ----------------------- |
| `app.acceptance.seen-said.cn`    | Vercel hosted Web 验收         | Vercel + Cloudflare DNS |
| `api.acceptance.seen-said.cn`    | Vercel hosted API 验收         | Vercel + Cloudflare DNS |
| `notify.acceptance.seen-said.cn` | Resend 验收事务邮件发件子域    | Resend + Cloudflare DNS |
| `_dmarc.seen-said.cn`            | 当前根域 monitoring DMARC 策略 | Cloudflare DNS          |
| `notify.seen-said.cn`            | 未来 production 发件子域预留   | 当前不配置或发送        |

Resend 使用 Free 版本和独立 `notify.acceptance.seen-said.cn` 子域隔离验收事务邮件信誉，不能复用未来
production 的 `notify`；验收 sender 暂定 `accounts@notify.acceptance.seen-said.cn` 与
`security@notify.acceptance.seen-said.cn`，display name 固定为 `语见`，Reply-To 使用用户已确认的支持
地址但不把其值写入仓库。无正文告警接收人仍需后续确认和验收。按
2026-08-21 官方价格页，Free 为每月 3,000 封、每天 100 封，足够当前单用户验收；配额或价格变化以创建
账号时 Dashboard 为准。API key 只放 hosted secret store，仓库、日志、Web 和 Extension 都不得出现；
优先使用仅发送权限的 key。

邮件分成两条独立链路：Supabase Auth 通过 Resend custom SMTP 发送注册确认/恢复链接；R3-C 由应用自己的
Resend HTTP sender 消费 `security_notification_outbox`。二者使用不同 credential、发件地址和失败证据；
当前两把 key 均为 Sending access、仅限该验收子域；Supabase 已启用
`smtp.resend.com:465`、username=`resend` 与 accounts sender，API Production 已托管 Sensitive R3-C key、
mode、security sender 与 Reply-To。SMTP/变量配置成功不等于真实邮件或 R3-C 完成。

域名、Resend 验证、分离 credential 与托管配置完成后仍不能宣称 R3-C 完成。仓库已实现固定 Resend sender、
独立 notification CRON、厂商幂等映射、失败告警与无正文日志；尚缺真实受控投递、重复投递观测和告警接收
验收。hosted acceptance 只能通过 FirstOperatorBootstrap 创建唯一首位验收账号，并保持公开注册/邀请
扩张关闭：

- 可以验收登录后的 Web、学习库、生词、历史、练习、账号、数据导出/删除和 Store 配对；
- 本机注册确认使用 Mailpit；托管 Supabase 内置邮件只允许项目团队预授权地址的极低频测试，不作为
  可靠投递或外部邀请证据；
- 密码恢复安全通知的外部投递、重复投递观测和真实告警接收保持 unavailable/pending；
- 不得增加跳过身份校验的 test-only 登录后门、硬编码 Cookie 或长期 service-role session。

如果现有 production composition 无法安全创建首个验收账号，应新增仓库外 secret 驱动、一次性且默认
禁用的 bootstrap CLI；命令完成后立即撤销 bootstrap secret，不暴露 HTTP route。

## 5. 外部能力分层

本机首轮默认零第三方网络。真实 DeepSeek 质量与费用另行批准后才启用专用 Key、小额度、默认 grant、
成本观察和可立即关闭的 kill switch。fake Provider 只用于环境/交互开发，界面必须标明非真实结果。

Google、欧路、扇贝、真实 Chrome 安装和 Store 上传继续逐项授权。账号主链路先用密码 + Mailpit；Google
只在独立测试 OAuth client 和 callback 配置完成后加入。任何验收环境的存在都不会自动授权外部调用。

## 6. 用户反馈循环

| 类型                                  | 处理方式                                                          |
| ------------------------------------- | ----------------------------------------------------------------- |
| P0 数据泄露、跨账号、不可恢复数据丢失 | 立即关闭相关能力或环境，保存无正文证据，修复后重建验收环境        |
| P1 主流程不可用、账本或身份错误       | 阻断下一轮，补回归并在同一环境重验                                |
| P2 明显产品/交互缺陷                  | 进入当前 Mac 迭代批次，校准需求与验收标准后修复                   |
| P3 文案、视觉和低风险优化             | 批量积累，在固定节奏发布到验收环境                                |
| 新需求                                | 先写 product/technical/test/acceptance 变更，不直接在部署环境手改 |

每轮记录验收版本、完整 commit SHA、环境资源 ID、migration、启用能力、反馈、修复、自动门和人工重验。
日志、截图和 issue 不包含用户正文、Cookie、token、Key、邀请或签名下载 URL。

日常小改在 macOS 完成目标门和环境 smoke；Windows 保持批次验证。发生 Windows 专属集成、共享
transport/wire 或候选冻结时才提前进入 Windows。一个验收周期结束后，最新 SHA 在 Mac 完整门绿、
工作树干净且用户确认阶段行为后，再批量跑一次 Windows 完整门。

## 7. TDD 与实施顺序

1. 完成本方案和周边产品/架构/测试/发布文档审查；
2. 为缺失的 Supabase local manifest、环境模板、canonical migration/seed/bootstrap、启动/reset、loopback
   HTTPS、acceptance Store profile、稳定 ID 和零外联写 Fresh RED；
3. 最小实现本机环境与明确标识的零网络模拟模型，从空数据目录启动，完成密码注册/Mailpit 确认、
   Cookie/CSRF、核心学习闭环、重启持久化和一次 baseline→增量 migration；
4. 用户在本机持续使用并完成首轮反馈/修复循环；
5. 已完成：域名实名、Cloudflare 权威 NS、Web/API/Resend 精确 DNS、部署前 TLS、Supabase/Vercel 独立资源、
   Auth URL/SMTP 与完整 Production-only environment 结构；
6. 已形成 API-only armed 提交并产生 API deployment 历史；下一步冻结受审查候选，执行一次轮换后受控 API
   deployment。新 deployment 记录产生后，无论 Ready/Error 或 smoke 成败，唯一允许的下一次 push 都是
   重新关闭 API Git deployment；确认关闭提交没有产生 API/Web deployment 后，才验证启动、health、
   TLS/CORS/Cookie/SSE/Auth/Storage 与真实 DeepSeek 小额 smoke；全部通过后才单独部署 Web；
7. 在 Web 部署后完成真实 callback、托管 Auth/Storage、多连接 RLS、session 撤销与备份/重建；
8. 验收真实邮件、R3-C sender/通知 CRON/告警，再安装五项 Cron；
9. DeepSeek 小额真实验收已获批准但须等待 API health；Google 与 Store/Chrome 仍分别等待后续批准；
10. 用户跨多日自然使用；每轮按反馈循环修复并部署；
11. 用户明确签字前不创建 production candidate。

Fresh RED 不调用云服务；云资源、secret、部署、Provider 和 Chrome 分别等待授权。失败先保存首个安全
错误，禁止通过放宽 CORS、Cookie、RLS、Origin、CSRF、schema 或权限绕过。

## 8. 验收门

Local-ready 至少满足：

- 一条受审计命令可启动、status、stop、reset；没有必须手工改数据库的隐式步骤；
- 所有公开端点是 loopback 受信任 HTTPS，空库可重建，secret 不进入仓库或日志；
- 真实本机 API/Postgres/Auth 完成邀请、注册、Mailpit 确认、登录、Cookie/CSRF 与核心学习闭环；
- Store 的稳定 acceptance ID、Origin、host/CSP 与 API allowlist 一致；
- 进程/浏览器重启及一次 forward migration 后学习数据仍在；默认零第三方网络；
- 用户首轮 P0/P1 已关闭或明确记录为环境阻塞。

Staging-ready 还必须满足：

- Supabase/Vercel/secret/data 与 production 完全隔离；
- 自有根域下同站 Web/API 子域的 Cookie、CORS、callback 和 SSE 全链路通过；若用了备用 gateway，须
  单独记录且不得据此代替目标子域复验；
- 两账号、多数据库连接的 RLS 与并发通过；固定 staging Extension ID/host/CSP；
- Supabase Free 暂停、无自动备份和邮件限制已记录并演练重建；
- 真实 DeepSeek 只使用经批准的专用 Key/额度，并能立即 kill；
- 用户完成一次端到端清单和一个跨多日自然使用周期，所有 P0/P1 关闭，P2 已处理或被明确接受；
- 最新 SHA 的自动回归、macOS 完整门与对应 Windows 批次门通过。

Production-ready 不能由以上任何一层自动推出；即使 acceptance 域名/DNS/Resend 已通过，仍需 production
子域、R3-C、正式 OAuth、隐私/运营事实、告警/备份、双平台真实 Chrome 和发布审计，且必须得到用户
明确批准。

## 9. 当前下一步

Phase 64–69 已完成 hosted Auth/environment 结构、application verifier、纠正后的 API DSN、API exact-SHA
deployment/disarm 与 DB-backed runtime 门。Phase 70 首次 Web deployment 因 workspace `dist` 未先构建而
Error，修复后第二次 reviewed re-arm `b87ef03d948934fad7faf50418e0b79a1914af30` 已产生 Ready deployment
`6AAAVXP175oviEhrjULxH48eQjPu`，并先以独立 `c5c25f5` 恢复 Web Git deployment 关闭；该提交没有新增
Web/API deployment，两个 project 当前都保持 disarmed。custom-domain Web/TLS/hosted identity、bundle
secret scan、零 Cookie CSRF/分析 401、失败 callback 400 与 12 项远端零新增计数均通过，Phase 70 公共门
已关闭。

邀请前审查发现的 Google capability/password callback 缺口已由 Phase 71 关闭：API `f1186a6` 与 Web
`beac29d` 各只产生一条 Ready，独立 disarm `837ec0d` / `b52992e` 均零新增，最终双关闭；API Google
route 404/12 项零状态、Web exact SHA/零 Google 控件/bundle scan 均通过。Supabase `Confirm sign up` 保存态
模板使用动态 `{{ .ConfirmationURL }}` 的 Phase 71 回读仅是历史证据，已被首次真实确认中的
`otp_expired` 事故推翻。当前门改为 `{{ .Token }}` + `{{ .RedirectTo }}`、inert GET confirm、显式 OTP
POST 与 0013 中断恢复。2026-08-24 已实际应用唯一的 0013，migration/ACL/application verifier 均通过；
Site URL 保持不变，五条 43-character query-aware redirect 与 OTP 模板已保存并重新加载回读。Custom SMTP
未改、密钥未轮换、邮件未发送，Resend tracking 仍 disabled。Phase 72 API/Web 已严格串行各新增一条
Ready deployment，独立 disarm 均未在其目标项目新增 deployment；默认 6/7 非 Canceled 可见数为
14→15 / 3→4，全状态 7/7 总数在各项目自身 arm 窗口为 19→20 / 13→14。双 disarm 后、证据文档提交前
的 7/7 检查点为 API 22、
Web 14，Canceled 为 7/10；两个 disarm 均未在其目标项目新增 deployment，但各自在另一仍 disarmed
项目留下一条 Canceled 审计记录。两个项目均关闭，API `/health` 与 Web `/` 的 custom-domain TLS/HTTP
200 通过。
完成当前账号恢复及新账号 OTP journey 前不得切换 kill switch 或运行真实 Cloud DeepSeek 应用路径 smoke；
再后续为真实 R3-C → Cron。下一次 Windows 全门等到验收批次冻结，不因每个文档或配置步骤重复执行。

2026-08-24 后续 UI 合并候选 `524a55b` 已通过完整 macOS 门并由 Web-only arm `f3feff1` 部署为
`DU6wE2r9ZLeSSoAMZAbsQihBjC72`；独立 disarm `d6d901c` 零额外非 Canceled，最终 Web/API 为 8/15 且
均关闭。live `/practice` 已显示新工作台；部署期间 `/admin` 的 15 分钟密码确认自然过期，是该阶段当时
的历史检查点。后续 Phase 77 已重新完成 recent-auth 与四区只读；当前下一项是明确授权一个收件人后创建
唯一普通邀请。不得因阶段快照中的旧门而重做 Supabase migration、First Operator、Vercel environment、
DNS 或密钥配置。

该历史下一项已经推进：唯一普通邀请已创建并提交密码注册，真实邮件发现 Hosted Email OTP length=8 与
六位产品契约不一致。用户只授权保存 8→6；独立重新加载回读为 6，expiry 仍 3600，其他
Auth/SMTP/DNS/environment/secret 未改且未发新邮件。当前下一项改为：完成本机同邀请 resend/0014 验证 →
关闭 PG17/pinned scratch/write executor readiness prerequisite（并证明 Storage objects 为零或另行 export）→
单独批准并完成 pre raw logical dump + migration/fictional-seed rebuild → backup preflight 通过 → 明确批准后
只应用唯一 0014 → post dump + completion gate → API/Web 严格串行 one-shot deploy/disarm → 再次只读回读
OTP length=6 → 用户点击重发一封新邮件并完成 scanner-safe 六位 OTP、Web 落点和密码重登。旧 8 位码不得
截取使用，不得新建第二邀请或删除既有 Auth user。

## 10. 官方约束来源

- [Vercel environments](https://vercel.com/docs/deployments/environments)
- [Vercel external rewrites](https://vercel.com/docs/routing/rewrites)
- [Vercel monorepo proxy](https://vercel.com/docs/monorepos/monorepo-faq)
- [Vercel Hobby plan](https://vercel.com/docs/plans/hobby)
- [Vercel custom domains](https://vercel.com/docs/domains/working-with-domains/add-a-domain)
- [Supabase local development](https://supabase.com/docs/guides/local-development)
- [Supabase CLI workflow and seed](https://supabase.com/docs/guides/local-development/cli-workflows)
- [Supabase local Mailpit](https://supabase.com/docs/guides/local-development/cli/testing-and-linting)
- [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase Free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)
- [Supabase backups](https://supabase.com/docs/guides/platform/backups)
- [Supabase CLI backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [Chrome extension manifest key](https://developer.chrome.com/docs/extensions/reference/manifest/key)
- [Tencent Cloud domain registration and real-name verification](https://cloud.tencent.com/document/product/242/39039)
- [Cloudflare DNS full setup](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/)
- [Resend verified domains and subdomains](https://resend.com/docs/dashboard/domains/introduction)
- [Resend pricing](https://resend.com/pricing)
