# 跨平台开发与完成规则

## 目标

Huayi 支持 macOS 与 Windows，但两端的 Native Host 能力不同。代码可以在任一平台编写；完成
结论必须基于风险分级、双平台自动门禁和必要的目标平台人工验收。Linux 不是支持目标，只可
作为 CI 工具环境或纯逻辑参考，不能代表任一发布平台。

任务开始时必须声明影响范围：`shared`、`macOS`、`Windows` 或其组合。任务结束时必须分别列出
已执行的自动检查、目标平台人工检查和未完成项。

## 完成矩阵

| 改动类型                                             | 可以在哪个平台实现       | 自动门禁                                      | 目标平台人工验收     |
| ---------------------------------------------------- | ------------------------ | --------------------------------------------- | -------------------- |
| 协议、Schema、Prompt、HTTP、Extension UI、纯领域逻辑 | 任意                     | macOS 与 Windows                              | 不要求               |
| macOS Keychain、Codex 进程、launcher、安装/卸载      | 任意，使用 fake 覆盖契约 | 双平台单测与 macOS 门禁                       | 要求 macOS           |
| Windows DPAPI、PowerShell、注册表、SEA、安装/卸载    | 任意，使用 fake 覆盖契约 | 双平台单测、Windows Node 26 门禁与 SEA health | 要求 Windows         |
| Native Messaging、版本、帧或共享传输                 | 任意                     | 双平台门禁                                    | 发布前两端都要求     |
| 真实 Chrome、凭据、Provider smoke                    | 目标平台                 | 禁止进入 CI                                   | 取得用户授权后执行   |
| 仅某平台可复现的系统缺陷                             | 任意平台可先写回归契约   | 双平台门禁                                    | 最终必须回到问题平台 |

fake 只能证明输入、输出、错误映射和调用约束，不能证明 Keychain、DPAPI、注册表、进程信号、
文件权限、SEA 或 Chrome Native Messaging 在真实系统上工作。

## 工程规则

- 平台、路径、权限、换行、大小写、进程和环境变量必须显式注入；不要让测试隐式继承开发机。
- Windows 路径使用 `node:path` 的 `win32` 语义；POSIX 路径使用对应语义。协议和扩展消息不得
  暴露平台路径。
- 子进程必须使用固定 executable、参数数组和 `shell: false`。测试 fixture 在 POSIX 需要执行
  权限时显式 `chmod`，在 Windows 不得依赖 POSIX mode。
- 只有不可模拟的真实 OS 原语可以按平台跳过；跳过原因必须写在测试附近，并由目标平台 CI
  或人工验收覆盖。能通过注入验证的逻辑不得按当前 `process.platform` 整体跳过。
- 默认门禁不得读取真实 Keychain、DPAPI 凭据、注册表秘密、Codex 登录或调用外部 API。
- 系统集成、安全边界或安装行为改变时，同步更新本文件、`testing.md`、对应 setup 文档和
  `security.md`。

## 自动验证流程

macOS 使用：

```bash
pnpm verify:macos
```

Windows 使用 PowerShell 与 Node.js 26 或更高版本：

```powershell
pnpm verify:windows
```

macOS 门禁包含指令、格式、Lint、类型、单元测试、Chrome Playwright、构建和 diff。Windows
门禁包含指令、格式、Lint、类型、单元测试、构建、SEA 打包、真实 `.exe` health 帧和 diff。
两个命令都必须离线；真实 smoke、安装和凭据操作不在其中。

GitHub Actions 在 `main` push、Pull Request 和手动触发时运行 `macos-quality` 与
`windows-quality`。工作流首次在 `main` 和 PR 各稳定通过一次后，再把两项设为 `main` 必需
检查；在此之前仅告警，不改变直接推送习惯。

## 人工验收与交接

macOS 系统集成改动至少验证 Keychain/Provider 所属边界、Host dry-run、安装或升级、Chrome
health、受影响功能和幂等卸载。Windows 系统集成改动至少验证 SEA 安装、精确 HKCU 注册表、
DPAPI 凭据隔离、Chrome health、受影响功能、升级保留和幂等卸载。

真实 Provider 或欧路验证必须先说明将发送的数据、目标服务和费用，并取得单独授权。不得把
Key、Authorization 或凭据文件放入命令参数、聊天、日志、CI Secret 或仓库。

无法访问目标平台时，交接必须使用以下格式，且任务不得标记完成：

```text
Status: implemented; target-platform validation pending
Affected platforms: <macOS | Windows | both>
Completed checks: <commands and results>
Run on target: <exact commands>
Expected: <observable version, provider, files/registry, Chrome behavior>
Remaining risk: <OS primitive not yet exercised>
```

发布前要求两个 CI job 全绿；触及平台系统集成时完成人工清单；Host、Extension、协议和版本
保持同步；所有真实 smoke 仍需单独授权。
