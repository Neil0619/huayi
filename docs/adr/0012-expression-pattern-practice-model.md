---
status: accepted
---

# 表达与句型是两类学习项，原句只作为来源例句

Cloud V1 把可整体复用的固定或半固定片段建模为 Expression，把带可替换槽位的抽象模板建模为
SentencePattern；两者共享学习库，但拥有不同字段、规范键和精确去重范围。完整原句只保存为
SourceExample，不独立进入复习队列。这样避免把“优秀原句”“短语”和“句型”压进一个含义模糊的
文本记录，同时保留真实上下文。

## Consequences

只有用户确认后的 Expression 和 SentencePattern 进入句子创作或受约束对话。模型只提供正确性、
自然度和改进建议，排期由用户的“不会／勉强／掌握”驱动；WordEntry 继续交给成熟单词软件承担
记忆，不进入 Huayi 主动练习。
