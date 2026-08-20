---
status: accepted
---

# 插件查询结果与学习采集是两种资源

Store Extension 的即时查询和 Web 的深度学习目的不同。平台/BYOK 都只生成当前 ResultCard 所需的
`ExtensionQueryResult`；它不自动成为 AnalysisRecord。用户送往 Web 的是只含原始短语、句子或段落的
`StudyCapture`，之后由用户在 Web 显式运行 `WebDeepAnalysis` 才产生待收藏候选。

## Considered Options

- 上传插件完整结果：实现较快，但会把精简查询冒充教学分析，产生低质量待收藏和不必要的长期正文。
- 自动在云端重新分析每次查询：流程省一步，但会隐式消耗额度并把偶发查询都变成学习数据。
- 只上传原文并由用户显式分析：多一个操作，但能把查询、采集、付费分析和收藏的意图分别表达。

## Consequences

登录 BYOK 结果不再进入 `analyses:import`；平台插件查询使用最多保留一小时的临时 generation，也不进入
历史。StudyCapture 采用账号内同类型规范原文精确去重，支持手动/账号级自动加入和当前卡有限撤销。
Web 手动粘贴与 capture 共用深度分析 schema，只产生 Expression/SentencePattern 候选。

本 ADR 修订 ADR-0009 与 ADR-0014 中“登录后的完整插件结果进入待整理”的旧结论。
