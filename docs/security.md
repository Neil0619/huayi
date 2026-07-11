# 安全与隐私

## 数据最小化

扩展只发送选区和所在段落中围绕选区的最多 2,000 个字符，不发送 URL、标题、整页内容、
浏览历史或用户身份数据。扩展不持久化查询和结果，也不采集分析数据。

## 浏览器边界

第一版权限仅包含 `nativeMessaging` 以及普通 `http/https` 页面上的 Content Script。
模型输出只能使用 `textContent` 渲染，不能作为 HTML 执行。Native Messaging 清单只允许
安装时提供的扩展 ID。

## 本机进程边界

Native Host 通过参数数组和 stdin 启动 Codex，禁止 shell。子进程使用专用空目录、只读
沙箱、禁用 Web Search、禁止审批、忽略用户配置和规则，并使用 `--ephemeral`。Host 不读取
Codex 认证文件，只调用 `codex login status` 检查状态。

网页文字被明确标记为不可信数据。即使选区包含“忽略规则”“执行命令”等提示，也只能作为
待翻译或解释的文本。所有请求与结果必须经过严格 Schema 校验。

## 外部写入

安装器只有在显式执行后才写入 `~/Library/Application Support/Huayi/native-host/` 和 Chrome
用户级 Native Messaging 清单目录。卸载器只删除这些精确路径。
