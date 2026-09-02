# 语见 Store Extension 架构

## 依赖方向

Store Edition 与 Classic Edition 在同一仓库中并存，但没有运行时依赖：

```text
apps/store-extension -> packages/store-domain

apps/extension -> packages/protocol <- apps/native-host   (Classic only)
```

`packages/store-domain` 是平台中立边界，只包含领域类型、严格运行时契约和小型接口，不得导入
DOM、Chrome、Node.js、Provider SDK、SSE 或数据库 API。Store Extension 不得导入
`@huayi/protocol` 或 `@huayi/native-host`。

## 四个外部接缝

- `AnalysisEngine`：接收已固定 Provider 的可信分析请求、取消信号和增量回调，返回完整公开结果。
- `DeviceVault`：自动创建/加载设备 DEK，提供凭据槽与 DEK 访问，并把旧库迁移、存储和密码学细节
  隐藏在小接口后；`LegacyVaultMigration` 只处理一次旧密码或恢复码认证。
- `LexiconRepository`：按规范词头保存、查询、分页和删除 WordEntry，不暴露 IndexedDB 事务。
- `WordbookExportEngine`：管理欧路导入与欧路/扇贝 ExportOutbox，不暴露页面脚本或 HTTP 细节。

生产适配器和测试 fake 都实现这些接口。共享的有界 HTTP/SSE 层只负责超时、读取上限、取消与
资源释放；OpenAI Responses 和 DeepSeek Chat Completions 保留各自的事件状态机和结果适配器。

## 扩展运行时

- MV3 Service Worker 是唯一可发起 Provider/欧路请求、组装可信分析元数据和写入加密领域数据的
  上下文。随包 Options 页也是 `TRUSTED_CONTEXTS`：它可直接使用 DeviceVault、写入或删除
  固定凭据槽，并只将凭据存在性呈现为布尔状态；它不得回显凭据或发起 Provider 请求。
- Content Script 负责选择检测、Overlay 和 YouTube 交互，不能传入 URL、模型、密钥或 Provider
  请求体。
- 网页生词保存使用独立的一次性版本化消息，不复用分析端口。请求只允许词头候选、原句和有界
  语境释义，不能携带 `source`；未知字段以及 URL、标题、完整结果或导出目标都会在调用
  `LexiconRepository` 前被拒绝。Service Worker 从 sender URL 推导普通网页或精确 YouTube
  `/watch` 来源，Repository 生成时间与记录 ID。
- Content Script 和 Worker 先完成内部消息 v5 版本握手。旧 v4 标签页收到不兼容响应后只提示
  刷新，不发送分析。
- 分析期间使用长连接端口承载有界增量；断口即失败，绝不自动重发。
- 普通网页选择在版本握手成功后才启用。Content Script 独立完成最多 2,000 字符的英文单词、
  短语或句子分类和必要上下文截取；Overlay 使用原生 Shadow DOM、外部点击和 Escape 关闭，且不显示
  X 按钮。模型
  增量和六类结果只通过 `textContent` 写入。关闭、新选择和端口断开都会取消当前会话；错误后的
  重试必须由用户按钮显式触发并创建新端口。
- Overlay 遵循 ADR 0014 的 ClassicParity：ActionCard 不含选区文本且只是紧凑双按钮入口；开始
  请求后才建立 ResultCard 的稳定头部与预览壳层。最终六类 ResultCard 复用 Classic 的结构化阅读
  顺序，但显式移除原句语境。内部分析协议 v4 迁移 Classic 的文本 delta 与经过模型字段 Schema
  校验的 typed section；流式 section 只是预览，完整结果仍需独立通过公开 Schema。单词进入分析后先按选区
  查询 `store/lexicon-presence`，最终规范词头变化时再查一次；generation 与规范词头共同拒绝迟到
  回执，查询失败只回到可保存状态，不阻止分析。
- `OverlayCardSession` 只在当前 Overlay 生命周期中保存翻译、解释各自的成功结果或错误。顶部模式
  切换命中成功缓存时不创建端口；切到未完成模式先取消唯一活动端口。旧端口、旧 requestId 和旧
  presence generation 都不能写回新模式或新选区，关闭或 replacement 直接销毁整个会话。
- 四套外观与两种 Overlay 材质使用同一 DOM。样式由 Content Script 通过注入的扩展内 URL 加载
  随包 `overlay.css`；`data-appearance` 只选择 `moon | silver | champagne | porcelain` 的颜色、
  光影和材质温度，现有 `data-theme` 只选择 `pearl | parchment` 的通透或柔雾参数。Manifest 只允许
  该资源向 http/https 页面访问。加载前或加载失败时保留最小内联可操作样式，不加载远程 CSS、
  字体或代码。外观广播原位更新已打开 Shadow DOM，不销毁卡片、流式内容或输入状态。
- 分析端口名和每条 start、cancel、update、result、error 消息都携带同一内部协议版本。一个端口
  最多启动一次分析；requestId、selectionKind、Provider 和 targetLanguage 均由 Worker 生成或固定。
  start 消息只能包含动作、选择、必要上下文和句子语境，未知字段一律拒绝。
- Worker 全局变量不是持久状态。导入检查点、ExportOutbox、同意记录和 Schema 版本必须落盘。

## 存储分区

- `chrome.storage.local`：小型非敏感设置、独立外观键 `huayi.store.appearance.v1`、同意版本、严格
  DeviceVault key envelope 和少量加密凭据记录，并限制为可信扩展上下文。
- `chrome.storage.session`：仅在旧 Vault 一次迁移清理期间兼容读取并删除，不再承载运行权限。
- IndexedDB：逐记录加密的生词，以及独立版本化加密快照中的导入任务、ExportOutbox、租约和
  回执。

当前生词仓储已经使用真实 IndexedDB 适配器完成。词头先按 NFC、英文大小写、空白和弯引号规则
规范化，再由 DEK 经 HKDF 分离出的 HMAC-SHA-256 索引密钥生成 256 位不透明 ID；IndexedDB 的
键和值都不出现词头、原句或语境释义。记录加密密钥也由 DEK 经独立 HKDF info 派生，每次写入
使用新的 12 字节 IV。记录 envelope 的 AAD 绑定产品、记录类型、不透明 ID、Schema 版本和修订号。

仓储使用一个不含个人数据的全局 generation 与逐记录 revision 做 CAS。保存和删除先在事务外完成
解密、Schema 校验与加密，再用一个短 IndexedDB 事务同时校验 generation/revision、写记录并递增
generation；冲突会重新读取并有界重试。因此两个 Worker/扩展页面实例同时给同一词增加语境时不
会静默丢失更新。v1 到 v2 的数据库升级只接受严格加密 envelope，损坏、未知结构或更新版本一律中止且不
覆盖原库。

`WordListExport` 通过 Repository 解密当前记录，只输出排序、去重后的规范词头并追加末尾换行。
Options 的下载适配器创建临时对象 URL，点击成功或失败后都立即释放。该接口不包含文件读取、全库
替换、备份密码或可恢复 payload，也不接触 DeviceVault 凭据。

任何 IndexedDB 事务都不得跨越网络等待。耐久任务采用“认领一项、提交租约、网络执行、独立
确认或重排”的短事务模式；过期租约可以在 Worker 重启后恢复。

WordbookExportEngine 以一个 DEK 经独立 HKDF info 派生的 AES-256-GCM 密钥保护完整耐久状态；
原始数据库只含固定记录键、Schema/修订号、随机 IV 和认证密文，不出现词头或语境。状态变更先在
事务外解密、校验和重加密，再以短事务做 revision CAS。任务使用随机 token 认领，只有持有当前
租约的执行者能写回；过期租约可被新 Worker 回收，迟到回执不能覆盖新状态。

Store 设置以严格版本化单记录保存。缺少记录时 Provider 固定为 OpenAI、YouTube 默认为英文模式、
模型联网同意未授予，欧路和扇贝也都未同意且停用，站点策略默认全局启用且 allow。只有
可信扩展页面可以写入 Provider 和带时间戳的披露版本，Content Script 不具备存储访问权。设置
v1 补齐两个关闭的词典目标，v2 补齐 `youtubeMode`，v3 迁移到全局开关与精确停用 host 的
v4，v4 再将这些 host 原子迁移为 Settings v5 `sitePolicy` 的精确 block 规则。v6 在 v5 上增加严格 `overlayTheme`，旧记录默认迁移为 `pearl`。v5 以
`sitePolicy` 作为唯一站点事实源，同时支持默认 allow/block、精确规则和包含子域规则。
每一步都必须成功落盘才返回，持久化失败即失败关闭。每个外部词典的当前披露版本与
`enabled` 同时成立才允许外发，旧同意版本不成立。Content Script 只可通过严格版本化消息读取
`youtubeMode` 与快捷键，Worker 仅向精确 HTTPS YouTube `/watch` sender 返回这些非敏感字段。

整页外观不进入 Settings v6，也不触发设置迁移。`StoreAppearanceRepository` 只读写独立非敏感键
`huayi.store.appearance.v1`；缺失、非法或读取失败使用 `silver`，写入失败不改写 Settings v6。
Options 的“常用设置”是唯一外观选择入口，Popup、普通网页 Overlay、YouTube 和扇贝提示从 Worker
严格响应取得当前外观；Popup 不提供第二个选择器。

Store 1.0 不再提供 Classic 设置包导入或旧密码库迁移 UI。Classic 与 Store 保持独立存储，Store
先校验整包，再以当前 Settings v5 为基底仅替换兼容的全局、默认动作、站点和 YouTube
字段，并执行一次存储写入。Provider、同意、凭据和生词不在该转移边界内。

站点 query/toggle 消息不携带 URL 或 hostname；Worker 只从 `sender.url` 推导当前精确 host，并在
分析、生词、扇贝和 YouTube 设置入口再次执行策略。普通选择、扇贝与 YouTube controller 在
isolated world 共享一个非页面可见的生命周期注册表；停用时立即 stop 并关闭 UI，异步迟到结果受
generation 约束。Popup 只用 active tab ID 把站点操作转交 Content Script，切换前复核 tab ID；
Provider、同意、全局开关、整页外观和词卡材质仅返回非秘密状态；Popup 不读取凭据存在性、Vault/迁移状态。Options 的全局或 host 变更由 Worker 广播无数据
refresh，各页面再以自身 sender 重新查询，不向广播附带规则表。

Options 直接通过可信 `DeviceVault` 读取欧路 Authorization 的存在性并写入/删除固定槽位；
Authorization 不进入 runtime 消息。导入和导出箱使用严格版本化消息，且 Worker 同时要求 sender
ID 为当前扩展并精确匹配自身 `options.html`，网页 Content Script 不能枚举队列或触发欧路请求。
扇贝只使用 page-ready/resolve 两种无 URL 消息；Worker 独立校验 sender 的 origin、path、search
和 hash。批次共享随机租约 token，结果必须无重复、无遗漏、无额外项地分区当前批次全部 ID。
Worker 在网页保存、欧路手工命令、每次 Alarm 和扇贝 page-ready 处自行读取设置；消息不能携带
或覆盖同意与启用状态。启用只改变未来策略，不遍历现有词条，所以不会静默补发。

## 固定网络边界

生产 Manifest 只声明：

- `https://api.openai.com/*`
- `https://api.deepseek.com/*`
- `https://api.frdic.com/*`

Service Worker 通过代码常量选择 endpoint，不接受消息中的任意 URL。扇贝适配发生在用户打开的
精确扇贝收藏页中，最终提交必须由用户操作；预填不会覆盖已有输入。页面回执只接受真实点击之后
新出现或变化的明确结果。所有静态代码随扩展打包，不加载远程脚本或 WebAssembly。

为覆盖 YouTube 从非播放页进入 `/watch` 的 SPA 导航，两个独立随包 bundle 只在三个固定 HTTPS
YouTube 主机的 `/*` 静态加载：isolated-world controller 与 `world: MAIN` bridge；不申请
`scripting`。非精确 `/watch` 时它们只保留导航/消息监听器，不读取播放器、不包装 fetch/XHR、不读取
设置且不创建字幕视图；进入 `/watch` 才激活，`yt-navigate-start` 离开时立即销毁。isolated side 每个文档生成随机 channel/capability，MAIN
bridge 还要求 pending requestId、generation、同源 `event.source`、严格响应 Schema、timedtext
fingerprint 和当前播放器状态。它们只用于关联、防陈旧/重放和缩小接受面：同页脚本可以观察
DOM/postMessage，所以 capability 不是同页脚本的密码学认证。字幕始终按不可信网页输入处理。
MAIN bundle 不依赖 Zod、Overlay、Provider、DeviceVault 或 Repository；所有 wrapper 都在一次 capture 的
`finally` 中恢复。

ActiveSourceTrack 的权威不能由 isolated world 仅凭拉丁字母猜测。首次 bootstrap 必须同时具备
可见候选 cue，以及 MAIN bridge 从当前播放器精确 active track 捕获、并由 isolated side 再次确认为
`en` 或 `en-*` 的源轨结果。会话建立后，原生 cue 因 bridge 卸载/加载、ASR 空窗而暂时缺失时保持
当前 CaptionGeneration；可见 cue 与当前源句明确不相符时，只把它作为轨道可能变化的信号，并在
同一代次重新经过 MAIN bridge 的 active-track 权威边界。仍为英语的 ASR 修订会原位更新源句，不
销毁字幕视图；明确非英语或不可用则清理字幕视图、控制入口、选区、Overlay 和 PauseOwnership。
同一个已尝试 cue 只验证一次；即使 MAIN bridge 返回有效英语源轨，但当时的 ASR/时间窗口仍未与
该 cue 相关，也不能由 `finally` 刷新或页面 mutation 对同一 cue 再次捕获。出现不同 cue 后才允许
再次验证，避免形成重捕获循环；出现新的英语 cue 后可自然建立一个新代次。此轨道验证不调用
Provider，也不接受网页提供的 URL 或语言声明。

## 构建与演进

Store Extension 使用独立 `dist`，可以与 Classic 开发版同时加载。先构建 `store-domain` 再构建
Store Extension；根级 Vitest `test.projects` 同时运行 Classic 与 Store 项目。未来迁移选择检测、
Overlay 和 YouTube 时应按职责移植，不保留 Native Host transport facade。构建分别限制 all-sites
content、host-loaded YouTube isolated controller 与 MAIN bridge 的未压缩体积，避免把 Worker/Provider 代码
带入页面 bundle。
当前 C/G/H/I 完整 ResultCard 的审计预算为普通网页 56 KiB、YouTube isolated controller 74 KiB；
门禁继续显式排除 Zod、Provider 和 Service Worker 实现。
