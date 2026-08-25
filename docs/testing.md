# 测试策略

## 默认自动测试

`pnpm test`、`pnpm test:e2e` 及其他默认门禁必须完全离线，不得访问 OpenAI、真实 Codex、
欧路 API 或 macOS 钥匙串。测试分别注入 fake App Server/JSON-RPC process、fake process
runner、fake authorization reader、fake fetch 和 Mock NativeTransport；只有用户明确批准
真实模型、明文传输、额度和 API 账单影响后，才可单独执行 `pnpm smoke:codex`、
`pnpm smoke:compatible`、`pnpm smoke:compare` 或 `pnpm smoke:deepseek`。

Store 1.0 另由 `pnpm check:architecture`、`pnpm test:store:coverage`、
`pnpm check:store-release` 和 `pnpm audit:prod` 收口。前三者完全离线；`audit:prod` 只查询包管理器
安全公告，不启动扩展或向 Provider/词典发送请求。macOS 与 Windows CI 都安装 Chrome并运行同一
套 `pnpm test:e2e`，Windows 不再依赖另行补跑浏览器证据。

Windows 默认门禁运行协议、Extension、共享 Provider、Windows Host/安装器和脚本测试；依赖
POSIX 权限、目录 `fsync`、符号链接或 macOS Keychain 的专属测试只在非 Windows 环境运行。
这些 macOS 文件在 Windows 仍参与 TypeScript 类型检查和构建。

根脚本测试开始前先在同一进程链中构建 `@huayi/learning-domain` 与
`@huayi/cloud-contracts`，防止干净 CI 意外复用开发机残留的 `dist`。仓库根
`.gitattributes` 固定文本 checkout 为 LF；迁移镜像、seed、平台镜像 lock 和 canonical fixture 的
字节身份不得因 Windows checkout 改写为 CRLF。Hosted backup/restore/Vercel 私密 evidence writer
要求可验证的 POSIX `0700/0600` 与目录 `fsync`，生产入口始终使用严格 mode verifier 和真实目录
durability adapter，并在 Windows 运行时失败关闭；测试只能显式注入 mode predicate 和目录 sync
adapter，以继续覆盖 canonical/atomic 流程、路径、进程、环境、parser、cleanup 和 lifecycle。仅实际
mode、目录 `fsync` 断言与依赖 Windows symlink 权限的变体不在 Windows 门执行。声明为 macOS 的
FileVault readiness 测试必须显式注入平台，不得从运行测试的宿主平台推导期望。

自动测试覆盖：

- 发布版本：根包、三个 workspace 包、Manifest、Host health、App Server clientInfo 和欧路
  User-Agent 全部直接断言为 `0.13.0`，wire 版本为 7。
- 协议：严格 v7 请求/事件联合、v6 拒绝、四种 Provider health、设置状态/Provider 选择、
  warmup、`analysis-delta` /
  `analysis-section` 共享
  序号、`check-word` / `word-status`、错误码和 1 MiB 帧上限。
- 选区：四类分类、2,000 字符裁剪、编辑区排除、单词所在英文句子的确定性提取，以及中英混合
  技术文本在无纯英文句子时退化为只发送选中英文。
- YouTube 字幕：CC ON 与活动英文轨矩阵、绝不自动切轨、MAIN bridge 严格消息／指纹、伪造／
  跨视频／迟到／超限拒绝、播放器请求省略 `pot` 时接受以及显式空值／超长值拒绝、源译轨
  串行、同代次已验证源轨身份、译轨不重复触发缓存源轨、孤立译轨拒绝、3 秒超时、fetch/XHR
  wrapper 与 CC／轨道全路径恢复、响应只能在播放器恢复后发送、可变轨道对象按值快照、捕获
  期间用户切轨失败关闭、严格只读源轨身份探测四态及探测不触发播放器／网络操作，以及
  恢复轨道导致原生 cue 短暂为空时接受、source 非英文拒绝、译轨成功／失败都需连续 750ms
  稳定窗口后接受或超时；
  本地分句覆盖 1.5 秒、120 code points／12 秒、200 code points／15 秒、Unicode 和无标点 ASR，
  译文只按正时间重叠排序去重。交互覆盖默认英文、CC 旁“中”固定、按住 `Shift+Z`／按住字幕角标临时展示、原生双击／短语／完整句
  拖选、无标点完整分句仍为 sentence、外部松开替换旧单词卡、wire v7 `sentenceContext: null`、
  Range 伪造拒绝、暂停所有权、播放器空白首击、pending 生词本，以及导航
  start/page-data/finish 锁、同视频 page-data 更新、控制栏重建、英文 ASR rolling correction
  保持同一面板、另一英文轨只重抓一次、中文／西语轨暂停并稳定恢复原生字幕、切回英文恢复、SPA、
  seek、广告、直播、剧院和全屏清理。
- 浮层：loading/streaming/result/error 状态、文本和类型化板块批处理、安全文本渲染、空词汇
  板块隐藏、词典头部、结构化释义/短语/辨析行、失败时保留非终态预览、独立生词状态、
  右上角紧凑按钮、焦点、拖动、滚动、窄屏和迟到事件。
- 流式调度：注入 fake frame scheduler 验证每帧最多渲染一次、终态排空和关闭清理；键控 DOM
  测试验证旧节点复用、数组累计追加、最终校正、一次性 120ms 动画及 reduced-motion。
- Service Worker：无页面数据 warmup、分析/查词/加词三通道、并发、定向取消、共享连续序号、
  严格终态、断线和超时，以及扩展来源校验、站点策略二次防线和设置串行 mutation。
- 设置：缺失默认、无效失败关闭、hostname 规范化、最具体站点规则、并发写入不丢失、立即应用
  边界、Provider 非敏感状态、可配置同步小时、YouTube 默认双语及自定义/关闭快捷键。
- Store 设置：v1→v2→v3→v4→v5 原子升级、`sitePolicy` 默认/精确/子域优先级、Popup 精确
  host upsert，以及 Classic 无秘密包的严格未知/重复/冲突拒绝、成功单次写入和失败
  零写入；Options 行为测试覆盖可见成功与错误状态。
- 生词同步：欧路默认生词本首次与每日完整扫描、设置的本地同步整点边界（默认 08:00；该整点前不启动
  新扫描、错过 alarm 后在该整点后补扫、未完成扫描可跨边界继续）、跨日去重、三页断点、状态 v1/v2→v3 原子
  迁移/独立快照/备份恢复、数据源升级后立即重扫、100 来源词幂等批次、角标与 alarm、扇贝来源校验、预填不覆盖、
  全部成功、严格部分失败、通信失败和 10 秒人工确认兜底；Windows fixture 另验证 re-audit
  dry-run 不迁移或写回状态，以及目标文件被锁定时保留主文件并清理失败的原子替换临时文件。
- 词形与未解决词：`wink-lemmatizer` 的规则/不规则唯一候选、无变化/歧义/副词拒绝、两个来源
  合并同一目标、一次词元重试、人工替代词、分页面板、逐条放弃、二次确认全部放弃、放弃后
  轮询不再入队、崩溃恢复，以及历史再审计 dry-run、单词探针和全量确认保护。
- MCP 发现：fake process runner 覆盖已启用/已禁用过滤、命令参数和环境允许列表，以及进程
  失败、超时、输出超限、无效 JSON、重复/不安全名称和 128 条记录上限。
- App Server 参数：回归确认不传 `tools.view_image=false` 或 `mcp_servers={}`，固定
  `project_doc_max_bytes=0`，只为经过校验的已启用直接 MCP 生成逐项禁用覆盖。
- App Server：JSON-RPC 拆包/合包、握手、按需重启并重新发现 MCP、并发 turn、中断、
  ephemeral thread、固定 `openai` / `gpt-5.4-mini` / `low` 和零字节项目指令上限；接受 Codex
  在内容被抑制后仍返回的指令来源路径、目标 cwd 的安全空 Hook 记录和无连接、无工具/资源/
  模板的 MCP 状态，拒绝活动记录和未知响应形状。
- Warmup：不含任何网页字段，不发送 `thread/start` / `turn/start`，不触发 fake model turn；
  与 analyze 竞态时只发现、启动和初始化一次 App Server。
- Provider：私有模型内容 Schema 拒绝公共元数据，有界 JSON 字段增量与完整结构化值、
  转义/Unicode/chunk 边界、Host 注入可信元数据、最终公共 Schema、提示注入和错误映射。
- Provider 路由：配置缺失默认 Codex，其他无效文件失败关闭；四个 Provider 逐请求固定路由、
  切换只影响下一请求、设置与 dry-run 均拒绝覆盖无效目标、HTTP warmup 不读 Key/不发 HTTP，
  每个 Provider 均只 dispose 一次且失败时不 fallback。
- OpenAI Key/API：固定 `/usr/bin/security` 参数和精确 service/account、逐请求读取、不泄漏；
  fake fetch 覆盖固定 endpoint/model/body、无重试、重定向、超时/取消、响应体上限和状态映射。
- Responses SSE：严格 event/data 类型、单 text lifecycle、数组项逐个校验和累计发送，拒绝
  refusal、工具、推理、重复/迟到事件、未知终态、超限与原始内容泄漏。
- Compatible 配置/Key：`provider.json` 与 `compatible-http.json` 分离，HTTP 风险必须显式确认，
  URL/model/effort 组合、所有权、`0600` 和 Keychain service/account 严格校验；全部使用 fake
  filesystem、fake Keychain 和 fake fetch。
- Compatible HTTP/SSE：固定 `/responses`、Bearer Header、无 Cookie/重定向/重试，接受实测
  rate-limit、可选成对 reasoning、`0/1` output index、完整 Responses envelope、可选但必须成对
  的 content-part / assistant-item done、assistant added item 的 `in_progress` / 提前
  `completed` 状态和单文本生命周期；验证回显 Prompt、usage、加密
  reasoning、`turn_id`、`phase`、logprobs 与 obfuscation 均在归一化时丢弃。拒绝未知、重复、
  迟到、tool、refusal、半套终止事件、delta/done/completed 不一致、超限、取消或超时后的事件。
- DeepSeek Key/API：精确钥匙串 service/account、隐藏输入、逐请求读取、不泄漏；fake fetch
  断言固定官方 endpoint、`deepseek-v4-flash`、禁用思考、JSON Output、system/user 隔离、无
  重试/回退，以及全部 HTTP、取消和超时映射。
- DeepSeek SSE：任意 UTF-8 分片、keep-alive、空 delta、单 choice、正常 `stop` 与 `[DONE]`，
  终止 usage 缓存/推理明细、六类结果渐进展示、同词性常见义归并和最终严格校验；拒绝非空
  reasoning、截断、缺失终态、错误 ID/模型/顺序、未知字段、错误 JSON、空内容、事件 64 KiB
  和流 2 MiB 超限。
- 安全诊断：五个允许阶段只输出有界阶段/字段名，伪网页、模型、原始 JSON 和凭据均不会进入
  stderr。
- 欧路：自动 GET 查词、显式 GET-before-POST、固定 URL/Header/Body、macOS Keychain 与
  Windows DPAPI 授权逐次读取、串行、取消、10 秒超时、重定向拒绝、64 KiB 上限和状态码映射。
- 安装器：dry-run、升级、allowed origin、所有权、绝对路径、受控 launcher、钥匙串命令和
  幂等清理，以及 macOS 清单同目录 `0600` 临时文件、文件/目录同步、原子替换和 rename 失败
  时保留旧清单；Windows fixture 覆盖真实文件复制、manifest、精确 HKCU 参数、升级保留两份
  DPAPI 凭据和同步状态、ownership marker 拒绝、注册表存在/不存在/失败及孤立键清理。
- Manifest：`permissions` 严格等于
  `["activeTab", "alarms", "nativeMessaging", "storage"]`，不存在 `host_permissions`。

## 浏览器 E2E

Vite fixture 串起真实 Content Script、Service Worker 消息处理、请求协调器和 fake Native
Host。Playwright 覆盖：

Store fixture 先生成完整候选 `apps/store-extension/dist`，再在真实 Chrome 页面中加载打包后的
`content-script.js`，并在脚本执行前安装严格 fake Chrome runtime/analysis port。它验证普通网页
选择到严格 Provider 结果、本地生词消息字段、Provider 失败不自动重试、用户手动重试，以及 Popup
relay 关闭当前站点且消息不携带 URL。fake 不发 HTTP，也不替代发布前真实扩展加载和第三方验收。

- 单词翻译/解释在最终卡片前显示至少两个独立增量；
- 单词翻译固定验证音标置顶、词性与释义合并、常用短语、易混词以及没有原文例句/独立词性；
- 单词解释固定验证语境取义、词形与句法作用、可靠构词、用法要点和同义词差异；
- 质量夹具覆盖 `principal/principle`、`stationary/stationery`、`advise/advice`、
  `affect/effect`、`run`、`charge`、`light`、`sustained`、`victims`，并拒绝把普通近义词
  `inquiry` 当成 `investigation` 的易混词；
- 已存在查询先返回、结果先返回、查询不存在和被动查询失败；
- 自动查询只记录单词，短语、句子和段落从不发 `check-word`；
- 查词未完成时显式添加只取消查词，并保留原始英文句子；
- 关闭、新选区和 Escape 同时取消分析/查词请求；
- 迟到 delta/status 不能重开或改写替代浮层；关闭取消后迟到 SSE 也不能重开浮层；
- 受控 mock 流显式释放第一项、第二项和最终结果，以行为顺序验证稳定节点复用，不依赖瞬时
  毫秒窗口；
- API Key 未配置和授权失败只显示固定安全中文提示，不暴露伪凭据；
- 320px 窄屏下生词按钮、拖动手柄和关闭按钮均可见且不重叠。
- 本地 YouTube fixture 串起构建后的 MAIN bridge 与 isolated controller，覆盖英语单语／双语、
  正常／剧院／全屏、SPA 换视频、源／译轨失败、可选字幕上下文和 warmup 无字幕数据；并断言
  旧“译”按钮、冻结 picker、“整条字幕”和 30 秒缓冲交互已移除。fixture 会缓存重复源轨，只
  允许首次源轨请求产生网络，以防理想化 mock 再次掩盖真实播放器行为。

稳定的单词翻译和解释结果卡分别使用 macOS Chrome 元素截图基线。更新快照后必须人工查看
实际 PNG，确认词典头部、语境强调、结构化行和内部滚动不存在溢出、遮挡或意外内容变化。

## Smoke 客户端单元测试

Node 测试通过二进制 Native Messaging 帧驱动 fake child。分析请求只允许从 0 开始严格有序
的 `analysis-delta` / `analysis-section`，并继续等待匹配 `result`；跳号、错误通道中的预览、
终态后的更新或额外终态都会锁存为 fatal。测试还覆盖无效 Schema/JSON/帧、stdout EOF、
stderr/stdin 错误、子进程退出和有界 SIGTERM/SIGKILL 清理。

## 真实 Codex 冒烟

`pnpm smoke:codex` 显式验证 `sustained`、`victims`、`accountable`、`Four` 以及单句和多句
段落基线。输出只包含一次 `cold warmup`，以及每个用例各一次
`click-to-first-delta` / `click-to-full-result` 整数时长，不打印用例内容或模型文本。最终结果仍
通过公共协议校验，段落必须保留换行。

运行前后脚本只比较 `CODEX_HOME/sessions` 中的相对文件名，不读取 session 内容或认证文件；
新增任何 session 文件都会使测试失败。该命令会消耗真实 ChatGPT/Codex 额度，因此不属于
默认门禁，不能在自动测试中运行，也不能由发布流程自动批准。

真实欧路验收也不属于自动门禁。只有用户显式配置钥匙串后，才手动验证未收藏、已存在和语境
写入路径。

## 真实 Provider 对比

`pnpm smoke:compare` 对固定无敏感样本分别执行 Codex 与 API Provider，记录聚合的
first-visible / complete 延迟和通过率，不打印选区、模型文本、API Key、请求 ID 或 usage。
该命令会同时消耗 ChatGPT/Codex 额度与 OpenAI Platform API 费用，仅在用户明确授权后运行；
它不属于默认门禁，也不得被 CI 或发布脚本自动触发。

## 真实 Compatible 冒烟

`pnpm smoke:compatible` 只从第三方专用钥匙串读取 Key，并使用本机严格
`compatible-http.json`；不接受临时 endpoint、模型或 Prompt 参数。它输出匿名 case ID、计数
和整数耗时，不输出 Key、Authorization、选区、上下文、Prompt 或模型结果。该命令会通过明文
HTTP 发送固定测试输入并产生第三方费用，必须由用户在查看配置状态和风险警告后单独批准。
Smoke 不读取 Codex 配置、不读取官方 OpenAI Key、不修改 `provider.json`，也不会自动切换
Provider。

## 真实 DeepSeek 冒烟

`pnpm smoke:deepseek` 在 macOS 只从 `com.huayi.codex_bridge.deepseek` / `api-key` 读取 Key，
在 Windows 只从已安装 Host 目录的 DPAPI 凭据读取 Key；两者都使用固定官方 endpoint、模型、
非思考模式和固定无敏感用例。它覆盖单词、短语、句子、段落及已安全退化为单词上下文的
`hatch` 用例，输出匿名 case ID、首个可见内容和完整结果整数耗时，不输出 Key、Authorization、
选区、上下文、Prompt、响应正文或 usage。命令会产生 DeepSeek API 费用，必须由用户在配置
Key 后另行明确授权；它不读取 `~/.codex`、不修改 `provider.json`、不自动切换 Provider，也
不属于默认门禁。

## 完整默认门禁

macOS 发布工作树运行：

```bash
pnpm verify:macos
```

Windows Node.js 26 发布工作树运行：

```powershell
pnpm verify:windows
```

两条命令都依次执行指令、格式、Lint、类型、单测、Store 关键覆盖率、架构检查、构建、Chrome
Playwright、Store 候选包审计、生产依赖审计和 diff 检查。Windows 另构建真实 SEA `.exe`，用
Native Messaging `health` 帧验证 v0.13.0、
DeepSeek 固定 Provider、`deepseek-v4-flash` 和 `codexVersion: null`，并拒绝 stderr 或额外
stdout。SEA health 从仓库外临时目录运行，清除 `NODE_PATH` 并使用临时 `LOCALAPPDATA`，确保
运行时不依赖仓库 `node_modules`。GitHub Actions 的 `macos-quality` 使用 Node 24，
`windows-quality` 使用 Node 26。

该门禁不包含真实 smoke、Host 安装、Chrome 操作、真实钥匙串、DPAPI、注册表或欧路访问。
纯逻辑和共享契约要求双平台 CI；系统原语还必须按
[跨平台开发规则](cross-platform-development.md) 在目标平台人工验收。

`0.12.0` 的 Windows 验证已完成离线质量门、另行 62 条 Playwright、Node.js 26 SEA 打包和
仓库外独立 `health` 帧验证。随后完成实际 SEA 安装、精确 HKCU 注册表与 manifest 检查，并对
安装后的 Host 直接执行 `health`；安装文件与已验证构建产物哈希一致，既有凭据和生词同步状态
仍存在。Chrome 已重载最新未打包扩展；真实 YouTube 已确认新版字幕 UI 注入、播放中选词后
连续两轮首击关闭并持续播放、原暂停状态保持暂停，以及下一次普通播放器点击只切换一次。
`Shift+Z` 由浏览器 E2E 覆盖，字幕角标按住由控制器集成单测覆盖；实机页面已确认两个入口可见。
真实 DeepSeek 与欧路请求未执行，仍需单独授权。macOS 门禁与实机验收后续在 macOS 环境继续，
因此当前记录不是
双平台发布完成结论。

## Windows 实机验收

macOS 单测只验证 Windows 路径、固定 Provider、DPAPI helper 参数、SEA 配置、注册表参数和
fail-closed 行为。Windows CI 会实际产出并运行 SEA `.exe` 的 health 路径，但仍不能代替以下
发布前人工验证：

- Node 26 的 `pnpm host:windows:package` 产出可独立启动的 SEA `.exe`；
- 安装器只写 `%LOCALAPPDATA%\Huayi\native-host` 和精确 HKCU Chrome 注册表键；
- 安装输出中的扩展 ID、Chrome 对当前未打包扩展显示的 ID，以及 Native Host manifest 唯一的
  `allowed_origins` 三者完全一致；
- Chrome health 显示 v0.13.0、DeepSeek 和 `codexVersion: null`；
- DeepSeek 与欧路两份 DPAPI 凭据可由当前用户分别读取，换用户或复制到另一台机器后不能
  解密；
- 单词、短语、句子和段落成功，欧路查词/加词成功，Codex/其他模型 Provider 命令明确拒绝；
- 重复安装保留两份凭据，卸载不触碰其他 Native Messaging Host。
