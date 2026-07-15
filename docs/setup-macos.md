# macOS 安装说明

## 前置条件

- Google Chrome。
- Node.js 18 或更高版本。
- pnpm。
- 已通过 `codex login` 使用 ChatGPT 登录、且支持 App Server 的 Codex CLI。
- macOS 自带 `/usr/bin/security`。欧路、官方 OpenAI API 和 Compatible HTTP 功能均可选，
  安装扩展和 Host 时无需已有授权、API Key 或第三方配置。

安装器不只比较 Codex 版本号；dry-run 会检查 `app-server --stdio --strict-config`、
`--disable` / `--config`，并确认以下功能可以被禁用：

```text
apps
auth_elicitation
browser_use
browser_use_external
browser_use_full_cdp_access
computer_use
enable_mcp_apps
hooks
image_generation
in_app_browser
memories
multi_agent
plugins
remote_plugin
shell_snapshot
shell_tool
skill_mcp_dependency_install
tool_call_mcp_elicitation
tool_suggest
unified_exec
workspace_dependencies
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
`/usr/bin/security`；不会调用模型、访问欧路、读取欧路授权或 OpenAI API Key，也不会写入
用户目录。正式安装同样不会读取或创建任何 API 钥匙串项。Codex 不在 `PATH` 时可提供绝对
路径：

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

## 配置 OpenAI API Key（可选）

不要把 API Key 写入命令参数、环境变量、普通文件、扩展消息或聊天内容。使用以下命令让
macOS `security` 在终端隐藏读取，并以 `-U` 更新固定钥匙串项：

```bash
pnpm host:openai:configure -- --dry-run
pnpm host:openai:configure
```

dry-run 只验证 `/usr/bin/security`，不提示输入、不读取钥匙串，也不访问 OpenAI。正式配置
不会调用 OpenAI；第一次显式 API 分析才验证授权。重复安装 Host 不读取、覆盖或删除该 Key。

只移除 OpenAI API Key 而保留扩展、Host 和欧路授权：

```bash
pnpm host:openai:remove -- --dry-run
pnpm host:openai:remove
```

该命令只查询并删除 service `com.huayi.codex_bridge.openai`、account `api-key` 的精确项；项
不存在时幂等。

## 配置 Compatible HTTP Provider（可选、高风险）

该 Provider 会通过明文 HTTP 发送第三方 API Key、当前英文选区、最多 2,000 字符上下文和可用
英文句子。这些数据可能被同一路径上的网络设备或第三方截获、读取或篡改；
`--allow-insecure-http` 只表示你明确接受风险，不会提供 TLS 或完整性保护。

第三方 Key 使用独立钥匙串项 `com.huayi.codex_bridge.compatible_http` / `api-key`。不要把 Key
放入参数、环境变量、普通文件、扩展消息或聊天；用隐藏提示配置：

```bash
pnpm host:compatible:key:configure
```

官方 OpenAI Key 不会发送给第三方。v0.6.0 不会读取、复制或删除既有官方 OpenAI Key 或其
钥匙串项；官方与第三方两项必须始终分离。随后写入独立配置并检查明文风险状态：

```bash
pnpm host:compatible:config:set -- \
  --base-url http://101.133.153.118:9090/v1 \
  --model gpt-5.4-mini \
  --effort low \
  --allow-insecure-http
pnpm host:compatible:config:status
```

配置文件固定为 `~/Library/Application Support/Huayi/native-host/compatible-http.json`，与只
保存选择的 `provider.json` 分离。base URL 必须是不带凭据、query、fragment、尾随斜杠或
`/responses` 的绝对 HTTP URL；Host 只追加固定 `/responses`。模型/effort 只接受
`gpt-5.4-mini + low` 或 `gpt-5.6-luna + none`，风险确认必须为字面量 true。网页、Extension、
环境变量和 Codex 配置都不能覆盖这些值。

在仍使用 Codex 时先显式运行真实 smoke；它读取本机 Compatible 配置和专用钥匙串，但不会
切换 Provider：

```bash
pnpm smoke:compatible
```

只有查看 smoke 结果并再次明确决定后，才单独切换：

```bash
pnpm host:provider:set -- compatible-http
```

配置、smoke 和切换是三个独立动作。第三方路径不会读取或修改 Codex config/auth/session、
官方 OpenAI Key 或 Provider 环境变量，也不会在失败时自动回退。回滚后续请求只需：

```bash
pnpm host:provider:set -- codex
```

只在明确清理 Compatible 状态时分别执行：

```bash
pnpm host:compatible:config:remove -- --dry-run
pnpm host:compatible:config:remove
pnpm host:compatible:key:remove -- --dry-run
pnpm host:compatible:key:remove
```

专用 Key 的移除只删除 Compatible service/account。普通 `host:uninstall` 不自动删除该专用
钥匙串项；要完整清理时必须先显式运行上述 key remove。

## 选择模型 Provider

Provider 配置固定写入
`~/Library/Application Support/Huayi/native-host/provider.json`。文件缺失时默认使用 Codex；
API Key 的存在不会自动启用 API。切换命令只接受 `api`、`compatible-http` 或 `codex`，并以
`0600` 普通文件原子更新；符号链接、未知字段或无效文件失败关闭。

```bash
pnpm host:provider:set -- api
pnpm host:provider:status
```

API 模式固定使用 OpenAI Responses endpoint、`gpt-5.6-luna` 和 `none` effort。ChatGPT
Plus/Codex 额度与 OpenAI Platform API 计费彼此独立；启用 API 后会产生单独 API 费用。若要
立即停止 API 请求并回到默认链路：

```bash
pnpm host:provider:set -- codex
pnpm host:provider:status
```

Provider 切换只影响下一次分析，不迁移活动请求，也不会在 API 失败时自动回退。只有明确不再
保留 Key 时才执行 `pnpm host:openai:remove`。未来设置页可调用同一严格 Host 配置边界，但
v0.6.0 没有浏览器端配置 UI，也不会把 Key、endpoint 或模型写入扩展消息。

API 模式只发送当前英文选区、最多 2,000 字符上下文、可用英文句子和固定分析指令；不发送
URL、标题、历史记录、欧路授权或模型历史。钥匙串保护静态存储，但不能防御以同一 macOS
登录用户权限运行的恶意进程。

## 从 v0.2.x 升级到 v0.3.0

v0.3.0 同时改变扩展、Native Host、App Server provider 和 wire 事件，升级顺序固定为：

1. 运行 `pnpm install && pnpm build`，重新生成扩展和 Host。
2. 在 `chrome://extensions` 找到“划译”并点击刷新。
3. 复制当前扩展 ID，重新运行 `pnpm host:install -- --extension-id <ID>`。
4. 用单词验证流式文本和生词状态；需要真实模型证据时再显式运行 `pnpm smoke:codex`。

重复安装只替换 Huayi 自有 Host 文件，不读取、覆盖或删除现有欧路钥匙串授权，无需重新配置。
扩展和 Host 必须同步为 `0.3.0`；公共 `schemaVersion` 仍为 `1`。

## 从 v0.3.0 升级到 v0.3.1

v0.3.1 修复 Codex App Server 能力兼容性：每次进程启动前发现用户直接配置的 MCP Server，
逐个禁用已启用项，并在初始化后只接受安全 Hook 和无活动能力的 MCP 状态。公共 wire 协议未
改变，`schemaVersion` 仍为 `1`，但扩展和 Host 版本必须同步。

1. 在 v0.3.1 源码目录运行 `pnpm install && pnpm build`，重新生成扩展和 Host。
2. 确认 Chrome 当前加载的扩展目录。若它不是本次构建的 `apps/extension/dist`，把新构建内容
   完整同步到 Chrome 当前加载的原目录，保持加载路径和扩展 ID 不变。
3. 在 `chrome://extensions` 找到“划译”并点击刷新，使 Chrome 载入 v0.3.1 Manifest。
4. 使用同一个扩展 ID 重新运行 `pnpm host:install -- --extension-id <ID>`，安装 v0.3.1 Host。
5. 用一个单词确认流式解释和生词状态正常；真实模型验证只在明确需要时运行
   `pnpm smoke:codex`。

重复安装不会读取、覆盖或删除 service `com.huayi.codex_bridge.eudic`、account
`authorization` 的现有欧路钥匙串项；升级时不要先卸载，也不需要重新配置授权。

## 从 v0.3.1 升级到 v0.4.0

v0.4.0 的 Native Messaging 协议为 `schemaVersion: 2`，运行时拒绝 v1，不提供转换层。升级期间
暂停使用扩展，并在同一次操作中替换 Extension 和 Host；不得让 v0.3.1 Extension/Host 与
v0.4.0 的另一端混用。Chrome 权限仍严格为 `nativeMessaging`，平台范围仍只有 macOS 上的
Google Chrome 普通 `http/https` 顶层页面。

在 v0.4.0 源码根目录依次运行以下精确命令：

```bash
pnpm install
pnpm build
pnpm host:install -- --extension-id kfkamoejomjdihipgdkmfjcdenlhgnpd
```

然后立即打开 `chrome://extensions`，确认“划译”当前加载路径仍是本次构建的
`apps/extension/dist`，点击刷新，并确认 Chrome 显示版本 `0.4.0`。重新加载测试页后，检查一个
未收藏单词和一个已存在单词；文本/类型化板块只属于预览，最终必须收到完整 `result`，不适用
的词汇板块不应留下空标题。

默认门禁不会执行真实模型、网络、钥匙串、安装或 Chrome 操作。只有用户另行明确批准真实
Codex 与额度使用后，才运行：

```bash
pnpm smoke:codex
```

升级命令保持以下路径不变：

- `~/Library/Application Support/Huayi/native-host/`
- `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.huayi.codex_bridge.json`

它也不读取、覆盖或删除钥匙串 service `com.huayi.codex_bridge.eudic`、account
`authorization`。升级不要运行 `pnpm host:uninstall`、`pnpm host:eudic:remove` 或任何
`security delete-generic-password` 命令。

## 从 v0.4.0 回滚到 v0.3.1

已确认的 v0.3.1 发布提交是 `3795c5d`。先提交或另行保存本地改动，暂停使用扩展，然后在当前
源码目录运行以下精确命令，使构建路径和扩展 ID 保持不变：

```bash
git switch --detach 3795c5d
pnpm install
pnpm build
pnpm host:install -- --extension-id kfkamoejomjdihipgdkmfjcdenlhgnpd
```

打开 `chrome://extensions`，确认加载路径仍为当前目录的 `apps/extension/dist`，点击刷新并确认
版本为 `0.3.1`。v0.3.1 使用 wire v1，因此 Extension 与 Host 必须一起回滚，不能只恢复一端。
回滚同样禁止先卸载或移除欧路授权，并保持上述两条安装路径及同一个钥匙串 service/account。

需要返回刚才的 v0.4.0 分支时，在当前目录运行：

```bash
git switch -
pnpm install
pnpm build
pnpm host:install -- --extension-id kfkamoejomjdihipgdkmfjcdenlhgnpd
```

随后再次在 `chrome://extensions` 刷新并确认版本 `0.4.0`。

## 从 v0.4.0 升级到 v0.5.0

v0.5.0 将 Native Messaging 协议提升为 `schemaVersion: 3` 并拒绝 v2。升级期间暂停使用扩展，
同步替换 Extension 和 Host；Chrome 权限仍严格为 `nativeMessaging`，没有
`host_permissions`。在 v0.5.0 源码根目录依次运行：

```bash
pnpm build
pnpm host:install -- --extension-id kfkamoejomjdihipgdkmfjcdenlhgnpd
pnpm host:openai:configure
pnpm host:provider:set -- api
pnpm host:provider:status
```

构建完成后打开 `chrome://extensions`，确认加载目录是当前
`apps/extension/dist`，点击刷新并确认版本 `0.5.0`。只有
`pnpm host:openai:configure` 会调用 `/usr/bin/security` 并打开系统隐藏输入提示，把 Key 写入
钥匙串；`pnpm host:provider:set -- api` 只写入 Provider 配置，
`pnpm host:provider:status` 只读取 Provider 配置并应输出 `openai-responses`，后两条命令都不会
读取钥匙串或 API Key。安装和升级本身也不读取或覆盖现有 OpenAI/欧路钥匙串项，不自动改变
有效 Provider 配置。

只有用户另行批准真实调用和费用后，才运行 `pnpm smoke:codex` 或
`pnpm smoke:compare`。若 API 速度、质量或费用不可接受，无需重装，立即回滚 Provider：

```bash
pnpm host:provider:set -- codex
pnpm host:provider:status
```

回滚输出应为 `codex`。该操作保留 OpenAI Key，便于以后再次测试；只有用户明确要求删除时才
运行 `pnpm host:openai:remove`。若要回滚整个 v0.5.0 发布，则必须把 v0.4.0 Extension 与 Host
一起构建、安装并刷新，不能把 wire v2 与 v3 端点混用。

## 从 v0.5.0 升级到 v0.6.0 并启用 Compatible Provider

v0.6.0 将 Native Messaging 协议提升为 `schemaVersion: 4` 并拒绝 v3。Extension 与 Host 必须
同步升级；Chrome 权限仍严格为 `nativeMessaging` 且没有 `host_permissions`。使用以下精确顺序：

```bash
pnpm build
pnpm host:install -- --extension-id kfkamoejomjdihipgdkmfjcdenlhgnpd \
  --codex-path /Applications/ChatGPT.app/Contents/Resources/codex
pnpm host:compatible:key:configure
pnpm host:compatible:config:set -- \
  --base-url http://101.133.153.118:9090/v1 \
  --model gpt-5.4-mini \
  --effort low \
  --allow-insecure-http
pnpm host:compatible:config:status
pnpm smoke:compatible
pnpm host:provider:set -- compatible-http
```

构建完成后打开 `chrome://extensions`，确认加载目录是当前 `apps/extension/dist`，点击刷新并确认
版本 `0.6.0`。`pnpm smoke:compatible` 和最后的 Provider 切换必须分别由用户明确执行；smoke
不会修改当前 Provider，也不会自动切换。只有 smoke 通过且用户再次接受明文 HTTP 风险时才
切换。

若第三方速度、质量、安全性或稳定性不可接受，一条命令回滚后续请求到 Codex：

```bash
pnpm host:provider:set -- codex
```

回滚不删除第三方 Key、Compatible 配置或官方 OpenAI Key。v0.6.0 的安装、配置、smoke 和切换
不会读取、复制、删除或修改 `~/.codex`、Codex 登录/session、官方 OpenAI 钥匙串项或欧路
钥匙串项。若要回滚整个发布，必须同步构建、安装并刷新 v0.5.0 Extension 与 Host，不能混用
wire v3 与 v4。

## 人工验收

普通验收选择一个单词、短语、单句和多句段落，确认先显示经过校验的预览、后显示完整卡片；
最终校验失败时预览必须标记“内容未完整生成”。单词分别验证“已加入生词本”和可添加两种
状态；自动查询不得上传句子，只有点击添加才发送原始单词和所在英文句子。

真实欧路验收需要用户已配置钥匙串：添加未收藏单词后检查语境，再次选择同词应显示已存在，
且不得覆盖原分组、星级或已有语境。自动测试不会访问真实欧路。

## 卸载

```bash
pnpm host:uninstall -- --dry-run
pnpm host:uninstall
```

完整卸载严格先删除 service `com.huayi.codex_bridge.eudic` / account `authorization` 的精确
欧路项，再删除 service `com.huayi.codex_bridge.openai` / account `api-key` 的精确官方 OpenAI
项，最后删除经过所有权验证的 Huayi Host、Compatible 配置与清单。任一自动凭据删除失败时
Host 文件都会保留以便重试。卸载不会自动删除
`com.huayi.codex_bridge.compatible_http` / `api-key`；完整清理前先显式运行
`pnpm host:compatible:key:remove`。卸载不会删除 Chrome 父目录、其他 Native Messaging 清单或
上述精确项之外的钥匙串项。若只想升级或重装，请重复执行安装命令，不要先卸载，这样所有
钥匙串项都会保留。
