# Windows 安装说明（DeepSeek + 欧路生词本）

Windows 版复用同一套 Chrome Extension 和 wire v7，但 Native Host 固定只调用官方 DeepSeek。
它不会查找或启动 Windows 上的 Codex，也不支持 OpenAI 或 Compatible 模型 Provider；欧路
作为独立生词本能力提供，不参与模型分析。跨平台改动的完成判定和交接格式见
[跨平台开发规则](cross-platform-development.md)。

> v0.12.0 历史验证记录（2026-08-10）：Windows 离线质量门、另行 62 条 Playwright、Node.js 26 SEA 独立
> `health`、实际安装、精确 HKCU 注册表与 manifest 检查，以及安装后 Host 直接 `health` 均已
> 通过；当前加载路径的扩展 ID `kmeopbhijmkcjeckjicfinpdminhpbak` 已与 manifest 唯一的
> `allowed_origins` 对齐，安装文件与已验证构建产物哈希一致，既有凭据和生词同步状态仍存在。
> Chrome 已从该精确来源成功拉起已安装 Host，并已重载最新 `0.12.0` 未打包扩展；真实 YouTube
> 已确认新版字幕 UI 注入、播放中选词连续两轮首击关闭并
> 持续播放、原暂停状态保持暂停，以及下一次普通播放器点击只切换一次。`Shift+Z` 由浏览器
> E2E 覆盖，字幕角标按住由控制器集成单测覆盖；实机页面已确认两个入口可见。真实 DeepSeek／
> 欧路请求未执行，仍需
> 单独授权。macOS 验证将在后续 macOS 环境继续，不阻塞本次 Windows 收尾，也不表示双平台发布
> v0.13.0 实机验证记录（2026-08-10）：已通过离线质量门、63 条 Chrome E2E、SEA `health`、
> 同步安装 Extension/Host，以及 Options、Popup 与无需联网的设置保存检查。真实 DeepSeek 验证仍有
> 已知延期：DPAPI/PowerShell 凭据读取偶发约 5 秒超时；真实 DeepSeek、欧路 smoke 与幂等卸载均未
> 执行。因此该记录不构成完整 Windows 系统集成或双平台发布验证结论。

## 前置条件

- Windows 10/11、Google Chrome、Git。
- Node.js 26 或更高版本。Node 26 只用于从源码构建单文件 Host；安装后日常运行不需要 Node。
- pnpm 10.12.4。Node.js 26 不再内置 Corepack；若系统没有 pnpm，请按 pnpm 官方方式单独安装，
  不要假设 `corepack enable` 可用。
- 后续由你在两个隐藏输入框中分别配置的 DeepSeek API Key 和欧路 OpenAPI Authorization；
  不要把任何 Key 或 Authorization 写进命令、聊天或仓库。

## 1. 下载与构建

在 PowerShell 中执行：

```powershell
git clone https://github.com/Neil0619/huayi.git
Set-Location huayi
pnpm install
pnpm verify:windows
```

`verify:windows` 运行离线指令检查、格式、Lint、类型、单测和构建，再使用 Node Single
Executable Application 构建 `apps/native-host/dist/windows/huayi-native-host.exe`，向真实
`.exe` 发送 Native Messaging `health` 帧并检查退出、帧及 stderr 污染。该步骤必须在 Windows
上执行；验证器会从仓库外临时目录运行复制的 `.exe`，不使用仓库 `node_modules`，并把
`LOCALAPPDATA` 指向临时 fixture。macOS 的 fake 测试不能替你产出或验收 Windows `.exe`。

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

dry-run 和正式安装都会输出 `Authorize Chrome extension <ID>`。该值必须与 Chrome 当前显示的
扩展 ID 完全一致；若重新加载自另一工作树或移动了仓库，先复制新 ID，再重新安装 Host。

安装器只写入：

```text
%LOCALAPPDATA%\Huayi\native-host\
HKCU\Software\Google\Chrome\NativeMessagingHosts\com.huayi.codex_bridge
```

注册表默认值指向 `%LOCALAPPDATA%` 下的 Native Messaging manifest；manifest 的
`allowed_origins` 只包含你的扩展 ID。

安装后用以下只读命令打印实际授权来源，并与 `chrome://extensions` 显示的 ID 对照：

```powershell
$key = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.huayi.codex_bridge'
$manifest = (Get-ItemProperty -LiteralPath $key).'(default)'
(Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json).allowed_origins
```

两者不一致时，Chrome 会在启动 Host 前拒绝连接，界面可能显示“未找到语见本机服务”；此时用
Chrome 当前 ID 重新运行安装命令，不要放宽 `allowed_origins`。

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
查词、加词或生词同步分页时重新读取欧路 Authorization；都不缓存，也不写入扩展或日志。

`host:provider:status` 在 Windows 固定输出 `deepseek-chat-completions`，不能切换到 Codex。
配置欧路不会改变模型 Provider；暂不配置欧路也不会阻止 DeepSeek 翻译。

需要真实验证模型时，可在另行确认固定测试文本会发送给官方 DeepSeek 且可能产生 API 费用后
运行 `pnpm smoke:deepseek`。Windows smoke 读取上述 DPAPI 凭据，不读取 macOS Keychain。

## 5. 刷新与验证

1. 返回 `chrome://extensions`，确认版本为 `0.13.0` 并点击刷新。
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

然后在 Chrome 刷新扩展。Extension 和 Host 必须同步为 `0.13.0`；wire v7 不接受 v6 Host。
重复安装会替换 Huayi 自有运行文件，保留现有的 DeepSeek、欧路 DPAPI 凭据和
`%LOCALAPPDATA%\Huayi\native-host\word-sync-state.json`。

Chrome 每天在设置页选择的本地整点（默认 08:00）完整扫描欧路默认英语生词本并在 Host 本地去重；若该
时刻 Chrome 或设备不可用，则恢复后尽快补扫，下一次仍固定在次日同一整点。角标显示待同步数量；点击后打开扇贝
生词本并预填最多 100 个目标词。用户必须亲自点击扇贝“批量添加”。部分成功时 Host 只确认
成功目标，并用随 SEA 打包的 `wink-lemmatizer` 离线尝试一次唯一名词/动词/形容词词元；无
可靠候选或再次被拒绝的词进入 `!` 未解决面板。
确认是错词时可逐条放弃，或经二次确认放弃全部未解决词；Host 保留放弃终态用于审计，并阻止
这些来源在以后的欧路轮询中再次入队。

v1/v2 状态首次读取时会原子迁移为 v3，并分别保留
`%LOCALAPPDATA%\Huayi\native-host\word-sync-state.json.v1-snapshot` 或
`%LOCALAPPDATA%\Huayi\native-host\word-sync-state.json.v2-snapshot`。v2→v3 保留全部处理进度，
只失效旧数据源的拉取元数据以立即重扫默认生词本。旧完成词的再审计先运行
只读 dry-run，再提交一个已确认存在于扇贝的探针，探针被接受后才允许全量重新入队：

```powershell
pnpm host:word-sync:reaudit
pnpm host:word-sync:reaudit -- --probe investigation --confirm-requeue-legacy
pnpm host:word-sync:reaudit -- --confirm-requeue-legacy
```

共享协议、状态迁移、路径注入、构建和 SEA 测试属于离线门禁；真实 Windows Chrome 的
部分失败、词元重试和历史再审计仍必须在 Windows 目标机由用户单独授权验收。

## 卸载

```powershell
pnpm host:eudic:remove
pnpm host:deepseek:remove
pnpm host:uninstall
```

前两条命令可分别删除精确凭据；完整卸载会删除 Huayi 自有目录（包括仍存在的两份凭据）和
精确 HKCU 注册表键，不触碰其他 Native Messaging Host。若 Huayi 目录已经缺失，完整卸载仍
会查询并删除遗留的这一个精确注册表键；注册表查询失败时保留任何仍存在的 Huayi 文件以便
重试。

## 新 Codex 接手

可以在 Windows 上把仓库作为新的 Codex project 打开。根 `AGENTS.md`、模块 `AGENTS.md`、
本文件、`project-status.md`、架构、协议、安全和测试文档已经描述当前边界。新的 Codex 应先跑
离线门禁，再做 Windows 实机安装；不要重新设计协议，也不要在 Windows 补 Codex Provider。

Cloud V1 Phase 37-B 只做离线候选门和 SEA health 时，先完整阅读
[`cloud-v1/windows-validation-handoff.md`](cloud-v1/windows-validation-handoff.md)，按其中固定分支、
候选祖先、Fresh 结果、修复边界、证据模板和普通 push 流程执行。不要恢复已废弃的 windows-codex
项目，也不要把离线门授权扩大为安装、真实 Chrome、凭据或 Provider/词典 smoke。

## Store Hosted 验收包更新

Store 与上方 Classic Native Host 安装相互独立。已获相应安装授权时，运行
`pnpm acceptance:hosted:store:build` 和 `pnpm acceptance:hosted:store:status`，加载
`apps/store-extension/dist`；Hosted ID 应为 `hoijjhgcckfhbcefoclgbhkgninnkknd`。以后只重新构建并在
现有条目点击“重新加载”，保留 ID 与配置，不要先卸载。普通 build/E2E 输出到 `dist-release`，不覆盖
Hosted 安装；该离线包不能替代云端包。真实重载、配对与 Windows 视觉验收需在 Windows 另行完成。

## 官方接口依据

- [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [PowerShell Export-Clixml 与 DPAPI](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/export-clixml)
- [Node.js Single Executable Applications](https://nodejs.org/api/single-executable-applications.html)
- [欧路生词本 API](https://my.eudic.net/OpenAPI/doc_api_study)
