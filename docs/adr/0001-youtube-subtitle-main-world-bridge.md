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

Store 实测英文 ASR 的 JSON3 还包含没有 `segs` 的窗口控制事件（例如带有 `id`、
`wpWinPosId`、`wsWinStyleId` 的事件）。这类无文本对象跳过，不得使整份字幕成为
`invalid-response`；只要 `segs` 字段存在，就仍要求有界数组。总字节、全部事件数量（包含
无文本事件）、每事件 segment 数和每 segment 文本长度上限保持不变；非对象事件、畸形
`segs`、超限内容或最终没有文字 cue 仍失败关闭。回归夹具只保留控制事件与文本事件结构，
使用合成时序和文案，并贯通 MAIN 捕获、bridge 校验与 Store 字幕呈现。

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

Store 首次源轨捕获同样可能遇到瞬态就绪窗口：isolated 已观察到 CC ON 和可见候选 cue，
但 MAIN 当前 captions 模块、活动轨或播放器响应仍不可用。单次失败不能永久封锁同一 cue；
尚未建立源轨分句时，同一视频/播放器生命周期的初始捕获共用三次预算；恢复循环内对 `null`
的重试间隔固定 200ms。每次重试前重新确认
同一 videoId、代次、播放器、video、watch 页面、CC ON 和可见候选 cue；MAIN 仍逐次验证
唯一匹配的当前英文活动轨，验证失败不得驱动字幕或包装网络函数。候选文本本身不证明英文轨。
CC 关闭、导航、播放器/video 替换、播放器失效和停止会清除等待定时器、使旧代次失效并重置
预算。捕获驱动引起的原生 cue 暂时消失只等待可见候选恢复，不清空会话代次或预算；同一 cue
恢复和后续 cue 变化都不能补充次数。缺少 cue 或耗尽次数仍失败关闭，不创建字幕面板。
返回非空轨道结果后不重试，非英文结果继续被拒绝；已经建立会话后的 cue 不匹配仍只尝试
一次，拒绝该结果后也不补充初始捕获预算。此恢复只涉及播放器字幕捕获，不涉及 Provider、
模型费用或新增跨 world 字段。

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

Store 的字幕 DOM 不是轨道身份的权威，英文 ASR rolling correction 与完整预分句不互含
会触发源轨复核，但不能据此反复卸载、重载字幕模块。MAIN 在每次请求上重新验证精确 HTTPS
watch 页面、当前播放器、videoId、CC ON、唯一英文活动轨和会话代次；只有 session、generation、
videoId、播放器对象与轨道身份全部相同，才复用本页面已验证的源轨或译轨捕获结果。复用不会
驱动播放器、包装网络函数或再次请求 timedtext，响应仍使用本次请求的完整关联字段。
每个 MAIN bridge 最多保留一组源轨和译轨，分别受既有 2 MiB 上限约束，不写入持久存储。
代次、播放器、视频或活动轨变化使旧结果失效；观察到 CC OFF、非英文、不可用状态或离开
watch 页面时清空，导航、pagehide 和销毁也清空。另一英文轨重新捕获，非英文或不确定状态
继续失败关闭。

译轨捕获尝试也归属于这组源轨生命周期，最多两次（含首次）；无论 HTTP 拒绝、超时还是
响应无效都消耗次数。滚动字幕触发的源轨复核不会重新获得次数，耗尽后直接返回不可用，
保留已捕获英文而不再驱动播放器或发起请求。第二次成功的译轨仍可复用；只有上述源轨身份
失效并重新成功捕获后，才开始新的尝试额度。

导航开始后直到
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

从首页或 feed 首次经 SPA 进入播放页时，Chromium 消息发送者 URL 可能仍是内容脚本上下文
创建时的路径，因此内容设置处理器不能要求 sender URL 为 `/watch`。该只读消息按精确 HTTPS
YouTube hostname（`youtube.com`、`www.youtube.com`、`m.youtube.com`）授权，继续严格校验
消息、总开关与站点策略，只返回显示偏好；不借用顶层标签页 URL 推断发送者身份。内容入口仍在
当前文档 `/watch` 才请求设置，integration、controller 和 MAIN bridge 的当前页面与捕获门禁
保持不变。回归测试把真实设置处理器与 integration 组合，固定原始首页 sender URL，验证首页
不激活、SPA 进入 watch 后启动、离开后停止；单独 mock 成功设置响应无法覆盖这条失败链。

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
