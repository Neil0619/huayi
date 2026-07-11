# macOS 安装说明

## 前置条件

- Google Chrome。
- Node.js 18 或更高版本。
- pnpm。
- Codex CLI 0.144.1 或兼容版本，并已通过 `codex login` 使用 ChatGPT 登录。安装器会实际
  检查所需参数和 `shell_tool`、`unified_exec`、`shell_snapshot` 三项禁用状态，不只比较
  版本号。
- macOS 自带的 `/usr/bin/security`。欧路功能可选，安装扩展和 Host 时不要求已经配置授权。

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

建议先执行 dry-run。它会验证 Node、构建产物、Codex 参数、shell 能力关闭状态、ChatGPT
登录和 `/usr/bin/security` 可执行，但不会写入文件、读取欧路授权或调用模型。若 Codex 不在
当前 `PATH`，可显式指定绝对路径：

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

## 配置欧路授权（可选）

登录[欧路 OpenAPI 开发指南](https://my.eudic.net/OpenAPI/Doc_Index)，获取个人授权信息。
配置时输入的是将来放入 HTTP `Authorization` Header 的完整值（官方示例形如 `NIS xxxx`），
不要只输入后半段，也不要把值写入命令参数、环境变量或配置文件。

```bash
pnpm host:eudic:configure -- --dry-run
pnpm host:eudic:configure
```

dry-run 只验证固定 `/usr/bin/security` 可执行，不提示输入、不读取钥匙串，也不调用欧路 API。
正式命令由 macOS `security` 在终端隐藏读取授权，写入固定的 Huayi 钥匙串项。配置命令不会
验证授权；第一次在单词结果页点击“加入欧路生词本”时才会查询欧路。重复运行正式命令会使用
`-U` 轮换同一项。

也可以只移除欧路授权而保留扩展和 Host：

```bash
pnpm host:eudic:remove -- --dry-run
pnpm host:eudic:remove
```

该命令只删除 service `com.huayi.codex_bridge.eudic`、account `authorization` 的精确项；缺失
时保持幂等。

## 从 v0.1.x 升级到 v0.2.0

升级顺序固定为：

1. 运行 `pnpm install && pnpm build`，重新生成扩展和 Host。
2. 在 `chrome://extensions` 找到划译并点击刷新。
3. 使用当前扩展 ID 重新运行 `pnpm host:install -- --extension-id <ID>`。
4. 如需启用或轮换欧路功能，最后运行 `pnpm host:eudic:configure`。

安装和升级不会读取、覆盖或删除现有欧路钥匙串项；扩展与 Host 应同步升级，否则加词会提示
“本机服务未安装或版本过旧”。

## 人工验收欧路功能

完成钥匙串配置后，选择一个尚未收藏的英文单词，先翻译或解释，再点击“加入欧路生词本”。
在欧路中确认单词及目标英文句子已经写入。再次选择同一单词应显示“已在生词本”，并且不
覆盖原分组、星级或已有语境。真实验收会访问欧路，只能由用户显式执行，自动测试不会执行。

## 卸载

```bash
pnpm host:uninstall -- --dry-run
pnpm host:uninstall
```

卸载会先删除上述精确欧路钥匙串项，再验证所有权标记和清单中的 host 名称、launcher 绝对
路径并删除 Huayi 文件。钥匙串删除失败时保留 Host 文件以便重试；缺失钥匙串项和重复卸载
均保持幂等，也不会删除 Chrome 的父目录、其他 Native Messaging 清单或其他凭据。
