# 协议说明

协议版本从 `schemaVersion: 1` 开始，所有消息均为严格的带 `type` 联合类型。

## 请求

- `health`：检查 native host 和 Codex 登录/能力状态。
- `analyze`：包含请求 ID、动作、选区类型、英文选区、所在段落上下文和 `zh-CN` 目标语言。
- `check-word`：只包含请求 ID、英语原始单词和固定语言 `en`，用于只读查询生词本状态。
- `add-word`：包含请求 ID、英语单词和所在完整英文句子，用于加入本机配置的生词本。
- `cancel`：按请求 ID 终止排队或运行中的任务。

`analyze` 的 `action` 只能是 `translate | explain`，`selectionKind` 只能是
`word | phrase | sentence | paragraph`。`selection` 和 `context` 各自最多 2,000 字符；段落与
`explain` 的组合会被协议直接拒绝。`requestId` 最多 64 字符，且只能包含字母、数字、点、
下划线、冒号和连字符。

`check-word` 和 `add-word` 的 `language` 均固定为 `en`；`word` 只能是由英文字母及内部连字符
或直/弯英文撇号构成的单词。自动执行的 `check-word` 只发送网页中的原始单词，不发送句子。
只有用户主动添加时，`add-word` 才额外发送 `context`；该字段必须包含英文、不能包含汉字，
长度为 1–2,000 字符。两种请求均不包含 URL、页面标题、段落上下文或模型输出。

只读查询示例：

```json
{
  "language": "en",
  "requestId": "check-1",
  "schemaVersion": 1,
  "type": "check-word",
  "word": "mother-in-law"
}
```

## 事件

- `progress`：`queued` 或 `running`。
- `analysis-delta`：分析核心字段的增量文本；它是中间事件，不是成功终态。
- `result`：返回经过 Schema 校验的分析结果。
- `word-status`：返回 `present | absent`，表示只读查询到单词已存在或不存在。
- `word-added`：返回 `added | already-exists`，分别表示新建成功或原记录已存在。
- `error`：返回固定错误码、中文用户提示和是否允许重试。

分析增量示例：

```json
{
  "delta": "调查",
  "requestId": "analysis-1",
  "schemaVersion": 1,
  "section": "contextual-meaning",
  "sequence": 0,
  "type": "analysis-delta"
}
```

`section` 只允许 `contextual-meaning | translation | main-structure | context-role`。每个请求的
`sequence` 从 0 开始单调递增，wire 值必须是非负安全整数；单个 `delta` 必须包含 1–4,096 个
字符。增量只携带允许字段的文本，不携带原始 JSON、推理内容、数组半成品或未知字段；完整
成功仍必须以经过严格校验的 `result` 收口。

生词状态示例：

```json
{
  "presence": "present",
  "requestId": "check-1",
  "schemaVersion": 1,
  "type": "word-status"
}
```

## 结果类型

- `translate-lexical`：语境义、词性、可选英美音标、2–4 个搭配、可选原文例句、3–5 个
  相似项；只允许 `word | phrase`。
- `translate-passage`：原文与简体中文译文并保留内部换行；只允许
  `sentence | paragraph`。
- `explain-lexical`：语境义、可选原形/构词、核心词义、3–5 个同义词、2–4 个搭配；只
  允许 `word | phrase`。
- `explain-sentence`：主干、1–6 个关键表达、句意翻译和语境作用；只允许 `sentence`。

相似项和同义词只包含英文、词性和中文义，不包含例句。

词性使用固定英文枚举：`noun`、`verb`、`adjective`、`adverb`、`pronoun`、
`preposition`、`conjunction`、`interjection`、`determiner`、`modal`、`number`、`particle`、
`phrase` 或 `other`。UI 可以本地映射展示文字，但不得改写 wire 值。

## 错误与兼容性

公开错误码仅包括：

```text
HOST_NOT_INSTALLED
CODEX_NOT_AUTHENTICATED
CODEX_CAPABILITY_MISSING
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

所有对象拒绝未知字段，Native Messaging 单帧上限为 1 MiB。版本 1 只允许新增可选字段；
删除字段、重命名或改变语义时必须提升 `schemaVersion`，同时在本节增加迁移说明。

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
对运行任务触发 `AbortSignal`。成功终态必须与请求严格匹配：`analyze -> result`、
`check-word -> word-status`、`add-word -> word-added`；`analysis-delta` 只允许出现在仍等待
`result` 的分析请求中且不会结束请求。任何不匹配的增量或成功终态均按 `INVALID_RESPONSE`
失败关闭。
