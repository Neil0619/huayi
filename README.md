# 划译

“划译”是一款面向 macOS Google Chrome 的个人划词翻译与英文解析扩展。它通过 Chrome
Native Messaging 调用本机已登录的 Codex CLI，不在扩展中保存 OpenAI API Key。

## ChatGPT Plus / Codex 使用边界

第一版可以复用本机 Codex CLI 的现有 ChatGPT 登录：Native Host 调用
`codex exec --ephemeral`，因此不需要另购 OpenAI API Key，但会受到当前 ChatGPT/Codex
账户的可用额度、频率和网络限制。这不是“用 Plus 抵扣 API 费用”；ChatGPT 订阅与 OpenAI
API 计费彼此独立。若未来发布商店版或改成云端 provider，必须另外实现服务端鉴权、密钥
管理、限流与成本控制。

参考：[Codex 非交互模式](https://developers.openai.com/codex/noninteractive)、
[ChatGPT Plus 说明](https://help.openai.com/en/articles/6950777-what-is-chatgpt-plus)。

## v0.2.0 能力

- 双击或拖选英文后显示“解释”和“翻译”工具条。
- 单词/短语翻译包含语境义、词性、音标、搭配、原文例句和相似词。
- 单词/短语解释包含原形、核心词义、同义词和语境搭配。
- 单句支持翻译和中文解析；多句段落仅支持翻译。
- 单词翻译或解释完成后，可将原始选中词形和所在英文句子加入欧路词典生词本。
- 已存在的单词显示“已在生词本”，不会再次写入或覆盖原分组、星级和语境。
- 每次请求使用 `codex exec --ephemeral`，不创建可恢复的 Codex 会话。

欧路功能是可选能力。只有用户点击“加入欧路生词本”时才会向欧路发送单词和所在句子；授权
保存在 macOS 钥匙串，不进入扩展配置、仓库或日志。授权获取及接口说明见
[欧路 OpenAPI 开发指南](https://my.eudic.net/OpenAPI/Doc_Index)。

## 当前范围

第一版只支持 macOS、Google Chrome 和普通 `http/https` 顶层网页，不支持 PDF、Chrome
内部页面、iframe、编辑器区域、其他操作系统或云端 API。

## 开发入口

环境要求：Node.js 18+、pnpm、已通过 ChatGPT 登录的 Codex CLI。

```bash
pnpm install
pnpm build
pnpm test
pnpm host:install -- --extension-id <ID> --dry-run
pnpm host:eudic:configure -- --dry-run
```

完整安装与验证步骤见 [macOS 安装说明](docs/setup-macos.md)，工程边界见
[架构文档](docs/architecture.md)。
