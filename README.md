# 划译

“划译”是一款面向 macOS Google Chrome 的个人划词翻译与英文解析扩展。它通过 Chrome
Native Messaging 调用本机已登录的 Codex CLI，不在扩展中保存 OpenAI API Key。

## MVP 能力

- 双击或拖选英文后显示“解释”和“翻译”工具条。
- 单词/短语翻译包含语境义、词性、音标、搭配、原文例句和相似词。
- 单词/短语解释包含原形、核心词义、同义词和语境搭配。
- 单句支持翻译和中文解析；多句段落仅支持翻译。
- 每次请求使用 `codex exec --ephemeral`，不创建可恢复的 Codex 会话。

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
```

完整安装与验证步骤见 [macOS 安装说明](docs/setup-macos.md)，工程边界见
[架构文档](docs/architecture.md)。
