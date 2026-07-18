# 阶段成果与平台边界

## 当前基线

- 产品版本：`0.10.0`
- Native Messaging：`schemaVersion: 5`
- 浏览器：Google Chrome 普通 `http/https` 顶层网页
- macOS：完整功能，默认 Provider 为已登录 Codex
- Windows：模型固定为 DeepSeek，不连接本机 Codex；支持欧路生词本
- 发布方式：从 GitHub 源码构建并加载，尚未发布 Chrome Web Store

## 已完成阶段

| 版本    | 阶段成果                                                                 |
| ------- | ------------------------------------------------------------------------ |
| 0.1–0.4 | TypeScript monorepo、MV3、严格协议、Native Host、流式展示和取消          |
| 0.5–0.7 | OpenAI、兼容 HTTP、DeepSeek Provider，以及独立凭据和诊断工具             |
| 0.8     | 单词翻译与解释职责分离，wire 升至 v5                                     |
| 0.9     | 词典式浮层、稳定 DOM 更新和窄屏体验                                      |
| 0.10    | Windows DeepSeek Host、独立 DPAPI 凭据、欧路生词本、SEA 和 Chrome 注册表 |

## 仍然不支持

- Windows 上的 Codex、OpenAI 和 Compatible HTTP。
- Linux、Firefox、Edge、PDF、Chrome 内部页面、iframe 和编辑器区域。
- 历史记录、同步、后续对话、浏览器内 Provider 设置和 Chrome Web Store 自动安装。

## 文档接手顺序

新的 Codex 项目从仓库根目录打开后，依次读取：

1. 根目录与目标模块的 `AGENTS.md`；
2. 本文件和 `README.md`；
3. 对应平台的 `setup-macos.md` 或 `setup-windows.md`；
4. `architecture.md`、`protocol.md`、`security.md` 和 `testing.md`；
5. 需要追溯设计决策时，再读取 `docs/superpowers/specs/` 与 `plans/`。

历史设计文档保留当时版本的边界，不代表当前发布状态；当前状态以本文件和主题文档为准。
