# macOS 安装说明

## 前置条件

- Google Chrome。
- Node.js 18 或更高版本。
- pnpm。
- 支持 `--ephemeral`、`--output-schema`、`--ignore-user-config` 和 `--ignore-rules` 的 Codex
  CLI，并已通过 `codex login` 使用 ChatGPT 登录。

## 构建扩展

```bash
pnpm install
pnpm build
```

在 `chrome://extensions` 开启开发者模式，加载 `apps/extension/dist`，并复制扩展 ID。

## 安装 Native Host

```bash
pnpm host:install -- --extension-id <ID>
```

安装器会验证工具和登录状态，然后写入 Huayi 专用目录及 Chrome 用户级 Native Messaging
清单。刷新扩展后即可测试。

## 卸载

```bash
pnpm host:uninstall
```
