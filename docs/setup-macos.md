# macOS 安装说明

## 前置条件

- Google Chrome。
- Node.js 18 或更高版本。
- pnpm。
- 已通过 `codex login` 使用 ChatGPT 登录、且支持 App Server 的 Codex CLI。
- macOS 自带 `/usr/bin/security`。欧路功能可选，安装扩展和 Host 时无需已有授权。

安装器不只比较 Codex 版本号；dry-run 会检查 `app-server --stdio --strict-config`、
`--disable` / `--config`，并确认以下功能可以被禁用：

```text
apps hooks image_generation in_app_browser memories multi_agent plugins remote_plugin
shell_tool unified_exec shell_snapshot tool_suggest
```

缺失任一能力或 ChatGPT 登录时失败关闭，不使用权限更宽的降级配置。

## 构建扩展和 Host

```bash
pnpm install
pnpm build
```

在 `chrome://extensions` 开启开发者模式，加载 `apps/extension/dist`，并复制 Chrome 展示的
32 位小写 `a-p` 扩展 ID。Manifest 未固定 `key` 时，开发版 ID 与加载目录有关；移动仓库或
构建目录后必须重新复制 ID 并重装 Host。

## 安装 Native Host

```bash
pnpm host:install -- --extension-id <ID> --dry-run
pnpm host:install -- --extension-id <ID>
```

建议先运行 dry-run。它只读验证 Node、构建产物、App Server 参数和禁用功能、ChatGPT 登录及
`/usr/bin/security`；不会调用模型、访问欧路、读取钥匙串授权或写入用户目录。Codex 不在
`PATH` 时可提供绝对路径：

```bash
pnpm host:install -- --extension-id <ID> --codex-path /absolute/path/to/codex
```

正式安装写入：

- `~/Library/Application Support/Huayi/native-host/`：自包含 Host、四份 Schema、专用空工作
  目录、launcher 和所有权标记；
- `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.huayi.codex_bridge.json`：
  只允许当前扩展 ID。

目标目录或清单缺少合法 Huayi 所有权时安装失败，不覆盖未知内容。launcher 记录绝对 Node、
Codex、`HOME` 和可选 `CODEX_HOME`，使用受控 `PATH`，因此 Chrome 从 GUI 启动时不依赖终端
shell 初始化文件。

## 配置欧路授权（可选）

登录[欧路 OpenAPI 开发指南](https://my.eudic.net/OpenAPI/Doc_Index)，获取将来放入 HTTP
`Authorization` Header 的完整值（官方示例形如 `NIS xxxx`）。不要只输入后半段，也不要将
它写入参数、环境变量或文件。

```bash
pnpm host:eudic:configure -- --dry-run
pnpm host:eudic:configure
```

dry-run 只验证 `/usr/bin/security`，不提示输入、不读钥匙串、不访问欧路。正式命令让
`security` 在终端隐藏读取授权，并使用 `-U` 更新固定的 Huayi 钥匙串项；配置本身不验证
授权，第一次自动查词或显式加词时才访问欧路。

只移除欧路授权而保留扩展和 Host：

```bash
pnpm host:eudic:remove -- --dry-run
pnpm host:eudic:remove
```

该命令只删除 service `com.huayi.codex_bridge.eudic`、account `authorization` 的精确项。

## 从 v0.2.x 升级到 v0.3.0

v0.3.0 同时改变扩展、Native Host、App Server provider 和 wire 事件，升级顺序固定为：

1. 运行 `pnpm install && pnpm build`，重新生成扩展和 Host。
2. 在 `chrome://extensions` 找到“划译”并点击刷新。
3. 复制当前扩展 ID，重新运行 `pnpm host:install -- --extension-id <ID>`。
4. 用单词验证流式文本和生词状态；需要真实模型证据时再显式运行 `pnpm smoke:codex`。

重复安装只替换 Huayi 自有 Host 文件，不读取、覆盖或删除现有欧路钥匙串授权，无需重新配置。
扩展和 Host 必须同步为 `0.3.0`；公共 `schemaVersion` 仍为 `1`。

## 人工验收

普通验收选择一个单词、短语、单句和多句段落，确认先显示核心增量、后显示完整卡片。单词
分别验证“已加入生词本”和可添加两种状态；自动查询不得上传句子，只有点击添加才发送原始
单词和所在英文句子。

真实欧路验收需要用户已配置钥匙串：添加未收藏单词后检查语境，再次选择同词应显示已存在，
且不得覆盖原分组、星级或已有语境。自动测试不会访问真实欧路。

## 卸载

```bash
pnpm host:uninstall -- --dry-run
pnpm host:uninstall
```

完整卸载会先删除精确欧路钥匙串项，再删除经过所有权验证的 Huayi Host 与清单；不会删除
Chrome 父目录、其他 Native Messaging 清单或其他凭据。若只想升级或重装，请重复执行安装
命令，不要先卸载，这样欧路钥匙串会保留。
