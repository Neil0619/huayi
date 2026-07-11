# 测试策略

## 自动测试

- 协议：严格字段、`add-word`/`word-added` 联合类型、数量和长度限制、错误码。
- 选区：英文检测、四类分类、语义块提取、2,000 字符裁剪、编辑区排除；生词句子另覆盖
  嵌套节点、重复单词、缩写、引号、无句末标点、超长句和中英混合回退。
- 浮层：状态机、定位、拖动、关闭、加载、结果和错误视图；欧路按钮覆盖双击去重、成功/
  已存在/内联错误、限流禁用及滚动和焦点保持。
- Service Worker：分析与加词请求路由、同标签页取消、终态匹配、迟到响应、断线与超时。
- Native Host：二进制帧、分发、并发队列、取消和 fail-closed。
- Codex Provider：固定参数、环境允许列表、stdin、Schema、错误映射和提示注入。
- 欧路 Provider：查询后新增、已存在不写入、固定 URL/Header/Body、串行、取消、超时、拒绝
  重定向、64 KiB 响应上限和 HTTP 状态映射。
- 安装器与钥匙串：dry-run、重复安装、allowed origin、精确参数、隐藏输入、无 `-A`、轮换、
  缺失/锁定/超时、凭据不泄漏、卸载顺序和幂等清理。
- Manifest：权限数组严格等于 `["nativeMessaging"]`，不存在 `host_permissions`。

默认测试使用 fake process runner、fake Keychain/authorization reader、fake fetch 和 mock
transport，不访问 OpenAI、真实钥匙串或欧路 API。

安装器测试只在系统临时目录构造带空格和单引号的 fake HOME，验证 launcher 的 POSIX 引号、
可执行位、Chrome 清单、升级替换、所有权冲突和幂等卸载。仓库级验证只运行一次真实 dry-run，
它可以检查 Codex 登录与能力，但不会调用模型或写入用户安装目录。

浏览器 E2E 通过 Vite fixture 串起真实 Content Script、Service Worker 消息处理、请求协调器和
Mock NativeTransport，覆盖双击、拖选、四类结果、错误重试、新选区/关闭取消、Escape 与
320px 窄屏拖动约束。欧路旅程覆盖单词翻译和解释成功、已存在、未配置、授权失效、网络
重试、限流和关闭取消。Escape 用例曾复现 `keyup` 重新打开工具条的问题，并保留了单元与
浏览器双重回归测试。

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
只比较 `~/.codex/sessions` 的相对文件名，不读取 session 或认证内容。脚本经二进制 Native
Messaging 接口调用构建后的真实 Host，四类结果再次通过公共协议校验；最近一次 v0.1.0
证据未创建新的会话文件，段落译文也实际保留了输入换行。

真实欧路验收不属于自动门禁。只有用户显式配置钥匙串后，才手动新增一个未收藏单词并核对
语境；第二次添加应返回“已在生词本”，且不得覆盖原分组、星级或语境。
