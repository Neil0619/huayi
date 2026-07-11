# 测试策略

## 自动测试

- 协议：严格字段、联合类型、数量和长度限制、错误码。
- 选区：英文检测、四类分类、语义块提取、2,000 字符裁剪、编辑区排除。
- 浮层：状态机、定位、拖动、关闭、加载、结果和错误视图。
- Service Worker：请求路由、同标签页取消、断线与超时。
- Native Host：二进制帧、分发、并发队列、取消和 fail-closed。
- Codex Provider：固定参数、环境允许列表、stdin、Schema、错误映射和提示注入。
- 安装器：dry-run、重复安装、幂等卸载和 allowed origin。

默认测试使用 fake process runner 和 mock transport，不访问 OpenAI。

## 浏览器测试

Playwright 覆盖双击、拖选、工具条动作、各结果类型、窄屏、视口边缘、取消、超时和错误。

## 真实冒烟

`pnpm smoke:codex` 显式验证 `investigation`、`sustained heatwave`、单句和多句段落。运行前后
比较 `~/.codex/sessions`，确认 ephemeral 调用未创建新的会话文件。
