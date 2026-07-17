# DeepSeek V4 Flash Provider 设计

目标版本：0.7.0；Native Messaging `schemaVersion` 保持为 4。

## 目标与非目标

新增独立 `deepseek-chat-completions` Provider，固定调用官方
`https://api.deepseek.com/chat/completions` 和 `deepseek-v4-flash`，以非思考 JSON Output 流式
生成现有四类分析结果。保留 Codex、官方 OpenAI Responses 和 Compatible Provider；配置 Key、
真实 smoke 与切换 Provider 互相独立，失败时不自动重试或回退。

本版本不增加浏览器设置页、Chrome 权限、远程扩展代码、endpoint/model 配置能力或 wire 分析
字段。DeepSeek 不读取、修改或依赖 `~/.codex`。

## 请求与流生命周期

请求固定包含 `stream: true`、`thinking: { type: "disabled" }`、
`response_format: { type: "json_object" }`、`temperature: 0` 和 `max_tokens: 4096`。system message
承载固定分析规则、精简 Schema 与合法示例；user message 只承载被标为不可信的选区、最多
2,000 字符上下文及可用英文句子。

客户端接受 data-only SSE、UTF-8 任意分片、keep-alive 注释、单 choice、固定响应 ID/模型、
正常 `stop` 和最终 `[DONE]`。每个 `delta.content` 送入现有 `StreamingJsonFieldExtractor`，最终
完整 JSON 经 provider 私有 Schema、可信 Host 元数据组装和公共 Zod Schema 校验。非空
`reasoning_content`、截断、内容过滤、缺失 `[DONE]`、未知结构、空 JSON、事件超过 64 KiB 或
流超过 2 MiB 均失败关闭。

官方终止 chunk 可以携带 usage 对象；Host 仅接受有界、严格的官方 token 计数字段，包括
`prompt_tokens_details.cached_tokens` 与可选的
`completion_tokens_details.reasoning_tokens`，校验后立即丢弃，不得将 usage 写入日志、
Native Messaging 或 smoke 输出。

## 凭据、网络和错误

Key 存于 `com.huayi.codex_bridge.deepseek` / `api-key`，每次请求通过固定
`/usr/bin/security` 重新读取。Key 不通过参数、环境、文件、Extension、wire 或日志传递。
客户端使用 Node 18 内置 `fetch`、`redirect: "error"`、`credentials: "omit"`、60 秒超时、
64 KiB 错误体上限，不发送 Cookie、不重试。

HTTP 401/403 映射 `MODEL_PROVIDER_AUTH_FAILED`，402 映射 `QUOTA_EXCEEDED`，429 映射
`RATE_LIMITED`，500/502/503/504 映射 `NETWORK_ERROR`，400/422、重定向和协议错误映射
`INVALID_RESPONSE`；本地取消和超时分别映射 `CANCELLED` 与 `TIMEOUT`。

## 发布与验证

health 固定报告 `provider: deepseek-chat-completions`、`model: deepseek-v4-flash` 和
`codexVersion: null`。所有默认测试使用 fake Keychain/fetch 并保持离线。真实
`pnpm smoke:deepseek` 只在用户配置隐藏 Key 并另行授权后运行，覆盖单词、短语、句子、段落及
`hatch` 安全上下文，输出匿名首个可见内容与完整结果耗时。只有全部结果通过严格 Schema 后才
安装、刷新并显式切换。

接口依据：[DeepSeek API 快速开始](https://api-docs.deepseek.com/)、
[思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)、
[JSON Output](https://api-docs.deepseek.com/guides/json_mode/)。
