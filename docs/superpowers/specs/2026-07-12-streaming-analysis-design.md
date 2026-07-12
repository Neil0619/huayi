# 划译流式分析与生词状态设计（v0.3.0）

## 目标与范围

v0.3.0 将现有等待 Codex 完整退出后一次性展示结果的流程改为真实文本增量展示，同时保持
最终结构化结果的严格校验。单词分析还会并行查询欧路生词本状态，查询不得阻塞 Codex
输出或覆盖翻译、解释结果。

本版本继续使用 `gpt-5.4-mini` 和 `low` reasoning effort，不增加 Chrome 权限、云端 API
密钥、历史记录、设置页或后续对话。欧路按钮移动到卡片右上角、关闭按钮左侧。

## 方案选择

采用长驻、按需启动的 Codex App Server，而不是继续解析 `codex exec` 的最终 stdout。
App Server 的 `item/agentMessage/delta` 提供文本增量，`turn/start.outputSchema` 继续约束最终
JSON，`thread/start.ephemeral` 确保请求不写入 Codex 会话历史。

不采用以下方案：

- `codex exec --json`：事件流不能为当前结构化最终消息提供稳定的字段级文本增量。
- 每个请求启动一个 App Server：仍会重复支付进程初始化成本。
- 直接把原始 JSON 片段显示在浮层：会泄漏结构字符，也无法保证字段边界和安全渲染。
- 等分析结束后再查询欧路：不能利用生成时间隐藏查询延迟。

## 总体数据流

```text
Content Script
  |-- analyze ---------------------------------------------|
  |                                                        v
  |  Service Worker -> Native Messaging -> Native Host -> Codex App Server
  |       ^                                  |                    |
  |       |                                  |<-- JSON-RPC delta--|
  |       |<------------- analysis-delta ----|
  |       |<------------- result/error ------|
  |
  `-- check-word（仅单词）-> Native Host -> Keychain -> Eudic GET
          ^                                  |
          `--------------- word-status ------|
```

分析与查询是同一浮层会话中的两个独立请求。Native Host 仍执行全局最多两个任务，调度时先
提交分析任务，再提交状态查询；欧路操作继续串行、最多一个。状态查询不参与 Codex 线程，
也不改变分析终态。

## Codex App Server 生命周期

Native Host 第一次收到分析请求时启动一个 stdio App Server，并完成 `initialize` 握手。
后续请求复用该进程，但每个分析创建独立的 ephemeral thread 和 turn。Host 关闭、Native
Messaging 输入结束或协议失败时终止子进程；子进程意外退出会使当前分析失败，下一次请求
重新启动，不自动重试模型调用。

每个 thread/turn 固定使用：

- `gpt-5.4-mini`、`low` effort 和 60 秒超时。
- 专用空工作目录、只读 sandbox、`approvalPolicy: "never"`。
- 不注册动态工具或额外技能根，清空 MCP 配置，禁用 shell、Web Search、应用和其他工具。
- 当前结果类型对应的 JSON Schema，以及只分析输入文本的固定提示。
- `ephemeral: true`，不恢复、不复用、不持久化分析 thread。

App Server 只继承现有环境允许列表。它可以自行使用用户已登录的 Codex 身份，但 Huayi
不读取、复制或解析登录文件。启动参数、初始化响应或能力探测不满足上述约束时按
`CODEX_CAPABILITY_MISSING` 失败关闭，禁止降级到权限更宽的配置。

App Server 当前不提供 `codex exec` 的 `--ignore-user-config` 和 `--ignore-rules` 参数。因此
v0.3.0 必须以显式允许列表覆盖所有会影响模型、指令、工具、MCP、应用、Hook、sandbox、审批
和历史的用户配置，并通过空工作目录隔离仓库规则。实现时同步更新 Host 指令和安全文档，
不得伪造不存在的 CLI 参数；若当前 Codex 版本无法证明这些覆盖生效，则能力探测失败，不能
启动分析。

Host 自身 stdout 仍只允许 Native Messaging 二进制帧。App Server stdout 由 Host 内部
JSON-RPC 解析器消费，stderr 有独立大小上限，任何内容都不能透传到扩展。

## 流式结果与最终校验

公共协议在 `schemaVersion: 1` 中兼容增加 `analysis-delta`：

```ts
interface AnalysisDeltaEvent {
  type: "analysis-delta";
  schemaVersion: 1;
  requestId: string;
  sequence: number;
  section: "contextual-meaning" | "translation" | "main-structure" | "context-role";
  delta: string;
}
```

`sequence` 必须是非负安全整数，单个 `delta` 限制为 1–4,096 字符，单次分析累计 assistant
输出继续限制为 1 MiB。所有对象使用严格 Schema 并拒绝未知字段。

可流式展示的核心字段固定为：

- 词汇翻译、词汇解释：`contextualMeaningZh`。
- 句子和段落翻译：`translationZh`。
- 句子解释：`mainStructure`、`translationZh`、`contextRole`。

Host 对 assistant JSON 增量使用有界增量解析器，只提取允许的顶层字符串字段，并正确处理
转义符、跨 chunk 字符和不完整 Unicode 转义。JSON Schema 将核心字段排在前面以优化首屏
速度，但正确性不能依赖属性顺序。原始 JSON、未知字段、数组半成品和推理文本均不发送给
扩展。

每个请求的 `sequence` 从 0 单调递增。Service Worker 和 Content Script 都拒绝重复、倒序、
终态后的增量及不属于当前浮层会话的事件。Content Script 以约 40–50 ms 批量刷新 DOM，
所有模型文本只通过 `textContent` 渲染。

`turn/completed` 后，Host 必须解析完整 assistant 文本，并继续通过现有
`analysisResultSchema`、结果类型、`selectionKind` 和 `sourceText` 一致性校验。校验成功发送
现有 `result`，浮层用完整卡片替换流式预览；校验失败发送 `INVALID_RESPONSE`。收到终态后
不再接受任何增量。

若流式过程中失败，已显示的文本保留为只读预览，并在其下显示错误和重试操作；不能把部分
文本伪装成完整结果。重试创建新的请求 ID、清空旧预览并重新开始。

## 浮层状态

分析状态扩展为：

```text
actions -> loading -> streaming -> result
                     |             |
                     `-> error <---`
```

第一个有效 `analysis-delta` 将 `loading` 转为 `streaming`。最终 `result` 仍是唯一完整成功态。
拖动位置、滚动位置和焦点继续由浮层状态统一管理；最终卡片替换预览时保留合理滚动位置，
但不会让用户停留在超出新内容范围的位置。

生词状态与分析状态正交，统一放入 `overlay-state.ts`：

```ts
type WordbookAvailability = "not-applicable" | "checking" | "absent" | "present" | "unknown";

type WordbookMutation =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "success" }
  | { status: "error"; error: AnalysisError };
```

只有原始 `selectionKind === "word"` 时启动状态查询。短语、句子和段落保持
`not-applicable`。

## 欧路状态查询与按钮规则

公共协议增加严格消息：

```ts
interface CheckWordRequest {
  type: "check-word";
  schemaVersion: 1;
  requestId: string;
  language: "en";
  word: string;
}

interface WordStatusEvent {
  type: "word-status";
  schemaVersion: 1;
  requestId: string;
  presence: "present" | "absent";
}
```

查询复用固定欧路端点、钥匙串授权、10 秒超时、64 KiB 响应上限和现有错误映射。请求只含
原始选中词形，不含句子。`WordbookProvider` 增加只读的 `checkWord` 能力；`addWord` 仍在写入
前自行 GET，不能因为预查询结果而跳过防重复检查。

按钮展示规则固定为：

| 分析阶段                    | 查询状态                          | 右上角展示               |
| --------------------------- | --------------------------------- | ------------------------ |
| 未完成（loading/streaming） | `checking` / `absent` / `unknown` | 不展示                   |
| 未完成（loading/streaming） | `present`                         | 不可点击的“已加入生词本” |
| 完整结果                    | `checking` / `absent` / `unknown` | “加入欧路生词本”         |
| 完整结果                    | `present`                         | 不可点击的“已加入生词本” |
| 任意适用阶段                | `saving`                          | 不可点击的“正在添加…”    |
| 任意适用阶段                | 添加成功或确认已存在              | 不可点击的“已加入生词本” |

因此，如果完整结果先到达，按钮会立即可用；后续查询返回 `present` 时在原位置替换为
“已加入生词本”，不隐藏、不产生明显布局跳动。被动查询失败只变为 `unknown`，不遮挡分析
结果，也不提前显示错误；用户显式点击添加时仍按现有规则展示未配置、授权、限流或网络
错误。

用户在预查询尚未结束时点击添加，Service Worker 取消该查询并启动 `add-word`。写入流程
仍先 GET：已存在直接成功，否则 POST 原始单词和预提取英文句子。进入 `saving` 后，任何
迟到的 `word-status` 都不能覆盖写入状态；`added` 与 `already-exists` 均收敛为
“已加入生词本”。

## 请求协调、取消与竞态

Service Worker 将单标签页的单一请求槽改为浮层会话下的请求集合，分别追踪：

- 一个 `analyze` 请求。
- 最多一个 `check-word` 请求。
- 最多一个 `add-word` 请求；启动时替代 `check-word`。

每种请求只接受匹配终态：分析接受 `result`，查询接受 `word-status`，添加接受
`word-added`；错误类型或终态不匹配时按 `INVALID_RESPONSE` 失败关闭该请求。新选区、关闭、
Escape、标签页销毁和超时会向所有仍在运行的关联请求发送定向 `cancel`。

取消分析映射为 App Server `turn/interrupt`。Host 等待相应 turn 结束或短暂宽限期后清理
映射；不能因一个 turn 取消而杀死其他并行 turn。App Server 失联时终止全部活动分析并丢弃
迟到通知。扩展以浮层会话 ID 和请求 ID 双重校验，旧事件不能重开或改写新浮层。

## 隐私与安全

- 自动查询欧路时只发送原始英文单词。
- 只有用户点击添加时才发送原始单词和所在英文句子。
- 不向欧路发送 URL、标题、段落上下文或任何模型输出。
- 网页文本、Codex 增量、最终结果和欧路响应始终视为不可信数据。
- 流式预览和最终卡片都禁止 `innerHTML`，不执行模型生成内容。
- App Server 不接触项目仓库，不启用工具，不创建持久 session。
- Manifest 权限继续严格为 `["nativeMessaging"]`，不新增网络或存储权限。

## 错误恢复

- App Server 未安装、版本过旧或缺少必需协议字段：`CODEX_CAPABILITY_MISSING`。
- App Server 崩溃或 JSON-RPC 污染：当前分析失败，清理进程，下一请求再启动。
- 模型超时或用户取消：中断对应 turn，不自动重试。
- 最终 Schema 无效：保留部分预览并明确标为未完成，返回 `INVALID_RESPONSE`。
- 欧路查询失败：分析继续，最终结果页乐观显示添加按钮。
- 欧路添加失败：只在按钮旁显示错误，不改变已完成的分析结果。

## 测试与验收

默认测试全部使用 fake App Server、fake Keychain 和 fake fetch，不访问 OpenAI 或欧路。
必须覆盖：

- App Server 握手、ephemeral thread、固定模型/effort、输出 Schema 和安全配置。
- JSON-RPC 拆包、合包、倒序/未知事件、输出上限、子进程退出和重启。
- 字符级 JSON 增量提取、转义、Unicode、字段边界及最终严格校验。
- 四类结果的首个增量、批量渲染、最终替换、部分失败和重试。
- 单词分析与 `check-word` 并行，非单词不查询。
- 查询先返回、结果先返回、查询失败、添加与查询竞态以及迟到事件。
- “已加入生词本”在流式期间出现，以及完整结果后从添加按钮原位替换。
- 新选区、关闭、Escape、超时和 App Server 崩溃能取消正确请求。
- Manifest 权限仍严格等于 `["nativeMessaging"]`，模型文本无法注入 HTML。

真实验收使用 `investigation`、`sustained heatwave`、示例整句和多句段落，记录首个可见文本
时间与完整结果时间。单词分别验证欧路已存在和不存在两种路径，并确认自动查询不上传句子。
`verify-ephemeral-session.mjs` 必须继续确认测试前后没有新增划译 session。

## 版本与升级

根包、三个 workspace 包、扩展 Manifest 和 Native Host 同步升级到 `0.3.0`，协议继续使用
`schemaVersion: 1`。升级时重新构建扩展、在 Chrome 刷新扩展并重新安装 Native Host；现有
欧路钥匙串授权保持不变。
