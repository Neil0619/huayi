# 测试策略

## 默认自动测试

`pnpm test`、`pnpm test:e2e` 及其他默认门禁不得访问 OpenAI、真实 Codex、欧路 API 或
macOS 钥匙串。测试分别注入 fake App Server/JSON-RPC process、fake process runner、fake
authorization reader、fake fetch 和 Mock NativeTransport；只有显式 `pnpm smoke:codex`
可以调用真实模型。

自动测试覆盖：

- 协议：严格请求/事件联合、`analysis-delta` 序号/长度/section、`check-word` /
  `word-status`、错误码和 1 MiB 帧上限。
- 选区：四类分类、2,000 字符裁剪、编辑区排除，以及单词所在英文句子的确定性提取。
- 浮层：loading/streaming/result/error 状态、增量批处理、安全文本渲染、独立生词状态、
  右上角按钮、焦点、拖动、滚动、窄屏和迟到事件。
- Service Worker：分析、查词、加词三通道，并发、定向取消、有序增量、严格终态、断线和超时。
- MCP 发现：fake process runner 覆盖已启用/已禁用过滤、命令参数和环境允许列表，以及进程
  失败、超时、输出超限、无效 JSON、重复/不安全名称和 128 条记录上限。
- App Server 参数：回归确认不传 `tools.view_image=false` 或 `mcp_servers={}`，只为经过校验的
  已启用直接 MCP 生成逐项禁用覆盖。
- App Server：JSON-RPC 拆包/合包、握手、按需重启并重新发现 MCP、并发 turn、中断、
  ephemeral thread、固定 `openai` / `gpt-5.4-mini` / `low` 和空指令来源；接受目标 cwd 的
  安全空 Hook 记录和无连接、无工具/资源/模板的 MCP 状态，拒绝活动记录和未知响应形状。
- Provider：有界 JSON 字段增量、转义/Unicode/chunk 边界、最终 JSON Schema、公共 Schema、
  请求/结果一致性、提示注入和错误映射。
- 欧路：自动 GET 查词、显式 GET-before-POST、固定 URL/Header/Body、授权逐次读取、串行、
  取消、10 秒超时、重定向拒绝、64 KiB 上限和状态码映射。
- 安装器：dry-run、升级、allowed origin、所有权、绝对路径、受控 launcher、钥匙串命令和
  幂等清理。
- Manifest：`permissions` 严格等于 `["nativeMessaging"]`，不存在 `host_permissions`。

## 浏览器 E2E

Vite fixture 串起真实 Content Script、Service Worker 消息处理、请求协调器和 fake Native
Host。Playwright 覆盖：

- 单词翻译/解释在最终卡片前显示至少两个独立增量；
- 已存在查询先返回、结果先返回、查询不存在和被动查询失败；
- 自动查询只记录单词，短语、句子和段落从不发 `check-word`；
- 查词未完成时显式添加只取消查词，并保留原始英文句子；
- 关闭、新选区和 Escape 同时取消分析/查词请求；
- 迟到 delta/status 不能重开或改写替代浮层；
- 320px 窄屏下生词按钮、拖动手柄和关闭按钮均可见且不重叠。

稳定的词汇结果卡使用 macOS Chrome 元素截图基线。更新快照后必须人工查看实际 PNG，确认
只有预期头部 UI 变化，不存在溢出、遮挡或意外内容变化。

## Smoke 客户端单元测试

Node 测试通过二进制 Native Messaging 帧驱动 fake child。分析请求只允许从 0 开始严格有序
的 `analysis-delta`，并继续等待匹配 `result`；跳号、健康/生词通道中的 delta、终态后的
delta 或额外终态都会锁存为 fatal。测试还覆盖无效 Schema/JSON/帧、stdout EOF、stderr/stdin
错误、子进程退出和有界 SIGTERM/SIGKILL 清理。

## 真实 Codex 冒烟

`pnpm smoke:codex` 显式验证 `investigation`、`sustained heatwave`、单句和多句段落。每个
案例只输出首个 delta 和完整 result 的耗时毫秒数，不打印模型文本。最终结果仍通过公共协议
校验，段落必须保留换行。

运行前后脚本只比较 `CODEX_HOME/sessions` 中的相对文件名，不读取 session 内容或认证文件；
新增任何 session 文件都会使测试失败。该命令会消耗真实 ChatGPT/Codex 额度，因此不属于
默认门禁，不能在自动测试中运行。

真实欧路验收也不属于自动门禁。只有用户显式配置钥匙串后，才手动验证未收藏、已存在和语境
写入路径。
