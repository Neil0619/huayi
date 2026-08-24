# Hosted 重要批次备份与可重建证据契约

## 1. 目的与当前边界

Supabase Free 不提供可依赖的自动备份。Hosted 验收环境虽然不是正式 production，仍已包含真实 Auth
identity、邀请与用户学习数据；任何 forward-only migration 或重要部署批次前后都必须留下可恢复证据，不能
把“migration dry-run 通过”当成备份。

Phase 82–85 交付默认离线、失败关闭的计划、执行器就绪度审计、完整 platform image lock、本机镜像检查与
证据验证模块：

- 固定 Supabase project `kpadiulxkgckskcfydry` 和当前批次 `phase-81-0014`；
- `pnpm acceptance:hosted:backup:plan` 只渲染固定计划，零文件、Git、网络和写入；
- `pnpm acceptance:hosted:backup:preflight` 只读取本机固定证据目录，验证 0014 前备份和候选空库重建；
- `pnpm acceptance:hosted:backup:complete` 再要求 0014 后备份，关闭整个重要批次；
- `pnpm acceptance:hosted:backup:executor:plan` 零 I/O 地列出 pre capture、isolated rebuild、post capture
  三个固定 operation；对应 `executor:*:readiness` 只做本地 Git/runtime 分类并固定失败关闭；
- `pnpm acceptance:hosted:backup:platform-lock:verify` 零 Docker、零网络校验 pinned CLI/config/source provenance、
  14 个 start service 的 11 active + 3 disabled 分类、完整 lock SHA-256 tripwire，以及 active image 的
  index/双平台 manifest digest；
- `platform-lock:local-images` 只允许受控 local-only resolver 选出的 Unix socket 与绝对 Docker executable
  执行 `docker image inspect`，没有 pull/build/run/start/registry manifest 命令；当前 macOS 验收机的 11 个
  index-digest reference 已全部检查通过。此前受控获取步骤已按 11 个 index digest 和 `linux/arm64` 下载
  镜像；检查与修复步骤没有追加 pull，整个阶段没有运行镜像；
- 本阶段没有可执行 capture、restore、scratch rebuild、Supabase connection 或 migration apply 命令，也
  没有执行真实 dump。

审计确认当前本机 `pg_dump`/`pg_restore`/`psql` 是 14.6，而 Hosted/仓库目标为 PostgreSQL 17。Phase 83
已经把 Supabase CLI 2.115.0 对应的数据库镜像固定为
`docker.io/supabase/postgres:17.6.1.159@sha256:86a2e078779e5bdccda1f6f6c5063aa9779a322d1fface5fb408d051909b230f`，
并禁止再信任 host client。Phase 84 又从 CLI `v2.115.0` 的 embedded Dockerfile、默认 config、start gate
源码与仓库 `supabase/config.toml` 得出完整 service graph：11 个镜像会启动，Realtime、ImgProxy 与
Supavisor 分别因显式/默认 gate 为 false 不启动。11 个 exact tag 均锁定 Docker Hub registry 返回的
index digest 与 `linux/amd64`、`linux/arm64` platform manifest digest。Phase 85 修复了实际 OrbStack socket
位置与 Docker Hub canonical `RepoDigests` 表达差异；当前 macOS 验收机的 11 个固定镜像已完成 local-only
inspection，但没有运行镜像，也没有受审查写执行器。真实 capture/restore 必须先关闭剩余前提，再由用户
明确批准后单独实现和执行。本机检查 GREEN 只证明当前 host 的镜像缓存与 lock 一致，不证明数据库已经备份、
恢复或重建，其他执行 host 也必须重新检查。

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

每个目录只允许上述固定文件。`.partial`、CA、`.pgpass`、临时 restore、stdout capture 或未知文件都会令门
失败。失败的未来 capture 必须先清理所有局部文件；只有 dump 关闭、计算 SHA-256、核对大小后，才能原子
写入 manifest。

## 3. 逻辑备份证据

`backup-manifest.json` 只允许以下固定元数据：contract、project ref、batch、pre/post phase、当前候选
commit、UTC 捕获时间、`verify-full-administrator` 连接 profile、`postgres-custom` 格式、固定 dump 文件名、
字节数、SHA-256 和 migration head。pre 必须为 `20260823010000`，post 必须为
`20260824010000`；manifest 的 candidate commit 必须等于验证时的 Git HEAD，且验证时不能存在 tracked 或
untracked 的候选漂移。ignored 批次 evidence 不计入工作树漂移。

真实逻辑 dump 是**原始敏感备份**。未来的 full-database custom archive 只有在固定 TOC/只读 contract
证明后，才能声称包含可访问的应用 schema/data、migration history、Auth 数据库行与 Storage metadata；
`pg_dump` **不包含 Storage object bytes**，也不包含 cluster/global roles、Hosted Auth provider/SMTP、DNS、
Edge Functions、environment 或平台密钥。Storage objects 必须先由固定只读 contract 证明为零；若非零，
必须另行批准并实现 Storage API object export，本批次继续阻塞。archive 不是“脱敏”“匿名化”或可分享的
发布证据，不得复制到 Git、聊天、工单、测试 fixture、日志或 stdout。未来受控 capture 必须：

1. 只使用固定 project 的 verify-full 管理员 session pooler `5432`；transaction pooler `6543` 禁止用于
   dump/restore；密码只写入固定 `0600` 临时 `.pgpass` 并 read-only mount，容器只得到固定 `PGPASSFILE`
   path，不能收到 `PGPASSWORD` 或 secret-bearing Docker argument；CA 只来自
   `HUAYI_HOSTED_DATABASE_CA_CERTIFICATE`，写入固定 `0600` 临时文件、read-only mount，并只通过固定
   `PGSSLROOTCERT` path 使用；
2. 以参数数组和 `shell:false` 调用上方 digest-pinned PostgreSQL 17 database image 内的 custom-format
   `pg_dump`，并用显式 fixed `--file` 写入固定目录；本机 14.6 永远不参与，不能冒充兼容；Docker 必须复用
   受控 resolver：macOS 从 OS 当前用户信息派生固定 `~/.orbstack/run/docker.sock` 并只调用
   `/Applications/OrbStack.app/Contents/MacOS/xbin/docker`，Linux 只允许 `/var/run/docker.sock` 与
   `/usr/bin/docker`。不得读取 `HOME` 或任意 env socket；`DOCKER_HOST`/`DOCKER_CONTEXT` 即使为空也必须
   在 spawn 前失败；
3. 运行前确认目标文件系统的静态加密/访问控制；不能证明时停止，改用经验证的安全临时介质；
4. 不转发工具 stdout/stderr，不记录 row、identity、正文、token、secret 或原始数据库错误；
5. 预创建 `0600` partial，成功关闭后 `fsync`、计算 SHA-256/size、atomic rename 并 `fsync` 目录；canonical
   manifest 最后以同样的 partial/fsync/rename 顺序生成；
6. 无论成功或失败都清理固定 CA、partial、manifest temp 和 scratch temp；成功后只保留 dump 与严格
   manifest。

本地 `supabase db dump --help` 证明 CLI 2.115.0 不提供 custom-format flag；官方 CLI 文档同时说明默认
dump 无 data/custom roles 且会过滤 Supabase managed schemas。官方 platform restore 指南采用 roles/schema/
data 三份 SQL，而不是 PostgreSQL custom archive。两种 artifact 不得混称；本阶段保留 custom archive
contract，但在 pinned image 离线验证、完整 coverage contract 与写执行器落地前失败关闭，不会用看似安全却覆盖不明的 CLI SQL、
伪匿名 dump 或手写 manifest 代替备份。

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

命令退出 0、`pg_restore --list`、本机已有数据库或一组静态 SQL 测试都不能单独形成该证据。未来真实重建
工具必须使用固定且不同于 Hosted/本机验收的 project identity、固定无冲突端口与 repository-pinned image
digest，从空 scratch 开始；只复制仓库 migrations 与虚构 seed，执行完整 migration/seed/固定 bounded
contract，确认没有 Hosted 数据，并在删除 scratch 后才原子写 manifest。证据不保存表计数、账号、邮箱、
ID、正文或 dump 内容。完整 lock 的 14 个 service gate 精确分类为：Postgres、Logflare、Vector、Kong、
GoTrue、Mailpit、PostgREST、Storage、Edge Runtime、Postgres Meta、Studio 启动；Realtime 因仓库显式
`enabled=false`，ImgProxy 因可选 `storage.image_transformation` section 缺失并默认 false，Supavisor 因
`db.pooler` 缺失并默认 false 而不启动。CLI `supabase start` 在 cache miss 时会主动 pull，因此不能用普通
start 证明 offline。未来 start 前必须先通过静态 lock verifier 与全部 11 个 index-digest reference 的
local-only image inspection；当前 macOS 验收机已通过该检查，但 reviewed writer 未 pinned，readiness 仍必须
失败。其他执行 host 必须独立重跑检查，不能复用本机结论。

## 5. Phase 81 动作依赖

0014 的顺序现固定为：

1. 运行零网络 `acceptance:hosted:backup:plan` 与 `acceptance:hosted:backup:executor:plan`；
2. exact pre/rebuild/post readiness 在静态 platform lock、本机 11 镜像检查或写执行器缺失时必须失败；
3. 关闭前提并通过独立代码审查/明确授权后，完成 pre raw logical dump 和 migrations+fictional-seed scratch
   rebuild；
4. `acceptance:hosted:backup:preflight` 必须通过；
5. 才能把“用户已批准实际应用唯一 0014”描述为 ready；
6. 应用后、部署前或同一重要批次关闭前完成 post dump；
7. `acceptance:hosted:backup:complete` 必须通过；
8. 再按 API→Web 严格串行 one-shot arm/deploy/disarm 继续。

缺少、过期、权限过宽、工作树不干净、未 ignored、hash/size 不符、candidate commit 漂移、migration head
不符、目录含未知文件或 scratch 未销毁时一律固定失败。不得手写 manifest、复制旧批次证据或把 dry-run
输出当 backup。

## 6. 验收边界

默认离线测试必须证明：

- 两个 plan 不访问 filesystem/Git/network；三个 readiness 只允许固定 operation/project/batch 并且没有
  capture/restore/rebuild 写入口；
- 参数不能注入 project、路径或 operation，错误只输出固定消息；
- readiness 即使 fake 或当前真实 runtime 全 ready 也必须因 write executor 未 pinned 失败，不得创建 evidence；
  本地 inspector 只通过 platform-fixed Unix Docker socket 与固定 absolute executable 读取 daemon/local image
  metadata、固定 CLI version 与 FileVault status；macOS path 由当前 OS 用户信息而不是 username/HOME 组成，
  Linux 保留 `/var/run/docker.sock`。selector/env socket、缺失/非 socket target、非 executable 与不支持平台均
  失败，且只输出 allowlisted verdict，不转发 raw stdout/stderr；静态 lock verifier 必须在零 Docker/
  零 network 下拒绝 CLI/config/env/version override/service/digest 漂移；完整 lock 内容由独立 SHA-256
  tripwire 绑定，合法格式但错误的 digest 也必须失败；
- preflight/complete 校验固定 project、batch、clean HEAD、ignore、目录/file mode、exact keys、size/hash 和
  pre/post migration head；
- rebuild manifest 必须是 migrations+fictional-seed、Hosted data absent 且 scratch destroyed；
- 日志和错误不反射 manifest、路径输入、账号、正文或 secret；
- Hosted deployment action ledger 把 backup preflight 放在 0014 apply 之前。

真实 dump、restore、scratch rebuild、Supabase 连接和 retained-backup 删除仍分别需要批准、运行证据与清理
证据；本文件不关闭 Storage object export、Supabase 备份残留期限或正式 production 恢复演练。

## 7. 官方约束来源

- [Supabase CLI `db dump`](https://supabase.com/docs/reference/cli/supabase-db-dump)：默认 schema dump、
  data/role 需显式 flag，且 CLI 使用 Supabase managed-schema filtering；
- [Supabase platform CLI backup/restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)：
  官方可移植流程使用 roles/schema/data 三份 SQL 与 session pooler；
- [Supabase database backups](https://supabase.com/docs/guides/platform/backups)：数据库备份只包含 Storage
  metadata，不包含 Storage API object bytes。
