# 欧路词典生词本集成实施计划（v0.2.0）

## 执行原则

每个行为按“失败测试 → 确认失败原因 → 最小实现 → 聚焦测试 → 相关质量门禁 → 文档 → 独立
提交”执行。默认测试不得访问真实 OpenAI、欧路 API 或 macOS 钥匙串。

协议继续使用 `schemaVersion: 1`；根包、三个 workspace 包、扩展 Manifest 和 Host 版本统一为
`0.2.0`。扩展和 Native Host 必须同步升级。

## 阶段 1：协议与句子提取

- 增加严格 `add-word`、`word-added`、成功结果和欧路错误码。
- 单词规则支持内部连字符和英文撇号，拒绝短语、中文、未知字段及非法上下文。
- 基于真实 `Range`、`Intl.Segmenter` 和确定性回退提取实际选中词所在句子。
- 覆盖嵌套节点、重复词、缩写、引号、无句末标点、超长句和中英混合回退。
- 提交拆分：`feat(protocol): add wordbook contracts`、
  `feat(extension): extract wordbook context`。

## 阶段 2：结果页与请求协调

- 仅单词词汇结果显示按钮，状态全部进入 `ResultOverlayState`。
- 远端写入只使用原始选中词形和预提取句子。
- 保留结果、滚动和焦点；请求中去重，成功禁用，错误内联显示。
- 将协调器泛化为 `HostWorkRequest`，校验请求和成功终态匹配。
- 新选区、关闭、Escape、超时取消，忽略迟到事件；旧 Host 给出升级提示。
- 提交：`feat(extension): add eudic result action`。

## 阶段 3：Native Host 欧路 Provider

- 建立独立 `wordbook/` 边界和 `WordbookProvider`，不修改 `AnalysisProvider`。
- 使用固定端点、Node 内置 fetch、GET 后 POST、默认分组和严格响应校验。
- 欧路操作串行并支持取消、10 秒 HTTP 超时、64 KiB 上限、状态码映射。
- 测试固定 URL/Header/Body、已存在不写入、重定向、网络、超时和无效结构。
- 提交：`feat(host): add eudic wordbook provider`。

## 阶段 4：macOS Keychain 与安装生命周期

- 使用固定 service/account/label，每次操作读取且不缓存授权。
- 配置命令隐藏输入，`-w` 最后，无 `-A`、无 shell、无 Token 参数/环境/日志。
- 增加 configure/remove dry-run，支持轮换、缺失幂等、超时与输出限制。
- 安装/升级保留凭据；卸载先删精确钥匙串项，失败时保留 Host 文件。
- 将 Keychain reader、Eudic client 和错误映射接入生产 dispatcher。
- 提交：`feat(host): manage eudic credentials`。

## 阶段 5：发布、文档与端到端

- 同步版本 `0.2.0` 并增加版本一致性测试。
- Playwright 覆盖翻译/解释成功、已存在、未配置、授权失效、限流、网络重试、关闭取消。
- 更新 README、贡献指南、架构、协议、安全、测试和 macOS 安装文档。
- 确认 Manifest 权限仍严格为 `["nativeMessaging"]`。
- 提交：`test: verify eudic wordbook end to end`、
  `docs: document eudic wordbook integration`。

## 质量门禁

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
git diff --check
```

## 人工验收

用户配置钥匙串后，新增一个未收藏单词并确认欧路中包含目标英文句子；再次添加同一单词应
显示“已在生词本”，不得覆盖原分组、星级或语境。真实验收不纳入自动门禁。
