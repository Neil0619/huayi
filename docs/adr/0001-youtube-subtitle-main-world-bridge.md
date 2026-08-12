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

真实 macOS Chrome 的重复刷新表明，源轨捕获稳定成功后，译轨的第一次播放器驱动仍可能瞬态
返回不可用；原实现把这次 `null` 当作整个 CaptionGeneration 的终态，导致同一刷新中中文行
永久为空。isolated controller 因此只对译轨执行一次有界恢复：第一次不可用后固定等待 200ms，
在 videoId、CaptionGeneration、CC 和播放器会话仍有效时再尝试一次。导航、CC 关闭、播放器
替换或 controller 停止会使等待中的尝试失效；第二次仍不可用就失败关闭，中文开关保持禁用。
源轨不进入该路径，Provider 请求也不涉及该路径，因此不会重复模型费用或把页面正文送往网络。

驱动字幕模块会让原生 cue 在恢复轨道时短暂消失，因此 isolated 侧不能把该瞬时空窗口误判为
切轨。可见英文 cue 只是首次建立字幕会话的 bootstrap 条件；source capture 已产生非空分句并
建立 Store 字幕面板后，原生 cue 不再是会话持续条件，因为 bridge Promise 完成与播放器恢复
原生字幕 DOM 之间仍可能存在渲染空窗，而且 Store 面板存活期间本就隐藏原生字幕。CC 关闭、
播放器失效、video/videoId 变化或导航仍立即清理；source 尚未建立时捕获失败且 cue 未恢复也
失败关闭。真实轨道变化必须依赖播放器/bridge 的轨道身份信号，不能借用原生 cue 的瞬时空窗。
译轨成功或可恢复失败都必须在原 7 秒请求期限内，经过 50ms 轮询取得连续
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

isolated controller 会观察播放器子树的字幕开关与结构变化，但 Store 字幕 View 也位于该子树。
因此 View 对观察范围内属性的写入必须幂等：状态值没有变化时不得再次调用 `setAttribute`。
否则一次 YouTube 控件变化会形成“观察器刷新 → View 重渲染 → 相同属性再次产生 mutation”的
无限微任务链，抢占播放器与控制栏主线程。Store 自身引发的必要变化最多触发一次后续刷新，
稳定渲染不能继续产生 controller 所观察的 mutation。

双语交互分为两个不能合并的入口：固定双语按钮作为独立 control host 挂在 YouTube 原生 CC
按钮之前，字幕卡右上角只保留临时按住按钮。前者的语义 `click` 切换当前 CaptionGeneration 的
固定双语；后者从 `pointerdown` 持有到 `pointerup`、`pointercancel` 或丢失捕获，并与键盘按住
状态独立汇聚。第一个临时来源开始按住时，若当前视频原本正在播放，Huayi 暂停该视频；最后一个
来源释放、取消、失焦或因页面隐藏而清除时，才尝试恢复这个按住所拥有的暂停。控制栏被 YouTube
重建时移动同一个 control host 到新 CC 之前，不能创建重复按钮或销毁字幕面板。两个按钮的
`pointerdown/mousedown/pointerup/mouseup/click/dblclick` 都在按钮边界停止传播，避免播放器全局
代理把字幕操作解释为播放、暂停或双击手势；底部固定双语按钮不得驱动媒体或字幕轨。

有效字幕选区只在当前视频原本正在播放时暂停，并由 isolated controller 记录该视频、videoId 与
CaptionGeneration 的 PauseOwnership。Overlay 的内部替换既不清除新选区，也不释放该所有权；
用户通过外部 `pointerdown`、Escape 或关闭按钮真正关闭 Overlay 时才清除浏览器选区并请求恢复。
字幕句在英文字幕上发生真实拖选的 `pointerdown` 后短暂冻结；因此实时 `timeupdate` 切到下一句
不会替换承载 Range 的 Text 节点。鼠标可在字幕外松开，controller 仍只接受完全属于冻结英文句的
Range；从英文字幕开始的 Pointer 手势只记录 pointerId，`selectionchange` 只记录当前 Range 是否
有效。匹配的 window capture `pointerup` 只安排一次 `queueMicrotask` 结算，不能在捕获监听器中
同步提交或恢复，因为 Chrome 的原生文本选择默认动作尚未完成；微任务在同一事件任务完成后
重新读取最终 Range，再提交一次。兼容 `mouseup` 若先提交，会使待执行微任务失效；
`pointercancel`、窗口失焦和任何会话清理同样使其失效。手势不得调用
`setPointerCapture`，否则 Chrome 会中断跨出字幕节点的原生文本选择。不得以最终 `mouseup` 的
target 判断拖选：释放点可以在字幕文本外，且浏览器在 document 外释放时未必投递 `mouseup`。
没有有效 `selectionchange` 的起始点击、`pointercancel`、未打开 Overlay 的窗口失焦、关闭
Overlay 或任何会话清理都会立刻解除冻结并恢复当前实时句。Overlay 存活时冻结句、选区 anchor 与
PauseOwnership 保持同代次稳定，不能因实时字幕换句而丢失选择或永久停留在旧句。
恢复前必须再次匹配同一视频、videoId 与代次，且视频仍处于暂停、未结束状态；导航、CC 关闭、
播放器替换、controller 停止和任何既有 `play` 事件都会先撤销所有权，因此不得从迟到的关闭回调
恢复旧视频。选区前已经暂停的视频从不取得所有权，也不会被 Huayi 播放。播放器空白区的关闭
手势还必须作为一个完整 activation 处理：捕获阶段消费 `pointerdown`、关闭 Overlay 并恢复所有权
后，再消费同一 target 随后的 `click`，防止 YouTube 把该 click 再次切换为暂停。播放器控件、
字幕与 Huayi UI 不进入该空白区策略。

临时翻译暂停与字幕选区暂停使用两个独立的 PauseOwnership；两者都精确绑定当前播放器、video、
videoId 与 CaptionGeneration。按住期间出现任何 `play` 事件会撤销临时所有权；导航、CC 关闭、
切轨、播放器或视频替换、controller 停止和会话清理都会先撤销所有权再清除按住来源，因此迟到的
释放事件不能播放旧视频。若有效字幕选区在临时按住期间成立，临时所有权只可在同一播放上下文中
显式转移给选区所有权，不能先恢复再重新暂停；之后仍由 Overlay 的真实关闭路径决定是否恢复。

MV3 Service Worker 冷启动时，YouTube isolated 入口依次经过版本握手、初始站点策略和内容设置
三个只读消息边界。任一边界的一次瞬态失败都不能让当前标签页永久静默；YouTube 入口对每个
边界最多尝试三次，尝试之间固定等待 200ms，不使用抖动或无界定时器。版本握手和初始站点策略
在同一 bootstrap 内串行完成，只有耗尽尝试后才标记页面不可用；内容设置重试只属于当前
activation，重复的 `yt-navigate-finish` 必须合并，停用、离开 watch 页或开始新导航会让迟到结果
失效。`site-toggle` 等写操作不进入该重试路径。这个恢复机制不改变字幕轨权威：首次建立字幕
会话仍要求当前播放器出现可见英文 cue，不能用消息就绪状态替代 ActiveSourceTrack 证据。

我们拒绝匿名重新获取 `/watch`、直接请求裸 `baseUrl`、后台模型预翻译和持久缓存：前两种路径
无法可靠继承播放器鉴权，后两种会扩大数据、费用和协议边界。代价是依赖 YouTube 私有播放器
接口；因此任何未知状态、超时、校验失败或私有接口变化都失败关闭，并恢复 YouTube 原生字幕。
