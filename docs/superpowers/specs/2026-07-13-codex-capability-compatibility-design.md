# Codex App Server 能力兼容性修复设计（v0.3.1）

## 背景与根因

v0.3.0 在真实 Chrome 请求中返回 `CODEX_CAPABILITY_MISSING`。已安装的
`codex-cli 0.144.0-alpha.4` 可以完成 Native Host 健康检查，但在 App Server 启动阶段拒绝
以下严格配置：

```text
tools.view_image=false
```

错误为 `unknown configuration field tools.view_image in -c/--config override`。因此失败发生在
模型调用之前，与 ChatGPT 登录状态、`gpt-5.4-mini` 或订阅额度无关。

移除该字段后，App Server 可以初始化，但 `mcp_servers={}` 不能清除用户配置中的直接 MCP
Server。当前环境会继承 `confluence-wiki-mcp`、`node_repl` 和 `openaiDeveloperDocs` 等配置。
同时，新版 `hooks/list` 会为请求的空工作目录返回一条包含空 `hooks`、空 `warnings` 和空
`errors` 的记录；`mcpServerStatus/list` 也会保留已禁用 Server 的无活动状态记录。v0.3.0
要求两个 `data` 数组都完全为空，因而会把安全的空状态误判为能力缺失。

## 目标与非目标

本修复必须做到：

- 兼容当前已安装 Codex CLI，不依赖其尚未识别的配置字段。
- 在启动模型前发现并禁用用户直接配置的全部活动 MCP Server。
- 允许新版 App Server 返回安全的 Hook/MCP 空状态记录。
- 对无法识别、无法禁用或仍处于活动状态的能力继续 fail-closed。
- 不读取、复制或解析 `~/.codex/auth.json`，不调用真实模型完成自动测试。
- 保持 `gpt-5.4-mini`、`low` effort、流式协议和欧路生词本行为不变。

本修复不增加设置页、用户可配置模型、MCP 允许列表、插件调用、工具调用或降级到安全约束更
弱的 Codex 启动方式。

## 方案选择

采用“启动前动态发现并逐个禁用直接 MCP”的方案。

Native Host 在创建 App Server 子进程前，以相同的应用和插件禁用参数执行不调用模型的
`codex mcp list --json`。Host 只提取其中 `enabled: true` 的直接 MCP 名称，校验名称后生成：

```text
--config mcp_servers.<name>.enabled=false
```

App Server 启动后仍调用 `mcpServerStatus/list` 验证每条记录都没有连接信息、工具、资源或资源
模板。动态禁用负责隔离，初始化后的状态校验负责证明隔离实际生效。

不采用以下方案：

- **继续使用 `mcp_servers={}`**：实测不能清除继承的用户 MCP 配置。
- **使用独立空 `CODEX_HOME`**：会失去现有 ChatGPT 登录状态，并要求用户再次登录。
- **放宽校验并允许活动 MCP**：网页文本和模型输出是不可信数据，会扩大工具调用边界。
- **维护固定 MCP 名称列表**：用户配置可能变化，新 Server 会绕过固定列表。
- **修改或覆盖用户 Codex 配置文件**：会越过 Huayi 的文件所有权边界并影响用户其他任务。

## 组件与职责

### MCP 发现器

新增独立运行时模块，通过现有安全进程抽象执行 `codex mcp list --json`：

- 使用参数数组、`shell: false`、允许列表环境和专用空工作目录。
- 应用与正式 App Server 相同的 `apps`、`plugins` 等功能禁用项，使插件提供的临时 MCP 不
  进入直接配置列表。
- 不发送网页文本、不创建 thread、不调用模型。
- 对进程退出、超时、超大输出、无效 JSON、重复或未知结构失败关闭。
- 限制 Server 数量，并只接受匹配 `[A-Za-z0-9_-]{1,128}` 的名称。
- 只返回去重后的活动直接 MCP 名称；已禁用条目不需要重复覆盖。

名称限制既防止配置路径注入，也符合 Codex CLI 当前可安全合并的裸 dotted-key 语法。任何
不符合限制的活动名称都返回能力缺失，不能跳过。

### App Server 参数构建器

固定基础参数继续包含 `app-server --stdio --strict-config`、只读无网络 sandbox、never 审批、
禁用 Web Search、无历史、无环境继承和无遥测。参数构建器根据发现结果追加每个
`mcp_servers.<name>.enabled=false`。

删除以下不兼容或无效覆盖：

- `tools.view_image=false`：当前 CLI 在 strict config 下拒绝该字段。
- `mcp_servers={}`：不能清除继承配置，还会妨碍逐项合并已有 Server transport。

thread 级配置同步删除这两个字段，避免 `thread/start` 再次触发相同错误或错误覆盖。图片、
浏览器、电脑操作、shell、Web Search、应用和插件仍由受支持的 feature 禁用项、只读无网络
sandbox、never 审批及事件拒绝规则共同封锁。

正式启动每次重新执行 MCP 发现，不跨 App Server 重启缓存结果。这样用户修改 Codex 配置后，
下一次进程启动会重新计算禁用项。

### Hook 与 MCP 状态校验

`hooks/list` 不再要求 `data` 完全为空，而是逐项接受安全空记录：

- `cwd` 必须等于 Huayi 专用空工作目录。
- `hooks`、`warnings` 和 `errors` 必须都是空数组。
- 任一未知或非空执行性内容均拒绝。

`mcpServerStatus/list` 可以包含已禁用的记录，但每项必须同时满足：

- 没有 `serverInfo`。
- `tools` 为空对象。
- `resources` 和 `resourceTemplates` 为空数组。
- 分页游标为空。

只要出现活动连接、工具、资源、资源模板、非空游标或无法识别的形状，初始化立即失败并终止
App Server。现有运行期规则继续拒绝任何 MCP 通知或 MCP tool item。

## 启动与错误数据流

```text
analyze
  -> discover direct MCP servers (no model)
  -> validate and build per-server disable overrides
  -> start App Server
  -> initialize
  -> verify empty Hook records
  -> verify inert MCP status records
  -> start ephemeral thread and streaming turn
```

发现、参数生成、初始化或安全状态验证任一步失败，都终止当前 App Server 尝试并映射为
`CODEX_CAPABILITY_MISSING`。不得自动移除安全参数后重试，也不得启动模型。成功后的 turn
取消、超时、流式增量与最终 Schema 校验沿用 v0.3.0 行为。

## 测试策略

按 TDD 增加以下回归覆盖：

- 参数构建不再包含 `tools.view_image` 或空 `mcp_servers` 覆盖。
- 只为通过名称校验的活动直接 MCP 生成逐项禁用配置。
- MCP 发现正确过滤已禁用项，并拒绝失败进程、超时、超大输出、无效 JSON、无效名称和超限
  条目。
- App Server 必须等待发现完成后才启动；发现失败时不创建 App Server 进程。
- Hook 校验接受目标 cwd 的全空记录，拒绝其他 cwd、Hook、警告、错误和未知形状。
- MCP 校验接受无连接且无能力的记录，拒绝连接信息、工具、资源、模板和分页。
- 原有线程安全不变量、流式结果、请求取消与并发隔离回归测试继续通过。

默认测试全部使用 fake process runner 和 fake JSON-RPC，不访问 OpenAI、不读取真实 Codex
配置、不消耗订阅额度。实现后额外执行一次不启动模型的真实兼容性诊断，确认当前 CLI 可以
完成发现、初始化、Hook/MCP 安全校验和 `thread/start`。`pnpm smoke:codex` 仍只在用户显式
授权时运行。

## 文档、安全与发布

同步更新 Native Host 指令、架构、安全和测试文档，明确 MCP 表不是通过空对象清除，而是
通过启动前发现、逐项禁用和启动后验证形成闭环。官方配置仍以
[Codex 配置参考](https://learn.chatgpt.com/docs/config-file/config-reference#configtoml) 为依据，
但对已安装二进制是否接受具体字段以 strict-config 实测为准。

根包、三个 workspace 包、扩展 Manifest 和 Native Host 版本统一升为 `0.3.1`。完成后重新
构建扩展，将产物同步到 Chrome 当前加载的原始目录，重新安装 Native Host，并由用户在
`chrome://extensions` 手动重新加载。现有扩展 ID 和欧路钥匙串授权保持不变。
