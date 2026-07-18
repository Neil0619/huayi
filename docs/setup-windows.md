# Windows 安装说明（DeepSeek + 欧路生词本）

Windows 版复用同一套 Chrome Extension 和 wire v5，但 Native Host 固定只调用官方 DeepSeek。
它不会查找或启动 Windows 上的 Codex，也不支持 OpenAI 或 Compatible 模型 Provider；欧路
作为独立生词本能力提供，不参与模型分析。

## 前置条件

- Windows 10/11、Google Chrome、Git。
- Node.js 26 或更高版本。Node 26 只用于从源码构建单文件 Host；安装后日常运行不需要 Node。
- Corepack/pnpm。
- 后续由你在两个隐藏输入框中分别配置的 DeepSeek API Key 和欧路 OpenAPI Authorization；
  不要把任何 Key 或 Authorization 写进命令、聊天或仓库。

## 1. 下载与构建

在 PowerShell 中执行：

```powershell
git clone https://github.com/Neil0619/huayi.git
Set-Location huayi
corepack enable
pnpm install
pnpm build
pnpm host:windows:package
```

`host:windows:package` 使用 Node 的 Single Executable Application 构建
`apps/native-host/dist/windows/huayi-native-host.exe`。该步骤必须在 Windows 上执行；macOS
不能替你产出可验收的 Windows `.exe`。

## 2. 在 Chrome 加载扩展

1. 打开 `chrome://extensions`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择仓库中的 `apps/extension/dist`。
5. 复制 Chrome 显示的 32 位扩展 ID。

不要假设 Windows 上的 ID 一定等于 macOS 个人 ID；Native Host 清单只信任本次 Chrome
实际显示的精确 ID。

## 3. 安装 Native Host

把 `<ID>` 替换为上一步的扩展 ID：

```powershell
pnpm host:install -- --extension-id <ID> --dry-run
pnpm host:install -- --extension-id <ID>
```

安装器只写入：

```text
%LOCALAPPDATA%\Huayi\native-host\
HKCU\Software\Google\Chrome\NativeMessagingHosts\com.huayi.codex_bridge
```

注册表默认值指向 `%LOCALAPPDATA%` 下的 Native Messaging manifest；manifest 的
`allowed_origins` 只包含你的扩展 ID。

## 4. 配置 DeepSeek 与欧路凭据

先安装，再执行：

```powershell
pnpm host:deepseek:configure
pnpm host:eudic:configure
pnpm host:provider:status
```

两条配置命令都会显示隐藏输入。欧路命令需要输入欧路 OpenAPI 要求的完整 Authorization
值。两份秘密分别保存为：

```text
%LOCALAPPDATA%\Huayi\native-host\deepseek-credential.xml
%LOCALAPPDATA%\Huayi\native-host\eudic-credential.xml
```

它们是相互独立的 `PSCredential` XML；Windows 上 `Export-Clixml` 使用 DPAPI 加密密码字段，
只能由同一台机器上的同一 Windows 用户解密。Host 每次模型分析重新读取 DeepSeek Key，每次
查词或加词重新读取欧路 Authorization；都不缓存，也不写入扩展或日志。

`host:provider:status` 在 Windows 固定输出 `deepseek-chat-completions`，不能切换到 Codex。
配置欧路不会改变模型 Provider；暂不配置欧路也不会阻止 DeepSeek 翻译。

需要真实验证模型时，可在另行确认固定测试文本会发送给官方 DeepSeek 且可能产生 API 费用后
运行 `pnpm smoke:deepseek`。Windows smoke 读取上述 DPAPI 凭据，不读取 macOS Keychain。

## 5. 刷新与验证

1. 返回 `chrome://extensions`，确认版本为 `0.10.0` 并点击刷新。
2. 完全关闭并重新打开 Chrome。
3. 在普通 HTTPS 页面选中英文，分别测试单词和句子翻译/解释。
4. 选中一个英文单词，确认生词状态可查询，并测试“加入欧路生词本”。

## 升级

```powershell
git pull
pnpm install
pnpm build
pnpm host:windows:package
pnpm host:install -- --extension-id <ID>
```

然后在 Chrome 刷新扩展。Extension 和 Host 必须同步为 `0.10.0`；wire v5 不接受旧版 Host。
重复安装会替换 Huayi 自有运行文件，保留现有的 DeepSeek 与欧路 DPAPI 凭据。

## 卸载

```powershell
pnpm host:eudic:remove
pnpm host:deepseek:remove
pnpm host:uninstall
```

前两条命令可分别删除精确凭据；完整卸载会删除 Huayi 自有目录（包括仍存在的两份凭据）和
精确 HKCU 注册表键，不触碰其他 Native Messaging Host。

## 新 Codex 接手

可以在 Windows 上把仓库作为新的 Codex project 打开。根 `AGENTS.md`、模块 `AGENTS.md`、
本文件、`project-status.md`、架构、协议、安全和测试文档已经描述当前边界。新的 Codex 应先跑
离线门禁，再做 Windows 实机安装；不要重新设计协议，也不要在 Windows 补 Codex Provider。

## 官方接口依据

- [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [PowerShell Export-Clixml 与 DPAPI](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/export-clixml)
- [Node.js Single Executable Applications](https://nodejs.org/api/single-executable-applications.html)
- [欧路生词本 API](https://my.eudic.net/OpenAPI/doc_api_study)
