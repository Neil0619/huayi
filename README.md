# 划译

“划译”是一款面向 macOS Google Chrome 的个人划词翻译与英文解析扩展。它通过 Chrome
Native Messaging 调用本机已登录的 Codex CLI，不在扩展中保存 OpenAI API Key。

## ChatGPT Plus / Codex 使用边界

Native Host 通过 Codex App Server 复用本机现有的 ChatGPT 登录，因此不需要另购 OpenAI
API Key，但仍受当前 ChatGPT/Codex 账户额度、频率和网络限制。这不是“用 Plus 抵扣 API
费用”；ChatGPT 订阅与 OpenAI API 计费彼此独立。若未来发布商店版或增加云端 provider，
必须另外实现服务端鉴权、密钥管理、限流与成本控制。

## v0.3.0 能力

- 双击或拖选英文后显示“解释”和“翻译”工具条。
- 单词/短语翻译和解释、单句翻译和解析、多句段落翻译继续返回严格结构化结果。
- 核心中文字段由 App Server 实时增量展示，完整结果仍须通过 JSON Schema 和公共协议校验。
- 单词分析期间并行查询欧路生词本；已存在的单词在加载或结果阶段显示“已加入生词本”。
- 查询不存在或被动查询失败时，完整结果仍可显式加入；写入继续先 GET 防重复，再按需 POST。
- 自动查询只向欧路发送原始单词；只有用户点击添加时才发送原始词形和所在英文句子。
- App Server 按需启动并复用进程，但每次分析使用独立的 ephemeral thread；模型固定为
  `gpt-5.4-mini`，推理强度固定为 `low`。

欧路授权保存在 macOS 钥匙串，不进入扩展配置、仓库、Native Messaging 或日志。授权获取及
接口说明见[欧路 OpenAPI 开发指南](https://my.eudic.net/OpenAPI/Doc_Index)。

## App Server 安全边界

App Server 不提供 `codex exec` 的 ignore-user-config / ignore-rules 参数。划译不会伪造这些
开关，而是使用严格配置、显式禁用功能、专用空工作目录、固定模型/provider、只读无网络
沙箱、`never` 审批、空 Hook/MCP 配置和返回不变量校验。任何审批、Shell、文件修改、Web、
应用、Hook、MCP 或其他工具事件都会失败关闭。

## 当前范围

v0.3.0 只支持 macOS、Google Chrome 和普通 `http/https` 顶层网页，不支持 PDF、Chrome
内部页面、iframe、编辑器区域、其他操作系统、云端 API、历史记录、同步或后续对话。
Manifest 权限严格保持为 `nativeMessaging`。

## 开发入口

环境要求：Node.js 18+、pnpm、已通过 ChatGPT 登录且支持 App Server 的 Codex CLI。

```bash
pnpm install
pnpm check:instructions
pnpm build
pnpm test
pnpm test:e2e
pnpm host:install -- --extension-id <ID> --dry-run
```

默认测试全部使用 fake App Server、fake Keychain 和 fake fetch，不访问 OpenAI 或欧路。只有
显式执行 `pnpm smoke:codex` 才会调用真实模型并消耗订阅额度。

完整安装与升级步骤见 [macOS 安装说明](docs/setup-macos.md)，工程边界见
[架构文档](docs/architecture.md)。
