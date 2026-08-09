# 划译

“划译”是一款 Chrome 英文划词翻译与用法分析扩展。双击或拖选英文后，可查看词典式翻译、
语境解释和流式结构化结果；观看普通 YouTube 录播视频时，也可直接选择 Huayi 英文字幕中的
单词或短语，并在英文与快速双语字幕之间切换。

当前版本为 `0.12.0`，Native Messaging 协议为 `schemaVersion: 6`。欧路收藏可按日进入扇贝；
扇贝拒绝的词会在本机离线尝试唯一词元，无法可靠处理的词保留在人工列表中。

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

## 扇贝生词同步

Native Host 每天从欧路英语收藏增量生成持久队列；扩展角标显示待同步数量。点击角标后会打开
扇贝生词本、预填最多 100 个目标词，但最终“批量添加”始终由用户点击。扇贝部分接受时只确认
成功词；拒绝词在本机离线尝试一次唯一词元，剩余词通过 `!` 面板复制或人工修改后重新入队。
确认是错词的项目可逐条放弃，也可经二次确认全部放弃；Host 会保留可审计终态，并阻止它们
在后续欧路轮询中再次入队。
Extension 不保存词表、登录信息、网页 URL 或上下文。

## YouTube 字幕取词

在普通 YouTube `/watch` 录播中先由用户开启英文字幕。Huayi 验证当前活动英文轨后，以可原生
选择的完整英文句替代 YouTube 字幕；双击选择单词、拖选短语后仅在视频原本播放时暂停，并
继续使用既有“解释｜翻译”和欧路生词本；拖选完整句子时按句子请求翻译或解释。关闭结果或
点击播放器视频空白区时，只恢复由 Huayi 暂停的视频。

每个新视频默认英文。译轨可用时，点击 CC 旁“中”固定双语，或按住 `F8` 临时查看中文；中文
来自当前英文轨的 YouTube `zh-Hans` 自动翻译，只保留在当前页面内存，不调用模型或 Host。
Huayi 不替用户开启 CC 或切换字幕轨；源轨失败、关 CC、切非英文轨、广告、直播或导航离开时
恢复 YouTube 原生字幕。不支持 Shorts、OCR 或持久字幕历史。

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
