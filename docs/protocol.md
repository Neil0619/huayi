# 协议说明

当前协议版本为 `schemaVersion: 5`，所有消息均为严格的带 `type` 联合类型。v5 运行时直接
拒绝 v4 及更早消息，不提供跨版本转换层；Extension 与 Native Host 必须同步升级、重装或
回滚。

## 请求

- `health`：检查 Native Host 和当前显式 Provider 的就绪状态，不读取 API Key 或发送模型请求。
- `warmup`：只包含请求 ID，不包含网页数据或模型输入，用于预先完成当前 Provider 的本地
  初始化；Codex 模式执行能力发现和 App Server 安全初始化，API 模式只验证本地 Provider
  配置读取。它不属于 `HostWorkRequest`，
  不得读取 API Key、发送 HTTP、创建 thread/turn、产生模型输出或消费模型额度。
- `analyze`：包含请求 ID、动作、选区类型、英文选区、所在段落上下文、精确句子上下文和
  `zh-CN` 目标语言。
- `check-word`：只包含请求 ID、英语原始单词和固定语言 `en`，用于只读查询生词本状态。
- `add-word`：包含请求 ID、英语单词和所在完整英文句子，用于加入本机配置的生词本。
- `cancel`：按请求 ID 终止排队或运行中的任务。

`analyze` 的 `action` 只能是 `translate | explain`，`selectionKind` 只能是
`word | phrase | sentence | paragraph`。`selection` 和 `context` 各自最多 2,000 字符；段落与
`explain` 的组合会被协议直接拒绝。`sentenceContext` 是必填可空字段：单词和短语在可以安全
提取时传入 1–2,000 字符的完整英文句子，否则传 `null`；句子和段落请求必须传 `null`。非空
值必须包含英文字母且不能包含汉字。`requestId` 最多 64 字符，且只能包含字母、数字、点、
下划线、冒号和连字符。

预热请求示例：

```json
{
  "requestId": "warmup-1",
  "schemaVersion": 5,
  "type": "warmup"
}
```

`check-word` 和 `add-word` 的 `language` 均固定为 `en`；`word` 只能是由英文字母及内部连字符
或直/弯英文撇号构成的单词。自动执行的 `check-word` 只发送网页中的原始单词，不发送句子。
只有用户主动添加时，`add-word` 才额外发送 `context`；该字段必须包含英文、不能包含汉字，
长度为 1–2,000 字符。两种请求均不包含 URL、页面标题、段落上下文或模型输出。

只读查询示例：

```json
{
  "language": "en",
  "requestId": "check-1",
  "schemaVersion": 5,
  "type": "check-word",
  "word": "mother-in-law"
}
```

## 事件

- `health-result`：返回 Host 版本、模型 Provider、模型、Codex 版本和就绪状态。`provider` 只
  允许 `codex | openai-responses | openai-compatible-http | deepseek-chat-completions`；Codex
  必须返回非空 `codexVersion`，三个 HTTP Provider 必须返回 `codexVersion: null`。
- `warmup-ready`：确认无页面数据的预热已安全完成；它是 `warmup` 的唯一成功终态。
- `progress`：`queued` 或 `running`。
- `analysis-delta`：分析核心字段的增量文本；它是中间事件，不是成功终态。
- `analysis-section`：返回一个已经完整解析并严格校验的结构化分析板块；它是中间事件，
  不是成功终态。
- `result`：返回经过 Schema 校验的分析结果；它是分析唯一的完整成功终态。
- `word-status`：返回 `present | absent`，表示只读查询到单词已存在或不存在。
- `word-added`：返回 `added | already-exists`，分别表示新建成功或原记录已存在。
- `error`：返回固定错误码、中文用户提示和是否允许重试。

Codex 健康检查成功示例：

```json
{
  "codexVersion": "codex-cli 0.144.1",
  "hostVersion": "0.10.0",
  "model": "gpt-5.4-mini",
  "provider": "codex",
  "ready": true,
  "requestId": "health-codex",
  "schemaVersion": 5,
  "type": "health-result"
}
```

API Provider 健康检查成功示例：

```json
{
  "codexVersion": null,
  "hostVersion": "0.10.0",
  "model": "gpt-5.6-luna",
  "provider": "openai-responses",
  "ready": true,
  "requestId": "health-api",
  "schemaVersion": 5,
  "type": "health-result"
}
```

Compatible Provider 健康检查成功示例：

```json
{
  "codexVersion": null,
  "hostVersion": "0.10.0",
  "model": "gpt-5.4-mini",
  "provider": "openai-compatible-http",
  "ready": true,
  "requestId": "health-compatible",
  "schemaVersion": 5,
  "type": "health-result"
}
```

DeepSeek Provider 健康检查成功示例：

```json
{
  "codexVersion": null,
  "hostVersion": "0.10.0",
  "model": "deepseek-v4-flash",
  "provider": "deepseek-chat-completions",
  "ready": true,
  "requestId": "health-deepseek",
  "schemaVersion": 5,
  "type": "health-result"
}
```

健康事件不会返回 endpoint、effort、Key 状态、配置路径或凭据；网页与 Extension 不能通过
`health`、`warmup` 或 `analyze` 配置 Provider。

预热成功示例：

```json
{
  "requestId": "warmup-1",
  "schemaVersion": 5,
  "type": "warmup-ready"
}
```

分析增量示例：

```json
{
  "delta": "调查",
  "requestId": "analysis-1",
  "schemaVersion": 5,
  "section": "contextual-meaning",
  "sequence": 0,
  "type": "analysis-delta"
}
```

`analysis-delta.section` 只允许
`contextual-meaning | contextual-analysis | translation | main-structure | context-role`。单个 `delta` 必须包含
1–4,096 个字符。

`analysis-section.section` 只允许 `part-of-speech | pronunciation | base-form |
word-formation | core-meanings | collocations | context-example | similar-terms | synonyms |
contextual-sense | common-meanings | common-phrases | confusable-words | word-form | usage-notes |
synonym-comparisons`；
`value` 必须匹配该板块在最终结果中的同一严格子 Schema。数组板块只有在至少一个完整项通过
校验后才发送；`null` 和空数组表示不适用，不发送板块事件。

两类分析中间事件共享同一个从 0 开始的连续 `sequence`，wire 值必须是非负安全整数。消费端
遇到缺口、重复、倒序、错误请求类型或终态后的更新必须失败关闭。Host 不发送原始 JSON、
推理内容、半个对象、数组半成品或未校验字段；完整成功仍必须以经过严格校验的 `result`
收口。

结构化板块示例：

```json
{
  "requestId": "analysis-v5",
  "schemaVersion": 5,
  "section": "part-of-speech",
  "sequence": 1,
  "type": "analysis-section",
  "value": "number"
}
```

## 模型私有内容与 Host 组装

传给模型的六类 JSON Schema 是 Native Host provider 的私有内容契约，不属于 wire 协议，也不
通过 `@huayi/protocol` 导出。它们不得定义公共 `sourceText`、`selectionKind` 或结果 `type`。
模型只能提供翻译、解释、词性、音标、原形、构词、短语和比较词等内容。单词翻译与解释使用
独立 Schema；短语继续使用 lexical Schema。

Host 完整校验私有内容后，从可信 `analyze` 请求注入原始 `sourceText`、`selectionKind`，并按
请求动作映射公共结果 `type`；组装对象必须再次通过 `analysisResultSchema` 才能发送
`result`。模型无法改写大小写、复数、选区类型或结果类型。`null` 与空数组是合法“不适用”
值，只是不产生对应 `analysis-section`；不得用虚构值回填。

如果终态模型内容或公共组装校验失败，Host 发送 `error` 而不是 `result`。Extension 可以保留
已通过校验的只读预览并显示“内容未完整生成”，但预览不得被标记为成功或用于写入生词本。

生词状态示例：

```json
{
  "presence": "present",
  "requestId": "check-1",
  "schemaVersion": 5,
  "type": "word-status"
}
```

## 结果类型

- `translate-word`：可选英美音标、语境词性与中文义、1–4 个词性分组（每组 1–3 个常见义）、
  0–4 个常用短语、0–4 个带差异说明的易混词；只允许 `word`。
- `translate-lexical`：保留原有短语语境义、词性、音标、搭配、例句和相关词；只允许
  `phrase`。
- `translate-passage`：原文与简体中文译文并保留内部换行；只允许
  `sentence | paragraph`。
- `explain-word`：语境取义分析、词形与可判断的句法作用、可选可靠构词、0–3 条用法要点和
  0–3 个带语气/搭配/场景差异的同义词；只允许 `word`。
- `explain-lexical`：保留原有短语语境义、原形/构词、核心词义、同义词和搭配；只允许
  `phrase`。
- `explain-sentence`：主干、1–6 个关键表达、句意翻译和语境作用；只允许 `sentence`。

单词易混词与同义词比较均包含英文、词性、中文义和中文差异说明，不包含例句。易混词不得用
普通近义词凑数，同义词不得使用仅拼写相似的词；源词和原形不得出现在比较列表。

词性使用固定英文枚举：`noun`、`verb`、`adjective`、`adverb`、`pronoun`、
`preposition`、`conjunction`、`interjection`、`determiner`、`modal`、`number`、`particle`、
`phrase` 或 `other`。UI 可以本地映射展示文字，但不得改写 wire 值。

## 错误与兼容性

公开错误码仅包括：

```text
HOST_NOT_INSTALLED
CODEX_NOT_AUTHENTICATED
CODEX_CAPABILITY_MISSING
MODEL_PROVIDER_NOT_CONFIGURED
MODEL_PROVIDER_AUTH_FAILED
EUDIC_NOT_CONFIGURED
EUDIC_AUTH_FAILED
RATE_LIMITED
QUOTA_EXCEEDED
NETWORK_ERROR
TIMEOUT
INVALID_RESPONSE
CANCELLED
UNSUPPORTED_SELECTION
INTERNAL_ERROR
```

所有对象（包括每个 `analysis-section` 变体及其嵌套对象）拒绝未知字段，Native Messaging
单帧上限为 1 MiB。当前版本只允许新增可选字段；删除字段、重命名或改变语义时必须再次提升
`schemaVersion`，同时在本节增加迁移说明。

v0.8.0 从 wire v4 升至 v5，新增 `translate-word`、`explain-word` 及其八个渐进板块；
`translate-lexical` 与 `explain-lexical` 收窄为仅接受 `selectionKind: phrase`。v5 明确拒绝
v4，Extension 与 Native Host 必须同步升级。短语、句子、段落、Provider 选择和凭据语义
不变，不提供兼容转换层。

v0.7.0 在 wire v4 中兼容增加 `health-result.provider = deepseek-chat-completions`，分析请求、
中间事件、最终结果和错误语义不变，因此 `schemaVersion` 保持为 4。DeepSeek health 固定返回
`model: deepseek-v4-flash` 与 `codexVersion: null`。Extension 与 Host 仍必须同步升级；Provider
选择、Key、endpoint、思考模式与 JSON Output 配置不进入公共协议。

v0.6.0 的 v3 到 v4 是同步升级且不兼容的迁移：所有请求和事件改用 `schemaVersion: 4`；
`health-result.provider` 新增 `openai-compatible-http`。只有 `codex` 返回非空
`codexVersion`，`openai-responses` 与 `openai-compatible-http` 均必须返回
`codexVersion: null`。`analyze`、分析中间事件、生词本和错误消息形状保持不变；Endpoint、
effort、Key 状态和 Provider 配置不进入公共健康事件。Extension 与 Native Host 必须一起升级，
任一端不得接受 v3 消息。

v0.5.0 的 v2 到 v3 是同步升级且不兼容的迁移：所有请求和事件改用 `schemaVersion: 3`；
`health-result` 必须增加 `provider` 和 `model`，并将 `codexVersion` 改为可空且与 Provider
语义绑定；新增 Provider 通用错误码 `MODEL_PROVIDER_NOT_CONFIGURED` 和
`MODEL_PROVIDER_AUTH_FAILED`。分析增量、结构化板块、最终结果形状和共享序号语义保持不变。
Extension 与 Native Host 必须一起升级，任一端不得接受 v2 消息。Provider 配置与凭据是 Host
私有状态，不进入 `analyze`；配置缺失默认 Codex，其他无效状态失败关闭。

v1 到 v2 是同步升级且不兼容的迁移：所有请求和事件改用 `schemaVersion: 2`；`analyze`
必须增加 `sentenceContext`；新增不含页面数据的 `warmup -> warmup-ready`；新增与文本增量共享
序号的 `analysis-section`；词汇结果数组基数改为搭配/相似项/同义词 0–3、核心词义 1–3。
Extension 与 Native Host 必须一起升级，任一端不得接受另一版本的消息。v0.10.0 仍使用
wire v5；macOS 与 Windows 的精确同步安装命令分别见 `docs/setup-macos.md` 和
`docs/setup-windows.md`。

v0.2.0 在不改变已有消息语义的前提下，为 `schemaVersion: 1` 增加 `add-word` 和
`word-added` 联合分支，因此没有提升协议版本。扩展与 Native Host 应同步升级；旧 Host 在
加词请求时断开会被扩展提示为“未安装或版本过旧”，原有翻译协议不受影响。

v0.3.0 继续在 `schemaVersion: 1` 中兼容增加 `check-word`、`analysis-delta` 和
`word-status` 联合分支，不改变已有 `analyze`、`add-word`、`HostRequest` 或 `HostEvent` 分支
语义。扩展与 Native Host 仍须同步升级。

扩展为同一浮层分别维护分析、自动查词和显式加词通道。分析与自动查词可以并行；显式加词
开始时只替代未完成的查词，不取消已完成或仍在进行的分析。关闭、新选区、Escape 和标签页
销毁会向所有未完成通道发送各自的 `cancel`。每个通道只接受自身 request ID 的事件，终态后
到达的 delta、status 或重复终态必须被丢弃或失败关闭，不能改变后续浮层。

本机 stdin/stdout 每条消息使用 4 字节本机字节序无符号长度前缀，后接 UTF-8 JSON。长度为
0、超过 1 MiB、JSON 无效或协议 Schema 无效时 Host 立即停止读取；stdout 不输出日志、换行
或其他非帧字节。`analyze`、`check-word` 和 `add-word` 都进入全局最多并行 2 个任务的队列，
欧路操作在此基础上额外串行。`cancel` 同时适用于分析、查词和加词：对排队任务直接移除，
对运行任务触发 `AbortSignal`。成功终态必须与请求严格匹配：`health -> health-result`、
`warmup -> warmup-ready`、`analyze -> result`、`check-word -> word-status`、
`add-word -> word-added`。`analysis-delta` 和 `analysis-section` 只允许出现在仍等待 `result`
的分析请求中且不会结束请求。任何不匹配的中间事件或成功终态均按 `INVALID_RESPONSE` 失败
关闭。
