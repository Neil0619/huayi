# 架构说明

## 系统边界

```text
网页选区
  -> Content Script（选区、上下文、Shadow DOM 浮层）
  -> MV3 Service Worker（分析/查词/加词三通道、取消、Native Messaging）
  -> 本机 Node Host（严格协议、全局并发与超时）
       |-> AnalysisProvider -> Codex App Server -> ephemeral thread/turn
       `-> WordbookProvider -> macOS Keychain -> 欧路 OpenAPI
```

依赖方向固定为 `extension -> protocol <- native-host`。共享协议不感知 Chrome、Node、Codex
或欧路；新的模型、新浏览器、新生词本和新操作系统必须分别位于现有边界后面。

## 扩展与请求协调

Content Script 读取英文选区、最多 2,000 字符的模型上下文，以及单词所在的完整英文句子。
它只通过 `textContent` 渲染模型增量和最终结果，不保存 URL、标题、查询或结果。

单个浮层会话分别追踪分析、自动查词和显式加词三个请求通道。单词分析先提交 `analyze`，
随后并行提交只含原始单词的 `check-word`；短语、句子和段落不查词。用户显式添加时只取消
尚未完成的查词并发送 `add-word`，分析结果不受影响。新选区、关闭、Escape 和标签页销毁会
取消该会话中所有未完成请求。

Service Worker 按 `requestId` 和通道匹配事件：分析只接受有序 `analysis-delta` 和最终
`result`，查词只接受 `word-status`，加词只接受 `word-added`。成功终态、序号或请求 ID 不
匹配时失败关闭；已取消或已结束请求的迟到事件被丢弃。请求状态只存在内存，不写入 storage。

## Native Host 与并发

Native Host 解码 Native Messaging 帧并通过 `@huayi/protocol` 校验所有输入和输出。全局最多
运行两个任务，因此分析与自动查词可以并行；所有欧路请求在此基础上额外串行、最多一个。
分析超时为 60 秒，欧路操作超时为 10 秒。Host stdout 只允许长度前缀协议帧，诊断只写
stderr。

## Codex App Server 生命周期

第一次分析时，Host 先在专用空目录执行不调用模型的 `codex mcp list --json`，使用与正式
App Server 相同的功能禁用项发现用户直接配置的 MCP Server。Host 校验记录数量、名称和结构，
再为每个已启用 Server 生成独立的 `mcp_servers.<name>.enabled=false` 覆盖，随后才以 stdio
创建 App Server 并完成 `initialize`。后续分析复用进程，但每次都创建新的 ephemeral thread
和独立 turn；Host 不恢复或复用分析 thread。Host 退出、输入结束或协议污染时关闭进程；
App Server 意外退出会终止当前活动分析，下一请求在重新发现 MCP 后再惰性启动，不自动重试
模型调用。发现结果不跨进程重启缓存。

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

Provider 为四类结果选择独立 JSON Schema，并将 Schema 传给 `turn/start.outputSchema`。
`item/agentMessage/delta` 的 assistant JSON 先经过有界增量解析器，仅提取以下顶层字符串：

- 词汇翻译/解释：`contextualMeaningZh`；
- 句子/段落翻译：`translationZh`；
- 句子解释：`mainStructure`、`translationZh`、`contextRole`。

Host 为提取出的文本生成从 0 开始的 `analysis-delta.sequence`。原始 JSON、推理内容、未知字段
和数组半成品不会发送给扩展。`turn/completed` 后仍解析完整 assistant 文本，并依次校验 JSON
Schema、公共 `analysisResultSchema`、结果类型、`selectionKind` 和 `sourceText`；只有全部匹配
才发送最终 `result`。因此流式预览是中间状态，不能替代完整成功态。

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
未知内容不会被认领或覆盖。

- 新模型 provider 实现 `AnalysisProvider`。
- 新生词本实现 `WordbookProvider`。
- 新浏览器创建新的 `apps/<browser>` 并复用公共协议。
- 新操作系统增加 `apps/native-host/src/install/` 下的 installer。

## 生产依赖决策

`@huayi/protocol` 使用 Zod 保护网页、扩展、Native Messaging 和模型边界。手写守卫容易在四类
结果和多种事件间漂移，仅依赖 TypeScript 又无法保护运行时，因此保留 Zod 严格 Schema。

Native Host 使用现有 Vite 开发依赖打包 Host、协议和 Zod，并复制输出 Schema，使安装目录
不依赖仓库 `node_modules`。欧路客户端使用 Node.js 18 内置 `fetch`；固定端点、拒绝重定向、
限制响应体且不自动重试，因此没有新增生产依赖。
