# 划译

“划译”是一款面向 macOS Google Chrome 的个人划词翻译与英文解析扩展。它通过 Chrome
Native Messaging 调用本机 Host，默认使用已登录的 Codex CLI，也可由用户显式切换到 OpenAI
Responses API。OpenAI API Key 只保存在 macOS 钥匙串，不进入扩展。

## ChatGPT Plus / Codex 使用边界

Codex 模式通过 App Server 复用本机现有的 ChatGPT 登录，因此不需要 OpenAI API Key，但仍受
ChatGPT/Codex 账户额度、频率和网络限制。API 模式使用 OpenAI Platform API Key 并产生独立
费用；ChatGPT Plus/Codex 额度不能抵扣 OpenAI Platform API 账单。配置 Key 不会自动启用 API，
必须再执行显式 Provider 切换。

## v0.5.0 能力

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
- Codex App Server 按需启动并复用进程，但每次分析使用独立的 ephemeral thread；模型固定为
  `gpt-5.4-mini`，推理强度固定为 `low`。
- 可选 API Provider 固定调用 `https://api.openai.com/v1/responses`，使用
  `gpt-5.6-luna`、`reasoning.effort: none`、严格 JSON Schema、流式输出、`store: false`，且不
  启用工具或自动重试。
- 流式更新按 `requestAnimationFrame` 每帧最多渲染一次，并按 `data-huayi-section` 复用稳定
  DOM 节点；数组项逐条追加，已有节点不会因最终校正而整卡替换。

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

## API 模式的显式启用与回滚

v0.5.0 使用 `schemaVersion: 3` 并拒绝 v2。Extension 与 Native Host 必须同步升级或回滚；
当前个人扩展 ID 为 `kfkamoejomjdihipgdkmfjcdenlhgnpd`。构建并重装后，用隐藏提示配置 Key，
再显式切换：

```bash
pnpm build
pnpm host:install -- --extension-id kfkamoejomjdihipgdkmfjcdenlhgnpd
pnpm host:openai:configure
pnpm host:provider:set -- api
pnpm host:provider:status
```

`status` 应输出 `openai-responses`。需要停止 API 费用时执行
`pnpm host:provider:set -- codex`；只在明确要删除 Key 时执行
`pnpm host:openai:remove`。未来设置页只能复用现有严格 Host 配置边界，不能把 Key 或任意
endpoint/model 覆盖带进浏览器。

API 模式只向 OpenAI 发送当前英文选区、最多 2,000 字符上下文、可用的英文句子和固定分析
指令，不发送 URL、标题、历史记录、欧路授权或模型历史。钥匙串保护静态存储，但不能防御以
同一 macOS 登录用户权限运行的恶意进程。

## 当前范围

v0.5.0 只支持 macOS、Google Chrome 和普通 `http/https` 顶层网页，不支持 PDF、Chrome
内部页面、iframe、编辑器区域、其他操作系统、浏览器配置 UI、历史记录、同步或后续对话。
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
欧路或钥匙串。`pnpm smoke:codex` 和 `pnpm smoke:compare` 会调用真实模型并分别消耗订阅额度
及可能的 API 费用，只能在用户明确批准后单独执行；真实安装、Provider 切换、Chrome 刷新和
欧路验收也不属于默认门禁。

完整安装与升级步骤见 [macOS 安装说明](docs/setup-macos.md)，工程边界见
[架构文档](docs/architecture.md)。
