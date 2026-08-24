# Hosted 重要批次备份与可重建证据契约

## 1. 目的与当前边界

Supabase Free 不提供可依赖的自动备份。Hosted 验收环境虽然不是正式 production，仍已包含真实 Auth
identity、邀请与用户学习数据；任何 forward-only migration 或重要部署批次前后都必须留下可恢复证据，不能
把“migration dry-run 通过”当成备份。

Phase 82 只交付默认离线、失败关闭的计划与证据验证模块：

- 固定 Supabase project `kpadiulxkgckskcfydry` 和当前批次 `phase-81-0014`；
- `pnpm acceptance:hosted:backup:plan` 只渲染固定计划，零文件、Git、网络和写入；
- `pnpm acceptance:hosted:backup:preflight` 只读取本机固定证据目录，验证 0014 前备份和候选空库重建；
- `pnpm acceptance:hosted:backup:complete` 再要求 0014 后备份，关闭整个重要批次；
- 本阶段没有 capture、restore、Supabase connection 或 migration apply 命令，也没有执行真实 dump。

真实 capture/restore 必须在用户再次明确批准后单独实现和执行。离线 GREEN 只证明控制面、证据格式与
失败关闭，不证明数据库已经备份、恢复或重建。

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

真实逻辑 dump 是**原始敏感备份**，可能包含 Auth、Storage、邀请和业务记录。它不是“脱敏”“匿名化”或
可分享的发布证据，不得复制到 Git、聊天、工单、测试 fixture、日志或 stdout。未来受控 capture 必须：

1. 只使用固定 project 的 verify-full 管理员连接；凭证只存在于子进程环境，CA 只存在于 `0600` 临时文件；
2. 以参数数组和 `shell:false` 调用 PostgreSQL custom-format dump，并用显式 `--file` 写入固定目录；
3. 运行前确认目标文件系统的静态加密/访问控制；不能证明时停止，改用经验证的安全临时介质；
4. 不转发工具 stdout/stderr，不记录 row、identity、正文、token、secret 或原始数据库错误；
5. 无论成功或失败都清理 CA、凭证代理、partial 和临时文件；成功后只保留 dump 与严格 manifest。

本阶段没有实现该写路径，因而不会用一个看似安全但不可真实恢复的伪匿名 dump 代替备份。

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
工具必须从空 scratch 开始，执行完整 migration/seed/聚合验证，确认没有 Hosted 数据，并在删除 scratch
后才原子写 manifest。证据不保存表计数、账号、邮箱、ID、正文或 dump 内容。

## 5. Phase 81 动作依赖

0014 的顺序现固定为：

1. 运行零网络 `acceptance:hosted:backup:plan`；
2. 在单独批准的真实阶段完成 pre raw logical dump 和 migrations+fictional-seed scratch rebuild；
3. `acceptance:hosted:backup:preflight` 必须通过；
4. 才能把“用户已批准实际应用唯一 0014”描述为 ready；
5. 应用后、部署前或同一重要批次关闭前完成 post dump；
6. `acceptance:hosted:backup:complete` 必须通过；
7. 再按 API→Web 严格串行 one-shot arm/deploy/disarm 继续。

缺少、过期、权限过宽、工作树不干净、未 ignored、hash/size 不符、candidate commit 漂移、migration head
不符、目录含未知文件或 scratch 未销毁时一律固定失败。不得手写 manifest、复制旧批次证据或把 dry-run
输出当 backup。

## 6. 验收边界

默认离线测试必须证明：

- plan 不访问 filesystem/Git/network，也不存在 capture/restore 根脚本；
- 参数不能注入 project、路径或 operation，错误只输出固定消息；
- preflight/complete 校验固定 project、batch、clean HEAD、ignore、目录/file mode、exact keys、size/hash 和
  pre/post migration head；
- rebuild manifest 必须是 migrations+fictional-seed、Hosted data absent 且 scratch destroyed；
- 日志和错误不反射 manifest、路径输入、账号、正文或 secret；
- Hosted deployment action ledger 把 backup preflight 放在 0014 apply 之前。

真实 dump、restore、scratch rebuild、Supabase 连接和 retained-backup 删除仍分别需要批准、运行证据与清理
证据；本文件不关闭 Supabase 备份残留期限或正式 production 恢复演练。
