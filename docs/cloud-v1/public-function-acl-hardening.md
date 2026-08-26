# Phase 91 Hosted public 函数 ACL 收敛方案

状态：0014 已确认完整应用并禁止重跑；0015 已在 Hosted 按唯一 migration 完成 exact dry-run、apply 与
`applied-exact` postflight。Phase 91 的 pre、15-chain isolated rebuild 与 post evidence 均在历史候选
`78bfd05` 上存在且有效；API/Web 严格串行 one-shot 也已完成并恢复双关闭。仓库随后推进到 `2d03bd8`，该
exact SHA 的 macOS/Windows Cross-platform quality 均通过。当前唯一 Phase 91 关闭缺口是没有观察或持久化
`acceptance:hosted:phase91:backup:complete` 的历史成功回执；现有 evidence 因 HEAD 推进而
`current=false`，不得覆盖、重捕或把 capture 成功冒充 completion 成功。受影响平台为 `shared`
（PostgreSQL migration、Hosted 控制面与文档），不改变 macOS / Windows OS integration。

## 1. 背景与已确认事实

0014 apply 没有返回 verified completion。固定只读三态回查和扩展 ACL 诊断随后在 Singapore 管理员
transaction pooler `6543` 上得到以下确定事实：

- canonical migration chain 已精确包含 14 条，0014 的 `bound_email` column/check、
  `bind_auth_identity(text,uuid)` 和
  `renew_interrupted_password_confirmation(text,text,timestamptz)` 均已应用；
- 两个函数的 owner 与 `huayi_context_setter` direct `EXECUTE` 正确，`huayi_business`、
  `huayi_runtime` effective `EXECUTE` 均被拒绝，`PUBLIC` direct grant 不存在；
- `anon`、`authenticated`、`service_role` 对两个函数都存在 direct `EXECUTE`；全部 `public`
  `SECURITY DEFINER` 函数的 Data API role 安全谓词同样失败；
- Hosted Data API 目前保持关闭，所以当前没有证据表明这些函数已经从公网 Data API 可达；关闭状态只能降低
  即时暴露面，不能替代数据库最小权限；
- 0014 是已应用状态，任何再次 apply、回滚或改写 0014 都会破坏 forward-only migration 账本。

### 1.1 2026-08-26 Hosted 执行证据校准

- 固定只读 status 在写入前返回 `pending-exact`；
- pre backup、15-chain isolated rebuild 与 scratch 销毁均成功，随后 exact dry-run 只列出
  `20260825010000_public_function_acl_hardening.sql` 且数据库未修改；
- 受控 apply 只应用上述 migration，并以 `applied-exact` postflight 完成；post backup 随后成功捕获；
- 三份 evidence 均绑定历史候选 `78bfd05`：pre head 为 `20260824010000`，rebuild/post head 为
  `20260825010000`。当前只读 status 为 present/valid=true、current=false，这是后续候选推进的预期历史
  状态，不授权重新捕获；
- 未找到 completion verifier 的固定成功输出或独立 receipt。因此本页不把 Phase 91 写成完全关闭；后续只
  允许先审查能否从不可变 manifest 得到等价历史 closure 证据，不能为了追求 current=true 改写恢复点。

根因是 Supabase 项目给 `public` schema 新函数追加的 API role 默认 `EXECUTE` 与 PostgreSQL 函数默认
`PUBLIC EXECUTE` 叠加。Supabase 的
[Database Functions](https://supabase.com/docs/guides/database/functions#function-privileges) 文档要求同时收敛
既有函数和后续默认权限；PostgreSQL 的
[ALTER DEFAULT PRIVILEGES](https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html) 进一步明确：
per-schema default privilege 只能在 global default 上追加，不能用
`IN SCHEMA public ... REVOKE ... FROM PUBLIC` 抵消函数的 global `PUBLIC EXECUTE`。因此 PUBLIC 的默认权限
必须在 global scope 撤销，Data API roles 的 Supabase per-schema grant 还必须在 `public` scope 单独撤销。

## 2. 目标与非目标

### 2.1 目标

1. 以唯一 forward-only API migration `0015-public-function-acl-hardening.sql` 和 byte-identical Supabase
   mirror `20260825010000_public_function_acl_hardening.sql` 收敛权限；
2. 从全部现有 `public` 函数撤销 `PUBLIC`、`anon`、`authenticated`、`service_role` 的 `EXECUTE`；
3. 收敛 `postgres` 创建后续函数的 global `PUBLIC` / API-role 默认权限，并移除 Supabase 在 `public`
   schema 上追加的 API-role 默认权限；
4. 保留 owner、`huayi_context_setter`、`huayi_business` 等所有未列入撤销集合的现有 direct grant；尤其保留
   0014 两个函数的 owner + context-setter 精确授权；
5. 以独立的 pre-0015 backup、15-migration isolated rebuild、exact dry-run、apply postflight 和 post-0015
   backup 关闭本次安全修复批次。

### 2.2 非目标

- 不重跑、改写或删除 0014，不删除用户、邀请、Auth identity、session 或学习数据；
- 不启用或修改 Supabase Data API、Site URL、Redirect URL、Custom SMTP、OTP、RLS、schema `USAGE`、
  table ACL、数据库角色 membership 或密码；
- 不把任何函数重新授予 Data API roles；未来确需 RPC 时必须按函数逐项另行设计和授权；
- 不发送邮件、不部署 API/Web、不 arm Vercel、不运行 DeepSeek smoke，不修改 DNS、environment 或密钥；
- 不把 PGlite 对 PostgreSQL catalog 的近似当成 Hosted 完成证据。

## 3. 数据库权限契约

0015 只允许以下事务性 SQL；两份 migration 必须 byte-identical：

```sql
BEGIN;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public
FROM PUBLIC, anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres
REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated, service_role;

COMMIT;
```

三条语句缺一不可：

- 第一条修复现有函数；只列明四个外部角色，不触碰 Huayi direct grants；
- 第二条在 global scope 去掉 PostgreSQL 隐式 `PUBLIC EXECUTE`，并同时消除可能存在的 global API-role
  default grant；这是防止未来函数重新公共可执行的关键；
- 第三条撤销 Supabase 在 `public` scope 追加的 API-role default grant。只执行第二条不能抵消 per-schema
  grant，只执行第三条不能抵消 global PUBLIC default。

迁移不创建业务表、column、constraint、trigger 或 callable function。唯一持久变化是 migration ledger、现有
`public` function ACL 与 owner=`postgres` 的 function default ACL。所有后续需要调用的函数必须由 migration
显式 `GRANT EXECUTE` 给最窄 Huayi role。

## 4. 状态机与失败关闭

0015 使用独立三态只读状态入口，不复用 0014 apply：

- `pending-exact`：canonical 14-chain 精确，0014 objects 精确，已确认的 API-role ACL 漂移仍存在，0015
  version 不存在；
- `applied-exact`：canonical 15-chain 精确；所有现有 `public` 函数对四个外部角色均无 effective/direct
  `EXECUTE`；global default ACL 不含 PUBLIC/API roles，`public` per-schema default ACL 不含 API roles；
  0014 两个函数仍为 owner + context-setter exact direct grant，business/runtime effective denied；
- `uncertain`：连接、进程、输出、chain、角色、现有函数 ACL、default ACL 或 0014 preservation 任一不精确。

`uncertain` 绝不授权 apply 重试。状态和诊断只能输出 allowlisted `name|t/f`、固定 exit class 与三态，不得
输出函数名清单、raw ACL、OID、未知角色、数据库 stderr、URL、密码或环境变量。

## 5. 备份与执行顺序

既有 `phase-81-0014` pre backup 是 0014 前的不可变恢复点，必须保留；0014 已写入后不能重新捕获并冒充
pre-0014，也不能为了让旧 completion 通过而改写它。旧批次保持“0014 applied、post completion 被 ACL
漂移中断”的真实历史状态。

0015 使用新批次 `phase-91-0015-public-function-acl-hardening`：

固定命令面已经独立于 Phase 81：

- 零 I/O 计划与本地证据回读：`acceptance:hosted:phase91:backup:plan`、
  `acceptance:hosted:phase91:backup:executor:plan`、`acceptance:hosted:phase91:backup:status`；
- 本地只读就绪检查：`acceptance:hosted:phase91:backup:executor:pre:readiness`、
  `acceptance:hosted:phase91:backup:executor:rebuild:readiness`、
  `acceptance:hosted:phase91:backup:executor:post:readiness`；
- 单独批准的证据写入：`acceptance:hosted:phase91:backup:capture:pre`、
  `acceptance:hosted:phase91:backup:rebuild`、`acceptance:hosted:phase91:backup:capture:post`；
- 证据门：`acceptance:hosted:phase91:backup:preflight` 与
  `acceptance:hosted:phase91:backup:complete`；
- Hosted 数据库入口：`acceptance:hosted:migration:0015:status`、
  `acceptance:hosted:migration:0015:dry-run`、`acceptance:hosted:migration:0015:apply`。

上述入口均固定 project/batch/head/operation，拒绝动态 URL/path/project 与继承密码。真实 capture、Hosted
status/dry-run/apply/post 必须等待 clean candidate、双平台 CI 和对应独立批准；本地完整门通过不授权任何
外部动作。

1. docs-first 方案和交叉文档审查完成；
2. 离线 Fresh RED → GREEN，完整本机质量门通过，clean candidate 提交推送并由双平台 CI 验证；
3. 固定只读 status 必须返回 `pending-exact`；
4. 独立 capture pre，要求 migration head 精确为 `20260824010000`，Storage objects 继续为零；
5. 从空 scratch 应用完整 15 条 repository migration + fictional seed，验证默认 ACL 和运行时契约，销毁
   scratch 后再写 rebuild evidence；
6. pre/rebuild 证据必须同时 present、valid、current，随后 preflight 通过；
7. 用户另行明确批准后运行唯一 0015 dry-run，只接受精确列出
   `20260825010000_public_function_acl_hardening.sql`；dry-run 不修改数据库；
8. 用户再次明确批准后运行唯一 apply；同一入口重跑 exact dry-run、紧邻 mutation 重查 clean source / backup
   evidence / migration mirror hash，并使用同一隐藏 TTY secrets 回读状态且只接受 `pending-exact`；`applied-exact`、
   `uncertain`、连接失败或不精确输出全部零 mutation，写后只读 postflight 必须返回 `applied-exact`；
9. 独立 capture post，要求 head 精确为 `20260825010000`，随后 completion 通过；
10. Phase 91 post backup 作为 0014→0015 修复后的最终安全 post-state；发布证据同时保留 Phase 81 pre 和
    Phase 91 pre/post，不伪造 Phase 81 原 completion；
11. 只有完整批次关闭后，才能继续 API→Web 串行 one-shot deploy 和六位 OTP journey。

任何 raw backup 都是敏感资料，继续遵守 `hosted-important-batch-backup.md` 的 `0700/0600`、clone-local
ignore、fixed CA、verify-full、无 stdout/stderr 泄露、Storage object bytes 条件阻塞与不可覆盖规则。

## 6. TDD 与验证矩阵

### 6.1 migration 行为

- Fresh RED：当前 migration chain 缺 0015，API/Supabase mirror 缺失；
- Supabase-default fixture 在 baseline/0014 后证明全部现有 public SECURITY DEFINER 函数对三个 API roles
  可执行，精确复现 Hosted 症状；
- 应用 0015 后，全部现有 public 函数对 PUBLIC/API roles 均不可执行；
- owner 与既有 Huayi direct grants 保留，0014 bind/renew 的 context-setter 可执行、business/runtime
  不可执行；
- migration 后创建 fictional probe function，证明 PUBLIC/三个 API roles 默认不可执行而 owner 可执行；
- 查询 `pg_default_acl`，证明 global PUBLIC/API-role 和 public per-schema API-role grant 均不存在；
- 完整 0001→0015 chain 可从空 PGlite 应用，两份 0015 文件 byte-identical；
- local doctor、Hosted foundation canonical versions、isolated rebuild 和所有 migration-head 断言更新到 15。

### 6.2 Hosted 控制面

- status/dry-run/apply/backup 均须有 fixed confirmation、拒绝额外参数和 inherited secrets；
- 统一使用固定 Singapore project 与 official CA；status/postflight 使用管理员 transaction pooler `6543`
  verify-full + `BEGIN READ ONLY`，raw capture 继续使用 session pooler `5432`；
- dry-run parser 只接受唯一 0015、固定 allowlisted transcript multiset 和通道内相对顺序；
- apply 在 secret read 前和 mutation 紧前两次验证 evidence/source/mirror，postflight 只读；任何非零、timeout、
  signal、overflow、额外 migration 或输出漂移失败关闭；
- applied/pending/uncertain、Supabase default drift、缺 role、额外 ACL、default ACL 回归、0014 Huayi grant
  回归均由 PGlite/fake process 覆盖；默认测试不连接 Hosted；
- Phase 91 evidence 与 Phase 81 evidence 目录、batch id、head、manifest 不能混用或覆盖。

### 6.3 完整门与平台结论

至少运行 focused migration/control-plane tests、`pnpm check:instructions`、`pnpm format:check`、
`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm test:e2e`、`pnpm build` 和 `pnpm verify:macos`。shared
候选还必须等待 macOS/Windows CI 都通过；离线 PGlite 不能替代 Hosted PostgreSQL catalog 回读，CI 不能替代
另行批准的 backup/dry-run/apply。

## 7. 验收标准

只有以下全部满足才可关闭 Phase 91：

- 文档、0015 两份 migration、版本链、local doctor、backup/rebuild、status/dry-run/apply 契约一致；
- complete quality gate 与双平台 CI 通过，候选 clean 且可追溯；
- Phase 91 pre/rebuild/preflight、exact dry-run、apply postflight、post/completion 均有固定证据；
- Hosted status 为 `applied-exact`，完整 15-chain、现有函数 ACL、default ACL 和 0014 Huayi grants 全部精确；
- Hosted Data API、Supabase Auth/SMTP、DNS、Vercel、environment、密钥和用户数据均未被本阶段改变；
- release evidence 明确保留 0014 的真实未验证返回、后续只读确证、0015 修复与两个恢复点，不把任何
  dry-run、PGlite 或 CI 结果描述为 Hosted apply。
