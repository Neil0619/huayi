# Hosted DeepSeek 0016–0021 migration batch

状态：离线控制面已实现，真实 Hosted migration 未执行。受影响平台为 `shared + macOS operator tooling`；
Windows 只运行 secret-free contract/CI，本阶段不新增 Windows OS integration。0016–0021 控制面已冻结在
`703bd05482c32249b99d46afad474c59eca2fa13`，Cross-platform quality run `33082883156` 的
macOS/Windows job 均成功；dry-run notifier 修复 `4c20d4582ba7601cf4f9a42e936fdfb72492e894`
也由 run `33091862839` 双平台关闭。随后 immutable retirement 控制面提交
`691730c9080b8be0b206c86b666a1498b8342cf7` 的 run `33096064279` 为 macOS success、Windows failure；
失败只落在测试夹具未规范化 Windows 权限位；修复已纳入本次候选并通过完整 macOS 门，replacement exact-SHA
CI 尚未运行。真实 retirement、migration apply、post capture/completion 与 Phase G private loader 均未执行或授权。

## 1. 为什么必须先做本批次

Phase 91 的 `phase-91-0015-public-function-acl-hardening` 是不可变历史批次，只证明 15-file repository、
pre head `20260824010000` 和 rebuild/post head `20260825010000`。当前 repository 已有 21 条 migration；
扩写 Phase 91 contract、覆盖其 evidence、重新捕获旧 pre，或把历史 completion 当作 0016–0021 连续性证据
都会伪造恢复点。

Phase G private loader 会读取真实受控凭据并构造 production ports。它不能先于数据库 authority 的新恢复点、
exact dry-run/apply 和 applied postflight；否则 loader 即使失败关闭，也会把未部署 schema 当成可运行前置。
因此顺序固定为：

1. 本文件与离线控制面；
2. clean commit/push 与该 exact SHA 的 macOS/Windows CI；
3. 经逐项批准的新 pre backup、21-chain isolated rebuild 和 preflight；
4. 经独立批准的 Hosted status、exact dry-run、apply、postflight、post backup 和 completion；
5. 其他 Auth/R3-C/Cron/预算前置关闭后，才单独设计和批准 Phase G。

## 2. 固定身份

- project：`kpadiulxkgckskcfydry`；
- batch ID：`hosted-deepseek-0016-0021`；
- clone-local evidence：
  `artifacts/hosted-important-batch-backups/hosted-deepseek-0016-0021`；
- pre migration head：`20260825010000`；
- rebuild/post migration head：`20260827060000`；
- rebuild source：完整 21-file Supabase migration set + SHA-256 pinned fictional seed；
- scratch identity：`huayi-deepseek-0016-0021-rebuild` / `deepseek-0016-0021-rebuild`；
- capture identity prefix：`deepseek-0016-0021`。

本批次只允许以下六个 forward migration，API 与 Supabase mirror 必须逐字节相同并匹配固定 SHA-256：

1. `20260827010000_hosted_deepseek_acceptance_authority.sql`；
2. `20260827020000_hosted_deepseek_acceptance_retention_scrub.sql`；
3. `20260827030000_hosted_deepseek_acceptance_status.sql`；
4. `20260827040000_hosted_deepseek_acceptance_effective_fuse.sql`；
5. `20260827050000_hosted_deepseek_acceptance_authority_mutations.sql`；
6. `20260827060000_hosted_deepseek_acceptance_evidence.sql`。

不允许动态 project、URL、path、migration subset、head、batch ID 或 container identity。0016–0021 作为一个
事务序列由 Supabase CLI 按 repository 顺序执行；不允许手工调用 SQL function、补 migration ledger、跳过
中间 migration，或在不确定状态重试 apply。

## 3. 零 I/O 计划与本地状态面

以下两个 plan 只渲染固定合同，不读取 filesystem、Git、Docker、TTY、secret 或网络：

```text
pnpm acceptance:hosted:deepseek:migration:backup:plan
pnpm acceptance:hosted:deepseek:migration:backup:executor:plan
```

ignored evidence 的只读回读为：

```text
pnpm acceptance:hosted:deepseek:migration:backup:status
```

它只输出 pre/rebuild/post 的 `present|valid|current` 九个布尔值。`current=true` 还要求 manifest candidate
等于 clean pushed HEAD；不得输出 path、commit、hash、timestamp、project、batch、secret 或 raw error。

候选推进后，如果 active batch 恰好只含 strict valid、同一 stale candidate 的 `pre + rebuild`，不得删除、
覆盖或分别搬运。唯一专用出口是下列 exact-confirmation 入口；它是本地敏感 evidence mutation，仍需独立
批准，且本轮只实现、未执行：

```text
pnpm acceptance:hosted:deepseek:migration:backup:retire
```

入口不读取 Hosted、TTY、密码、密钥、Docker 或 migration status。它先要求 clean `HEAD==upstream`、active
与 history 两个窄 root 均 ignored，严格重验 active batch 只有 `pre/rebuild`、全部 `0700/0600`、两份
manifest 绑定同一 stale 40 字符 commit，并用 Git 证明该 commit 存在且为当前 HEAD 的 ancestor；current、
mixed、malformed、post-present、unknown entry、symlink、不安全权限、dirty/unpushed、non-ancestor 或历史
destination 已占用均在 rename 前失败关闭。

历史固定层级为
`artifacts/hosted-important-batch-backup-history/hosted-deepseek-0016-0021/<stale>/evidence`。工具先以
`0700` candidate reservation 防覆盖，再把**整个 active batch** 一次原子 rename 为 `evidence`，对创建与
rename 两侧目录执行 `fsync`，最后从 history 再次严格验证完整 `pre + rebuild`。成功后 active batch 缺席，
现有不可覆盖 writer 可为当前 candidate 重新建立安全批次；现有 preflight 的 current-candidate 要求完全不变。
rename/fsync/post-move validation 失败时不删除 dump：完整单元至少保留在 active 或 history 一侧，固定
body-free 失败和保留位置可供后续只读审计；history 删除仍无入口。

## 4. 恢复证据顺序

所有 readiness 与写入入口都要求 clean `HEAD==upstream`、batch path 被 clone-local ignore、固定 Docker
target/runtime/platform lock/local images、pinned Supabase CLI 和 FileVault。readiness 不读取 Hosted secret，
不写 evidence：

```text
pnpm acceptance:hosted:deepseek:migration:backup:executor:pre:readiness
pnpm acceptance:hosted:deepseek:migration:backup:executor:rebuild:readiness
pnpm acceptance:hosted:deepseek:migration:backup:executor:post:readiness
```

真实动作必须逐项重新取得明确批准：

```text
pnpm acceptance:hosted:deepseek:migration:backup:capture:pre
pnpm acceptance:hosted:deepseek:migration:backup:rebuild
pnpm acceptance:hosted:deepseek:migration:backup:preflight
```

- pre capture 经 official CA、隐藏 TTY password 和 verify-full session pooler `5432` 读取 Hosted，并只接受
  head `20260825010000`、`storage.objects=0`；raw custom dump 与 manifest 均为 `0600`，目录为 `0700`；
- rebuild 只在本地 digest-only、`--pull never`、networkless、tmpfs scratch 中执行完整 21-chain 与 fictional
  seed；它不读取 Hosted password，不导入 Hosted 数据。Auth/Storage/runtime/absence contract 全部通过、所有
  scratch/runner 已精确销毁后，才允许写 manifest；
- preflight 只在 pre 与 rebuild 均 present/valid/current 且 source identity 仍精确时通过；post leaf 若已
  存在也必须严格有效，不能用未知或 stale evidence 混入。

真实 capture/rebuild readiness 固定在 FileVault 已开启且使用受控 OrbStack Unix socket 的 macOS operator；
Windows CI 只验证 fake filesystem/process 与 portable evidence contract，不能替代该 macOS 就绪度。

任一 evidence leaf 不可覆盖、手改、重捕或在失败后静默清理成“未发生”。未知同名 container 不删除；失败
只输出固定或 allowlisted stage，不反射 child output、路径、digest、凭据或环境。

## 5. migration 三态与受控写入

真实只读 status 需要独立批准，因为它会获取 official CA、从 TTY 无回显读取管理员密码并连接 Hosted：

```text
pnpm acceptance:hosted:deepseek:migration:status
```

它只允许三个结果：

- `pending-exact`：migration ledger 精确为 15-chain，专用 executor role、两张 authority table 与所有本批次
  private function 均不存在；
- `applied-exact`：ledger 精确为 21-chain；专用 role 非登录/非继承/非特权，且没有任何可继承、可切换或
  额外 membership。唯一允许的可选成员边是 PostgreSQL 17 为非 superuser CREATEROLE creator 建立的
  `postgres`→executor creator-control，存在时必须唯一且精确为
  `admin=true / inherit=false / set=false`；schema/table/function owner、两张 forced-RLS table、三个启用的
  guard trigger、0021 `receipt_evidence`/constraint、全部 private function 的 `SECURITY DEFINER`/固定
  search path、executor allowlist 与任意额外 function/table ACL 均精确；
- `uncertain`：其他任何结构、ACL、chain、连接、进程或输出状态。

`uncertain` 固定失败，绝不授权 apply、重试或 post capture。只有另行批准的脱敏只读诊断可以继续：

```text
pnpm acceptance:hosted:deepseek:migration:status:diagnose
```

该入口沿用 official CA、隐藏 TTY、transaction pooler `6543`、verify-full、`connect_timeout=10`、30 秒上限
和单一 `BEGIN READ ONLY` catalog snapshot。公开输出只能包含 allowlisted psql exit class、output exact、
0015–0021 各 migration prefix、role attributes、membership absence/contract、schema/table/RLS/receipt/trigger、
17 个固定 private function contract 与 executor/unexpected ACL、aggregate external ACL/state 的 `t/f` 以及
final status；不得输出数据库 stderr、raw SQL、OID、未知角色、密码、URL 或环境内容。诊断只定位恢复边界，
不授权任何 Hosted 写入。

dry-run 另行批准，先重验 current pre/rebuild evidence 与本机
Supabase CLI `2.115.0`，通过后才读取 CA/password；其 transcript 只接受 CLI 精确列出上述六个文件，每个
channel 内顺序和 allowlisted line multiset 都必须一致：

```text
pnpm acceptance:hosted:deepseek:migration:dry-run
```

apply 需要再次独立批准：

```text
pnpm acceptance:hosted:deepseek:migration:apply
```

单一 apply 入口内部固定执行：preflight → CA/hidden password → exact dry-run → 紧邻 mutation 的第二次
preflight → read-only `pending-exact` → `db push --yes` → read-only `applied-exact` postflight。任一非零、
timeout、signal、output overflow、source/hash 漂移、stale evidence、applied/uncertain status 或畸形输出均在
mutation 前失败；mutation 已发出但 completion 未验证时，只能重新运行只读 status，禁止盲重试。

成功 postflight 后仍须另行批准并执行：

```text
pnpm acceptance:hosted:deepseek:migration:backup:capture:post
pnpm acceptance:hosted:deepseek:migration:backup:complete
```

post 只接受 head `20260827060000`；completion 要求同一 current candidate 的 pre/rebuild/post 全部严格有效。

## 6. 安全与测试合同

- 默认测试只使用 fake process/filesystem 与 PGlite，不连接 Hosted、Supabase、Vercel 或模型；
- PGlite 必须真实证明 exact 15-chain 为 pending、完整 0016–0021 后为 applied，任一外部表权限漂移为
  uncertain；
- dry-run parser 必须拒绝缺文件、额外文件、每个 channel 内换序、CR 和额外输出；
- apply 必须证明参数或 inherited password 在任何外部工作前失败，preflight/dry-run/status 任一不精确时
  mutation 调用数为零；
- artifact contract 必须证明 Phase 91 始终保持 15-file/head 0015，并拒绝当前 21-file repository；新 batch
  不能读取或接受 Phase 91 evidence；
- shared 候选必须通过 macOS/Windows exact-SHA CI；fake OS/runtime tests 不替代实际 target-platform 门，
  CI 也不替代真实 backup/status/dry-run/apply 的逐项批准。

本批次不装配 Phase G private loader，不读取 Operator/Web/Vercel/HMAC keyring 凭据，不登录 Web，不部署，
不切换 kill switch，不调用 DeepSeek，也不产生费用。离线控制面完成只能标记
`implemented; Hosted migration validation pending`。
