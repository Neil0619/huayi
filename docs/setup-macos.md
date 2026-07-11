# macOS 安装说明

## 前置条件

- Google Chrome。
- Node.js 18 或更高版本。
- pnpm。
- Codex CLI 0.144.1 或兼容版本，并已通过 `codex login` 使用 ChatGPT 登录。安装器会实际
  检查所需参数和 `shell_tool`、`unified_exec`、`shell_snapshot` 三项禁用状态，不只比较
  版本号。

## 构建扩展

```bash
pnpm install
pnpm build
```

在 `chrome://extensions` 开启开发者模式，加载 `apps/extension/dist`，并复制扩展 ID。
扩展 ID 必须是 Chrome 展示的 32 位小写 `a-p` 字符串；不要使用文档中的示例值。

未在 Manifest 中固定 `key` 时，开发版扩展 ID 与加载目录有关。移动仓库或改用另一份构建
目录后，应重新复制 ID 并重装 Native Host。

## 安装 Native Host

```bash
pnpm host:install -- --extension-id <ID> --dry-run
pnpm host:install -- --extension-id <ID>
```

建议先执行 dry-run。它会验证 Node、构建产物、Codex 参数、shell 能力关闭状态和 ChatGPT
登录，但不会写入文件或调用模型。若 Codex 不在当前 `PATH`，可显式指定绝对路径：

```bash
pnpm host:install -- --extension-id <ID> --codex-path /absolute/path/to/codex
```

正式安装写入：

- `~/Library/Application Support/Huayi/native-host/`：自包含 Host、四份 Schema、空工作目录、
  可执行 launcher 和所有权标记。
- `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.huayi.codex_bridge.json`：
  只允许当前扩展 ID 的 Chrome 用户级清单。

重复执行会升级已带合法所有权标记的安装。目标目录已存在但没有划译标记、或 Chrome 清单被
其他程序占用时，安装器会失败关闭，不覆盖现有内容。安装后在 `chrome://extensions` 刷新
扩展；Chrome 从 GUI 启动 Host 时使用 launcher 中记录的绝对 Node、Codex、`HOME` 和可选
`CODEX_HOME`，并把 Node 目录放入受控 `PATH`，因此不依赖终端 shell 初始化文件。

## 卸载

```bash
pnpm host:uninstall -- --dry-run
pnpm host:uninstall
```

卸载会先验证所有权标记和清单中的 host 名称、launcher 绝对路径；不匹配时不删除任何文件。
重复卸载是幂等操作，也不会删除 Chrome 的父目录或其他 Native Messaging 清单。
