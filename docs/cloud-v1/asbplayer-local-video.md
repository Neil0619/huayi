# asbplayer 本地视频学习（Store）

本功能影响 shared Store 扩展，目标为 Windows Chrome。asbplayer 播放本地视频并解析字幕，语见在
视频画面上提供可选择的学习字幕、查词卡和现有生词本。功能候选的自动化、官网和 Windows 实机证据
分别记录；构建通过不代表 Windows 验收通过。M0 官网兼容基线见 [适配探针记录](asbplayer-m0-probe.md)。

## Windows 使用流程

1. 使用待验收的语见 Store 构建，在设置页将「asbplayer 本地视频」设为英文或双语。新安装默认英文，
   临时中文快捷键默认关闭；升级用户首次复制原 YouTube 快捷键，之后两者独立配置。
2. 在 Chrome 打开 [官方网页](https://app.asbplayer.dev/)，通过网页入口拖入可播放的视频和文本字幕。
   不需要 asbplayer 扩展、Native Host 或 Anki。
3. 学习层会列出轨道编号和文本预览。根据内容确认英语轨道、中文轨道；单轨分行双语可选择同一轨道，
   没有中文则选择「无中文轨道」。选择只保留在当前播放会话，不从文件名猜测语言。
4. 确认后，双击英文单词或拖选短语、整句，使用语见现有翻译／解释卡。单词和短语带当前英文句作为
   语境；跨多个字幕块的选区无效。收藏继续写入现有本机词本。
5. 使用「固定中文」显示已有中文，或按住中文按钮／自行配置的快捷键临时查看。未选择或未加载中文
   时仍可英文划词，不会自动翻译整片。
6. 关闭词卡或结束临时查看时，只恢复语见自己暂停的正常播放。原本暂停、用户主动操作或更换媒体后
   不会强行播放。asbplayer 自动暂停、循环、跳过空白等模式保留上游播放控制。

播放器内全屏和官方弹出窗口属于验收范围。浏览器原生 video 全屏无法承载学习层时恢复原字幕，退出
后再使用学习功能。侧栏字幕列表继续由 asbplayer 管理。

## 输入准备与回退

- 使用 UTF-8 文本 SRT、VTT、ASS 等 asbplayer 可解析输入。英文与中文两条轨道最明确。
- 单轨双语要求每个 cue 有清楚、独立的英文行和中文行。含糊的同一行混排不猜测、不删文字；先拆成
  两条轨道再加载。需要保留说话人、重复对白和重叠对白时，在文本中明确保留。
- 容器扩展名不能证明浏览器支持其中的音视频编码。先用官方网页确认画面和音频都正常；不兼容输入
  需用户提前转成 Chrome 支持的编码。首版不提供转码。
- 内嵌字幕先提取成外挂文本；图片字幕先 OCR 并校对；压制在画面中的字幕不能直接被划词。
- 输入为空、超限、播放上下文不匹配、缺少完整快照或无法唯一识别主视频时，保留 asbplayer 原显示。
  晚接入错过完整广播时需重新加载字幕或重开播放视图；仅时间、偏移消息不能伪装成成功接入。
- 停用语见、禁用站点或关闭此适配立即恢复原字幕。重新启用后若完整快照已清除，按提示重新加载。

## 代码与信任边界

`apps/store-extension/src/content/asbplayer/` 独立负责官网上下文、MAIN 桥、ISOLATED 会话、轨道和字幕
呈现。两个静态入口仅匹配 `https://app.asbplayer.dev/*`：MAIN 在 `document_start` 被动订阅上游
BroadcastChannel，ISOLATED 在 `document_idle` 接入。仅这两个入口设置 `all_frames=true`；普通网站
和 YouTube 的注入范围不扩大。三个 Store profile 使用同一组入口，Classic/Native Host 不接入。

桥不替换全局 BroadcastChannel、不劫持网络或 React，不发送上游播放命令。官方 iframe／弹窗、同源
blob 媒体和 channel 经严格核对后才能订阅。主视频按来源、播放器结构和可见布局唯一确认，排除同源
缩略图视频。实际播放操作经媒体会话接口执行，并以真实媒体事件撤销过期暂停归属。

上游频道和 MAIN 页面消息都不可信。origin、随机关联标识、channel 和代次只防止串线，不能认证同页
脚本。两侧只传白名单字段，启动时留一份有界内存快照，并限流、拒绝迟到修订；停用、销毁或更换媒体
时清除。字幕上限为 2 MiB（包括规范 JSON 元数据和转义）、50,000 cues、8 轨道、每 cue 2,000 字符。
字幕作为文本渲染，不作为 HTML。文件名、路径、文件对象、媒体地址、图片和原始频道消息不加入
扩展业务消息、日志或云请求；Chrome 提供的 sender URL 仅用于本地设置授权校验。

时间来自 `originalStart/originalEnd + 当前 offset`，不重复叠加上游已偏移时间。必须同时取得完整字幕和
明确的当前 offset，才能替换原字幕。英语使用独立的本地分句策略，保留重复和重叠对白；按时间索引
查询当前句，并用区间重叠关联中文。原字幕通过局部可逆样式隐藏，不写上游持久设置。
分句后的派生文本最多 100,000 段；同一时刻最多 64 个英文块、每句最多关联 256 个中文 cue。
超过显示资源边界时恢复原字幕并显示原因，避免合法尺寸但高度重叠的输入阻塞页面。

`content/subtitles/` 承担可复用选区、临时中文、快捷键和暂停归属；YouTube 轨道捕获和站点生命周期
仍独立。Overlay 可挂载到播放器和全屏宿主，查询和词本复用 Store 既有实现。

Settings v7 增加 `asbplayerMode` 与 `asbplayerShortcut`，保留 v1–v6 迁移。迁移必须存储成功后才返回。
Store 内部消息 v6 增加专用设置读取和完整字幕句边界；旧版本标签页需要刷新。Classic wire v7 不变。
设置变更通过现有广播送到所有活动帧，模式与快捷键无需刷新生效。

本机词本仍为 `source=web`，云分析仍为 `web-selection`。只在有效划词及已有同意流程下联网，不因
加载字幕调用模型。本机收藏成功与云复制失败隔离，关闭卡片不取消 Worker 已接受的收藏。没有新增
API、SQL、词本数据库迁移或运行时依赖。

## 候选验证与 Windows 交接

默认测试使用离线夹具和假 Provider，不消耗模型费用或写外部词典。实际 Store 产物的浏览器验证必须
覆盖 MAIN／ISOLATED 两个世界、iframe、全屏和弹窗，不能由 Classic YouTube E2E 替代。官网协议是
上游内部实现，官网更新后应重跑 M0 和实际 Store 浏览器验收。

在仓库根运行相关检查：

```sh
pnpm exec vitest run --project store-domain --project store-extension --no-file-parallelism
pnpm --filter @huayi/store-extension typecheck
pnpm --filter @huayi/store-extension build
pnpm check:architecture
pnpm check:store-release
pnpm build
pnpm exec playwright test apps/store-extension/e2e/asbplayer-package.spec.ts apps/store-extension/e2e/asbplayer-matrix.spec.ts
```

该浏览器夹具加载真实 `dist-release` 扩展，使用真实 MAIN／ISOLATED、Worker、Chrome Storage 和
IndexedDB；网站、字幕、媒体及 Provider 响应为离线合成数据。它还覆盖普通网页和 Store YouTube
无需刷新进入视频页的回归，以及失效快捷键和显式 pagehide/pageshow 事件。显式事件测试不等同于
浏览器真实命中 BFCache。另运行 `pnpm exec playwright test apps/store-extension/e2e/asbplayer-bfcache.spec.ts`，
移除 Playwright 默认禁用 BFCache 的启动参数，通过真实导航离开／返回并断言实际 iframe 的
`pageshow.persisted=true`、词卡退役、原字幕恢复、新快照及重新确认，不派发合成生命周期事件。
CI 分别运行 `pnpm exec playwright install chrome` 和
`pnpm exec playwright install chromium`，避免 Chrome 已安装导致 Chromium 安装被提前结束。

获得实际浏览器验证授权后，使用以下命令核对官网当前部署；脚本仍拦截 Provider 请求，不产生模型
费用或外部词典写入，退出时删除隔离 Chrome profile：

```sh
node scripts/verify-asbplayer-store-browser.mjs --run-approved-browser-validation
node scripts/verify-asbplayer-store-matrix.mjs --run-approved-browser-validation
```

两个脚本各自将回执写入已忽略的 `artifacts/asbplayer-store-browser-receipt.json`，包含浏览器、平台、
官网资源摘要及实际加载的 Store 文件摘要；顺序运行时应先保存前一次回执。第一个覆盖双轨 SRT、
VTT、文本 ASS、学习收藏、全屏、弹窗和停用恢复。第二个通过官网实际控件验证正负／重复偏移、
倍速、结束、四种特殊播放模式、单轨双语和切视频，并在真实扩展世界验证旧频道、迟到修订及超限
字幕后的安全回退和恢复。敌对消息为定向合成输入，不能声称覆盖任意攻击组合。
完整 Windows 矩阵仍需按下表执行，两份回执均应记录真实系统缩放。

完整平台门禁为 `pnpm verify:macos` 和 Windows 上的 `pnpm verify:windows`。Windows 环境遵循仓库
工具链要求；不得在 macOS 模拟结果冒充 Windows 通过。记录候选源码摘要、产物摘要、Chrome 与 OS
版本、实际命令和结果，保持自动化、官网验证与 Windows 验收对应同一候选。

Windows 交接通过 Git 获取开发分支和准确 commit；步骤及已有证据见
[Windows Git 接续说明](asbplayer-windows-handoff.md)。先核对候选，再以 Node.js 26+ 运行
`pnpm install --frozen-lockfile`、分别安装 Chrome 与 Chromium、`pnpm verify:windows`。
授权官网实测后运行上面的 Store 浏览器脚本，再按下表进行人工交互和缩放验收。
默认 release 构建位于 `apps/store-extension/dist-release`；不要混用 `dist` 或 `dist-production` 的身份。

Windows 实机应使用隔离 Chrome profile 和合成／公开许可样片，在 100% 与 150% 系统缩放、常见窗口
尺寸下覆盖：

交接文档中的 `HUAYI_ASBPLAYER_NATIVE_SCALE` 仅校验操作系统已设置的比例，默认离线测试仍使用
固定 viewport。扩大后的实际产物矩阵另测单轨双语、偏移后的可见字幕、倍速与结束、暂停归属、
原生 video 全屏回退、解释和关卡后的本机收藏；上游消息仍为合成，不能据此声称官网完整矩阵通过。

| 范围       | 必须观察的结果                                                                |
| ---------- | ----------------------------------------------------------------------------- |
| 加载与时间 | 双轨、单轨双语、无中文；正负偏移和重复偏移；跳转、倍速、结束、切文件／轨道    |
| 学习闭环   | 双击和拖选→翻译／解释流→收藏→关卡继续，无重复请求；保存中关卡仍能完成本机写入 |
| 暂停归属   | 原本暂停不恢复；用户播放／暂停／跳转撤销旧归属；特殊播放模式不自动恢复        |
| 展示形态   | 网页内、全屏、弹窗；换全屏查询不丢失；原生 video 全屏安全回退                 |
| 设置与失效 | 模式／快捷键即时生效；停用恢复原字幕；缺快照、恶意／超限字幕和旧消息安全回退  |
| 既有功能   | Store YouTube 首次加载和 SPA 进入、字幕切换、词卡、暂停恢复；普通网页划词     |

验收不保存字幕原文、文件名、路径、播放器完整 URL、channel、凭据或原始广播。发布、提交、部署和
商店送审是独立步骤；本功能开发测试不会自动执行这些操作。
