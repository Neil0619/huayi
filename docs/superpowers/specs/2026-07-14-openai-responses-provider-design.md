# 划译 OpenAI Responses Provider 与平滑流式展示设计

## 1. 背景与目标

划译 v0.4.0 使用已登录 ChatGPT 的 Codex App Server 调用
`gpt-5.4-mini + low`。真实测试显示，预热后单词请求从 Host 开始分析到首个可显示内容平均约
3.1 秒，其中约 2.9 秒消耗在 turn 已确认后等待首个模型 delta；Codex thread/turn 本地生命周期
和结构化字段校验合计只占约 140 毫秒。完整结果平均约 5.6 秒。

当前字符串字段可以增量显示，但数组和对象必须完整关闭并通过 Schema 后才能作为整个板块发送，
所以搭配、核心词义、相似词和同义词会以整块形式出现。前端又会重新渲染预览卡片，导致内容和
布局产生明显跳动。

v0.5.0 的目标是：

- 保留 Codex Provider 作为默认基线和可回退选项；
- 新增直接调用 OpenAI Responses API 的 Provider；
- 由用户显式选择 Provider，禁止自动改变费用来源；
- 使用 `gpt-5.6-luna + none` 验证低延迟方案；
- 让结构化数组逐条校验、逐条展示；
- 使用按帧 DOM 增量更新消除整卡重绘和模块跳动；
- 建立可重复的 Codex/API A/B 性能与质量验收；
- 为未来扩展设置页保留稳定的 Host 配置边界。

本版本仍只支持 macOS 和 Chrome，不发布 Chrome Web Store，不增加查询历史、同步、云端账号、
后续对话或其他浏览器支持。

## 2. 已确认决策

### 2.1 Provider 选择

采用 Host 自有配置文件显式选择 Provider。Codex 是缺省值；API Key 的存在不会自动启用 API，
API 失败也不会自动回退 Codex。

Provider 模式通过本机 CLI 管理：

```text
pnpm host:provider:set api
pnpm host:provider:set codex
pnpm host:provider:status
```

切换命令只改变下一次分析使用的 Provider，不调用模型、不产生 API 费用，也不要求重新安装扩展、
重启 Chrome 或终止当前 Host 进程。

### 2.2 API 运行配置

用户实际体验模式固定为：

```text
endpoint: https://api.openai.com/v1/responses
model: gpt-5.6-luna
reasoning.effort: none
stream: true
store: false
```

Host 不接受来自网页、扩展消息、配置文件或环境变量的 endpoint、模型、Prompt、Schema 或 API
Key 覆盖。A/B 工具可以在测试进程内注入受控的模型/effort 组合，但这些测试参数不成为生产配置。

### 2.3 版本与兼容性

应用、根包、三个 workspace 包、扩展 Manifest 和 Host 版本统一升为 `0.5.0`。

wire `schemaVersion` 升为 `3`，原因是新增 Provider 认证错误并扩展 health 语义。v3 Extension 与
v3 Host 必须同步升级；v2/v3 不做隐式兼容或降级。

Chrome 权限仍严格为：

```json
["nativeMessaging"]
```

不新增 `storage`、`host_permissions`、设置页或远程扩展代码。

## 3. 架构

依赖方向保持不变：

```text
extension -> @huayi/protocol <- native-host
```

Native Host 内部增加三层边界：

```text
ProviderConfigurationStore
            |
            v
   RoutingAnalysisProvider
       |             |
       v             v
CodexAppServerProvider   OpenAIResponsesProvider
```

### 3.1 ProviderConfigurationStore

配置文件固定为：

```text
~/Library/Application Support/Huayi/native-host/provider.json
```

只接受以下严格对象之一：

```json
{
  "schemaVersion": 1,
  "provider": "codex"
}
```

```json
{
  "schemaVersion": 1,
  "provider": "openai-responses"
}
```

缺失文件等价于 `codex`。空文件、符号链接、未知字段、未知版本、无效 JSON 或非法 Provider
必须失败关闭，不能猜测或修复用户文件。

写入使用相同目录中的临时普通文件、`0600` 权限、`fsync` 和原子 rename。安装升级保留合法配置；
完整卸载只在验证 Huayi 所有权后随应用目录一起删除。

### 3.2 RoutingAnalysisProvider

`RoutingAnalysisProvider` 实现现有 `AnalysisProvider`，持有 Codex 与 Responses 两个独立 Provider。

每次 `analyze` 开始时读取一次 Provider 配置，并把该请求固定路由到对应 Provider。请求开始后的
配置变化不能把活动请求迁移到另一 Provider；下一次请求使用新配置。

`warmup` 同样读取当前模式：

- Codex 模式继续执行不含网页数据、不调用模型的 App Server warmup；
- API 模式只验证本地配置读取能力，不发送 HTTP 请求，也不读取或缓存 API Key。

Router 不捕获 Provider 错误进行回退。`dispose` 必须释放两个 Provider 的本地资源。

这一边界未来可以由设置页通过新的 Host 控制请求复用，但 v0.5.0 不增加浏览器配置 UI 或配置
wire 消息。

### 3.3 OpenAIResponsesProvider

Responses Provider 实现现有：

```ts
interface AnalysisProvider {
  warmup(signal: AbortSignal): Promise<void>;
  analyze(
    request: AnalyzeRequest,
    signal: AbortSignal,
    onDelta?: AnalysisStreamListener,
  ): Promise<AnalysisResult>;
  dispose?(): void;
}
```

它复用现有 Prompt Builder、Provider 私有 JSON Schema、流式字段提取器、最终结果组装器和公共
协议校验，不把 API request ID、usage、模型元数据或 OpenAI 响应对象泄漏到公共协议。

## 4. OpenAI API Key 生命周期

钥匙串定位固定为：

```text
service: com.huayi.codex_bridge.openai
account: api-key
label: Huayi OpenAI API Key
```

新增命令：

```text
pnpm host:openai:configure -- --dry-run
pnpm host:openai:configure
pnpm host:openai:remove -- --dry-run
pnpm host:openai:remove
```

配置命令调用固定 `/usr/bin/security`，使用参数数组和 `shell: false`：

```text
add-generic-password -U -s <service> -a <account> -l <label> -w
```

无参数 `-w` 必须是最后一个参数，由系统隐藏读取。禁止使用 `-A`，禁止通过命令参数、环境变量、
普通文件、扩展消息或聊天内容接收 Key。

Host 每次 API 分析重新读取钥匙串，不跨请求缓存。读取最长 5 秒，输出最多 8 KiB；只移除一个
系统命令产生的末尾换行。Key 必须为 1–4,096 个字符，无首尾空白、CR、LF、NUL 或控制字符，
但不硬编码当前 Key 前缀。

Key 只短暂存在于 Host 内存和 `Authorization: Bearer` Header，不进入 Native Messaging、
stdout、stderr、错误信息、性能记录、快照或测试日志。

配置命令不调用 OpenAI。授权有效性在第一次显式 API 分析时验证。升级保留钥匙串项；
`host:openai:remove` 删除精确 service/account。完整卸载先移除欧路和 OpenAI 两个精确钥匙串项，
删除失败时保留 Host 文件以便重试。

## 5. Responses API 请求与流

### 5.1 HTTP 边界

使用 Node 18 内置 `fetch`，不增加生产依赖。每次请求固定：

- `POST https://api.openai.com/v1/responses`；
- `Authorization: Bearer <key>`；
- `Content-Type: application/json`；
- 不发送 Cookie；
- `redirect: "error"`；
- 不自动重试；
- 总超时 60 秒并传播外部 `AbortSignal`；
- 单个 SSE 事件、累计 SSE 字节和累计 assistant JSON 均有独立上限。

请求只包含固定模型配置、固定安全指令、当前 `AnalyzeRequest` 需要的英文数据、严格输出 Schema、
`stream: true` 和 `store: false`。不声明工具、Web Search、文件、会话历史或 `previous_response_id`。

### 5.2 SSE 解析

SSE parser 只接受合法 UTF-8、标准字段和有限事件大小。Provider 处理：

- `response.created` / `response.in_progress`：生命周期，不产生 UI 内容；
- `response.output_item.added` / `response.output_item.done`：验证只有一个 message output；
- `response.content_part.added` / `response.content_part.done`：验证只有一个 output text part；
- `response.output_text.delta`：按顺序送入有界 JSON 流式提取器；
- `response.output_text.done`：确认文本通道完成；
- `response.completed`：确认唯一成功终态；
- `response.failed`、`response.incomplete`、`error`：映射错误并失败；
- 拒答、推理输出、工具、函数调用、额外 output item、重复终态、终态后数据或未知关键形状：
  失败关闭。

Provider 累积完整 assistant JSON，但不记录原文。`response.completed` 后必须完成 tokenizer、私有
Schema、Host 可信元数据组装和公共 `analysisResultSchema` 校验，只有全部成功才返回 `result`。

## 6. 逐条结构化流式输出

### 6.1 Tokenizer 扩展

现有 tokenizer 继续产生：

```ts
type TopLevelJsonUpdate =
  | { field: string; kind: "string-delta"; value: string }
  | { field: string; kind: "complete-value"; value: unknown };
```

并为顶层数组增加：

```ts
| { field: string; index: number; kind: "array-item"; value: unknown };
```

Tokenizer 只在一个顶层数组的直接子项完整关闭后解析该项。它必须正确处理嵌套对象、嵌套数组、
字符串中的括号、转义、Unicode、任意 source chunk 边界、空数组和最多三个词汇条目。

`array-item` 不替代 `complete-value`。数组结束时仍解析完整数组并验证其最终值，确保逐项输出与
最终 JSON 完全一致。

### 6.2 子 Schema 与累计板块

每个 `array-item` 先通过对应 Provider 私有元素 Schema。校验成功后，提取器把它加入当前字段的
只读累计数组，并复用现有 `analysis-section` 发送：

```text
[item1]
[item1, item2]
[item1, item2, item3]
```

公共事件形状不增加新的 section 类型。Extension 状态机用最新累计值替换对应板块。重复、倒退、
越界索引、超过 Schema 数量、无效条目或最终数组与累计条目不一致都按 `INVALID_RESPONSE`
终止。

字符串字段继续逐 delta 输出。Provider 保证来自 Codex 和 Responses 的更新都走同一个提取器，
因此切回 Codex 时也能获得逐条数组展示。

## 7. 前端平滑渲染

### 7.1 按帧合并

将固定 40 毫秒 `setTimeout` 批处理替换为每帧最多一次的 `requestAnimationFrame`。测试环境和
不支持 rAF 的文档使用可注入 scheduler，不在生产代码中依赖任意全局 polyfill。

收到终态前必须 drain 当前帧队列；关闭、新选区和取消必须丢弃未提交的旧请求更新。

### 7.2 增量 DOM Patch

流式状态不再为每个 delta 重建整张卡片：

- 字符串 delta 只更新目标段落的 `textContent`；
- 第一条结构化内容创建板块标题和容器；
- 累计数组只追加新 `<li>`，不重建已有条目；
- 单值板块只创建或更新自己的节点；
- 最终结果在相同节点上对齐和校正，不先清空再绘制；
- 请求类型或选区变化才允许重建结果主体。

所有节点使用固定 `data-huayi-section` 键定位。任何模型值继续只通过 `textContent` 写入。

新板块和新条目使用约 120 毫秒的轻量 opacity/translate 动画；已有节点不重复动画。动画遵循
`prefers-reduced-motion`。空板块不创建标题、间距或占位。滚动位置、键盘焦点、生词按钮状态、
拖动位置和窄屏视口约束保持不变。

## 8. 协议与错误

wire v3 增加通用错误码：

```text
MODEL_PROVIDER_NOT_CONFIGURED
MODEL_PROVIDER_AUTH_FAILED
```

错误映射：

- 钥匙串项缺失：`MODEL_PROVIDER_NOT_CONFIGURED`；
- HTTP 401/403：`MODEL_PROVIDER_AUTH_FAILED`；
- HTTP 429 且错误码明确表示额度不足：`QUOTA_EXCEEDED`；
- 其他 HTTP 429：`RATE_LIMITED`；
- 网络、DNS、TLS、HTTP 502–504：`NETWORK_ERROR`；
- 外部超时或流停滞：`TIMEOUT`；
- 用户关闭、新选区或 Escape：`CANCELLED`；
- 400、重定向、非法 SSE、拒答、错误 Schema、超限、未知终态：`INVALID_RESPONSE`；
- 无法安全分类的本机错误：`INTERNAL_ERROR`。

API 失败后保留已经验证的安全预览并显示“内容未完整生成”，与 Codex 失败语义一致。认证、网络、
超时和无效响应允许显式重试；额度不足和限流在当前结果页禁用立即重试。

health v3 增加当前 `provider` 和 `model`。Codex 模式继续报告已验证 Codex 版本；API 模式不假装
Codex 是活动 Provider。该结构为未来设置页显示当前状态提供只读基础。

## 9. 安全与隐私

API 模式只向 OpenAI 发送当前英文选区、最多 2,000 字符上下文、可用的英文句子语境和固定分析
指令。不发送 URL、标题、整页内容、浏览历史、欧路授权、API Key、Codex 认证或模型输出历史。

网页输入和流式模型输出都视为不可信。Prompt 注入文本只能作为 JSON 编码的待分析数据；模型无权
改变 endpoint、模型、Provider、工具、Schema、存储或安全策略。

默认测试只使用 fake Keychain reader 和 fake fetch，不访问 OpenAI、Codex、真实钥匙串或欧路。
只有显式真实 smoke/compare 命令可以消耗 ChatGPT/Codex 额度或 OpenAI API 费用。

ChatGPT/Codex 订阅与 OpenAI Platform API 分开计费。启用 API Provider 必须同时完成隐藏钥匙串
配置和显式 Provider 切换，任一缺失都不能产生 API 请求。

## 10. CLI 与安装生命周期

新增根命令：

```text
pnpm host:openai:configure -- --dry-run
pnpm host:openai:configure
pnpm host:openai:remove -- --dry-run
pnpm host:openai:remove
pnpm host:provider:set api
pnpm host:provider:set codex
pnpm host:provider:status
pnpm smoke:compare
```

Provider set/status 对目标配置路径执行所有权、普通文件和严格 Schema 校验。`status` 只输出当前模式，
不读取 Key，不调用网络。

安装和升级继续验证 Codex，因为 Codex 仍是默认和受支持的基线 Provider；同时验证
`/usr/bin/security` 可执行。安装不要求 OpenAI Key，不创建默认 Keychain 项，不覆盖 Provider
配置。首次安装缺失配置文件时默认 Codex。

## 11. 测试设计

### 11.1 默认离线测试

必须覆盖：

- Provider 配置缺失默认 Codex、严格解析、符号链接拒绝、`0600` 原子写入、升级保留和卸载；
- CLI set/status、dry-run、未知模式、无额外参数和稳定输出；
- OpenAI Keychain 精确参数、隐藏输入、无 `-A`、逐次读取、轮换、缺失、锁定、超时和不泄漏；
- Responses 固定 URL/Header/body、`store: false`、`stream: true`、无工具、无 Cookie、拒绝重定向；
- SSE 任意 chunk 边界、CRLF、多行 data、UTF-8、事件大小、累计大小、取消、超时和所有错误映射；
- 只接受唯一文本 output 和唯一成功终态，拒绝拒答、工具、未知形状、重复/迟到终态；
- API 最终结果继续通过私有 Schema、可信组装和公共 Schema；
- Router 每请求读取配置、活动请求固定 Provider、无自动回退、API warmup 不调用网络；
- tokenizer 在每个字符边界正确产生 string delta、array item 和 complete value；
- 数组逐项 Zod 校验、累计事件、最终一致性、错误条目和数量上限；
- rAF 一帧一次、终态 drain、关闭清空、DOM 节点复用、只追加列表项、焦点/滚动保持；
- `textContent` 安全、空板块隐藏、reduced motion、窄屏和生词按钮不回归；
- Manifest 权限仍严格为 `["nativeMessaging"]`；
- wire v3 拒绝 v2，Extension/Host 版本统一为 `0.5.0`。

默认质量门禁保持：

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
git diff --check
```

### 11.2 真实 A/B

`pnpm smoke:compare` 不属于默认门禁，只有用户显式授权后运行。它对相同固定样本依次测试：

```text
Codex:       gpt-5.4-mini + low
API baseline: gpt-5.4-mini + low
API fast:     gpt-5.6-luna + none
```

固定样本包含 `investigation`、`sustained`、`victims`、`accountable`、`Four`、短语、单句和多句
段落。工具只输出 Provider/模型标签和计时统计，不输出 Prompt、选区、上下文、Key 或模型文本。

记录：

- Host 请求开始；
- Provider 开始；
- 上游请求发出；
- 首个原始 delta；
- 首个通过校验的可显示内容；
- 每个板块/条目到达；
- 完整严格结果；
- P50、P90、无效结果数和取消结果。

初步成功标准：

- API fast 首个可见内容 P50 相对 Codex 至少提升 30%，目标低于 2 秒；
- API fast 完整结果 P50 相对 Codex 至少提升 20%；
- 所有固定质量样本通过严格结果和既有语义回归；
- 搭配、核心词义、相似词和同义词能逐条显示；
- 取消能中止 fetch，迟到 SSE 不能改写浮层；
- 无 Key、模型内容或网页内容进入计时输出。

如果 API 没有达到速度或质量标准，Codex 继续保持默认；实验结果不触发自动切换。

## 12. 文档与发布

实现时同步更新：

- `README.md`；
- `CONTRIBUTING.md`；
- `docs/architecture.md`；
- `docs/protocol.md`；
- `docs/security.md`；
- `docs/testing.md`；
- `docs/setup-macos.md`；
- 根和 Native Host、Extension、Protocol 的 `AGENTS.md`。

v0.5.0 升级步骤固定为：构建、刷新 Chrome 扩展、重新安装 Host、隐藏配置 OpenAI Key、显式切换
到 API、执行小规模真实验证。回滚时先切回 Codex；不需要删除 OpenAI Key，除非用户显式要求。

## 13. 非目标

本设计不包含：

- 扩展设置页或 Provider 下拉框；
- 自动 Provider 选择、自动回退或自动重试；
- API Key 粘贴到扩展、命令参数、环境变量或普通配置文件；
- 用户自定义 endpoint、模型、effort、Prompt 或 Schema；
- 云端代理、用户账号、用量账单 UI 或成本预算系统；
- 持久化查询、结果、性能遥测或分析历史；
- Windows、Linux、Firefox、Edge 或 Chrome Web Store 发布。
