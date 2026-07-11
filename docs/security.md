# 安全与隐私

## 数据最小化

扩展只发送选区和所在段落中围绕选区的最多 2,000 个字符，不发送 URL、标题、整页内容、
浏览历史或用户身份数据。扩展不持久化查询和结果，也不采集分析数据。

用户在单词结果页显式点击“加入欧路生词本”时，扩展只向 Native Host 发送原始选中词形和
包含它的完整英文句子；不发送 URL、标题、段落、模型输出或其他页面信息。Native Host 随后
将这两个字段发送到固定的欧路 HTTPS 生词本接口，除此之外不进行欧路写入。

## 浏览器边界

第一版权限仅包含 `nativeMessaging` 以及普通 `http/https` 页面上的 Content Script。
模型输出只能使用 `textContent` 渲染，不能作为 HTML 执行。Native Messaging 清单只允许
安装时提供的扩展 ID。

`manifest.json` 不声明 `host_permissions`、`storage`、`tabs`、`activeTab`、`scripting` 或网络
请求权限；`http/https` 范围只出现在静态 Content Script 的 `matches`。Content Script 不能
调用 Native Messaging，只能发送经过严格解析的内部命令给 Service Worker。v0.2.0 也不增加
设置页或远程托管扩展代码。

欧路网络访问只发生在 Native Host。请求固定为 `api.frdic.com` 的单词查询和新增路径，禁止
网页、协议消息或环境变量覆盖 URL；拒绝重定向、Cookie 和自动重试。单次 HTTP 操作最长
10 秒，响应体最多 64 KiB。状态码、JSON 和响应流均视为不可信；远端响应正文、诊断信息和
授权值不会返回扩展或写入日志。

欧路官方限额为每分钟 30 次、每 30 分钟 500 次，并用 403 表示访问过频。Host 不自动重试，
避免放大写入和限流风险；用户修复网络或授权后可在结果页显式重试，当前结果一旦限流则禁用
继续点击。

## 欧路授权与钥匙串

授权固定存入以下 macOS 钥匙串项：

```text
service: com.huayi.codex_bridge.eudic
account: authorization
label: Huayi Eudic OpenAPI Authorization
```

Host 每次显式加词都重新读取，不在内存中长期缓存。读取使用固定 `/usr/bin/security`、参数
数组和 `shell: false`，最长 5 秒，stdout/stderr 各最多 8 KiB；只接受 1–4,096 字符且不含
首尾空白、换行、NUL 或控制字符的完整 Authorization Header 值。

`host:eudic:configure` 使用 `add-generic-password -U`，把无参数的 `-w` 放在最后，让系统在
终端隐藏读取完整授权。命令不使用 `-A`，也不通过命令参数、环境变量、配置文件或扩展消息
接收授权；配置本身不调用欧路 API，有效性在第一次显式加词时验证。Token 只短暂存在于
`security`/Host 进程内存和 HTTPS Authorization Header，不进入 Native Messaging、日志、
错误信息、快照或测试输出。

钥匙串保护的是静态存储，不能防御以同一 macOS 登录用户权限运行的恶意进程，也不能替代
终端和用户账户本身的安全。自动测试只使用 fake process runner、fake authorization reader
和 fake fetch，不能读取真实钥匙串项。

## 本机进程边界

Native Host 通过参数数组和 stdin 启动 Codex，禁止 `shell: true`。子进程使用专用空目录、只读
沙箱、禁用 Web Search、禁止审批、忽略用户配置和规则，并使用 `--ephemeral`。Host 不读取
Codex 认证文件，只调用 `codex login status` 检查状态。

当前已验证的 CLI 基线还显式关闭 `shell_tool`、`unified_exec` 和 `shell_snapshot`，避免模型
通过默认命令工具读取本机文件或抓取 shell 环境。能力探测要求 CLI 支持 `--disable`，缺失时
安装失败，不能静默回退到带 shell 的运行方式。

启动参数还启用严格配置解析、关闭历史持久化并禁止 Codex 子命令继承 Host 环境。Host 自身
只向 Codex 传递 `PATH`、`HOME`、`CODEX_HOME`、locale、临时目录、证书和代理相关允许列表；
`OPENAI_API_KEY`、`NODE_OPTIONS` 及其他任意变量不会传入。`HOME`/`CODEX_HOME` 仅用于让
Codex CLI 自行使用现有登录，Host 不读取、复制或解析其中的认证文件。

每次模型进程最长运行 60 秒，取消和超时都会终止子进程；stdout 与 stderr 各自最多接收
1 MiB。可执行文件、Schema 目录和空工作目录使用安装器提供的绝对路径，缺失能力或非法路径
不做降级。

网页文字被明确标记为不可信数据。即使选区包含“忽略规则”“执行命令”等提示，也只能作为
JSON 数据中的待翻译或解释文本。所有请求与结果必须经过严格 Schema 校验，模型返回的原文
和选区类型还必须与请求完全一致。日志、CLI stderr 和本机路径不发送给扩展。

`--ephemeral` 的边界是“不保存可恢复的 session rollout”，不是“Codex 进程绝不写任何
文件”；例如 CLI 自身可能维护认证状态。冒烟测试只比较 session 目录，不读取认证文件。
最近一次真实 Codex 证据来自 v0.1.0：四类请求运行前后没有出现新的 session 文件。

当前 Codex CLI 没有一个可验证的全局 `--no-tools` 开关；`read-only` 本身允许读取而不是禁止
读取。关闭三类 shell 能显著缩小网页提示注入的本机读取面，但不能证明未来或其他独立工具
永远无法读取文件。因此版本升级必须重新审查可用工具和配置，不能把本方案描述成绝对隔离。

## 外部写入

安装器只有在显式执行后才写入 `~/Library/Application Support/Huayi/native-host/` 和 Chrome
用户级 Native Messaging 清单目录。dry-run 完成全部只读验证，不创建目录。安装前会拒绝
没有 Huayi 所有权标记的既有目录和非本项目清单；升级只替换固定 bundle、Schema、workdir
和 launcher，并拒绝可逃逸安装根目录的 provider 符号链接。安装与升级只检查
`/usr/bin/security` 可执行，不要求已经配置欧路，也不读取或覆盖已有钥匙串项。launcher
使用受控 `PATH`，只持久化认证目录的路径，不存储 Token。

卸载器先删除上述精确 service/account，再验证标记与清单所有权并只删除两个 Huayi 文件
目标；钥匙串删除失败时保留 Host 文件以便重试，项目缺失该钥匙串项时保持幂等。独立的
`host:eudic:remove` 也只操作这一项，不删除其他凭据或父目录。
