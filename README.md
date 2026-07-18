# 划译

“划译”是一款 Chrome 英文划词翻译与用法分析扩展。双击或拖选英文后，可查看词典式翻译、
语境解释和流式结构化结果；观看普通 YouTube 录播视频时，也可冻结当前英文字幕后精确点词
或拖选短语。

当前版本为 `0.10.0`，Native Messaging 协议为 `schemaVersion: 5`。

## 平台能力

| 平台    | 模型 Provider                                         | 欧路生词本 | 凭据存储                  |
| ------- | ----------------------------------------------------- | ---------- | ------------------------- |
| macOS   | Codex、OpenAI、OpenAI-compatible HTTP、DeepSeek       | 支持       | macOS Keychain            |
| Windows | 仅官方 DeepSeek `deepseek-v4-flash`，不连接本机 Codex | 支持       | 当前用户/机器绑定的 DPAPI |

扩展端代码和 wire 协议完全共用；平台差异只在 Native Host、凭据和安装器中。Windows Host
打包为单文件 `.exe`，日常运行不依赖 Node.js。

## 开发

```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
```

默认门禁完全离线，不访问模型、真实凭据或欧路。真实 smoke、安装、Provider 切换和 Chrome
操作均需单独授权。

## YouTube 字幕取词

在普通 YouTube `/watch` 视频中开启英文字幕，点击 CC 按钮旁的“译”。视频暂停后，可单击
字幕中的单词、拖选连续短语，或选择“整条字幕”，再使用“解释｜翻译”。结果显示在冻结字幕
内最后一次鼠标操作附近；再次点击“译”、关闭或按 Escape 后，只恢复由 Huayi 主动暂停的
视频。首版不支持直播、Shorts 或跨字幕自动拼句。

## 安装入口

- [Windows：从 GitHub 构建并加载](docs/setup-windows.md)
- [macOS：本机 Host 与 Provider 配置](docs/setup-macos.md)

## 主要文档

- [阶段成果与平台边界](docs/project-status.md)
- [架构说明](docs/architecture.md)
- [协议说明](docs/protocol.md)
- [安全与隐私](docs/security.md)
- [测试策略](docs/testing.md)
- [贡献指南](CONTRIBUTING.md)
