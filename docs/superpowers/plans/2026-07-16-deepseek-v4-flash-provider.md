# DeepSeek V4 Flash Provider 实施计划

## 交付顺序

1. 在 `@huayi/protocol` 为 health 增加 `deepseek-chat-completions`，保持 wire v4 与现有分析语义。
2. 拆分固定 system/user Prompt，增加 DeepSeek 请求体、严格 data-only SSE 解码与 HTTP 错误映射。
3. 实现 `DeepSeekChatProvider`，复用增量字段抽取、四份私有 Schema、可信元数据组装和最终校验。
4. 将 Provider 接入逐请求路由、health、warmup、dispose 和错误映射，验证失败不 fallback。
5. 增加独立 Keychain reader、隐藏配置/移除命令、幂等卸载和显式 Provider 切换别名。
6. 增加受控 `smoke:deepseek`，只运行固定语料、输出匿名耗时且不切换 Provider。
7. 同步升级所有发布身份到 0.7.0，更新治理、架构、协议、安全、测试和 macOS 安装文档。
8. 运行完整离线质量门禁；真实 smoke、安装、Chrome 刷新和切换等待用户后续明确授权。

## 验收门禁

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
git diff --check
```

自动测试必须覆盖固定 URL/Header/body、禁用思考、JSON Output、system/user 隔离、SSE 任意分片
与上限、四类结果、全部错误映射、取消/超时、Keychain 安全、Provider 路由/health、安装升级及
无自动回退。默认门禁不得访问 DeepSeek、OpenAI、欧路、Codex 或真实钥匙串。
