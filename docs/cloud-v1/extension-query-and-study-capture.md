# Phase 27 插件查询、学习采集与本机生词方案

状态：2026-08-14 Phase 27A–27G 已完成离线实现，本文是当前契约、数据库、Web 与 Store Extension
实现的权威方案。完成度复审重新打开的本地回归已收口：有效 extension session 与 Huayi 数据同意
仍在、但当前构建暂缺 production API adapter 时，SubmissionOutbox 保留账号绑定密文并进入稳定阻塞，
不再把构建能力缺失误判为授权撤回或账号失效；本回归已按文档校准→Fresh RED→GREEN 完成。Cloud
V1 尚未发布，真实服务与目标平台验证仍单列 pending。

2026-09-05：即时缓存、后台执行、四入口和连续收集流程已更新，详见
[即时查询与学习工作台](instant-query-learning-workspace.md)。下文 Phase 27 保留原有数据边界，当前交互以该文和 product.md 为准。

## 1. 目标与边界

Store Edition 是一个产品、两个客户端：

- Store Extension 负责网页与 YouTube 中的即时翻译、解释、本机生词和外部词典能力；
- Web App 负责 StudyCapture、深度教学分析、待收藏、学习库、练习、云端生词和账号设置；
- Classic Edition 与 Native Host 保持冻结，不因本方案修改 wire v7、安装或 Provider 行为。

本方案解决四个此前混在一起的问题：

1. BYOK 是插件的一种模型执行模式，不是插件产品线；
2. 插件精简查询结果不是 Web 深度分析，也不自动成为分析历史；
3. 用户可以只把原始学习意图送入 Web，稍后再显式消耗平台额度分析；
4. 插件本机生词与账号云端生词是独立权威，不做双向同步。

V1 仍不做单词 SRS、语义采集去重、插件查询历史、自动深度分析、跨设备本机词库同步、追问聊天、
移动 App 或 Classic 数据迁移。

## 2. 用户场景与模型选择

### 2.1 插件独立使用

- 未关联 HuayiAccount 的插件继续使用本机 BYOK 查询；用户按设备配置 OpenAI 或 DeepSeek Key。
- 单词收藏先写当前插件安装的 LocalLexiconEntry；登录、退出或换号都不清除本机词库。
- 本机欧路导入、本机欧路导出和本机扇贝导出不要求 HuayiAccount。
- 未登录时不创建无 owner 的 StudyCapture，也不为未来登录缓存网页选区。

### 2.2 登录后使用平台模型

- 新账号和首次配对默认 `ExtensionQueryModelMode=platform`，适合没有 API Key 的普通用户。
- 插件查询经固定 Huayi API 使用平台模型并消耗账号 UsageAllowance；用户不选择 Provider 或模型。
- 平台查询产生临时 ExtensionQueryGeneration，结果用于当前及短期缓存恢复的 ResultCard，不进入 AnalysisRecord、
  ReviewInbox 或分析历史。
- 平台模式离线时查询失败关闭，不自动改用 BYOK。

### 2.3 登录后使用 BYOK

- 用户可在 Web 把账号级模式改为 `byok`；所有已关联插件同步后都改走各自本机 Provider。
- 每台设备独立选择 OpenAI 或 DeepSeek 并保存自己的 Key，不按账号或设备列表远程分发 Key。
- 某台设备缺少 Key 时只提示在该设备配置；不自动使用平台额度。
- BYOK 只改变模型调用路径。StudyCapture、CloudWordCopy 和云端外部词典任务仍按各自账号设置使用
  Huayi API。

### 2.4 模式切换不自动回退

- 模式只能在 Web 账号设置修改；插件只显示缓存的有效模式和“前往 Web 修改”。
- 设置是账号全局值，不区分设备；设备 A 与设备 B 只可拥有不同的本机 BYOK Provider/Key。
- 每次查询开始时固定一次模式。同步到新设置只影响后续查询；运行中的请求不迁移、不取消、不跨模式
  重试。
- 额度耗尽、平台停用、网络故障、Key 缺失或 Provider 失败都不能触发 platform/BYOK 自动切换。
- 离线插件可以继续使用最后缓存的 BYOK 模式；最后缓存为 platform 时不能离线查询。没有可信缓存时
  失败关闭。
- 插件 DeviceDisconnect 先撤销当前服务器 DeviceSession，再清账号绑定状态并恢复 StandaloneExtensionUse，
  使用本机 BYOK；没有 Key 时提示配置。网络失败保留原账号状态并提示重试。

## 3. 三项账号级插件偏好

| 偏好                      | 值                    | 默认值     | 修改位置 | 作用域       |
| ------------------------- | --------------------- | ---------- | -------- | ------------ |
| `ExtensionQueryModelMode` | `platform \| byok`    | `platform` | 仅 Web   | 账号全部插件 |
| `StudyCaptureMode`        | `manual \| automatic` | `manual`   | 仅 Web   | 账号全部插件 |
| `CloudWordCopyMode`       | `enabled \| disabled` | `enabled`  | 仅 Web   | 账号全部插件 |

- 首次配对页在批准前展示三项当前值，并允许用户在同一个原子批准动作中修改。
- 配对 exchange 返回 session 与偏好快照；Service Worker 后续通过 Extension-only GET 同步。
- 已关联插件先使用有效 session 绑定的偏好摘要，5 分钟 TTL 到期时后台合并刷新；偏好修订只影响后续请求，
  明确鉴权失败立即清除，迟到响应不得恢复旧会话。缓存为 byok 时可离线查询；缓存为 platform
  时查询失败关闭。同步失败本身不得把本次请求切到另一模型路径。
- 缓存与 extension session 绑定并由 Service Worker 独占。断开、换号、session 失效时清除。
- Web 更新使用 revision、`If-Match`、CSRF、Origin 和 Idempotency-Key，避免多个标签页静默覆盖。
- 插件 Popup/Options 只得到脱敏投影，不得到账号 owner、session token 或其他设备信息。

## 4. 插件查询与 Web 深度分析是两种产物

### 4.1 ExtensionQueryResult

插件的目标是立即理解当前内容，因此平台模式与 BYOK 必须产出相同的精简公开结果和 ResultCard：

- 单词：词典式翻译或语境解释；
- 短语：翻译、语境义和有限用法；
- 句子/段落：自然翻译、主干结构、最多 6 个关键表达和上下文作用；
- 结果保持 ClassicParity 的翻译/解释模式、流式 section、错误与重试，不显示 Provider 差异。

ExtensionQueryResult 可由受信任会话缓存跨 CardSession 短期复用。BYOK 不上传结果；平台结果在服务器最多保留一小时用于
同一请求恢复和幂等重放，之后删除正文与结果，只保留无正文 UsageLedger。

插件模型输入最小化：

- 单词/短语只发送精确选区和包含它的一条完整英文句子；
- 句子/段落只发送精确选区；
- 两种模式都不发送 URL、页面标题、视频 ID、完整页面、浏览历史或相邻段落。

### 4.2 WebDeepAnalysis

Web 的目标是迁移理解并提取可复用表达，因此只支持 `phrase | sentence | passage`，固定同时给出翻译与
教学解释，不再提供“翻译/解释/deep-analyze”动作选择，也不分析单词。

严格结果分为：

- `phrase-analysis-v2`：自然翻译、语境义、结构/搭配、常见用法、易错点、语域，以及 Expression
  候选；不产生 SentencePattern；该单一原始短语使用稳定 `analysisUnitId=u1`；
- `sentence-passage-analysis-v2`：整体理解和翻译；每句原文、翻译、主干/从句/成分、语法/时态/语态/
  特殊结构、关键表达及常用方式/易错点；适用时才出现方言、省略、语气或言外之意；独立产生
  Expression 与 SentencePattern 候选。确定性分句依次使用 `analysisUnitId=u1..u40`。

Candidate 和 SourceExample 使用通用 `analysisUnitId` 关联教学单元，而不是把 phrase 伪装成 sentence。
每个候选必须被恰好一个分析单元引用；确认时 phrase 从 AnalysisRecord 原文/翻译复制来源，sentence/
passage 从对应单元复制。

每个真实教学点最多附一条明确标注的 GeneratedExample 及翻译。GeneratedExample 只解释教学点，不能
成为 SourceExample、候选或学习项。SourceExample 永远来自用户真实看到的原文。

手动粘贴与 StudyCapture 使用同一 WebDeepAnalysis pipeline。严格持久化 AnalysisRecord 之前的 SSE
preview 只在当前 Web 页面显示；失败不保留部分结果。

### 4.3 SelectionKind 判定

插件必须在模型请求和自动采集前确定 `word | phrase | sentence | passage`，不额外调用付费分类模型：

1. Huayi 自己形成的 YouTube `SubtitleSentence` 完整边界是强信号；
2. 普通网页的 `Intl.Segmenter` 句子边界和语义块是辅助信号，不把任意 DOM 容器当绝对句界；
3. 最后使用本地文本规则处理词形、换行、标点、长度和分句数。

完整字幕台词即使没有句号也应优先判为 sentence。多个确定句或跨句选区判为 passage。短语只能手动加入
StudyCapture。Web 在分析前允许纠正 capture kind；分析完成后类型不可直接改，用户需保留 capture、删除
当前分析后再纠正并重新分析。

## 5. StudyCapture

### 5.1 创建时机

- 手动模式：登录后的 ResultCard 对 phrase/sentence/passage 显示“加入待学习”；模型失败状态也可加入，
  ActionCard 尚未开始查询时不显示。
- 自动模式：用户显式启动 sentence/passage 的翻译或解释时立即创建，不等待模型成功；同一 CardSession
  切换翻译/解释不重复创建。phrase 仍须手动加入。
- 未登录只显示“登录后加入”，不排队、不追溯上传过去的选区。

### 5.2 内容与精确去重

StudyCapture 只保存原始学习意图：`kind`、首次精确原文、可选 Web 标题（最多 500 字符）/用户上下文
（最多 1,000 字符）、首次/最近采集时间、
`captureCount`、status 和 revision。它不保存插件查询结果、翻译/解释动作、URL、网页标题、视频 ID、
普通网页/YouTube 来源区别或逐次页面历史。

规范化固定为：NFKC → 统一弯引号 → 首尾 trim → 连续空白折叠为一个空格；保留大小写和标点。服务器对
规范化全文计算 SHA-256，并由 `(owner,kind,hash)` 唯一索引收敛；命中后仍比较规范化全文，理论 hash
碰撞失败关闭而不是误合并。单次最多 2,000 Unicode 字符，复杂度 O(n)，不做语义相似查询。

- passage 与其中单句是不同 capture；不同 kind 也不合并；
- exact duplicate 保留首次原文和 `firstCapturedAt`，更新 `lastCapturedAt/captureCount/revision`；
- 同一个 Idempotency-Key/同一 body 只重放首次响应，不重复增加 captureCount；新的 occurrence 使用新 key，
  才把 exact duplicate 计数增加一次；
- 已 analyzed 的 capture 继续作为去重锚点，但不出现在“待分析”；
- 若账号已有同 kind/hash 的未删除手动 Web AnalysisRecord，新 capture 直接成为 linked analyzed anchor，
  并只关联按 `(createdAt,id)` 最新的一条；旧手动记录保持不变，不再次调用模型。

分析前修改 kind 时重新计算唯一身份；若新 kind 已有同规范原文 capture，返回带 owner-scoped 目标 ID 的
`exact_duplicate` 并保留当前草稿，用户可打开既有项或删除当前项，服务器不静默合并计数/revision。

### 5.3 当前卡片撤销

POST 返回 `created | existing | linked-analysis`：

- 只有 `created` 返回当前卡可用的 `captureId + expectedRevision` 撤销能力；
- `existing/linked-analysis` 只显示“已在 Web 中”，没有撤销；
- 离线新项先写账号绑定加密 SubmissionOutbox，当前卡可删除该本机 item；
- 已提交后的撤销使用 ID+revision，只允许仍为 pending、未开始分析且 revision 未变化的 capture；
- 相同内容再次出现会推进 revision，因此旧卡撤销失败；关闭卡片后不再恢复撤销 UI。

自动创建成功显示“已加入 · 撤销”，离线显示“待联网加入 · 撤销”，已有或已分析显示“已在 Web 中”。
撤销失败必须显示已开始处理/状态已变化，不伪称取消服务器生成。

### 5.4 状态与分析

```text
create/exact-hit ──> pending ──explicit analyze──> analyzing ──strict persist──> analyzed
                            ▲          │
                            └──────────┴── generation failure
```

- 首次分析把 pending 置为 analyzing；失败恢复 pending 并保留用户标题/上下文，显式重试使用新的生成
  Idempotency-Key；
- reanalysis 明确提示会再次消耗平台额度，创建新的 AnalysisRecord，不覆盖旧记录或 LearningItem。
  reanalysis 期间 capture 仍为 analyzed，并另投影正在生成；失败仍保留此前最新记录，成功才追加并切换
  最新投影，不能把它退回 pending；
- capture 的公开投影从其关联 AnalysisRecord 按 `(createdAt,id)` 得出最新记录，旧记录继续位于分析历史；
  插件重复采集永不触发 reanalysis；
- `StudyInbox` 是一个导航入口，将 CaptureInbox 与关联 ReviewInbox 呈现为同一内容的连续步骤，保留两种记录。

### 5.5 删除关系

- pending capture 可在 Web 经二次确认删除，释放精确去重身份；
- 删除当前 capture-linked AnalysisRecord 需二次确认，默认勾选“同时删除原始学习采集”，用户可取消；
- 勾选时删除 capture，但不级联删除其他 AnalysisRecord；以后相同内容可重新采集；
- 取消勾选时，capture 关联最新剩余分析；没有剩余分析则回到 pending；
- 删除非最新旧分析不显示 capture 删除选项；
- AnalysisRecord 删除不删除已确认 LearningItem 的 SourceExample 快照。

## 6. 本机生词与云端副本

### 6.1 两个独立权威

`LocalLexiconEntry` 是每个插件安装的本机正式数据，不按 HuayiAccount 分区。`WordEntry` 是账号云端正式
数据。两者不是缓存/主从，也不双向同步：

- 单词收藏永远先完成本机写入；云端失败不能回滚本机；
- 登录后且 `CloudWordCopyMode=enabled` 时，异步提交 CloudWordCopy；
- CloudWordCopy 只含规范词头、精确完整句、语境释义和收藏时间，不含完整查询结果、URL、标题、
  视频/页面、Provider/Key，也不能覆盖 Web notes；
- 关闭模式只影响同步后的新收藏，不删除两端既有词条；
- Web 编辑不回写本机；登录新账号不自动上传历史本机词条；
- “导入本机生词到 Web”先对本机词库做一次完整快照，预览同时显示词条数与语境数；用户只需做一次
  二次确认，随后由 Service Worker 自动按每批最多 100 个词条且最多 1,000 条语境提交。没有语境的
  本机词条也创建 WordEntry；有多个语境时全部保留，欧路导入的无释义语境也可提交。
- 批量导入使用与 SubmissionOutbox 分离的账号绑定加密任务，保存每批稳定 Idempotency-Key 和进度；
  transient 失败可继续重试，断开、换号、session 失效或撤回联网同意时清除任务正文。重试不要求用户
  再次确认，也不重复已确认批次。
- 单条 future copy 与历史批量导入共享本机副本内容指纹：相同规范词头下，正文与可选语境释义相同即
  视为同一 ContextObservation，即使先经单条 copy、后经 batch import 也不重复。`collectedAt` 不参与
  内容指纹；第一次实际写入的 sourceType/observedAt 保留。任何导入都不覆盖 Web notes、不删除或改写
  LocalLexiconEntry。

### 6.2 外部词典是两组能力

- LocalLexiconExport：当前设备本机生词直接导出欧路/扇贝，不需要账号；
- LocalEudicImport：欧路历史词条导入当前设备本机词库，不需要账号；
- cloud ExternalWordbookJob：Web WordEntry 的欧路导入、欧路导出、扇贝导出任务，由已配对插件用本机
  凭据执行。

Options 必须分区标注“本机生词”和“Web 生词任务”。`CloudWordCopyMode` 不能暗中触发历史欧路或本机
词库批量上传。

## 7. 深模块与 seam

### 7.1 Store Extension

- `ExtensionQueryRouter.query(command)`：固定本次 mode，隐藏 session/偏好缓存读取、BYOK engine 与
  platform HTTP adapter；调用者只消费同一 compact event/result interface。
- `ExtensionPreferenceCache.read/sync/clear`：Service Worker 独占、账号 session 绑定；Popup/Options 只
  通过严格无参数消息读取脱敏状态。
- `StudyCaptureClient.capture/undo`：把 CardSession 的一次采集意图转换为 API 或 SubmissionOutbox 操作，
  隐藏 exact outcome、离线重试和 current-card revision。
- `CloudWordCopyClient.copy`：本机保存完成后的独立异步动作；永不参与本机保存事务。
- `LocalWordImporter.preview/confirm/retry/status`：一次快照预览、一次确认、分批进度与稳定重试；Options
  只获得词条数、语境数和聚合结果，正文与幂等键仅在 Service Worker 加密任务中。
- `SubmissionOutbox.enqueue/process/remove/status/clear`：只接受 strict `study-capture | cloud-word-copy`
  union；最多 20 条、5 MiB、7 天，DeviceVault DEK + 独立 AAD，加密内容与 session 绑定。旧的完整 BYOK
  result import item 不再是合法 union。网络/API 暂时不可达或客户端缺少当前 production adapter 时保留
  已加密 queue 并显示 blocked；只有撤回同意、账号切换/断开、session 失效或用户二次确认清空才删除。

SubmissionOutbox 的能力与授权状态机固定为：

| 条件                                                       | `enqueue`                                 | `process`/公开状态                                       | 密文处理                   |
| ---------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------- | -------------------------- |
| 有效 session + 同意 + adapter 可用                         | 加入稳定幂等项                            | 提交；transient 为 `retry`/`queued`                      | 成功逐项移除，临时失败保留 |
| 有效 session + 同意 + adapter 暂缺                         | 新意图保持 `local-only`，既有队列原样保留 | 稳定 `not-configured`，聚合 count/oldest，不自动调 alarm | 保留；允许用户二次确认清空 |
| 同意撤回                                                   | 不再入队                                  | `upload-disabled`/`discarded`                            | 清除                       |
| session 缺失、过期、鉴权失败、断开或换号                   | 不把新意图绑定到无效账号                  | `session-unavailable                                     | session-invalid`           | 清队列；适用时同时清 session |
| 426 且客户端版本不变                                       | 可继续有界入队并保留版本阻塞              | `client-upgrade-required`，零 fetch/零 alarm             | 保留；升级或显式清空才解除 |
| 用户从当前卡撤销/在 Popup 二次确认清空/超过 7 天或永久无效 | 删除指定项/整队列/过期项/单个永久无效项   | 对应 remaining aggregate                                 | 只删除明确目标             |

`not-configured` 是构建能力阻塞，不是账号或授权终态：Popup 必须显示有界 count/oldest 和“仍加密保存在
本机”，禁用无意义的手动重试，但保留二次确认清空；响应仍不得包含正文、幂等键、session 或 endpoint。

### 7.2 API

- `AccountPreferencesModule`：Web revision 写入、pairing 原子选择与 Extension 脱敏读取。
- `ExtensionQueryModule.run/status`：隐藏额度、价格、持久 generation、Provider、严格 compact schema、
  一小时清理与无正文账本。
- `ExtensionQueryMaintenance.runBatch`：隐藏跨 owner 的过期 running 收口与 terminal 硬删；只接受内部
  cron 调用并返回 bounded `{abandonedCount,deletedCount}`，不返回 owner、正文、结果、错误或额度。
- `StudyCaptureModule.list/get/execute(command)`：一个 command union 封装 upsert、编辑、undo/delete、
  analyze/reanalyze 与 AnalysisRecord 关系；Hono 不复制状态机。
- `CloudWordCopyModule.copy/importBatch`：复用 WordEntry/ContextObservation 规范化与 owner transaction，
  不覆盖 notes。

Postgres/PGlite 是 local-substitutable adapter；DeepSeek、OpenAI 是 true external adapter；Web/Extension
HTTP 是 remote-but-owned adapter。测试在上述 interface 上断言行为，不穿透内部 repository 调用次数。

## 8. 数据结构

Cloud 尚未发布，开发期继续修改 bootstrap `0001`，既有开发数据库必须重建；不得把 `0001` 重放当作
增量升级。

### 8.1 `user_profiles`

新增：

- `extension_query_model_mode text NOT NULL DEFAULT 'platform'`；
- `study_capture_mode text NOT NULL DEFAULT 'manual'`；
- `cloud_word_copy_mode text NOT NULL DEFAULT 'enabled'`；
- `preferences_revision integer NOT NULL DEFAULT 1`；
- `preferences_updated_at timestamptz NOT NULL DEFAULT now()`。

timezone、daily_goal 与三项插件偏好共用一个 AccountPreferences revision。每次真实变化只推进一次。

### 8.2 `extension_query_generations`

关键字段：`id/owner/session/idempotency_key/request_hash/action/selection_kind/source_type`、最小输入、
state/lease/fencing、price/reservation、`dispatched_at`、strict result/terminal error、`expires_at`、timestamps。

- 同 owner/session/key 唯一；同 key 不同 hash 冲突；
- Provider dispatch 前先持久化 generation 和 quota reservation，再以当前 lease 原子写
  `dispatched_at`；写失败绝不调用模型；
- lease 过期但尚未 dispatch 时释放 active reservation、以固定失败终态收口且不写 UsageLedger；已经
  dispatch 时按预留上限保守结算并失败终态，不得透明重领，遵守 ADR-0018；
- source/result 只保留到完成后最多一小时，定时硬删；UsageLedger 不含正文并长期保留；
- production Supabase Cron 只经私有 `pg_net` adapter 调用固定 CRON_SECRET 路由；单次先用
  `FOR UPDATE SKIP LOCKED` 有界收口最多 100 个
  过期 running generation，再硬删最多 100 个到期 terminal generation。并发 worker 不重复结算，清理
  失败留待下轮重试；普通 owner GET/begin 不做跨账号垃圾回收；
- 不与 `analysis_records` 建 FK，不出现在历史或 ReviewInbox。

### 8.3 `study_captures`

关键字段：`id/owner/kind/source_text/normalized_text_hash/status`、可选 `title/user_context`、
`first_captured_at/last_captured_at/capture_count/revision/timestamps`。

- `(owner,kind,normalized_text_hash)` 唯一；命中后在事务内比较规范化全文；
- status 只允许 pending/analyzing/analyzed；
- `analysis_records.study_capture_id` 可空且 `ON DELETE SET NULL`；capture 删除不删历史；
- 不保存第二个 `latest_analysis_id` 可写权威。list/detail 在 owner transaction 中按关联记录的
  `(created_at,id)` 得出最新 AnalysisRecord；删除最新记录后自然回退到下一条，没有剩余记录则恢复
  pending；
- active generation 以独立请求表/ID 关联，失败 fencing 后原子恢复 pending。
- 上一条只适用于 initial generation；reanalysis 使用独立 active generation 投影但不改写 analyzed status，
  失败清除该投影并保留旧 latest。

### 8.4 `analysis_records`

新增 `study_capture_id?`、`source_normalized_hash` 与可选 `source_context`。AnalysisRecord 来源只允许
`manual | study-capture`；Web 手动分析也写规范 hash，
供新 capture 找到同 kind 的既有记录。WebDeepAnalysis V2 只允许 phrase/sentence/passage 和
expression/sentence-pattern candidates；Candidate/SourceExample 使用 `analysis_unit_id`，Web generation
使用 `unit_count`。旧 Store compact result 不再写入 AnalysisRecord。

### 8.5 `idempotency_records` 与本机 schema

新增固定 operation：`preferences.update`、`study-capture.upsert|patch|delete|analyze`、
`cloud-word-copy.copy|batch`。path resource ID 进入 request hash。ExtensionQueryGeneration 使用自身短期 key
唯一约束，不把一小时结果复制进通用幂等表。

SubmissionOutbox 升级为新 envelope/schema version。由于 Cloud 从未发布，检测到旧 `analysis-import`
item 时安全清除并显示“旧开发待提交格式已移除”，绝不上传为 AnalysisRecord。

## 9. HTTP/SSE 契约

| Method/path                                   | 身份         | 用途                                                |
| --------------------------------------------- | ------------ | --------------------------------------------------- |
| `GET /v1/account/preferences`                 | Web          | 五项偏好、revision、updatedAt                       |
| `PATCH /v1/account/preferences`               | Web+证明     | strict partial update + expected revision           |
| `GET /v1/extension-preferences`               | Extension    | 三项插件偏好脱敏投影                                |
| `POST /v1/extension-pairings/:id/approve`     | Web+证明     | 原子选择三项偏好并批准设备                          |
| `POST /v1/extension-pairings/:id/exchange`    | Public proof | session token + 偏好快照                            |
| `POST /v1/extension-queries:stream`           | Extension    | 平台 compact 查询 SSE                               |
| `GET /v1/extension-query-generations/:id`     | Extension    | 一小时内 owner/session-scoped 状态恢复              |
| `GET /v1/study-captures`                      | Web          | pending/analyzed filters + 签名游标                 |
| `POST /v1/study-captures`                     | Extension    | exact upsert，返回 created/existing/linked-analysis |
| `GET/PATCH/DELETE /v1/study-captures/:id`     | Web          | 详情、分析前元数据/type 修正、二次确认删除          |
| `DELETE /v1/study-captures/:id`               | Extension    | current-card ID+revision undo，同一安全删除语义     |
| `POST /v1/study-captures/:id/analyses:stream` | Web+证明     | 首次分析或明确 reanalysis                           |
| `POST /v1/analyses:stream`                    | Web+证明     | 手动 phrase/sentence/passage 深度分析               |
| `POST /v1/words:copy`                         | Extension    | 单次 CloudWordCopy                                  |
| `POST /v1/words:import-local`                 | Extension    | 用户确认后的有界本机词条批次                        |

Web mutation 要求 Cookie、固定 Origin、CSRF、Idempotency-Key；revision mutation 还要求 quoted If-Match 与
body `expectedRevision` 相同。Extension route 要求有效 session、精确发布 Origin、最低客户端版本和固定
route，不接受客户端 owner、Provider endpoint、Header、URL 或模型配置。

平台查询 request 只接受 `action=translate|explain`、kind、精确 sourceText、可信插件 query sourceType，
以及仅 word/phrase 可带的一条 sentenceContext。Content→Service Worker 查询消息另只允许不含正文的
trusted boundary evidence；旧泛化 `context` 字段必须删除，不能把相邻 DOM 段落或完整字幕块送入模型。
Web manual request 不再接受 action、word、Provider、model、quota 或 userId。所有 request/response/event
为 strict schema。

## 10. Web 与插件交互

- `/settings/account` 增加三项插件偏好；额度卡保持独立，明确平台查询/Web 分析/练习共用额度，BYOK
  不计入。
- `/pair-extension/:id` 在同意字段/接收方披露旁展示三项值；批准后再创建 extension session。
- `/app` 的 StudyInbox 使用连续收集流程。待分析可编辑 title/context/kind、运行分析、失败重试、
  二次确认删除；待收藏继续使用现有 Candidate 编辑/确认。
- `/analysis` 只显示内容、可选标题和 kind，不再显示 action；明确将使用平台额度。
- ResultCard 的学习动作不承担候选编辑。它只显示加入状态、当前卡撤销和 Web 入口。
- Popup 显示账号连接、缓存模式和待提交学习数据聚合；Options 显示本机 BYOK Provider/Key、本机词库/
  外部词典能力，以及只读账号偏好。不得把本机 queued 称为已进入 Web。

## 11. 安全、隐私与费用

- BYOK Key 只走 DeviceVault→Service Worker→用户选定 Provider；Huayi API/Web 永不接收或代理。
- 平台查询正文在 Huayi/平台 Provider 可读，最多一小时；StudyCapture、AnalysisRecord、WordEntry 按账号
  数据保留到用户删除。三类接收方、字段、用途和保留期在首次联网同意与公开政策中分别披露。
- 模型路由与数据同步独立。UI 不得用“BYOK”暗示 Huayi 不会收到用户主动开启的 StudyCapture 或
  CloudWordCopy。
- SubmissionOutbox 是未提交意图，不是 CloudAuthority；账号切换、断开、session 失效、撤回 Huayi
  数据同意时清除账号绑定正文。网络、服务器故障或 build adapter 暂缺只进入 blocked/retry，不销毁
  仍与有效 session 绑定的密文。
- 查询/采集消息拒绝 URL、页面标题、视频 ID、owner、token、Header、endpoint、完整页面和模型原始
  response。Content Script 不持有 session、Key 或 Huayi API origin。
- UsageLedger 按 `extension-query-translate|extension-query-explain|web-deep-analysis|practice-*` 区分，
  但共享一个 UsageAllowance。无自动回退保证用户不会因隐式切换产生意外第三方或平台费用。
- 配对页的披露确认授权创建该 DeviceSession，不是第四项账号偏好。用户可在 Web 撤销设备，或在插件
  使用 DeviceDisconnect 先撤销自身服务器会话；两者都会使账号缓存/outbox 在可信状态同步时清除。设备本机
  的 Provider 联网同意仍独立管理；撤回 Huayi 设备授权不删除 LocalLexiconEntry、BYOK/欧路凭据，也不
  代表继续向 Provider 发送数据已经获得同意。
- AccountDataExport 必须包含导出快照时尚未过期的 ExtensionQueryGeneration 公共内容、三项偏好和
  StudyCapture；不得包含 session/lease/reservation/idempotency 或本机 LocalLexicon/outbox。导出不会把
  临时查询变成可浏览历史，其原始服务器保留期限仍不延长。

## 12. TDD 与验证矩阵

### 12.1 Domain/contracts

- 四类 SelectionKind、可信字幕句信号、普通 DOM 边界、无标点短台词、跨句 passage；
- capture NFKC/引号/空白规范化，大小写/标点保留，kind 隔离，hash collision fail closed；
- account preferences defaults/strict update/revision，pairing/exchange projection；
- compact ExtensionQueryResult 与 WebDeepAnalysis V2 不可互相解析；Web 拒绝 word/action/WordCandidate；
- StudyCapture create/existing/linked、status、undo、删除关系、reanalysis；
- CloudWordCopy strict 最小字段，拒绝 URL/result/provider/key/owner。

### 12.2 API/PGlite

- forced RLS/cross-owner、偏好 revision、pairing 原子写入、Extension read；
- query generation 持久化→reservation→dispatch 顺序、同 key replay/different hash conflict、fencing、
  额度耗尽、无 fallback、一小时清理后正文消失/ledger 保留；
- capture 并发 exact upsert 只一行、duplicate revision、手动 analysis 自动 linked、undo stale/in-use；
- initial analyze failure 恢复 pending；reanalysis failure 保持 analyzed/旧 latest；success 原子
  AnalysisRecord+关系投影且 append-only；
- 分析删除勾选/取消、最新/非最新、旧记录/SourceExample 保留；
- CloudWordCopy local-first seam、server upsert 不覆盖 notes、context dedupe、batch replay；
- 所有 Extension route 的 Origin/version/session proof 与所有 Web mutation proof。

### 12.3 Store Extension

- signed-out=BYOK；signed-in platform/byok 账号缓存；每次 query pin；模式更新只影响下一请求；
- platform offline、quota exhausted、BYOK key missing/provider fail 都零自动 fallback；
- platform/BYOK 使用同一 ResultCard schema和 streaming；BYOK terminal 零 analysis import；
- word/phrase sentenceContext 与 sentence/passage exact-only 输入最小化；消息无 URL/title/video/page；
- automatic 只在 sentence/passage query start 触发，manual phrase/sentence/passage 只在 ResultCard；
- 同 CardSession mode switch 不重复、created undo、existing 无 undo、offline queue undo、close 后无 undo、
  stale revision 不误删；
- LocalLexiconEntry 永远先成功；CloudWordCopy 失败不回滚；换号不清本机词库但清账号 outbox/cache；
- 本机/云端外部词典入口并存且文案、凭据、任务 authority 不混淆。

### 12.4 Web

- 设置默认值、保存冲突保留草稿、全设备说明、无设备 override；
- pairing 三项选择、原子 approve conflict、接收方披露；
- StudyInbox 连续步骤、capture loading/empty/error/pagination、kind 修正、分析/retry/reanalysis warning；
- pending delete 与 analysis delete 默认勾选/取消勾选/非最新行为、确认焦点和 live region；
- manual analysis 无 action/word，严格教学结果、GeneratedExample 标签、候选确认；
- 320px 单列、键盘、可见焦点、AA、reduced-motion、迟到 list/detail/generation 抑制。

### 12.5 离线浏览器与发布证据

- signed-out BYOK + 本机收藏/本机欧路不访问 Huayi；
- pairing 选择 platform→插件查询→临时结果，不出现在历史；
- automatic capture→Web 待分析→显式深度分析→待收藏→LearningItem；
- BYOK 查询→manual capture，证明 Huayi 收到原文而不是 BYOK result；
- current-card undo、offline queue/reconnect、账号切换清理、revision race；
- 有效 session/同意下临时移除 production adapter，证明 enqueue 不清既有项，process/status 稳定返回带
  count/oldest 的 `not-configured`、不 fetch/不调 alarm，Popup 仍可二次确认清空；
- local word save→可选 CloudWordCopy，关闭后仅本机；显式本机批量导入；
- privacy/listing/package audit 与真实 UI 文案一致。

默认测试完全离线。真实 DeepSeek/OpenAI、Supabase/Vercel、Eudic/Shanbay、Chrome 安装和商店上传仍需
分别取得知情批准，fake 不能替代目标环境验证。

## 13. 验收标准

只有同时满足以下条件，Phase 27 才算完成：

1. 文档、ADR、契约、数据库和 UI 对 BYOK/平台/采集/本机生词只有一个答案；
2. 已登录用户可选平台或 BYOK，默认平台，所有设备生效，任何故障都不自动切换；
3. 两种模型路径保持同一插件体验，且都不会把 compact result 写成 AnalysisRecord；
4. StudyCapture 手动/自动、exact dedupe、当前卡 undo、离线队列和 Web 显式分析闭环通过；adapter 暂缺
   时既有密文不丢失，聚合阻塞状态可见、重试禁用且显式清空仍可用；
5. Web 深度分析达到本文件的教学结构，只产生 Expression/SentencePattern 候选；
6. 本机词库在所有账号状态下保持独立，CloudWordCopy 和本机/云端外部词典流程可区分；
7. contracts/domain/API/Web/Store focused 与 full tests、PGlite migration/RLS、typecheck、build、lint、
   format、architecture、instructions、diff-check 和离线 E2E 全绿；
8. macOS/Windows CI 均通过；真实 Chrome/Provider/部署验证未完成时明确标记 pending，不宣称发布完成。

## 14. 方案复审结论

文档初稿完成后按权威唯一性、并发幂等、离线恢复、删除关系、费用与隐私逐项复审，并做出以下修正：

1. 删除 `study_captures.latest_analysis_id`，只保留 AnalysisRecord→StudyCapture 关系并由服务器排序投影
   最新记录，避免循环 FK 和两个可写权威；
2. 区分幂等重放与真实再次遇到：同 key 不增 captureCount，新 key 的 exact occurrence 才增加一次；
3. kind 修正撞到已有 exact capture 时返回可核对冲突，不静默合并 revision、计数或撤销能力；
4. 明确用户上下文的长度、持久化和 AnalysisRecord 快照，避免 UI 有字段而契约/数据模型丢失；
5. 把“API/adapter 暂不可用”从清除 queue 改为 blocked/retry；只有授权或账号安全边界变化才清正文；
6. 保留平台查询 dispatch 后不透明重领和 capture generation fencing，避免提高可用性时造成重复计费。
7. 将 phrase/sentence/passage 的内部来源引用统一为 analysisUnitId，并区分首次分析失败与 reanalysis
   失败，避免 phrase 被伪装成句子或旧 latest 被错误丢弃；
8. 删除 Content→Worker 查询消息的泛化 context，新增无正文 trusted boundary evidence，并要求已关联
   设备在每次查询/采集/生词复制前有界同步账号偏好。

保留期决定已于 2026-08-13 确认：导出快照可读取当时尚未过期的平台查询；生成的
AccountDataExport 是用户主动创建、最多保留 24 小时的独立私有副本，因此其中内容可能晚于原
generation 的一小时 expiry 删除。原 generation 仍按一小时硬删且不进入历史，公开隐私说明必须明确
这个导出例外。2026-08-14 完成度复审另确认：`api=null` 属于构建能力缺失，不能与撤回同意、session
invalid/account disconnect 共用清除分支；公共 `not-configured` 必须保留聚合队列证据与用户清除能力。
该回归已通过 27F-R 的 Fresh RED→GREEN、公共契约/Popup 回归与 Store 门禁。除此之外复审未留下其他
待决项；任何实现若需要改变上述
资源所有权、自动化时机、费用接收方、保留期或删除关系，必须先回到产品决策而不能在代码中自行推断。

## 15. 分阶段实现顺序

1. **27A 文档与 ADR**：全仓冲突清单、领域语言、本文、核心文档、公开披露和方案复审；
2. **27B 领域与公共契约**：先写 RED，新增偏好、StudyCapture、V2 深度分析、compact query、word copy；
3. **27C 数据与账号偏好**：bootstrap/RLS/revision、pairing 原子选择、Extension cache sync；
4. **27D 插件模型路由**：QueryRouter、platform temporary generation、无 fallback、compact parity；
5. **27E StudyCapture API/Web**：精确 upsert、两个 Inbox、分析/reanalysis/delete 关系；
6. **27F Store capture/outbox**：手动/自动/undo/offline、移除 full-result import；
7. **27G 本机生词与云端副本**：local-first、CloudWordCopy、显式本机批量导入、恢复本机词典入口；
8. **27H 联合验收与发布校准**：全量门禁、跨端 E2E、隐私/listing/release evidence、双平台 handoff。

每个阶段必须先记录 fresh RED，再做最小实现并运行受影响门禁。跨公共契约、迁移、认证、额度或安全的
阶段还必须运行全仓门禁；不得用后续阶段的假实现提前宣称闭环完成。
