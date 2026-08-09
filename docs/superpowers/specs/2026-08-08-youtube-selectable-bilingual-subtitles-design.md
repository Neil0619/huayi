# YouTube 可选英文与快速双语字幕设计

本设计自 2026-08-08 起取代
[`2026-07-18-youtube-caption-selection-design.md`](2026-07-18-youtube-caption-selection-design.md)
中的“译”按钮、冻结 picker、“整条字幕”和 30 秒 DOM 缓冲方案。

## 目标与范围

功能属于共享 Extension UI，只在标准 YouTube `/watch` 录播页、CC 已开启且当前实际字幕轨为
英文时接管。Huayi 不开启 CC、不切换字幕轨、不支持直播、Shorts、OCR 或字幕历史。版本保持
`0.12.0`，wire v6、Native Host、Provider、Chrome 权限和凭据路径不变。

源轨验证成功且当前字幕句可调度后，Huayi 才隐藏 YouTube 原生字幕并显示可原生选择的 Light
DOM 英文字幕。每个新视频默认英文模式；译轨失败不影响英文字幕，但“中”和临时双语不可用；
源轨失败或运行条件失效则立即恢复原生字幕。

## 字幕获取

独立 `youtube-bridge.js` 在三个 YouTube HTTPS host 的 MAIN world、`document_start` 运行，运行
时仍只接受精确 `/watch`。isolated world 只提交 requestId、字幕代次、预期 videoId 和源／译
目标，不传 URL、baseUrl、PoToken、Cookie 或播放器对象。

bridge 从实时播放器读取视频、CC 状态和活动英文轨，保存原 CC／轨道状态，临时包装 fetch 与
XHR。isolated 先捕获并验证活动源轨；同一代次的译轨请求必须匹配该已验证源轨，随后只驱动其
`translationLanguage: zh-Hans`，不再重复触发可能被播放器缓存的源轨请求。它只捕获匹配当前
视频、语言、kind、tlang 和 `fmt=json3` 的 `/api/timedtext` JSON3。操作严格串行，单轨超时 3
秒；响应体上限 2 MiB、每轨最多 50,000 cues。源轨身份字段和恢复快照按值复制，不能被播放器
后续原地修改轨道对象所污染。

播放器请求的 `pot` 参数可存在或省略；存在时必须为 1–4,096 字符。省略 `pot` 不放宽其余
校验：请求仍须在一次受控播放器操作的短生命周期 wrapper 内出现，并精确匹配 HTTPS host、
path、videoId、语言、kind、`tlang`、`fmt=json3`、2xx 状态及有效有界 JSON3。bridge 不主动
构造匿名 timedtext 请求。

所有成功、失败、超时、中止和导航路径都恢复原播放器状态；bridge 只有在同步恢复播放器状态
完成后才向 isolated world 发送成功或失败响应。全局网络函数只有仍为 bridge 自己
的 wrapper 时才还原；页面后来增加 wrapper 时保留新值。isolated world 把返回数据继续视为
不可信，严格校验消息结构、当前页面／播放器／CC、非英文可见字幕和 timedtext 指纹，并丢弃
跨视频或迟到结果。请求仍只从可见英文字幕启动；bridge 每次捕获完成后还会确认 CC 仍开启且
当前驱动轨未被用户切换。由于 bridge 自己重载字幕模块会让原生 cue 在恢复期间短暂消失，响应
复核允许“暂无 cue”。译轨成功或可恢复失败都要在现有 7 秒请求期限内，以 50ms 间隔取得连续
750ms 的稳定英文源轨窗口；source 阶段可见非英文字幕仍立即拒绝，译轨等待超时也失败关闭。
controller 不把字幕 DOM 当作轨道身份。原生 cue 连续 2 秒与已捕获源轨不一致时，只向 MAIN
bridge 发送严格、有界、只读的源轨身份探测；该探测不驱动播放器，也不包装 fetch／XHR。bridge
只返回 `same-source`、`different-english`、`non-english` 或 `unavailable`，不返回语言、vssId、URL、
Token 或播放器对象。`same-source` 证明只是 ASR rolling correction 并保留当前面板；
`different-english` 才开始新代次；`non-english`／`unavailable` 暂停 Huayi 并恢复原生字幕，后续
cue 变化可再次探测并在用户切回源英文轨时恢复。明确 CC OFF 仍立即恢复。导航锁从
`yt-navigate-start` 保持到 `yt-navigate-finish`，期间 page-data 更新不能提前捕获过渡播放器。
YouTube 重建控制栏时只重新挂载“中”，不会销毁仍有效的字幕面板或重新捕获轨道；控制栏正常
auto-hide 时“中”随原生控件一起隐藏。

## 分句与译文对齐

生产 controller 依赖 `SubtitleSentenceSegmenter` seam，本期只有确定性的本地 adapter：句末
标点或相邻 cue 间隔至少 1.5 秒形成边界；达到 120 Unicode code points 或 12 秒时在 cue 边界
软切；若下一 cue 会超过 200 code points 或 15 秒，则在当前 cue 边界强制切分。无标点 ASR
使用相同间隔与上限，不调用模型。

一个字幕句从首 cue 开始便显示完整英文，直到末 cue 结束，因此允许提前看到后续几秒。中文只
合并与英文句时间窗有严格正重叠的译文 cues，按时间排序、规范空白并去除滚动重复；不按数组
索引对齐，无有效译文时省略中文行。

## 交互状态

状态包含字幕代次、源／译轨 readiness、固定双语、按住 F8、活动选区和暂停所有权：

- 点击 CC 旁“中”切换当前视频固定双语；无修饰、非重复 `F8` keydown 临时显示中文。
- keyup、窗口 blur、页面隐藏、导航或销毁清除临时 F8；可编辑控件聚焦、有选区或有结果卡时不
  消费 F8。实际中文条件为译轨 ready 且固定双语或正在按住 F8。
- 支持浏览器原生双击选词，以及拖选短语或完整句子；不实现单击查词。Range 必须完全在当前
  英文句节点内，规范化选文还必须对应内部冻结句子的精确 substring；鼠标可在文本外松开，
  接受与否只由 Range 决定，上下文不信任可修改 DOM。完整句（即使没有句末标点）沿用 wire v6
  的 `sentence` 形状，`context` 为内部冻结句且 `sentenceContext` 为 `null`，不会复用先前的
  单词选区。
- 有效非空选区冻结字幕句。仅视频原本播放时暂停，并以播放器和字幕代次记录暂停所有权；原本
  暂停时关闭不得播放。
- 有选区或卡片时，第一次点击播放器视频空白区由 Huayi 消费，关闭卡片、清除选区，并只恢复
  Huayi 暂停的视频。控件、字幕和 Huayi UI 不属于空白区。
- 用户主动播放、seek、视频结束、导航或播放器替换立即撤销暂停所有权。显式加入生词本 pending
  时维持既有外点行为，不关闭、不取消或重开写入。

选区继续复用既有 wire v6 解释、翻译、自动查词与欧路显式加入流程；warmup 仍不包含字幕、
URL、videoId 或其他页面数据。

## 构建、安全与延期

Extension 构建顺序固定为 content IIFE（清空 dist）、YouTube bridge IIFE（保留输出）、
background ESM（保留输出并复制 Manifest／assets）。Manifest 只增加静态 MAIN content-script
入口，权限仍严格为 `alarms` 与 `nativeMessaging`。

Duo Translator 仅作为交互行为和私有播放器机制的研究材料。Huayi 独立重新实现，不复制其
GPL-3.0 代码、测试、结构、命名或视觉资产，也不宣称法律意义上的严格 clean-room。

Phase 2 可增加另一个智能分句 adapter；本期不增加对应 UI、wire、Host、Provider、Prompt 或
未使用占位代码。
