# Hosted acceptance 迭代、测试与发布 SOP

## 1. 目的与适用范围

本 SOP 固定语见 Cloud V1 在 `hosted-acceptance` 的常规迭代闭环：需求确认、实现、自动测试、候选提交、
双平台 CI、API/Web exact-SHA 发布、运行时回读和交付记录。它不发布 Chrome Web Store，也不把
acceptance 自动升级为正式 production。

数据库 migration/restore、首次身份流程、Supabase Cron、真实邮件、真实 Provider 请求、付费资源和
Chrome 人工旅程仍是独立业务门。它们可由各自受控工具接续，但不能被常规代码发布隐式触发。

## 2. 一次迭代的唯一主线

每项需求只使用一个用户可见任务和一个候选分支。执行方从开始到交付负责以下完整顺序：

1. **界定**：声明 `shared`、`macOS`、`Windows` 或组合；读取权威规格、附近代码、测试和当前远端状态；
   把不可自动验证的外部门列为验收项。
2. **实现**：行为变化先取得可解释的 Fresh RED，再做最小修复并重构；秘密、真实服务和平台原语均通过
   可注入 adapter 隔离，默认测试只用 fake。
3. **聚焦验证**：运行改动直接相关的单元、脚本、API/Web/Store 或 E2E 测试；修复回归后再次运行，不能
   用 mock 调用次数替代行为断言。
4. **完整质量门**：审查 diff 与秘密扫描，然后运行 `pnpm check:instructions`、format、lint、typecheck、
   完整 tests、E2E、build 和本机平台验证。Hosted release coordinator 会再次执行完整
   `pnpm verify:macos`，因此本机结果不能被陈旧缓存替代。
5. **冻结候选**：只提交本迭代文件，使用 Conventional Commit；要求工作树 clean、分支为
   `codex/settings-configuration`、`HEAD` 唯一且两个 Vercel 项目 disarmed。候选 SHA 一旦获准发布便不可
   amend、squash 或混入新改动；变更 SHA 必须形成新候选。
6. **自动发布**：一次 exact-SHA 发布授权后，由协调器串行完成本机完整门、精确 push、同一 SHA/Release
   ID 的 macOS+Windows GitHub CI、完整门之后的 Hosted Store 专用包重建与审计、固定 Store capability
   配置、API Ready、Web Ready 和 runtime attestation。API/Web 不并行，不依赖 Vercel Git 自动部署。
7. **交付**：回读状态必须为 `complete`，记录候选 SHA、CI run、API/Web deployment、运行时 attestation、
   已运行测试和仍需人工完成的业务门。部署完成只表示该代码候选可供验收，不等于业务功能已验收。

## 3. 固定命令

首次在一台 macOS 运维机上配置一次长期基础设施凭据：

```bash
pnpm acceptance:hosted:credentials:configure
pnpm acceptance:hosted:credentials:diagnose
```

常规候选完成提交后：

```bash
pnpm acceptance:hosted:release:plan
pnpm acceptance:hosted:release:status
pnpm acceptance:hosted:release:advance
pnpm acceptance:hosted:release:status
```

`plan` 零 I/O，`status` 只读。`advance` 在一次调用内持续推进到 `complete` 或精确失败点。只有当 state
停在 `ci-dispatching`、`api-configuring`、`api-deploying` 或 `web-deploying` 等不确定边界，且只读证据尚
不能由同一次调用完成对账时，才运行：

```bash
pnpm acceptance:hosted:release:recover
pnpm acceptance:hosted:release:status
```

不得删除或手改 ignored state，不得通过再次 dispatch/upsert/create 猜测远端写入是否发生。

## 4. 自动化与人工门的边界

| 项目            | 常规发布自动完成                                     | 仍需独立受控验收                                     |
| --------------- | ---------------------------------------------------- | ---------------------------------------------------- |
| 代码质量        | 聚焦回归、完整 macOS 门、exact-SHA Windows CI        | macOS/Windows 真机平台原语按改动范围验收             |
| 部署            | push、唯一 CI、API→Web、Ready 等待、身份与运行时回读 | production 发布、套餐/容量决定                       |
| Store Extension | 固定 acceptance ID/capability、构建审计              | Chrome 加载、配对、网页/YouTube 旅程、Web Store 上架 |
| 数据库          | 只读状态可进入诊断                                   | migration、backup、restore 各自确认与完成证据        |
| 邮件与 Cron     | bootstrap 可安全建立同源 secret 并证明 worker 幂等   | 用户收件、告警接收方、Cron apply、两个周期与故障恢复 |
| DeepSeek        | 离线合同、预算和账本门                               | 每次真实请求的明确额度、Operator 隐藏密码和外部账单  |

未来提出“按 Hosted SOP 发布本次迭代”时，执行方应直接完成本表左列的整个闭环，并只在右列确实需要
用户本人、外部收件箱、付费调用或不可逆远端变更时停下。一次授权只绑定当次 frozen exact SHA；任何
代码变化都重新进入测试和候选冻结。

### 4.1 首次密码恢复与 Cron 引导

常规 release coordinator 不隐式发送邮件或安装 Cron。首次环境中 Cron 尚未安装时，必须先让用户在
`/recover` 提交一次恢复请求，再按以下受控接续完成闭环：

```text
唯一 claimable recovery
  -> bootstrap provision（锁定无既有 release state 的 exact SHA；Vault -> Vercel Sensitive）
  -> 同一 state 的 exact-SHA release complete（必须新建 API deployment）
  -> fresh runtime attestation
  -> bootstrap recovery（password worker: sent -> idle）
  -> 用户完成改密
  -> bootstrap deliver（R3-C worker: sent -> idle）
  -> 用户确认安全通知
  -> Cron status/apply -> 至少两个周期
```

公开 `/recover` 的 202 只证明队列接受；只有 recovery 命令成功及只读 postflight 的 `sent` 才证明
Supabase Auth 接受发送。重复提交会终结同账号旧 flow，因此操作者不得用反复点击代替 worker 诊断。
provision 持有 release lock 直到 Vercel upsert 成功并原子写入带随机 `releaseAttemptId` 的 schema-v2
`candidate-recorded`；同一 SHA 已有任何 release state（尤其旧 `complete`）时都在 Vault/Vercel 写入前失败，
必须使用新的冻结候选。后续 deployment 的 metadata 必须精确匹配该 attempt；即使另一个 clone 没有本地
state，也不能复用 upsert 前的旧同 SHA/release deployment。recovery 与 R3-C deliver 都重新核对 fixed branch、
clean、pushed/upstream、disarmed 与同 SHA attempt-bearing `complete` state，并在读取 Keychain/Vault 前执行
公开 runtime attestation。schema-v1 complete 仍可供旧 release status 只读显示，但不能通过 bootstrap delivery。
该接续读取既有 Keychain 凭据和 Vault bearer，不新增需要用户记忆的秘密。

## 5. 凭据与证据

- 四项基础设施凭据只从 macOS login Keychain 读取；不使用 `.env`、命令参数、明文环境变量或聊天。
- 数据库密码只经权限 `0600` 的临时 `.pgpass` 进入 child；Token 只在本进程内进入固定 HTTP header。
- release state 只保存 SHA、确定性 release ID、随机非秘密 release attempt ID、workflow/deployment ID 和
  phase，权限固定 `0700/0600`。
- deployment 必须先以 `forceNew=1` 尝试 create；只有请求可能已成功但响应丢失时，才按 exact
  SHA/release/attempt identity 有界回读，不能先查找并复用历史部署；
  找不到唯一证据就失败关闭。
- 最终交付报告必须区分“代码通过”“deployment complete”“业务旅程通过”和“production ready”，不得互相
  代替。

## 6. 失败处理

- 聚焦或完整测试失败：保留候选未发布，先建立根因和回归，不跳过测试。
- CI 失败：不创建 Vercel deployment；在同一 SHA 修复不了，必须产生新 SHA 并从头走质量门。
- API 未 Ready：不创建 Web deployment；只读检查 exact deployment，不能并行补发。
- Web 或 attestation 失败：保留精确 state，诊断后使用 recover；不得把部分发布报告为完成。
- 远端状态多匹配、身份不一致或 secret 来源不明：停止，不猜测、不覆盖、不重放。
- 已部署候选出现严重回归：先 disarm/阻断受影响能力，建立修复候选，再走相同 exact-SHA 全流程；不能在
  Dashboard 临时改值后跳过仓库和证据闭环。
