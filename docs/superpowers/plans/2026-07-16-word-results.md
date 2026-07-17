# v0.8.0 单词结果实施计划

1. 将发布版本升为 0.8.0、wire 升为 v5，新增单词翻译/解释严格 Schema，并把旧 lexical 结果
   收窄为短语专用。
2. 为六类 Provider 私有结果增加两份 JSON Schema、Prompt 分支、组装器和八类流式板块；保持
   Codex、OpenAI、Compatible 和 DeepSeek 使用同一公共契约。
3. 扩展状态机保存新增板块，结果 UI 按固定顺序稳定 patch；欧路按钮只绑定新单词结果。
4. 增加协议边界、Provider 字段顺序、流式累积、UI 顺序、HTML 注入和短语回归测试。
5. 更新架构、协议、安全、测试、安装、README 与各级 AGENTS.md。
6. 运行 format、lint、typecheck、unit、E2E、build、指令检查和 diff 门禁；离线通过后复制扩展
   构建到 Chrome 已登记的稳定目录并校验 Manifest。真实 DeepSeek smoke、Host 安装、刷新和
   Provider 切换必须另行获得授权。
