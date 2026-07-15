# 划译 OpenAI-Compatible HTTP Provider 设计

日期：2026-07-15  
目标版本：0.6.0  
状态：已确认

## 1. 背景与目标

划译 0.5.0 已提供两个分析路径：

- 通过 ChatGPT 登录态调用 Codex；
- 通过 macOS 钥匙串中的官方 OpenAI API Key 调用固定的
  `https://api.openai.com/v1/responses`。

用户当前使用的第三方服务提供 OpenAI Responses 兼容接口，但只有明文 HTTP：

```text
base URL: http://101.133.153.118:9090/v1
responses URL: http://101.133.153.118:9090/v1/responses
```

服务端模型列表确认包含 `gpt-5.4-mini` 与 `gpt-5.6-luna`。经用户明确确认，本版本允许划译
接入该 HTTP 服务，同时必须做到：

- 不改变、不读取和不写入用户的 Codex CLI Provider 配置；
- 不削弱官方 OpenAI Provider 的严格安全边界；
- 第三方端点、Key、解析器和真实测试均与官方 Provider 隔离；
- 明文传输风险必须持续可见，不能被默认值或自动迁移隐式开启；
- 保留未来由扩展设置页配置 Provider 的接口边界，但 0.6.0 不实现设置页。

## 2. 已验证事实

### 2.1 路径与模型

无 Authorization 的探测结果：

- `/responses` 与 `/v1/responses` 都在路由前返回 401；
- `/models` 返回 HTML；
- `/v1/models` 返回标准模型列表 JSON。

因此 Host 使用 `baseUrl + "/responses"`，其中本次 `baseUrl` 为：

```text
http://101.133.153.118:9090/v1
```

### 2.2 单次延迟

使用同一条无敏感测试语料和严格 JSON Schema 得到：

| 路径                  | 首个文本 delta |     完成 |
| --------------------- | -------------: | -------: |
| `gpt-5.4-mini + low`  |       3,633 ms | 7,386 ms |
| `gpt-5.6-luna + none` |       6,074 ms | 9,682 ms |

同轮 Codex 八用例 P50 为首个可见更新 2,849 ms、严格完成 5,341 ms。以上数据只用于选择默认
模型，不承诺第三方 API 一定比 Codex 更快。0.6.0 默认使用 `gpt-5.4-mini + low`。

### 2.3 SSE 方言差异

第三方服务能接受 0.5.0 的请求体和严格 JSON Schema，但事件流不是官方 OpenAI 的严格子集：

- 在标准生命周期前增加 `codex.rate_limits`；
- 在 assistant message 前增加一组 reasoning item added/done；
- assistant message 有 `response.content_part.added`、delta 和 `response.output_text.done`；
- 未发送 assistant message 的 `response.content_part.done` 与 `response.output_item.done`；
- `response.completed` 与官方事件存在字段差异。

因此不能通过“忽略所有未知事件”接入，也不能放宽现有官方解析器。

## 3. 架构

依赖方向保持：

```text
extension ──> protocol <── native-host
```

Native Host 新增第三个独立 Provider：

```text
RoutingAnalysisProvider
├── CodexAppServerProvider
├── OpenAIResponsesProvider
└── CompatibleHttpResponsesProvider
```

### 3.1 Provider 身份

公共 `ModelProvider` 增加：

```ts
type ModelProvider = "codex" | "openai-responses" | "openai-compatible-http";
```

旧版 Extension 会拒绝未知 Provider，因此公共 wire protocol 升级到 `schemaVersion: 4`，Extension
与 Host 必须同步升级。Host 和各 workspace 包统一升级为 `0.6.0`。

### 3.2 Provider 路由

- 每个分析请求开始时只读取一次 Huayi Provider 配置；
- 请求固定到所选 Provider，进行中不迁移；
- 第三方请求失败时不自动回退 Codex 或官方 OpenAI；
- 新请求能看到最新配置，无需重启 Native Host；
- warmup、health 和 dispose 继续按 Provider 边界执行；
- compatible health 不读取 Codex 配置、不启动 Codex，也不发送 HTTP。

## 4. 与 Codex CLI 的完全隔离

第三方 Provider 禁止读取、修改或推断：

- `~/.codex/config.toml`；
- `~/.codex/auth.json`；
- `[model_providers.*]`；
- Codex 默认模型、effort、登录态或 session；
- `OPENAI_API_KEY`、Codex Provider 环境变量或用户 shell 配置。

所有第三方状态只存在于：

```text
~/Library/Application Support/Huayi/native-host/provider.json
~/Library/Application Support/Huayi/native-host/compatible-http.json
macOS Keychain
```

`provider.json` 只保存当前 Provider 选择，`compatible-http.json` 只保存第三方端点与模型配置。
`host:provider:set` 不写 compatible 配置。安装、升级、回滚和卸载均不触碰 Codex 文件。Codex
模式仍使用安装时验证过的显式 Codex 可执行文件和现有 ChatGPT 登录。

## 5. 本机配置

### 5.1 Provider 选择与 compatible 配置分离

`provider.json` 保持小型严格选择器：

```json
{
  "schemaVersion": 1,
  "provider": "openai-compatible-http"
}
```

新增独立的 `compatible-http.json`：

```json
{
  "schemaVersion": 1,
  "baseUrl": "http://101.133.153.118:9090/v1",
  "model": "gpt-5.4-mini",
  "effort": "low",
  "allowInsecureHttp": true
}
```

约束：

- 对象拒绝未知字段；
- `baseUrl` 必须是绝对 HTTP URL，不允许用户名、密码、query、fragment 或尾随 `/responses`；
- Host 只拼接一个固定 `/responses`；
- `allowInsecureHttp` 必须是字面量 `true`，缺失或为 false 都拒绝；
- 模型只允许 `gpt-5.4-mini` 与 `gpt-5.6-luna`；
- effort 与模型使用固定组合：`gpt-5.4-mini + low` 或 `gpt-5.6-luna + none`；
- 文件必须是当前 UID 所有、非符号链接普通文件、权限精确 `0600`，并受现有大小限制；
- set 和 dry-run 都必须在写入前验证已有目标，非法目标保持原样。

将两份文件分离后，可以在当前 Provider 仍为 Codex 时先配置、验证并 smoke 第三方服务；只有
smoke 成功后才修改 `provider.json`。

网页、Content Script、扩展消息、环境变量和模型输出均不能覆盖端点、模型、effort 或
`allowInsecureHttp`。

### 5.2 CLI

新增命令：

```text
pnpm host:compatible:key:configure
pnpm host:compatible:key:remove -- --dry-run
pnpm host:compatible:key:remove

pnpm host:compatible:config:set -- \
  --base-url http://101.133.153.118:9090/v1 \
  --model gpt-5.4-mini \
  --effort low \
  --allow-insecure-http
pnpm host:compatible:config:status
pnpm host:compatible:config:remove -- --dry-run
pnpm host:compatible:config:remove
```

Provider 设置命令只负责选择已经配置并验证过的 Provider：

```text
pnpm host:provider:set -- compatible-http
```

回滚保持：

```text
pnpm host:provider:set -- codex
```

`provider-status` 只输出当前 Provider。`host:compatible:config:status` 输出端点、模型和固定的明文
风险警告，但不输出 Key 或钥匙串元数据。

## 6. 凭据隔离

第三方 Key 使用独立钥匙串项：

```text
service: com.huayi.codex_bridge.compatible_http
account: api-key
label: Huayi OpenAI-Compatible HTTP API Key
```

约束与官方 OpenAI Key 相同：

- 配置命令固定调用 `/usr/bin/security`；
- `add-generic-password -U ... -w` 中 `-w` 必须是最后一个参数；
- 禁止通过 CLI 参数、环境变量、普通文件、扩展消息或聊天接收 Key；
- Host 每次请求重新读取，不缓存；
- Key 不进入 stdout、stderr、Native Messaging、错误消息、快照或测试日志；
- 移除只删除精确 service/account；
- 默认测试只使用 fake Keychain。

当前已经写入官方 OpenAI 钥匙串项的第三方 Key 不会自动读取、复制或删除。新专用项验证成功后，
删除旧官方项仍需用户单独授权。

## 7. HTTP 客户端边界

- 仅 compatible Provider 接受 HTTP；官方 Provider 仍固定 HTTPS；
- 请求使用固定 POST、`redirect: "error"`、`credentials: "omit"`；
- 不发送 Cookie，不自动重试；
- Authorization 仅为 `Bearer <Key>`；
- 请求体继续固定 `store: false`、`stream: true`、无 tools、严格 JSON Schema；
- 单请求超时 60 秒，错误正文上限 64 KiB，模型输出上限 1 MiB；
- AbortSignal 必须传播到钥匙串读取、HTTP 和流解析；
- 取消或超时后不回滚第三方请求，也不自动重发。

安全文档必须明确：在该 Provider 下，API Key、当前英文选区、上下文和句子会通过明文 HTTP
传输，可能被同一路径上的网络设备或第三方截获、读取或篡改。

## 8. Compatible SSE 适配器

官方 `parseOpenAIResponseEvent` 与官方生命周期状态机保持不变。新增专用 parser 和状态机，只接受
实测方言。

### 8.1 允许的固定生命周期

```text
optional codex.rate_limits
response.created
response.in_progress
optional reasoning output_item.added
optional matching reasoning output_item.done
assistant message output_item.added
response.content_part.added(output_text, empty text)
one or more response.output_text.delta
response.output_text.done
response.completed
```

约束：

- `codex.rate_limits` 最多一个，只能位于开头，使用严格有界 Schema 校验后丢弃；
- reasoning 必须完整成对、位于 assistant message 前，最多一个，不渲染、不记录内容；
- reasoning item 不能是 tool、function call、web search 或 refusal；
- 恰好一个 assistant message、一个 output_text part；
- delta 必须非空、按顺序累计并受 1 MiB 限制；
- `response.output_text.done.text` 必须等于累计 delta；
- compatible 流允许省略 assistant 的 `content_part.done` 与 `output_item.done`；
- `response.completed` 中最终 assistant 文本必须等于累计 delta；
- 序号存在时必须连续；仅对实测确实缺失序号的 compatible 终止事件允许缺失；
- 终止事件后任何额外事件都拒绝；
- 未知事件、第二个消息、额外 content part、tool、refusal、failed、incomplete 或错误结构全部
  fail closed。

### 8.2 最终结果

模型文本继续经历三层验证：

1. 私有模型 JSON Schema；
2. Host 可信字段组装；
3. `@huayi/protocol` 公共结果 Schema。

只有验证后的字段才变成现有 `analysis-delta`、`analysis-section` 与 `result` 事件。Extension 不需要
识别第三方 SSE，也不直接接触端点或 Key。

## 9. 错误与用户可见行为

错误映射：

- 401 → `OPENAI_AUTH_FAILED`；
- 403/429 → `RATE_LIMITED`；
- 网络断开、TLS 不适用错误、502–504 → `NETWORK_ERROR`；
- 60 秒超时 → `TIMEOUT`；
- 非法事件、Schema 或终止文本不一致 → `INVALID_RESPONSE`；
- 用户取消 → `CANCELLED`；
- 本机第三方 Key 未配置 → `OPENAI_NOT_CONFIGURED`，但文案明确是 compatible Provider。

不返回第三方错误正文、端点响应内容或 Key。第三方失败不遮挡已经验证并展示的流式内容，但以现有
内联错误结束，允许用户切回 Codex。

## 10. 测试

### 10.1 默认离线测试

使用 fake Keychain、fake fetch 和脱敏后的 SSE fixture 覆盖：

- 三种 Provider 身份与 protocol v4；
- compatible 配置合法组合、未知字段、错误模型/effort、URL 凭据/query/fragment；
- Provider 选择与 compatible 配置相互独立，配置和 smoke 均不改变当前 Provider；
- 缺少显式 HTTP 风险确认；
- 当前 UID、精确 `0600`、符号链接、目录、超大文件和非法目标不覆盖；
- 第三方与官方 Keychain service/account 完全隔离；
- 固定 URL/Header/Body、无 Cookie、无重定向、无重试；
- 实测合法事件方言；
- rate-limit 位置/重复、reasoning 缺边/重复、第二消息、tool、refusal、未知事件；
- delta/done/completed 不一致、超大流、取消和超时；
- 路由按请求固定、下一请求切换、无 fallback；
- compatible health 不访问网络或钥匙串；
- Extension 流式 DOM、取消、错误文案和欧路行为无回归；
- Manifest 权限仍严格等于 `["nativeMessaging"]`。

默认 `pnpm test`、`pnpm test:e2e` 和 `pnpm build` 不访问第三方、OpenAI、Codex 或欧路。

### 10.2 显式真实 smoke

新增：

```text
pnpm smoke:compatible
```

该命令必须：

- 只在用户明确授权后运行；
- 从第三方专用 Keychain 读取 Key；
- 使用本机 compatible 配置，不接受临时 endpoint/model/prompt 参数；
- 输出匿名 case ID、成功/无效/取消计数及首 delta/完成耗时；
- 不输出 Key、Authorization、原文、上下文、Prompt 或模型结果；
- 任一固定质量用例未通过严格最终 Schema 时退出非零。

## 11. 发布与回滚

发布顺序固定：

1. 构建并通过完整离线门禁；
2. 使用隐藏提示写入第三方专用 Key；
3. 写入独立 compatible 配置并检查 `host:compatible:config:status` 风险警告；
4. 保持 `provider.json` 和当前请求路径不变，先运行 `pnpm smoke:compatible`；
5. smoke 全部通过后才执行 `pnpm host:provider:set -- compatible-http`；
6. 重新安装 0.6.0 Host；
7. 在 Chrome 刷新 unpacked Extension；
8. 手测单词翻译、单词解释、句子解释、取消和欧路生词本；
9. 若质量、速度或稳定性不满意，立即执行 `pnpm host:provider:set -- codex`。

不得在未通过 compatible smoke 时自动切换。不得自动删除官方 OpenAI 或第三方钥匙串项。

## 12. 当前不做

- 不为 HTTP 增加“看起来安全”的伪 TLS 标识；
- 不关闭官方 OpenAI 严格 parser；
- 不忽略任意未知 SSE 事件；
- 不读取 Codex `model_providers` 配置；
- 不新增扩展设置页；
- 不从网页、扩展消息或环境变量接收 endpoint/Key；
- 不自动 fallback、重试、模型切换或 Key 迁移；
- 不删除当前官方 OpenAI Keychain 项。

## 13. 验收标准

- Codex CLI 配置、登录、模型和 Provider 在安装、切换、smoke 与卸载前后均不变；
- compatible 端点只能通过显式本机命令和 `allowInsecureHttp: true` 配置；只有单独的
  `host:provider:set` 能把请求路径切换到 compatible；
- 第三方 Key 只进入专用钥匙串、Host 内存和目标 HTTP Authorization Header；
- 官方 Key 不会发送给第三方，第三方 Key不会发送给官方 OpenAI；
- 官方 OpenAI parser 的测试与行为不放宽；
- 实测 compatible 方言严格通过，所有未列出的事件和顺序 fail closed；
- `gpt-5.4-mini + low` 为默认，真实 smoke 记录匿名速度和严格质量结果；
- 扩展权限不增加，网页无法配置端点或读取凭据；
- 默认质量门禁完全离线并全部通过；
- 0.6.0 Host/Extension 同步安装，且一条命令可以回滚到 Codex。
