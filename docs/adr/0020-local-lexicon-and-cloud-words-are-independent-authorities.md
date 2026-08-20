---
status: accepted
---

# 本机词库与云端生词是独立权威

每个 Store Extension 安装继续把 `LocalLexiconEntry` 作为本机正式生词；HuayiAccount 下的 `WordEntry`
只代表云端学习工作台生词。登录后的收藏永远先写本机，再按账号级 `CloudWordCopyMode` 可选提交一个
最小 `CloudWordCopy`。Web 不回写本机，换号不切换或清空本机词库，历史本机词条只可显式批量导入。

## Considered Options

- 云端取代本机：跨设备简单，但破坏插件独立使用和已有本机外部词典能力。
- 双向同步：表面完整，却引入离线冲突、删除传播和账号切换歧义。
- 本机与云端独立、单向可选复制：会出现两份用户可见数据，但每份所有权和失败语义明确。

## Consequences

CloudAuthority 仍是账号云端数据的唯一权威，但不拥有或镜像 LocalLexiconEntry。本机欧路导入/欧路导出/
扇贝导出与云端 ExternalWordbookJob 是不同能力，UI 必须明确来源。CloudWordCopy 失败不能回滚本机保存，
且不能上传完整查询结果、页面信息或 Provider 配置。

本 ADR 修订 ADR-0010 对 WordEntry 的排他表述，并保留 ADR-0003 对本机词库所有权的有效部分。
