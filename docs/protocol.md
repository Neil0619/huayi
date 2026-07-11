# 协议说明

协议版本从 `schemaVersion: 1` 开始，所有消息均为严格的带 `type` 联合类型。

## 请求

- `health`：检查 native host 和 Codex 登录/能力状态。
- `analyze`：包含请求 ID、动作、选区类型、英文选区、所在段落上下文和 `zh-CN` 目标语言。
- `cancel`：按请求 ID 终止排队或运行中的任务。

`analyze` 的 `action` 只能是 `translate | explain`，`selectionKind` 只能是
`word | phrase | sentence | paragraph`。`selection` 和 `context` 各自最多 2,000 字符；段落与
`explain` 的组合会被协议直接拒绝。`requestId` 最多 64 字符，且只能包含字母、数字、点、
下划线、冒号和连字符。

## 事件

- `progress`：`queued` 或 `running`。
- `result`：返回经过 Schema 校验的分析结果。
- `error`：返回固定错误码、中文用户提示和是否允许重试。

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

本机 stdin/stdout 每条消息使用 4 字节本机字节序无符号长度前缀，后接 UTF-8 JSON。长度为
0、超过 1 MiB、JSON 无效或协议 Schema 无效时 Host 立即停止读取；stdout 不输出日志、换行
或其他非帧字节。`analyze` 进入全局最多并行 2 个任务的队列，`cancel` 对排队任务直接移除，
对运行任务触发 `AbortSignal`。
