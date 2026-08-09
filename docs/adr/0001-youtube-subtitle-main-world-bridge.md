---
status: accepted
---

# 通过当前播放器取得 YouTube 源轨与译文轨

Huayi 选择在短生命周期 MAIN-world bridge 内驱动当前 YouTube 播放器，并捕获播放器自己发出的
源字幕与 `zh-Hans` 自动翻译 timedtext；isolated Content Script 只接收有界字幕数据。这样能
复用播放器当前会话的真实请求环境，又不会把 URL、Token、Cookie 或播放器对象跨 world 传递。

真实 Chrome 验证表明，播放器发出的有效 JSON3 timedtext 可能包含 `pot`，也可能省略它。因此
`pot` 不是接受请求的必需指纹；若存在则必须非空且不超过 4,096 字符。省略 `pot` 不会放宽其他
边界：wrapper 仍只在一次受控播放器操作期间存活，并继续精确校验 host、path、videoId、语言、
kind、`tlang`、`fmt=json3`、2xx 响应、JSON3 Schema 和全部大小上限。

源轨与译轨由 isolated controller 串行请求。bridge 只有在同一代次已经成功捕获、且当前活动轨
仍精确匹配该源轨时才接受译轨请求；译轨阶段直接驱动 `translationLanguage: zh-Hans`，不重复
触发同一源轨。真实播放器可能缓存重复源轨请求，旧的二次源轨预捕获因此会在 3 秒处超时并让
中文永远不可用；显式源轨身份既消除了该缓存依赖，也继续拒绝页面伪造的孤立译轨请求。源轨
身份字段和恢复快照按值复制，不保留播放器可原地修改的轨道对象引用。

驱动字幕模块会让原生 cue 在恢复轨道时短暂消失，因此 isolated 侧不能把该瞬时空窗口误判为
切轨。请求前仍要求可见英文 cue；捕获后 MAIN bridge 复核 CC 和当前驱动轨未变，isolated 侧则
允许短暂无 cue。译轨成功或可恢复失败都必须在原 7 秒请求期限内，经过 50ms 轮询取得连续
750ms 的稳定源轨窗口后才完成；MAIN bridge 必须先完成同步播放器恢复，再发送该次成功或失败
响应。source 阶段非英文仍立即拒绝，等待超时仍失败关闭。这样保留
用户切轨失败关闭，同时避免 bridge 自身动作使有效结果失效。

字幕 DOM 不是轨道身份的权威，英文 ASR rolling correction 与预分句不互含也不构成切轨证据。
DOM 不一致连续 2 秒后，controller 只请求 MAIN bridge 做只读源轨身份探测；探测不驱动播放器
或网络，只返回 `same-source`、`different-english`、`non-english` 或 `unavailable`，且不暴露语言、
vssId 或播放器对象。相同源轨保留当前面板，另一英文轨才重开代次，非英文或不可用状态暂停
Huayi 并恢复原生字幕；后续 cue 变化可再次探测，以便用户切回英文时恢复。导航开始后直到
`yt-navigate-finish` 才解除
捕获锁，期间 `yt-page-data-updated` 不得提前捕获。同视频的独立 page-data 事件只刷新视图，
不开始新代次。YouTube 重建控制栏时字幕面板继续存活，仅重新挂载双语控制；控制栏正常
auto-hide 时“中”随原生控件一起隐藏。

我们拒绝匿名重新获取 `/watch`、直接请求裸 `baseUrl`、后台模型预翻译和持久缓存：前两种路径
无法可靠继承播放器鉴权，后两种会扩大数据、费用和协议边界。代价是依赖 YouTube 私有播放器
接口；因此任何未知状态、超时、校验失败或私有接口变化都失败关闭，并恢复 YouTube 原生字幕。
