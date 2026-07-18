# 架构说明

## 系统边界

```text
网页选区
  -> Content Script（选区、上下文、Shadow DOM 浮层）
  -> MV3 Service Worker（无页面数据预热、分析/查词/加词三通道、取消、Native Messaging）
  -> 本机 Native Host（严格协议、全局并发与超时）
       |-> RoutingAnalysisProvider
       |     |-> Codex App Server -> ephemeral thread/turn
       |     |-> OpenAI Responses API -> strict official SSE
       |     |-> OpenAI-compatible HTTP -> strict measured-dialect SSE
       |     `-> DeepSeek Chat Completions -> strict data-only SSE
       `-> WordbookProvider -> 平台凭据 -> 欧路 OpenAPI
```

依赖方向固定为 `extension -> protocol <- native-host`。共享协议不感知 Chrome、Node、Codex
或欧路；新的模型、新浏览器、新生词本和新操作系统必须分别位于现有边界后面。

## 平台边界

macOS 保留完整 Provider 路由和欧路生词本。Windows 复用相同 Extension、协议、DeepSeek
客户端、模型 Schema、`EudicClient` 和 `EudicWordbookProvider`，但启动时进入
`windows-deepseek` 模式：不创建 Codex App Server 或 Provider 配置存储，health 固定报告
DeepSeek。欧路使用单独的 Windows DPAPI 授权读取器，不进入模型 Provider。

Windows Host 通过 Node Single Executable Application 打包为 `.exe`，运行目录固定在
`%LOCALAPPDATA%\Huayi\native-host`。安装器将 Native Messaging manifest 路径写入当前用户的
Chrome 注册表键；macOS 继续使用用户级 manifest 目录和启动脚本。两端都只允许安装时提供的
精确扩展 ID，Extension 和 Host 仍需同步升级。

## 扩展与请求协调

Content Script 读取英文选区、最多 2,000 字符的模型上下文，以及单词所在的完整英文句子。
它只通过 `textContent` 渲染模型增量和最终结果，不保存 URL、标题、查询或结果。

模型更新先进入按会话隔离的批处理器，由 `requestAnimationFrame` 每帧最多触发一次渲染；终态
到达时先同步排空待处理更新。结果正文按 `data-huayi-section` 复用稳定节点，累计数组只追加或
按最终可信值校正，不整卡替换，因此滚动、焦点、生词状态和拖动位置保持稳定。新节点只执行
一次约 120ms 的轻量动画，并遵守 `prefers-reduced-motion`。

v0.9.0 将视觉层拆为基础浮层样式和分析内容样式。单词源词与音标由稳定的
`huayi-lexeme-header` 承载；语境义是唯一使用强调底色的板块；常见释义、短语、词形、用法
和辨析由结构化 entry 节点呈现，不再把模型值压平成装饰性小卡片。加载及单词流式阶段通过
面板状态属性保留最小正文高度，最终内容仍使用既有键控 patch，不引入第二套渲染状态。

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

每个 `analyze` 开始时路由器恰好读取一次配置，并把该请求固定到 `codex`、
`openai-responses`、`openai-compatible-http` 或 `deepseek-chat-completions`。活动请求期间修改
配置只影响下一个请求；任一 Provider 失败都不会自动迁移或回退。Codex warmup 继续完成 App
Server 初始化；三个 HTTP API Provider 的 warmup 只验证本地路由能力，不读 Key、不发 HTTP。
该严格 Host 控制边界不向
网页或 Extension 暴露配置消息、权限或 UI。

## OpenAI Responses Provider

API Provider 每次分析从固定 macOS 钥匙串项读取 Key，然后只访问
`https://api.openai.com/v1/responses`。生产请求固定为 `gpt-5.6-luna`、推理强度 `none`、
`stream: true`、`store: false`、严格 JSON Schema，不声明工具、Web Search 或前序响应。端点、
模型、Prompt、Schema 和 Key 均不能由网页、扩展、环境或配置文件覆盖。

Responses SSE 解析器限制总字节数、单事件大小和停滞时间，要求 event/data 类型精确一致，且
只接受一个文本输出生命周期。拒答、工具、推理、重复/迟到事件、未知字段或未知终态失败关闭；
不自动重试。经过验证的文本与完整数组项复用同一 Provider 流式抽取、私有 Schema、Host 可信
元数据组装和公共协议校验链路，API 响应 ID、usage 与供应商元数据不会进入 wire。

## OpenAI-compatible HTTP Provider

Compatible Provider 的选择仍只写入 `provider.json`；端点、模型、effort 和明文风险确认单独
保存在 `~/Library/Application Support/Huayi/native-host/compatible-http.json`。该文件必须由
当前 UID 所有、权限精确为 `0600`，且只接受无凭据、query、fragment、尾随斜杠或
`/responses` 的绝对 HTTP base URL。`allowInsecureHttp` 必须为字面量 `true`，模型/effort 只
接受 `gpt-5.4-mini + low` 或 `gpt-5.6-luna + none`；Host 只追加固定 `/responses`。

第三方 Key 独立存于 `com.huayi.codex_bridge.compatible_http` / `api-key`，每个请求重新读取。
Compatible 路径禁止读取或修改 `~/.codex/config.toml`、`~/.codex/auth.json`、Codex
`model_providers`、登录/session、环境凭据、shell 配置或官方 OpenAI Key。配置 Key、配置端点、
真实 smoke 和选择 Provider 互相独立；smoke 不修改 `provider.json`。

Compatible 客户端只使用 POST、`redirect: "error"`、`credentials: "omit"`，不发送 Cookie、
不重试、不 fallback。它使用独立严格状态机，只接受实测的有界 `codex.rate_limits`、可选成对
reasoning、单 assistant message / output_text 和一致的 delta/done/completed 生命周期。实测
reasoning 固定占 `output_index=0`，assistant 固定占 `output_index=1`；无 reasoning 时 assistant
只能占 `0`。较完整的 `content_part.done` / assistant `output_item.done` 必须成对出现，早期省略
二者的方言仍可兼容，但不能只出现一个。

第三方会在 Responses envelope 中回显 Prompt、Schema、usage、缓存/服务配置，并在 reasoning
与 assistant item 中携带加密内容、`turn_id` 和 `phase`。Host 只接受实测字段、类型和安全值，
随后归一化为 ID、顺序和文本；这些私有字段不会进入日志、wire 或 Extension。请求模型仍固定
为 `gpt-5.4-mini`，当前端点在响应中自报 `gpt-5.4`，专用 parser 仅把它作为该实测方言的允许
别名。未知、重复、迟到、tool、refusal 或不一致事件全部失败关闭。Extension 只看到 wire v5
的统一预览和结果，不接触第三方 SSE、endpoint 或 Key。

## DeepSeek Chat Completions Provider

DeepSeek Provider 每次分析从固定钥匙串 `com.huayi.codex_bridge.deepseek` / `api-key` 读取 Key，
只访问 `https://api.deepseek.com/chat/completions`。请求固定使用 `deepseek-v4-flash`、
`stream: true`、`thinking: { type: "disabled" }`、JSON Output、`temperature: 0` 和
`max_tokens: 4096`。固定指令、精简 Schema 与合法示例位于 system message；网页选区、上下文和
可用英文句子只位于独立 user message，不能覆盖端点、模型或执行边界。

客户端只接受 data-only SSE、keep-alive 注释、一个 choice、固定响应 ID/模型生命周期、正常
`stop` 和最终 `[DONE]`。非空 reasoning、截断、缺失 `[DONE]`、未知字段、无效 JSON、超限或
最终 Schema 不匹配均失败关闭且不重试。每个 `delta.content` 复用现有增量字段抽取和 Host
可信元数据组装；终止 chunk 中符合官方 Schema 的 usage（含缓存 token 统计及有界的
`prompt_tokens_details.cached_tokens` / `completion_tokens_details.reasoning_tokens`）只校验后
丢弃，不进入日志或 wire。
因此 Extension 仍只接收统一 wire v5 预览与最终结果。DeepSeek 路径不读取、
修改或依赖 `~/.codex`，配置 Key、真实 smoke 与切换 Provider 是三个独立动作。

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

Provider 为六类结果选择只描述模型内容的私有 JSON Schema，并将 Schema 传给
`turn/start.outputSchema`。这些 Schema 不含 `sourceText`、`selectionKind` 或公共结果
`type`，也不通过 `@huayi/protocol` 导出。`item/agentMessage/delta` 的 assistant JSON 先经过
有界增量解析器，提取以下顶层字符串和已完整关闭、已通过私有子 Schema 校验的结构化值：

- 单词解释：`contextualAnalysisZh`；
- 短语翻译/解释：`contextualMeaningZh`；
- 句子/段落翻译：`translationZh`；
- 句子解释：`mainStructure`、`translationZh`、`contextRole`。

Host 为文本增量和 `analysis-section` 生成同一个从 0 开始的连续序号。原始 JSON、推理内容、
未知字段、半个对象、数组半成品和未校验字段不会发送给扩展。`null` 或空数组表示不适用，
Host 不发送对应板块；UI 隐藏标题、分隔和占位，不用虚构值补齐。

单词翻译字段按音标、语境义、常见释义、常用短语、易混词固定生成和展示。单词解释按语境
解析、词形、构词、用法要点、同义词辨析生成和展示。两者共享一次模型请求，但使用独立私有
Schema 和公共结果类型；短语继续走原 lexical 分支，句子和段落不变。

`turn/completed` 后，Host 严格校验完整模型内容，再从可信请求注入原始 `sourceText`、
`selectionKind` 和映射后的公共结果 `type`，最后通过 `analysisResultSchema`。只有全部成功才发送
终态 `result`。文本增量和类型化板块都只是安全预览；最终校验失败时可保留已验证预览并标记
“内容未完整生成”，但不得把它当作完整成功。

Provider 内部失败阶段固定为 `stream-parse`、`model-json`、`model-schema`、
`result-assembly` 和 `protocol-validation`；对应 stderr 只输出这些有界阶段名和安全字段名。
其他启动与协议 stderr 使用固定安全消息。任何诊断都不得包含网页输入、模型值、原始 JSON、
凭据、认证文件或环境内容；stdout 仍只允许协议帧。

## 欧路生词本

自动 `check-word` 每次从平台固定凭据读取授权（macOS Keychain 或 Windows DPAPI），只向固定
HTTPS 端点发送原始单词，不发送句子、段落、URL、标题或模型输出。查询失败是被动状态：
分析继续，完整结果保留可用的添加按钮。

显式 `add-word` 才携带原始单词和预先提取的英文句子。Provider 写入前始终重新 GET；已存在
则返回 `already-exists`，不存在才 POST，不能用自动查询结果跳过防重复检查。安装与升级不会
读取、创建、覆盖或删除欧路钥匙串项。

## 安装与扩展方式

macOS 安装器把自包含 Host、六份 Schema、空工作目录和 launcher 放入 Huayi 专用用户目录。
Chrome 清单只允许安装时提供的扩展 ID。重复安装只升级带合法 Huayi 所有权标记的文件；
未知内容不会被认领或覆盖。v0.10.0 继续使用 wire v5 并拒绝 v4，因此 Extension 和 Host 必须使用
扩展 ID `kfkamoejomjdihipgdkmfjcdenlhgnpd` 同步升级或回滚。重复安装保持
`~/Library/Application Support/Huayi/native-host/`、Chrome Native Messaging 清单路径及
钥匙串 `com.huayi.codex_bridge.eudic` / `authorization`、
`com.huayi.codex_bridge.openai` / `api-key`、
`com.huayi.codex_bridge.compatible_http` / `api-key`、
`com.huayi.codex_bridge.deepseek` / `api-key` 及有效的 Provider/Compatible 配置不变。

Windows 安装器复制 SEA `.exe`、六份 Schema 和两份固定 PowerShell helper，注册当前用户的
Chrome Native Messaging 键。Windows 不创建 Provider 配置文件，模型路由固定为 DeepSeek；
DeepSeek Key 与欧路授权由 `%LOCALAPPDATA%` 下相互独立的 DPAPI 保护文件承载。

- 新模型 provider 实现 `AnalysisProvider`。
- 新生词本实现 `WordbookProvider`。
- 新浏览器创建新的 `apps/<browser>` 并复用公共协议。
- 新操作系统增加 `apps/native-host/src/install/` 下的 installer。

## 生产依赖决策

`@huayi/protocol` 使用 Zod 保护网页、扩展、Native Messaging 和模型边界。手写守卫容易在四类
结果和多种事件间漂移，仅依赖 TypeScript 又无法保护运行时，因此保留 Zod 严格 Schema。

Native Host 使用现有 Vite 开发依赖打包 Host、协议和 Zod，并复制输出 Schema，使安装目录
不依赖仓库 `node_modules`。欧路、OpenAI 和 Compatible 客户端都使用 Node.js 18 内置
`fetch`；DeepSeek 客户端也复用该内置能力。受控端点、拒绝重定向、限制响应体且不自动重试，
因此没有新增生产依赖。
