# 安全与隐私

## 数据最小化

扩展只发送英文选区和所在语义块中围绕选区的最多 2,000 个字符，不发送 URL、标题、整页
内容、浏览历史或用户身份数据，也不持久化查询、结果或分析数据。

单词分析会自动发送 `check-word`，其中只有原始单词和固定语言 `en`。只有用户在完整结果上
点击“加入欧路生词本”时，扩展才发送 `add-word`，其中包含原始单词和预先提取的完整英文
句子。两条路径都不发送 URL、标题、段落上下文或模型输出。

## 浏览器边界

Manifest 权限严格为 `["nativeMessaging"]`；普通 `http/https` 范围只存在于静态 Content
Script 的 `matches`。扩展不声明 `host_permissions`、`storage`、`tabs`、`activeTab` 或
`scripting`。Content Script 不能直接调用 Native Messaging，只能向 Service Worker 发送
经过严格解析的内部命令。

网页输入、模型增量和最终结果都视为不可信。流式预览与最终卡片只用 `textContent`，禁止
`innerHTML` 和远程托管代码。关闭、新选区和 Escape 会按请求 ID 取消活动通道；迟到事件
不能重新打开或改写新浮层。

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

## Codex App Server 进程边界

Native Host 使用参数数组、stdin/stdout 和 `shell: false` 启动 Codex App Server。App Server
按需启动并复用，但每次分析创建新的 ephemeral thread，使用专用空目录而非仓库。Host 不读、
复制、解析或显示 `~/.codex/auth.json`；`codex login status` 只确认登录类型为 ChatGPT。

App Server 当前没有 ignore-user-config / ignore-rules 参数。划译不声称或伪造这些开关，而是
组合以下约束：

- `app-server --stdio --strict-config`，仅继承既有环境允许列表；
- 固定内置 `openai`、`gpt-5.4-mini`、`low` effort 和 60 秒分析超时；
- 专用空 cwd、`ephemeral: true`、空 `instructionSources`、只读无网络 sandbox、`never` 审批；
- 显式关闭历史、Web Search、环境继承、通知、遥测、应用默认项、Hook/MCP 表和图片查看；
- 禁用 `apps`、`hooks`、`image_generation`、`in_app_browser`、`memories`、`multi_agent`、
  `plugins`、`remote_plugin`、`shell_tool`、`unified_exec`、`shell_snapshot`、`tool_suggest`。

能力探测要求 App Server 支持 `--stdio`、`--strict-config`、`--disable` 和 `--config`，并确认
所有禁用功能实际为 false。初始化后 Host 验证 Hook/MCP 列表为空；`thread/start` 返回的 cwd、
指令来源、模型/provider/effort、ephemeral、审批和 sandbox 也必须精确匹配。无法证明约束
生效时返回 `CODEX_CAPABILITY_MISSING`，不降级到更宽权限。

Host 不注册动态工具。任何 config warning、审批、用户输入、应用、Hook、MCP、命令执行、
文件修改、MCP/dynamic/collab tool、Web Search 或图片 item 都按不安全事件失败关闭。App Server
输出由内部有界 JSON-RPC 解析器消费，不能直接进入 Native Messaging stdout。

## 模型输入、增量与最终校验

网页文字只作为固定提示中的待分析数据。即使其中包含“忽略规则”“执行命令”等内容，也不能
改变 App Server 配置。assistant JSON 增量经过有界字段提取器，只允许核心字符串字段进入
`analysis-delta`；原始 JSON、未知字段、推理内容和数组半成品不会发送给扩展。

最终 assistant 文本必须通过结果类型对应的 JSON Schema、公共 `analysisResultSchema`，并
匹配原请求的结果类型、`selectionKind` 与 `sourceText`。任何无效 JSON、未知字段、越界输出、
工具事件或请求不匹配都失败关闭。部分预览不能冒充完整成功结果。

## Ephemeral 边界与真实冒烟

ephemeral 的含义是分析 thread 不进入可恢复会话历史，不代表 Codex 进程绝不维护自身认证等
状态。`pnpm smoke:codex` 在运行前后只列举 `CODEX_HOME/sessions` 下的相对文件名，不读取
session 内容，更不会读取认证文件。它是唯一允许调用真实模型的仓库命令；默认测试全部使用
fake App Server。

## 外部写入

安装器只有在显式执行后才写入 Huayi 的用户级 Host 目录和 Chrome Native Messaging 清单。
dry-run 只读验证 Node、构建产物、App Server 能力、禁用功能、ChatGPT 登录和
`/usr/bin/security`，不调用模型、不读取欧路授权、不创建目录。

升级只替换带合法 Huayi 所有权标记的 bundle、Schema、空工作目录和 launcher，并保留欧路
钥匙串。完整卸载先删除精确钥匙串项，再删除经过所有权验证的 Huayi 文件；它不会删除 Chrome
父目录、其他 Native Messaging 清单或其他凭据。
