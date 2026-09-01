# Hosted 重要批次备份与可重建证据契约

## 1. 目的与当前边界

Supabase Free 不提供可依赖的自动备份。Hosted 验收环境虽然不是正式 production，仍已包含真实 Auth
identity、邀请与用户学习数据；任何 forward-only migration 或重要部署批次前后都必须留下可恢复证据，不能
把“migration dry-run 通过”当成备份。

2026-08-25 当前校准：Phase 81 pre/rebuild/preflight 后 0014 已实际写入，但 postflight 因 Supabase
`anon`、`authenticated`、`service_role` 的 public-function `EXECUTE` 漂移而失败。后续 6543 只读诊断已
确认 0014 结构完整，禁止重跑。`phase-81-0014` 的 pre 仍是不可变 pre-0014 恢复点；不得重新捕获当前
14-chain 冒充旧 pre，也不得运行旧 post/completion 形成不安全 post-state。修复使用
`public-function-acl-hardening.md` 定义的 Phase 91 独立 pre-0015/rebuild/post batch。

Phase 82–86 交付失败关闭的计划、执行器就绪度审计、完整 platform image lock、本机镜像检查、受审查
writer 与证据验证模块：

- 固定 Supabase project `kpadiulxkgckskcfydry` 和当时的 Phase 81 批次 `phase-81-0014`；当前 Phase 91 使用
  独立 `phase-91-0015-public-function-acl-hardening`；当前 Hosted DeepSeek 0016–0021 又使用第三个
  `hosted-deepseek-0016-0021` batch。三者不能互换；
- `pnpm acceptance:hosted:backup:plan` 只渲染固定计划，零文件、Git、网络和写入；
- `pnpm acceptance:hosted:backup:status` 只读 partial batch，并按 pre/rebuild/post 固定输出
  present/valid/current 九个布尔 verdict；不输出路径、时间、commit/hash、identity、dump 元数据、错误或秘密；
- `pnpm acceptance:hosted:backup:rebuild:retire` 只在 clean HEAD=upstream、active/history 两个 evidence root
  均 ignored，且 active rebuild strict present+valid 但 stale 时，把完整 rebuild leaf 原子保留到固定历史层级；
- `pnpm acceptance:hosted:backup:preflight` 只读取本机固定证据目录，验证 0014 前备份和候选空库重建；
- `pnpm acceptance:hosted:backup:complete` 再要求 0014 后备份，关闭整个重要批次；
- `pnpm acceptance:hosted:backup:executor:plan` 零 I/O 地列出 pre capture、isolated rebuild、post capture
  三个固定 operation；对应 `executor:*:readiness` 只做本地 Git/runtime 分类，不连接 Hosted 或生成证据；
- `pnpm acceptance:hosted:backup:platform-lock:verify` 零 Docker、零网络校验 pinned CLI/config/source provenance、
  14 个 start service 的 11 active + 3 disabled 分类、完整 lock SHA-256 tripwire，以及 active image 的
  index/双平台 manifest digest；
- `platform-lock:local-images` 只允许受控 local-only resolver 选出的 Unix socket 与绝对 Docker executable
  执行 `docker image inspect`，没有 pull/build/run/start/registry manifest 命令；当前 macOS 验收机的 11 个
  index-digest reference 已全部检查通过。此前受控获取步骤已按 11 个 index digest 和 `linux/arm64` 下载
  镜像；检查与修复步骤没有追加 pull，整个阶段没有运行镜像；
- Phase 86 新增且只新增三个 exact-confirmation-gated 入口：`backup:capture:pre`、`backup:rebuild` 与
  `backup:capture:post`。它们不接受 project/path/URL/image/phase 参数。早期 exact rebuild 的安全失败均未形成
  evidence；clean `c61fa0b` 后来完成过正式 networkless rebuild、销毁 scratch 并生成严格 rebuild manifest，
  这是历史成功检查点，不是当前 ignored evidence 状态声明；
- tracked 文档不记录 ignored evidence 是否仍 present/valid/current。当前操作状态只以
  `pnpm acceptance:hosted:backup:status` 的固定回读为准；进入 preflight 前必须同时得到
  `pre_current|t` 与 `rebuild_current|t`，不得从 `c61fa0b` 历史或文档措辞推断。

审计确认当前本机 `pg_dump`/`pg_restore`/`psql` 是 14.6，而 Hosted/仓库目标为 PostgreSQL 17。Phase 83
已经把 Supabase CLI 2.115.0 对应的数据库镜像固定为
`docker.io/supabase/postgres:17.6.1.159@sha256:86a2e078779e5bdccda1f6f6c5063aa9779a322d1fface5fb408d051909b230f`，
并禁止再信任 host client。Phase 84 又从 CLI `v2.115.0` 的 embedded Dockerfile、默认 config、start gate
源码与仓库 `supabase/config.toml` 得出完整 service graph：11 个镜像会启动，Realtime、ImgProxy 与
Supavisor 分别因显式/默认 gate 为 false 不启动。11 个 exact tag 均锁定 Docker Hub registry 返回的
index digest 与 `linux/amd64`、`linux/arm64` platform manifest digest。Phase 85 修复了实际 OrbStack socket
位置与 Docker Hub canonical `RepoDigests` 表达差异；当前 macOS 验收机的 11 个固定镜像已完成 local-only
inspection。Phase 86 已将实际执行 reference 去掉 tag、只保留
`docker.io/supabase/postgres@sha256:86a2e078779e5bdccda1f6f6c5063aa9779a322d1fface5fb408d051909b230f`，
并落地受审查 writer；带 `17.6.1.159` 的 reference 仅保留 provenance，不进入 Docker argv。本机检查 GREEN
与 writer 离线 GREEN 不证明数据库已经备份或恢复；`c61fa0b` 的历史正式 rebuild 只证明该候选当时可从
repository migrations + fictional seed 重建。任何时点的 evidence currentness 均须由 `backup:status` 回读，
其他执行 host 也必须独立检查。

2026-08-27 的新批次细节以 `hosted-deepseek-migration-batch.md` 为权威：Phase 91 三份 evidence 继续保持
历史不可变；新 pre head 为 `20260825010000`，rebuild/post head 为 `20260827060000`，source set 精确为
21 files。离线 writer/rebuild/capture/evidence/status 复用本文件的 `0700/0600`、official CA、verify-full、
digest-only、networkless scratch、不可覆盖与失败关闭规则，但拥有独立 batch/container/runner/confirmation
identity。当前只实现控制面，没有运行新 readiness、capture、rebuild、status、dry-run、apply 或 completion。

## 2. 固定证据目录与权限

当前批次只允许使用本克隆已忽略的窄目录：

```text
artifacts/hosted-important-batch-backups/phase-81-0014/
├── pre/
│   ├── database.dump
│   └── backup-manifest.json
├── post/
│   ├── database.dump
│   └── backup-manifest.json
└── rebuild/
    └── rebuild-verification.json
```

`hosted-important-batch-backups`、批次和三个子目录必须精确为 `0700`；dump 与 manifest 必须精确为
`0600`、是普通文件且不是 symlink。验证器同时要求当前候选工作树干净、Git 对批次目录返回 ignored；
另一个 clone 未配置本地 ignore 时失败关闭，不允许为了通过而把 dump 放进跟踪目录。

候选推进后，strict valid 但 `current=false` 的 rebuild manifest 会阻止 writer 生成当前候选证据。它不能被
删除、覆盖、手改或复制回 active batch。唯一受控出口是 fixed confirmation 的 `backup:rebuild:retire`：先
要求 clean HEAD 精确等于 upstream、active/history root 均由本 clone ignore、active batch/leaf 仍是
`0700/0600` 且 leaf 只有最终 `rebuild-verification.json`，再从 strict manifest 内部读取旧 40 字符 candidate
commit。工具要求固定历史候选目录尚不存在，以原子 `mkdir` 占位后把整个 active `rebuild` leaf 原子 rename
至下列 clone-local protected hierarchy，绝不覆盖：

```text
artifacts/hosted-important-batch-backup-history/
└── phase-81-0014/
    └── <stale-candidate-commit>/
        └── rebuild/
            └── rebuild-verification.json
```

history root、batch、candidate 与 retained rebuild 目录保持 `0700`，manifest 保持 `0600`；创建与 rename
两侧目录均 `fsync`。成功后 active batch 的 status 必须报告 rebuild absent，历史证据仍受保护。invalid/current/
extra entry/destination occupied/dirty/upstream mismatch/ignore mismatch/rename 或 fsync 失败均只输出固定
body-free failure；失败时尽可能保留 active 或 history 中至少一份完整 evidence，不执行 delete 或手工覆盖。
retained history 删除不属于该入口，仍需独立生命周期、批准与证据。

完整 pre/rebuild/post 已在 migration candidate 上关闭、随后仅因受控部署提交推进 HEAD 的批次，不属于上述
“缺 post 的 stale recovery unit”。`current=false` 只说明它不再满足 mutation 前的 current-candidate 门，
不能据此退役或重捕。批次专用 historical completion 必须在 clean `HEAD==upstream` 上只读重验三个固定
leaf、canonical manifest、实际 dump hash、同一历史 candidate、post 时间边界，以及该 candidate 仍存在并为
当前 HEAD 的 ancestor；它不连接 Hosted、不写 evidence，只形成等价历史 closure，不能伪称原 completion
调用当时已留下成功 receipt。

Hosted DeepSeek `hosted-deepseek-0016-0021` 不能复用上面的 0014 fixed identity 或只退役 rebuild。它的
专用 `acceptance:hosted:deepseek:migration:backup:retire` 只接受 active batch 精确为同一 stale candidate
的 strict `pre + rebuild` 且 `post` absent，再把两份 evidence 作为不可拆分单元原子 rename 到：

```text
artifacts/hosted-important-batch-backup-history/
└── hosted-deepseek-0016-0021/
    └── <stale-candidate-commit>/
        └── evidence/
            ├── pre/
            │   ├── database.dump
            │   └── backup-manifest.json
            └── rebuild/
                └── rebuild-verification.json
```

专用入口额外要求 stale commit 在 Git 中存在且为 clean pushed HEAD 的 ancestor；history destination 预占、
目录双侧 `fsync`、历史再验证和失败后至少一侧保留完整单元，均不放宽 `0700/0600`、symlink/unknown-entry
拒绝或现有 preflight 的 current-candidate 门。成功后 active batch 缺席并可由既有不可覆盖 writer 为当前
候选重建；它不连接 Hosted、不读取 secret、不运行 capture/rebuild/preflight/status/dry-run/apply。本控制面
已实现但尚未执行，真实 retirement 仍需单独批准。

每个目录只允许上述固定文件。`.partial`、CA、`.pgpass`、临时 restore、stdout capture 或未知文件都会令门
失败；写入口必须在连接或启动 scratch 前确认目标 leaf 精确为空。capture/rebuild 在每个正常异常路径都只
清理固定 partial、CA、`.pgpass`、未完成 final 与自身精确匹配的 container/scratch；只有 dump 关闭并
`fsync`、固定完整 TOC 行验证，且验证前后的 SHA-256/size 都未变化，再完成 atomic rename 与目录 `fsync`
后，才能最后原子写入 manifest。既有 final evidence 永不覆盖。

## 3. 逻辑备份证据

`backup-manifest.json` 只允许以下固定元数据：contract、project ref、batch、pre/post phase、当前候选
commit、UTC 捕获时间、`verify-full-administrator` 连接 profile、`postgres-custom` 格式、固定 dump 文件名、
字节数、SHA-256 和 migration head。pre 必须为 `20260823010000`，post 必须为
`20260824010000`；manifest 的 candidate commit 必须等于验证时的 Git HEAD，且验证时不能存在 tracked 或
untracked 的候选漂移。ignored 批次 evidence 不计入工作树漂移。

真实逻辑 dump 是**原始敏感备份**。full-database custom archive 只有在固定 TOC/只读 contract
证明应用 data、migration history、Auth 数据库行与 Storage metadata 的 TABLE DATA entry 都存在后才提交；
`pg_dump` **不包含 Storage object bytes**，也不包含 cluster/global roles、Hosted Auth provider/SMTP、DNS、
Edge Functions、environment 或平台密钥。Storage objects 必须先由固定只读 contract 证明为零；若非零，
必须另行批准并实现 Storage API object export，本批次继续阻塞。archive 不是“脱敏”“匿名化”或可分享的
发布证据，不得复制到 Git、聊天、工单、测试 fixture、日志或 stdout。受控 capture 固定为：

1. 只使用固定 project 的 verify-full 管理员 session pooler `5432`；transaction pooler `6543` 禁止用于
   dump/restore；管理员数据库密码的本地 shape gate 以 Supabase 建议的至少 12 个字符为下限，并保留
   512 字符的本地安全上限，同时继续拒绝 NUL、CR 和 LF；这不改变 application 数据库密码的独立 32+
   字符契约。密码只写入固定 `0600` 临时 `.pgpass` 并 read-only mount，容器只得到固定 `PGPASSFILE`
   path，不能收到 `PGPASSWORD` 或 secret-bearing Docker argument；同一单命令先从固定 Supabase Singapore
   官方 URL 获取公开 CA，强制 GET/no redirect/no credentials/no referrer、10 秒/16 KiB 与严格单一 PEM，
   成功后才从固定管理员 Keychain account 读取密码。调用者不准备 CA environment；CA 写入固定 `0600`
   临时文件、read-only mount，并只通过固定 `PGSSLROOTCERT` path 使用；
2. 以参数数组和 `shell:false` 调用无 tag 的 digest-pinned PostgreSQL 17 database image 内的 custom-format
   `pg_dump`，并用显式 fixed `--file` 写入固定目录；本机 14.6 永远不参与，不能冒充兼容；Docker 必须复用
   受控 resolver：macOS 从 OS 当前用户信息派生固定 `~/.orbstack/run/docker.sock` 并只调用
   `/Applications/OrbStack.app/Contents/MacOS/xbin/docker`，Linux 只允许 `/var/run/docker.sock` 与
   `/usr/bin/docker`。不得读取 `HOME` 或任意 env socket；`DOCKER_HOST`/`DOCKER_CONTEXT` 即使为空也必须
   在 spawn 前失败；
3. `psql`、`pg_dump`、`pg_restore` 分别使用固定 name/label，运行前确认同名 identity 不存在。运行结束后
   必须等待 Docker client 真正 `close` 并回查；overflow/timeout/异常路径还必须覆盖最多约 4.9 秒的晚创建
   窗口。只有 digest runtime 与 label 都精确匹配时才可强制删除遗留容器，并再次 inspect 证明不存在；未知
   同名容器必须失败关闭且不得删除。固定 Docker inspect 的 absent 只允许 exit 1 + empty stdout，或 OrbStack
   已验证的 exit 1 + 精确 `\n` / `[]\n`；不得对输出做宽松 trim 或接受其它 JSON/空白；
4. 运行前确认目标文件系统的静态加密/访问控制；不能证明时停止，改用经验证的安全临时介质；
5. 不转发工具 stdout/stderr，不记录 row、identity、正文、token、secret 或原始数据库错误；
6. 预创建 `0600` partial，成功关闭后 `fsync`、计算 SHA-256/size、atomic rename 并 `fsync` 目录；canonical
   manifest 最后以同样的 partial/fsync/rename 顺序生成；
7. 无论成功或失败都清理固定 CA、partial、manifest temp 和 scratch temp；成功后只保留 dump 与严格
   manifest。

本地 `supabase db dump --help` 证明 CLI 2.115.0 不提供 custom-format flag；官方 CLI 文档同时说明默认
dump 无 data/custom roles 且会过滤 Supabase managed schemas。官方 platform restore 指南采用 roles/schema/
data 三份 SQL，而不是 PostgreSQL custom archive。两种 artifact 不得混称；本 writer 保留 custom archive
contract，并在 pinned image、完整 coverage contract 或固定 filesystem 步骤任一失败时关闭，不会用覆盖不明
的 CLI SQL、伪匿名 dump 或手写 manifest 代替备份。

## 4. migration + fictional seed 重建证据

`rebuild-verification.json` 与 Hosted dump 独立。它证明当前 candidate 在隔离、非 production 的 scratch
数据库中只从仓库 migration 与虚构 `supabase/seed.sql` 重建，不导入 Hosted dump 或用户数据。manifest
只允许记录：固定 contract/project/batch、candidate commit、post migration head、UTC 完成时间、固定
`repository-migrations-and-fictional-seed` 来源，以及以下全部为 true 的安全布尔量：

- migration chain exact；
- fictional seed exact；
- runtime contract exact；
- Hosted data absent；
- scratch destroyed。

命令退出 0、`pg_restore --list`、本机已有数据库或一组静态 SQL 测试都不能单独形成该证据。重建工具使用
固定且不同于 Hosted/本机验收的 container identity、无网络/无端口/无 host 或 named volume 的单一 tmpfs
PGDATA，以及 repository-pinned digest-only Supabase PostgreSQL 17 runtime，从空 scratch 开始。Postgres-image
readiness 只接受最终 PID 1、`pg_isready`、`auth.users`/`auth.schema_migrations`、`storage` schema 与两个服务
admin role；随后依次用 platform lock 中 digest-only GoTrue/Storage 镜像运行 migration-only command。runner
共享 scratch 的 networkless namespace，只经 loopback 访问 scratch，不开放端口、不挂载 volume/bind、不 pull，
且只使用固定虚构本地配置。完整 Auth/Storage database baseline 通过后，它精确读取 14 条仓库 migration 与
SHA-256 固定的虚构 seed，逐条应用并记录 migration ledger。seed 中会返回 quota identifier 的函数调用必须
使用匿名块内 `PERFORM`，不得以顶层 `SELECT` 把随机结果写入 stdout；每段 SQL 都必须同时满足 exit 0 与
stdout 精确为空，不能因为最终数据正确而忽略过程输出漂移。随后执行 bounded
baseline/migration/seed/runtime/absence contract，确认 Auth user/identity、
Storage object、邀请/claim 与除唯一虚构 profile 外的数据均为空，并在删除 scratch、回查 container 不存在后
才原子写 manifest。start race 也必须先校验完整 scratch identity；未知同名容器不得删除。证据不保存表计数、账号、邮箱、
ID、正文或 dump 内容。完整 lock 的 14 个 service gate 精确分类为：Postgres、Logflare、Vector、Kong、
GoTrue、Mailpit、PostgREST、Storage、Edge Runtime、Postgres Meta、Studio 启动；Realtime 因仓库显式
`enabled=false`，ImgProxy 因可选 `storage.image_transformation` section 缺失并默认 false，Supavisor 因
`db.pooler` 缺失并默认 false 而不启动。CLI `supabase start` 在 cache miss 时会主动 pull，因此不能用普通
start 证明 offline。writer 不调用普通 `supabase start`；任何 scratch 前必须先通过静态 lock verifier 与
全部 11 个 index-digest reference 的 local-only image inspection，实际 DB container 再以 `--pull never`、
`--network none` 和无 tag digest reference 启动。其他执行 host 必须独立重跑检查，不能复用本机结论。

## 5. Phase 81 动作依赖

以下顺序是 0014 执行前冻结的原始契约。真实执行已到第 5 步并因 ACL postflight 漂移停止；第 6–8 步现被
Phase 91 取代，不能继续运行旧入口。

0014 的顺序现固定为：

1. 运行零网络 `acceptance:hosted:backup:plan` 与 `acceptance:hosted:backup:executor:plan`；
2. exact pre/rebuild/post readiness 在 clean candidate、静态 platform lock、本机 11 镜像检查、FileVault、
   pinned CLI 或 writer 任一缺失时必须失败；失败只报告确定优先级下首个固定 allowlisted stage：repository
   state、Docker target/daemon、Supabase CLI、FileVault、platform lock 或 local platform images；未分类的
   inspector rejection 仅映射为固定 runtime-inspection。全部满足时只回报 readiness passed，仍不执行写操作；
3. 独立代码审查/明确授权后，分别运行 `pnpm acceptance:hosted:backup:capture:pre`（从固定管理员
   Keychain account 读取密码）与 `backup:rebuild`。两者是互不依赖的 preflight prerequisite，可按任一顺序完成；只有两份证据都绑定同一
   clean current candidate 后才进入 preflight。若 active rebuild strict valid 但 stale，先运行唯一固定
   `backup:rebuild:retire` 保留旧 leaf，再为 clean current candidate 重跑 readiness/rebuild；pre capture
   不再要求准备 CA environment 或拼接 shell；
4. `acceptance:hosted:backup:preflight` 必须通过；
5. 真实 dry-run 通过且用户独立批准实际写入后，只运行
   `acceptance:hosted:migration:0014:apply`；该入口在同一执行内重新 dry-run 唯一 0014、mutation 前再次
   验证 preflight 与固定 migration mirror SHA-256，并在写后用只读事务验证完整 canonical chain、0014
   column/check/function/ACL；不得手工运行 `supabase db push --yes`。若入口返回“未验证”，不得重跑 apply，
   只能运行 `pnpm acceptance:hosted:migration:0014:status`：`applied-exact` 才进入 post capture，
   `pending-exact` 也必须先由代码审查确认失败发生在 mutation 前，`uncertain` 则保持停止并继续只读诊断；
   `uncertain` 的唯一下一入口是
   `pnpm acceptance:hosted:migration:0014:status:diagnose`，其固定谓词用于区分连接/SQL/输出失败和 catalog
   混合状态，但本身不授权 apply 或 post capture；
6. 应用后、部署前或同一重要批次关闭前，经独立批准只运行
   `pnpm acceptance:hosted:backup:capture:post`，由固定管理员 Keychain account 提供密码并完成 post dump；
   同样不准备 CA environment；
7. `acceptance:hosted:backup:complete` 必须通过；
8. 再按 API→Web 严格串行 one-shot arm/deploy/disarm 继续。

当前恢复顺序固定为：保留 Phase 81 pre → Phase 91 docs/测试/候选 → Phase 91 pre-0015 + 15-chain
isolated rebuild → preflight → exact 0015 dry-run/apply/postflight → Phase 91 post/completion → API/Web
串行 one-shot。Phase 91 与 Phase 81 的目录、batch ID、migration head、manifest 和 completion 不能互换。

Phase 91 使用专属 `acceptance:hosted:phase91:backup:*` 命令面：plan/executor plan/status、三个 readiness、
capture pre、rebuild、preflight、capture post 与 complete。它固定
`phase-91-0015-public-function-acl-hardening`，pre head 为 `20260824010000`，rebuild/post head 为
`20260825010000`；base Phase 81 命令不接受、读取或覆盖 Phase 91 evidence。本地完整门已经通过，但 clean
candidate 与双平台 CI 尚未形成；在两者完成及分别批准之前不得运行真实 capture 或 Hosted migration。本地
plan/status/readiness 也不能被描述为已生成恢复点。

缺少、过期、权限过宽、工作树不干净、未 ignored、hash/size 不符、candidate commit 漂移、migration head
不符、目录含未知文件或 scratch 未销毁时一律固定失败。不得手写 manifest、复制旧批次证据或把 dry-run
输出当 backup。

## 6. 验收边界

默认离线测试必须证明：

- 两个 plan 不访问 filesystem/Git/network；三个 readiness 只允许固定 operation/project/batch 且不执行
  capture/rebuild；三个写入口另以 exact confirmation 隔离；
- 参数不能注入 project、路径或 operation，错误只输出固定消息；
- readiness 只有 clean candidate、完整 runtime 与 pinned writer 全 true 才通过，但不得创建 evidence；
  本地 inspector 只通过 platform-fixed Unix Docker socket 与固定 absolute executable 读取 daemon/local image
  metadata、固定 CLI version 与 FileVault status；macOS path 由当前 OS 用户信息而不是 username/HOME 组成，
  Linux 保留 `/var/run/docker.sock`。selector/env socket、缺失/非 socket target、非 executable 与不支持平台均
  失败；结构化诊断按固定 priority 只选择首个 stage，且不转发 raw Error/stdout/stderr、路径、digest、secret
  或 environment；capture 继续只输出单一 generic failure。isolated rebuild 一旦进入执行，只能从固定内部
  allowlist 报告 source-validation、docker-target、scratch identity/start/runtime/readiness、auth/storage
  baseline、完整 baseline、migration ledger/application、fictional seed、final contract、scratch destroy 或
  evidence persistence 中一个 stage，禁止
  使用捕获异常或 child output 生成 stage。静态 lock verifier 必须在零 Docker/
  零 network 下拒绝 CLI/config/env/version override/service/digest 漂移；完整 lock 内容由独立 SHA-256
  tripwire 绑定，合法格式但错误的 digest 也必须失败；
- status 必须容忍 pre/rebuild/post 的任意 partial subset；存在的证据仍完整执行权限、canonical body、内容与
  candidate 校验，只输出九个固定布尔值。plan 不读取状态，也不得静态宣称 capture/rebuild 成功或失败；
- retirement 必须用 Fresh RED 覆盖 fixed argument、clean HEAD=upstream、双 ignore、strict stale manifest、
  `0700/0600`、exact active leaf、occupied destination、atomic whole-leaf rename、目录 fsync、成功后 active
  status absent，以及 rename/fsync failure 的唯一证据保全；CLI 不得反射 manifest body、路径或 raw error；
- preflight/complete 校验固定 project、batch、clean HEAD、ignore、目录/file mode、exact keys、size/hash 和
  pre/post migration head；
- rebuild manifest 必须是 migrations+fictional-seed、Hosted data absent 且 scratch destroyed；
- capture tests 必须证明 secret 不进入 argv/child env/log/stdout，只进入固定 `0600` `.pgpass`/CA read-only
  mounts；TTY 测试还必须证明关闭 echo 发生在提示前、不使用 readline redraw，且 macOS 真实 PTY 中虚构
  marker 零回显；process timeout 必须等 child `close`，late-create 窗口只能清理精确 identity；rebuild tests
  必须证明 digest-only、`--pull never`、`--network none`、tmpfs-only、exact 14 migrations、fictional seed、
  fixed bounded outputs、BusyBox/GNU 兼容的 `head -n 1` 与精确 `1\n` stdout、Postgres-image readiness 竞态、
  fixed Auth→Storage runner 顺序/network namespace/零 mount、Entrypoint/environment identity、真实五分钟
  单调时钟 deadline、每种失败 cleanup、未知同名容器不删除与 manifest-after-destroy ordering；
- 日志和错误不反射 manifest、路径输入、账号、正文或 secret；
- Hosted deployment action ledger 把 backup preflight 放在 0014 apply 之前。
- 0014 apply 默认测试必须证明 preflight 在 secret read 前以及 dry-run 后/mutation 前各通过一次；两份 migration
  mirror byte-identical 且匹配固定 SHA-256，dry-run 只列唯一 0014，apply argv 固定，postflight 以只读事务
  验证完整 chain 与 0014 identity/ACL。apply 非零或 postflight 失败只能输出固定“不要重试”结果。

真实 dump、current-candidate scratch rebuild、Supabase 连接和 retained rebuild/backup 删除仍分别需要批准、运行证据
与清理证据；历史 rebuild 不能替代 `backup:status` 的 current verdict。本文件不关闭 Storage object export、Supabase 备份残留期限或
正式 production 恢复演练。后者的独立 target、restore order、evidence lifecycle、季度 cadence 与删除门见
`hosted-logical-backup-restore-drill.md`；它不是 Phase 81/0014 的新增前置条件，只能在当前验收批次关闭并
取得独立批准后实施。

## 7. 官方约束来源

- [Supabase CLI `db dump`](https://supabase.com/docs/reference/cli/supabase-db-dump)：默认 schema dump、
  data/role 需显式 flag，且 CLI 使用 Supabase managed-schema filtering；
- [Supabase platform CLI backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)：
  官方可移植流程使用 roles/schema/data 三份 SQL 与 session pooler；
- [Supabase database backups](https://supabase.com/docs/guides/platform/backups)：数据库备份只包含 Storage
  metadata，不包含 Storage API object bytes。
- [Supabase Postgres roles](https://supabase.com/docs/guides/database/postgres/roles)：数据库密码建议至少
  12 个字符；capture 的本地门禁据此采用 12 字符下限，并独立保留 512 字符安全上限，而不是复用应用
  数据库密码的 32+ 字符边界。
