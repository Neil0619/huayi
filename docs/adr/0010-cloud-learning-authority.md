---
status: accepted
---

# 华译账号是学习数据的唯一权威

Store Edition 以 HuayiAccount 下的云端数据作为 WordEntry、AnalysisRecord、LearningItem、
PracticeSession 和外部导出任务的唯一权威，取代 ADR 0003 的本地词典权威。设备上只允许存在
有界、可丢弃、明确标记为待提交的临时数据；任何客户端都不能宣称与云端并列的正式状态。

## Consequences

欧路和扇贝仍是外部副本，由 Extension 使用本机凭据桥接；服务端持有任务、租约和回执。用户既可
下载 ADR 0008 定义的一词一行 WordListExport，也必须能够取得不含秘密的完整
AccountDataExport。已确认学习项保存独立 SourceExample 快照，因此删除来源分析不会破坏学习项。
Store 尚未发布且没有真实本地词库用户，所以不开发旧 WordEntry 迁移器或双写兼容层。

## Amendment

ADR-0020 把本 ADR 的唯一权威限定为账号云端范围。每个插件安装的 LocalLexiconEntry 是独立本机权威，
不是 WordEntry 缓存；两者只通过用户允许的新词单向副本或显式批量导入相交。
