# 测试策略

## 默认自动测试

`pnpm test`、`pnpm test:e2e` 及其他默认门禁必须完全离线，不得访问 OpenAI、真实 Codex、
欧路 API 或 macOS 钥匙串。测试分别注入 fake App Server/JSON-RPC process、fake process
runner、fake authorization reader、fake fetch 和 Mock NativeTransport；只有用户明确批准
真实模型、明文传输、额度和 API 账单影响后，才可单独执行 `pnpm smoke:codex`、
`pnpm smoke:compatible` 或 `pnpm smoke:compare`。

自动测试覆盖：

- 发布版本：根包、三个 workspace 包、Manifest、Host health、App Server clientInfo 和欧路
  User-Agent 全部直接断言为 `0.6.0`，wire 版本为 4。
- 协议：严格 v4 请求/事件联合、v3 拒绝、三种 Provider health、warmup、`analysis-delta` /
  `analysis-section` 共享
  序号、`check-word` / `word-status`、错误码和 1 MiB 帧上限。
- 选区：四类分类、2,000 字符裁剪、编辑区排除，以及单词所在英文句子的确定性提取。
- 浮层：loading/streaming/result/error 状态、文本和类型化板块批处理、安全文本渲染、空词汇
  板块隐藏、失败时保留非终态预览、独立生词状态、右上角按钮、焦点、拖动、滚动、窄屏和
  迟到事件。
- 流式调度：注入 fake frame scheduler 验证每帧最多渲染一次、终态排空和关闭清理；键控 DOM
  测试验证旧节点复用、数组累计追加、最终校正、一次性 120ms 动画及 reduced-motion。
- Service Worker：无页面数据 warmup、分析/查词/加词三通道、并发、定向取消、共享连续序号、
  严格终态、断线和超时。
- MCP 发现：fake process runner 覆盖已启用/已禁用过滤、命令参数和环境允许列表，以及进程
  失败、超时、输出超限、无效 JSON、重复/不安全名称和 128 条记录上限。
- App Server 参数：回归确认不传 `tools.view_image=false` 或 `mcp_servers={}`，只为经过校验的
  已启用直接 MCP 生成逐项禁用覆盖。
- App Server：JSON-RPC 拆包/合包、握手、按需重启并重新发现 MCP、并发 turn、中断、
  ephemeral thread、固定 `openai` / `gpt-5.4-mini` / `low` 和空指令来源；接受目标 cwd 的
  安全空 Hook 记录和无连接、无工具/资源/模板的 MCP 状态，拒绝活动记录和未知响应形状。
- Warmup：不含任何网页字段，不发送 `thread/start` / `turn/start`，不触发 fake model turn；
  与 analyze 竞态时只发现、启动和初始化一次 App Server。
- Provider：私有模型内容 Schema 拒绝公共元数据，有界 JSON 字段增量与完整结构化值、
  转义/Unicode/chunk 边界、Host 注入可信元数据、最终公共 Schema、提示注入和错误映射。
- Provider 路由：配置缺失默认 Codex，其他无效文件失败关闭；三个 Provider 逐请求固定路由、
  切换只影响下一请求、设置与 dry-run 均拒绝覆盖无效目标、HTTP warmup 不读 Key/不发 HTTP，
  每个 Provider 均只 dispose 一次且失败时不 fallback。
- OpenAI Key/API：固定 `/usr/bin/security` 参数和精确 service/account、逐请求读取、不泄漏；
  fake fetch 覆盖固定 endpoint/model/body、无重试、重定向、超时/取消、响应体上限和状态映射。
- Responses SSE：严格 event/data 类型、单 text lifecycle、数组项逐个校验和累计发送，拒绝
  refusal、工具、推理、重复/迟到事件、未知终态、超限与原始内容泄漏。
- Compatible 配置/Key：`provider.json` 与 `compatible-http.json` 分离，HTTP 风险必须显式确认，
  URL/model/effort 组合、所有权、`0600` 和 Keychain service/account 严格校验；全部使用 fake
  filesystem、fake Keychain 和 fake fetch。
- Compatible HTTP/SSE：固定 `/responses`、Bearer Header、无 Cookie/重定向/重试，接受实测
  rate-limit、可选成对 reasoning、`0/1` output index、完整 Responses envelope、可选但必须成对
  的 content-part / assistant-item done 和单文本生命周期；验证回显 Prompt、usage、加密
  reasoning、`turn_id`、`phase`、logprobs 与 obfuscation 均在归一化时丢弃。拒绝未知、重复、
  迟到、tool、refusal、半套终止事件、delta/done/completed 不一致、超限、取消或超时后的事件。
- 安全诊断：五个允许阶段只输出有界阶段/字段名，伪网页、模型、原始 JSON 和凭据均不会进入
  stderr。
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
- 迟到 delta/status 不能重开或改写替代浮层；关闭取消后迟到 SSE 也不能重开浮层；
- 受控 mock 流显式释放第一项、第二项和最终结果，以行为顺序验证稳定节点复用，不依赖瞬时
  毫秒窗口；
- API Key 未配置和授权失败只显示固定安全中文提示，不暴露伪凭据；
- 320px 窄屏下生词按钮、拖动手柄和关闭按钮均可见且不重叠。

稳定的词汇结果卡使用 macOS Chrome 元素截图基线。更新快照后必须人工查看实际 PNG，确认
只有预期头部 UI 变化，不存在溢出、遮挡或意外内容变化。

## Smoke 客户端单元测试

Node 测试通过二进制 Native Messaging 帧驱动 fake child。分析请求只允许从 0 开始严格有序
的 `analysis-delta` / `analysis-section`，并继续等待匹配 `result`；跳号、错误通道中的预览、
终态后的更新或额外终态都会锁存为 fatal。测试还覆盖无效 Schema/JSON/帧、stdout EOF、
stderr/stdin 错误、子进程退出和有界 SIGTERM/SIGKILL 清理。

## 真实 Codex 冒烟

`pnpm smoke:codex` 显式验证 `sustained`、`victims`、`accountable`、`Four` 以及单句和多句
段落基线。输出只包含一次 `cold warmup`，以及每个用例各一次
`click-to-first-delta` / `click-to-full-result` 整数时长，不打印用例内容或模型文本。最终结果仍
通过公共协议校验，段落必须保留换行。

运行前后脚本只比较 `CODEX_HOME/sessions` 中的相对文件名，不读取 session 内容或认证文件；
新增任何 session 文件都会使测试失败。该命令会消耗真实 ChatGPT/Codex 额度，因此不属于
默认门禁，不能在自动测试中运行，也不能由发布流程自动批准。

真实欧路验收也不属于自动门禁。只有用户显式配置钥匙串后，才手动验证未收藏、已存在和语境
写入路径。

## 真实 Provider 对比

`pnpm smoke:compare` 对固定无敏感样本分别执行 Codex 与 API Provider，记录聚合的
first-visible / complete 延迟和通过率，不打印选区、模型文本、API Key、请求 ID 或 usage。
该命令会同时消耗 ChatGPT/Codex 额度与 OpenAI Platform API 费用，仅在用户明确授权后运行；
它不属于默认门禁，也不得被 CI 或发布脚本自动触发。

## 真实 Compatible 冒烟

`pnpm smoke:compatible` 只从第三方专用钥匙串读取 Key，并使用本机严格
`compatible-http.json`；不接受临时 endpoint、模型或 Prompt 参数。它输出匿名 case ID、计数
和整数耗时，不输出 Key、Authorization、选区、上下文、Prompt 或模型结果。该命令会通过明文
HTTP 发送固定测试输入并产生第三方费用，必须由用户在查看配置状态和风险警告后单独批准。
Smoke 不读取 Codex 配置、不读取官方 OpenAI Key、不修改 `provider.json`，也不会自动切换
Provider。

## 完整默认门禁

发布前从第一条开始依次运行，任一格式化修改后必须检查 diff 并从第一条完整重跑：

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
git diff --check
```

该门禁不包含真实 smoke、Host 安装、Chrome 操作、真实钥匙串或欧路访问。
