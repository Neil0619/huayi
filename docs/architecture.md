# 架构说明

## 系统边界

```text
网页选区
  -> Content Script（选区、段落/句子上下文、Shadow DOM 浮层）
  -> MV3 Service Worker（请求路由、取消、Native Messaging）
  -> 本机 Node Host（协议校验、并发与超时）
       |-> AnalysisProvider -> codex exec --ephemeral
       `-> WordbookProvider -> macOS Keychain -> 欧路 OpenAPI
```

依赖方向固定为 `extension -> protocol <- native-host`。共享协议不感知 Chrome、Node 或
Codex；未来的云端模型、其他浏览器和其他操作系统通过各自边界扩展。

## 组件职责

- Content Script：读取英文选区与所在语义块；单词另按真实 `Range` 提取所在英文句子；分类
  文本并展示、关闭浮层。
- Service Worker：路由 `analyze`、`add-word` 和 `cancel`，持有请求 ID 与 Native Messaging
  连接，不保存页面或模型数据。
- Native Host：读取/写入二进制帧，校验协议，管理全局最多两个任务。
- Codex Provider：构建不可信数据提示、选择输出 Schema、解析结构化结果。
- Wordbook Provider：每次请求从固定 macOS 钥匙串项读取授权，先查询欧路，确认不存在后再
  添加；欧路操作额外串行，最多并发一个。
- Protocol：提供请求、结果、错误、wire event 的唯一公共定义。

Provider 根据动作和选区类型选择四份独立 JSON Schema，再通过 stdin 调用 `codex exec`。
普通模式的 stdout 只接收最终 JSON，Codex 进度保留在 stderr；Host 不会把 stderr 透传给
扩展。输出必须先通过 JSON 解析和公共协议 Zod Schema，并同时匹配原请求的结果类型、选区
类型和原文，任何额外 stdout 字节或字段都会失败关闭。

Host 不指定模型，使用当前 Codex CLI 的内置默认模型；它只依赖现有 ChatGPT 登录状态，不在
扩展或 Host 中管理 API Key。这条 provider 边界不是 OpenAI API，未来若增加云端 API 必须
实现新的 `AnalysisProvider` 并单独设计密钥、鉴权、限流和成本控制。

Service Worker 以 `requestId` 维护请求路由，并为每个标签页只保留一个活动请求。新工作请求
先取消旧请求，再发送 `analyze` 或 `add-word`；结果或错误到达后立即删除内存状态。分析请求
只能接受 `result`，加词请求只能接受 `word-added`，终态不匹配时按 `INVALID_RESPONSE`
失败关闭。Native Port 断开时所有等待请求都会收到可展示的协议错误，下一次请求再惰性创建
新连接。扩展不把这些状态写入 storage。

## 选区领域规则

Content Script 将 CRLF 统一为换行、压缩行内空白并保留最多两个连续换行。选区必须包含
拉丁字母且不能包含汉字，归一化后超过 2,000 字符时直接忽略。`input`、`textarea`、
`select`、`contenteditable` 和 `role=textbox` 区域不参与处理。

单个英文词（含撇号或连字符）归为 `word`；多行或包含两个句末标记的文本归为
`paragraph`；包含一个句末标记或至少八个词的文本归为 `sentence`；其余归为 `phrase`。
上下文优先取最近的段落、列表项、引用、表格单元等语义块，并围绕选区裁剪到 2,000 字符。

生词本语境与模型段落上下文相互独立。单词通过 `Intl.Segmenter` 定位实际选中位置所在句子，
并用确定性标点规则回退；重复单词不会按第一次文本匹配误取句子。混入汉字、无法提取或超过
限制时退化为选中词本身。远端写入始终使用网页中的原始词形和预先提取的句子，不使用模型
返回的原形、翻译或解释。

## 扩展方式

- 新 provider 实现 `AnalysisProvider`，不得修改扩展 UI 的公共数据结构。
- 新生词本实现 `WordbookProvider`，不得把欧路概念泄漏到 `AnalysisProvider`。
- 新浏览器创建新的 app 并复用 `@huayi/protocol`。
- 新操作系统只增加 installer，实现相同 Native Messaging host 接口。

macOS 安装器把自包含 Host 和 Schema 放入 Huayi 专用用户目录，通过带绝对 Node/Codex 路径
的可执行 launcher 接收 Chrome 传入的来源参数，再用 `exec` 启动 Host。Chrome 清单的
`allowed_origins` 只包含安装时提供的一个扩展 ID。安装和卸载都先校验 Huayi 所有权标记，
不会认领或删除同路径下的未知内容。

欧路授权使用固定钥匙串 service `com.huayi.codex_bridge.eudic` 和 account `authorization`。
安装与升级只验证 `/usr/bin/security` 可执行，不读取、创建或覆盖授权；卸载先删除这个精确
钥匙串项，失败时保留 Host 文件以便重试。

launcher 会转发 Chrome 附加的来源参数，固定 `HOME`、可选 `CODEX_HOME` 和只含已验证 Node
目录及 macOS 系统目录的 `PATH`。这样即使 Chrome 从 GUI 启动且没有终端环境，NVM 的
`#!/usr/bin/env node` Codex wrapper 仍会使用安装时验证过的 Node。

## 生产依赖决策

`@huayi/protocol` 使用 Zod 对来自网页、扩展、Native Messaging 和模型的对象执行运行时
校验。备选方案是手写类型守卫或仅依赖 TypeScript 静态类型；前者容易在四类结果中产生规则
漂移，后者无法保护运行时边界，因此不采用。Zod 会增加少量打包体积，但其严格对象 Schema
可以拒绝未知字段并缩小不可信数据进入系统的范围；升级时必须审查其变更和依赖树。

Native Host 构建使用现有开发依赖 Vite，把 Host、`@huayi/protocol` 和 Zod 打成一个可搬移
的 Node ESM 文件，同时复制四份输出 Schema。这样安装目录不依赖仓库中的 `node_modules`；
代价是构建产物更大，因此安装前仍需通过完整构建和启动检查。

欧路客户端使用 Node.js 18 内置 `fetch`，没有增加生产依赖。固定端点、禁用重定向与自动
重试、限制响应体和串行请求可以缩小网络边界；代价是临时失败需要用户显式重试。
