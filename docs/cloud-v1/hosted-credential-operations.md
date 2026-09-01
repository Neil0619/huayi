# Hosted 运维凭据持久化

影响平台：`shared + macOS`。Hosted/Vercel 脚本通过可注入凭据接口消费秘密；当前唯一生产
store 是 macOS login Keychain。Windows、Linux 和其他平台固定返回不支持，不回退到环境变量、
`.env`、stdin 或明文文件。

## 固定标识

Keychain service 固定为 `cn.seen-said.huayi.hosted.acceptance`，account 固定为：

| account                            | 用途                                                  |
| ---------------------------------- | ----------------------------------------------------- |
| `supabase-admin-db-password`       | migration、backup、source restore、Cron 和管理员诊断  |
| `supabase-application-db-password` | foundation bootstrap、application diagnose/verify     |
| `supabase-management-token`        | Supabase Auth 配置、状态、邀请诊断和 restore 管理请求 |
| `vercel-token`                     | Vercel project、deployment、one-shot 和只读诊断       |

Supabase 必须使用操作者配置的长期 PAT；Vercel 使用操作者选定的长期 Token。工具不创建、续期、
缩短有效期或静默替换 Token。只有操作者明确轮换、撤销，或服务端确定凭据失效时才重新配置。

## 首次配置与生命周期

在 macOS 受控终端中首次运行：

```bash
pnpm acceptance:hosted:credentials:configure
pnpm acceptance:hosted:credentials:status
pnpm acceptance:hosted:credentials:diagnose
```

`configure` 先检查全部目标 account，并验证已有项确实可读且格式有效；只有完整 preflight 通过后才为
缺失项调用 `/usr/bin/security add-generic-password ... -w`。秘密由系统命令直接隐藏读取；脚本不取得
输入参数，也不使用 `-A`。每次系统隐藏提示前先输出固定
`credential|<account>|input-required`，操作者无需记忆四项顺序。多项配置期间若操作者取消后续系统
提示，已经完成的项会立即显示，命令返回失败；重新运行会安全跳过并复验这些项，只继续缺失项。可用
`--name` 只处理一项：

```bash
pnpm acceptance:hosted:credentials:configure -- --name vercel-token
pnpm acceptance:hosted:credentials:rotate -- --name vercel-token
pnpm acceptance:hosted:credentials:remove -- --name vercel-token
```

不带 `--name` 的 `remove` 先预检四项状态再逐项删除，并立即报告每项结果；`rotate` 必须显式指定一项。
`status` 只做不带 `-w` 的
元数据查询并逐项报告 `present` 或 `missing`。`diagnose` 才读取并校验值，但只输出固定
`available`、`missing`、`locked`、`denied` 或 `invalid`，不显示值、长度、前后缀或底层错误。
Keychain 锁定时允许 macOS 正常要求一次解锁；无 TTY 时配置/轮换失败关闭，不从 stdin 回退。

配置后应在两个全新终端或 Codex 执行轮次中重复运行已获批准的只读诊断；消费者不得再次要求
输入上述四项秘密。Hosted Operator 登录邮箱/密码和临时 recovery project 管理员密码是业务/单次
凭据，仍按既有专用隐藏输入处理，不属于这四个 account。

## 消费与传输边界

- 每个命令在通过参数、状态与授权门后读取所需 account，并在本次操作内固定该值；底层 HTTP
  adapter 只接收内存参数，Token 只进入固定 Authorization header。
- 数据库密码不进入 argv、URL、父/子进程环境、日志、异常、状态文件或测试 snapshot。数据库调用
  创建 `0700` 临时目录和 `0600` `.pgpass`/CA，子进程只取得 `PGPASSFILE`、`PGSSLROOTCERT` 与
  固定 TLS/locale 环境；成功、失败、timeout、`SIGHUP`、`SIGINT` 和 `SIGTERM` 均清理整个目录。
- capture/restore 的容器数据库通道继续使用同一 `0600 .pgpass` 原则。临时 recovery project 密码
  不复用长期 source 管理员密码。Supabase management PAT 不进入 Docker child environment；未来
  production restore 管理 adapter 必须使用受控 HTTP port。
- `PGPASSWORD`、`SUPABASE_DB_PASSWORD`、`HUAYI_HOSTED_APP_DATABASE_PASSWORD`、
  `SUPABASE_ACCESS_TOKEN`、`VERCEL_TOKEN` 及旧 Hosted source/target/management secret 环境名全部在
  外部工作前失败关闭，即使值为空或为 `undefined`。
- 默认测试只使用 fake Keychain、fake process、fake HTTP 与临时目录，不读取真实 Keychain、不联网、
  不执行迁移/部署或产生供应商费用。

## 授权边界

`present` 或 `available` 只证明本机凭据可被安全读取，不授权连接 Hosted、运行 migration、backup、
restore、Cron apply、Vercel deployment/one-shot、真实 smoke、发送邮件或调用付费模型。每个远端读取和
变更仍遵守自己的 clean candidate、状态、exact confirmation、一次性序列与用户明确批准门。
