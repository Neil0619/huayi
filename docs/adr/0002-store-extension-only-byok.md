---
status: accepted
---

# Store Edition 使用纯扩展 BYOK 和独立身份

Store Edition 使用新的 Chrome Web Store 身份，在扩展内直接连接 OpenAI 或 DeepSeek，并由用户
提供凭据；Classic Edition 冻结为只接受严重安全或兼容性修复的维护线。这样移除 Native
Messaging 安装门槛和自有账户、后端、计费责任，同时明确放弃 Codex、OpenAI-compatible Host
以及 Classic 凭据的自动迁移。

## Considered Options

- 延续 Native Host：可保留系统凭据库和 Codex，但不适合商店的一步安装体验。
- 自有代理后端：可隐藏 Provider 凭据，但会引入账户、费用、隐私和运营责任。

## Consequences

Store Edition 与 Classic Edition 可以并存，但代码、扩展 ID、数据和发布生命周期彼此独立。
