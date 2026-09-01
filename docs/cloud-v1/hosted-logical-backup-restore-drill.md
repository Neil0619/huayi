# Hosted production 逻辑备份恢复演练方案

## 1. 目的、状态与非目标

本方案把“已经生成 raw logical dump”与“该 dump 可以在 Supabase 托管约束下恢复”分成两项独立证据。
`hosted-important-batch-backup.md` 的 pre/post capture 和 migration+fictional-seed rebuild 只能证明归档存在、
仓库可以从 migration 重建；它们不能证明生产备份可恢复。

本阶段状态为 **offline control plane and networkless PG17 fictional full restore implemented;
approved production adapter and hosted drill pending**。影响范围是
`shared recovery tooling/docs + hosted production operations + macOS operator host`：

- 这不是 Phase 81 / migration 0014 的新依赖，不改变当前 pre backup、isolated rebuild、preflight、0014、
  post backup 与串行部署顺序；
- 离线控制面实现不依赖当前 Hosted 验收批次；只有该批次关闭后才允许安装 production adapter，任何真实
  项目创建、归档读取、恢复或删除还需要独立、明确批准；
- 不把真实 archive 复制到开发库、fixture、日志、聊天、工单、Git 或共享对象存储；
- 不向 production 恢复，不在 production 上运行验证写入，也不把恢复演练当作回滚 migration；
- 不配置 DNS、Vercel、Custom SMTP、OAuth、Edge Function、Cron、Provider key 或出站邮件；
- 数据库 archive 不含 Storage object bytes。object bytes 非零时必须先完成另一个加密 Storage API export/
  restore 契约；不能用 metadata 恢复冒充完整恢复。

离线控制面已经提供 strict evidence/lifecycle、canonical private artifact store、reviewed TOC/order、TTY secret
拒绝继承、有界 fixed-client child、私有 CA/`.pgpass`、identity-safe cleanup、body-free HMAC/安全矩阵，以及下文
固定 package 入口。`restore:plan` 是零 I/O；其他入口在 production source/project/retention/region/PG major
获批并安装 reviewed adapter 前固定失败关闭，不能通过 CLI 参数、环境变量或手写 JSON 补齐。独立入口
`pnpm acceptance:hosted:restore:fictional:verify` 已在两个 fixed-identity、networkless、tmpfs-only 的
digest-pinned PostgreSQL 17 容器间完成虚构 custom archive 的生成、TOC 审查、恢复、安全核验与强制销毁；
它不读取 approved plan、Hosted archive 或 secret，不写 production evidence，更不证明真实 Hosted drill 已执行。

private approved plan exact 绑定 approval reference/time、tool/source full commit、source capture time、migration
head、archive bytes/SHA-256、manifest/coverage/TOC identity、Storage bytes 分支、retention contract/deadline、target
region 与 PostgreSQL 17；target 创建时间必须晚于批准时间。每个非 plan 入口还要求 clean HEAD=upstream、
ignored evidence root 与 tool commit exact，不能用旧 plan、dirty checkout 或替换 archive 继续。

第一轮 production 演练关闭发布门，之后按季度执行；事故恢复可以额外运行，但不能替代最近一个季度演练。
验收环境 archive 只有在 future capture contract 同样生成 body-free coverage report/TOC identity 时才可用于
实现期 rehearsal；当前 Phase 81 v1 manifest 不得手工补字段或自动升级，更不能关闭 production source
archive 的恢复门。

## 2. 目标环境决策

真实演练固定使用**临时、全新、隔离的非生产 Supabase recovery project**，而不是普通 development project，
也不是仅有 PostgreSQL container 的本机 scratch：

1. recovery project 与 source project 位于同一受控组织、同一区域和同一 PostgreSQL major；项目名称由工具
   按 `seen-said-recovery-YYYY-QN-<nonce>` 生成，不接受用户路径、project ref 或 URL 参数；
2. 项目必须在演练批准后新建，且创建时间晚于批准时间。恢复前证明 Auth user/identity、Storage object、
   product schema、migration ledger 和业务行为空；Supabase 自带的 platform baseline 只按固定 allowlist
   接受；
3. 不连接 Vercel、custom domain、SMTP/OAuth、Cron、Vault、Edge Function、Provider、analytics sink 或
   webhook，不分发 anon/service-role key，不允许 Web、Store 或 API 客户端访问；
4. restore 完成后先完成 body-free 验证，再删除整个 project 并从管理面回读其不存在；不能把演练项目保留
   为开发环境。

选择真实 Supabase target 是因为演练必须覆盖托管 Auth/Storage schema、platform roles、extensions、
PostgreSQL major、TLS、RLS 与 application role 的组合语义。本机 networkless PostgreSQL 17 仍用于默认 TDD、
fixture archive 和失败清理测试，但没有 GoTrue/Storage 平台基线，不能替代季度 Hosted 证据。

演练执行 host v1 固定为受控 macOS：复用现有 FileVault、固定 OrbStack socket、绝对 Docker executable 与
digest-only PostgreSQL 17 runtime。共享 JSON/parser/process tests 仍必须在 macOS 和 Windows 门运行；这不
表示 Windows 已成为 recovery operator host，也不改变语见的 Windows 产品支持。若以后支持 Windows 执行，
必须另行实现并实机验证 BitLocker、固定 Docker Desktop executable/named-pipe、secret prompt 与 cleanup，
不能沿用 macOS 证据推断完成。

## 3. Source archive 绑定与进入条件

真实 source 必须是已经由受控 capture 生成的 production `postgres-custom` archive 与严格 manifest。开始
前在只读阶段同时验证：

- archive、manifest 和 body-free coverage report 都是 `0600` regular file、不是 symlink，父目录逐级
  `0700`，位于
  已验证的静态加密介质；
- manifest contract、source environment/project identity、candidate full commit、migration head、capture
  UTC、dump bytes/SHA-256、format 与实际文件完全一致；
- source manifest 自身的 canonical SHA-256、固定 TOC allowlist SHA-256 和 coverage profile identity 一致；
- coverage 包含全部 application-owned schema/data、migration ledger、Auth user/identity rows 与 Storage
  metadata；unknown TOC entry、缺 entry、额外 schema 或 archive 在检查期间变化均失败关闭；
- Storage objects 为零，或已经存在另行批准的 encrypted object export manifest。后者只以 manifest digest
  绑定，本方案绝不把 object bytes 嵌入数据库 archive、JSON evidence 或 stdout；
- source archive 的 candidate commit 仍可从 repository checkout 取得，migration chain 与 manifest head
  一致；演练可以针对旧 production archive checkout 对应 commit，但不能用当前 HEAD 冒充 source HEAD；
- 在开始前已经确定 retained-backup deadline。未知 Supabase/platform retention 或隐私期限时停止，不能
  填写猜测数字。

archive 不包含 cluster/global roles、数据库登录密码、Supabase Auth/SMTP/OAuth 配置、JWT/service-role key、
DNS、Vercel environment、Edge Function、Vault 或 Storage object bytes。恢复工具不得调用
`pg_dumpall --globals-only`，也不得从 source 复制 role password、platform secret 或控制面配置。

## 4. 技术路线与恢复顺序

### 4.1 零写入 plan 与 target-empty proof

控制面提供固定入口 `restore:plan`、`restore:source:verify`、`restore:target:verify-empty`、
`restore:execute`、`restore:verify`、`restore:cleanup`、`restore:retention:verify`、
`restore:retention:close`。plan 零 filesystem/Git/network/write；其余入口只接受与已生成 drill plan 绑定的
exact confirmation，不接受任意 project、host、URL、path、image、schema 或 SQL 参数。

仓库 package 名称统一加 `acceptance:hosted:` 前缀，例如
`acceptance:hosted:restore:plan`。`restore:execute` 必须在同一受控进程内完成 restore 与 body-free verify 后才
提交 `restore-verification.json`；`restore:verify` 只在 exact file set 推导为 `restored-verified` 时返回 0，
只重读该 strict evidence、不重放 restore；cleanup 后必须使用 `status` 和 retention contract，不能让
`verify` 对 `target-destroyed`、`retention-pending`、closed 或任何失败状态返回成功。当前默认 stage adapter
未安装，因此除 plan 外的入口只返回固定失败；这正是尚未冻结 production identity 时的安全状态。

创建 target 后、任何数据库写入前，管理员以 session pooler `5432`、verify-full 与固定 CA 完成 target-empty
proof：

- PostgreSQL major、region、extensions、managed Auth/Storage catalog 与 platform roles 符合 fixed target
  baseline；
- `auth.users`、`auth.identities`、`storage.objects` 为空，额外 bucket 为零；
- `huayi_private`、source plan 固定的全部 application public/private table、
  `supabase_migrations.schema_migrations` 的 application ledger 和全部 `huayi_*` product role 均不存在；
- outbound/control-plane surface 全部 absent：无 custom SMTP/OAuth、Cron/Vault/Edge、custom domain、Vercel
  link 或外部分发 key；
- target identity canonical input 只在进程内计算 SHA-256，evidence 只保存 digest，不输出 project ref、组织
  ID 或管理员账号。

任一项不是精确空状态时必须删除 target 或停止并等待人工处置，不能清空一个已有 project 后继续。

### 4.2 恢复执行顺序

恢复只使用 source archive、其 exact TOC allowlist 和 source commit 对应的 reviewed restore plan：

1. 在 target 内创建全新的 drill-only application login；重放固定 `huayi_runtime`、`huayi_business`、
   `huayi_context_setter` 和 migration roles 的属性与 membership contract。密码由本次运行随机生成并只进入
   target secret channel；不恢复 source/global role 或 owner/ACL；
2. 用 digest-only PostgreSQL 17 runtime 对 custom archive 执行 `pg_restore --list`，严格绑定 TOC SHA-256。
   `--no-owner --no-privileges` 下只恢复 application-owned pre-data；managed Auth/Storage schema、extensions、
   platform functions 和 global objects 一律不恢复；
3. 按 checked-in、完整、拓扑排序的 table-data allowlist 恢复 application data。表、sequence、large object、
   event trigger、foreign server、publication、subscription 或 unknown TOC entry 任一漂移都停止；不拼接用户
   SQL，不把 archive 转成 plaintext SQL；
4. 在 target 已有的 managed Auth/Storage schema compatibility contract 通过后，分别按 fixed order 恢复
   Auth user→identity 相关 rows、Storage bucket→object metadata。不得覆盖 target platform configuration 或
   platform-owned baseline rows；
5. 恢复 application-owned post-data，再以 target-local contract 重建 owner/ACL、FORCE RLS、policy、function
   execute 与 role membership。archive 内 ACL/owner 不是权限权威；
6. 恢复 `supabase_migrations.schema_migrations` 并验证 chain/head 与 source manifest exact；校准所有
   application-owned sequence 到恢复数据的安全下一值，禁止修改 managed sequence；
7. 若 source object count 非零，只在独立 Storage export contract 已批准、manifest digest 已绑定且 target
   bucket policy 已验证时，通过 Storage API 恢复 bytes；数据库 `storage.objects` metadata 不能冒充 bytes；
8. 关闭所有数据库写入，执行第 5 节的 body-free verification。任何失败进入 cleanup，不允许手工修数据后
   沿用原 evidence；修复实现后必须创建新 target、从 target-empty 重新演练。

所有 `pg_restore`/`psql` 都使用参数数组、`shell:false`、fixed container name/label、`--pull never`、bounded
stdout/stderr/time。工具输出不转发；只接受固定 stage marker。timeout、overflow、signal、网络失败或解析失败
都必须等待 child close，清理精确 identity 的 container/temp，再删除 target；未知同名 container 永不删除。

### 4.3 恢复后验证

同一受控进程先把 source archive 恢复到无网络、无端口、tmpfs-only 的 source-inspection scratch，计算
source table-count HMAC digest 并销毁 scratch；再从 Hosted target 的只读 snapshot 计算 target digest。两次
计算使用同一个进程内随机 HMAC key，完成后销毁 key，不进入文件、环境、argv 或日志。evidence 只保存两个
相等的 digest 和 `sourceInspectionScratchDestroyedExact=true`，不保存逐表计数。source-inspection scratch 是
受控 encrypted host 上的一次性恢复步骤，不是 development database，也不对 host/network 暴露。随后验证：

- application schemas、functions、constraints、indexes、triggers、migration chain 与 source commit contract
  exact；
- 全部 tenant table 继续 `ENABLE + FORCE RLS`，owner A 只能读写 A，不能访问 owner B；随机未知 owner 零
  可见，跨 owner 写入被拒绝；测试使用恢复数据中的不透明 ID，只保存布尔结果；
- Auth user/identity 关系、唯一性、confirmed/method projection 与 source digest exact；不执行用户登录、不签发
  JWT、不发送邮件，application role 不能直接读取 Auth；
- Operator/admin projection、邀请终态、无正文 audit 聚合与 source digest exact；不显示 email、UUID、token、
  hash 或正文；
- drill application login 的 session/current user、runtime membership、owner context set/visible/cleared、backend
  reuse、public create denied、private context function denied 与 postgres switch denied 全部 exact；
- Storage metadata digest exact；object bytes 为 source-empty，或独立 object manifest/bytes digest exact；
- global/platform roles、managed Auth/Storage catalog 和 control-plane configuration 与 target-empty baseline 未被
  改写。

命令退出 0、`pg_restore --list`、schema diff、单一表计数或管理员能读到行都不能单独形成通过证据。

## 5. Evidence 结构与生命周期

私有 ignored 根目录固定为 `artifacts/hosted-restore-drills/<drill-id>/`；目录 `0700`，JSON `0600`，regular
file、非 symlink，canonical single-line JSON + newline，以 `.partial`/fsync/atomic rename/directory fsync
写入。文件只能按顺序出现：

```text
source-attestation.json
target-empty-verification.json        # target 创建且 empty proof 通过后出现
restore-verification.json             # 成功恢复证据
failure-verification.json             # 失败路线；只允许下文两种 post-restore 并存例外
target-cleanup-verification.json      # target absence 回读后出现
source-retention-verification.json    # cleanup 后证明 source archive 仍按批准期限保留
source-disposition.json               # retained backup 到期后才出现
```

`source-attestation.json` exact keys：

```text
contract, coverageProfile, coverageReportSha256, drillId, dumpBytes, dumpFile,
dumpFormat, dumpMode, dumpSha256, manifestSha256, migrationHead, retentionDeadline,
retentionPolicyVersion, sourceCandidateCommit, sourceCapturedAt, sourceEnvironment,
sourceProjectIdentityDigest, storageExportManifestSha256, storageObjectBytesMode,
tocAllowlistSha256, toolCandidateCommit
```

`storageObjectBytesMode` 只允许 `source-empty` 或 `separate-encrypted-export`；前者要求
`storageExportManifestSha256=null`，后者要求 64 位 lowercase SHA-256。

`target-empty-verification.json` exact keys：

```text
authRowsEmpty, contract, drillId, outboundIntegrationsAbsent,
platformBaselineExact, postgresMajor, productSchemasAbsent, sourceAttestationSha256,
sourceCandidateCommit, storageRowsEmpty, targetCreatedAt, targetEmptyVerifiedAt,
targetIdentityDigest, targetRegion, toolCandidateCommit
```

`restore-verification.json` exact keys：

```text
adminProjectionExact, applicationRoleAccessExact, authRelationalContractExact,
completedAt, contract, countDigestAlgorithm, crossTenantDenied, drillId,
migrationHeadExact, ownerContextIsolationExact, platformConfigUntouched, platformRolesUntouched,
platformRuntimeExact, productSchemaExact, rlsForcedExact, sourceAttestationSha256,
sourceCandidateCommit, sourceCountDigest, sourceInspectionScratchDestroyedExact,
storageMetadataExact, storageObjectBytesExact, targetCountDigest, targetIdentityDigest,
targetRoleGraphExact, toolCandidateCommit, unknownTenantDenied
```

所有 `*Exact`/`*Denied`/`*Untouched` 必须为 `true`；`countDigestAlgorithm` 固定
`hmac-sha256-v1`，两个 count digest 必须为相同的 64 位 lowercase digest。

`target-cleanup-verification.json` exact keys：

```text
cleanupCompletedAt, contract, drillId, outboundArtifactsAbsent, sourceAttestationSha256,
sourceCandidateCommit, targetAbsenceVerified, targetCredentialsRevoked,
targetDeletionRequested, targetIdentityDigest, temporaryArtifactsRemoved,
toolCandidateCommit
```

`source-retention-verification.json` exact keys：

```text
contract, drillId, retentionDeadline, retentionVerifiedAt, sourceArchiveRetained,
sourceAttestationSha256, sourceCandidateCommit, toolCandidateCommit
```

`sourceArchiveRetained` 必须为 `true`；`retentionVerifiedAt` 必须严格晚于 cleanup、严格早于批准的
`retentionDeadline`。这份 evidence 只证明 archive 仍在批准保留期，不能证明 archive 已删除。

`source-disposition.json` exact keys：

```text
archiveDeletedAt, archiveDeletionVerified, contract, drillId, manifestDeletionVerified,
retentionDeadline, sourceAttestationSha256, sourceCandidateCommit,
storageExportDeletedOrNotApplicable, toolCandidateCommit
```

`failure-verification.json` exact keys：

```text
contract, drillId, failedAt, failedStage, failureClass, sourceAttestationSha256,
sourceCandidateCommit, targetIdentityDigest, toolCandidateCommit
```

`failedStage` 只允许 `target-create|target-empty|role-bootstrap|pre-data|data|auth-data|storage-data|
post-data|acl|verify|target-delete|retention-close`；`failureClass` 只允许
`precondition|contract|tool|timeout|network|cleanup|unexpected`。两个字段用于定位，不包含原始错误。
source verify 是 evidence lifecycle 之前的零写入门；失败时不创建 drill directory，只输出固定失败。仅
`failedStage=target-create` 且 management API 尚未返回 identity 时，failure/cleanup 的
`targetIdentityDigest` 可为 `null`；其他状态都必须为 64 位 lowercase SHA-256。

七种 document 的 `contract` 分别固定为
`huayi-hosted-restore-source-attestation/v1`、`huayi-hosted-restore-target-empty/v1`、
`huayi-hosted-restore-verification/v1`、`huayi-hosted-restore-target-cleanup/v1`、
`huayi-hosted-restore-source-retention/v1`、`huayi-hosted-restore-source-disposition/v1` 与
`huayi-hosted-restore-failure/v1`。verifier 从 exact file set 推导 lifecycle，不信任可手改的 status：

```text
planned -> source-bound -> target-empty -> restored-verified -> target-destroyed
        -> retention-pending -> closed
        \---------------------------------------------> closed  # deadline 已到
        \-> failed-cleanup-pending -> failed-target-destroyed
        -> failed-cleaned-retention-pending -> failed-closed
```

`restore-in-progress` 只存在于进程内；任何遗留 `.partial` 都使 verifier 失败。成功 evidence 只有在 target
验证全部通过后写入。external stage 必须返回 exact success/failure union，单次结果不能同时含 success 与
failure，也不能含 raw error；任一已进入 target 相关 stage 的受控失败必须先原子写只含 fixed stage/class、
target identity digest 和 source/tool/candidate binding 的 `failure-verification.json`，再保持或进入
`failed-cleanup-pending`。source verify 失败仍在 lifecycle 外零写入。
`restore-verification.json` 与 failure 通常互斥；唯一受限例外是已经严格完成 restore 后的
`failedStage=target-delete|retention-close`，且 `failedAt` 必须严格晚于 restore completion、target/source/tool
binding exact。其他 failure stage 与 restore evidence 并存一律失败。
`target-cleanup-verification.json` 只有在管理面确认 project 不存在、临时凭据撤销和本机 partial 清空后写入。
cleanup evidence 单独只进入 `target-destroyed`，失败路线对应 `failed-target-destroyed`。deadline 尚未来时
必须再写严格 `source-retention-verification.json`，才分别进入 `retention-pending` 或
`failed-cleaned-retention-pending`，禁止提前删除；若 cleanup 完成时 deadline 已到，则允许从两个
`target-destroyed` 状态直接执行 `retention-close`，但 disposition 仍必须绑定 cleanup/source/tool/candidate、
删除时间不得早于 deadline 且严格晚于 cleanup。`retention-close` 受控失败仅允许在 cleanup 已证明后记录，
保留 archive 以便安全重试，不能冒充 closed；到期后删除 archive/manifest/object export 并写
`source-disposition.json`，分别进入 `closed` 或 `failed-closed`。失败路线无法证明 target 删除时保持
`failed-cleanup-pending` 并升级为事故，不能写伪 cleanup evidence；`failed-closed` 只表示失败操作和敏感残留
已关闭，永远不算 restore drill 通过。

时间顺序同样是 strict contract：restore completion 严格晚于 target-empty proof；post-restore failure 严格晚于
restore；cleanup 严格晚于 restore 和已存在 failure；retention verification 严格晚于 cleanup；disposition
严格晚于 cleanup、可选 retention verification 和已存在 failure，且不得早于 retention deadline。CLI 在调用
external stage 前用批准 deadline fail closed：deadline 前只能 retention verify，deadline 到达后只能 close。

## 6. Secret、隐私与审计边界

- source 管理员密码和必要的 management token 分别从固定 macOS Keychain account 读取；临时 recovery
  target 管理员密码仍只从专用真实 TTY 隐藏读取。启动前拒绝继承对应 secret env。数据库密码只进入固定
  `0600` temporary `.pgpass` 和 read-only mount，CA 进入独立 `0600` file；management token 不进入 child
  environment，获批 production management adapter 必须只把它交给受控 HTTP port，且不进入 argv、
  environment、文件、stdout/stderr 或日志；
- target drill login 使用每次随机 32+ 字符密码，验证结束立即 revoke；source application password、JWT、
  anon/service-role、SMTP/OAuth/Provider secret 永不复制；
- archive 只从受验证的 encrypted location read-only mount，不能产生 plaintext SQL、解压目录、row sample、
  CSV 或 debug dump。evidence 不含 project ref、email、UUID、对象 key、表计数、正文、token/hash、SQL、错误
  文本或 secret；
- CLI 只输出固定 `stage passed`、`stage failed`、`cleanup passed`；审计只保存 drill ID、UTC、candidate commit、
  evidence SHA-256、allowlisted stage/outcome 和批准人引用；
- recovery project 的访问只授予本次 Operator，禁止团队共享、Dashboard SQL 手工浏览和导出。任何无关访问、
  出站投递或 project 删除失败都按安全事故处理；
- body-free evidence 的保留位置、期限和访问人必须在首次真实演练前由用户决定。它不是可公开 release
  artifact，也不能替代隐私政策中的生产 backup residual 期限。

## 7. TDD、自动测试与真实集成门

### 7.1 Fresh RED -> GREEN 顺序

1. **RED A：contract/lifecycle**：缺 module 时以 `ERR_MODULE_NOT_FOUND` 失败；加入伪 module 后，用 extra/missing
   key、错误 lifecycle、旧 commit/head、hash/mode/coverage 漂移、`.partial` 与 success/failure evidence
   并存证明 verifier 失败；
2. **GREEN A**：只实现零 I/O plan、strict JSON schema、state derivation 和 fixed messages；
3. **RED B：restore plan**：fixture TOC 含 unknown/global/platform/ACL/owner entry、target 非空、PG major/
   region/platform baseline 漂移、Auth/Storage compatibility 漂移时必须失败；
4. **GREEN B**：实现 exact TOC allowlist、section/order、target-empty 和 target-local role/ACL plan；仍不连接
   Hosted；
5. **RED C：secret/process/cleanup**：密码进入 argv/env/log、stdout overflow、timeout 未等 close、unknown
   container/project identity 被删除、restore 失败后 partial/target 遗留时必须失败；
6. **GREEN C**：实现 TTY、private temp、bounded process、identity-safe cleanup 与 failure evidence；
7. **RED D：data/security**：虚构双租户 archive 中删一张表、改一项 count、关闭 FORCE RLS、增加跨租户
   可见、application role 直读 Auth、admin projection 泄露正文或缺 Storage bytes 时失败；
8. **GREEN D**：在 fixed networkless PG17 target 完成全 fixture restore/verify/destroy；
9. **Hosted integration**：当前 acceptance batch 关闭并取得独立批准后，才创建 ephemeral Supabase project；
   target-empty、restore、body-free verify、delete、absence 回读全部通过后，才能记录第一轮真实结果。

### 7.2 默认单元与集成测试

默认测试必须离线、secret-free，只使用 fake process、fictional archive/TOC 和固定 networkless PostgreSQL 17：

- exact arguments、confirmation、source/target binding、canonical JSON、mode/symlink/extra-file、atomic ordering；
- all lifecycle positive/negative transitions、success/failure mutual exclusion、retention deadline 与 deletion proof；
- full TOC allowlist、pre-data/data/Auth/Storage/post-data/ACL/sequence order，拒绝 globals/platform config；
- source-inspection scratch 与 Hosted target 的 count HMAC equality、不保存 key/count、scratch 销毁，以及
  schema/RLS/role/auth/admin/application access booleans；
- owner A/B/unknown tenant isolation，application direct Auth/public create/context setter/postgres switch deny；
- Storage zero 与 separate-export 两分支，metadata 不能冒充 bytes；
- signal/timeout/overflow/network/tool/contract 每阶段失败清理，unknown identity 永不删除；
- argv/env/file/stdout/stderr/log secret scan 与 fixed safe error snapshot；
- macOS fixed OrbStack/FileVault path；Windows 门只验证共享 contract，不宣称 operator execution。

真实 Supabase 测试不进入 `pnpm test`、`verify:macos`、`verify:windows` 或 CI；必须由 exact confirmation 和独立
批准触发，不发送邮件、不运行 Provider、不部署应用。

## 8. 验收矩阵

| 门                | 必须证据                                                            | 失败条件                                               |
| ----------------- | ------------------------------------------------------------------- | ------------------------------------------------------ |
| Source identity   | archive/manifest/TOC/coverage/commit/head/hash/mode exact           | 任一漂移、文件变化或 retention 未决                    |
| Target isolation  | 新建时间、identity digest、同区同 PG major、outbound absent         | 既有/被清空项目、控制面连接或 public key 分发          |
| Target empty      | platform baseline exact，Auth/Storage/product rows absent           | 任一用户/对象/产品结构或额外 baseline                  |
| Restore structure | product schema/migration/runtime exact，globals/platform untouched  | unknown TOC、owner/ACL/global restore 或 managed drift |
| Data completeness | source/target count HMAC digest equal                               | raw count、逐行输出或 digest 不同                      |
| Tenant security   | FORCE RLS、A/B/unknown isolation 全真                               | 任一跨租户读写或 owner context 漂移                    |
| Auth/admin        | relational/method/admin projection exact，零 JWT/邮件               | application 直读 Auth、正文/身份输出或出站副作用       |
| Application role  | role graph、backend context、deny matrix exact                      | public create、context/postgres 越权或错误 role edge   |
| Storage           | metadata exact；bytes zero 或 separate export exact                 | 只恢复 metadata 却声明完整，或 object export 未批准    |
| Cleanup           | target deleted/absent、credential revoked、partial/container absent | project/secret/temp 残留或未知 identity 被删除         |
| Retention close   | deadline 后 archive/manifest/object export 删除证据                 | 猜测期限、提前删除或到期仍残留                         |
| Platform          | macOS actual host + macOS/Windows shared gates                      | 用 shared fake 代替 macOS operator/Hosted 证据         |

全部门通过且 lifecycle 为 `closed` 才能声明一次 production restore drill 完成。`restored-verified` 但 target
未删、或 `target-destroyed` 但 retention 未关闭，都是未完成。

## 9. 运营节奏、失败处理与用户待决项

- 首次 production cutover 前完成一次真实 drill；之后每季度、PostgreSQL major/backup format/role graph/
  Auth-Storage schema 或恢复工具重大变更后额外运行；
- 真实运行前冻结 source backup，暂停对该 artifact 的删除任务；演练不暂停 production 写入，因为它只读
  已关闭 archive；
- 任一失败先 cleanup。target 删除失败、凭据无法 revoke、archive 泄露或出现出站调用时升级为事故；修复后
  使用新 target/drill ID 从头开始；
- quarterly audit 只比较 body-free evidence contract/version、完成 UTC、commit/head、stage outcome 与
  cleanup/retention state，不查看 archive 或用户数据。

以下是**用户/运营待决项**，本方案不猜测；它们不阻塞当前 Phase 81，但会阻塞首次真实 restore drill：

1. 离线控制面实现已获准；在 fictional full restore 与完整门通过后，再明确批准创建/删除 recovery project；
2. 确认 Supabase 组织的临时 project quota/费用、与最终 production source 同区创建能力和本次 Operator；若
   production source 最终不是 Singapore，不得沿用当前 acceptance 的 Singapore 结论；
3. 确认 production backup retention、Supabase 残留期限、私有 body-free evidence 保留期限/位置和隐私披露；
4. 若 production Storage object 非零，单独批准 Storage API encrypted export/restore 与相同 retention/删除门；
5. 选择首次演练的 production source archive 和维护窗口；archive 或 token 不在聊天中传递。

## 10. 实施阶段完成定义

当前实现已交付需求/技术方案同步、Fresh RED/GREEN、strict verifier、TOC/order、process/secret/cleanup、
body-free verification 控制面与 fixed networkless PG17 fictional full restore。fictional runner 使用两名虚构
tenant、Auth user/identity、Storage metadata、migration head、trigger/admin projection、FORCE RLS/application
deny matrix 和进程内临时 HMAC count digest；custom archive 只进入 `0600` 临时文件，任一失败也必须按精确
identity 删除 source/target 并清空临时目录。它会主动丢弃/重建 disposable fixture 的 Auth/Storage schema，
因此不验证 Supabase managed platform baseline、控制面设置或 Storage object bytes。

仍须交付获批 production source/target adapter、macOS 完整门、Windows shared gate和真实 Hosted 操作；
production restore drill 发布项保持未关闭，也不改变 Phase 81/0014 当前状态。
