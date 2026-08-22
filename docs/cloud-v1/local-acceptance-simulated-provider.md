# Phase 47：本机验收模拟模型

## 1. 目的与产品边界

`local-acceptance` 必须让用户在没有真实 DeepSeek Key、第三方网络或费用的前提下，实际走通 Web
深度分析、候选收藏、学习库维护、造句练习、受约束对话，以及后续 Store 平台查询。仅把 Provider
固定为 `model_unavailable` 可以证明失败关闭，但不能支持“边用边改”的产品验收。

本能力只属于本机验收 composition，不进入 production server、hosted acceptance 或 Store release
构建。它不是 DeepSeek 质量 smoke，也不授权真实模型、DNS、Resend、Vercel、Supabase Cloud、Google、
Chrome 安装或任何第三方数据发送。

用户可见行为固定为：

- 本机构建在登录、邀请和全部工作台页面持续显示“本机验收 · 模拟模型”横幅；横幅明确说明结果不是
  DeepSeek、只消耗本机测试额度且不产生外部费用；
- 深度分析、插件查询和练习正文至少一个主要中文字段带 `【本机模拟】` 标记，不能只依赖隐藏配置或
  开发者工具识别；
- 输出是确定性的结构演示，适合检查流程、数据持久化和交互，不用于评价翻译、教学建议或模型质量；
- 用户仍须通过真实本机 Supabase Auth 邀请、Mailpit 确认、登录、Cookie/CSRF、RLS 和正常业务入口；
  不增加免登录、固定 Cookie、管理员直写或 test-only 账号后门。

## 2. 技术方案

### 2.1 唯一 seam

`createAcceptanceApp` 继续组合完整 `createProductionApp`，只向现有 `providerFetch` seam 注入一个
acceptance-only Adapter。四条 DeepSeek Adapter、价格快照、quota reservation、durable dispatch、
strict provider response、结构校验、ledger settlement、lease/fencing 和业务持久化全部保持生产路径。
调用方只知道既有 fetch interface，不新增第二套分析或练习状态机。

模拟 Adapter 必须：

1. 只接受固定 DeepSeek HTTPS endpoint、`POST`、`credentials=omit`、`redirect=error`、JSON headers 和
   本机占位 Authorization；任何偏差在解析正文前失败；
2. 不调用全局 `fetch`、DNS、socket、文件、环境 secret、数据库或随机服务；只读取已经由生产 Adapter
   构造的有界 JSON request body；
3. 识别 WebDeepAnalysis、ExtensionQuery、DuplicateSuggestion 与五类 PracticeGeneration；未知 prompt、
   非法 JSON、超限或不完整输入全部失败关闭；
4. 返回严格 DeepSeek-compatible HTTP response envelope、固定非零虚构 usage 和确定性 JSON content；
   同一输入字节必须得到同一正文与 usage；
5. 只复用输入中的 server-owned analysis unit、candidate/item alias 和有界英文正文，不读取 owner、
   session、Cookie、CSRF、quota、URL、标题、凭据或内部 ID；不输出 reasoning；
6. 生成至少一个可收藏 Expression candidate，使用户能继续完成学习库与练习闭环；语义重复建议只
   允许返回服务器提供的 candidate alias。

模拟 response 中的 `candidate-1` 等值只是 private alias；与真实 Provider 相同，必须由 Analysis module
在持久化前换成服务器 UUID并同步改写 result 引用。模拟器不得为了数据库方便直接取得 ID source，也
不能让 acceptance-only 常量进入公共主键。

共享 `model_kill_switch` 仍位于模拟 Adapter 之前。local acceptance bootstrap 必须把它幂等设置为关闭，
这只让固定零网络 Adapter 进入 production 状态机，不改变 hosted/production 的 Operator 开关或失败关闭
默认值。

本机模拟器位于 DeepSeek HTTP Adapter 内，因而用于演练生产状态机的价格版本、ledger provider/model
和公开 AnalysisRecord metadata 仍保留 DeepSeek 技术兼容标识。这不代表发生了真实 DeepSeek 调用。
持续横幅与正文标记是用户可见权威；本机记录、导出、usage 和 micro-USD 都是测试数据，禁止提升为
真实模型质量、真实费用或 production 证据。不得为了本机便利扩大 production 的公开 provider 枚举。

### 2.2 Web 构建标识

`acceptance:local:build` 为 Web 固定注入单值 `VITE_ACCEPTANCE_MODEL=simulated`；该值不从
`.env.acceptance.local` 读取，也不允许命令行选择其他模式。Web 环境 schema 只接受缺省或精确
`simulated`，其他值让业务 bootstrap 失败关闭。普通 workspace/production build 不设置该值，因此不会
显示横幅。

横幅是根渲染层的独立只读模块，覆盖邀请、登录、错误和工作台页面，不把模式传给业务 API Adapter，
也不改变请求、Cookie、CORS、CSRF、路由或缓存。

### 2.3 构建与运行版本隔离

HTTPS 进程启动时必须一次性读取完整 Web bundle，并与同一进程只加载一次的 API composition 共同形成
一个运行版本。后续 `pnpm build` 或 `acceptance:local:build` 只能更新磁盘候选，不能让已启动的 8443
逐请求读取新文件，也不能形成“新 Web + 旧 API”的半部署状态。SPA fallback 也必须来自同一内存快照；
路径穿越返回 400，缺失 `index.html` 或出现非普通文件时启动失败关闭。

只有显式重启 HTTPS 才同时激活新 Web 与 API。快照运行时首次部署仍需空闲窗口，因为当前旧进程不具备
该隔离；完成首次切换后，后续完整构建门可在旧运行版本在线期间执行，最终 cutover 仍须在用户空闲时
短暂停止并启动 HTTPS。任何构建、快照或 cutover 都不得停止、reset、seed 或 bootstrap Supabase。

### 2.4 固定部署协调器

首次和后续本机切换统一使用
`pnpm acceptance:local:deploy --confirm-local-downtime`。命令只接受这一精确确认参数，并固定执行：

1. 复核当前 Supabase runtime 仍完整绑定 loopback；
2. 幂等停止 HTTPS；
3. 运行 acceptance-only API/Web build；
4. 启动后台 HTTPS，并由 lifecycle 的系统信任 CA probe 验证 Web/API/Supabase 三入口。

缺失、多余或错误参数必须在任何检查、停机或 build 前拒绝。任一阶段失败立即停止后续阶段；stop 后的
build/start 失败保持 HTTPS 停止，不能自动恢复可能已经部分改写的旧 bundle，也不能用普通 production
Web build 代替。修复后可用同一精确命令重试，因为 stop 是幂等的。协调器不得调用 Supabase stop/start、
migrate、reset、seed、bootstrap、invite、Provider smoke、Chrome 或网络部署，也不得输出 URL、token、
credential、构建 stderr 或用户数据。

### 2.5 双栈 loopback 入口

`*.acceptance.localhost` 在 macOS 同时解析为 IPv4 `127.0.0.1` 与 IPv6 `::1`；三个 HTTPS 端口必须分别
绑定这两个 loopback 地址，不能只绑定 IPv4 后依赖浏览器回退。禁止绑定 `0.0.0.0`、`::`、局域网地址或
OrbStack LAN forwarding。六个 listener 共用同一 Web 快照、API composition 和 Supabase proxy 行为；
任一地址绑定失败时关闭本次建立的全部 listener 并让启动失败。真实部署后须以系统信任 CA 分别执行
IPv4、IPv6 probe，任一失败都不能交付邀请入口。后台 lifecycle 的 start/status 也必须对三个 URL 分别
固定 `family=4` 与 `family=6`，不能依赖一次 hostname probe 恰好命中某个地址族。start 首次通过六入口
后还须等待稳定窗口，确认记录的 child 仍存活并再次通过六入口；旧前台进程不得掩盖新 child 端口冲突。
stop 的正常等待用尽并发送强制信号后必须再做一次有界退出等待，不能把“信号已发送”当作“进程已退出”。

## 3. TDD 与验证

Fresh RED 必须先证明：

- 当前 acceptance fetch 对全部请求固定失败，四类成功路径不存在；
- phrase WebDeepAnalysis 的 production trusted assembly 能保留 strict phrase result；
- acceptance build 未注入模拟模式，Web 环境不接受该模式且页面没有持续标识。

最小 GREEN 的 focused 证据至少覆盖：

- fetch interface 的 endpoint/method/headers/Authorization/abort/非法 JSON 失败关闭与零全局网络；
- phrase、sentence、passage 深度分析均通过 production DeepSeek Adapter 和公开 schema；候选可进入后续
  收藏流程，用户正文不进入错误或日志；
- 六类 ExtensionQuery 与五类 PracticeGeneration 输出都通过既有 strict schema；dialogue final feedback
  精确覆盖输入 item alias；DuplicateSuggestion 不返回未知 alias；
- 同一请求重复调用得到字节一致 content/usage，response 无 reasoning；
- production App 未注入 acceptance Adapter；只有 acceptance Web build 注入精确模式；banner 文案、
  `role=status` 和生产缺省不渲染均有组件测试；
- Web bundle snapshot 在磁盘文件被后续构建改写后仍返回旧字节；缺失入口时启动失败，只有 HTTPS 重启
  才能激活新 Web/API；
- deploy 协调器拒绝所有非精确 downtime confirmation，成功顺序固定为 runtime verify→HTTPS
  stop→acceptance build→HTTPS start；每一阶段失败都截断后续动作，源码/package contract 不包含任何
  数据重建或邀请操作；
- lifecycle health 覆盖旧未登记进程仍响应而新 child 退出的竞态；PID 只在 child 稳定存活并连续两次
  通过 IPv4/IPv6 六入口 probe 后才可作为成功状态保留；stop 回归另覆盖强制信号后的延迟退出；
- focused API/Web/script 测试、strict typecheck、lint、format 与 `git diff --check` 通过；随后运行完整
  `pnpm verify:macos`。本阶段不因 shared 代码小改立即要求 Windows，留到下一个验收冻结批次。
- quota summary 的 forced-RLS 集成回归必须证明失败收尾在 owner tenant transaction 中可读；模型开关或
  额度预检失败后请求必须得到 terminal event，不得停留 `running`。现场遗留只回收租约过期、未
  dispatch、未 reservation 的精确请求。
- 模拟结果已返回后若 assembly/commit 失败，回归必须证明失败 settlement 继续使用生成结果的 billed
  calls/usage/cost；Web 取消等待后必须保留 active request、显示 running 检查反馈，并禁止编辑输入绕过
  generation fence。

默认测试和本机真实 smoke 都必须保持零第三方网络。真实 smoke 只允许在另行批准专用 Key、数据范围、
额度和 kill switch 后执行，并且不能复用本机模拟记录冒充结果。

## 4. 用户验收

部署到正在运行的本机 HTTPS 环境需要一次 API/Web 进程重启。快照运行时尚未激活前，用户正在注册或
使用时只完成源码和不改写 live `dist` 的测试；得到首次空闲窗口后执行
`pnpm acceptance:local:deploy --confirm-local-downtime`。首次激活快照运行时后，
后续候选可先在旧版本在线期间完成 build/full gate，再于空闲窗口只执行 stop/start cutover。两种流程都
不停止 Supabase、不 reset、不 seed、不 bootstrap、不消费邀请。

部署后验收顺序：

1. 原邀请/登录页仍可访问，横幅持续显示且明确“不是 DeepSeek”；
2. 登录后手动粘贴 phrase、sentence、passage，各完成一次分析；
3. 从模拟候选创建 LearningItem，在学习库读取、编辑并检查重复建议；
4. 完成一次造句 prompt、提交、feedback、自评，以及一次 3–5 轮对话和最终逐项反馈；
5. 刷新、退出重登后数据仍在；记录所有产品反馈，但不把模拟翻译准确度当缺陷；
6. 创建真实学习数据后，在用户明确接受短暂停机的窗口再次运行非破坏性 persistence 验证。

通过标准是生产状态机和用户交互可以持续使用、没有第三方网络、标识始终诚实、数据可持久化；不是
“模型回答正确”。Store acceptance profile、真实 Provider、hosted acceptance 与 Windows 批次仍是后续
独立门。

## 5. 文档审查结论

- 拒绝在 Web/API caller 分别注入 fake：会复制业务状态并绕开 durable-before-dispatch；
- 拒绝直接替换 Analysis/Practice repository：不能证明生产 quota、ledger、lease 和严格解析路径；
- 拒绝把模拟器称为 DeepSeek 或隐藏在开发者设置中：普通用户必须持续看见环境性质；
- 拒绝扩大 production provider enum：本机测试能力不应永久扩大公开协议和迁移面；
- 接受在现有 fetch seam 后模拟 strict response：它是最小 interface、最大 production-path leverage 的
  深模块位置；所有模拟逻辑和测试集中在 acceptance Adapter，生产调用方保持不变。
- 接受启动时固定 Web/API 运行版本：它让构建产物成为候选而非即时部署，避免逐文件更新造成半部署；
  拒绝以 `no-cache` 响应头冒充版本隔离，因为它仍会逐请求读取正在变化的磁盘文件。
- 接受一个窄部署协调器隐藏停机/build/start 顺序；拒绝把 reset/restart-persistence 复用于代码部署，
  因为前者销毁数据，后者会不必要地停止 Supabase 并混淆 persistence 与 release cutover 证据。

## 6. 2026-08-22 实际核心旅程结论

本机模拟 Adapter 已通过真实 Web/API/Postgres 路径完成 passage analysis→candidate confirm→library
reread→sentence prompt→answer feedback→rating→practice history。过程中修复了真实 driver JSONB
double encoding、tenant/trusted 幂等写入边界和练习 quota settlement；这些都是 production composition
缺陷，不是模拟回答质量问题。最终 running analysis、open practice task、active reservation 均为 0。

当前纵切证明核心状态机可用，但不替代 3–5 轮对话的产品体验、注册后 persistence restart、真实
DeepSeek、hosted acceptance、多连接或 Windows 关键冻结批次。页面横幅和零第三方网络约束保持不变。
