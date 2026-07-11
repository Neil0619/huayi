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

安装器测试只在系统临时目录构造带空格和单引号的 fake HOME，验证 launcher 的 POSIX 引号、
可执行位、Chrome 清单、升级替换、所有权冲突和幂等卸载。仓库级验证只运行一次真实 dry-run，
它可以检查 Codex 登录与能力，但不会调用模型或写入用户安装目录。

Codex Provider 的默认测试会把 `OPENAI_API_KEY` 和恶意网页提示放入 fake 输入，断言密钥不
进入子进程环境、网页文本只出现在不可执行的 JSON 数据区。测试同时覆盖 60 秒超时、取消、
1 MiB 输出上限、CLI 能力检查、非零退出、stdout 污染和请求/结果不匹配。

Host 测试将 stdout 作为原始字节重新解帧，确保正常路径只有合法事件帧；无效长度、超大
消息、无效 JSON 和无效 Schema 必须只在 stderr 留下诊断且停止读取。

## 浏览器测试

Playwright 覆盖双击、拖选、工具条动作、各结果类型、窄屏、视口边缘、取消、超时和错误。
稳定的核心结果卡使用 macOS Chrome 元素截图基线，避免布局、溢出和意外功能回归。

## 真实冒烟

`pnpm smoke:codex` 显式验证 `investigation`、`sustained heatwave`、单句和多句段落。运行前后
比较 `~/.codex/sessions`，确认 ephemeral 调用未创建新的会话文件。
