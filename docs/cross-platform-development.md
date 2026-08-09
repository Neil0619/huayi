# 跨平台开发与完成规则

## 目标

Huayi 支持 macOS 与 Windows，但两端的 Native Host 能力不同。代码可以在任一平台编写；完成
结论必须基于风险分级、双平台自动门禁和必要的目标平台人工验收。Linux 不是支持目标，只可
作为 CI 工具环境或纯逻辑参考，不能代表任一发布平台。

任务开始时必须声明影响范围：`shared`、`macOS`、`Windows` 或其组合。任务结束时必须分别列出
已执行的自动检查、目标平台人工检查和未完成项。

## 完成矩阵

| 改动类型                                             | 可以在哪个平台实现       | 自动门禁                                        | 目标平台人工验收       |
| ---------------------------------------------------- | ------------------------ | ----------------------------------------------- | ---------------------- |
| 协议、Schema、Prompt、HTTP、Extension UI、纯领域逻辑 | 任意                     | macOS 与 Windows                                | 不要求                 |
| YouTube MAIN bridge 与私有播放器字幕适配             | 任意，使用离线 fixture   | 双平台门禁与 macOS Playwright                   | 发布前两端 Chrome 要求 |
| macOS Keychain、Codex 进程、launcher、安装/卸载      | 任意，使用 fake 覆盖契约 | 双平台单测与 macOS 门禁                         | 要求 macOS             |
| Windows DPAPI、PowerShell、注册表、SEA、安装/卸载    | 任意，使用 fake 覆盖契约 | 双平台单测、Windows Node 26 门禁与 SEA health   | 要求 Windows           |
| 生词同步状态、迁移、词形还原、放弃终态和扇贝页面适配 | 任意，路径/文件行为注入  | 双平台单测、构建、macOS Playwright、Windows SEA | 两端 Chrome 发布前要求 |
| Native Messaging、版本、帧或共享传输                 | 任意                     | 双平台门禁                                      | 发布前两端都要求       |
| 真实 Chrome、凭据、Provider smoke                    | 目标平台                 | 禁止进入 CI                                     | 取得用户授权后执行     |
| 仅某平台可复现的系统缺陷                             | 任意平台可先写回归契约   | 双平台门禁                                      | 最终必须回到问题平台   |

fake 只能证明输入、输出、错误映射和调用约束，不能证明 Keychain、DPAPI、注册表、进程信号、
文件权限、SEA 或 Chrome Native Messaging 在真实系统上工作。

YouTube 离线 fixture 能证明 bridge/controller 协议、失败恢复和 DOM 交互，但不能证明当前真实
YouTube 私有播放器仍会发出预期的 player-driven timedtext；该请求可能包含或省略 `pot`。此类
改动在发布前必须另行授权，并在 macOS 与 Windows 的真实 Chrome 验证人工英文、英文 ASR、
CC／切轨、`zh-Hans`、SPA、剧院／全屏、选词和生词本。

## 工程规则

- 平台、路径、权限、换行、大小写、进程和环境变量必须显式注入；不要让测试隐式继承开发机。
- Windows 路径使用 `node:path` 的 `win32` 语义；POSIX 路径使用对应语义。协议和扩展消息不得
  暴露平台路径。
- 生词状态 Schema、v1/v2→v3 迁移、分页、部分确认和词形规则必须完全共用。macOS 只负责
  `~/Library/Application Support` 路径与 `0600`，Windows 只负责 `%LOCALAPPDATA%` 路径及当前
  用户 ACL；离线词形依赖必须同时进入 macOS bundle 和 Windows SEA，不能在运行时下载。
- macOS Native Messaging 清单必须通过同目录 `0600` 临时文件、文件同步、原子 `rename` 和
  目录同步更新；替换前失败必须保留上一份有效清单并清理临时文件。
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
health 验证会把 `.exe` 复制到仓库外的临时目录，清除 `NODE_PATH` 并使用临时
`LOCALAPPDATA`，从而证明包括 `wink-lemmatizer` 在内的运行时代码已进入 SEA，而不是从仓库
`node_modules` 加载。
两个命令都必须离线；真实 smoke、安装和凭据操作不在其中。

当前 `0.12.0` 的 Windows 收尾已完成 Windows 离线质量门、另行 62 条 Playwright、Node.js 26
SEA 独立 `health`、实际 SEA 安装、精确 HKCU 注册表与 manifest 检查，以及安装后 Host 的直接
`health` 验证。安装文件与已验证构建产物哈希一致，既有凭据和生词同步状态仍存在。Chrome 已
重载最新未打包扩展；真实 YouTube 已确认新版字幕 UI 注入、播放中选词后连续两轮首击关闭并
持续播放、原暂停状态保持暂停，以及下一次普通播放器点击只切换一次。`Shift+Z` 由浏览器 E2E
覆盖，字幕角标按住由控制器集成单测覆盖；实机页面已确认两个入口可见。真实 DeepSeek 与欧路
请求仍须另行授权，
不包含在本轮离线和本机安装验收中。macOS 门禁与实机验收后续回到 macOS 环境继续，不阻塞本次
Windows 开发收尾，但在完成前仍属于双平台发布验证未完成。

GitHub Actions 在 `main` push、Pull Request 和手动触发时运行 `macos-quality` 与
`windows-quality`。工作流首次在 `main` 和 PR 各稳定通过一次后，再把两项设为 `main` 必需
检查；在此之前仅告警，不改变直接推送习惯。

## 人工验收与交接

macOS 系统集成改动至少验证 Keychain/Provider 所属边界、Host dry-run、安装或升级、Chrome
health、受影响功能和幂等卸载。Windows 系统集成改动至少验证 SEA 安装、精确 HKCU 注册表、
DPAPI 凭据隔离、Chrome health、受影响功能、升级保留和幂等卸载。
Windows 自动 fixture 还必须覆盖升级保留凭据/同步状态、ownership marker 拒绝、注册表存在、
不存在和查询失败，以及安装目录缺失时清理遗留的精确 Huayi 注册表值。

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
