# 欧路词典生词本集成设计（v0.2.0）

## 目标与范围

在单词翻译或解释结果页增加“加入欧路生词本”操作，通过现有 Native Messaging Host 调用
欧路 OpenAPI。写入内容固定为网页中的原始选中词形和它所在的完整英文句子。

本版本不增加扩展设置页、Chrome 权限、查询历史、云端账号或欧路分组选择。短语、句子、
段落、分析加载页和初始操作工具条不显示生词本按钮。

## 用户体验

按钮只在以下条件全部成立时出现：

- 原始 `selectionKind` 为 `word`。
- 结果类型为 `translate-lexical` 或 `explain-lexical`。
- 已提取可用的 `wordbookContext`。

状态流固定为：

```text
加入欧路生词本 -> 正在添加… -> 已加入生词本 / 已在生词本
                                `-> 内联错误 -> 可重试
```

请求中和成功后按钮禁用，避免重复点击；限流错误在当前结果页禁用重试，未配置、授权失效、
网络和超时错误允许用户修复后重新点击。错误只显示在按钮旁，不覆盖翻译或解释。重新渲染须
保留结果区滚动位置和合理焦点。

## 句子语境

Content Script 根据真实 `Range` 计算选中词在最近语义块中的位置；网页只使用普通 `div`
承载正文且没有语义块时，使用最近的 `div` 文本容器，以免遗漏句子或在同一段落出现重复
单词时误取第一次出现的位置。优先使用英文 `Intl.Segmenter`，并以确定性的句末标点规则
回退；保留标点和引号，折叠换行与多余空白。

句子最多 2,000 字符，超长时围绕实际选区裁剪。提取结果含汉字或无法得到有效英文句子时，
退化为选中词本身。Codex 分析继续使用原有段落 `context`，两类上下文互不替代。

## 数据流与边界

```text
结果页按钮
  -> Content Script（原始词形 + 预提取句子）
  -> Service Worker（请求 ID、取消、终态校验）
  -> Native Host（严格协议、全局并发 2）
  -> WordbookProvider（欧路操作串行，并发 1）
  -> 平台凭据（macOS Keychain / Windows DPAPI；每次读取授权，不缓存）
  -> EudicClient（固定 HTTPS 端点）
```

`WordbookProvider` 与 `AnalysisProvider` 平行，欧路概念不得进入 Codex Provider 或公共分析
结果。扩展永远使用原始选中词形和句子，不使用模型返回的原形、同义词、翻译或解释。

## 协议

v0.2.0 在 `schemaVersion: 1` 中兼容增加：

- `add-word`：`requestId`、`language: "en"`、英文 `word`、英文 `context`。
- `word-added`：`added | already-exists`。
- 错误码：`EUDIC_NOT_CONFIGURED`、`EUDIC_AUTH_FAILED`。

单词允许内部连字符及直/弯英文撇号，拒绝短语、中文和未知字段。加词请求只能收到
`word-added` 成功终态；收到分析结果或其他不匹配终态时按 `INVALID_RESPONSE` 失败关闭。
新选区、关闭、Escape 和超时均发送定向 `cancel`，迟到事件不能重开或改写浮层。

## 欧路客户端

客户端使用 Node.js 18 内置 `fetch`，固定访问
`https://api.frdic.com/api/open/v1/studylist/word`，不接受网页、协议或环境变量提供 URL。

每次点击先 GET 查询：匹配单词存在则返回 `already-exists`，不 POST，从而不覆盖远端现有
分组、星级或语境；空数据或 404 视为不存在。不存在时 POST：

```json
{
  "language": "en",
  "word": "<原始选中词形>",
  "context_line": "<所在英文句子>"
}
```

不发送 `star` 或 `category_ids`，由欧路加入默认分组。只接受 201 和合法 JSON；禁用 Cookie、
重定向和自动重试，响应最多 64 KiB，HTTP 操作最长 10 秒。401 映射授权失效，403/429 映射
限流，502–504/TLS/网络失败映射网络错误。官方接口说明见
[欧路生词本 API](https://my.eudic.net/OpenAPI/doc_api_study)。

## 授权与安装生命周期

macOS 授权只存入固定钥匙串项：

```text
service: com.huayi.codex_bridge.eudic
account: authorization
label: Huayi Eudic OpenAPI Authorization
```

配置使用固定 `/usr/bin/security add-generic-password -U`，`-w` 必须最后一个参数以隐藏输入，
禁止 `-A`、`shell: true`、命令参数、环境变量或配置文件传 Token。Host 每次加词重新读取，
5 秒超时、8 KiB 输出上限，授权值限制 1–4,096 字符且不能含首尾空白或控制字符。

安装与升级只检查 `security` 可执行，不要求配置欧路且保留现有凭据。卸载先删除精确钥匙串
项，删除失败时保留 Host 文件；缺失项幂等。钥匙串保护静态存储，但不能防御同一 macOS
登录用户权限下的恶意进程。

Windows 使用独立的
`%LOCALAPPDATA%\Huayi\native-host\eudic-credential.xml`。配置命令通过固定 PowerShell
helper 的 `Read-Host -AsSecureString` 隐藏读取完整 Authorization 值，以用户名
`authorization` 构造 `PSCredential` 并用 `Export-Clixml` 保存。密码字段由 DPAPI 绑定当前
Windows 用户和机器；Host 每次查词或加词通过固定 helper 重新导入，不缓存。它与
`deepseek-credential.xml` 完全分离，不接受命令参数、环境变量、仓库文件或 wire 中的授权。
DPAPI 保护静态存储，但不能防御以同一 Windows 用户权限运行的恶意进程。Windows 安装和升级
保留两份 DPAPI 凭据；显式 `eudic-remove` 或完整卸载才会删除欧路授权。

## 权限与验证

Manifest 权限继续严格为 `["nativeMessaging"]`，没有 `storage`、`host_permissions`、设置页
或远程扩展代码。只有用户点击按钮才向欧路发送单词和句子，不发送 URL、标题、段落或模型
输出。

默认测试使用 fake Keychain、fake fetch 和 mock NativeTransport，不访问欧路或 OpenAI。
真实欧路验收只能在用户显式配置授权后手动执行。
