# 安全与隐私

## 数据最小化

扩展只发送英文选区和所在语义块中围绕选区的最多 2,000 个字符，不发送 URL、标题、整页
内容、浏览历史或用户身份数据，也不持久化查询、结果或分析数据。

`warmup` 只包含类型、`schemaVersion: 2` 和随机请求 ID，不包含选区、上下文、句子、URL、标题
或其他页面数据。它只完成 MCP 发现和 App Server 安全初始化，不创建 thread/turn，不产生或
消费模型输出。

单词分析会自动发送 `check-word`，其中只有原始单词和固定语言 `en`。只有用户在完整结果上
点击“加入欧路生词本”时，扩展才发送 `add-word`，其中包含原始单词和预先提取的完整英文
句子。两条路径都不发送 URL、标题、段落上下文或模型输出。

## 浏览器边界

Manifest 权限严格为 `["nativeMessaging"]`；普通 `http/https` 范围只存在于静态 Content
Script 的 `matches`。扩展不声明 `host_permissions`、`storage`、`tabs`、`activeTab` 或
`scripting`。Content Script 不能直接调用 Native Messaging，只能向 Service Worker 发送
经过严格解析的内部命令。

网页输入、模型增量、类型化板块和最终结果都视为不可信。流式预览与最终卡片只用
`textContent`，禁止 `innerHTML` 和远程托管代码。只有终态 `result` 是完整成功；空词汇内容
不渲染标题、分隔或占位，也不伪造补全。关闭、新选区和 Escape 会按请求 ID 取消活动通道；
迟到事件不能重新打开或改写新浮层。

## 欧路授权与网络

授权固定存入 macOS 钥匙串：

```text
service: com.huayi.codex_bridge.eudic
account: authorization
label: Huayi Eudic OpenAPI Authorization
```

Host 每次欧路请求都重新读取授权，不长期缓存。读取使用固定 `/usr/bin/security`、参数数组和
`shell: false`，最长 5 秒；只接受 1–4,096 字符且无首尾空白、换行、NUL 或控制字符的完整
Authorization Header 值。

`host:eudic:configure` 使用 `add-generic-password -U`，把无参数的 `-w` 放在最后，由
`security` 隐藏读取。命令不使用 `-A`，也不通过参数、环境变量、文件、扩展消息或日志接收
授权。Token 不进入 Native Messaging、错误、快照或测试输出。

欧路访问固定为 `https://api.frdic.com/api/open/v1/studylist/word` 的 GET/POST，禁止网页、
协议或环境覆盖 URL；拒绝重定向、Cookie 和自动重试。每次操作最长 10 秒，响应体最多
64 KiB，所有状态码、JSON 和响应流都经过限制和校验。自动查询失败不会覆盖分析结果；显式
写入失败只影响生词按钮。

默认测试只用 fake authorization reader、fake fetch 和 fake process runner，不读取真实
钥匙串或访问欧路。重新构建和重复安装 Host 会保留上述钥匙串项；只有显式
`host:eudic:remove` 或完整卸载删除它。

## OpenAI API Key

OpenAI API Key 固定存入另一个独立的 macOS 钥匙串项：

```text
service: com.huayi.codex_bridge.openai
account: api-key
label: Huayi OpenAI API Key
```

Host 每次 API 分析都通过固定 `/usr/bin/security` 和参数数组重新读取该精确项，不接受调用方
覆盖可执行文件，也不跨请求缓存 Key。读取最长 5 秒、输出最多 8 KiB；只移除一个命令产生的
末尾换行，并只接受 1–4,096 字符且无首尾空白、CR、LF、NUL 或控制字符的值。Key 不要求固定
前缀，也不得进入 Native Messaging、stdout、stderr、错误、快照或测试输出。

`host:openai:configure` 使用 `add-generic-password -U`，把无参数的 `-w` 放在最后，由
`security` 隐藏读取；不使用 `-A`，不通过参数、环境变量、文件、扩展消息或日志接收 Key。
显式 `host:openai:remove` 只查询并删除上述精确 service/account，缺失时幂等。默认测试注入
fake process runner 和 fake interactive runner，不执行真实钥匙串命令。

## Codex App Server 进程边界

Native Host 使用参数数组、stdin/stdout 和 `shell: false` 启动 Codex App Server。App Server
由无页面数据的 warmup 或第一次 analyze 按需启动并复用；并发路径共享同一个初始化 Promise。
Warmup 不调用 `thread/start` / `turn/start`，每次真实分析才创建新的 ephemeral thread，使用
专用空目录而非仓库。Host 不读、复制、解析或显示 `~/.codex/auth.json`；`codex login status`
只确认登录类型为 ChatGPT。

App Server 当前没有 ignore-user-config / ignore-rules 参数。划译不声称或伪造这些开关，而是
组合以下约束：

- `app-server --stdio --strict-config`，仅继承既有环境允许列表；
- 固定内置 `openai`、`gpt-5.4-mini`、`low` effort 和 60 秒分析超时；
- 专用空 cwd、`ephemeral: true`、空 `instructionSources`、只读无网络 sandbox、`never` 审批；
- 显式关闭历史、Web Search、环境继承、通知、遥测、应用默认项和 Hook 配置；
- 禁用 `apps`、`auth_elicitation`、`browser_use`、`browser_use_external`、
  `browser_use_full_cdp_access`、`computer_use`、`enable_mcp_apps`、`hooks`、
  `image_generation`、`in_app_browser`、`memories`、`multi_agent`、`plugins`、
  `remote_plugin`、`shell_snapshot`、`shell_tool`、`skill_mcp_dependency_install`、
  `tool_call_mcp_elicitation`、`tool_suggest`、`unified_exec` 和 `workspace_dependencies`；
- 每次创建 App Server 进程前，使用相同功能禁用项执行不调用模型的
  `codex mcp list --json`，只提取用户直接配置且已启用的 MCP Server；
- 对每个发现的 Server 追加独立的 `mcp_servers.<name>.enabled=false`，启动后再验证实际状态。

MCP 发现最多接受 128 条记录；每个名称必须唯一且匹配 `[A-Za-z0-9_-]{1,128}`。进程失败、
超时、输出超限、无效 JSON、重复名称、无效结构或超限记录都在创建 App Server 前失败关闭。
参数构建器在插入 dotted config key 前再次校验总数、名称和重复项，形成纵深防御。
`mcp_servers={}` 无法清除继承的用户直接 MCP，因此不再使用；当前 Codex CLI 的 strict config
也不接受 `tools.view_image=false`，该字段同样已移除。图片能力继续由受支持的功能禁用项、
只读无网络 sandbox 和事件拒绝共同封锁。

能力探测要求 App Server 支持 `--stdio`、`--strict-config`、`--disable` 和 `--config`，并确认
所有禁用功能实际为 false。初始化后，Hook 响应只能为空，或包含专用 cwd 且
`hooks` / `warnings` / `errors` 全空的记录；MCP 状态只能是 `serverInfo: null`、空 `tools`、
空 `resources` / `resourceTemplates` 且无分页游标的断开状态。任何活动能力、未知字段或未知
响应形状都会在 `thread/start` 前拒绝。`thread/start` 返回的 cwd、指令来源、
模型/provider/effort、ephemeral、审批和 sandbox 也必须精确匹配。无法证明约束生效时返回
`CODEX_CAPABILITY_MISSING`，不降级到更宽权限。

Host 不注册动态工具。任何 config warning、审批、用户输入、应用、Hook、MCP、命令执行、
文件修改、MCP/dynamic/collab tool、Web Search 或图片 item 都按不安全事件失败关闭。App Server
输出由内部有界 JSON-RPC 解析器消费，不能直接进入 Native Messaging stdout。

## 模型输入、增量与最终校验

网页文字只作为固定提示中的待分析数据。即使其中包含“忽略规则”“执行命令”等内容，也不能
改变 App Server 配置。Provider 私有 JSON Schema 只允许模型返回内容字段，不包含公共
`sourceText`、`selectionKind` 或结果 `type`。assistant JSON 增量经过有界解析器；只有核心
字符串增量和已经完整关闭、通过私有子 Schema 校验的结构化板块可以进入协议。原始 JSON、
未知字段、推理内容、半个对象、数组半成品和未校验值不会发送给扩展。

最终 assistant 内容先通过私有严格 Schema。Host 再从可信请求注入原始 `sourceText`、
`selectionKind` 和映射后的公共结果 `type`，并通过 `analysisResultSchema`；模型无法控制这些
元数据。任何无效 JSON、未知字段、越界输出、工具事件或组装失败都失败关闭。已验证预览可以
保留并标记“内容未完整生成”，但不能冒充完整成功结果。

Provider 内部诊断阶段固定为 `stream-parse`、`model-json`、`model-schema`、
`result-assembly` 和 `protocol-validation`；对应 stderr 只写有长度上限的阶段名和允许字段名。
其他启动与协议 stderr 使用固定安全消息。任何诊断都不得写入选区、上下文、模型值、原始
JSON、欧路授权、OpenAI API Key、Codex 认证、token 或环境数据；stdout 只写 Native
Messaging 帧。

## Ephemeral 边界与真实冒烟

ephemeral 的含义是分析 thread 不进入可恢复会话历史，不代表 Codex 进程绝不维护自身认证等
状态。`pnpm smoke:codex` 在运行前后只列举 `CODEX_HOME/sessions` 下的相对文件名，不读取
session 内容，更不会读取认证文件。它是唯一允许调用真实模型的仓库命令；默认测试全部使用
fake App Server。该命令只在用户明确批准真实模型和额度使用后单独执行。

## 外部写入

安装器只有在显式执行后才写入 Huayi 的用户级 Host 目录和 Chrome Native Messaging 清单。
dry-run 只读验证 Node、构建产物、App Server 能力、禁用功能、ChatGPT 登录和
`/usr/bin/security`，不调用模型、不读取欧路授权或 OpenAI API Key、不创建目录。正式安装
同样只验证 `security` 可执行，不读取或创建 OpenAI 钥匙串项。

v0.4.0 使用 `schemaVersion: 2` 并拒绝 v1，Extension 与 Host 必须使用扩展 ID
`kfkamoejomjdihipgdkmfjcdenlhgnpd` 同步重装或回滚。升级只替换带合法 Huayi 所有权标记的
bundle、Schema、空工作目录和 launcher，保持
`~/Library/Application Support/Huayi/native-host/`、Chrome Native Messaging 清单路径，以及
欧路 `com.huayi.codex_bridge.eudic` / `authorization` 和 OpenAI
`com.huayi.codex_bridge.openai` / `api-key` 两个钥匙串项不变。完整卸载严格先删除精确欧路项，
再删除精确 OpenAI 项，最后删除经过所有权验证的 Huayi 文件；任一凭据删除失败都会保留 Host
文件以便重试。它不会删除 Chrome 父目录、其他 Native Messaging 清单或这两个精确项之外的
钥匙串项。
