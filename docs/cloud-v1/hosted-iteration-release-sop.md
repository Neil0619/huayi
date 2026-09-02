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
   ID 的 macOS+Windows GitHub CI、固定 Store capability 配置、API Ready、Web Ready 和 runtime
   attestation。API/Web 不并行，不依赖 Vercel Git 自动部署。
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

## 5. 凭据与证据

- 四项基础设施凭据只从 macOS login Keychain 读取；不使用 `.env`、命令参数、明文环境变量或聊天。
- 数据库密码只经权限 `0600` 的临时 `.pgpass` 进入 child；Token 只在本进程内进入固定 HTTP header。
- release state 只保存 SHA、确定性 release ID、workflow/deployment ID 和 phase，权限固定 `0700/0600`。
- CI dispatch、环境 upsert 或 deployment create 遇到响应丢失时，只按 exact SHA/release identity 有界回读；
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
