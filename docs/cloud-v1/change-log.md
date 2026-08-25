# 语见 Cloud V1 决策变更记录

本文件记录需求与技术方向的实质变化。每项变更必须同步到受影响的权威文档和 ADR；实现状态不在
这里记录。

## 2026-08-25：fictional seed 必须在严格 psql 执行下保持 stdout 为空

- isolated rebuild 的 SQL runner 同时验证 exit 0 与 stdout 精确为空；`seed.sql` 顶层调用返回 UUID 的
  `SELECT ensure_current_default_quota(...)` 虽然事务成功，却会把生成的 quota identifier 写入 stdout，因而
  正确地在 `fictional-seed` 阶段失败关闭；
- seed 改为事务内匿名块的 `PERFORM`，业务写入、固定虚构身份与 Hosted-data-absence contract 不变，同时
  更新 seed SHA-256 pin。回归必须同时证明源码不存在该顶层 `SELECT`，并以原固定镜像链路证明 seed exit 0、
  stdout 为空、final contract 全真、scratch 已销毁；失败时仍保持零 evidence；
- 本修复不改变 migration、Hosted Supabase、真实备份、邮件、部署、密钥或模型调用，也不放宽 SQL 输出
  合同。

## 2026-08-25：isolated rebuild 的 Auth/Storage 基线由固定服务镜像迁移补齐

- 最终 PID 1、`pg_isready` 与 Postgres 镜像自有 `auth.users`/`auth.schema_migrations`、`storage` schema、
  Auth/Storage admin role 只证明 Postgres image initialization 完成；它们不证明 GoTrue 的
  `auth.identities` 或 Storage 的 `storage.objects`/`storage.buckets` 已建立；
- rebuild 必须在上述 Postgres-image readiness 后，依次从 repository platform lock 的 digest-only GoTrue 与
  Storage 镜像运行各自 migration-only command。runner 只共享 `--network none` scratch 的 network namespace，
  因而仅通过 loopback 连接 scratch；不得增加 port、bind、volume、pull、Hosted 连接或真实 credential；
- runner identity、image、command、Entrypoint、固定 environment、label、network mode、零 mount 与清理均须
  精确校验；scratch readiness 同时受尝试次数和真实五分钟单调时钟 deadline 限制。任一失败只报告固定
  `auth-baseline` 或 `storage-baseline`，销毁 scratch 且保持零 evidence。两项均完成后才执行完整
  Auth/Storage baseline contract 和仓库 14 条 migration；该调整不授权 capture、0014 apply、邮件或部署。

## 2026-08-25：0014 真实 dry-run 失败使用固定只读诊断，不再猜密码或回显 CLI

- standalone dry-run 的固定失败不能区分 CA、隐藏输入、数据库连接、Supabase CLI 与严格 transcript；不得
  让操作者反复换密码，也不得通过 `--debug` 或原始 stderr 诊断；
- 新诊断入口只运行固定官方 CA GET、带 `connect_timeout=10` 的 transaction-pooler `SELECT` 与同一个
  `db push --dry-run`。psql 同时有 15 秒进程硬上限；Supabase CLI 退出码只分为 ok/command/process，不能
  套用 psql 的 1/2/3 语义；
- 对外只输出固定 connection/dry-run predicate，异常只报告 arguments、CA、password prompt/validation、
  connection probe 或 dry-run process 之一。密码、URL、原始 stdout/stderr、Error、环境和证书路径都不得
  输出；诊断不授权 apply、邮件或部署。

## 2026-08-25：isolated rebuild 执行失败只报告固定脱敏阶段

- readiness 已能区分本地前置条件，但 confirmation-gated rebuild 仍把 source、scratch、SQL、cleanup 与
  evidence 写入的所有失败压成同一 generic 输出，无法安全定位连续真实失败；rebuild 执行层因此必须维护
  一个内部固定阶段状态机；
- 对外只允许 source-validation、docker-target、scratch identity/start/runtime/readiness、auth/storage
  baseline、完整 baseline、migration ledger/application、fictional seed、final contract、scratch destroy、
  evidence persistence。stage 由代码路径
  选择，不能来自 Error message、child stdout/stderr、SQL、路径、digest、secret 或 environment；
- capture 与 confirmation-gated 操作的前置 readiness failure 继续保持单一 generic 输出。阶段诊断不扩大
  Hosted 权限、不连接网络、不改变 scratch 的 `--network none`/零 mount/零 port 边界，也不授权 0014 apply。

## 2026-08-25：Supabase 0014 dry-run 只接受 stderr 上的严格单迁移 transcript

- 仓库 pinned Supabase CLI 的 npm launcher 把底层 CLI 进度原样写到 `stderr`；0014 standalone dry-run
  与 apply 内部 mutation preflight 必须按这个真实通道验证，不能继续只读取空的 `stdout` 后把成功命令
  误判为失败；
- child runner 必须分别、有界收集 `stdout`/`stderr`，总量共享 128 KiB 上限并继续等待 timeout/overflow
  child close。只有 exit 0、`stdout` 精确为空且 `stderr` 精确等于 non-mutating header、connection marker、
  唯一 0014 migration 与 finished marker时才成功；
- 双通道内容、ANSI、额外行、其他 migration、overflow、timeout、signal 或 spawn error 一律失败关闭。
  原始 child 输出与密码不得转发到操作者输出；对外仍只使用固定成功或失败文案。

## 2026-08-25：数据权利失败响应、删除回执与受限会话退出收紧

- 数据权利五条公开 route 必须在认证和 request validation 前设置
  `Cache-Control: private, no-store`，保证 401/400/409 与成功响应采用同一禁止缓存边界；Web logout
  同样在读取 Cookie、Origin 或 CSRF 前设置该响应头；
- disabled 账号的 `DataRightsSession` 必须能够通过同一 CSRF-protected logout 撤销当前 Web session。
  共享 route、Web adapter 和 `/settings/data` 必须提供明确“退出登录”入口；退出不删除账号或云端数据；
- 账号删除 Web adapter 在同一个浏览器 authority 生命周期内固定一个 Idempotency-Key。首次 accepted
  响应丢失后，用户重试必须复用相同 key/body/旧 Cookie proof，不能因每次生成新 key 而让 24 小时固定
  receipt replay 失效；transport/HTTP/strict response 失败继续保留该 key，只有严格 accepted 或成功的
  logout/新密码会话转换才清除，避免同一 SPA 后续账号复用前一账号的删除 proof；
- 删除回执 `ack_expires_at` 固定为请求时间后 24 小时，不能沿用普通幂等记录的 7 天期限。导出对象的
  24 小时期限从 Storage upload 完成后的 ready 时刻计算，manifest `exportedAt` 仍保持 owner snapshot
  时刻；
- Supabase 签名 URL 除固定 HTTPS origin、无 userinfo 外，还必须匹配配置的 private bucket path；同源其他
  bucket 也失败关闭。这些修复不修改 migration、托管资源、密钥、邮件、部署或外部服务状态。

## 2026-08-25：ExtensionQuery repair 失败不得丢失已产生费用

- ExtensionQuery 首次 Provider 调用已返回严格 usage、但 JSON 结构需要 repair 时，第二次 HTTP、timeout 或
  strict envelope 失败必须沿错误对象保留第一次 `billedCalls`、usage 与 cost；不能把已经产生的调用按零
  成本结算。两次均返回 usage 但 repair 输出仍无效时，两条 billed calls 都进入 failed ledger；
- 若首次 dispatch 后完全没有可用 usage，例如响应缺失 strict usage 或网络结果不明确，失败结算必须通过
  owner forced-RLS、精确 reservation/request 绑定读取不可变 reservation 上限，写 token-null failed ledger，
  不得写零 token/零成本。通用 settlement 继续原子锁定 active reservation，重放不会产生第二条 ledger；
- terminal settlement 还必须在锁定 owner generation 后，要求 command reservation 与 generation 已持久化的
  reservation 完全相同；否则即使传入另一个租户的有效 active reservation，也必须在 settlement 前失败关闭；
- 该修复不改变公开 API、价格、Provider endpoint/model、90 秒 deadline、kill switch、限流或恢复策略。
  离线测试不调用 DeepSeek、Supabase、Vercel、Resend，也不发送邮件或触发部署。

## 2026-08-25：五条 Cron 内部路由统一认证并让 401 也禁止缓存

- 五条 Supabase Cron 目标路由不再各自复制 Bearer 比较。共享 `requireCronBearer` seam 必须先设置
  `Cache-Control: private, no-store`，再校验固定 `Bearer ` 前缀、等长 secret 与常量时间比较；错误文案仍由
  各 route 固定，业务 worker interface 与成功响应不变；
- 缺失或错误 Bearer 的 401 与成功响应同样必须带 `private, no-store`。认证失败不得调用 worker，也不能因
  header 只在认证成功后设置而留下可缓存错误响应；actual production composition 必须逐一覆盖五条路径；
- 该修复只关闭 API 认证/缓存交叉缺口，不证明 Vault/API secret 值连续、Cron 已安装、两个真实周期、
  `pg_net` 的 401/5xx/timeout 后恢复或业务状态机在真实部署中的幂等性。

## 2026-08-25：R3-C Resend sender 的 20 秒取消信号必须可被精确离线证明

- “代码中写了 `AbortSignal.timeout(20_000)`”不能作为可执行回归证据；sender 构造模块必须有一个窄的
  timeout factory 内部 seam，生产默认仍委托原生 `AbortSignal.timeout`，不改变 HTTP、模板、幂等或错误
  interface；
- 回归必须用无真实计时等待的 fake factory，精确证明只以 `20_000` 调用一次，并证明 factory 返回的同一
  signal 进入固定 Resend fetch 的 `RequestInit.signal`。不得 monkeypatch 全局计时器或发起网络请求；
- 该证据只关闭 sender 组合层的超时 wiring 缺口，不证明 Hosted Resend 的 401/5xx/timeout 后恢复、真实
  投递、重复投递观测或无正文告警接收门。

## 2026-08-24：Hosted 重要批次 readiness 只报告固定首个失败阶段

- pre/rebuild/post readiness 不再把 clean repository 与全部 runtime 缺口压成同一条无法定位的 generic
  failure；统一深模块必须返回 frozen `ready/failedStage/candidateCommit` 结构，失败阶段只能由内部固定
  allowlist 产生，不能从 Error、child output、路径、digest、secret 或 environment 派生；
- 选择顺序固定为 repository state → Docker target → Docker daemon → Supabase CLI → FileVault →
  platform lock → local platform images；runtime inspector 自身出现未分类 rejection 时只使用固定
  `runtime-inspection` fallback。多项同时失败只报告首项，保证相同状态得到确定输出；
- 该诊断只允许用于三个只读 readiness 入口。pre/post capture 与 isolated rebuild 无论在 readiness 还是
  执行阶段失败，仍只输出原单一 generic failure，不扩大真实写操作的可观察面。readiness 继续零网络、
  零 evidence/数据库写入，不能隐式进入 capture/rebuild/0014。

## 2026-08-24：Web 认证 mutation 共用一个同步单飞门

- OTP resend 的专用同步门只阻止同一重发动作重复执行，不能保护仍只依赖 React `busy` 状态的密码注册、
  密码登录与中断注册恢复，也不能阻止邀请错误页同时触发 resend 和 resume；这些请求分别可能重复建立
  Auth flow、调用 Provider、绑定身份、恢复邀请或创建 Web session；
- Web 必须让 register、login、resume 与 resend 共用一个页面级同步单飞门。首个动作在调用 async adapter 前
  占位，成功或失败后统一释放；同一动作和不同动作在 pending 期间都不能启动第二个 mutation。邀请 claim
  保持独立单飞，因为它属于页面初始化/重试读取路径，不与已验证后的账号 mutation 共享生命周期；
- 回归必须对 register/login/resume 分别用 deferred Promise + 同 render/tick 双触发证明只调用一次，并在
  bound-claim error 页面交叉触发 resend/resume，证明只允许先到动作。既有 resend pending 回归保留；
  不能堆叠多个 action-specific ref 或把按钮 `disabled`、服务端限流当成同步互斥。

## 2026-08-24：OTP 重发必须用同步单飞门阻止同渲染周期重复轮换

- React `busy` 状态和按钮 `disabled` 只负责呈现，不能作为异步动作的互斥锁；同一事件循环内的快速
  双击可能在重渲染前进入两次 resend，连续轮换同一 invitation flow 并发送两封只有最后一封有效的邮件；
- Web 必须在调用 token-only resend API 前以组件内 ref 同步占位，并在成功或失败的 `finally` 中释放；
  pending 与 bound-claim error 两个入口共用同一门，不把 invitation token 写入 DOM、Storage 或日志；
- 回归必须用未完成 Promise 保持首个请求 pending，并在同一渲染周期连续触发两次，证明客户端只发出
  一次请求。API 双限流与数据库 flow 轮换契约保持不变，不能把限流当作客户端幂等。

## 2026-08-24：重要批次 pre/post capture 单命令内部获取固定官方 CA

- 操作者只运行既有 `pnpm acceptance:hosted:backup:capture:pre|post` 并在 TTY 输入管理员数据库密码，不再
  准备 `HUAYI_HOSTED_DATABASE_CA_CERTIFICATE` 或拼接长 shell；exact confirmation、固定 project/phase、
  session pooler `5432`、digest-only PostgreSQL 17 runtime 与 evidence 目录契约不变；
- fixed official CA fetch 从 0014 专用文件下沉为共享深模块：固定 Singapore 官方 URL、GET、拒绝 redirect、
  no-store/no-credentials/no-referrer、10 秒/16 KiB、HTTP 200/final URL/fatal UTF-8/单一严格 PEM。0014
  dry-run/apply 与 backup capture 共用这一实现，安全修复集中在一个 seam；
- capture 先取得并验证公开 CA，再显示隐藏密码提示；CA 获取失败时零 password read、零 Docker/数据库
  child。CA 与 `.pgpass` 仍只进入 `0700` 临时目录下的 `0600` 文件并 read-only mount，失败统一收敛为
  fixed error。该调整只实现本地 interface，未运行真实 capture、rebuild、dry-run/apply、邮件或部署。

## 2026-08-24：0014 apply 只能通过绑定 preflight、source identity 与 postflight 的单命令

- 实际写入不再允许操作者手工拼接 `supabase db push --yes`。只有 pre raw logical dump、isolated rebuild 与
  `acceptance:hosted:backup:preflight` 已对同一 clean candidate 通过，并取得独立 apply 授权后，才能运行
  `pnpm acceptance:hosted:migration:0014:apply`；
- apply 深模块先验证 preflight，再隐藏读取管理员密码并复用固定 CA/transaction-pooler verify-full 契约；同一
  执行内必须先 dry-run 出唯一 `20260824010000_password_signup_otp_resend.sql`，mutation 前再次重跑
  preflight，并校验 Supabase/API 两份 migration byte-identical 且匹配固定 SHA-256，禁止在等待或 dry-run
  期间静默切换 candidate/source；
- mutation 只调用仓库 pinned Supabase CLI 的固定 `db push --yes --skip-vault --db-url` 参数。exit 0 后还必须
  用只读事务验证完整 canonical 14-version chain、`bound_email` column/check、两条 SECURITY DEFINER +
  `search_path=pg_catalog` function identity，以及 resend function 仅 owner/context setter 可执行的 exact ACL；
- apply child 非零或 postflight 不精确时不得输出成功，并统一提示“不要重试，先检查远端状态”，避免在远端
  可能已提交时盲目重复。post capture 与 `backup:complete` 仍是部署前独立后续门，apply 成功不能替代它们。

## 2026-08-24：0014 dry-run 单命令内部获取固定官方 CA 并强制 transaction-pooler verify-full

- 用户只运行 `pnpm acceptance:hosted:migration:0014:dry-run` 并在 TTY 输入管理员密码；不得再要求复制 CA、
  拼接长 shell 或准备 `HUAYI_HOSTED_DATABASE_CA_CERTIFICATE`。入口先从仓库既有固定 Singapore 官方 CA
  URL 获取公开证书，成功后才显示密码提示，Supabase child 仍在二者都有效后才启动；
- CA 获取固定 `GET`、`redirect=error`、no-store/no-credentials/no-referrer、10 秒和 16 KiB 上限，并要求
  HTTP 200、final URL 精确、fatal UTF-8 与单一严格 PEM。固定 URL 是支持官方 CA 轮换的信任接口，不把
  某次证书 digest 固化为长期 pin；任一漂移都固定失败且零数据库 child；
- 管理员 dry-run 复用既有 transaction pooler `6543` URL，不能借用只供 application 隔离 verifier 使用的
  session pooler `5432`；URL 与 child 环境同时固定 `sslmode/PGSSLMODE=verify-full`。CA 只写入随机 `0700` 临时目录
  下的 `0600 root.crt` 并通过 `PGSSLROOTCERT` 交给该 child；密码仍只进入进程级 `PGPASSWORD`。正常、
  overflow、timeout、spawn 或文件失败都尝试清理临时目录并收敛为固定失败，不转发原始细节。`rm` 自身
  失败时只能证明 cleanup 已尝试：不得报成功，按本机 cleanup incident 处理并在重试前人工清理固定前缀；
  可能残留的仅是 `0700` 目录内 `0600` 公开 CA，不含密码。

## 2026-08-24：Production 逻辑备份恢复演练使用临时 Supabase recovery project

- 备份 capture 与 migration+fictional-seed rebuild 不再被视为“真实 archive 可恢复”的证据；production
  restore drill 成为独立发布门，但不是 Phase 81/0014 当前 preflight 的新增依赖，只在当前 Hosted 验收批次
  关闭且取得独立批准后实施；
- 真实 target 固定为批准后新建、同组织/同区/同 PostgreSQL major、无 outbound integration 的临时
  Supabase recovery project；本机 networkless PG17 只做 TDD/fixture。这样覆盖 managed Auth/Storage、
  platform roles/runtime、RLS 与 application role，同时禁止把 raw archive 复制到普通 development；
- source 必须绑定 archive/manifest/TOC/coverage/full commit/migration head/hash/mode/retention；恢复只使用
  exact TOC 和 target-local role/ACL，禁止 global role/source password/platform config。Storage metadata 在
  DB archive 内，object bytes 非零时必须另行批准 encrypted export/restore；
- evidence 只允许 strict canonical JSON、布尔量与一次性 HMAC count digest；成功、失败、target cleanup、
  retention deletion lifecycle 均失败关闭。target 删除/凭据撤销/absence 回读与 retained backup 到期删除
  全部完成后，才能把季度 drill 标记 closed；
- v1 actual operator host 固定 macOS OrbStack+FileVault；shared contract 仍进入 Windows 门，但 Windows
  产品支持与 restore operator support 分开判定。完整需求、技术路线、测试和验收矩阵见
  `hosted-logical-backup-restore-drill.md`。

## 2026-08-24：Hosted 重要批次 writer 固定为原子归档与隔离重建执行器

- Phase 86 只增加三个 exact-confirmation 写入口：0014 前、后 raw custom archive capture，以及从仓库
  migration + fictional seed 启动的隔离 rebuild；project、batch、phase、路径、pooler、image 与 migration
  集合均不能由调用者覆盖，readiness 继续只读且不能隐式进入写操作；
- 实际 Docker argv 只允许无 tag 的 Supabase PostgreSQL index digest，并固定 `--pull never` 与平台 resolver。
  `17.6.1.159@digest` 只保留为来源证据；不得使用 tag、普通 `supabase start`、远程 Docker selector、PATH
  搜索或 host PostgreSQL client；
- Hosted 管理员密码只从 `/dev/tty` 隐藏读取：先保存完整 `stty -g` 状态，再关闭 echo/canonical/ISIG 后显示
  提示，由隔离的有界 reader 从私有 fd 3 返回密码，不使用会 redraw 输入的 readline。Ctrl-C 作为 `0x03`
  取消并在固定失败前恢复终端，不能由 pnpm 吞掉后误报 exit 0；密码只进入固定 `0600 .pgpass`，公开 CA 只
  进入固定 `0600` 文件。两者都以 read-only bind mount 暴露固定容器路径，秘密不进入 argv、child env、
  stdout、stderr 或日志；macOS 真实 PTY 回归证明正常输入零回显、连续取消均恢复 echo/canonical/ISIG，且
  不遗留 SIGINT listener；
- archive 与 manifest 均采用固定 partial、文件 `fsync`、hash/size、atomic rename、目录 `fsync`，manifest
  最后提交；连接前 evidence leaf 必须精确为空，TOC 验证前后的 size 与 SHA-256 必须同时不变。TOC 只接受
  完整 `pg_restore --list` entry，不接受包含目标片段的任意文本；每条失败路径只清理固定临时项与未完成
  final，不覆盖既有 evidence；
- capture 的每个 Docker client 步骤使用固定且不同的 name/label，启动前必须确认 identity 不存在；正常退出、
  overflow、timeout 或 client 异常后都必须等待 Docker client 真正 `close`，并在最多约 4.9 秒的晚创建窗口中
  回查。只有 image digest 与 label 精确匹配时才可强制删除遗留容器，并再次 inspect 证明不存在；未知同名
  容器永不删除；
- rebuild 只启动 fixed-name、`--network none`、无端口/host volume/named volume、tmpfs PGDATA 的 scratch，
  精确应用 14 条 migration 与 hash-pinned fictional seed。只有固定 baseline/chain/runtime/absence contract
  全部通过、scratch 已删除且 inspect 确认不存在后才写 evidence；start race 中出现的未知同名容器必须保留
  并失败关闭，不能无条件 `rm --force`；
- 首次真实 rebuild 在启动前安全失败：OrbStack 的 absent container inspect 返回 exit 1 + 精确 `[]\n`，旧
  guard 只接受 exit 1 + empty stdout。共享 absent predicate 现在只接受这两种已验证形态，并同步用于 capture/
  rebuild pre-start、late settle 与 post-removal；空白、无换行 `[]`、任意 JSON/文本、exit 0 或未知同名 identity
  继续失败关闭；该次失败未启动 scratch、未生成 evidence；
- clean `b329e97` 上的第二次真实 rebuild 仍在 scratch start 前安全失败；连续五次只读 inspect 都返回 exit 1 +
  stdout 精确单个换行 `\n`。共享 predicate 因此只再加入这一种真实形态；empty、`\n`、`[]\n` 之外的空白、
  无换行 `[]`、JSON/文本、exit 0 与未知同名 identity 仍全部拒绝。该次失败同样零 scratch、零 evidence，未
  连接 Hosted、发送邮件或产生 deployment；
- clean `699d16e` 去除错误 PGDATA override 后，真实 scratch 可以启动，但旧 readiness 只看
  `pg_isready`：Supabase 镜像的初始化临时 postmaster 约 250ms 即可连接，完整 init scripts 与最终 PID 1
  postmaster 则约 170 秒才完成。安全诊断容器保持 `--network none`、无端口/挂载并在每次探测后销毁；
  Fresh RED 证明 baseline 会在最终 postmaster 前执行。rebuild 现只接受 `postmaster.pid` 精确 `1\n` 后的
  `pg_isready`，固定五分钟超时并继续在失败时零 evidence；clean `8916af5` 的后续 exact rebuild 仍等满
  五分钟失败，最终 local-only debug 证明真实 PID 文件首行与 `pg_isready` 都正确，但镜像内 BusyBox `head`
  拒绝 GNU 长选项 `--lines=1`。回归先固定 portable argv 并变红，最小修复改为 `head -n 1`；真实 evidence
  rebuild 尚待 clean 候选提交后重试；
- Fresh RED 为 artifacts/capture/rebuild 三个 module 均 `ERR_MODULE_NOT_FOUND`。实现阶段先完成离线 fake 与
  本机文件系统测试；随后两次 exact rebuild 均在 scratch start 前安全失败，没有成功执行重建，也没有连接
  Hosted、执行 dump/restore、生成真实 evidence、应用 0014、发邮件或部署。

## 2026-08-24：Hosted 本机 Docker 检查按平台固定 socket/executable 并拒绝环境选择器

- `/var/run/docker.sock` 不是 macOS OrbStack 的可靠实际入口。macOS 只允许从 OS 当前用户信息派生的
  `~/.orbstack/run/docker.sock`，并直接调用 `/Applications/OrbStack.app/Contents/MacOS/xbin/docker`；Linux
  保留 `/var/run/docker.sock` 与 `/usr/bin/docker`。不得硬编码 username、读取 `HOME`、搜索 `PATH` 或接受
  任意 env socket；
- `DOCKER_HOST` 或 `DOCKER_CONTEXT` 只要存在（包括空值）就必须在任何 process spawn 前失败，而不是静默
  删除后继续。socket 必须是 Unix socket，Docker executable 必须是固定 regular executable；远程 TCP/
  context、缺失 target 和不支持平台均失败关闭；
- Docker Hub 的本机 `RepoDigests` 会省略 `docker.io/`，且 official image 会再省略 `library/`。local verifier
  只接受锁定 Docker Hub repository 的该 canonical name 与同一 index digest，不接受 ECR alias 或其他 digest；
- platform image inspector 保留独立 32 KiB bounded JSON reader；executor 的 256-byte version/status reader
  不得覆盖它。当前真实 runtime 五项均通过后，readiness 仍必须因为 reviewed writer 未 pinned 而固定失败，
  不能创建 dump、manifest、scratch 或其他 evidence。

## 2026-08-24：Hosted scratch 以 CLI 源码派生的完整双平台 image lock 为唯一 service graph

- 完整集合不能由手写镜像清单或 `strings` 猜测。以 Supabase CLI `v2.115.0`/commit
  `18ae43a34a2257458197b62f74e2a97e2b5cf7f9` 的 embedded Dockerfile、默认 config、start gate/service
  source 与仓库 `supabase/config.toml` 共同派生，并记录六个 upstream source SHA-256；
- 固定 scratch 不传 `--exclude`，也不接受 `SUPABASE_*_ENABLED` 或 `.temp/*-version` override。14 个 start
  service 中 11 个 active；Realtime 显式 false、ImgProxy 的可选 image-transformation section 缺失且默认
  false、Supavisor 的 pooler section 缺失且默认 false，因此三者不启动；
- 11 个 active exact tag 同时固定 Docker Hub primary registry 的 OCI/Docker index digest，以及
  `linux/amd64`、`linux/arm64` platform manifest digest。index 是 tag 的跨平台内容身份，platform manifest
  是特定运行架构身份，两者不得混称；
- 静态 lock verifier 零 Docker/零网络，并以独立 SHA-256 tripwire 绑定完整 lock 内容，不能只靠 digest 格式
  检查；本机 verifier 只允许固定 Unix socket 的 `docker image inspect`
  index-digest reference，不含 pull/build/run/start/registry manifest。CLI 自身在 cache miss 会 pull，因此
  普通 `supabase start` 仍禁止；镜像尚未经单独批准获取并本机验证，writer 也未落地，readiness 继续失败。

## 2026-08-24：Hosted backup runtime 以 digest-pinned image 为唯一客户端，但完整 platform lock 缺失时仍禁止写

- host 安装的 PostgreSQL 14.6 不再参与 Hosted backup。唯一候选 client/runtime 固定为 Supabase CLI
  2.115.0 对应的 `supabase/postgres:17.6.1.159` OCI index digest
  `sha256:86a2e078779e5bdccda1f6f6c5063aa9779a322d1fface5fb408d051909b230f`；readiness 只从固定本机
  `unix:///var/run/docker.sock` 读取 local image metadata，不继承 `DOCKER_HOST`/`DOCKER_CONTEXT`，也不 pull；
- 只固定 PostgreSQL image 不等于固定完整 Supabase scratch。Auth/Storage platform baseline 由额外服务及其
  migrations 建立；未把所有实际镜像 digest 固定、逐一 local-only 验证并证明 CLI 不会隐式 pull 前，
  `pinnedScratchRuntimeReady` 必须为 false，不能生成 rebuild manifest；
- raw Hosted 密码不得作为 `docker --env PGPASSWORD=...` 或 secret-bearing argument 进入 daemon/container
  metadata。未来 writer 只能创建固定 `0600 .pgpass` 与 CA 文件、read-only mount，并向容器暴露固定
  `PGPASSFILE`/`PGSSLROOTCERT` path；失败必须按固定范围清理；
- at-rest gate 在当前 macOS 验收机只接受 `fdesetup status` 精确返回 `FileVault is On.`。完整 platform lock、
  本机 pinned image 离线运行与 reviewed writer 缺失时，三个 exact readiness 继续固定失败且没有 write
  interface；不得为推进 0014 手写 evidence。

## 2026-08-24：Hosted 重要 migration 前先关闭备份与可重建证据门

- Supabase Free 无可依赖的自动备份，0014 不能只凭 migration dry-run 与离线测试进入实际 apply。每个
  重要批次固定需要 pre/post raw logical dump evidence，以及从仓库 migration + fictional seed 在隔离
  scratch 重建的证据；preflight 必须位于实际 migration apply 之前；
- raw logical dump 可能包含 Auth database rows、Storage metadata、邀请与业务记录，是严格敏感备份，不再
  称为“脱敏 dump”；它不包含 Storage object bytes、global roles 或 Hosted platform config。禁止用伪匿名
  导出、表计数或 `pg_restore --list` 冒充可恢复备份；真实 capture/object export/restore/rebuild 必须单独批准；
- 新增固定 Singapore project/batch 的离线 plan、preflight 和 completion interface。plan 零 I/O；两个
  verifier 只读取本机 ignored 窄目录，失败关闭地验证 clean Git HEAD、strict `0700/0600`、普通文件、
  exact manifest、dump size/SHA-256、migration head、scratch cleanup，且不输出数据库内容或原始错误；
- 当前只实现控制面和证据格式，没有执行 Supabase 连接、dump、restore、migration apply、邮件或部署。
  Phase 81 动作账本在 preflight 真实通过前不得再把 0014 描述为 ready。
- 后续工具审计确认 `supabase db dump` 2.115.0 不提供 custom-format，当前本机 PG clients 14.6 又不能作为
  PG17 dump/restore runtime；仓库缺 pinned scratch image digest 与 reviewed write executor。新增的
  pre/rebuild/post readiness 因而必须固定失败且不能写 evidence。未来数据库 archive 只能在 coverage
  contract 后声称包含 Auth rows 与 Storage metadata；Storage object bytes、global roles 与 Hosted platform
  config 不在覆盖内，objects 非零时另行 export。

## 2026-08-24：Hosted Email OTP 位数是六位产品契约，不再是未验证的 Dashboard 默认值

- 普通邀请真实注册收到 8 位验证码，而 Web/API 表单与 strict contract 只接受 6 位；根因是 Hosted
  Supabase `mailer_otp_length` 漂移为 8，不是 Resend 改写邮件，也不能以前六位或后六位代替；
- Cloud V1 继续固定 6 位 ASCII 数字。Hosted 已在用户明确授权下只把 Email OTP length 从 8 保存为 6，
  独立重新加载回读为 6；Email OTP expiration 保持 3600，本步骤不修改 Site URL、Redirect URLs、邮件
  模板、Custom SMTP、DNS、环境变量或密钥，也不发送邮件；
- 新增固定项目、只读优先的 Hosted Auth config verifier。apply 只允许 exact confirmation、只 PATCH
  `{mailer_otp_length:6}` 并在写后重新 GET；禁止使用会覆盖其他 Auth 设置的整份 config push；
- 已发出的 8 位 OTP 不会因配置改正而变成 6 位。注册链路必须先提供绑定同一 invitation claim/identity
  的受限重发能力，再发送新的六位验证码；不得截取旧码、创建第二张邀请或删除 Auth user 绕过。

## 2026-08-24：普通邀请创建以单飞和同键恢复保证不重复

- 普通邀请仍是不绑定邮箱的一次性链接，但 Hosted 验收的授权收件人必须使用不同于现有 First Operator、
  且管理页精确账号搜索为零的未使用邮箱；创建接口不能把“已授权邮箱”误写成已绑定或已发送；
- Web 创建动作在请求期间单飞并禁用。每次新尝试只生成一个内存态 Idempotency-Key；响应不确定时只能
  用同一键恢复同一邀请和一次性 path，禁止生成新键盲目重试；严格成功后才清除恢复键；
- 新尝试开始时立即清除旧的一次性 path。错误文案只能说明“结果未知”，不能声称“未创建”；组件刷新
  会丢失恢复键，因此仍遵守“先按公开邀请状态撤销未知 active，再创建替代项”的既有收口。
- 该变更以 Web-only arm `9b0860a` 产生唯一 Ready deployment `V3NzjTYXtH7fb3WC2P6hpWR1twhb`，独立
  `1d1f567` disarm 零新增；当前默认非 Canceled API/Web 更新为 16/9，双项目继续关闭。

## 2026-08-24：Hosted Cron 安装必须经受控四阶段工具，不再手贴 SQL

- Hosted acceptance 的五项 Supabase Cron 不再要求用户在 Dashboard 粘贴长 SQL 或输入 job ID。新增固定
  project-ref 的 plan/status/apply interface；status 复用 verify-full 管理员 adapter，只输出固定安全
  boolean/stage/count；
- apply 必须依次完成独立只读 preflight、**完整未改写** operations SQL 第一次事务、同一完整 SQL 第二次
  事务、独立只读 postflight。禁止剥离 `BEGIN/COMMIT`、把两次合并成一次或只靠静态测试宣称重跑成功；
  第一次已提交后后续失败不得冒充全局 rollback，只能返回固定 failure stage 并先重读 status；
- status 只查询 Vault 两个名称，不查询/输出 decrypted value。Vercel Sensitive 值不可回读，因而工具不
  自动证明 API/Vault `CRON_SECRET` 连续性；exact confirmation 必须建立在同一受控来源的外部连续性和
  已完成真实 R3-C 收件/重复/无正文告警证据上，缺任一项均停止在只读 status；
- 离线 fake 只证明控制流、失败关闭与数据最小化；真实两次事务、exact 五 job、至少两周期、五 route 和
  401/5xx/timeout 恢复仍是独立 Hosted 发布门。

## 2026-08-24：Hosted 剩余运行门共用固定安全只读快照

- R3-C、Supabase Cron 与 Cloud DeepSeek 的数据库侧验收不得继续依赖用户手工识别或输入 request ID、
  price UUID、notification ID 等 opaque 值；新增固定 Singapore project-ref 的统一 snapshot，自动选择
  latest analysis request，并以一次 `BEGIN READ ONLY` 管理员事务回读；
- 输出只能是 31 个有序的 boolean、受限 enum 和 64-bit 非负聚合计数。Cron 只读取两个 Vault secret
  **名称**；不得查询或输出 Vault 值、邮箱、用户/请求/通知 ID、原文、结果、金额或原始数据库错误，任何
  字段数量、顺序、名称或值域漂移都固定失败关闭；
- snapshot 只证明当前数据库 catalog/聚合/对账状态，不能替代真实 Resend 收件与重复观测、Cron SQL
  连跑两次及 HTTP 周期、DeepSeek Provider/Dashboard/账单或 90 秒 timeout。它不得发送邮件、调用模型、
  安装或触发 Cron、切换 kill switch，也不得写数据库。

## 2026-08-24：普通邀请列表必须显示四态并为丢失链接提供撤销收口

- 真实 Hosted 运营台证明历史邀请只显示 ID/过期时间时，终态行因无撤销按钮而无法区分已领取、已撤销
  或已过期；该表现不符合既有“创建或撤销邀请”产品要求，不能解释为有意的 metadata-only 设计；
- 不新增数据库字段或公开秘密。Web 使用 strict list 已有的 `consumedAt/revokedAt/expiresAt` 投影
  “可领取/已领取/已撤销/已过期”，只为可领取项提供二步撤销；服务端继续作为状态与授权唯一权威；
- 丢失一次性 fragment 时不恢复 token。Operator 重新认证后撤销对应可领取项；无法唯一定位时撤销所有
  可能受影响项后再创建。撤销保持 Origin/CSRF/Idempotency、same-key replay、单一空 safeDetails 审计和
  既有最小角色 grant；确认发起撤销当前创建项时立即清除内存 output，响应不确定时先重读权威状态，
  不允许保留 path 或盲目重复撤销。

## 2026-08-24：Hosted deployment plan 改为当前动作账本

- 静态部署计划不得在环境已推进后继续把 migration、foundation bootstrap、BootstrapInvitation、First
  Operator complete 或首次部署列为未来动作；计划改为零网络/零写入的 current action ledger，固定记录
  已完成且禁止重跑的门、当前 deployment/disarm 证据、下一项用户门和剩余外部依赖链；
- current ledger 必须由回归测试锁定 Latest source/deployment、非 Canceled count、独立 disarm 零新增及
  双关闭；Phase 78 后固定 API `4f1ce4a` / `6QeRbqxgA88cFXggKekkr2axH9JM`、API/Web 16/8，不能把历史
  `39094d0` / 15 条或已完成的 `/admin` 门继续输出为 current；
- Hosted 当前顺序固定为：明确授权一个收件人并创建唯一普通邀请 → scanner-safe OTP/Auth SMTP → R3-C
  真实投递/重复/告警 → 五项 Cron → 受审计 kill-switch 切换与一笔 Cloud DeepSeek 应用路径请求/账本
  对账 → 恢复 kill switch。不得用第二张 BootstrapInvitation、直接创建 Supabase 用户、SQL 或 Classic
  smoke 绕过产品路径；
- Vercel Settings/资源页的只读证据可关闭 Fluid Enabled、Singapore `sin1` 与 Latest Function `≤120s`，但
  不能关闭 90 秒应用 abort 与平台终止的 Observability 门；后者必须与获批的真实 Cloud DeepSeek 请求绑定。

## 2026-08-24：Hosted Web 固定最小安全响应头并保持 production origin 失败关闭

- 当前 acceptance Web 线上响应只有平台 HSTS，仓库没有 CSP、Referrer-Policy、nosniff 或
  Permissions-Policy；改为由 `apps/web/vercel.json` 对全部 path 统一输出四项固定响应头，避免依赖
  Dashboard 手工状态；
- CSP 只允许同源可执行/样式/字体/manifest、`data:` 图片和 acceptance exact API origin 的
  connect/form，显式禁止 object/frame/worker/frame ancestor；`form-action` 另精确允许当前 Supabase
  project 与 Google account origin，以兼容 Chrome 对 Google 注册原生 POST 后 302 链的检查，但 Provider
  不进入 script/connect，也不使用 wildcard；
- 正式 production origin 尚未冻结，不能猜测加入共享 allowlist；正式发布必须先冻结 exact Web/API
  origin 并校准 CSP。COOP 因 Google redirect/popup 兼容性尚无浏览器证据而延期为独立决策。本次只形成
  disarmed 候选，远端必须另走 Web-only 受控 deploy/disarm 与 header/auth 回读。

## 2026-08-24：Cloud Web 改为内容优先的个人语言工作台

- 保留七项一级导航、路径、权限和业务状态机，把外壳从通用管理后台改为暖色纸张画布、窄章节索引、
  编辑式标题和低装饰阅读表面；筛选与手动维护动作使用原生 `details/summary` 渐进披露；
- 完整账号的 Google、密码与邀请确认固定进入 `/practice`，突出当前最值得完成的练习；`/app` 继续是
  “待整理”，data-rights 仍只进入 `/settings/data`；
- 视觉值继续使用 primitive→semantic→component token，不引入远程字体或 UI 依赖，并保留 AA、键盘、
  reduced-motion、390px 与桌面验收。

## 2026-08-23：密码注册改为显式邮件 OTP，并增加已确认中断账号原子恢复

- 真实首位账号确认暴露两个缺口：动态 flow 未被 Supabase exact redirect allowlist 匹配，以及邮件扫描器
  可先消费 `ConfirmationURL`。Confirm sign up 改为显示 `{{ .Token }}`，CTA 只用
  `{{ .RedirectTo }}`；GET confirm inert，用户显式 POST OTP 后才验证；
- redirect allowlist 固定为五条 path + `\?flow=` + 43 个单字符 wildcard，禁止 `*`/`**`；password path
  从 callback 改为 `/v1/auth/password/confirm`；
- bound expired claim 不再由普通 claim 重领删除；新增 0013 原子恢复函数，以原 invitation token、Provider
  password proof 和精确中断状态完成 profile/method/quota/invitation/claim/flow；
- First Operator 新增 `registration-interrupted`。当前中断环境不能运行要求 identity 空状态的 pristine
  foundation verifier；恢复前使用 migration/ACL diagnostic、application verifier 与该精确状态。

## 2026-08-23：首张邀请前增加 Google 双端能力门与 Operator 完成后独立验证

- hosted Google Provider 保持 disabled，但 Phase 70 Web 仍显示 Google 动作；改为 API/Web 两个 strict
  optional capability，缺失即分别“不挂载路由”与“不显示控件”，未知值拒绝。两个 capability 必须同批
  显式启用，当前 Vercel environment 结构保持不变；
- 本机 acceptance 不再因 simulated model 自动显示 Google；只有离线 Google E2E 构建显式启用，避免用户
  点击不存在的 Provider。Classic/Store 协议与技术 Huayi identifiers 不变；
- 密码待确认文案校准为邮件链接成功后自动进入工作台，离线旅程从旧 `/v1/auth/callback` 修正到专用
  `/v1/auth/password/callback` 并验证 no-store/no-referrer；
- `status=completed` 只保留有界状态提示；新增独立 post-completion verifier 严格验证首位账号链、仍开启
  kill switch 与零业务使用，输出不含账号或数据库细节；
- 因现有 API/Web deployment 都早于本修复，发行首张邀请前新增 API→Web 各一次 one-shot deploy/disarm
  门，随后才回读 Supabase 邮件模板并开始 72 小时有效期。

## 2026-08-23：Hosted Web 必须显式构建运行时 workspace 依赖

- Vercel 使用干净 checkout，仓库忽略的 `packages/learning-domain/dist` 与
  `packages/cloud-contracts/dist` 不存在；Web 直接运行 Vite 会在解析 `@huayi/cloud-contracts` 的
  `./dist/index.js` export 时失败；
- Web 的 repository override 固定改为 `pnpm build:vercel`：先按依赖顺序构建 learning-domain 与
  cloud-contracts，再运行 Web Vite build。Dashboard 空 project bootstrap 的历史 setting 仍为
  `pnpm build`；`vercel.json.buildCommand` 负责覆盖它，不重写历史证据或对已有 deployment 的空项目工具；
- 回归必须锁定 `vercel.json`、Web package script 与完整依赖顺序，并在临时缺失 cloud-contracts `dist`
  时证明专用构建仍成功。下一次真实 deployment 日志必须显示 `pnpm build:vercel` 以及
  learning-domain → cloud-contracts → Web Vite；否则不能把修复记为远端通过。

## 2026-08-23：Hosted 首个账号前先单独部署 Web，再验收 Auth 与 DeepSeek

- Phase 68 中“DeepSeek/Auth 在 Web 零部署时先完成”的顺序不可执行：Cloud 模型路径需要真实 Web
  session，hosted 模型 kill switch 当前保持开启；真实 Auth/SMTP 又必须经 FirstOperatorBootstrap 邀请、
  API callback 和 Web 落点，不能直接创建 Supabase 用户绕过首账号空状态保护；
- 正确顺序固定为：保持 API Git deployment 关闭 → 只武装 Web 的精确 production branch → Web
  deployment 记录产生后立即用独立提交恢复 Web `deploymentEnabled=false` → 验证 Web/TLS/公开页面/
  build identity/secret-free bundle 与零账号公共 API 边界 → 发行首张 BootstrapInvitation → 正常密码注册、
  SMTP 确认和 callback → complete 首位 Operator → 由 Operator 受审计地临时关闭模型 kill switch →
  DeepSeek 应用路径小额 smoke 与账本对账；
- `pnpm smoke:deepseek` 属于 Classic Native Host，不得冒充 Cloud hosted runtime。不得新增公开 smoke
  endpoint、直接创建 Auth 测试用户、手插 profile/admin、用 SQL 绕过 Operator 切换 kill switch，或同时
  武装 API 与 Web；
- Web armed 窗口沿用 API 的事故教训：任何状态的首条 deployment 一旦出现，唯一允许的下一次 push 是
  Web disarm；armed 窗口内禁止夹带修复提交。真实模型费用虽已获小额批准，kill switch 切换、账号建立与
  邮件投递仍分别按产品路径验收。

## 2026-08-23：Sensitive 变量轮换必须以保存回执和新 deployment runtime 共同验收

- 点击 Vercel 环境变量名称会复制变量名，不能用该控件定位 Rotate 后再依赖原剪贴板；必须点击行尾操作
  菜单，并在精确 Rotate dialog 内填写值。提交成功至少同时要求 dialog 关闭、固定 Rotate 成功回执与变量
  更新时间刷新；只看到 Redeploy dialog、Ready deployment 或旧成功 toast 均不能证明新值已保存；
- Sensitive 值不可回读，结构校验只能在提交前以内存布尔结果完成且不得输出值；提交后必须清空系统与浏览器
  剪贴板。任何环境变更只由随后新建的 deployment 使用，旧 deployment 不得作为新值证据；
- Git deployment 已关闭时，允许从已审查的精确 source 进行单次 Dashboard redeploy，不得为了应用环境变更
  重新武装分支。失败 deployment 与脱敏启动日志必须保留；先通过 `/health`，再运行无写入 DB-backed 探针。

## 2026-08-23：API armed 窗口改为受控部署后立即重新关闭

- Phase 65 的 exact branch allowlist 只能保证 API-only，不能保证“一次 push 只产生一次部署”。API 保持
  armed 时，同一 production branch 的每次修复 push 都会继续触发 API；因此后续不得把 branch allowlist
  本身称为 one-shot 保证；
- 部署前必须先冻结候选、完成 secret/runtime 轮换和离线门，再允许一次受控 push。新 deployment 记录一旦
  产生，无论状态为 Ready/Error 或后续 smoke 成败，唯一允许的下一次 push 都是用独立提交恢复 API
  `git.deploymentEnabled=false`；确认该关闭提交没有产生 API/Web deployment 后，才运行 health、数据库、
  Provider 与 Auth smoke。该关闭不得依赖操作者在 Dashboard 手工停止自动部署；
- Vercel Sensitive Rotate 只影响下一次 deployment，不追溯修改既有 deployment。固定 `/health` 不执行
  SQL，不能证明 application role、CA、密码、RLS/context 或新 DSN；runtime 数据库门必须由 Rotate 后 exact
  SHA deployment 加 DB-backed smoke 关闭；
- 已经产生的 API deployment 历史不删除、不伪装成零部署；保留失败与修复链作为证据。Web 继续全分支
  关闭，只有 API 重新关闭并完成实际 runtime 验收后才单独解锁。

## 2026-08-23：Hosted application 验证拆分固定 contract，并校正 Supavisor TLS 证据

- 管理脚本与 Vercel runtime 继续固定 transaction pooler `6543`；application 隔离验证器改用 session
  pooler `5432`，以同一个 psql 连接确定验证同 backend 跨事务 context 清空，验证器端口不得进入 runtime；
- 删除 application SQL 中的 `pg_stat_ssl` 判据。经 Supavisor 时该视图观察 pooler 到 PostgreSQL 的 backend
  链路，不能证明客户端到 pooler 的 CA/hostname 验证；客户端门禁继续强制 `sslmode=verify-full`、固定 CA
  和不可降级的 `PGSSLMODE` / `PGSSLROOTCERT`；
- 正式 verify 拆成六项权限 contract、三项 context contract 和 postgres 越权拒绝；diagnostic 先执行固定
  `SELECT true`，再输出 allowlisted TLS/contract/context 阶段和固定 psql exit class，不输出 stderr、SQL、
  SQLSTATE、PID、密码或动态内容；禁止 postgres 切换作为独立探针，在客户端连接成功后不依赖其他 contract；
- 密码轮换后的第一版诊断已确认连接成功而旧组合 SQL 未完成；拆分后的真实 hosted verify 必须重新通过，
  离线回归不能替代远端门禁。

## 2026-08-23：首次 hosted deployment 改为 API-only one-shot 分支 allowlist

- API `git.deploymentEnabled` 从全分支关闭改为 `"**": false` 加
  `"codex/settings-configuration": true`；显式全局拒绝用于避免未声明分支继承平台默认允许；
- Web 保持 `git.deploymentEnabled=false`。首次 push 只能产生 API Production deployment，不得同时部署
  Web；分支 allowlist 不按文件路径过滤，因此 API armed 期间禁止无关 push；
- 本节的“smoke 后关闭”顺序已被上方“产生 deployment 后先关闭”决策取代。受控 deployment 记录产生后，
  必须先用独立提交把 API 恢复为 `false` 并确认关闭提交没有触发新 deployment，再记录 deployment
  ID/SHA/runtime/region/alias 与 smoke 证据；关闭后才允许准备 Web 的独立解锁提交。

## 2026-08-23：Hosted acceptance 环境完成后以首次 API health gate 验证真实组合

- Supabase Auth 固定一个 Site URL 和五条 exact API redirect，不允许 wildcard；API/Web Vercel 环境均只
  使用 Production，API schema 为 21 项（9 Sensitive、12 public），Web 为 2 项 public；
- `HUAYI_STORE_EXTENSION_ID`、`VITE_ACCEPTANCE_MODEL`、`VITE_DEPLOYMENT_COMMIT` 和人工创建的
  `VERCEL_GIT_COMMIT_SHA` 必须不存在。Vercel 平台在真实 deployment 时提供 commit SHA；
- Vercel Sensitive 值托管后不可回读，因此远端结构复核不能伪装成完整值 composition 验证，也不能为了
  重跑 `acceptance:hosted:deployment --verify-environment` 旋转已托管 Secret。首次 API deployment 必须
  由启动与 `/health` gate 失败关闭验证真实组合，成功后才能继续 Web、邮件、Cron 和邀请；
- 三项本地生成 Secret 只以固定 service 名和 project ref account 保存在 macOS login Keychain；文档不记录
  值。数据库 DSN、Provider key 与 Reply-To 值同样不得写入仓库或状态证据。

## 2026-08-23：Hosted acceptance 邮件凭据分离与配置门部分关闭

- 对话中泄露的旧 Resend key `seensaid` 已在 Dashboard 撤销；一次误建的 Full access R3-C key 与一次
  因工具诊断暴露的临时 domain-scoped R3-C key 也均在未使用前撤销。任何 token、prefix 或 secret value
  均不进入仓库、证据或日志；
- Resend 当前只保留两把验收 key：`seen-said-acceptance-supabase-auth-smtp` 与
  `seen-said-acceptance-r3c-http`。两者均为 Sending access、仅限
  `notify.acceptance.seen-said.cn`，并分别用于 Supabase Auth Custom SMTP 与应用 R3-C HTTP sender，
  禁止复用；
- Supabase project `kpadiulxkgckskcfydry` 已启用 Custom SMTP：`smtp.resend.com:465`、username=`resend`、
  sender=`语见 <accounts@notify.acceptance.seen-said.cn>`，密码使用独立 SMTP key 且不可回读；
- Vercel API project `seen-said-acceptance-api` 已在 Production 托管 R3-C key 为 Sensitive，并配置
  notification mode=`resend`、固定 security sender 与用户确认的 Reply-To。Web project 在本阶段当时未改，
  API 仍为 `No Production Deployment`；本阶段没有发送真实邮件、发起 API/Web deployment、安装 Cron 或
  发行邀请。后续 Phase 64 已补齐 Auth 与 API/Web Production environment 结构；下一门为受审查解锁后
  执行 API→Web deployment 与邮件/应用 smoke。

## 2026-08-23：Hosted acceptance Resend sender 域名门关闭

- Resend sender domain 固定为 Tokyo (`ap-northeast-1`) 的
  `notify.acceptance.seen-said.cn`；Cloudflare `seen-said.cn` 保留既有
  `api.acceptance` / `app.acceptance` CNAME 不变，并新增且公共解析核验 Resend 指定的 DKIM TXT、
  `send.notify.acceptance` 的 priority 10 feedback MX 与 SPF TXT，以及根域监测策略 DMARC TXT；
- Resend Dashboard 最终显示 `Domain verified: Your domain is ready to send emails`。这只关闭验收 sender
  域名与 DNS 门，不创建或记录任何 API key，也不等于 Supabase custom SMTP、R3-C HTTP credential、真实邮件
  投递、告警接收、应用 deployment 或 production ready；
- 两个 Vercel acceptance project 回读仍为 `No Production Deployment`。后续 Phase 63 已完成旧 key 撤销、
  分离 SMTP/HTTP credential 托管、Custom SMTP 与 R3-C 部分 Production 配置；真实邮件、完整
  production-only environment、受控 API→Web deployment、应用/邮件 smoke、Cron 与首张邀请仍待后续门禁。

## 2026-08-22：Hosted acceptance DNS 与 TLS 门关闭

- Cloudflare `seen-said.cn` 已保存并回读两条 DNS-only CNAME：`api.acceptance` → `7cb58e1372474614.vercel-dns-017.com.`，`app.acceptance` → `f0cbaadacf303110.vercel-dns-017.com.`；Proxy disabled、TTL Auto；1.1.1.1、8.8.8.8、9.9.9.9 均解析到精确 CNAME；
- Vercel 两个 custom domain 均 properly configured。两端 HTTPS 的 `curl ssl_verify_result=0` 通过，部署前返回预期 404，zero deployments 仍保持；不表示应用已部署或 production ready；
- 下一门是 Resend verified sender subdomain/DNS、production-only environment、Supabase Auth/SMTP。对话中
  泄露的旧 Resend key 撤销状态尚未核验；必须视为已泄露且不可使用，并在 Resend Dashboard 确认撤销。

## 2026-08-22：Vercel Git 与 Production Branch 门在零部署下关闭

- `seen-said-acceptance-api` 与 `seen-said-acceptance-web` 均已连接精确 GitHub repository
  `Neil0619/huayi`；两个 project 的 Preview environment 继续为 `Disabled`，Production Branch Tracking
  均固定为 `codex/settings-configuration`；
- Root 独立回读两个 project 的 Git、Environment 与 Deployments 页面：均为
  `No Production Deployment` 且没有 deployment 记录，Production environment 均为
  `No Environment Variables Added`；本轮未接受 GitHub App permission upgrade，也未执行 domain、
  environment variable 或 deployment 动作；
- Git/Branch Tracking 门通过不等于首次部署已武装。仓库 `git.deploymentEnabled=false` 继续禁用所有 Git
  deployment；只有 production-only environment、domain、Resend、Supabase Auth/SMTP 全部完成并复核后，
  才能通过另一次受审查提交收窄并解锁受控 production branch，然后按 API→Web 执行首次部署。

## 2026-08-22：Production Branch 改为 Git 连接后的零部署门

- 真实 Dashboard 证明未连接 Git 时 `Settings → Environments → Production` 只有 `No branch configuration`，
  不提供 Production Branch Tracking；旧的“连接前设置 Production Branch”顺序无法执行；
- 新顺序固定为 project settings 与 Preview=`Disabled` 回读 → API Git connect → 零 deployment 回查 →
  API Production Branch Tracking → 再次零 deployment 回查 → Web 重复同一流程；Production Branch 固定为
  `codex/settings-configuration`；
- 仓库 `git.deploymentEnabled=false` 与 Dashboard Preview Disabled 是两个独立保险，均须保留；Git connect
  和 Branch Tracking 保存都不得冒充 deployment，任何一步出现 deployment 立即停止后续外部操作。

## 2026-08-22：Vercel 空 shell 以 canonical GET 判定并接受安全平台默认值

- 真实 name-only create 证明 Vercel 会把新 project 的 `sourceFilesOutsideRootDirectory` 默认设为 `true`；
  该值与冻结目标一致，且 Dashboard 已证明 Build/Output/Root 仍为空、Git 未连接、deployment 为零，因此
  不再把它单独视为部分配置漂移；
- create response 只作为成功确认，不再承担完整安全投影。POST 后必须重新 GET 同 team/name 的 canonical
  project，再验证精确 identity、无 Git/environment/custom environment/alias/integration、其余空壳设置与
  Deployments API 空集合；canonical GET 的任何其他漂移仍失败关闭；
- 首次真实写入已留下 API 安全空 shell，但没有执行 settings PATCH、Web create、Git connect 或 deployment。
  重跑按既有幂等协议复用 API shell 后继续，不删除或覆盖未知远端状态。

## 2026-08-22：Vercel 空 project shell 改用失败关闭、可重放的固定 REST bootstrap

- 不再让操作者临时拼接 Vercel 请求：固定 CLI 先通过 token-scoped Teams API 精确解析
  `neil0619s-projects`，同时预检 API/Web 两个 project，只有不存在、全空 shell 或冻结设置完全一致且
  无 Git、deployment、environment/alias/integration 的状态才能继续；
- project create 只发送 name，不附 `gitRepository`；随后用官方 Projects PATCH 字段冻结 Root、Framework、
  Node 22、monorepo 外部 source、Preview 禁用请求与 API/Web 专属设置，并在写入前后查询 Deployments API
  确认仍为空。任何漂移或部分失败立即停止，安全空 shell 可幂等重跑；
- 当前官方 project GET schema 不返回 `previewDeploymentsDisabled`，因此该字段虽由 PATCH 幂等请求，仍必须
  在 Dashboard 回读；Production Branch 也继续只在 Dashboard 设置。脚本不得据此连接 Git、创建 domain/
  environment/deployment 或宣称 production-only 已关闭；
- Token 只允许从进程环境读取，计划完全离线，状态输出有界且不包含远端正文或资源 ID。本条只冻结仓库
  工具与外部执行协议；`apply/status` 必须兼容 pnpm 转发产生的单个参数分隔符，但分隔符移除后仍精确
  校验固定确认参数。失败输出只允许白名单 stage/reason 和 HTTP status，不得回显 URL、请求体、Token、
  team 数据或第三方错误正文。

## 2026-08-22：Vercel 首次 Git 连接增加全分支 deployment kill switch

- API/Web 两份 `vercel.json` 新增官方 `git.deploymentEnabled=false`；GitHub repository 连接期间所有分支
  都不能自动触发 deployment，避免环境、域名和 Auth/SMTP 尚未完成时提前发布；
- 首次创建顺序冻结为 Projects REST API 空 shell → REST PATCH project settings → Dashboard 回读 Preview
  Disabled → CLI Git connect → 确认零 deployment → Dashboard 设置 Production Branch
  `codex/settings-configuration` → 再次确认零 deployment；
- 准备首次正式发布时必须另做一次受审查提交，按当时官方 schema 只允许受控 production branch；不得在
  本次连接提交中开放所有分支，也不得把 Dashboard Production Branch 冒充为仓库 JSON 配置；
- 本条只改变离线配置保险与 runbook；未创建 Vercel project、未连接 Git、未配置 secret、未产生
  deployment。

## 2026-08-22：Hosted 首轮允许显式关闭 Store capability，禁止占位 Extension ID

- API 部署必须显式设置 `HUAYI_STORE_EXTENSION_CAPABILITY=enabled|disabled`；缺失或非法值在启动前失败
  关闭。`enabled` 继续严格要求真实 32 位 `[a-p]` Extension ID 与最低版本；`disabled` 必须省略 ID，
  不能用重复字符或其他占位 ID 模拟；
- `disabled` composition 从 CORS 和 production 路由表移除 Store pairing/session/preferences/query/
  cloud-copy/self-disconnect surface；仍与 Web 共用的路由在查询 token 归属前拒绝任何 Extension
  authorization。Local acceptance 保持显式 `enabled`，Classic、Windows 与 Store 客户端不变；
- hosted 首轮固定 `disabled`，先验收 Web/API。完整 Store release audit 只接受 `enabled`，防止 Web-only
  hosted runtime 被误报为 Store 候选 ready；启用 Store 时必须提供真实 ID 并重新走发布与 Chrome 门禁。

## 2026-08-22：Hosted 角色图按 PostgreSQL 17 membership option 精确建模

- 三条产品直接边固定为 application login→runtime、runtime→business/context-setter；每个角色对必须且
  只能有一条 membership row，并精确要求 `admin=false`、`inherit=false`、`set=true`。成员角色均为
  `NOINHERIT`，不能继续按旧校验假设要求 `inherit=true`；
- PostgreSQL 17 的 CREATEROLE creator-control grant 允许形成 `postgres`→固定 Huayi role 的直接边；
  这些边因创建历史可以存在或不存在，存在时只能为 `admin=true`、`inherit=false`、`set=false`，不能以
  固定总行数或要求四条全部存在来判断角色图；
- 除上述三条唯一产品边与可选 creator-control 边外，任何涉及固定 Huayi role 的直接边都失败关闭。校验按
  角色对分组识别不同 grantor 的重复产品授权，bootstrap、管理员 verify 与只读 diagnostic 必须复用同一
  SQL 契约，避免三处规则漂移。

## 2026-08-22：Hosted application 先冻结可重复部署契约，再创建 Vercel 资源

- hosted acceptance 使用两个 Git-linked Vercel Hobby project，分别固定 `apps/api` Hono 与 `apps/web`
  Vite root；API Function 固定 `sin1` 靠近 Singapore Supabase、Fluid/120 秒，Web 固定 build/dist/SPA，
  两者显式包含 root 外 workspace source；
- Preview 不复用 production Supabase/Auth/Storage/secret；无独立 Preview 资源时保持禁用/失败关闭。部署
  只接受已记录 commit，Web 持续显示 `hosted-acceptance + short SHA`；公网 origin 不能启用本机 simulated；
- 当前 production API 强制完整 Resend hosted composition，因此邮件不是“API 裸部署之后再补”的可选项。
  Resend verified subdomain、分离 SMTP/R3-C key、Reply-To 与经批准 DeepSeek key必须先就绪；禁止填假 key；
- Supabase Auth 固定 Site URL、五条 exact API redirect、动态 RedirectTo 邮件模板和独立 SMTP；Google
  callback 与应用 callback 保持两层，不启用 Google 时允许继续延期；
- 外部写入顺序固定为 0012 migration/status empty → Vercel project/domain → Resend DNS/key → Auth/SMTP →
  production secrets → API/Web deploy → TLS/Cookie/CORS/SSE/callback → 五项 Supabase Cron → 首张邀请。

## 2026-08-22：首位 Operator 使用两阶段、无公开入口的部署引导

- hosted/production 空环境不能由既有 Operator 创建首张邀请，因此新增一次性 FirstOperatorBootstrap：
  DeploymentBootstrapAuthority 先发行唯一 BootstrapInvitation，用户仍走正常邀请/Supabase Auth/profile/
  sign-in method/默认额度事务，随后只把该邀请最终绑定的唯一账号晋升；
- 邀请来源显式区分 `operator` 与 `deployment-bootstrap`。部署管理员不是 HuayiAccount/Operator，私有
  bootstrap record 与邀请生命周期记录部署轨迹，不伪造 OperationalAuditEvent `actorUserId`；
- complete 不接收 userId/email/role；数据库在锁和空状态 guard 下从 finalized claim 推导唯一账号。
  明文 token 丢失时仅允许在零 claim/零 identity 前提下显式替换，协议完成后永久封闭；
- 首位账号永久删除不能被 deployment record 外键阻断；删除前只清除私有 record 的 operator UUID 并写
  deletion time，保留无身份的 completed 状态且不重新开放 bootstrap；
- 不新增公开 `/v1`/`/internal` route，不复用 local seed，不构造 Auth/profile，不产生 service-role Web
  session。设计与取舍见 `first-operator-bootstrap.md` 和 ADR-0023。

## 2026-08-22：Hosted PostgreSQL 必须 verify-full，并验证精确角色图与池化隔离

- 初版 hosted foundation/app login 验证能证明写入和登录成功，但 `sslmode=require` 未校验证书链与 hostname，
  membership 包含判断也不能排除额外授权；该证据降级为初步 apply 证据，不再充当最终安全门；
- 当时管理脚本与 application DSN 统一固定 Singapore Supabase transaction pooler、6543、同一 project ref
  和 `sslmode=verify-full`；application 隔离验证器后续由 2026-08-23 决策校正为 session pooler 5432，
  runtime 仍保持 6543。CLI 使用官方 CA 临时文件，Vercel 运行时使用 base64 CA 并显式
  `rejectUnauthorized=true`；缺失 CA、require-only、错误 pooler/project 或本机 DSN 漂移均失败关闭；
- role graph 必须恰好为 application login→runtime、runtime→business/context-setter，三条边均无 ADMIN
  OPTION；login 不能切换 postgres、在 public CREATE 或直接调用 set_owner_context。预期越权只有 SQLSTATE
  `42501` 且 psql exit `3` 才通过，网络/认证错误不能冒充拒绝；
- owner context 必须经事务 A 设置并 COMMIT，随后同一 backend 上开启未设置 context 的事务 B 并读到
  NULL；后续改为 session pooler 同一连接确定复用 backend，不再依赖 transaction pooler 碰撞重试；
  bootstrap 同时改为仅接受 pristine 或精确已应用的 private empty bucket 状态，保持安全幂等重跑。

## 2026-08-22：Hosted foundation 与首个 Operator 必须分离初始化

- hosted acceptance 不复用 `acceptance:local:bootstrap`、`supabase/seed.sql` 或本机邀请脚本：本机入口会
  关闭模型 kill switch，并写固定 `.localhost` 虚构 Operator；这些行为只适用于持续标识、零网络的本机
  模拟环境；
- hosted foundation 只允许固定 Singapore project，先验证 11 条 migration、42 张 public 表、33 张 tenant
  forced RLS 表和三个 NOLOGIN/NOBYPASSRLS 迁移角色，再幂等建立独立 NOBYPASSRLS application LOGIN
  role、三条环境专属不可变价格、`model_kill_switch=true` 和 private export bucket；Auth/profile/admin/
  invitation 必须继续为空；
- foundation 默认只有无副作用 plan。实际写入要求包含 project ref 的精确确认参数，管理员密码与 application
  role 密码只从进程环境送入固定 pooler，不进入参数、输出、仓库或日志；重跑不能旋转既有 role 密码、
  关闭 kill switch 或覆盖冲突价格/bucket；
- Supabase 托管 `postgres` 是管理员但不是 superuser；preflight 只要求当前角色为 `postgres` 且具有
  CREATEROLE，不能错误要求 `is_superuser=on`。后续 Supavisor application 用户名使用
  `<role>.<project-ref>`，连接密码必须 URL-encode；
- 首张邀请和首个 Operator 不属于 foundation。现有 `admin_create_invitation` 要求既有 Operator，形成启动
  闭环；该待定项现已由本文更上方的 FirstOperatorBootstrap 决策替代，不能用虚构 profile/admin row
  临场绕过。

## 2026-08-22：Cloud 运行时入口必须是精确 HTTPS origin

- `HUAYI_API_ORIGIN`、`HUAYI_WEB_ORIGIN`、`SUPABASE_URL` 与 Web 构建期
  `VITE_API_ORIGIN` 从“任意可解析 URL”收紧为精确 HTTPS origin：禁止明文 HTTP、用户名/密码、路径、
  query、fragment 和尾随 `/`；API 与 Web origin 还必须不同；
- 该约束同时适用于 hosted acceptance 与 production，并在进程启动或 Web bootstrap 前失败关闭，不能等到
  浏览器以 Cookie、CORS、OAuth callback 或路由错误暴露配置漂移；固定本机验收 HTTPS origin 保持不变；
- 真实域名、DNS、Vercel/Supabase 资源和 secret 仍是外部门禁；本变更只关闭仓库内配置校验缺口，不把
  静态校验冒充为托管部署证据。

## 2026-08-22：R3-C 固定 23 小时 Resend 窗口、8 次上限与第五个调度任务

- Resend notification ID 幂等键只有 24 小时保留窗口，因此安全通知 outbox 固定
  `created_at + 23 hours` delivery deadline 与最多 8 次 Provider 尝试；超窗进入 `failed`，耗尽进入
  `dead-letter`。claim 在 sender 前以最多 100 条批次终态化不可发送工作，再只领取一条有效任务；
- Provider 已发送但数据库 complete 失败只能在 deadline 内用相同 notification ID 重放。Resend adapter
  固定 HTTPS endpoint、20 秒请求上限、固定密码重置模板和稳定错误，不读取响应正文，不记录 API key；
- 新增独立 `/internal/security-notifications/run` CRON bearer route 与 bounded outcome。无正文 alert
  port 只接收固定 reason/count；不允许 email、owner、notification ID、正文或原始异常穿过该 port；
- Supabase operations SQL 从四个 job 扩为五个。本机验收显式使用只允许三个固定 localhost origin 的
  `disabled-local-acceptance`，route 返回 idle 且不访问 outbox/网络；hosted/production 必须使用 resend
  环境并由 secret store 提供 key/from/Reply-To；
- 新增 `0011` forward 与 Supabase 镜像，并同步最终 baseline；current baseline→0002…0011 直接重放。
  真实 DNS、verified sender、Resend 投递与监控接收方仍是外部门禁，不因离线实现关闭。

## 2026-08-22：默认额度按 UTC 月惰性续期，生产模型调用共享持久限速

- “注册时获得首月默认额度”扩展为完整生命周期：每次 production reserve 和 owner quota summary 都先
  幂等确保当前 UTC 月 `1_000_000 micro-USD` default grant；同月已有 admin grant 时绝不覆盖，summary
  只投影当前月，不得回退到最近历史月；
- Web 分析、Extension 平台查询、练习生成和语义重复建议继续汇入同一 Postgres `reserve_quota` 原子
  边界，每账号共享滚动 60 次/小时、300 次/24 小时的持久限速。相同 request 的 active replay 在限速
  计数前返回原 reservation；`model rate limited` 映射 `rate_limited`，与 `quota_exhausted` 保持独立；
- 限速事件只保存 owner、request ID 与时间，不含正文/模型输出；每账号 reservation 成功时清理超过
  24 小时事件，索引支持滚动窗口。表继续 forced RLS 且不授业务角色表权限；summary 只新增校验当前
  owner 的 context-setter 窄函数，grant/ledger/reservation 仍由 business role 经 forced RLS 读取；
- 新增 `0010` forward 与 Supabase 时间戳镜像，并把 baseline 同步为最终 schema；`0002` helper 改为
  `CREATE OR REPLACE`，确保 current baseline→`0002`…`0010` 仍可完整重放。

## 2026-08-22：当前 baseline 与 forward migration 必须组成可重放的空库链

- 本机隔离空库首次真实启动证明，baseline 已含最新 `replay_account_deletion`，随后 `0009` 再执行普通
  `CREATE FUNCTION` 会以 duplicate function 中止整个 Supabase start；单独证明 baseline 和 forward
  字节一致、旧库可升级，不能证明两者能在当前空库顺序共同执行；
- baseline 继续表达新安装的最终 schema，forward migration 继续服务尚未包含该定义的旧库；因此新增或
  替换已有对象的 forward SQL 必须对“对象不存在”和“baseline 已含最终对象”两种前态都成立，例如使用
  `CREATE OR REPLACE` 或精确条件迁移，不能要求测试先人为 DROP 才能通过；
- 自动回归必须直接执行 current baseline→全部 forward migration，真实验收还必须在隔离项目执行空状态
  start、bootstrap、HTTPS status、destructive reset、重建后聚合与 stop。不得重置正在承载用户验收数据的
  主项目，也不得用 PGlite 单迁移测试冒充 Supabase CLI/容器重建。
- `acceptance:local:build` 必须从没有 workspace `dist` 的干净 checkout 自给完成；应按依赖顺序构建
  learning-domain、cloud-contracts、API 和 Web，不得因为完整门禁恰好留下共享包产物而隐式成功。

## 2026-08-22：本机 bodyless DELETE 与注销回执必须遵守生产语义和最小权限

- Store 服务端实际旅程证明本机 Node adapter 为所有非 GET/HEAD 请求无条件建立 body stream，导致严格
  DeviceDisconnect 把没有正文的 DELETE 判为 proof 非法；adapter 改为只在正数 Content-Length 或存在
  Transfer-Encoding 时建立 stream，并以实际首次断开、重放和旧 token 401 验收；
- 账号删除异常处理会在首次写入失败后查询固定 receipt，但 production `huayi_context_setter` 无权直接
  SELECT forced private `account_deletion_jobs`，二次权限错误掩盖了首个稳定错误。replay 改走只返回
  `requested_at` 的窄 SECURITY DEFINER；PUBLIC/business 不获执行权，context setter 不获表权限；
- PGlite adapter 必须真实 `SET LOCAL ROLE huayi_context_setter`，不能以测试 superuser 代替生产角色。
  一次性实际旅程完成后须经正常 deletion worker 清理，不能用手工级联删除冒充成功。
- 实际脚本遵守既有产品边界：当前卡撤销只适用于尚未开始分析的 StudyCapture；已产生 AnalysisRecord
  后直接删除 Capture 必须返回 `study_capture_in_use`。完整旅程用独立 Capture 分别验证撤销和
  initial/reanalysis，不为验收方便放宽数据关联。

## 2026-08-22：配对交换必须原子返回偏好快照

- 本机 production pairing 实测证明旧流程在数据库已 consumed pairing、创建 ExtensionSession 后，才由
  trusted/context-setter 直接 JOIN forced-RLS profile 读取偏好；该查询失败使 HTTP 返回 400，但客户端
  已永久失去单次 state/verifier 的交换机会并留下幽灵设备；
- `exchange_extension_pairing` 调整为同一 SECURITY DEFINER statement 内完成验证、消费、session insert
  和 owner preference snapshot 返回；profile 缺失必须抛错并回滚全部状态。adapter 不再直接读取
  `user_profiles`；公开 HTTP、PKCE/state、token hash 和权限 grant 不变；
- baseline、forward migration 和 Supabase 镜像必须保持最终定义一致；production adapter 回归锁定单条
  exchange 调用，实际本机验收覆盖 approve→exchange→preference reread→list→revoke→旧 token 拒绝。

## 2026-08-22：分析历史的资源键和协议结构不能成为用户详情

- 真实本机详情证明通用对象递归渲染会暴露 AnalysisRecord、Candidate 和分析单元 UUID，以及 revision、
  result type、Prompt/Schema 版本和原始协议字段名；“完整结构化详情”调整为“完整语义详情”，按 phrase
  或 sentence/passage 的公开结果类型组织中文内容；
- API strict resource 不变，技术 ID/revision 继续用于路由、关联、幂等和并发控制。Web 仅展示来源、
  选择类型、整理/归档状态、用户内容、候选内容、公开 provider/model 和 token 用量，不以内部键作为
  fallback 或用户文案；
- component、actual bundle 与本机真实浏览器验收必须同时断言可理解内容仍完整且 DOM 无技术 UUID、
  协议字段文案或版本信息，不能再用可见 revision 证明服务器状态链。

## 2026-08-22：CORS 方法必须覆盖 Web 实际使用的 PATCH

- 本机学习项编辑证明组件、adapter 和 Postgres 各自通过仍不能替代浏览器预检；全局 CORS 漏列 PATCH
  会在身份、CSRF、revision 和仓储逻辑前直接阻断学习项编辑及账号偏好更新；
- 固定 origin、credential/header allowlist 与既有写入 proof 不变，只把公开路由已使用的 PATCH 纳入
  allowMethods。Foundation 回归必须使用真实 Web origin 和 PATCH headers 断言 204 与 allow-methods，
  actual local browser 必须完成至少一次编辑写入和服务器重读。
- 本机互操作词表下载进一步证明成功正文仍不足够：Web adapter 必须读取固定
  `Content-Disposition` 才接受文件，而该头不是 CORS safelisted response header。全局 CORS 只新增此
  exposed header；回归和实际浏览器必须证明严格文件头可读且下载成功。

## 2026-08-22：账号导出的分析序列化必须有 owner-scoped 受信权限

- 本机数据导出 worker 在账号已有 AnalysisRecord 时稳定失败为 `export-build-failed`；对象 bucket 正常，
  根因是导出 source 调用 private `analysis_public_record`，但该分支既未获 context setter 权限，也从未被
  无分析 fixture 的 Postgres 导出测试执行；
- 新增 owner-scoped wrapper，同时校验显式 owner 与当前 owner context，只把 wrapper 授权给
  `huayi_context_setter`；仅凭 record ID 的底层序列化器继续供 analysis security-definer 内部互调，不
  授权 context/business 角色。后续纠正迁移恢复既有分析维护事务，foundation migration 同步保证新环境
  一致；
- Postgres 回归必须真实插入分析和候选，证明导出包含完整公开 AnalysisRecord，且另一个 owner 即使传入
  记录 ID 也只得到空结果。本机 worker 必须从 failed 显式 retry 后生成 ready 私有对象并签发下载 URL。

## 2026-08-22：ready 导出必须适配生产 Postgres 的 bigint 字符串

- worker 成功写入对象并把任务推进到 ready 后，真实页面仍无法读取状态；生产 `postgres` 驱动把
  `byte_length bigint` 返回为十进制字符串，而仓储投影错误假定为 number，PGlite 形态未暴露该差异；
- 仓储只接受非负十进制字符串或 number，并在不超过 JavaScript 安全整数后转为公开 `byteLength`，再由
  strict resource schema 校验；非法或越界数据库值继续失败关闭。独立投影回归必须直接使用生产驱动
  字符串形态，实际本机页面必须显示 ready 并成功签发下载。

## 2026-08-22：练习历史的项目关联键不能作为用户显示名称

- 真实三轮对话证明逐项反馈与自评直接显示 UUID；“结构存在”不足以证明详情可用。PracticeHistory detail
  新增 owner-scoped、按 session position 排序的 `itemLabels`，恰好覆盖未擦除学习项；Web 禁止用 item ID
  作为显示 fallback，也不显示 session ID；技术 ID 只保留在 API 路由、关联和写入证明中；
- label 只从当前 `learning_items.content` 投影：expression 使用 `text`，sentence-pattern 使用 `template`，
  不新增内容快照。正文已擦除的墓碑不返回 label，继续显示固定“学习项已删除”，不能为改善显示而恢复
  已清除内容；
- contract、Postgres repository、Web 组件和 actual local browser 都必须断言可识别名称；旧 fake journey
  只检查反馈/自评存在的证据不再足够。

## 2026-08-22：真实 PostgreSQL 参数与角色边界是本机核心闭环的发布门

- `postgres` 驱动会把已经 `JSON.stringify` 的值再次编码；数据库 adapter 只对 SQL 中显式
  `$N::jsonb` 的参数解析一次后交给驱动，其他字符串保持不变。PGlite 与真实驱动都必须覆盖该边界，
  不能只凭 PGlite 通过认定 JSONB 结算可用；
- owner-scoped 幂等响应属于租户业务表写入，必须由已设置 owner context 的 `huayi_business` 完成；
  `huayi_context_setter` 只读取幂等状态机函数并调用窄 SECURITY DEFINER，不因实际验收失败而扩大表
  权限；
- 练习生成终态先由租户角色更新 task/session/attempt，再由
  `settle_practice_generation_quota` 在同一事务内校验 owner、generation、reservation、终态、价格和
  1–2 条 billed calls 后写 ledger/settle quota。失败和过期恢复允许 active/released reservation，成功
  只允许 active；任何不一致整体回滚。
- 后台 HTTPS lifecycle 不能仅因入口已有进程返回 200 就认定刚启动的 child 健康；首次六入口通过后
  必须等待稳定窗口，确认记录的 child 仍存活并再次完成 IPv4/IPv6 probe，防止未登记旧前台进程掩盖
  新 child 的端口冲突。PID 与真实 listener 不一致时启动失败并清理状态，不能留下伪成功；正常停止超时
  并发送 `SIGKILL` 后也必须再次有界等待真实退出，不能在信号发出瞬间误报失败。

## 2026-08-21：分析完成与失败结算必须使用 reservation 约束内的完整调用事实

- 本机真实浏览器纵切已经证明模拟 Provider 返回 preview 后，完成事务仍可能在 quota settlement 阶段
  回滚；因此“Provider Adapter 单测通过”和“Web 收到 preview”都不得作为分析完成证据，必须用真实
  Postgres composition 覆盖 AnalysisRecord、candidate、usage ledger、reservation 与 terminal event 的
  同一事务；
- analysis settlement 的 billed call 必须同时携带非空、非负且相互一致的 input/cached-input/output token
  与 cost，并且总 cost 不得超过当前 reservation。完成事务失败后，失败收尾必须复用已经生成的调用
  事实；若生成调用事实不存在，则由可信数据库读取该 reservation 的保守金额，不能使用脱离 reservation
  的固定 fallback；
- complete 或 fail 任一阶段异常都不能留下永久 active generation。Web 仍以 owner status 为唯一终态
  权威，但本机验收交付前必须由 Codex 自己走完分析、候选收录、学习库读取与练习，不再把首次真实纵切
  留给用户代测。

## 2026-08-21：模型候选只提供别名且取消等待必须保留服务器请求

- DeepSeek private output 的 candidate `id` 只是请求内别名；可信 Analysis module 必须在持久化前为每个
  candidate 分配服务器 UUID，并同步改写 result 中全部引用。Provider、模拟 Adapter 和浏览器都不能
  决定数据库 candidate identity；
- 模型已经返回并产生 usage 后，若 trusted assembly 或持久化失败，失败结算必须沿用该次生成的真实
  billed calls/usage/cost，不能退回可能大于 reservation 的默认值，否则会让 settlement 失败并遗留
  active generation；
- Web“取消等待”只中止本页 SSE，必须保留 active request ID 和手动状态查询入口。`running` 状态的每次
  手动检查都显示可见反馈；编辑正文、标题或类型不得解锁第二次提交。只有 owner status 返回 completed/
  failed 后，页面才交接结果或允许使用新幂等键重试。

## 2026-08-21：本机模拟模型必须显式启用且额度失败必须可靠终态化

- local acceptance 的模型调用仍先经过共享 kill switch；因此 acceptance bootstrap 必须把
  `model_kill_switch` 幂等设置为关闭，才能只启用固定的零网络模拟 Adapter。该例外不进入 hosted
  acceptance 或 production：这些环境继续由 Operator 管理开关并默认失败关闭；
- 额度摘要是账号所有者数据，必须在已设置 owner context 的 `huayi_business` tenant transaction 中通过
  forced RLS 读取；`huayi_context_setter` 只负责建立上下文和调用受控转换函数，不得作为 quota 表读取
  通道；
- 请求已持久声明但在价格、开关或额度预检阶段失败时，失败收尾必须仍能读取额度摘要并写入可重放
  terminal event。收尾本身失败不得让请求永久停留 `running`；过期且尚未 dispatch、未 reservation 的
  遗留请求只通过既有 `abandon_analysis_request` 精确回收，不 reset 账号或学习数据。

## 2026-08-21：邮箱确认必须使用独立回调并显式登记 password method

- 首次真实 Mailpit 确认证明共用 Google callback 会把邮箱密码注册错误登记为 `google`；密码确认固定改走
  `GET /v1/auth/password/callback`，数据库完成函数必须接收并校验显式 `password|google`，普通登录 flow
  仍只允许 Google callback；
- 邮箱确认已成功、邀请已完成后，API 又以 `huayi_context_setter` 直接更新 forced-RLS `user_profiles`，因
  无权执行 owner-context 读取而在 Web session 创建前失败。邮箱刷新改为只允许 context-setter 调用的窄
  `SECURITY DEFINER refresh_profile_email`，PUBLIC 与业务角色无执行权；
- `0003` forward-only migration 同步修复符合“邀请已完成 + 只有 Supabase email identity + 没有 Google
  identity”的错误 `google` method；不重置 Auth、邀请或业务数据。确认链接是单次凭证，已确认账号修复后
  直接使用邮箱密码登录，不得要求用户再次点击旧链接。

## 2026-08-21：本机 Auth 密码策略必须与 Cloud 契约一致

- Cloud V1 已冻结密码长度为 12 至 256 个字符，没有额外的字符类型组合要求；本机 Supabase 不得另行
  要求“字母 + 数字”，否则通过 Web/Contracts 校验的密码会在 Provider 层以 422 失败；
- local Auth 固定 `minimum_password_length = 12`、空 `password_requirements`，并由 doctor artifact
  contract 回归；hosted Supabase Auth 必须使用同一策略，不能让不同环境形成不同注册规则；
- 本次只校准环境策略，不降低长度、不改变邮箱确认、邀请单次领取、密码传输或 Provider 错误脱敏边界。

## 2026-08-21：本机验收必须提供明确标识的零网络模拟模型

- Provider 永久失败关闭只能证明安全边界，不能让用户实际走完分析、候选收藏、学习库和练习；本机
  acceptance 新增确定性模拟模型，但不授权真实 DeepSeek 或任何第三方网络；
- 唯一实现 seam 是 `createProductionApp` 已有的 acceptance-only `providerFetch` Adapter；四类 production
  quota、durable dispatch、strict schema、ledger、lease/fencing 和持久化不得被 fake caller/repository
  绕过；
- Web 全页面持续显示“本机验收 · 模拟模型”，主要输出同时带 `【本机模拟】`，明确结果不是 DeepSeek、
  只消耗本机测试额度且没有外部费用；
- 因模拟 response 位于 DeepSeek HTTP Adapter 内，本机 metadata、price version 与 ledger 保留技术兼容
  标识，只能作为测试状态证据，不能作为真实质量、usage 或账单证据；不为本机方便扩大 production
  provider enum；
- acceptance Web 模式由固定 build 注入，非法值失败关闭；用户正在使用时不重启服务，部署等待空闲窗口，
  且不停止/reset/seed Supabase。完整方案见 `local-acceptance-simulated-provider.md`。
- HTTPS 运行版本在进程启动时固定：Web bundle 进入只读内存快照，API composition 只加载一次；磁盘
  build 只产生候选，只有显式 restart 同步激活 Web/API。这样完整构建门不会形成“新 Web + 旧 API”的
  半部署；快照运行时首次切换仍等待用户空闲窗口。
- 本机代码切换新增唯一窄入口 `acceptance:local:deploy --confirm-local-downtime`；它只组合 loopback runtime
  复核、HTTPS stop、acceptance build 和 health-checked start。错误确认零副作用，阶段失败不自动掩盖；
  不复用 destructive reset 或会停止 Supabase 的 persistence restart，也不触碰邀请或外部服务。
- `*.acceptance.localhost` 同时解析到 `127.0.0.1` 与 `::1`；浏览器可能优先选择 IPv6，因此三个 HTTPS
  端口必须在两个 loopback 地址各自监听。只绑定 IPv4 不再视为健康，绑定 `::`/`0.0.0.0` 或局域网仍
  禁止；任一地址绑定失败时整组启动失败关闭。后台 lifecycle 的 start/status 固定对每个入口执行
  IPv4/IPv6 两次系统信任 CA probe，不能再由 DNS 顺序随机掩盖单边失效。

## 2026-08-21：本机持久化必须由完整停启前后不透明指纹证明

- 只重启 HTTPS、只看容器 health 或只比较行数都不足以证明用户数据持久；新增独立
  `acceptance:local:restart:verify`，完整停止并恢复 HTTPS 与 Supabase；
- 命令不接受参数或远端目标，先在数据库服务器内部为全部 public tables、Auth users/identities、Storage
  buckets/objects 与 migration history 计算 canonical row digest，再停启、forward migrate 并计算第二次；
- Node 只在内存比较 relation/count/digest，终端不输出 snapshot、用户字段、密码散列、token、credential
  或 SQL 错误；任何差异或阶段失败都失败关闭，HTTPS 停止后不自动掩盖现场；
- 注册前运行只能证明初始化数据和邀请保留；用户注册并创建学习数据后必须重复同一命令，才关闭真实账号
  与学习内容跨重启验收。

## 2026-08-21：本机 reset 必须显式确认并只重建固定虚构状态

- reset 是唯一允许销毁 local-acceptance 数据的仓库入口，要求精确
  `--confirm-local-data-loss`；不能把 start、migrate、build、test 或服务自愈变成隐式清库；
- 目标固定为当前仓库 local Supabase，不接受数据库 URL、linked project、project ref、调用者 seed 路径
  或云端登录态；先验证 loopback runtime 并停止 HTTPS，失败不继续也不自动交付半重建环境；
- 固定重放 migration 后只加载虚构 Operator seed，再由既有 bootstrap 建立角色、价格、kill switch、
  private bucket 和生成式本机 credential，重建 API/Web 并恢复 HTTPS；
- seed 不创建 Auth 用户、登录方式、邀请、session、正文或 Provider 结果。reset 后旧邀请失效，用户必须
  显式生成新邀请；真实 reset 仍需用户单独接受数据丢失后执行，离线测试不能替代。

## 2026-08-21：首账号初始化必须通过前向迁移进入生产注册事务

- 本机审计证明现有注册函数只创建 profile/sign-in method，未建立产品规定的当前 UTC 月 1 美元默认
  grant；环境虽声明导出 bucket，但 bootstrap 也未创建实际 private bucket；
- password 与 Google 邀请注册必须在同一数据库事务中创建当前月默认 grant，重放不重复且不能覆盖同月
  admin grant；既有非 deleting profile 由 `0002` forward-only migration 幂等回填；
- 已执行 baseline 不因本机方便而改 version 或 reset；新增安全的 local migration-up 命令，同时验证 API
  migration 与 Supabase 时间戳副本一致；
- Supabase Storage bucket 属于环境 provisioning，不进入可移植业务 migration；本机 bootstrap 只创建
  private acceptance bucket，hosted/production 仍须各自配置与验收；
- 本纵切只建立首次月份 grant。后续 UTC 月自动续期是独立额度生命周期需求，不能由本次完成声明外推。

## 2026-08-21：本机用户验收入口必须独立于 Codex 与终端生命周期

- 用户首次打开本机邀请链接时 8443 已无 listener，现场同时证明 Supabase 容器仍健康；根因是原
  `acceptance:local:dev` 仅为前台命令，却被文档当成可持续交付环境；
- 用户可持续验收入口固定改为后台生命周期：`dev` 启动或复用、`dev:status` 检查、`dev:stop` 停止，
  `dev:foreground` 只用于故障诊断；
- 后台进程必须脱离调用终端、忽略 stdio、禁止 shell，PID 状态只存 ignored `0600` 本机文件；启动成功
  前以系统信任 CA 验证 Web/API/Supabase 三个 HTTPS 入口，存活但不健康的已记录实例必须被替换；
- 入口恢复只证明本机 runtime 可达，不升级 Local-ready；注册、Mailpit 确认、登录和核心旅程仍由用户
  实际完成并反馈。

## 2026-08-21：域名、DNS 与 Resend 从延期项恢复为验收环境准备项

- 用户确认现在可以注册自有域名、Resend 并配置 DNS；Phase 36 的“当前没有外部前置条件”是当时事实，
  不再代表当前执行状态；
- `local-acceptance` 仍先实现，Mailpit 仍是本机 Auth 邮件工具；域名采购不会阻塞本机用户验收；
- `hosted-acceptance` 首选自有根域下的 `app.acceptance` 与 `api.acceptance` 同站双子域，Vercel
  `*.vercel.app` 同源 gateway 降为域名未就绪时的备用方案；
- Resend 验收使用独立 `notify.acceptance` 子域，production `notify` 保留；具体 SPF/DKIM/DMARC 值只
  来自 Resend Dashboard。Supabase Auth SMTP 与 R3-C HTTP sender 使用分离 credential；完成域名验证或
  SMTP 配置不等于 R3-C 完成；该条记录 Phase 47 当时仍须实现 production sender、通知 CRON、厂商幂等
  和无正文告警，代码部分后由 Phase 48 关闭，真实外部验收仍 pending；
- 用户随后选择 `seen-said.cn` 并指定在腾讯云购买：腾讯云保留 registrar/续费/实名职责，Cloudflare DNS
  Free 只作为权威 DNS，不再使用“Cloudflare Registrar”表述；Resend 固定先用 Free。验收子域为
  `app.acceptance.seen-said.cn`、`api.acceptance.seen-said.cn` 与
  `notify.acceptance.seen-said.cn`，production `notify.seen-said.cn` 保留。
- `.cn` 实名是解析前置；Vercel/Supabase 境外托管的验收环境暂不把 ICP 作为启动前置，未来改用中国大陆
  服务器或大陆 CDN 时重新设置备案门。购买、实名、NS、DNSSEC、DNS record 与 Resend key 仍须逐步验收。

## 2026-08-21：生产候选前新增可用测试环境与用户自然使用验收门

- 用户纠正原路线缺少“部署起来实际使用、边用边改”的关键阶段；离线自动化、actual bundle 和双平台
  门禁不能直接导向 production；
- 环境固定为两层：Mac `local-acceptance` 先用于高频持久使用，隔离 `hosted-acceptance` 后用于真实 TLS、
  托管 Auth/Storage、跨设备和持续远程使用；两者不与 production 共用资源；
- 本机使用 loopback HTTPS + Supabase Mailpit；hosted acceptance 优先采用自有根域下的同站 Web/API
  子域，域名未就绪时才使用平台地址和同源 gateway；不通过 `SameSite=None` 依赖第三方 Cookie；
- OrbStack 的全局 LAN forwarding 不能成为隐式信任：本机 Supabase 使用固定 loopback Docker network，
  `start`、`status` 和 Web/API `dev` 均须复核每个项目容器的 network 与 published host；部分端口启动失败
  必须关闭全部本轮 server；
- 本机 acceptance composition 默认阻断四条 Provider 出网；首账号使用只保存 peppered hash 的一次性邀请
  链接注册，不添加 test-only 登录后门。服务可访问或邀请生成都不能替代 Mailpit、Cookie/CSRF 和核心
  用户旅程验收；
- 验收账号由受控 bootstrap 创建，不加身份后门；R3-C 在 Resend/DNS 前置条件就绪后恢复实施，但在真实
  sender、通知 CRON 与告警通过前仍保持 pending；
- 第二批 Windows 门已由用户回传完成；远端随后推进到指令尺寸修复提交 `d451122`。Phase 47 现在优先于
  生产部署和商店发布。用户完成跨多日自然使用、反馈回流并明确批准后，才允许冻结 production
  candidate。

## 2026-08-21：Phase 46 在第二批候选冻结点停止继续发明本地功能

- 七条产品成功标准中第 1–5、7 条已有离线分层证据；唯一生产代码缺口仍是依赖邮件、域名和告警决策的
  R3-C，按用户决定继续延期；
- Phase 42–45 之后不再把外部验收项或文档勾选项包装成新的产品代码切片，转入 Phase 41-C/41-D 的
  第二批候选冻结与 Windows 完整验证；
- 冻结范围从上次 Windows 验证代码 `3aa143c` 到 Phase 45 代码锚点 `15306b4`，旧 Windows 结果不得
  外推；Mac 侧需审查累计差异并对最终交接提交重跑完整门；
- 候选只有在用户普通 push 精确 SHA 后才可交给 Windows 拉取；不自动 push，不恢复已废弃的
  `windows-codex` 项目，也不混入安装、真实 Chrome、凭据、Provider、词典、部署或邮件任务。

## 2026-08-21：Vercel API 显式固定 Fluid Compute 与 120 秒 Function 上限

- Phase 38 的“未启用 Fluid 时 Hobby 最大 60 秒”口径由当前 Vercel 执行模型事实取代：仓库必须显式
  `fluid: true`，不能依赖新项目默认值或未知 Dashboard 状态；
- 唯一 Hono 入口 `src/server.ts` 固定 `maxDuration: 120`。四条 DeepSeek adapter 的 90 秒是一次生成的
  总应用预算；可选结构修复共用同一 timer，不能误算为两次各 90 秒；
- 120 秒只为 90 秒应用 abort 后的数据库终态与响应收尾留余量，不放宽 Provider timeout、自动重试、
  lease/fencing、价格快照或账本；
- Vercel Cron 保持移除，Supabase `pg_net` 55 秒仍是四个有界调度请求的独立故障隔离上限；
- 本阶段只建立仓库配置与离线门，真实 Vercel project、Dashboard、部署产物和 Observability 继续由独立
  部署任务验收。

## 2026-08-21：Web 单一皮肤由可执行三层 Token 契约约束

- `styles.css` 的 `:root` 成为生产 Web 唯一 registry，依赖固定为 primitive → semantic → component；
- 颜色、背景、边框/轮廓色、非零间距/inset、圆角和阴影必须引用 Token；reset、布局关键字、断点、
  结构尺寸与排版值保留为明确例外；
- 测试从 `main.tsx` 的生产 CSS import 清单建立闭包，任何新增入口自动验证定义完整性和受控属性，
  不再维护不完整的手工文件列表；
- 本轮只等值迁移既有视觉，不新增皮肤、依赖、DOM、路由、数据或请求变化；Windows 验证进入下一冻结
  候选批次。

## 2026-08-20：登录后 Web 页面统一由 WorkspaceShell 拥有一级导航

- 普通账号一级导航保持产品既有七项及固定顺序，不因外部词典或练习历史子页扩张；
- 练习历史归入今日练习，外部词典归入生词，完整会话的账号/设备/数据权利归入设置；运营保持独立权限
  面，只从已验证 Operator 的账号设置进入，不追加普通一级导航；
- `CloudApp` 组合层的 WorkspaceShell 独占品牌顶栏、skip link、一级路径、active、data-rights-only 受限
  形态与窄屏原生折叠菜单，业务页面不再复制外壳；
- 公共、认证、密码恢复、Extension 配对、session 未确认和独立运营面不显示完整学习工作台导航；
- 本阶段不引入客户端 router，不改变业务请求、状态、协议或数据结构。

## 2026-08-20：公开披露必须分开 BYOK、platform 与两类云端学习动作

- BYOK 查询只把最小输入发送该设备所选 Provider；API Key 与精简结果不发送语见，不产生待整理或分析
  历史；
- platform 查询由语见 API/平台 DeepSeek 处理，正文与精简结果最多保留一小时用于恢复和幂等；
- StudyCapture 与 CloudWordCopy 是用户分别选择的独立云端学习动作，不能被称为“BYOK 结果上传”；
- `/privacy`、配对审批、隐私草案和 Store listing 必须对四类动作、接收方、保留和撤回语义一致；
- 本轮只修复公开披露漂移，不修改协议、API、数据库、Provider 或 Extension runtime。

## 2026-08-20：Windows 验证改为候选冻结节点批量执行

- 保留 Windows 支持和发布前双平台门禁，但不再要求每个普通小提交后立即切换 Windows 跑全量门；
- 日常需求优化和功能切片先在 macOS 完成文档、Fresh RED→GREEN 与风险相称的验证，阶段节点运行
  `pnpm verify:macos`；
- 需求暂时冻结、Mac 完整门全绿、无 P0/P1、工作树干净且精确 SHA 已 push 后，才执行一轮 Windows
  fresh install + `pnpm verify:windows`；
- DPAPI、PowerShell、注册表、SEA、Windows 安装器、Windows-only 故障、共享 Native Messaging/传输和
  Windows 发布操作会提前触发有界冻结点；相关修复可集中，最终仍须对最新 SHA 完整重跑；
- 旧 Windows 证据不覆盖之后的新提交；批次未执行时必须明确保留 Windows pending，不得宣称跨平台
  候选或发布已完成；
- 邮件、域名、DNS、Resend 与真实部署继续在独立任务处理，不纳入该批次。

## 2026-08-20：Windows Fresh 门固定 workspace source 解析与精确异步等待

- Fresh Windows 首个 RED 是根 `AGENTS.md` 12,404 字节超过 12 KiB；语义压缩至 12,287 字节后，门禁
  继续证明 Store Vite 与 coverage 不能依赖 workspace 包已预建 `dist`。两份配置改用同一组 workspace
  source alias，使 fresh checkout 与常规 workspace build/test 解析一致，不放宽 coverage 或发布审计；
- actual-bundle journey 的筛选动作必须重新选择当前视图中的条目，不能沿用切换到“已归档”前的详情；
  Google 离线 journey 也不再以默认 5 秒标题断言间接等待两个 API 和重定向，而是等待精确 Provider
  HTTP 200。targeted 9/9 通过，最慢 12.4 秒；
- 最终 Windows `pnpm verify:windows` 退出 0，覆盖 109/109 Playwright、Store coverage、9 个 build、
  development/Store release audits、无漏洞 production audit 与仓库外 SEA health；这些 shared/build/test
  修复不改变 Classic wire、Provider、权限、数据模型或任何外部发布边界；完整门证据提交
  `3aa143c7f60ba52a941f2a2db587bc93819427eb` 已普通 push，该分支无开放 PR 且 GitHub Actions 无分支
  run，因此远端 macOS/Windows CI 未触发。

## 2026-08-20：冻结 Phase 37-B Windows 离线验证交接

- 保留 Windows 支持；下一阶段只验证 Node.js 26+ 完整离线门、SEA package 与仓库外 `.exe` health，不把
  macOS fake 或历史 Windows 记录冒充当前 Cloud 候选证据；
- 新增独立交接文档，固定 `e9abf51` 候选祖先、同一远端分支、干净工作树、Fresh 结果、修复边界、最终
  全门、Conventional Commit、普通 push 和返回摘要；
- 明确废弃 windows-codex 项目不得恢复；Windows 使用 Codex App 原生任务；
- 邮件/域名/DNS/Resend、安装、真实 Chrome、DPAPI、Provider/词典、云部署和商店操作继续保持独立授权，
  不因 Windows 自动门通过而关闭。

## 2026-08-20：交付收口前补齐 Eudic deadline 与 fake 分支矩阵

- Phase 37-A 重算得到 613 个未跟踪 Cloud 交付候选；`.agents/skills/**` 150 个和 `artifacts/**` 8 张仍
  精确排除且保留。范围审计同时确认没有意外路径、生成目录、凭据文件、私钥、压缩包、symlink 或超过
  1 MB 的候选；
- 发布检查表的 fake model/mail/third-party 条目改用“能力实际定义的分支”矩阵，不为邮件或人工 Shanbay
  页面虚构模型额度/HTTP timeout；
- Store Cloud Eudic 默认 alarm/bridge signal 不会自行 abort，而 client 原先没有内部计时器，因此
  `timeout` 码不能保证触发。固定复用 Classic 的 10 秒请求 deadline，与 caller abort 合并；任何超时只
  形成稳定失败并等待显式 retry，不自动重复第三方写入；
- 另补 ExtensionQuery quota-before-provider、ExtensionQuery timeout 配置失败关闭，以及
  ExtensionQuery/suggestion/practice 实际 timeout abort 回归；不改变 Provider、价格、账本或公开契约。

## 2026-08-20：高频 worker 调度从 Vercel Cron 移到 Supabase Cron

- Vercel Hobby 不接受分钟级 Cron，因此 `apps/api/vercel.json` 不再声明四项 `* * * * *`；本条记录
  Phase 38 当时的四个 `CRON_SECRET` route，Phase 48 后当前固定为五项；业务状态机、lease/fencing、
  批次上限和 Windows 支持均不改变；
- production 改由 Supabase `pg_cron + pg_net` 每分钟独立调用 password recovery、data rights、
  ExtensionQuery cleanup 和 duplicate suggestion cleanup。管理员运维 SQL 从 Vault 运行时读取正式 HTTPS
  API origin 与 cron secret，固定四路径 allowlist、search_path、超时与角色撤权，并以固定 job name
  幂等重装；local/preview 不自动安装；
- 该变更只解决高频调度适配，不能宣称整个 Cloud V1 已兼容 Hobby。当时记录的 legacy 60 秒 Function
  与 90 秒应用超时冲突后由 Phase 45 的 Fluid/120 秒仓库契约 supersede；个人非商业、真实部署、
  Supabase Free 暂停/无自动备份及 `pg_net` Beta 仍须在独立部署任务裁决；本阶段不创建云资源、不配置
  域名/DNS/Resend、不运行真实服务；
- R3-C 安全通知在 Phase 38 当时不加入第五个 job；该决策后由 Phase 48 supersede，当前固定为五个 job。
  完整现行方案见 `vercel-hobby-supabase-cron.md`。

## 2026-08-20：R3-C 生产邮件前置条件延期，不以占位配置推进

- 用户确认当前没有自有正式域名、DNS 管理方、Resend 账号、verified sender、真实支持邮箱或告警
  目的地；这些外部条件全部保持待处理，本阶段不购买域名、不注册邮件服务、不创建 API key、不添加
  DNS 记录，也不继续真实 sender/CRON/告警实现；
- fake sender、PGlite 和 actual-bundle 只保留为离线契约证据，不得据此关闭 R3-C 或宣称生产密码恢复
  通知可用；
- 后续恢复时暂定优先评估 Cloudflare Registrar + Cloudflare DNS、独立 `notify.<root-domain>` 与
  Resend；国际支付或账号条件不便时评估腾讯云域名 + DNSPod。购买前必须重新核验域名可用性、注册/
  续费价格、Resend 配额/价格、支持邮箱和告警责任人，并取得用户明确批准。

## 2026-08-14：Cloud 候选与代理辅助资产分开盘点

- 当前未跟踪 Cloud 交付候选按精确目录/文件规则计为 610 个；该集合包含根 Prettier 门禁配置、
  API/Store Extension/Web、Cloud ADR/文档、Cloud/domain packages 与 release scripts；
- `.agents/skills/**` 150 个文件不在 workspace、产品运行时或发布包，继续排除出 Cloud 候选；
  `artifacts/**` 8 张未被源码/文档引用的 Classic/本地 UI 截图也不作为 Cloud 发布证据；两组均保留，
  不因本次盘点删除；
- 盘点不等于版本控制纳入。本轮不执行 Git 暂存/提交；候选实际纳入后必须重新统计、运行 tracked diff
  检查和候选发布审计。

## 2026-08-14：DeepSeek V4 Flash 按 durable dispatch 固定实际分时价格

- 官方非流 thinking 响应允许可选 `completion_tokens_details`；严格 Provider schema 接受空对象或可选
  非负 `reasoning_tokens`，但公共 usage/日志/账本不新增 reasoning 字段，output 继续使用
  `completion_tokens`；
- 2026-08-16T16:00:00Z 前使用 legacy 三价；生效后 UTC `[01:00,04:00)` 与 `[06:00,10:00)` 使用
  peak，其余使用 off-peak。部署环境不再提交任意单价，只提交三个互异不可变价格 UUID；
- begin 不是计费时间：pre-dispatch lease reclaim 可以跨窗。新 generation 先按 peak 上限 reservation，
  紧邻 fetch 的 durable dispatch transition 才以同一个服务端 UTC `now` 选择、校验并持久化实际快照；
  settlement 与 post-dispatch 恢复永远复用该 UUID；
- 分析 request 增加最小 `dispatched_at` 内部列以区分安全释放与不确定费用；公开 `/v1`、Cloud contracts、
  Classic wire v7、Native Host 和浏览器权限不变。完整方案见 `deepseek-v4-billing.md`。

## 2026-08-14：Store `unlimitedStorage` 由正式本机数据和耐久恢复证明保留

- Chrome 官方语义确认该权限解除 `chrome.storage.local`、IndexedDB、Cache Storage 与 OPFS 配额，并
  使扩展免于通常的存储驱逐；当前产品只以实际使用的 `storage.local` 和 IndexedDB 作为申请理由，不用
  未使用的 Cache Storage/OPFS 扩大理由，也不承诺无限物理磁盘或绝对不丢数据。
- LocalLexiconEntry 是独立正式本机数据；其 IndexedDB 没有总词条或总字节 cap。外部词典耐久状态另有
  最多 20,000 项 outbox。`storage.local` 中 SubmissionOutbox 与本机批量导入各允许约 5 MiB 明文、加密
  后可同时存在，连同 DeviceVault/session/设置会超过无该权限时的 10 MiB 总配额。
- 删除 `unlimitedStorage` 会重新引入 quota rejection 和 IndexedDB 常规 eviction 风险，改变本机词库
  local-first 与任务重启恢复语义，因此 Phase 33 裁决保留。`storage`、`alarms`、三个精确 HTTPS API
  host 也保留；当前只读 tab ID/创建固定 URL 标签页/发送固定消息不要求新增 `tabs`。
- 该源码审阅不替代正式候选的一致性门禁：Huayi API origin 固定后仍须加入精确 host/CSP，重跑发布
  审计并在目标 Chrome 复核实际候选包。

## 2026-08-14：完成度按七条产品成功标准与六层证据重新判定

- 完整 V1 不再用 A/B 等级或已实现功能域反推；七条成功标准必须各自绑定 production source、
  strict contract、database/RLS test、actual-bundle 用例、fresh 命令和剩余外部门禁，任一缺失层
  都要显式写出。
- Phase 32 当时密码恢复 R3-C 的真实安全通知 sender、通知 CRON 生产组合和告警尚未实现；邮件厂商、
  verified sender/域名、联系方式和告警渠道也尚未决策。Phase 48 后代码部分关闭，外部决策与真实验收
  仍 pending。
- `git diff --check` 只检查已跟踪差异；当前尚有未跟踪 Cloud V1 交付文件，因此候选交付范围
  确认、入库及入库后重跑仍是发布前门禁。

## 2026-08-14：正式候选 ready 与开发态 expected-blocked 使用独立门禁

- `check:cloud-release` 继续只回答正式候选是否 ready，不改变配置、返回结构或退出语义；
- 新增显式开发态入口，只在真实工作树的发布审计 blocker 与版本化九项集合完全一致时成功；少一项代表
  部分候选化，多一项代表新增漂移，两者均失败；
- 开发态集合只含固定安全 code，不新增持久数据、不读取 secret、不访问网络，并在双平台聚合门禁的
  build 后运行。它不能替代真实候选、部署、Chrome、Provider 或第三方服务证据。

## 2026-08-14：根质量门只排除代理技能资产，产品工作树继续全量受检

- `.agents/skills/**` 被确认是 Codex/ClaudeKit 设计技能、参考资料、模板与独立 CommonJS 脚本；它不在
  pnpm workspace，不被产品源码/构建引用，也不进入 Huayi 运行时或发布包，因此不属于产品格式/lint
  质量门。
- 排除范围固定为精确 `.agents/skills/**`，不得扩大到 `.agents/**`；`apps/**`、`packages/**`、
  `scripts/**`、产品文档、根配置、manifest 与 lockfile 继续由根门禁检查。
- Fresh RED 中剩余 3 个 Web 源文件、跨平台文档与 lockfile 必须以现有 Prettier 机械修复，不通过新增
  ignore、规则降级或手工语义改写绕过。完整需求、技术路线、测试与验收见
  `root-quality-gates.md`。

## 2026-08-14：SubmissionOutbox 将 adapter 缺失与授权失效分离

- 有效 extension session 与 Huayi 数据同意仍在时，production API adapter 缺失只表示当前构建无法
  提交，不表示用户撤回授权或账号失效；既有账号绑定密文必须保留，不能在 `enqueue/process/status`
  任一路径清除。
- 公共 `not-configured` 在存在保留项时携带有界 count/oldest，使 Popup 明确显示密文仍在本机并允许
  二次确认清空；该状态禁用手动/自动重试，不暴露正文、幂等键、session 或 endpoint。空队列仍返回
  无聚合字段的 `not-configured`。
- 撤回同意、session 缺失/过期或鉴权失败、设备断开/换号仍是清除边界；426 继续使用独立耐久版本
  阻塞。测试必须先用有效 session + 同意 + `api=null` 的 Fresh RED 证明误删，再验证这些安全边界未被
  放宽。

## 2026-08-14：完整离线完成度必须补语义建议与可计算 AA 证据

- production Web 路由齐全不等于完整 V1 离线完成；产品要求的语义重复建议仍固定失败关闭，不能用 fake
  model、merge 事务或组件测试冒充 production suggestion→preview→confirm 闭环。
- 语义建议是平台计费调用，必须使用独立 owner-scoped durable request、Idempotency-Key、quota
  reservation、dispatch mark、usage ledger、lease/fencing 和保守失败恢复；不能直接把现有 model seam
  接到 DeepSeek，也不能复用 Practice/Analysis 的不同资源状态机。
- S2 外部 interface 固定只暴露 `suggest(command)`；Provider 的实际费用以 `billedCalls[]` 传递，durable
  repository 用 `acquired/resolved/busy` 和 boolean dispatch fencing 表达内部状态，避免 HTTP caller 学习
  quota、lease 或结算顺序。当前单次调用的 reservation ceiling 不得被未来 repair call 静默复用。
- 相同 owner/Idempotency-Key 的有效 terminal 必须先于当前部署价格检查重放，不能因后来价格变化破坏
  原响应；只有新 generation 才在新 reservation 前精确校验价格版本，并由共享 quota transition 在 fetch
  前执行 kill switch 与额度检查。价格/kill/quota 失败不得创建第二次 Provider 调用或自动切换 BYOK。
- 模型只见最多 50 个 server-owned 同类型最小候选别名；最多 10 个 bounded public suggestion 可为精确
  replay 在 forced-RLS 数据库短时保留 24 小时，独立 CRON 有界清理，账号删除级联且不进入内容导出。
- Web 失败不自动重试；每次用户再次点击使用新 key，item/revision 变化清除候选并抑制迟到 response。
  浏览器验收必须经过 actual production bundle 的 suggestion→preview→显式 confirm→server reread，且
  公开 snapshot/Web Storage 不得出现正文、prompt、raw output、reservation 或 task。
- 测试文档不得声称不存在的 Playwright 语义合并或 AA 对比度检查。AA 必须按 WCAG sRGB 相对亮度对
  真实 semantic token 组合计算，不能以字号假设或静态字符串检查替代。
- 完整矩阵与阶段方案见 `offline-completion-audit.md` 和 `semantic-duplicate-suggestions.md`。

## 2026-08-14：普通 Google 登录使用独立契约并固定 callback 防泄漏 header

- `POST /v1/auth/google/login/start` 的 strict 空对象属于 identity 领域，不再复用同形的
  AccountDataExport request schema；JSON 只接受 `{}`，原生 form body 必须为空。
- 普通/邀请 Google start 与共用 OAuth callback 明确 `private, no-store`；callback 成功和失败另固定
  `Referrer-Policy: no-referrer`，防止短时 flow/code 作为 Referer 进入 Web 或第三方。
- production-bundle 离线验收必须覆盖 active→full、disabled→data-rights、未登记 google method→零
  Cookie；不以 fake Provider 冒充真实 Google/Supabase。完整方案见
  `google-authentication-acceptance.md`。

## 2026-08-14：密码恢复是未登录的一次改密授权，不是登录或身份绑定

- PasswordRecovery 公开 start 对 unknown/Google-only/非 active/eligible 账号统一 202；只有既有
  active+password method 才调用 Supabase PKCE recovery，不能按相同邮箱新增 Huayi method。
- 恢复使用独立 `password_recovery_flows` 与 purpose-scoped HttpOnly Cookie，不复用邀请/login/link
  `auth_flows` 或普通 Web session。邮件 callback 只取得一次改密能力，不获得账号数据访问。
- 公开 start 不等待外部 Provider；eligible 请求只建立本地 requested flow，由 trusted worker 在调用
  Provider 前耐久写 dispatch。可能已发信但丢失回执的任务不得自动重发，只能由用户显式新请求替换。
- 邮件 GET 不直接消费 Provider code，只渲染 no-store/no-referrer、无外链脚本且 form-action 固定 self 的
  惰性确认页；用户显式 POST 后才 exchange，降低邮件 scanner 抢先消费风险。
- 完成改密后撤销全部 Huayi Web/Extension sessions、清 recovery Cookie、写耐久安全通知并要求用户显式
  重登；不从 Provider recovery session 派生 Huayi session。
- Provider 发信/state 保存和改密/stage 提交是跨系统窗口，必须如实依赖用户显式重试，禁止后台透明
  改密或宣称 exactly-once。完整方案见 `password-recovery.md`。
- 统一 start 响应预算由原则性要求校准为：有效且未限速的 202 从 handler 起点起至少 250ms；发布前用实际
  部署分布复核，不能据此声称密码学不可区分。
- 改密完成后的安全通知固定为独立 120 秒 lease、有界指数退避，真实 sender 使用 outbox notification ID
  作为厂商幂等键。邮件厂商、verified sender、支持联系方式与告警未确定前，不挂载伪 production sender。

## 2026-08-14：Supabase identity 不能直接等同 Huayi 登录授权

- 官方能力复审确认 Supabase 会按相同已验证邮箱自动链接 OAuth identity，而产品明确禁止静默合并；现有
  provider user ID→Huayi session 直通不足以执行该边界。
- 新增 owner-scoped `account_sign_in_methods` 作为 Huayi 授权 fence：邀请只登记实际注册方式，普通登录
  必须先验证 method 已登记；上游 auto-link 不自动创建 profile、method 或 Huayi session。
- 显式 Google/password 绑定拆成 recent-auth、purpose/session/user-bound flow；V1 不提供解绑。密码恢复
  是未登录 purpose-bound 流程，另立阶段。完整路线见 `account-sign-in-methods.md`。
- `api.md` 的“所有写请求带 Idempotency-Key”收窄为各资源显式声明的 replayable mutation；认证、邀请、
  pairing approval 与一次性 auth/link flow 使用各自状态机恢复。
- 密码近期重认证不先消费当前 refresh token：服务端从已验证 Huayi session 读取规范邮箱，以
  `signInWithPassword` 创建新 provider session，核对同一 user ID 后原子替换 Huayi session 与 encrypted
  refresh ciphertext。这避免 password 校验失败或数据库提交中断把旧 ciphertext 留在已消费 generation。
- Google 近期重认证同样不消费当前 refresh：start 用 path-scoped HttpOnly SameSite=Strict one-time intent
  Cookie 保持公开 `continuePath` 为常量，continue 绑定当前 Web session 后发起新的 Google OAuth；callback
  只有在 purpose、
  发起 session 与 Supabase user ID 全部匹配时才轮换 Huayi session。只有 manual Google linking 使用当前
  encrypted refresh 的 purpose-bound 单写 lease。
- 绑定授权不能只看 `reauthenticated_at`：普通登录也会产生新时间，若无 provenance 就可绕过“以当前密码/
  Google 显式重认证”。`web_sessions` 因此新增内部 `reauthenticated_method`；普通登录/邀请为 null，显式
  reauth 写 password/google，link 同时校验规定来源与 15 分钟窗口。
- Google manual link 不允许在单次 continue GET 中先 refresh 再直接 link：进程中断会让数据库持有已消费的
  旧 token。状态机拆成 claimed→refreshed→provider-started→completed；新 encrypted refresh/provider
  state 先持久化，manual link 后置，重试按数据库 stage 恢复且同一 session 只有一个 open flow。内部
  30 秒 hashed lease 固定每个 refresh generation 只能由一个 worker 推进；租约不进入公开契约。
- Google→password 绑定也不能把 `refreshSession`、`updateUser({password})` 与数据库 method 写入拼成一个
  不可恢复 POST。新增独立 link-password purpose：claimed→refreshed→provider-updated→completed；先持久化
  rotated refresh/state，明文密码不持久化，Provider/数据库中断按 stage 重试。不得用 service-role 管理员
  改密绕过 authenticated session 与 Supabase secure-password-change 策略。
- 重复绑定不能伪装成认证失败，也不能在 proof 验证前泄漏 method 状态：active/full Cookie、固定 Origin、
  CSRF 与目标绑定要求的 recent-auth provenance 经数据库锁定验证后，固定返回 409
  `sign_in_method_already_linked`，不创建 flow、不调用
  Provider、不改变任何 session；Web 通过服务器重读恢复 stale view。

## 2026-08-14：密码 actual-bundle 验收必须经过邮箱确认 callback

- 密码注册不得把 202 `emailConfirmationRequired` 或预种 Cookie 解释成登录成功；默认离线验收使用本地
  fake mail/provider 页面要求用户显式点击，再由固定 API callback 消费 auth flow、完成邀请并设置
  HttpOnly Cookie。
- 同一 production bundle 旅程在清除会话 Cookie 后从 `/login` 覆盖错误密码重试与正确密码的新 session；
  公开 authority snapshot 不保存邮箱、密码、claim ticket、flow/code、Cookie 或 CSRF。
- 密码注册/登录响应与 callback/CSRF 一致增加 `Cache-Control: private, no-store`；不改变 body、Cookie、
  CORS、Supabase adapter 或 Postgres 状态机。完整方案见 `password-authentication-acceptance.md`。

## 2026-08-14：配对审批是一次性转换，以 GET approved 恢复丢失响应

- 校正 `api.md` 单点漂移：approve 使用 Web Cookie+Origin+CSRF 与 strict body 内的
  `expectedPreferencesRevision`，不使用 Idempotency-Key/If-Match 或 mutation replay。
- pending→approved 与可选偏好更新在同一事务；revision conflict 零部分写。丢失 204 后 GET pairing
  返回 approved，客户端不得重放 approve；ExtensionSession 仍只由 state+PKCE exchange 创建。
- production `/pair-extension/:id` 需新增 actual-bundle 组合证据，但不得把 fake Web authority 冒充 Store
  exchange、token vault、真实 Chrome 或部署验证。完整方案见 `pairing-approval-acceptance.md`。

## 2026-08-14：分析历史发布证据必须覆盖正交状态与 linked capture 删除

- contracts、Postgres 和组件测试不能单独证明 production `/history` 的 bootstrap、筛选、详情焦点及
  Cookie/CSRF/revision/幂等组合；新增 actual Web bundle 离线验收层。
- linked StudyCapture 记录必须依次验证 pendingReview→reviewed、archive、restore 与默认同时删除 capture；
  archive/restore 不得改变 reviewState，每次 mutation 后必须服务器重读，不能本地乐观推断。
- 专用 strict helper 只记录聚合与脱敏请求事实，不记录正文、结果、token 或 key；真实 Postgres/RLS、
  身份和部署保持独立目标环境验收。完整方案见 `analysis-history-acceptance.md`。

## 2026-08-14：练习历史发布证据必须覆盖生产入口与跨资源删除不变量

- contracts、API/Postgres 和 React 组件测试不能单独证明 `/practice/history` 的 production bootstrap、
  Cookie/CORS、筛选、详情焦点、两步删除及写后服务器重读；新增 actual Web bundle 离线组合层。
- 该旅程必须用 completed dialogue 的完整公开投影，并在删除后返回 `/practice`，证明 PracticeSession
  历史消失而两个 LearningItem 与 ScheduleState 保持可读；不得只依赖成功文案推断跨资源不变量。
- 新 helper 复用 strict 公共 schema 与主 authority 写证明，公开 snapshot 不记录答案、feedback、正文、
  token 或幂等键；真实数据库/RLS、身份和部署仍是独立目标环境验收。完整方案见
  `practice-history-acceptance.md`。

## 2026-08-14：管理台离线验收必须经过 actual Web bundle 与 Operator access

- React 组件注入 fake API 不能单独证明 `/admin` 的 production bootstrap、Cookie/CORS、Admin adapter、
  一次性邀请 fragment 生命周期或 access 失败关闭；新增 actual bundle Operator/非 Operator 离线层。
- Operator journey 必须服务器重读 usage/users/invitations/audit，并覆盖筛选、停用、一次性邀请和 kill
  switch 的二步确认/写证明；非 Operator 在 access 403 后不得继续读取管理数据。2026-08-24 Phase 72
  进一步要求客户端不能从首次统一 403 推断角色：先完成一次密码重新认证，第二次 access 仍为 403 才
  显示无权限，期间始终不得读取下游管理数据。
- 一次性 fragment 刷新后必须消失且不进入 Web Storage/公开 snapshot。本地 strict authority 不证明真实
  角色、近期认证、告警渠道、备份恢复或部署完成；完整边界见 `admin-operations.md`。

## 2026-08-14：账号删除 accepted 后由 Cloud App 统一切换未登录态

- 数据权利页只拥有导出/删除交互，不拥有全局会话；删除 API accepted 后必须发出
  `onAccountDeleted`，由 Cloud App 清空当前 CSRF 并进入统一 signed-out 视图，不能继续保留账号控件或
  只显示“已退出”文案。
- actual Web 验收必须覆盖服务器重读 ready、新窗口短时签名下载、双重删除确认、清 Cookie 和后续
  数据 API 401；签名 URL/token 不进入主页面、Web Storage 或公开 authority snapshot。
- 该校准不改变 AccountDeletionJob 顺序、receipt replay、Supabase/Vercel 边界或真实环境验收要求；
  权威需求与完整 TDD 矩阵见 `account-data-rights.md`。

## 2026-08-14：Store 断开必须先撤销当前服务器设备会话

- “本机断开”升级为 DeviceDisconnect“断开此设备”：当前 token 只能撤销自身 DeviceSession，服务器
  统一 204 后才清本机会话、pending pairing 与账号绑定队列；不影响其他设备、Web、本机词库或 BYOK/
  外部词典凭据。
- 网络、超时或 5xx 保留 token 和账号绑定正文并提示联网重试；拒绝先清 token，因为这会永久丢失远程
  撤销能力。用户仍可从 Web 设备页撤销离线设备。
- 新 `DELETE /v1/extension-session` 不接受 session/owner/body，固定 Extension Origin、token shape 与
  strict version；退出不受最低版本 426 阻断。随机、过期、已撤销 token 统一 204，避免状态枚举。
- 详细需求、事务、测试和验收见 `extension-session-disconnect.md`，取舍见 ADR-0022。

## 2026-08-14：已练习学习项删除固定为内容抹除与最小墓碑

- 新增 `LearningItemErasure` 与 `LearningItemTombstone`，不再把 practiced-item 删除解释为归档或
  PracticeSession cascade；完整方案见 `learning-item-erasure.md`。
- 已练习 item 必须先归档，且所有引用 session 已终态、已完成自评并无生成/反馈 lease，才可清正文、
  canonical identity、来源、标签、系统属性和排期；非安全引用继续返回 `learning_item_in_use`。
- LearningItem detail/list 增加服务器 `hasPracticeHistory`，避免用仅覆盖 completed+rating 的
  `recentPractice` 猜测删除入口。PracticeSession 保留且公开 item 增加 `learningItemDeletedAt`；账号导出
  不生成墓碑 learning-item record，
  只在保留的 session 中解释 opaque item ID。删除最后一条引用 session 后清理墓碑。
- DELETE 成功响应增加 `deletionKind=hard-delete|erased`；新增稳定错误
  `learning_item_must_be_archived`。failed session 视为可单独删除的终态记录，非终态仍失败关闭。
- 该裁决释放已抹除 canonical identity，相同内容重建为新 LearningItem、新 ID 和新排期，不连接旧历史。

## 2026-08-14：学习项归档与不可逆删除必须分离

- LearningItemArchive 固定为可逆状态：归档项退出默认学习库、今日队列和新练习入口，但完整保留内容、
  排期、来源、标签与既有练习关系；恢复沿用原排期。
- public detail/export 增加 `archivedAt`，列表以服务器 `archived=false|true` 分开筛选；canonical identity
  不因归档释放，归档项不能编辑、语义建议或合并。
- 已练习项 hard-delete 仍被阻止；当时将 tombstone 的会话、导出和删除权裁决留给独立切片，不能用 FK
  cascade 冒充。该后续现由 `learning-item-erasure.md` 固定；归档方案仍见 `learning-item-archive.md`。

## 2026-08-14：当前账号聚合不得伪造账号级 consent

- `GET /v1/account` 固定为 active/full Web 的 owner snapshot：规范邮箱、完整五项 AccountPreferences、
  当前有效 ExtensionSession 公开投影和部署公开最低插件版本；quota 继续由独立端点/模块计算。
- 删除旧孤立契约中的 `consentVersion` 与恒定 `status`。配对勾选只证明本次批准动作；首次联网及
  Eudic/Shanbay recipient consent 都是各安装的本机版本化设置，不属于 HuayiAccount。
- 账号页使用聚合偏好初始化表单，避免同页重复读取；偏好更新、设备列表/撤销仍保留资源专用 seam，
  聚合不成为客户端缓存权威。完整方案与测试门槛见 `account-profile.md`。

## 2026-08-13：插件查询、学习采集与本机生词拆成独立权威

- BYOK 明确为 Store Extension 的一种模型执行模式，不是“插件版”产品线。账号登录后默认使用
  `platform`，用户只能在 Web 把账号全部插件显式切成 `byok`；各设备仍独立保存 Provider/Key，任何
  配额、网络、Key 或 Provider 失败都不得自动切换路径。
- 新增三项账号级插件偏好：查询模式默认 platform、StudyCapture 默认 manual、CloudWordCopy 默认
  enabled。配对批准原子展示/修改三项值；插件只读缓存，不能按设备覆盖。
- ExtensionQueryResult 是当前卡片的精简查询产物。BYOK 结果不上传；平台结果只在服务器保留最多一
  小时用于当前请求恢复，之后只留无正文 UsageLedger。两条路径使用同一 ResultCard schema，均不写
  AnalysisRecord、ReviewInbox 或分析历史。
- 新增 StudyCapture 保存原始 phrase/sentence/passage 学习意图。sentence/passage 可按账号设置在查询
  开始时自动加入，phrase 仅手动；exact NFKC/引号/空白规范化去重，created-only 当前卡撤销，关闭卡片
  后不恢复撤销。Web 先在 CaptureInbox 明确发起平台深度分析，再进入 ReviewInbox。
- WebDeepAnalysis 固定翻译+教学讲解，只接受 phrase/sentence/passage；V2 结果覆盖自然翻译、主干/
  从句/成分、语法/时态/语态、关键表达、适用时的省略/语气/言外之意，并且只产生 Expression 与
  SentencePattern 候选。旧 Store compact result、word 和 action 不再是 Web 分析输入。
- 插件本机 LocalLexiconEntry 是每个安装的正式独立数据，不属于 HuayiAccount。单词永远先本机保存；
  CloudWordCopy 只把以后新词的最小副本异步写入 Web，历史本机词条只能经数量预览和二次确认批量
  导入。登录、退出、换号与 Web 编辑都不改写本机词库。
- 历史批量导入的“数量”明确为词条数和全部语境数；一次确认后自动按最多 100 词/1,000 语境分批，
  零语境词条也创建云端 WordEntry，多语境和欧路无释义语境全部保留。任务使用独立加密进度与稳定
  幂等键；单条 future copy 与 batch import 共享本机内容指纹，跨路径精确去重且不覆盖 Web notes。
- 旧 `/v1/analyses:import`、`analysis-import` SubmissionOutbox 和“登录 BYOK/平台结果进入待整理”的
  产品路径被废止。新 outbox 只接受 `study-capture | cloud-word-copy`；Phase 22–26 相关绿灯保留为
  历史实现证据，必须在新契约上重新 RED→GREEN，不能作为当前候选完成声明。
- Web 分析内部引用统一为通用 `analysisUnitId=u1..u40` 与 `unitCount`，不再用 sentenceId 把 phrase
  伪装成句子。首次分析失败恢复 pending；reanalysis 失败保持 analyzed 与旧 latest。
- 完整 AccountDataExport 新增导出快照时尚未过期的平台 ExtensionQueryGeneration 公共投影，形成八类
  strict NDJSON record。用户确认生成的导出文件是最多保留 24 小时的独立私有副本；它不延长原
  generation 的一小时期限，也不把临时查询变成可浏览历史。
- ExtensionQuery 的一小时删除从 owner 请求顺带清理升级为独立 trusted cron。新增 durable
  `dispatched_at` 边界：未 dispatch 的过期调用释放额度且不记账，已 dispatch 的过期调用按预留上限
  保守结算；两者先形成失败终态，只有 terminal 到期后才可硬删正文/结果。
- Store 查询消息移除可携带相邻 DOM 的泛化 context，只允许精确选区、word/phrase 的必要单句语境和
  不含正文的可信边界证据。关联设备每次查询、采集或生词副本前有界同步偏好；配对披露只授权该
  DeviceSession，不成为第四项账号偏好。
- 详细权威方案见 `extension-query-and-study-capture.md`，并由 ADR-0019、ADR-0020、ADR-0021 记录资源
  所有权、无 fallback 与本机/云端词库边界。

## 2026-08-13：426 必须形成可恢复的本机升级阻塞而非网络重试

- 登录 BYOK import 的 426 不再归类普通 transient；SubmissionOutbox 保留加密正文、session 与原幂等
  键，只在加密 state 内记录触发阻塞的客户端版本，同版本 process 在 fetch 前停止。
- Popup 严格聚合响应新增 `client-upgrade-required`，只显示条数/最早时间与“更新语见”文案，禁用重试
  但保留二步本机清空；Content/Overlay/Options 不获得新 interface。
- 新客户端版本读取旧阻塞时只解除标记并恢复显式重试，不伪造服务器兼容成功；详细设计与数据兼容
  见 `store-upgrade-recovery.md`。
- Phase 27 strict union 下，current-card undo 只删除匹配项；队列仍有其他 item 时必须保留同版本升级
  阻塞。删除一条本机意图不能被当作“客户端已升级”，也不能重新触发同版本网络请求。

## 2026-08-13：Cloud ready 必须证明 API Extension 身份与候选版本策略一致

- Phase 26A 让 API 运行时强制固定 Extension ID/最低版本后，Phase 21 release audit 不能继续只验证
  候选 ID 格式而把部署值留给人工比对。
- `check:cloud-release` 现在同时接收候选 ID、API 公开 ID 与最低版本；两个 ID 必须相同，候选 Manifest
  版本必须按安全整数三元组大于或等于最低版本，任一缺失、非法或不一致都阻塞 ready。
- API environment 同步拒绝超出安全整数的最低版本，避免部署启动成功后才把所有 Extension 请求变成
  426；脚本与 runtime 不互相依赖，但由相同边界回归锁定语义。
- 这些值是公开发布元数据，不是 secret；离线一致性仍不能替代 Chrome Dashboard、真实部署环境和
  目标 Chrome Origin 证据。详细方案见 `release-runtime-consistency.md`。

## 2026-08-13：Extension 业务 token 必须绑定发布 Origin 与最低版本

- 既有 API 文档声明 client-version/固定 Extension Origin，但运行时只有 token。Phase 26A 将三个 Store
  business adapters 统一到 session-header interface，并在 production principal auth 查询 token 前验证
  `HUAYI_STORE_EXTENSION_ID` 和 `HUAYI_MIN_SUPPORTED_EXTENSION_VERSION`。
- CORS 只增加精确发布 Extension Origin 与 Authorization/client-version headers，不接受通配 Chrome
  Origin；Extension 请求继续 `credentials=omit`，身份归属仍只来自高熵 token。
- 陈旧/非法版本返回 426 `client_upgrade_required`。BYOK SubmissionOutbox 保留密文和原幂等键等待升级，
  不把兼容错误当永久正文错误删除；真实 Chrome Origin 行为仍需目标环境验证。

## 2026-08-13：分析浏览器验收必须从 SSE completed 进入服务器待整理权威

- Phase 25 不允许预种 AnalysisRecord 或由 preview/客户端表单拼出待整理结果；actual `/analysis` 只有
  strict completed event 才能完成，随后 Inbox 和学习库必须分别通过服务器 GET 重读。
- browser streaming authority 只接受计划中的 `manual + passage` strict fixture，并复用 production
  Cookie/Origin/CSRF/Idempotency proof；same-key 重放不创建第二条记录，different-body 稳定冲突。
- LearningItem 已有可信 SourceExample，因此学习库详情开始只读呈现来源标题、原文与翻译；仍不允许
  编辑/删除单条来源或在客户端建立第二权威。真实 Provider、quota、代理和数据库证据保持独立待办。

## 2026-08-13：邀请到学习项浏览器验收不得绕过邮箱确认

- 产品要求邮箱密码必须验证邮箱，因此默认离线 journey 不允许让 password register fake 直接建立
  session，也不允许预种 Cookie 冒充 onboarding 完成。
- Phase 24 改走同样受邀请约束的 Google 注册：claim ticket 仅经固定 API 原生 POST，fake Provider 只见
  opaque flow，callback 设置 HttpOnly Cookie 后再由 production Web adapter 手动创建 LearningItem。
- fake Provider 和 Web/API 保留域均由 Playwright 本地 fulfill，不访问真实 Google/Supabase；该证据只
  证明浏览器组合，不替代真实身份、部署 Domain/TLS 或邮件验证。完整方案见
  `web-onboarding-acceptance.md`。

## 2026-08-13：练习浏览器验收复用同一脱敏 CloudAuthority

- Phase 23 的造句/对话浏览器验收继续使用 Phase 22 actual Web bundle 与同站 HTTPS fake authority，不另建
  React-only harness 或第二个 API 权威；这样 Cookie/Origin/CSRF/revision/幂等与账号 quota 重读仍在同一
  浏览器拓扑中证明。
- authority 只新增聚合 `practiceProviderCallCount`，用于证明 pending 页面零自动调用和已完成操作的额度
  变化；公开 snapshot 禁止暴露答案、operation、task、reservation、模型输入或 Header。
- fake authority 不模拟 PlatformGeneration、RLS 或账本事务；这些继续由 Phase 23 unit/PGlite 证明。Web
  E2E support 同时纳入 strict TypeScript 门禁，避免运行时转译掩盖 fixture 类型漂移。

## 2026-08-13：付费练习生成必须在 Provider dispatch 前持久化

- 五类平台练习调用不能只复用可过期的领域 generation lease；Phase 23 新增独立 PlatformGeneration 与
  `practice_generation_tasks`，在 Provider HTTP 前固定 task、价格、额度预留和 durable dispatch mark。
- `claimed|reserved` 尚无外部副作用，可安全接管；`dispatched` 已可能计费，worker 丢失只允许最坏预留
  保守结算并 abandoned，不透明调用第二次；`ready` 保存 strict output 并零调用重放到领域事务。
- 句子题目与对话开场都先建立可恢复 pending session，不能用占位 prompt 冒充正式内容。Provider 只见
  有界正文/别名，usage 进入现有 UsageAllowance；生产组合只通过统一 PaidPracticeGenerator 调用固定
  DeepSeek adapter，缺失或非法价格、额度、模型配置继续 fail-closed。详见 ADR-0018 与
  `paid-practice-generation.md`。

## 2026-08-13：Cloud 候选 readiness 必须由独立证据审计判定

- 既有 Store 包审计证明自包含 BYOK 基线，不证明 Cloud API/Web origin、公开 privacy URL、运行时
  常量、Manifest 与披露一致。Phase 21 增加独立 `check:cloud-release`，当前 null-origin 开发态必须
  fail closed。
- 候选配置只含公开 origin、Extension ID 和 privacy URL；审计器不得读取或输出部署 secret，也不得
  访问网络。ready 只证明本地产物一致，不能代替真实服务、Dashboard 或商店人工预审。
- 既有 `check:store-release` 默认 Store 1.0 profile 保持不变；Cloud 只通过显式 expected hosts/CSP
  扩展其深模块，避免把未知 Huayi host 放宽成任意 endpoint。

## 2026-08-13：Cloud 跨端离线验收必须进入实际浏览器组合

- 组件测试、adapter 单测与 Extension fixture 不能证明 Web production bundle、浏览器 CORS/Cookie/CSRF、
  SPA 跳转及 Store import 后 Web 可见；Phase 22 增加 actual bundle + stateful fake authority 旅程。
- fake authority 只承担浏览器组合 seam，不复制 Postgres RLS/事务；Store harness 只替换 Provider、
  session/vault 与时钟，实际使用 packaged Content Script、AnalysisSession、SubmissionOutbox/alarm 和
  Cloud import adapter。
- 离线 route interception 不等于真实 Vercel/Supabase、Manifest host 权限或 Chrome extension process；
  对外完成声明继续要求真实环境和双平台 Chrome 证据。
- Phase 22 初稿的 `http://127.0.0.1` Web preview 会人为制造 HTTPS API 的第三方 Cookie 场景；实现前改为
  `web.huayi.invalid`/`api.huayi.invalid` 同站 HTTPS 保留域并全部本地 fulfill，既覆盖浏览器 CORS，又不
  混入与生产 session 不同的 Cookie 拓扑。

## 2026-08-13：Cloud 隐私页必须公开且先于 API 配置/登录分流

- Cloud V1 不复用旧 Store 1.0 的“无账户、无自有后端、端到端加密本地词库”商店口径；新 listing
  必须披露 Huayi API、服务器可读学习内容、账号、跨设备和平台模型，同时保留 BYOK/欧路凭据只在
  DeviceVault 的准确边界。
- Web 精确 `/privacy` 在 API Origin 解析和登录 bootstrap 前渲染，不能因部署配置或 Cookie 失效而
  不可访问，也不能从远端加载政策正文。
- 生产外部事实未核验前，页面明确标记预发布并列出运营主体、联系、区域和备份期限缺口；不得使用
  猜测值伪装 Chrome Web Store 已就绪。

## 2026-08-13：管理端是受限 Operator 投影，不是 service-role 超级后台

- Phase 19 固定 Operator 只能读取 email、账号状态、设备数、额度、无正文聚合与审计；禁止正文检索、
  代登录、任意 SQL 和用 Supabase service role 枚举用户作为普通管理查询。
- `user_profiles` 保存最近一次成功 Supabase 身份验证返回的规范化邮箱，使账号列表、游标、状态事务和
  审计位于同一 Postgres 快照；邮箱变化在下次登录刷新，并纳入完整账号导出/删除。见 ADR-0017。
- 管理 GET 要求 full session、operator 与最近认证但不要求 CSRF；mutation 另要求固定 Origin、CSRF 和
  Idempotency-Key。邀请 token 由服务器 secret + actor/key/strict request hash 稳定派生，数据库只存 hash
  和无秘密 snapshot。
- 停用改为严格 active→disabled，并原子撤销 Web/Extension session 与 pending/approved pairing；
  deleting 不可恢复，Operator 不能停用自己。kill switch 读写和审计进入同一运营深模块。

## 2026-08-13：账号完整导出使用私有任务，删除任务独立于账号正文

- Phase 18 把 AccountDataExport 定义为 strict 版本化 NDJSON，不再用同步 JSON 或 WordListExport 冒充
  完整备份；owner-RLS job 生成 private object，object ready 后设置 24 小时 expiry，每个 signed URL 最长
  15 分钟且不能越过 object expiry；到期先停止签发，删除失败保留内部 key 并告警重试。
- AccountDeletionJob 不引用 user_profiles FK。删除请求成功前先置 deleting 并撤销所有 Web/Extension
  session/pairing；worker 用 lease fencing 按 export objects→主库→Supabase Auth 顺序恢复，完成后清除
  subject UUID。主库步骤还处理 invitation/audit/runtime control 等没有 FK 的直接 UUID。
- 当前 runtime 缺 service-role Auth/Storage adapter 与受信 worker 入口；实现必须补齐并在任何配置缺失时
  production 启动失败关闭。官方核对后 worker 固定为 Vercel Cron GET + `CRON_SECRET`，不假设平台失败
  重试。详细方案与文档自审见 `account-data-rights.md` 和 ADR-0016。
- 现有 disabled 账号不能再登录，与“停用不阻止导出/删除”冲突；Phase 18 增加 DataRightsSession，
  disabled 重新验证后仅可导出、删除和退出，普通业务认证仍要求 active+full，deleting 继续拒绝登录。
- 现有 Google OAuth 只有邀请注册。为保证 Google-only 账号可重新认证，新增 `auth_flows.kind=login` 与
  普通 Google start/callback；它只接受既有 profile，不消费邀请、不自动注册或绑定新 identity。
- 删除请求在撤销 session 后若丢响应，原 Cookie 可用同 key/body 在 24 小时内重放固定 accepted receipt；
  job 只保存 pepper-hash proof，该通道不恢复 session、不返回任务或账号数据，过期后清除。
- 离线实现已接通 strict contracts、owner-RLS 导出任务、带 lease fencing 的导出/清理/删除 worker、
  Vercel Cron bearer 验证、Supabase private Storage/Auth service-role adapter、普通 Google 登录、
  DataRightsSession 与 Web `/settings/data`。生产配置缺失继续启动失败关闭；真实服务与浏览器联合验证
  仍是发布前门槛。

## 2026-08-13：词表下载是最小互操作导出，不是备份

- `GET /v1/words:export` 只在 owner transaction 中按 canonical key/id 排序输出 UTF-8 词头，每行一词、
  LF 换行；非空文件末尾恰好一个换行，空词库返回空文件。
- 响应文件名固定为 `huayi-words.txt`，Web 只接受固定 MIME/Content-Disposition。文件不含 notes、语境、
  释义、来源、任务、回执、账号字段或凭据，产品文案不得称其为完整备份。

## 2026-08-13：外部词典导入页与导出 item 使用不同租约载荷

- 原公共 lease response 只有 WordEntry entries，无法表达尚未进入 CloudAuthority 的 Eudic page；原
  `external_wordbook_items.word_entry_id` 也不能作为导入前置。Phase 7 改为 import 领取 job cursor，
  成功页才原子 upsert WordEntry/context/item；export 在创建任务时快照 item。
- 云端 ExternalWordbookJob/ExportOutbox 是唯一正式任务权威。Store production 不再向旧本地 outbox
  写新任务，也不把旧本地队列伪装成云任务上传。旧实现仅保留为迁移回归材料直至测试被新深模块替换。
- lease 使用 Extension 随机 nonce、服务器 HMAC-signed token 和 nonce-hash-only 持久化；Shanbay
  Content Script 只获得本机批次/item 别名，云 token 留在 Service Worker/独立 DeviceVault 加密 lease
  vault。
- Eudic export 最小化为 headword+可选原句，Shanbay 只有 headword。取消后的 export 可记录已发生副作用
  的迟到回执；取消后的 import page 不再创建词条。详细阶段、状态机和验收见 `external-wordbooks.md`。

## 2026-08-13：手动生词 upsert 不接受客户端来源或时间权威

- 未接线的旧 upsert 请求曾复用完整 ContextObservation 形状，允许浏览器提交 sourceType/observedAt；现
  收紧为手动正文/释义/标题，服务器固定 `manual`、now 与 ID。未来 Eudic import 使用独立任务入口。
- 同 canonical 的既有 WordEntry 保留 headword/notes；notes 仅创建时采用，新增非重复语境才推进既有
  revision。语境 hash 不含 observedAt，因此重复内容不制造第二条记录。
- 响应区分 word created/existing 与 context created/duplicate/omitted；`word.upsert` 按 key/hash 快照重放，
  Web 写后重读服务器权威。无新表；bootstrap 0001 只需扩 fixed operation allowlist。

## 2026-08-13：账号偏好采用窄服务器投影

- 新增 `GET/PATCH /v1/account/preferences`，只投影 `user_profiles.timezone/daily_goal`；不为尚未完成的
  `GET /v1/account` 伪造 consent、版本或 session 聚合字段。
- GET 只接受 Web Cookie，PATCH 还要求固定 Origin 与 CSRF；owner 只来自 session，Postgres 在 forced-RLS
  transaction 内读写。当前无 profile revision，最后一次通过严格 schema 的提交生效。
- Web `/settings/account` 保存失败时保留草稿，成功采用服务器响应；设置仅影响后续 daily queue，不改写
  已有 PracticeSession。未新增 migration，真实登录/部署浏览器 journey 仍待。

## 2026-08-13：Popup 可脱敏管理 Cloud SubmissionOutbox

- Store-domain 新增三个无参数内部命令：status、retry、clear；Service Worker 只接受当前扩展精确
  `popup.html` sender，响应仅含有界 state/outcome，以及 queued 时的 count/oldestQueuedAt。
- Popup 云端卡显示本机待提交条数与最早日期；重试复用加密队列内原幂等键并沿用 alarm，清空需二次
  确认且只删除本机 SubmissionOutbox，不影响云端权威、session、Provider 凭据或本地词库。
- API 未配置、联网同意关闭、session 无效或本机断开会清除旧账号绑定 payload；Content Script、
  Options、Overlay、Manifest 和 Cloud API 均未扩权。真实断网与 Store→API→Web Chrome journey 仍待。

## 2026-08-13：平台额度只投影服务器账本，BYOK 明确排除

- 登录 Web 通过 Cookie-only `GET /v1/quota` 读取当前 UTC 月 strict QuotaSummary；客户端不能提交 owner、
  时间或 Extension token，响应不缓存。完整 `/v1/account` profile/consent 聚合仍待，不伪造缺失字段。
- percent 只反映已结算使用，80% 进入 warning；used+active reservation 达限额时优先 exhausted，remaining
  同时扣除二者。无 grant 是 0 limit/exhausted 的诚实空配置。
- `/settings/account` 明确 BYOK 不进入平台 reservation/ledger；额度用完只停平台模型，不停浏览、手动
  录入、已有数据或本机 BYOK。

## 2026-08-13：分析历史 Web 维护区分写入事实与刷新结果

- Web `/history` 复用现有 owner-scoped history authority，展示服务器支持的搜索/状态/来源/选区筛选、
  签名游标分页、完整结构化 AnalysisRecord、候选与公开模型信息，不建立本地历史副本。
- 归档与 reviewState 始终独立；nothing-to-save、归档、恢复和二次确认删除沿用 revision/幂等接口。
  严格 mutation response 代表写入已完成，随后的 server reread 失败单独报告，不能把完成误报为失败。
- list/detail/action 都以 generation guard 抑制迟到响应；模型与来源内容仅作为纯文本投影，不渲染 HTML。

## 2026-08-13：生词维护保持词头与语境快照不可变并保护外部任务历史

- WordEntry 的 headword/canonical key 保持 identity，Web 仅编辑/清除 notes；ContextObservation 作为来源
  快照只读。word 与 context 各用资源隔离签名 cursor，context cursor 另绑定 word ID。
- 删除整个词条会级联 contexts，但已有 ExternalWordbookItem 引用时返回 `word_entry_in_use`，不借现有
  FK cascade 静默删除任务 item/receipt；未引用删除不触 AnalysisRecord、LearningItem 或 Practice。
- patch/delete 都锁 row/revision 并使用 owner operation/key/path-bound hash；删除后同请求从严格 snapshot
  重放。未发布 bootstrap 0001 只扩 `word.patch|word.delete` allowlist，既有开发库必须重建。

## 2026-08-13：练习历史如实投影未完成状态，单次删除不回滚排期

- 历史列出全部已持久化正式 PracticeSession，并明确 active、awaiting-feedback、failed、completed；
  completed_at 在最终反馈首次完成时固定，评分不改写。列表以独立签名 cursor 稳定分页，详情按类型返回
  造句答案/反馈或对话计划、轮次、最终逐项反馈与自评，不返回 owner 或内部 lease/reservation。
- 当时只有 completed 会话可经 Web 二次确认删除；LearningItemErasure 后续把无 lease 的 failed 也纳入
  可删除终态，active/pending 或任一 worker lease 仍统一 409。删除只级联 session items/turns/attempts，
  不删除或回写 live 学习项、排期与来源，也不倒推 due/level/streak/rating；最后引用可清墓碑。
- `practice.delete` 使用 owner operation/key/hash 和删除前严格响应快照；同请求在源行删除后仍可重放，
  不同 body 冲突。未发布 bootstrap 0001 增加 `completed_at` 与 operation allowlist，既有开发库必须重建。

## 2026-08-13：学习库维护以历史保留为先并只开放显式安全合并

- PATCH 重新规范 canonical，保持 item type/identity，原子替换 core/content、系统属性和规范化标签；
  exact duplicate、revision 与 idempotency 冲突均保留 Web 草稿。
- 当前不借 FK cascade 删除练习历史：有任一 practice 引用的 LearningItem 返回
  `learning_item_in_use`；未练习项目二次确认后硬删 item/schedule/source/tag joins，Tag 行保留复用，
  删除后的同 key 重放来自幂等响应快照。
- manual merge 只允许同 owner/type/current revisions 且 source 从未练习、level -1；target identity/core/
  schedule 保留，source metadata/examples/tags 去重追加后 source 硬删，无 redirect。preview 可过期，
  confirm 必须事务重验，不自动或跨类型合并。
- semantic model 只返回 bounded ID/reason/confidence，服务端从 owner-scoped current same-type 候选 hydrate；
  production 保持 model_unavailable，接 quota/claim/lease 前不调用真实模型。
- 未发布 bootstrap 0001 只扩固定 maintenance 幂等 operation allowlist；既有开发库必须重建，不能把
  0001 当增量 migration 重放。

## 2026-08-13：受约束对话以 turn-first 与 generation lease 落地

- PracticeSession 新增 strict DialoguePlan、pendingGeneration 和覆盖全部 items 的逐项 feedback；Daily Queue
  从单 `currentItem` 平滑升级为有序 `currentItems`，可恢复 1–3 项会话。
- start 先保存 DB reservation/lease；用户 turn 先落库，assistant turn 与 final feedback 均显式 retry、
  expired takeover、token fencing，模型调用期间不持事务。完成 3–5 round 后才允许 final；中途不纠错。
- Web `/practice` 增加多项选择、对话、pending 恢复、逐项反馈/来源与一次提交全部 ratings；窄屏、焦点、
  live region 和 reduced-motion 沿用现有 shell。production 模型仍 fail-closed，无真实额度/网络验证。
- 根审阅补齐丢失 turn 响应后的服务器重读和草稿裁决，并让 pending dialogue-start 省略未生成的 prompt，
  不把内部占位符公开成正式题目。
- 未发布 bootstrap 0001 增加 dialogue plan/feedback/generation lease；既有开发库必须重建。history/delete、
  quota ledger 接线与真实登录浏览器 journey 仍未完成。

## 2026-08-13：Phase 8 根审阅收紧日期、恢复与并发评分

- Daily queue 不再接受浏览器日期；服务端从可信时钟和账号 IANA timezone 计算本地日，并返回匹配的
  current session/item。
- active、awaiting-feedback 和 completed-but-unrated 均可刷新恢复；提交响应丢失时 Web 重读服务器
  权威，来源与自评不会因刷新消失。
- rating 在读取会话前取得行锁，跨幂等键的并发评分仍只推进一次；反馈 retry 只在 fenced completion
  成功后写幂等响应，活跃 lease 不会被缓存成永久结果。

## 2026-08-13：句子创作以 PracticeAttempt 和反馈租约落地

- 今日队列按服务器时钟与账号时区选择本地日内到期项，created/id 稳定排序后用新项补 dailyGoal；只对
  active owner 开放。`active | awaiting-feedback` 共同占用唯一活跃会话。
- 句子答案不再借用 dialogue turn：先原子写 PracticeAttempt，再调用反馈模型。initial/retry 共用
  attempt feedback lease；活跃 lease 抑制第二调用、过期可接管、completion/failure 按 token fencing。
- Web `/practice` 提供队列、句子作答、显式反馈重试、反馈后 SourceExample 和三档自评。production 模型
  仍 fail-closed，不宣称真实生成可用；dialogue/history/delete 未实现。
- 未发布 bootstrap 0001 新增 practice_attempts、反馈 lease 与唯一活跃索引；既有开发库必须重建，不能
  把 0001 重放当增量升级。

## 2026-08-13：句子创作区分作答、反馈与用户自评

- PracticeAttempt 是用户提交的一次句子创作答案，不是 dialogue turn；提交后即成为练习会话正式记录，
  即使模型反馈失败也不能丢弃或自动产生第二次付费调用。
- PracticeFeedback 只在作答提交后生成正确性、自然度与改进建议，不提供精确分数，也不替代用户的
  “不会／勉强／掌握”自评。只有完成反馈后才允许自评，ScheduleState 只由自评事务推进。
- 页面关闭或停止等待不等于服务器 PracticeSession 取消；V1 最小句子创作闭环不得伪造取消语义。

## 2026-08-13：学习库手动收录保持服务器单一权威

- strict `POST /v1/learning-items` 以 Web Cookie+Origin+CSRF、Idempotency-Key 和 tenant transaction
  原子创建 LearningItem、level -1 ScheduleState、规范化复用标签与 join；相同请求优先重放，不同 body
  冲突，同 owner/type/canonical 精确重复返回 409。
- Web 类型专属表单显式录入 Expression 或 SentencePattern（含槽位），成功后重读 server list/detail
  并聚焦/播报，精确重复保留草稿。edit/delete/merge/semantic/practice 仍未实现。
- Cloud 尚未发布且当前只有 bootstrap migration 0001；本变更扩其内部幂等 operation allowlist，既有
  开发数据库必须重建，不能把 0001 重放当作增量升级。
- 根任务 UI 复审区分了“创建请求失败”和“创建已成功但权威列表/详情刷新失败”：后一种必须明确告知
  已经收录并保留草稿供用户确认，不能诱导再次创建。当前筛选排除新条目时，页面仍显示 owner-scoped
  详情回读，并把空态表述为“当前筛选下没有学习项”，不误报整个学习库为空。

## 2026-08-13：学习库首个切片只读复用 Postgres CloudAuthority

- strict list/detail view 返回完整 LearningItem、ScheduleState 与最近一次 completed practice 的最小
  `{sessionId,type,completedAt,rating}` 摘要，不返回练习正文、反馈、owner 或内部排期 revision。
- type、规范化 tag、systemAttribute、字面 query、`due=new|due` 都在 owner tenant transaction/RLS 内
  过滤；new 取 level -1，due 由服务器当前时间判断。学习库使用独立 HMAC 签名 keyset cursor，不能把
  客户端筛选、时间或 offset 变成权威。跨账号详情与不存在统一 404。
- Web `/library` 只投影服务器列表/详情，覆盖筛选、分页和恢复状态，不持久化第二份学习库。本切片不
  开放 create、patch、delete、merge、语义建议或练习动作。
- 根任务安全复审为分析历史与学习库 cursor 的 HMAC 增加不同的签名上下文，即使生产共用同一密钥，
  两类合法 cursor 也不能跨资源复用；Web 列表、翻页和详情读取使用运行代次抑制旧响应，避免快速筛选
  或连续选择时让较早的网络结果覆盖用户最后一次操作。

## 2026-08-13：Web 粘贴分析复用服务器 SSE 与待整理权威

- `/analysis` 只构造 strict manual 请求：用户提供英文、可选标题、动作和内容类型；userId、Provider、
  model、quota 与 endpoint 不进入表单或请求权威。现有 Web adapter 继续注入 Cookie、固定 Origin、CSRF
  和每次运行的新幂等键。
- started/preview/completed/failed 以可访问状态渐进显示，preview 只存在当前页面内存；严格 completed 或
  owner-scoped request status 确认完成后才交接到既有 `/app` Inbox，不建立第二份客户端记录。
- 取消通过 AbortSignal 停止本页消费并使旧运行代次失效，迟到 preview/terminal 不再更新页面。V1 没有
  平台任务取消端点，因此文案明确服务器可能继续并落入待整理；started-only 的 `running` 状态不伪装
  成完成，也不允许立即重复提交。失败重试保留输入并使用新 key。

## 2026-08-13：Cloud SubmissionOutbox 由 Service Worker 独占并绑定扩展会话

- 只有活动 extension session 与固定 API 配置同时存在时，严格完成的本机 BYOK 结果才先加密排队再
  以稳定幂等键导入；未登录、过期或未配置保持 local-only。现有 Store 结果可按公共 Schema 原样导入，
  没有 Candidate 时保留空数组，不能补造表达或句型。
- Web 配对批准在 session 签发前重新披露 Huayi Cloud 接收的英文选区、完整分析、来源类型、公开模型
  版本和待整理用途，明确排除页面 URL、完整页面与 API Key，并要求用户显式勾选。
- Cloud outbox 不复用 Options 可见的外部词典 outbox；它使用 DeviceVault DEK、独立 storage key、
  AAD 和严格 envelope，只有 SW 持有 payload、幂等键和 session token。Content Script/Options 消息
  契约不扩展，Manifest 不增加权限。
- transient 失败由 alarm 以同一 key 重试；永久无效 payload 逐项丢弃；401/403、session 过期、本机
  断开、新 session 建立或撤回联网同意会在后续请求前清除账号绑定队列，避免跨账号或撤回后正文
  泄露。当前不向浮层宣称云端成功，逐项人工管理、脱敏状态、真实离线/Chrome journey 与发布 API
  origin 仍待后续。

## 2026-08-13：邀请领取后清除 URL，Google 启动使用严格原生 POST

- 安全复审将邀请链接从 `/join/<token>` 收紧为 `/join#<token>`：fragment 不随首个 HTTP 请求发送，
  避免托管/CDN path 日志记录密钥；领取请求使用 `no-referrer`，成功后立即以 `replaceState` 清除
  地址栏。claim ticket 仅在当前
  组件内存和 Google 原生 POST 的单个隐藏字段短暂存在，不进入 query、hash、local/session storage
  或日志。注册成功后页面清除 ticket。
- Google start 保留原有严格 JSON 行为，并增加浏览器顶层 302 导航所需的严格 form-urlencoded 分支；
  只接受一个合法 `claimTicket`，拒绝额外、重复、缺失、非法、过长字段及其他 Content-Type。
- Web 表单 action 只由经过验证的固定 HTTPS API origin 构造。当前实现提供邀请绑定的 Google 注册
  启动与邮箱密码注册/登录，不把 Supabase client 放入 Web，也不伪造 provider 成功；普通 Google
  登录、身份绑定和真实 Supabase/Google/邮件 journey 仍需后续受控验证与切片。

## 2026-08-13：服务器设备撤销与扩展本机断开是两个明确动作（已由 DeviceDisconnect 更新）

- Web 设备页通过账号 Cookie 列出服务器仍有效的 Extension session，只显示设备标签、创建、最近
  使用和到期时间，不返回 token、install ID、hash 或其他设备秘密。
- Web 撤销必须经过显式二次确认，并以固定 Origin + CSRF 删除当前账号拥有的指定 session；跨账号
  ID 返回 not_found。撤销成功后该 token 立即失效，不能由客户端 userId 改变归属。
- 当时 Store Popup 的“本机断开”只删除本机加密凭据，不伪装成服务器撤销。2026-08-14 已按该条预留的
  独立端点升级为 remote-first DeviceDisconnect；历史边界不再是现行产品行为。

## 2026-08-13：配对客户端秘密仅由 Service Worker 持有，公开轮询不暴露 consumed

- Web 只用 HttpOnly Cookie + Origin + CSRF bootstrap 确认登录态，并在固定配对路由显式批准设备；
  本切片不伪造 Google、密码或邀请流程，未登录页明确提示登录流程仍未接线。
- Extension 的 state、PKCE verifier 和 session token 使用 DeviceVault DEK 下的独立严格 envelope
  加密持久化，只有 Service Worker 组合该窄 vault；Content Script、Options 和通用 CredentialSlot
  均不获得读取能力。稳定 install ID 可明文持久化，但出站只发送其 SHA-256。
- 无认证轮询只返回 pending/approved/expired；成功 exchange 后再次轮询得到 not_found，不序列化
  consumed 或设备标签。Popup 仅消费脱敏状态，生产 API/Web origin 缺失时保持 not-configured。
- 当时 Popup 的“本机断开”只删除本地 pairing/session 秘密，不伪装成服务端设备撤销；服务器设备列表
  与撤销由 Web 账号页承担。该历史实现现由 2026-08-14 DeviceDisconnect 条目取代。

## 2026-08-13：候选确认使用类型路由、显式精确合并和原子批次

- WordCandidate 只进入 WordEntry/ContextObservation；Expression 与 SentencePattern 只进入
  LearningItem/SourceExample。来源正文、译文、类型和标题复制自可信 AnalysisRecord 句子快照。
- create 遇到同 owner/type/规范键时返回 `exact_duplicate`，不自动合并；merge 必须显式指向同
  owner/type/key 目标，保留已有核心字段，仅追加去重的来源、用户标签和系统属性并递增 revision。
- 整批确认以 analysis revision、Idempotency-Key/hash 和 RLS 归属原子提交；任一选择失败无副作用，
  成功后才把分析置为 reviewed。Web 与 Store 已有共享契约 HTTP adapter，但 UI、语义重复建议和跨端
  journey 仍是后续工作。

## 2026-08-13：Store 的 Web 入口采用无参数命令并在发布地址缺失时失败关闭

- Content Script/浮层只能发无参数、版本化的 `open-web-workspace` 命令，不能携带 URL、analysis ID、
  token 或模型结果；固定 HTTPS 目标只由 Service Worker 的发布配置拥有。
- 目标未配置、响应不严格或 sender 不是本扩展时不创建标签页，并向浮层显示失败状态；不得使用
  `.example` 等保留域名伪装成功。该入口无需新增 `tabs` 权限。
- 候选编辑、标签、确认和合并继续只存在于 Web，Store 浮层只显示查询结果、云状态和打开入口。

## 2026-08-13：分析历史采用签名 keyset 分页与原子 revision/幂等写入

- 历史默认排除归档，以 `(created_at,id)` 降序和签名版本化 cursor 分页；筛选支持整理状态、归档、
  来源、选择类型和字面正文/标题 query，不允许 `%`、`_` 改变查询含义。
- nothing-to-save、归档、恢复、删除统一要求 Idempotency-Key、If-Match 与匹配的 expected revision；
  Postgres 原子保存严格响应，delete 后仍可重放，同 key 不同 hash 和旧 revision 均无副作用。
- 删除 AnalysisRecord 只删除未确认 Candidate；已复制 SourceExample 保留并把分析引用设空。Web 与
  Store adapter 使用同一 Cloud 契约，但本阶段不新增完整历史 UI。

## 2026-08-12：平台分析采用持久租约、重放和保守过期终态

- 平台分析用独立 `analysis_requests` 持久化 owner/key/request hash、运行租约、精确价格版本、预留和
  terminal event；跨实例同 payload 只允许一个 worker 调用模型，不同 payload 在 SSE 前冲突。
- 生成租约固定 4 分钟，额度预留固定 5 分钟，以容纳初次与一次修复调用。完成、失败和恢复统一按
  request→reservation 锁序，并在任何记录/账本写入前验证 fencing token。
- 过期生成不透明重试，因为旧 worker 可能已经产生供应商费用；恢复事务以原价格和预分配账本 ID
  保守结算并持久化失败事件。terminal 请求可重放；用户再次生成必须使用新幂等键。

## 2026-08-12：Web 与 Store Extension 改为双端同步推进

- Store 当前开发阶段已经提交，后续不再采用“先完成全部 Web、再开始 Store”的严格串行顺序。
- 共享契约/API 先达到单个纵向切片的可消费门禁，随后 Web 与 Store 在同一切片内同步开发；两端保留
  独立 focused gate，合并前必须通过共享 fixture、API 集成和跨端 journey。
- 这只改变开发协作与验收顺序，不改变 CloudAuthority、产品边界、一次性开放策略或 Classic 冻结状态。

## 2026-08-12：Phase 3 基础实现收口

- API 生产依赖 `postgres` 用于无 prepared statement 的 Supabase transaction-pooler 访问；相较直接
  使用 Supabase Data API，它能表达事务、角色切换、advisory lock 和 SECURITY DEFINER 调用。连接串
  只在服务端环境，业务连接为 NOBYPASSRLS 角色。
- `@supabase/supabase-js` 仅作为 Auth adapter，替代自行实现 OAuth/密码协议；使用 publishable key，
  PKCE 暂态状态经 AES-256-GCM 加密后持久化，不把 service role 或 refresh token 发往客户端。
- 测试依赖 PGlite 在默认离线门禁中执行真实 PostgreSQL 方言迁移、RLS 与事务函数；它替代脆弱的 SQL
  字符串假实现，但不宣称替代真实多连接 Supabase/Postgres 或目标区域验证。

## 2026-08-12：Phase 2 主任务验收修正

- `PracticeSession` 响应从单纯 `itemIds` 改为携带有序 `items`，每项包含排期前快照以及可选的
  自评和排期后快照；提交答案中的 `itemIds` 只能引用本会话项目。这样公共资源才能完整表达
  `practice_session_items`，并保证重放与历史审计不依赖当前排期状态。
- Phase 2 退出 fixture 由 API、Web 和 Store Extension 各自通过 `cloud-contracts` 公开入口解析，
  不以包内自测替代跨客户端兼容证据。

## 2026-08-12：Phase 1 主任务验收修正

- 固定共享纯规则的方向为 `store-domain -> learning-domain`；`cloud-contracts` 只依赖
  `learning-domain`，避免云端公共契约反向耦合 Store 客户端包。
- Vercel 当前原生 Hono 检测要求认可入口默认导出 app，因此只允许
  `apps/api/src/server.ts` 作为平台适配器例外；其他业务模块继续只使用命名导出。
- workspace 的 `test` 命令改为运行对应 Vitest project，避免未来新增测试被首个样例文件掩盖。

## 2026-08-12：建立 Cloud V1 基线

- Store Extension 直接演进为 Cloud 客户端，Classic 0.13 冻结；不并存两个 Store 扩展。
- 产品由 Extension 查询入口与 Web 学习工作台组成，同一 HuayiAccount 和 API 是学习数据唯一权威。
- Store 尚未发布且没有本地词库真实用户，取消旧 WordEntry 数据迁移和双写兼容。
- Extension 保留本机 OpenAI/DeepSeek BYOK；Web 只使用平台 DeepSeek V4 Flash。
- 未登录 BYOK 只做临时查询；登录后的 BYOK/平台分析都上传完整已校验结果并进入 Web 待整理区。
- Extension Overlay 不承担候选选择、编辑或合并，所有整理与学习活动转到 Web。
- BYOK 与欧路凭据继续只存本机 DeviceVault；语见 API 不接收或代理。
- 单词进入云端统一管理但不参加 Huayi 复习；Expression 与 SentencePattern 才是主动练习项，原句只
  是 SourceExample。
- V1 练习包含句子创作和 3–5 轮受约束文字对话，保存完整练习历史，使用透明固定间隔阶梯。
- 平台全部模型功能共用每 UTC 月默认 1 美元额度；管理后台可以按账号覆盖。
- 邀请链接不绑定邮箱，72 小时、单次使用；Web 支持 Google 与邮箱密码。
- Web/API 采用 React+Vite/Hono，Supabase Auth/Postgres 与 Vercel 双项目；服务器可读但正文不进日志。
- V1 复用现有语见设置页视觉，仅预留语义 token；主题切换延后。
- 工程按阶段实现，但完整功能通过后才一次性向邀请用户开放。
