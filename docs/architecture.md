# 架构说明

## 系统边界

```text
网页选区
  -> Content Script（选区、上下文、Shadow DOM 浮层）
  -> MV3 Service Worker（无页面数据预热、分析/查词/加词三通道、取消、Native Messaging）
  -> 本机 Node Host（严格协议、全局并发与超时）
       |-> RoutingAnalysisProvider
       |     |-> Codex App Server -> ephemeral thread/turn
       |     `-> OpenAI Responses API -> strict SSE
       `-> WordbookProvider -> macOS Keychain -> 欧路 OpenAPI
```

依赖方向固定为 `extension -> protocol <- native-host`。共享协议不感知 Chrome、Node、Codex
或欧路；新的模型、新浏览器、新生词本和新操作系统必须分别位于现有边界后面。

## 扩展与请求协调

Content Script 读取英文选区、最多 2,000 字符的模型上下文，以及单词所在的完整英文句子。
它只通过 `textContent` 渲染模型增量和最终结果，不保存 URL、标题、查询或结果。

模型更新先进入按会话隔离的批处理器，由 `requestAnimationFrame` 每帧最多触发一次渲染；终态
到达时先同步排空待处理更新。结果正文按 `data-huayi-section` 复用稳定节点，累计数组只追加或
按最终可信值校正，不整卡替换，因此滚动、焦点、生词状态和拖动位置保持稳定。新节点只执行
一次约 120ms 的轻量动画，并遵守 `prefers-reduced-motion`。

首次进入有效选区的操作态后，Content Script 立即显示工具条，并异步发送只含类型、
`schemaVersion` 和随机 `requestId` 的 `warmup`。Warmup 不含选区、上下文、英文句子、URL、
标题或其他页面数据；它不属于某个浮层会话，关闭或新选区不会取消它。

单个浮层会话分别追踪分析、自动查词和显式加词三个请求通道。单词分析先提交 `analyze`，
随后并行提交只含原始单词的 `check-word`；短语、句子和段落不查词。用户显式添加时只取消
尚未完成的查词并发送 `add-word`，分析结果不受影响。新选区、关闭、Escape 和标签页销毁会
取消该会话中所有未完成请求。

Service Worker 按 `requestId` 和通道匹配事件：预热只接受 `warmup-ready`，分析接受共享连续
序号的 `analysis-delta` / `analysis-section` 和最终 `result`，查词只接受 `word-status`，加词
只接受 `word-added`。成功终态、序号或请求 ID 不匹配时失败关闭；已取消或已结束请求的迟到
事件被丢弃。请求状态只存在内存，不写入 storage。

## Native Host 与并发

Native Host 解码 Native Messaging 帧并通过 `@huayi/protocol` 校验所有输入和输出。全局最多
运行两个任务，因此分析与自动查词可以并行；所有欧路请求在此基础上额外串行、最多一个。
分析超时为 60 秒，欧路操作超时为 10 秒。Host stdout 只允许长度前缀协议帧，诊断只写
stderr。

## Provider 路由

Provider 配置固定为
`~/Library/Application Support/Huayi/native-host/provider.json`。文件缺失表示 Codex；存在时
必须是受 Huayi 所有权保护的普通文件、权限 `0600`，且只包含严格版本化配置。符号链接、未知
字段、未知 Provider、超限或无效 JSON 均失败关闭。安装升级保留有效配置，首次安装不创建
配置文件，因此不会因 Key 存在而自动启用 API。

每个 `analyze` 开始时路由器恰好读取一次配置，并把该请求固定到 `codex` 或
`openai-responses`。活动请求期间修改配置只影响下一个请求；任一 Provider 失败都不会自动迁移
或回退。Codex warmup 继续完成 App Server 初始化；API warmup 只验证本地配置读取能力，不读
Key、不发 HTTP。该严格 Host 控制边界可被未来设置页复用，但 v0.5.0 不增加浏览器配置消息、
权限或 UI。

## OpenAI Responses Provider

API Provider 每次分析从固定 macOS 钥匙串项读取 Key，然后只访问
`https://api.openai.com/v1/responses`。生产请求固定为 `gpt-5.6-luna`、推理强度 `none`、
`stream: true`、`store: false`、严格 JSON Schema，不声明工具、Web Search 或前序响应。端点、
模型、Prompt、Schema 和 Key 均不能由网页、扩展、环境或配置文件覆盖。

Responses SSE 解析器限制总字节数、单事件大小和停滞时间，要求 event/data 类型精确一致，且
只接受一个文本输出生命周期。拒答、工具、推理、重复/迟到事件、未知字段或未知终态失败关闭；
不自动重试。经过验证的文本与完整数组项复用同一 Provider 流式抽取、私有 Schema、Host 可信
元数据组装和公共协议校验链路，API 响应 ID、usage 与供应商元数据不会进入 wire。

## Codex App Server 生命周期

Warmup 或第一次分析会在专用空目录执行不调用模型的 `codex mcp list --json`，使用与正式 App
Server 相同的功能禁用项发现用户直接配置的 MCP Server。Host 校验记录数量、名称和结构，再
为每个已启用 Server 生成独立的 `mcp_servers.<name>.enabled=false` 覆盖，随后以 stdio 创建 App
Server 并完成 `initialize`、安全 Hook 与 MCP 状态校验。并发 warmup/analyze 共享同一个初始化
Promise，不会启动第二个 App Server。Warmup 到此结束，绝不调用 `thread/start` 或
`turn/start`，也不产生模型输出或消耗模型输出额度。

后续分析复用进程，但每次都创建新的 ephemeral thread 和独立 turn；Host 不恢复或复用分析
thread。预热失败不会改写尚未点击的浮层，后续 analyze 可以重试初始化。Host 退出、输入结束
或协议污染时关闭进程；App Server 意外退出会终止当前活动分析，下一请求在重新发现 MCP 后
再惰性启动，不自动重试模型调用。发现结果不跨进程重启缓存。

每个 thread/turn 固定使用 Codex 内置 `openai` provider、`gpt-5.4-mini`、`low` effort、专用
空工作目录、只读且无网络的 sandbox、`approvalPolicy: "never"` 和对应结果类型的 JSON
Schema。`thread/start` 返回后，Host 验证 cwd、空 `instructionSources`、模型/provider/effort、
ephemeral、审批及 sandbox 不变量；任一不匹配都映射为能力缺失，禁止宽松降级。

App Server 不提供 `codex exec` 的 ignore-user-config / ignore-rules 参数。划译改用
`--strict-config`、显式配置覆盖和功能禁用：关闭历史、Web Search、环境继承、通知、遥测、
应用、Hook、图片、浏览器、电脑操作、Shell、插件、记忆、多代理和相关工具入口；直接 MCP
则通过启动前发现和逐项禁用隔离。初始化后，`hooks/list` 可以为空，也可以只包含 cwd 等于
专用空目录且 `hooks`、`warnings`、`errors` 全空的记录；`mcpServerStatus/list` 可以保留已
禁用 Server 的状态记录，但必须没有连接信息、工具、资源、资源模板或分页游标。任何审批、
交互输入、应用、活动 Hook/MCP、命令执行、文件修改、动态工具、协作工具、Web Search 或图片
事件都会使 App Server 失败关闭。

Host 只向 App Server 传递既有环境允许列表。`HOME` 和 `CODEX_HOME` 仅供 Codex 自行使用
ChatGPT 登录；Host 不读取、复制或解析认证文件，也不把仓库目录作为 cwd。

## 增量与最终结果

Provider 为四类结果选择只描述模型内容的私有 JSON Schema，并将 Schema 传给
`turn/start.outputSchema`。这些 Schema 不含 `sourceText`、`selectionKind` 或公共结果
`type`，也不通过 `@huayi/protocol` 导出。`item/agentMessage/delta` 的 assistant JSON 先经过
有界增量解析器，提取以下顶层字符串和已完整关闭、已通过私有子 Schema 校验的结构化值：

- 词汇翻译/解释：`contextualMeaningZh`；
- 句子/段落翻译：`translationZh`；
- 句子解释：`mainStructure`、`translationZh`、`contextRole`。

Host 为文本增量和 `analysis-section` 生成同一个从 0 开始的连续序号。原始 JSON、推理内容、
未知字段、半个对象、数组半成品和未校验字段不会发送给扩展。`null` 或空数组表示不适用，
Host 不发送对应板块；UI 隐藏标题、分隔和占位，不用虚构值补齐。

`turn/completed` 后，Host 严格校验完整模型内容，再从可信请求注入原始 `sourceText`、
`selectionKind` 和映射后的公共结果 `type`，最后通过 `analysisResultSchema`。只有全部成功才发送
终态 `result`。文本增量和类型化板块都只是安全预览；最终校验失败时可保留已验证预览并标记
“内容未完整生成”，但不得把它当作完整成功。

Provider 内部失败阶段固定为 `stream-parse`、`model-json`、`model-schema`、
`result-assembly` 和 `protocol-validation`；对应 stderr 只输出这些有界阶段名和安全字段名。
其他启动与协议 stderr 使用固定安全消息。任何诊断都不得包含网页输入、模型值、原始 JSON、
凭据、认证文件或环境内容；stdout 仍只允许协议帧。

## 欧路生词本

自动 `check-word` 每次从固定 macOS 钥匙串项读取授权，只向固定 HTTPS 端点发送原始单词，
不发送句子、段落、URL、标题或模型输出。查询失败是被动状态：分析继续，完整结果保留可用的
添加按钮。

显式 `add-word` 才携带原始单词和预先提取的英文句子。Provider 写入前始终重新 GET；已存在
则返回 `already-exists`，不存在才 POST，不能用自动查询结果跳过防重复检查。安装与升级不会
读取、创建、覆盖或删除欧路钥匙串项。

## 安装与扩展方式

macOS 安装器把自包含 Host、四份 Schema、空工作目录和 launcher 放入 Huayi 专用用户目录。
Chrome 清单只允许安装时提供的扩展 ID。重复安装只升级带合法 Huayi 所有权标记的文件；
未知内容不会被认领或覆盖。v0.5.0 使用 wire v3 并拒绝 v2，因此 Extension 和 Host 必须使用
扩展 ID `kfkamoejomjdihipgdkmfjcdenlhgnpd` 同步升级或回滚。重复安装保持
`~/Library/Application Support/Huayi/native-host/`、Chrome Native Messaging 清单路径及
钥匙串 `com.huayi.codex_bridge.eudic` / `authorization`、
`com.huayi.codex_bridge.openai` / `api-key` 及有效 Provider 配置不变。

- 新模型 provider 实现 `AnalysisProvider`。
- 新生词本实现 `WordbookProvider`。
- 新浏览器创建新的 `apps/<browser>` 并复用公共协议。
- 新操作系统增加 `apps/native-host/src/install/` 下的 installer。

## 生产依赖决策

`@huayi/protocol` 使用 Zod 保护网页、扩展、Native Messaging 和模型边界。手写守卫容易在四类
结果和多种事件间漂移，仅依赖 TypeScript 又无法保护运行时，因此保留 Zod 严格 Schema。

Native Host 使用现有 Vite 开发依赖打包 Host、协议和 Zod，并复制输出 Schema，使安装目录
不依赖仓库 `node_modules`。欧路和 OpenAI 客户端都使用 Node.js 18 内置 `fetch`；固定端点、
拒绝重定向、限制响应体且不自动重试，因此没有新增生产依赖。
