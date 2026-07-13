# 划译

“划译”是一款面向 macOS Google Chrome 的个人划词翻译与英文解析扩展。它通过 Chrome
Native Messaging 调用本机已登录的 Codex CLI，不在扩展中保存 OpenAI API Key。

## ChatGPT Plus / Codex 使用边界

Native Host 通过 Codex App Server 复用本机现有的 ChatGPT 登录，因此不需要另购 OpenAI
API Key，但仍受当前 ChatGPT/Codex 账户额度、频率和网络限制。这不是“用 Plus 抵扣 API
费用”；ChatGPT 订阅与 OpenAI API 计费彼此独立。若未来发布商店版或增加云端 provider，
必须另外实现服务端鉴权、密钥管理、限流与成本控制。

## v0.4.0 能力

- 双击或拖选英文后显示“解释”和“翻译”工具条。
- 单词/短语翻译和解释、单句翻译和解析、多句段落翻译继续返回严格结构化结果。
- 有效选区出现后会异步预热 App Server；预热只含请求 ID，不含选区、上下文、句子、URL 或
  其他网页数据，不创建 thread/turn，也不产生或消费模型输出。
- 模型只生成 provider 私有内容；可信 Host 注入原始 `sourceText`、`selectionKind` 和公共结果
  `type`，再执行最终公共协议校验。
- 文本增量和已校验结构化板块会渐进展示，但都只是预览；只有终态 `result` 表示完整成功。
  不适用的音标、原形、构词、搭配、例句、相似词或同义词会隐藏，不用虚构值回填。
- 单词分析期间并行查询欧路生词本；已存在的单词在加载或结果阶段显示“已加入生词本”。
- 查询不存在或被动查询失败时，完整结果仍可显式加入；写入继续先 GET 防重复，再按需 POST。
- 自动查询只向欧路发送原始单词；只有用户点击添加时才发送原始词形和所在英文句子。
- App Server 按需启动并复用进程，但每次分析使用独立的 ephemeral thread；模型固定为
  `gpt-5.4-mini`，推理强度固定为 `low`。

欧路授权保存在 macOS 钥匙串，不进入扩展配置、仓库、Native Messaging 或日志。授权获取及
接口说明见[欧路 OpenAPI 开发指南](https://my.eudic.net/OpenAPI/Doc_Index)。

## App Server 安全边界

App Server 不提供 `codex exec` 的 ignore-user-config / ignore-rules 参数。划译不会伪造这些
开关，而是使用严格配置、显式禁用功能、专用空工作目录、固定模型/provider、只读无网络
沙箱和 `never` 审批。每次 App Server 进程启动前，Host 使用不调用模型的
`codex mcp list --json` 发现直接配置的 MCP Server，校验名称并为每个已启用 Server 追加独立
禁用覆盖；启动后只接受专用空目录的空 Hook 记录，以及断开连接且没有工具、资源或模板的
MCP 状态记录。任何发现失败、审批、Shell、文件修改、Web、应用、活动 Hook/MCP 或其他工具
事件都会失败关闭。

Host 的 provider 校验 stderr 只允许输出有界的安全阶段和字段名，包括 `stream-parse`、
`model-json`、`model-schema`、`result-assembly` 和 `protocol-validation`。启动与协议诊断只用
固定安全消息；任何 stderr 都不得包含网页内容、模型内容、原始 JSON、Codex 认证、欧路授权
或环境变量值。stdout 仍只承载 Native Messaging 帧。

## v0.4.0 升级边界

v0.4.0 继续使用 `schemaVersion: 2`，但 v2 与 v1 不兼容，运行时直接拒绝 v1。Extension 与
Native Host 必须同步升级或回滚；当前个人扩展 ID 固定为
`kfkamoejomjdihipgdkmfjcdenlhgnpd`。精确升级、回滚、Chrome 刷新和 Host 重装命令见
[macOS 安装说明](docs/setup-macos.md)。重装保持既有 Huayi 安装路径，以及钥匙串 service
`com.huayi.codex_bridge.eudic`、account `authorization`，无需重新配置欧路授权。

## 当前范围

v0.4.0 只支持 macOS、Google Chrome 和普通 `http/https` 顶层网页，不支持 PDF、Chrome
内部页面、iframe、编辑器区域、其他操作系统、云端 API、历史记录、同步或后续对话。
Manifest 权限严格保持为 `nativeMessaging`。

## 开发入口

环境要求：Node.js 18+、pnpm、已通过 ChatGPT 登录且支持 App Server 的 Codex CLI。

```bash
pnpm install
pnpm check:instructions
pnpm build
pnpm test
pnpm test:e2e
pnpm host:install -- --extension-id <ID> --dry-run
```

默认测试全部使用 fake App Server、fake Keychain 和 fake fetch，不访问 OpenAI、真实 Codex、
欧路或钥匙串。`pnpm smoke:codex` 会调用真实模型并消耗订阅额度，只能在用户明确批准后单独
执行；真实安装、Chrome 刷新和欧路验收也不属于默认门禁。

完整安装与升级步骤见 [macOS 安装说明](docs/setup-macos.md)，工程边界见
[架构文档](docs/architecture.md)。
