# asbplayer M0 适配基础与验证探针

本阶段只实现 Store 侧可复用的被动适配基础和独立验证探针，影响平台为 shared（macOS/Windows Chrome）。
不接入 Store 正式 Manifest、设置、Overlay、模型或词书流程，不构成安装、发布或后续 M1–M4 完成证据。
官网 Chrome 的 M0 验证必须先于后续功能阶段；Windows 平台验证按当前任务批准的门禁执行。

## 已核对的上游协议

来源固定为 asbplayer commit `ff63e8fff2aaa0171ab36b1977346500713e2667`：

- [player-channel.ts](https://github.com/killergerbah/asbplayer/blob/ff63e8fff2aaa0171ab36b1977346500713e2667/common/app/services/player-channel.ts)
- [video-channel.ts](https://github.com/killergerbah/asbplayer/blob/ff63e8fff2aaa0171ab36b1977346500713e2667/common/app/services/video-channel.ts)
- [VideoPlayer.tsx](https://github.com/killergerbah/asbplayer/blob/ff63e8fff2aaa0171ab36b1977346500713e2667/common/app/components/VideoPlayer.tsx)
- [model.ts](https://github.com/killergerbah/asbplayer/blob/ff63e8fff2aaa0171ab36b1977346500713e2667/common/src/model.ts)

完整字幕消息为 `subtitles.value`；增量编辑分别使用 `subtitlesUpdated.subtitles`（发往播放器）和
`subtitlesUpdated.updatedSubtitles`（来自播放器）。二者均有 cue index；仅替换文本，保持原时间和轨道，
拒绝同时出现两个方向字段的歧义消息。`offset.value` 为绝对毫秒偏移，始终从 `originalStart/originalEnd`
计算一次；不使用已加偏移的 `start/end`。同值 offset 回声不重新构建字幕。

`playbackState` 只保留 `timestampMs`、`showingSubtitleIndexes`、可选的 `hiddenSubtitleIndexes` 和
`paused`；hidden 是 showing 的隐藏掩码，允许重叠。`playModes` 使用数值数组：1 normal、2 condensed、
3 autoPause、4 fastForward、5 repeat。未观察到播放模式时保持未知，不猜测默认值。

2026-09-23 当前任务另已只读取得官网 `index-Dxgx2rYx.js`，大小 1,865,088 bytes，SHA-256：
`6a604e3145ce5409dd3135f77f1d16d337b658aa8f880de89f4f5f3304a95456`。这只证明官网资源可读及
上述协议字符串存在，不证明官网构建等于固定 commit，也不证明消息时序及视频控制已经实测。

## 边界与失败行为

仅接受 `https://app.asbplayer.dev/` 播放地址中各一个 `video` 和 `channel`。video 必须是该 origin
的规范 blob UUID 地址，channel 为有界标识；拒绝异常端口、userinfo、非根路径、fragment、重复参数、
外部媒体与外部 blob origin。默认同源 iframe 和独立 popout 均可使用；iframe 的 parent 与 top 必须均为
官方 origin，跨域访问异常失败关闭。

适配器在 `document_start` 立即监听同名 BroadcastChannel，**不发送任何消息**，不模拟 `init/ready`，
不请求重播。尚未收到合法完整快照时为 `waiting`，仅 playback/增量消息不能将其变为可用。晚注入漏掉
初始广播时保留 waiting，由操作者重新打开官方播放视图或重新加载字幕，不以 DOM 文本伪造快照。
完整快照（包含空数组）变为 `ready`，它只表示完整快照已收到，**不表示字幕可学习或学习功能可用**。
已识别消息越界/无效时清空并变为 `invalidated`，仅新的完整快照可以恢复。关闭、页面离开、上下文
变化时移除监听、关闭本地 channel，释放字幕和播放状态。

快照只有本地 session/revision、固定状态原因、原始/偏移后时间、cue index/track/text、offset 和播放状态；
不含文件名、channel、blob/media URL、图片、tokenization 或上游 settings/凭据。正文保留为有界字符串，
不得当作 HTML 使用。整份规范 JSON UTF-8 ≤ 2 MiB、cue ≤ 50,000、track 编号 0–7、单 cue text ≤ 2,000
UTF-16 单元；元数据与转义字节计入总限额。只对 allowlist 字段序列化，不序列化上游整条消息。

每次消息处理重新核对上下文，并拒绝旧监听器/session 的迟到事件。同一文档不重新加入已退役 channel，
最多保留 64 个私有 channel 标识；否则需重新打开播放视图。BroadcastChannel 不是认证边界，同 origin
网页仍可伪造消息；上游没有会话 nonce，因此不能将同一活动 channel 的来源认证为某一个发送者。

主视频与 seek 预览视频使用相同 src。选择器要求精确 src、`.asbplayer-token-container` 的直接 video 子元素、
`preload=auto`、无原生 controls、可见祖先及与视口相交的非零布局，且只有一个候选。不可见、未布局或
存在歧义时控制不可用，不使用“第一个 video”。探针的暂停/播放仅在用户点击时重新验证并调用当前主
HTMLVideoElement，绝不发送上游 BroadcastChannel 控制指令。

## 本机构建与离线检查

在仓库根运行（macOS shell 与 Windows PowerShell 均适用）：

```sh
pnpm exec vitest run --project store-extension apps/store-extension/src/content/asbplayer
pnpm --filter @huayi/store-extension typecheck
pnpm exec eslint apps/store-extension/src/content/asbplayer scripts/build-asbplayer-m0-probe.mjs scripts/build-asbplayer-m0-probe.test.mjs
pnpm exec prettier --check apps/store-extension/src/content/asbplayer scripts/build-asbplayer-m0-probe.mjs scripts/build-asbplayer-m0-probe.test.mjs docs/cloud-v1/asbplayer-m0-probe.md
node --test scripts/build-asbplayer-m0-probe.test.mjs
node scripts/build-asbplayer-m0-probe.mjs
```

构建仅生成 Git 忽略的 `artifacts/asbplayer-m0-probe/probe.js` 与独立 `manifest.json`，从上述 TS 源码
打包，不含第二份手写适配逻辑；不启动浏览器、不安装、不改 Store `dist`/`dist-production`/`dist-release`。
测试以 fake channel、jsdom 和固定字幕验证边界，不访问官方站点或外部服务。构建测试同时校验探针权限、
MAIN 世界和无远程请求/上游发信能力，并核对三个 Store Manifest 未改变。

## 获得真实 Chrome 验证授权后

1. 在隔离 Chrome profile 中加载该独立探针目录，再打开官方页面；保持现有 Store 安装目录不变。
   探针 manifest 仅匹配官方域、`all_frames=true`、`document_start`、`MAIN`，无后台、storage 或网络权限。
   若采用 CDP，必须在创建页面/iframe 前注册相同产物的 MAIN 世界初始化脚本。此探针验证上游捕获和
   本地媒体控制，不验证尚未实现的 MAIN→isolated 传输，也不证明正式 Content Script 接入完成。
2. 使用获准的本地测试视频和字幕，通过官网原生加载入口启动默认 iframe 播放。不得调用模型或真实词书。
3. 面板应从 waiting 到 ready，计数与测试字幕一致；开启 seek preview 后仍只有主视频可控。
   修改官网字幕偏移，面板毫秒值应一致；单次偏移不累计。切换字幕应替换计数，不能留下旧会话正文。
4. 点击探针“暂停测试”“播放测试”，分别核对主视频实际 `paused` 状态与广播暂停值；拒绝播放只能显示
   固定失败文案，不记录浏览器原始异常。隐藏预览的播放状态不得被误当成主视频。
5. 核对 popout、关闭、切换媒体/频道、重复加载与晚注入；旧 channel/事件不能恢复新会话状态。
   已经漏掉完整广播的晚注入应保持 waiting，不制造成功。
6. 验收仅记录 OS/Chrome 版本、上游资源摘要、计数、状态、偏移和暂停结果。禁止录入字幕原文、文件名、
   完整播放器 URL、blob URL、channel、设置、凭据或原始消息。不要保存含这些内容的 trace/network dump。

探针宿主 `[data-seen-said-asbplayer-probe]` 提供上述有界计数 `data-*`，可供验收脚本只读检查；DOM 没有完整
快照或正文导出。页面离开时清理，BFCache 恢复后需重新打开播放视图以再次订阅。

## 当前验收状态

代码阶段已观察初始缺少模块的 RED，再观察 iframe 信任、hidden/showing 重叠、offset 回声、退役 channel
及 MAIN manifest 的断言 RED；随后 focused 测试转绿。具体最终检查数量以当前任务回执为准。

2026-09-23 已在本机 macOS、Chrome for Testing `149.0.7827.55`、独立临时 profile 中完成官网 M0 验证。
实际加载上述独立 Manifest 的 MAIN content script；未用初始化脚本替代扩展注册。官网资源摘要与上文一致。
回执保存在 Git 忽略的 `artifacts/asbplayer-m0-probe/browser-receipt.json`，探针摘要为
`7ea7965827295dbea5e2f9b2a711e7f96eafd9ee7c878acb19291198fdcacd88`。

已验证：原生入口加载合成 WebM 和中英 SRT 后 iframe 捕获 5 cue/2 track；进入/退出全屏；本地暂停/播放、
广播暂停值及父页面当前字幕选择同步；同 src 的主视频和预览视频共存时只控制主视频；绝对偏移
`1500 → 1500 → -500 → 1500 ms`；popout/pop in；字幕替换为 3 cue/1 track；卸载后新 blob/新 channel
重新捕获 5 cue/2 track。晚注入第二份探针保持 waiting/0，不制造完整快照。直接刷新 iframe 时，上游会
关闭播放视图；通过官网文件入口重开后恢复捕获。这与单纯等待原 iframe 原地恢复不同。

初始未进行播放交互时已收到 `playModes=[1]`；通过官网菜单选择 Condensed、Auto-pause、Fast-forward、
Repeat 分别得到 `[2]`、`[3]`、`[4]`、`[5]`，每次回到 Normal 都得到 `[1]`。未知模式仍不能当作 Normal。
记忆 `+1500 ms` 的新 iframe 中，实际顺序为 mode `[1]`、完整字幕两次、offset `1500` 两次、mode `[1]`、
offset `1500`；完整字幕本身未预加 `1500 ms`。因此 `ready` 只意味着完整快照已到，不能据此认为展示
偏移已经就绪。popout 的最终计数、偏移、模式和控制均通过，但额外 Playwright 初始化观察器未在该
弹窗取得事件记录，**弹窗的初始消息顺序未验证**，不从 iframe 顺序推断。

浏览器回归首先复现探针原 top/right 位置拦截官网全屏按钮，随后将面板移至左侧工具栏下方，完整回归
通过；RED 回执保留为 `browser-regression-red.json`。验收脚本显式避开音量按钮悬停区域，因为上游显示
音量条时会卸载偏移/速度输入框。此为验收驱动的控件选择修正，没有改变适配器的消息或时间语义。

仅在获得真实浏览器授权后运行（不属于默认离线测试）：

```sh
node scripts/build-asbplayer-m0-probe.mjs
node scripts/verify-asbplayer-m0-browser.mjs --run-approved-browser-validation
```

脚本使用 `@playwright/test` 的已缓存 Chrome，自动生成合成输入；只保存固定阶段、计数、布尔值、模式、
偏移及资源摘要，不生成 trace、网络 dump、截图或字幕/文件/频道日志。完成后关闭自建浏览器并删除临时
profile。额外初始化脚本仅作有界被动观察；晚注入仅用于验证漏掉完整快照时的失败关闭行为。

当前定向离线检查：54 项 Vitest、1 项构建测试、Store 类型检查、相关 lint/格式检查通过。
macOS 官网 M0 门禁已通过；Windows 实机验证仍待补，Store 正式接入及 M1–M4 尚未由本探针验收。
