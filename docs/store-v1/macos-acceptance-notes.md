# Huayi Store 1.0 macOS 验收记录

> 2026-08-12：本记录中关于密码、恢复码、锁定和 Popup Vault 状态的既有证据对应已被 ADR 0006
> 取代的候选实现，不再是当前验收标准。当前候选必须按发布清单验证 DeviceVault 直接可用和旧库
> 一次迁移；下列历史记录仅用于追溯。

本文件只记录发布候选的目标平台证据和待处理项，不替代产品规格或发布清单。真实密钥、页面
正文、模型正文、请求 ID 和 usage 不进入记录。未列为通过的项目仍是
`implemented; target-platform validation pending`。

## 2026-08-11 候选环境

- macOS 26.5.2（Build 25F84，arm64），Chrome 151.0.7922.76。
- 候选提交：`d118daa8a0608bd6d39a0bd5146ceed471c41013`；工作树包含尚未提交的 Store
  实现，因此该证据不能直接用于最终发布。
- Store Extension 1.0.0，临时未打包 ID `bblmpepogaghidalddpmjgibgadciojh`。
- Store `dist` 聚合 SHA-256：
  `5934d3aa8733404013c73c415db30b015c70b9a1e1794660b27cbee015c85b8f`。
- DeepSeek 真实请求尝试累计 `10/100`；未调用 OpenAI、
  欧路或扇贝，欧路与扇贝导出保持关闭。

## 已取得证据

- 用户在当前 Store 候选中用旧密码完成一次 `LegacyVaultMigration`。迁移后未再执行解锁，公开
  `example.com` 的 `documentation` 直接完成一次 DeepSeek 翻译；随后本地保存返回既有重复语境，
  按钮稳定显示“已保存”并禁用，证明 Provider 凭据、原 DeviceVault DEK 和既有本地语境在迁移后
  可直接使用。本轮新增一次 DeepSeek 请求，没有调用 OpenAI、欧路或扇贝。重载后的直接可用、
  Options/Popup 文案和 YouTube 临时“中”暂停交互按用户决定留到 UI 重构后的集中验收。
- `pnpm verify:macos` 通过；单元测试、Store 覆盖率、架构检查、构建、66 条浏览器 E2E、严格
  Store 包审计和生产依赖审计均通过。
- Store 扩展可在真实 Chrome 加载并启用；Manifest v3、版本 1.0.0、固定网络权限与构建产物
  一致。
- Vault 初始化、恢复码确认、锁定、密码解锁及 Chrome 完全重启后自动锁定由用户完成并确认。
- DeepSeek 的普通网页单词、短语、句子分析成功；句子可见流式增量。单词结果可以保存到加密
  本地生词本，Options 可以看到保存后的词条。
- 保存完成态修复后，在欧路与扇贝停用的前提下，`documentation` 完成一次真实 DeepSeek 分析
  和一次本地幂等保存；服务返回“这个语境已经保存过”，按钮稳定变为“已保存”并保持禁用，
  再观察 1.5 秒未回退，也没有 Huayi 相关控制台错误。该项新增一次 DeepSeek 请求，没有触发
  OpenAI、欧路或扇贝。
- 普通网页带句末标点的单词形选区完成一次分析，但结果没有单词词典结构或本地保存入口。先记为
  “标点与选区分类待判断”，在确认规格预期前不定性为缺陷。
- 分析请求发起后立即关闭浮层，等待 5 秒未出现迟到结果重开；没有观察到自动重试。
- 跨 DOM 节点的公开英文选区能够进入分析，但 DeepSeek 候选模型返回固定
  `模型返回了无效响应。`。错误保持可见并提供手动重试，等待 5 秒未自动重试。本轮没有点击
  重试；该项记为候选模型兼容性缺陷证据。
- Popup 在扩展内部页会显示“不支持划译”，同时保留 Provider、联网同意和 Vault 状态，站点
  开关禁用；普通网页 Popup 的基础状态此前可见。
- Popup 新增的原生“打开设置”按钮已由用户在真实 Chrome 工具栏弹窗中点击确认，成功打开当前
  Store ID 对应的 `options.html`；未改变站点开关、凭据或其他配置，也未触发 Provider。
- 用户已停用 Classic 0.13；刷新同一 3Blue1Brown 公开录播后，页面没有残留
  `data-huayi-youtube-*` Classic DOM。YouTube CC 显示已开启、设置菜单显示英语字幕轨道，视频
  不是广告或直播且持续播放。本阶段没有触发 DeepSeek 请求，也没有自动重试。
- 上一次检查中显示德语字幕，是 YouTube 播放器当时选中了德语轨道；用户已手工切换为英语并
  刷新页面。扩展 `lgblnfidahcdcjddiepkckcfdhpknnjh` 是广告拦截器，不是字幕扩展；其控制台
  错误不能归因于 Huayi，也不作为 Store YouTube 是否启动的因果证据。
- 重验时已在 YouTube 设置菜单严格确认“英语（自动生成）”为选中轨道，也分别观察了普通
  “英语”轨道。视频在约 13 秒至 180 秒持续播放期间，播放器的原生
  `.ytp-caption-segment` 始终为 0，字幕容器为空，`video.textTracks` 也为空；页面没有出现
  `data-huayi-store-youtube-*` surface 或 Huayi 样式，相关页面控制台错误为 0。本次重验未
  触发 DeepSeek 请求，累计仍为 `7/100`。
- 针对用户报告的英语字幕持续闪烁进行了 Store-only 诊断。50ms 间隔的实机采样中，CC 始终
  开启且 `video.currentTime` 固定在 272.8 秒，原生字幕节点仍从 0 短暂变为 2，并在约 51ms
  后回到 0；这排除了正常播放换句。最小仿真进一步证明：source capture 尚未完成时，只移除并
  恢复一次原生 cue，就会让 capture 次数从 1 增加到 2。最后保持同一视频和英语轨道，仅把
  Store YouTube 模式设为 `disabled` 并刷新后，用户确认英语字幕停止闪烁。该单变量差分确认
  闪烁由 Store 字幕捕获生命周期导致；全程没有发起 Provider 或词典请求。
- 第三版修复重载后的两轮实机启动采样中，文档均已 `complete` 且 CC 保持开启，但 Store surface
  仍与首个可见英文原生 cue 同步出现：第一轮约在视频 10.5 秒出现，第二轮在 9.4 秒仍不存在、
  到 18.8 秒才出现。这证明当前感知到的主要延迟仍受安全 bootstrap 条件约束；同时静态检查发现
  版本握手、初始站点策略和内容设置三个只读消息边界原先都只有一次机会，任何瞬态 Worker 失败
  都会让该标签页永久静默或至少静默到下次 SPA 导航。
- 译轨恢复修复前的三轮同页刷新分别约 1.61、1.75、1.66 秒返回；每轮 0–2 秒尚未建立 Store
  surface，约 4 秒都出现英文字幕。三轮视频均持续推进，控制栏和页面没有再次冻结，原生字幕与
  Store 字幕也没有再次交替。双语译文则只有第二、三轮约 4 秒可用；第一轮到刷新后约 20 秒、
  视频 28 秒时仍为空且按钮禁用，确认译轨一次失败会在当前 CaptionGeneration 中永久放大。
- 同一最新构建已通过实时字幕选择交互：拖选会暂停原来播放中的视频；外部标题点击和关闭按钮
  都会关闭浮层、清空选区并恢复该视频，原本手动暂停的视频不会被播放；双语开关的显隐状态
  正确。一次 Escape 实测能关闭浮层和清空选区，但没有恢复此前播放的视频，详见缺陷 8。
- 译轨有界恢复修复后的三轮 reload 均在 12 秒内建立 Store 英文与中文轨，第三轮约 8 秒可用；
  三轮视频就绪后持续推进，页面和控制栏无冻结，Store 接管后原生 cue 始终隐藏且没有字幕交替。
  20 次、每次 250ms 的稳定采样中 Store surface 始终存在，视频从 26.193 秒推进到 31.435 秒。
  当前中文句曾有约 2.5 秒空档，但译轨和开关保持 ready，随后自行恢复，暂按句子对齐空档记录。
- 最新构建的外部点击和 Escape 各一次均能关闭浮层、清空选区并恢复原来播放中的视频；Escape 后
  1.5 秒推进约 1.42 秒，未复现前一次停播。根任务随后独立只读复核：Store active、英文存在、
  译轨 ready、双语关闭、CC 开启、原生 cue 不可见、无浮层和选区，视频 1.2 秒内从 120.189 秒
  推进到 121.815 秒。全程新增 Provider/API 调用为 0。
- 最新构建通过真实 YouTube SPA 生命周期验收：从 `aircAruvnKk` 通过页面推荐链接进入
  `IHZwWFHWa-w` 后，新视频的 Store surface、英文层、底部固定“中”均各保持一个，无旧词卡、
  选区或暂停所有权，新视频正常播放；随后通过 YouTube 首页链接离开 `/watch`，全部
  `data-huayi-store-youtube-*` DOM、词卡和选区均清理为 0，首页仍正常响应。该流程未调用
  Provider、未分析或保存。
- 最新构建在 `aircAruvnKk` 的 Store 英文字幕上完成一次真实 DeepSeek 选择分析：单次短选区
  正常打开词卡并暂停视频，只发送一次请求，成功返回 `phrase` 结果并显示原文、语境含义和核心
  含义栏目；未保存生词。关闭词卡后等待 5 秒没有自动重试或迟到重开，选区清空，视频恢复并
  连续推进约 5.02 秒。该项使 DeepSeek 累计尝试增加到 `8/100`，未调用其他 Provider 或词典。
- 用户确认已在普通网页手工完成当前站点关闭与重新开启的主路径验收；本轮不重复操作工具栏
  Popup，也未因此触发 Provider。
- 最新构建通过 YouTube CC 生命周期验收：播放中关闭 CC 后，Store active、字幕层、英文层、
  底部固定“中”和顶部临时“中”全部清理，词卡与选区保持为空，视频继续播放；重新开启 CC 后
  约 1 秒随自然 cue 完整重建，所有 Store 节点均保持单例，再观察 2 秒仍稳定播放。最终 CC 已
  恢复开启，全程 Provider/API 调用为 0。
- 修复字幕轨权威复核后，最新构建通过英语→德语→英语实机闭环：切到德语约 2 秒后，原生 cue
  明确为德语，Store active、字幕层、英文层、控制宿主和两个“中”全部清为 0，词卡和选区为空，
  视频继续播放；切回英语约 4 秒后上述 Store 节点均以单例重建，再观察 2 秒仍稳定播放，未发现
  Huayi 相关控制台错误。最终字幕轨已恢复英语，全程 Provider/API 调用为 0。
- 随后在同一 `aircAruvnKk` 播放页从 YouTube 可见字幕菜单把严格选中的英语轨切为德语。原生
  `.ytp-caption-segment` 已显示德语文本，但 Store active、字幕层、英文层、底部固定“中”和顶部
  临时“中”仍全部保留，确认已建立的 ActiveSourceTrack 没有随显式切轨失效。根任务已把轨道恢复
  为严格英语；该诊断未产生 Provider/API 调用。

## 待处理缺陷与产品反馈

5. **代码修复，实机回归通过**：生词保存成功后，状态文本已显示成功，但“保存到本地生词本”
   按钮仍保持原文、可见且可用。本轮没有二次点击，避免重复写入。根因是保存消息链无论返回
   `saved`、`duplicate` 或错误，最终都会无条件重新启用按钮。现在仅把 `saved` 和表示幂等成功的
   `duplicate` 置为稳定完成态：按钮显示“已保存”并保持禁用；保险库锁定、数据损坏、无效消息和
   发送失败都恢复原标签及可重试状态。该逻辑只保存在当前 Overlay DOM，关闭或新分析替换 Overlay
   时不会向下一次结果泄漏。离线回归已覆盖成功、幂等成功与连续失败重试；真实 Chrome 的
   `duplicate` 路径已确认按钮稳定显示“已保存”并保持禁用。首次新增语境的 `saved` 终态仍由
   同一离线分支覆盖，本轮为避免制造额外词条和外部导出任务没有重复实机写入。
6. Vault 当前保护范围和生命周期给用户造成较高操作负担，初始化和反复解锁会影响较多配置与
   功能。后续需重新审视 Vault 的保护边界和交互流程；本记录不预设新的密码学或存储方案。
7. **第三版代码修复，实机回归通过**：Store YouTube bridge 捕获字幕时会卸载并重新加载
   captions 模块，导致原生 cue 短暂为空。第一版修复只保护 capture Promise pending 的空窗；
   实机重载后仍观察到 Store surface `true → false → true`，因为 Promise 完成时播放器的原生
   caption DOM 尚未恢复，controller 随即销毁已建立的 Store 面板并重新 bootstrap。第二版回归
   测试直接覆盖该 exact alternation：source 已建立面板、translated capture 完成但 cue 仍空时，
   面板身份必须保持且不得再次 source capture。实现现将可见英文 cue 限定为 bootstrap 条件；
   面板建立后只由 watch/player/video/videoId、CC 和导航控制生命周期。CC 关闭和 source 建立前
   的捕获失败仍失败关闭。第二版在实机重载后暴露了另一个确定性回归：Store 字幕未稳定显示、
   原生字幕同时出现，播放器控制栏很快失去响应且页面在 10 秒内卡死；关闭 Store 后恢复。属性级
   离线回归确认，YouTube 的一次 `class` 变化触发 controller 刷新后，View 会对值未变化的
   `aria-pressed` 重复执行 `setAttribute`，产生连续 `aria-pressed` mutation，并与全页观察器形成
   无限微任务链。实现已将该观察属性改为幂等写入，回归要求一次外部 `class` mutation 只能产生
   一次观察器回调。最新构建三轮刷新中页面与控制栏持续响应，Store surface 均稳定建立，原生与
   Store 字幕未再交替，缺陷 7 记为实机通过。
8. **交互生命周期实机通过，Escape 曾有一次未复现异常**：实现现以捕获阶段的可信
   `pointerdown` 区分 Shadow DOM 内外点击，真正关闭时清除 Selection，Overlay 内部替换则保留
   新选区。真实 Chrome 已确认外部点击和关闭按钮都能关闭 Overlay、清除选区并恢复 Huayi 主动
   暂停的视频，原本已暂停的视频保持暂停。一次可信 Escape 实测则出现分歧：Overlay 和选区均已
   清除，但此前播放中的 video 在随后 1.5 秒仍保持暂停且播放时间不前进；URL 未变、CC 仍开启，
   Store 字幕 surface 当时只进入隐藏状态、DOM 仍保留且之后重新可见。

   使用真实 `StoreOverlayController` 与 `YouTubeCaptionController` 的离线集成探针表明，Escape
   `keydown` 会经过正常关闭路径并同步调用一次 `video.play()`；关闭按钮和外部 `pointerdown`
   得到相同调用，导航、CC 关闭和原本已暂停场景则不会错误调用。因实机没有 `play()` Promise
   结果及后续 `play`/`pause` 事件证据，当前不能区分媒体播放请求被拒绝、请求后被页面再次暂停或
   其他浏览器侧时序。不得仅凭一个人为注入的后注册键盘监听器改用
   `stopImmediatePropagation()`；下一次受控实机复测应只记录 Escape 前后的有界媒体事件与
   `play()` 结果，再决定修复位置。最新构建再次严格执行一次 Escape 后，Overlay 和选区均清除，
   视频恢复播放并在 1.5 秒推进约 1.42 秒，因此不做生产修改；若后续再次出现，应补采集
   `play()` Promise 与 `play`/`pause` 事件顺序。

9. **启动消息恢复代码修复，实机回归待验**：YouTube 入口现对版本握手、初始站点策略和内容设置
   三个只读消息边界分别执行最多三次、固定 200ms 的有界尝试。初始策略恢复完成前 bootstrap
   不宣称就绪；设置尝试绑定单一 activation，重复导航完成事件不会创建并行请求，停用或导航会
   阻止后续发送与迟到 controller。站点开关等写操作不重试。该修复只消除瞬态消息失败造成的
   永久静默，不改变首次可见英文 cue 的轨道权威条件，因此不能承诺 Store surface 在无字幕 cue
   的片段提前出现。

10. **译轨有界恢复代码与实机回归通过**：修复前三轮刷新中源轨均建立，但一次译轨到 20 秒仍未
    可用。代码确认原 controller 对译轨 `null` 只尝试一次，之后不会在当前代次恢复。现改为只对
    译轨最多尝试两次，首次不可用后固定等待 200ms；等待和第二次捕获都绑定原 videoId 与
    CaptionGeneration，导航、CC 关闭、播放器替换或停止会取消旧代次，第二次仍失败就保持禁用。
    回归覆盖首次失败后成功、严格两次耗尽，以及导航期间不得继续旧代次。该恢复不调用模型，
    不增加 DeepSeek/OpenAI 请求。最新构建三轮 reload 均在 12 秒内取得中文轨，缺陷 10 记为
    实机通过。
11. **按钮事件隔离代码修复，实机回归通过**：稳定期从 off 切到 on 成功；紧接一次关闭操作返回
    成功，但 `aria-pressed` 仍为 true，同时 `video.paused=true`，YouTube 控件却仍显示“暂停”。
    再次点击后双语关闭；点击 YouTube 的“暂停”控件反而让实际视频恢复播放，说明控件与媒体状态
    当时短暂反相。该现象只观察一次，未继续高频点击。

    离线完整事件探针确认双语按钮原先把 `pointerdown/mousedown/pointerup/mouseup/click` 全部冒泡
    到 `.html5-video-player`；接入与 YouTube 根级点击代理等价的播放切换监听后，三次快速
    off→on→off 会额外执行两次 `pause()`、一次 `play()`，最终视频为 paused。按钮自身的三次
    `aria-pressed` 在离线环境中仍依次确定为 false、true、false，MAIN bridge 也不调用媒体
    `pause/play`，所以实机那一次“仍为 true”的成因仍缺少事件时序证据，不能归因于状态回写或
    译轨恢复。实现现于按钮边界隔离 pointer、mouse、click 与 dblclick，同时保持语义 click 正常
    切换；回归要求快速 off→on→off 不触达播放器代理、不调用 pause/play，最终状态确定为 off。
    最新固定样本页实测一次 off→on→off：按钮 `aria-pressed`、中文显隐和 YouTube 原生播放控件
    全程一致，视频没有暂停，最终 1.8 秒继续推进约 1.82 秒，Overlay 和 Selection 均为空。

12. **YouTube 交互需求重新对齐，代码修复、实机回归通过**：最新实机确认，播放中字幕选词由
    Huayi 暂停后，点击视频空白区会先短暂恢复、随后又暂停；同时字幕卡右上角“中”没有按住
    语义，YouTube 底部 CC 旁也缺少固定双语“中”。现行产品规格与 Classic 已验证实现均明确
    这是两个不同入口，而 Store 迁移时把它们错误合并成了字幕卡右上角的单击 pin 开关。

    使用真实 `StoreOverlayController` 与 `YouTubeCaptionController` 的组合红测复现了完整浏览器
    事件链：外部 `pointerdown` 关闭 Overlay 并调用一次 `video.play()` 后，同一 target 的 `click`
    仍到达播放器代理并再次 `pause()`。Store 现只在活动字幕选区期间、只对播放器空白 target
    捕获该 `pointerdown` 与配对 `click`；控件、字幕和 Huayi UI 不进入此策略。字幕卡右上角恢复为
    pointer 按住入口，`pointerup`、取消、丢失捕获、窗口 blur 和页面隐藏均清除；CC 旁新增独立
    固定双语按钮，控制栏重建时移动同一个 host 到新 CC 前且不复制。两个按钮完整隔离
    `pointerdown/mousedown/pointerup/mouseup/click/dblclick`，真实字幕选区路径继续通过。用户以物理
    鼠标确认：Store 英文字幕拖到播放器内空白处释放后只打开一次词卡、选区保持且视频暂停；随后
    一次播放器空白点击会清除词卡和选区，视频持续播放而不发生二次暂停。顶部圆形“中”按住期间
    显示中文、松开后隐藏，且该按钮没有改变当时的视频播放状态。

13. **实时换句拖选竞态代码修复，实机回归通过**：Store 原 controller 仅在 `mouseup` 读取
    `Selection`，但每次 `timeupdate` 都会直接替换英文字幕的 Text 节点。因此用户从字幕拖选到
    播放器空白区松开时，若恰好跨越换句，Range 会先失效，既不会打开 Overlay，也不会取得
    PauseOwnership。真实 `StoreOverlayController` 集成红测已确定复现：英文 `pointerdown`、建立
    Range、切到下一 SubtitleSentence、在文本外 `mouseup` 后 Overlay 为 null。实现现从英文
    `pointerdown` 起冻结当前句；有效 Range 打开 Overlay 后维持冻结，关闭卡片、取消手势、失焦、
    CC 关闭、导航或销毁都会解除冻结并恢复实时句。回归也覆盖关闭 Overlay 后立即显示当时当前句；
    此改动不调用 Provider、bridge 或字幕网络请求。上述物理鼠标“文本外释放→只打开一次词卡、
    选区保持、原播放视频暂停”验收通过，说明该主路径在实际浏览器手势下可用。

14. **文本外释放的 Pointer 生命周期代码修复，实机回归通过**：随后实机拖选仍发现：从英文字幕
    开始、在播放器空白区释放后，浏览器 Selection 非空，但 Overlay 没有出现且视频继续播放；同一
    文本内释放可通过。原因是上一版仍以 document `mouseup` 为唯一提交边界，测试只是人为向文本
    元素投递该事件，不能覆盖真实 Pointer 手势最终释放位置。controller 现由英文字幕在
    `pointerdown` 记录手势，手势期通过 `selectionchange` 记录有效 Range，仅在匹配的 window
    capture `pointerup` 提交一次；`mouseup` 保留为无 Pointer Events 的文本内兼容路径。红测覆盖：
    Range 变为有效时不提前暂停或打开卡片、最终 `pointerup` 位于文本外后才打开 Overlay 并暂停，
    随后的兼容 `mouseup` 不重复提交。`pointercancel`、失焦和会话清理仍取消冻结；该修复不涉及
    Provider、bridge 或网络。用户已用物理鼠标从 Store 英文字幕拖至播放器内空白区释放，确认词卡
    只出现一次、选区保留并暂停原来播放的视频。

15. **Pointer Capture 干扰原生拖选，代码修复、实机回归通过**：最新实机对照提供了决定性证据：
    加入 `setPointerCapture` 前，从正确 Store 英文字幕拖到播放器空白区能保留非空 Selection；加入
    后两次严格命中相同字幕、在页面内播放器空白区释放，Selection 均变空。根因是字幕节点取得
    Pointer Capture 后改变了 Chrome 的原生文本选择分派。选择手势现明确不调用
    `setPointerCapture`，也不监听 `lostpointercapture`；仍由 window capture `pointerup` 在 YouTube
    document 监听器之前接管收口，保留 `selectionchange` 有效性、`pointercancel`、兼容 `mouseup` 和
    防重复提交。集成红测同时锁定“开始手势绝不 capture”“没有 `mouseup` 仍提交”以及 document
    `stopImmediatePropagation` 不能阻断 window 捕获边界。用户的物理鼠标验收确认此版本保留了从
    字幕拖至播放器空白处后的选区，并能正常进入词卡。

16. **`pointerup` 捕获阶段早于原生选区结算，代码修复、实机回归通过**：移除 Pointer Capture 后，
    实机从正确 Store 英文字幕拖到播放器内 `VIDEO` 空白处，释放后得到 `rangeCount=1` 但选文为空，
    Overlay 仍未出现，随后同一手势被 YouTube 解释为播放切换并暂停视频。确定性集成红测复现了
    同一时序：window capture `pointerup` 到达时 Selection 尚无效，而该事件后续阶段形成有效
    Range；旧代码会同步清空手势并恢复渲染，迟到的 `selectionchange` 无法再提交。选择手势现只在
    `pointerup` 安排一次微任务；当前事件任务和浏览器默认选区动作完成后重新校验 Range，再提交
    Overlay。兼容 `mouseup` 先提交、`pointercancel`、窗口失焦和会话清理都会通过修订号使待执行
    微任务失效，避免重复或迟到提交；没有加入 timer、rAF、Pointer Capture、Provider 或 bridge
    变更。同一选区手势后续是否产生 YouTube `click` 已由物理鼠标主路径验收：文本外释放后词卡
    只出现一次；其后的独立空白点击会关闭词卡和选区并持续恢复播放，没有二次暂停。

17. **产品优化，代码修复、macOS 实机回归待验**：顶部圆形“中”现会在首个指针或配置快捷键
    来源按住时暂停原本正在播放的视频，并在最后一个来源释放、取消、丢失捕获、窗口失焦或页面
    隐藏时，仅恢复该临时手势拥有的暂停。底部固定“中”不驱动媒体；原本已暂停的视频不取得所有权，
    按住期间的 `play` 事件会撤销所有权。临时暂停与字幕选区 PauseOwnership 独立；同代次选区成立
    时只显式转移所有权，避免 Overlay 打开时先播放再暂停。导航、CC 关闭、停止、video/videoId/
    player 或轨道变化和任何会话清理都会先撤销临时所有权，迟到释放不得播放旧视频。控制器级离线
    回归覆盖上述恢复、聚合、撤销、转移与陈旧关闭路径；真实 macOS Chrome 仍需分别验证播放中与
    已暂停视频的顶部按住，以及底部固定按钮不暂停。

18. **非英语显式切轨代码修复，macOS 实机回归待验**：根因是 controller 在已有
    `SubtitleSentence` 后直接 render/return，永不重新验证当前可见源 cue；bootstrap 的旧辅助判断
    又只检查拉丁字母，因此德语也会被当作英语候选。新增 controller 生命周期红测先确定复现：英文
    会话已有有效选区和 PauseOwnership 时把原生 cue 改为德语，Store 字幕与两个控制入口仍保留。

    实现不以文本猜测直接宣判轨道，而把“可见 cue 与已捕获源句明确不相符”作为 MAIN bridge
    active-track 重验信号。英语 ASR 修订会在同一 view 中更新源句；明确非英语或不可用才整代清理
    Store active、字幕层、两个“中”、Selection、Overlay 和 PauseOwnership。同一已尝试 cue 会
    去重；即使重验返回有效英语源轨但该源文本仍未与当前 cue 相关，也不得由 `finally` 刷新或无关
    DOM mutation 再次捕获。不同 cue 仍可重验，回切新的英语 cue 后重新通过 source/translated
    capture 各一次并保持 DOM 单例。isolated side 还会拒绝 bridge 返回的非 `en`/`en-*` 源轨。无 cue
    的 capture/ASR 空窗不触发重验，source
    capture 结束为 `null` 且 cue 仍为空仍按原规则失败关闭。离线 YouTube 测试覆盖德语清理、同 cue
    去重、英语回切单例重建、英语 ASR 修订原位更新、非英语 bridge source 拒绝和既有 capture/CC/
    导航/选区生命周期；真实 macOS Chrome 尚需用 YouTube 菜单执行英语→德语→英语一次闭环。

19. **DeepSeek 单词解释 `invalid-response` 的确定性契约缺陷已修复，真实回归待验**：用户在普通
    网页对 `missing` 发起解释时看到“模型返回了无效响应”；截图实际激活的是“解释”。既有失败没有
    保存原始响应，因此不能追溯断言那一次具体 JSON 字段。离线差分已确认 Store 曾向 DeepSeek
    声明比最终模型解析器更宽松的 JSON Schema：例如 `wordForm.baseForm` 没有 Classic 已有的英文
    pattern，模型即使遵循所发 Schema 也可能在 `model-schema` 层被拒绝；Store prompt 也曾自行缩写
    Classic 对 sentenceContext、词形和同义词的约束。当前实现已迁移 Classic prompt、示例字段顺序
    和英文 Schema 约束，严格模型与公开结果 Schema 均未放宽，并以 fake DeepSeek 回归固定。

    同轮还确认单词翻译没有流式内容的直接原因：Store 把 `translate-word` 增量字段映射设为空，且
    协议只承载三个粗粒度文本区。内部协议 v4 现迁移 Classic tokenizer 和结构化 section 映射，能在
    完整结果前渐进显示语境义、常见释义、短语等已校验字段。真实 DeepSeek 仍需重载后分别复验
    `missing` 的解释与翻译；本地 DiagnosticEvent 和主动反馈入口继续作为未完成发布项。

## 阻塞与后续手工项

- 缺陷 7、8、10—16 的最新实机主路径已通过；缺陷 17、18 已完成代码与离线回归、等待 macOS 实机；
  底部固定“中”和顶部临时“中”的核心行为已通过
  实机验收。
  watch-to-watch SPA 导航、离开 watch 页清理、普通网页站点开关和 YouTube 选区真实模型分析也
  已通过；CC 关闭清理、重新开启后的单例重建，以及英语→非英语失败关闭→英语恢复也已通过。
- 仍未验证真实 DeepSeek 鉴权失败、限流/配额错误、网络中断和 Worker 中断；不得通过消耗额度
  或破坏现有凭据来伪造这些场景。
- Windows、OpenAI、欧路、扇贝、升级、词表导出和卸载证据仍待单独批准与验收。
- Popup 新增原生“打开设置”按钮：无论当前标签页是否支持划译、运行时状态读取成功或失败均应可见；
  点击调用扩展受信任的 `runtime.openOptionsPage()`，失败显示“无法打开设置页，请稍后重试。”且不产生
  未处理拒绝。离线行为测试与 macOS Chrome 真实点击均已通过。
