---
status: accepted
---

# Classic Edition 是 Store Edition 的功能下限

## Context

Store Edition 拥有独立扩展 ID、纯 MV3 BYOK 架构和新的本地数据边界，但划词分析、结果阅读、
加载、失败重试与生词动作已经在 Classic Edition 0.13.0 中形成稳定用户行为。若 Store 在移植时只
参考视觉或自由压平内容，用户会失去已经验证的结构与交互。

## Decision

ClassicParity 把 Classic Edition 0.13.0 已确定的用户行为定义为 Store Edition 的功能下限。Store
ResultCard 继承六类结构化结果、必要词头或短语标题、稳定的模式头部、显式错误重试，以及仅单词
可用的顶部生词动作与状态。Store 当前增量契约只提供 `analysis`、`contextual-meaning` 和
`translation` 三类粗粒度文本，因此加载与流式阶段保持稳定壳层并把增量放入对应语义区；最终结果
仍必须通过严格六类公开 Schema 后完整呈现。该适配不虚构模型字段，也不扩宽 Provider 契约。

以下差异由 Store 决策显式覆盖 Classic 行为：

- ActionCard 不回显选中文本，依次提供解释和翻译；所有状态都不显示 X，外部点击、滚动、调整视口或 Escape 关闭。
- 翻译与解释固定在单行顶部。一次 CardSession 分别缓存两种成功结果与错误；切回成功结果不重发，
  切到未完成模式会取消当前唯一请求。关闭或新选区销毁该会话。
- ResultCard 不显示原句语境；句子结果不重复整句，词与短语仍显示必要标题。
- 珍珠冷调与暖色羊皮纸只改变视觉变量，共用同一 DOM、结果结构和动作状态。
- DeviceVault 无日常密码；本地生词本是权威源，顶部生词动作写入本地词典。
- Store 固定支持 OpenAI、DeepSeek 与已定义的 YouTube 能力，不迁移 Classic Native Host。

## Consequences

新增或修改 Store 划词功能时，必须先核对 Classic 规格、实现和行为测试，再记录显式差异。不能以
“新版设计”替代未被决策覆盖的既有功能。共享内容脚本会承担完整 ResultCard 的运行时代码，因此
包体预算分别审计为普通网页 48 KiB、YouTube isolated controller 64 KiB；样式作为随包
`overlay.css` 加载，不允许远程代码，加载失败时保留可操作的最小内联样式。
