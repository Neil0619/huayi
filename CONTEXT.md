# Huayi 英语学习

Huayi 帮助用户在不离开当前阅读或观看内容的情况下理解英文，并把需要记忆的词汇加入个人
生词本。

## Language

### Product lines

**Classic Edition（经典版）**:
面向既有个人用户、只接受必要维护的 Huayi 原有产品线。
_Avoid_: 旧版、桌面版、本地版、0.13

**Store Edition（商店版）**:
面向公开分发和长期演进、由 Store Extension 与 Web App 共同组成的 Huayi 云端产品线；插件负责
就地查询，Web 负责整理、管理与主动练习。
_Avoid_: 新版、云版、本地版、1.0

**Web App（学习工作台）**:
Store Edition 中承载分析历史、待整理内容、学习库、生词管理和主动练习的网页应用。
_Avoid_: 插件设置页、远程代码宿主、聊天网页

**StandaloneExtensionUse（插件独立使用）**:
Store Extension 未关联 HuayiAccount 时的使用状态；查询只使用本机 BYOK，并保留插件本身的本地生词
收集与外部词典能力，但不使用平台额度或账号学习数据。
_Avoid_: 离线模式、访客账号、平台模型失败回退

**ClassicParity（Classic 功能对齐）**:
Store Edition 对 Classic Edition 0.13.0 已确定用户行为的继承基线；只有明确记录的 Store 决策才可
改变这些行为。
_Avoid_: 参考旧版样式、视觉复刻、自由重新设计功能

**ActionCard（启动卡）**:
用户完成有效选区后出现、只提供翻译与解释入口且不回显选中文本的紧凑词卡。
_Avoid_: 选词 Popup、结果预览、选中文本卡片

**ResultCard（结果卡）**:
模型分析完成后按 Classic 功能对齐呈现结构化内容、必要词头或短语标题及生词动作的词卡；显式不含
原句语境块，句子结果也不重复整句。
_Avoid_: 启动卡、扁平结果列表、原句卡片

**ExtensionQueryResult（插件查询结果）**:
Store Extension 为当前阅读场景生成并在 ResultCard 展示的精简翻译或解释产物；平台模型与 BYOK 使用
相同产品结构，模型来源不会改变浮层的详细程度。它只属于当前 CardSession，不会自动成为
AnalysisRecord、分析历史或待收藏内容。
_Avoid_: Web 深度分析、AnalysisRecord、模型原始响应

**ExtensionQueryGeneration（插件查询生成）**:
平台模式为一次 ExtensionQueryResult 建立的临时可计费生成；正文和结果只在一小时恢复窗口内保留，
之后仅留下无正文用量账本，不能成为分析历史。单词和短语最多携带所在完整句，句子和段落只携带
精确选区；两者都不包含 URL、页面标题或页面正文。
_Avoid_: AnalysisRecord、StudyCapture、长期查询历史

**SelectionKind（选区类型）**:
插件在模型查询前确定的单词、短语、句子或段落分类；产品自身形成的字幕句边界和网页句子分段信号
优先于本地文本规则，Web 可在深度分析前纠正 StudyCapture 的类型。
_Avoid_: 模型输出类型、不可修改标签、仅按词数分类

**CardDismissal（词卡关闭）**:
用户点击或轻触词卡外部，或者按下 `Esc`，结束当前 ActionCard、分析过程、错误状态或 ResultCard；
词卡本身不显示关闭按钮。关闭同时取消未完成请求、清除选区，并只恢复词卡实际拥有的媒体暂停。
_Avoid_: X 按钮、标题栏关闭、仅隐藏面板

**CardSession（词卡会话）**:
一次有效划词从 ActionCard 出现到词卡关闭的临时交互范围；顶部始终提供翻译与解释切换，已经成功
加载的模式结果只在本次会话内缓存，切回时不重复请求。词卡关闭即销毁全部模式结果，下一次划词
建立新的会话。
_Avoid_: 分析历史、跨选区缓存、持久结果缓存

**CardModeSwitch（词卡模式切换）**:
CardSession 顶部单行工具栏中的翻译与解释入口；它与品牌、生词状态共享一行。切换到已完成模式时
立即显示会话缓存，切换到未完成模式时取消当前请求并只启动新请求。
_Avoid_: 结果区操作按钮、底部页签、并行分析请求

**DiagnosticEvent（诊断事件）**:
一次产品失败的本地、脱敏、结构化记录，只包含版本、时间、稳定错误码、允许列出的失败层级和有限
运行状态；不包含选区、网页内容、地址、标题、凭据、模型正文或原始响应。用户可主动提交诊断事件，
但它不会默认远程上报。
_Avoid_: 完整日志、错误遥测、模型响应快照

### Cloud learning

**HuayiAccount（华译账号）**:
一个受邀请用户在 Store Edition 中的身份，以及其云端学习数据和平台模型额度的所有者。
_Avoid_: Chrome Profile、设备、订阅

**CloudAuthority（云端权威）**:
华译账号下 StudyCapture、WordEntry、分析历史、学习项和练习记录的唯一云端正式状态；设备待提交
数据不构成第二云端权威，但独立插件的 LocalLexiconEntry 不是它的缓存或副本。
_Avoid_: 双向同步、把本机词条当云端缓存、多主云端复制

**DeviceVault（设备保险库）**:
Store Extension 在可信扩展上下文中保护 BYOK、欧路凭据、设备会话和短期待提交数据的深模块；
它没有日常密码、锁定或解锁状态，也不是学习库。
_Avoid_: 密码保险库、会话保险库、CredentialVault

**AnalysisRecord（分析记录）**:
一次已通过完整结构校验的分析输入、结果、候选、来源和模型元数据；它具有待整理或已整理状态，也
可以独立归档。Web 显式重新分析会创建新的记录而不是覆盖旧记录。
_Avoid_: 聊天、CardSession、流式预览

**WebDeepAnalysis（Web 深度分析）**:
Web 使用平台模型对短语、句子或段落生成的结构化教学解释，包含整体理解、翻译、结构、语法、表达及
适用的语气或言外之意，并独立产出可确认的 Expression 与 SentencePattern 候选，不为 StudyCapture
推荐或分析单词；手动粘贴与 StudyCapture 使用同一能力，不再提供翻译或解释模式分支。它不是聊天回答或
ExtensionQueryResult。
_Avoid_: 自由文本长文、插件精简解释、自动收藏

**StudyCapture（学习采集）**:
用户从 Store Extension 送往 Web、准备日后学习的一条完整短语、句子或段落；段落不会在采集时拆句，
也不区分普通网页或 YouTube，不自动携带 URL、标题或前后文，用户只能在 Web 主动补充可选上下文。它不包含
ExtensionQueryResult，也不是 AnalysisRecord，只有用户在 Web 显式运行深度分析后才产生学习候选；
它不保存插件当次选择的翻译或解释动作，Web 深度分析固定同时提供翻译和教学解释；
短语只产生 Expression 候选。分析完成后它作为关联 AnalysisRecord 的已处理去重锚点保留，不再出现
在待分析视图；重新分析时它改为关联最新记录，旧记录仍在历史。关联分析被删除但用户选择保留采集
时，它优先关联最近的剩余分析，没有剩余分析才恢复为待分析；删除采集不会级联删除其他历史。
同一账号只做
保留大小写和标点的规范化原文精确去重，不做语义去重。精确重复不会新建记录，而会保留首次时间、
更新最近时间和累计遇到次数，并推进 revision；不保存逐次页面历史。
账号内已有同原文、同类型的未删除 WebDeepAnalysis 时，采集直接成为关联该 AnalysisRecord 的已分析
去重锚点，不重新调用模型。
待分析采集经 Web 二次确认删除后不再占用去重身份，未来可重新创建。
_Avoid_: SentenceCapture、插件分析上传、待整理分析、自动创建学习项

**StudyCaptureStatus（学习采集状态）**:
StudyCapture 只能是待分析、分析中或已分析。首次分析失败必须恢复待分析并保留用户补充内容，只有
严格 AnalysisRecord 已持久化后才可首次进入已分析；重新分析期间仍保持已分析，失败保留此前最新
记录，成功才追加并切换最新投影。
_Avoid_: 模型任务状态、流式预览状态、失败终态

**Candidate（候选内容）**:
Web 深度分析记录中可被用户整理成 Expression 或 SentencePattern 的不可变建议；候选本身不是学习项。
WordEntry 只通过独立生词流程创建，不由 WebDeepAnalysis 产生 WordCandidate。
_Avoid_: 自动收藏、草稿学习项、模型标签

**StudyInbox（待整理）**:
Web 中处理 StudyCapture 与 AnalysisRecord 的统一工作入口；它分别呈现“待分析”和“待收藏”，但不会
把两种资源合并为同一种记录。
_Avoid_: 单一记录队列、通知收件箱、学习库

**CaptureInbox（待分析）**:
StudyInbox 中尚未完成 Web 深度分析的 StudyCapture 工作视图。
_Avoid_: ReviewInbox、自动分析队列、AnalysisRecord

**StudyCaptureMode（学习采集模式）**:
HuayiAccount 为全部关联 Store Extension 统一选择的学习采集方式，只能是默认的手动加入或自动加入；
自动模式在用户显式开始句子或段落查询时采集，不等待模型成功，短语仍须手动加入；它不是逐设备
设置，只能在 Web 修改，离线设备可暂用最后同步到的选择。
_Avoid_: 插件本地开关、自动深度分析、ExtensionQueryModelMode

**ReviewInbox（待收藏）**:
StudyInbox 中所有 `pendingReview` AnalysisRecord 构成的工作视图，用户可确认候选或标记无需收藏。
_Avoid_: CaptureInbox、收件箱通知、自动收藏队列、临时云草稿

**LearningItem（学习项）**:
用户明确确认、由华译安排主动练习的 Expression 或 SentencePattern。
_Avoid_: 单词、候选、原句

**LearningItemMaintenance（学习项维护）**:
用户显式编辑、删除或合并既有 LearningItem 的动作。删除只允许从未进入练习会话的项目；合并只允许
把未练习且仍为新项的同类型来源并入目标，目标排期保持不变。已形成的练习历史不能被级联删除或改写。
_Avoid_: 自动合并、改写练习历史、跨类型合并

**LearningItemArchive（学习项归档）**:
用户可逆地让一个 LearningItem 离开在学学习库、今日练习候选和新练习入口，同时完整保留学习项、排期
和既有练习关系；恢复后沿用原排期。它不是删除，也不清除内容或历史。
_Avoid_: 学习项删除、练习历史删除、排期重置、tombstone

**LearningItemErasure（学习项抹除）**:
用户不可逆地删除一个已归档 LearningItem 的正文、来源、标签和排期，同时保留用户未选择删除的终态
PracticeSession。它与归档、练习历史删除和整账号删除是不同动作。
_Avoid_: 归档、级联删除练习、隐藏学习项、软删除

**LearningItemTombstone（学习项墓碑）**:
LearningItemErasure 后仅为既有 PracticeSession 保留关系完整性的最小非内容锚点；它不是 LearningItem，
不可读取、恢复、练习或导出，最后一条引用消失后也随之删除。
_Avoid_: 已归档学习项、内容快照、可恢复删除、学习项详情

**Expression（表达）**:
可以整体复用的固定或半固定英文片段，拥有自身文本、含义和使用说明。
_Avoid_: 句型、任意原句、单词

**SentencePattern（句型）**:
带明确槽位、可替换内容和交际功能的抽象英文模板。
_Avoid_: 优秀原句、表达、语法规则名称

**SourceExample（来源例句）**:
说明学习项如何在真实上下文中出现的原句快照；它支持理解和反馈，但不独立进入复习队列。
_Avoid_: SentencePattern、浏览历史、页面快照

**GeneratedExample（生成示例）**:
WebDeepAnalysis 为帮助迁移理解而生成并明确标注的一条有界例句及翻译；它只属于教学解释，不是
SourceExample，也不能自动成为学习项或真实来源。
_Avoid_: 来源例句、用户语料、自动收藏内容

**PracticeSession（练习会话）**:
围绕一个或多个学习项完成的一次句子创作或受约束文字对话，以及其最终反馈和用户自评。
_Avoid_: 聊天历史、单词背诵、模型评分

**PracticeAttempt（练习作答）**:
用户在句子创作练习中提交的一次答案；它在模型反馈前也必须属于练习会话的正式记录。
_Avoid_: 对话 turn、临时输入、最终反馈

**PracticeFeedback（练习反馈）**:
华译在用户提交作答后生成的正确性、自然度与改进建议；它不包含精确分数，也不替代用户自评。
_Avoid_: 自动评分、掌握度、自评

**DialogueRound（对话轮次）**:
受约束对话中一次用户回复及其后一次情境角色回复；开场消息不属于轮次。
_Avoid_: 单条消息、PracticeAttempt、聊天回合

**DialogueItemFeedback（对话逐项反馈）**:
受约束对话结束后，针对会话中每个 LearningItem 生成的一条最终反馈；它不会在对话中途出现。
_Avoid_: 中途纠错、整体摘要、用户自评

**ScheduleState（排期状态）**:
一个学习项在公开固定间隔阶梯中的当前位置、下次到期时间和最近一次用户自评。
_Avoid_: AI 掌握度、精确记忆分数、强制清零

**DailyPracticeQueue（今日练习队列）**:
按用户时区从到期学习项和未复习新项中组成、受每日目标约束的一次练习选择。
_Avoid_: 必须清零的任务、连续签到、单词复习队列

**UsageAllowance（使用额度）**:
华译账号在一个 UTC 自然月内可消耗的平台模型费用上限；插件平台查询、Web 深度分析和主动练习共用
同一额度池，但账本按用途区分，BYOK 与纯数据操作不消耗额度。它不是可提现余额或订阅权益。
_Avoid_: 钱包、积分、无限次数

**PlatformGeneration（平台生成）**:
HuayiAccount 发起、由华译托管模型完成并占用 UsageAllowance 的一次可计费生成；它在调用模型前成为
可恢复权威，并且只拥有一个最终结果。
_Avoid_: Provider 请求、练习租约、分析请求

**ExtensionQueryModelMode（插件查询模型模式）**:
HuayiAccount 为全部关联 Store Extension 统一选择的查询模型来源，只能是平台模型或 BYOK；它不是
逐设备偏好，调用失败、额度耗尽或服务停用也不能让两种模式自动互相回退。平台模式的具体 Provider
与模型由华译管理且不提供用户选择，BYOK Provider 才由每个插件安装分别选择。
账号模式只能在 Web 修改；每次查询在开始时固定模式，设置变化只影响插件同步后的后续查询。
_Avoid_: 登录状态、逐设备模型设置、Provider 选择、Web 模型模式

**BYOK（自带模型密钥）**:
Store Extension 使用用户保存在 DeviceVault 中的 OpenAI 或 DeepSeek API Key 直接完成查询；每个插件
安装分别选择 Provider 并保存自己的 Key，它不是插件产品线，也不消耗 UsageAllowance。BYOK 只决定
模型调用路径，不阻止插件按独立账号偏好向华译提交 StudyCapture、CloudWordCopy 或云端任务数据。
_Avoid_: 插件、本地版、账号级 Provider、平台模型

**DeviceSession（设备会话）**:
用户在 Web 明确批准、供一个 Store Extension 安装访问同一 HuayiAccount 的可撤销凭证关系。
_Avoid_: Chrome 登录、BYOK 凭据、永久设备绑定

**DeviceDisconnect（设备安全断开）**:
Store Extension 使用当前 DeviceSession 只撤销自身服务器凭证，并在服务器确认后清除账号绑定本机状态的
安全退出动作；它不退出 Web、其他设备或删除独立本机数据。
_Avoid_: 本机忘记、退出全部设备、清空本机词库

**SubmissionOutbox（待提交箱）**:
设备在云端暂时不可达时保存 StudyCapture 等账号绑定提交意图的有界、加密、可过期容器；其中内容
尚未成为 CloudAuthority，退出或更换账号必须清除。
_Avoid_: 本地学习库、同步副本、已保存内容

**WordEntry（词条）**:
华译账号中一个规范单词及其全部语境记录的云端集合；它不进入 Huayi 主动练习队列。
_Avoid_: 单词行、学习项、外部词条

**LocalLexiconEntry（本机词条）**:
一个插件安装独立保存的本机生词及其有限语境；登录账号后的新收藏可以另行提交为云端 WordEntry，
但两者不双向同步，Web 编辑也不覆盖本机词条。它不按 HuayiAccount 分区，登录、退出或换号都不会
清除；既有本机词条只能通过显式批量导入进入某个账号。
_Avoid_: WordEntry、云端缓存、跨设备同步词条

**CloudWordCopyMode（云端生词副本模式）**:
HuayiAccount 为全部关联 Store Extension 统一选择的新 LocalLexiconEntry 是否同时提交为云端 WordEntry
的偏好，默认开启；关闭只影响同步后的后续收藏，不删除既有云端词条或改变本机收藏。
_Avoid_: 双向同步、本机词典开关、StudyCaptureMode

**CloudWordCopy（云端生词副本）**:
插件从一次本机收藏向云端提交的规范词头、精确原句、语境释义和收藏时间；它不包含完整查询结果、
页面信息或本机 Provider 配置，也不能覆盖 WordEntry 的 Web notes。
_Avoid_: LocalLexiconEntry 同步、AnalysisRecord、完整插件结果上传

**ContextObservation（语境记录）**:
用户遇到一个词时保存的原句、语境释义、来源与时间。
_Avoid_: 浏览历史、页面快照、完整分析结果

**WordListExport（词表导出）**:
用户主动下载的 UTF-8 纯文本词表，每行只包含一个规范词头；它不包含语境、释义、来源或时间，
也不能用于完整恢复云端学习数据。
_Avoid_: 生词备份、明文 JSON、可恢复导出

**AccountDataExport（账号数据导出）**:
用户主动取得的版本化完整云端账号数据副本，包含账号偏好、导出快照时仍在一小时保留期内的
ExtensionQueryGeneration 公共内容、StudyCapture、分析、学习项、云端生词和练习，但不包含任何凭据、
会话、各设备 LocalLexiconEntry 或尚未提交的 SubmissionOutbox。导出不会延长临时查询的原始保留期，
也不会把它变成可浏览历史。
_Avoid_: WordListExport、设备本机备份、数据库备份、密钥导出

**AccountDeletionJob（账号删除任务）**:
用户确认删除账号后，独立于账号正文持续到主库、导出文件和身份记录均被删除的可恢复执行记录。
_Avoid_: 退出登录、停用账号、级联删除请求

**DataRightsSession（数据权利会话）**:
停用账号重新验证身份后取得的受限 Web 会话，只允许完整导出、永久删除和退出，不授予学习功能访问。
_Avoid_: 普通 WebSession、管理员代办、账号恢复

**Operator（运营人员）**:
拥有显式运营角色、只能查看白名单账号与用量元数据并执行受审计运营动作的 HuayiAccount；它没有读取
用户学习正文、凭据或代登录的能力。
_Avoid_: 超级管理员、数据库管理员、客服代登录

**OperationalAuditEvent（运营审计事件）**:
一次 Operator 动作的不可变、无正文记录，只包含动作、执行者、目标、有限安全详情与时间。
_Avoid_: 应用日志、用户活动记录、正文快照

### External wordbooks

**LocalLexiconExport（本机生词导出）**:
Store Extension 把当前设备的 LocalLexiconEntry 直接发送到欧路或扇贝的独立流程；它不要求
HuayiAccount，也不是云端 ExternalWordbookJob。
_Avoid_: Web 生词导出、云同步、CloudAuthority 任务

**ExportTarget（导出目标）**:
接收云端词条副本的外部生词本，目前指欧路或扇贝。
_Avoid_: 同步端、权威词典

**ExportReceipt（导出回执）**:
一次外部导出已经创建、已经存在或经用户确认的结果记录。
_Avoid_: 同步状态、远端所有权

**ExportOutbox（导出箱）**:
由 CloudAuthority 持有、等待 Store Extension 发送、确认、重试或取消的外部导出意图集合。
_Avoid_: 同步队列、远端生词本

**EudicImportJob（欧路导入任务）**:
通过 Store Extension 把既有欧路词条一次性纳入 CloudAuthority 的可恢复导入过程。
_Avoid_: 每日同步、双向同步、后台轮询

**LocalEudicImport（本机欧路导入）**:
Store Extension 把既有欧路词条一次性纳入当前设备 LocalLexiconEntry 的独立过程；它不要求
HuayiAccount，也不会因 CloudWordCopyMode 开启而自动上传到 Web。
_Avoid_: EudicImportJob、日常云端副本、双向同步

### YouTube captions

**CurrentPlayer（当前播放器）**:
当前标准 YouTube 录播页面中，用户正在观看且 Huayi 可以安全关联的视频播放器。
_Avoid_: movie player、video element

**ActiveSourceTrack（活动源轨）**:
用户已在 YouTube 中开启并实际显示的英文字幕轨；Huayi 只接受它，不替用户选择另一条轨道。
_Avoid_: 首选英文轨、最佳英文轨

**TranslatedCaptionTrack（译文轨）**:
与活动源轨对应、面向简体中文的 YouTube 自动翻译字幕轨，只用于辅助理解。
_Avoid_: 模型翻译、整句翻译结果

**SubtitleSentence（字幕句）**:
由一组连续源字幕片段构成、在同一时间窗内完整展示和作为分析上下文的英文句子。
_Avoid_: 当前 cue、整条字幕

**EnglishMode（英文模式）**:
只展示字幕句英文原文的观看模式，也是每个新视频的默认模式。
_Avoid_: 单语开关关闭

**BilingualMode（双语模式）**:
在英文原文下同时展示有效简体中文译文的观看模式，可固定或通过按住快捷键临时进入。
_Avoid_: 翻译模式

**PauseOwnership（暂停所有权）**:
Huayi 因有效字幕选区或顶部临时“中”按住手势而暂停一个原本正在播放的视频后，分别取得的
有限恢复播放资格；每个资格绑定当前字幕代次，用户操作可立即撤销它。
_Avoid_: 自动恢复、暂停状态

**CaptionGeneration（字幕代次）**:
一次视频及播放器身份稳定期间的字幕会话；导航、换视频或播放器替换都会开始新的代次。
_Avoid_: 缓存版本、请求序号
