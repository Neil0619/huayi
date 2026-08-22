# 语见 Cloud V1 产品需求

## 1. 产品目标

Cloud V1 不替代扇贝、不背单词或欧路等成熟单词记忆产品。它补足用户在阅读、观看和写作时发现的
表达与句型：先帮助用户深度理解，再把值得复用的内容整理成学习项，通过真实造句和受约束对话反复
使用。收藏是“理解”和“主动使用”之间的连接动作，不是产品终点。

Store Edition 是一个产品、两个客户端：Store Extension 负责在网页与 YouTube 上快速查询；Web
App 负责完整分析、待整理内容、学习库、生词、历史和练习。Classic 0.13 与 Native Host 不在本次
范围内。

## 2. 用户与成功标准

V1 面向持有一次性邀请链接的少量中文母语英语学习者。成功必须同时满足：

- 用户能从 Web 粘贴或从 StudyCapture 显式产生完整结构化教学分析；
- 登录用户可以手动或按账号设置自动把原始短语/句子/段落加入 Web 待分析区，插件精简结果不会冒充
  Web 分析；
- 用户能区分并收藏 Expression 与 SentencePattern，系统不会把完整原句当成句型；
- 用户能通过句子创作和 3–5 轮受约束对话实际使用到期学习项；
- 用户的本机生词在登录前后都可用；用户还可选择把新词复制到 Web 查看，但 Huayi 不为单词建立
  记忆队列；
- Google 与邮箱密码账号、跨设备数据、月度平台额度、导出和删除形成可运营闭环；
- Extension 仍有独立的就地查询用途，不依赖远程托管代码执行。

## 3. 功能范围

### 3.1 账号与访问

- 新用户必须持有未绑定邮箱、72 小时过期且只能领取一次的邀请链接；领取后可选择 Google 或
  邮箱密码，邮箱密码必须验证邮箱。
- Web 从 `/join#<token>` 领取邀请；fragment 不会随首个 HTTP 请求发送给托管/CDN，领取成功后立即从
  地址栏移除 token。短时 claim ticket 只保留在当前
  页面内存，选择 Google 时只作为固定 API 原生 POST 表单的隐藏字段，不能进入 query、hash 或浏览器
  持久存储。邀请失败可以显式重试，不回显 token。
- 已注册用户后续登录不需要新邀请。Google 与密码身份只能在已登录且重新认证后显式绑定，不能按
  相同邮箱静默合并。
- 已登记 password method 的 active 账号可从公开恢复页请求密码恢复；无论邮箱不存在、账号状态或登录
  方式不符合条件，公开响应和文案都相同。邮件证明只取得一次改密能力，不创建 Huayi session；成功后
  撤销全部 Web/Extension sessions，并要求用户重新登录。完整边界见 `password-recovery.md`。
- Web 提供设备列表，用户可以撤销任一 Extension 会话；管理员可以停用账号，但不能浏览学习正文。
- Web 设备撤销使指定服务器 session 立即失效；Extension Popup 的“断开此设备”先用当前 token 只撤销
  自身服务器 session，204 后才清账号绑定本机状态。网络失败保留原状态并提示重试，不冒充断开；两者
  都不影响其他设备或 Web session。
- Popup 的“待提交学习数据”只显示本机加密 SubmissionOutbox 的条数和最早排队日期。用户可以复用原
  幂等键手动重试，或经二次确认只清空本机待提交内容；这不会删除云端已有记录、学习库、生词或
  Provider 凭据，也不会向 Popup 暴露正文、结果、token 或内部 ID。
- 服务器要求升级时，Popup 明确说明待提交内容仍加密保存在本机；同一客户端版本停止自动/手动重试，
  更新后的版本才恢复一次显式重试能力。升级状态不进入网页浮层或 Content Script。
- Web 配对审批在创建 extension session 前明确展示三项账号插件偏好、Huayi 可能接收的最小选区、
  StudyCapture/CloudWordCopy 字段、平台查询用途和保留期，并要求用户确认；同时声明不发送页面 URL、
  API Key、完整页面或 BYOK 结果。
- 未登录 Extension 可以用本机 BYOK 查询、收藏本机生词和使用本机外部词典；不能使用平台额度、创建
  StudyCapture 或 CloudWordCopy。
- 账号偏好包含默认 platform 的查询模式、默认 manual 的学习采集模式和默认 enabled 的云端生词副本；
  只在 Web 修改、全部插件生效、离线使用最后缓存值。模型模式在请求开始时固定，任何错误都不自动
  在 platform/BYOK 之间切换。
- SubmissionOutbox 只保存 strict StudyCapture/CloudWordCopy 意图，不保存完整插件结果。网络/API
  暂时不可用时保留与有效 session 绑定的密文；断开、更换账号、session 失效、撤回同意或用户二次确认
  清空时删除，避免正文跨账号提交。
- 公开 `/privacy`、配对审批和 Store 披露必须分别说明 BYOK 查询、platform 查询、StudyCapture 与
  CloudWordCopy：BYOK Key 和精简结果不发送语见；platform 查询正文/精简结果最多保留一小时且不进入
  待整理或分析历史；StudyCapture/CloudWordCopy 是独立用户选择，不得称为“BYOK 结果上传”。

### 3.2 分析

- Web 接受 phrase/sentence/passage 粘贴或 StudyCapture；Extension 接受普通网页选区和现有 YouTube
  字幕选区；手动录入学习项不要求
  先运行模型。MCP 录入延后。
- 单次输入最多 2,000 个 Unicode 字符、最多 40 个确定性分句。所有用户主动提交的内容都视为需要
  分析，系统不自动截断。
- 插件查询中，单词沿用词典式翻译与语境解释分离，短语保留词汇结果，句子/段落只展示适合浮层的
  自然翻译、主干、最多 6 个关键表达和上下文作用。WebDeepAnalysis 固定同时给出翻译与教学解释，
  提供整体理解、逐句主干/从句/成分、语法/时态/语态/特殊结构、表达用法/易错点，以及适用的方言、
  省略、语气或言外之意。
- 划词后先显示只含“翻译／解释”的紧凑 ActionCard；开始请求后切换为固定 ResultCard 壳层，并按
  Classic 已验证的文本 delta 和结构化 section 顺序渐进展示。流式预览不能收藏或持久化，只有完整
  结果通过严格 Schema 才构成成功。
- 插件查询输入对 word/phrase 只含选区和一条完整句，对 sentence/passage 只含精确选区；不上传 URL、
  页面标题、浏览历史、视频 ID、完整页面或相邻段落。StudyCapture 也不保存网页/YouTube 来源区别。
- BYOK 与平台插件查询都只产生 ExtensionQueryResult；前者不上传结果，后者只建立最多保留一小时的
  ExtensionQueryGeneration。二者都不产生 AnalysisRecord、候选或分析历史。
- Web `/analysis` 只以 `manual` 来源提交用户粘贴的英文、可选来源标题/用户上下文和内容类型；页面不再
  提供 action，也不接受 word、
  userId、Provider、模型或额度权威字段。开始、临时 preview、完成和失败使用可访问状态区展示，失败
  重试保留输入并生成新幂等键。取消只停止本页等待并抑制迟到事件，不伪称撤销服务器任务；页面保留
  requestId 与“重新检查状态”，每次 running 检查都给出可见反馈。编辑输入不能绕过 active request
  锁定；服务器 completed/failed 后才交接结果或允许重试，后续严格完成的记录仍可能进入待整理。
- Web 手动粘贴与 StudyCapture 使用同一 strict WebDeepAnalysis V2。phrase 只产生 Expression 候选；
  sentence/passage 产生 Expression/SentencePattern 候选；不产生 WordCandidate。每个真实教学点最多一条
  明确标注 GeneratedExample，且它不能成为 SourceExample 或学习项。
- AnalysisRecord 来源只区分用户手动粘贴或 StudyCapture，不从 capture 恢复/推断普通网页与 YouTube。

### 3.3 待整理与收藏

- Extension 浮层保持现有查询取向，只显示精简结果、加入待学习状态/当前卡撤销和 Web 入口；不提供
  候选勾选、字段编辑、标签或合并。
- Web 的 StudyInbox 包含“待分析” StudyCapture 和“待收藏” AnalysisRecord 两个 tab。待分析允许在调用
  模型前纠正 kind、补标题/上下文、显式分析、重试或二次确认删除；待收藏显示完整分析和全部
  Candidate。用户可以编辑候选、批量确认若干项，或把整个分析
  标记为“无需收藏”。处理后记录进入历史但离开待整理队列。
- Web 待整理的最小闭环必须保留失败前的编辑与勾选。精确重复响应没有目标 ID 时只能解释冲突并
  保留草稿，不能猜测合并对象；只有查重接口返回用户可核对的目标后才允许显式 merge。
- Expression 是整体复用的固定或半固定片段；SentencePattern 是包含可替换槽位的抽象模板；
  SourceExample 只提供真实上下文。
- 系统属性由模型建议，用户标签由用户决定。模型不得自动创建标签或自动合并。
- 精确重复必须阻止重复新建并提供合并选择；语义相近只提供建议。合并追加来源、备注和标签，不
  覆盖用户已经编辑的核心字段。
- WebDeepAnalysis 只有 ExpressionCandidate 和 SentencePatternCandidate，两类可在一个批量事务中创建或
  合并 LearningItem。WordEntry 由手动录入、CloudWordCopy、本机批量导入或外部词典导入维护。

### 3.4 学习库与历史

- 学习库在同一页面管理 Expression 与 SentencePattern，支持类型、系统属性、标签、文本和时间
  筛选；两种类型使用不同编辑表单。
- Web `/library` 显示账号所属 LearningItem、当前 ScheduleState 与最近一次已完成
  练习的最小摘要，支持类型、标签、系统属性、文本、已到期/新项筛选和游标分页。筛选、到期判断与
  分页都由服务器执行；页面不缓存第二份学习库权威。类型专属表单可手动创建 Expression 或
  SentencePattern，成功后重新读取服务器列表与详情。详情可类型专属编辑；删除经过二次确认且只允许
  从未进入练习的项目。语义建议只提供用户可核对的同类型候选，人工预览/确认后才可把仍为新项且
  未练习的来源并入目标；目标核心与排期保留，来源元数据/例句去重追加，不能跨类型或自动合并。
- 语义建议是用户显式发起的平台额度调用；浏览器每次点击使用新的幂等键，失败不自动重试、不切换
  BYOK，也不改变学习项。候选在当前详情/revision 内短暂显示，用户切换项目或项目变化后立即失效；
  preview 不是授权，confirm 必须重新读取并验证 source/target 后才提交合并。
- 任意学习项都可显式归档。归档是可逆地停止未来练习：默认学习库和今日队列排除，不能创建新练习，
  但保留内容、来源、标签、排期和既有练习关系；恢复沿用原排期。已归档项从独立服务器筛选查看，不能
  编辑、查重建议或合并，canonical identity 仍占用。
- 分析历史支持搜索、分页、详情、归档、恢复和删除。归档与“待整理／已整理”状态彼此独立，只改变
  默认可见性；删除来源分析不能删除已确认学习项保存的 SourceExample 快照。Web `/history` 只读取
  服务器筛选/游标与完整 AnalysisRecord，并按结果类型语义化显示整体理解、逐句讲解、候选、来源和
  公开模型名称/token 用量；记录、候选、分析单元等 ID，以及 revision、协议类型、Prompt/Schema
  版本只用于路由、关联和并发控制，不能作为用户文案或详情字段。维护成功后重新读取服务器，刷新
  失败也不得把已完成写入误报为失败。
- Web 显式 reanalysis 会警告再次消耗额度并追加新的 AnalysisRecord；StudyCapture 的公开投影选择最新
  关联记录。删除当前分析默认勾选同时删除原始 StudyCapture，用户可取消；取消后自动回退到最新剩余
  分析或 pending，删除非最新旧分析不显示该选项。
- 成功分析、完整练习记录和学习项一直保留到用户主动删除；不做自动清理。未练习项直接 hard-delete；
  已练习项先归档，再在全部引用 session 已安全终态后执行 LearningItemErasure：正文、来源、标签、
  系统属性和排期不可逆清除，只为用户保留的 PracticeSession 留下最小非内容墓碑。练习题、作答、对话
  和反馈是独立记录，需由用户在练习历史另行删除；最后一条引用消失后墓碑也删除。

### 3.5 主动练习

- “今日练习”默认目标为 10 个学习项，用户可修改；服务端按当前时钟和用户时区先选择到期项，再以
  未复习新项补足，浏览器不能自行指定“今天”。
- 句子创作提供中文意图、场景和约束。用户提交后才显示 SourceExample，并获得正确性、自然度和
  改进建议；不显示精确分数。
- 受约束对话每次使用 1–3 个学习项，共 3–5 轮，明确角色、任务和结束条件；中途不打断纠错，结束
  后逐项反馈。
- 用户对每个涉及学习项选择“不会／勉强／掌握”。同一学习项在一次对话中无论出现多少轮只计一次。
- 排期使用公开的 1、3、7、14、30、60 天阶梯：“不会”回到 1 天并清零连续掌握，“勉强”停留，
  “掌握”前进一级，最高保持 60 天。
- 保存题目、用户答案或对话、最终反馈、自评和时间，支持删除单次练习。
- `/practice` 已离线实现今日队列、单项句子创作与 1–3 项受约束对话。开场不计 round；每个 round 是
  用户回复及随后情境角色回复，共 3–5 轮，中途只推进情境、不显示正确性或自然度纠错。用户 turn
  先保存，助手 turn/最终逐项反馈失败后只允许显式重试；完成前不显示 SourceExample。
  `active | awaiting-feedback | completed-but-unrated` 均可刷新恢复，关闭页面不取消服务器会话。
- Phase 23 将题目、句子反馈、对话开场/回复/最终反馈统一为持久 PlatformGeneration：调用模型前先取得
  额度预留并记录 dispatch，输出严格校验后先耐久保存再应用到 PracticeSession。dispatch 后失去 worker
  不透明重领；保守结算后只允许用户显式新 key 重试。完整状态、数据和验收见
  `paid-practice-generation.md`。production 已组合统一 DeepSeek practice adapter；环境/价格/额度非法时
  fail-closed，真实网络与费用行为仍需独立批准验证。
- `/practice/history` 读取服务器保存的全部正式练习会话，并如实区分 active、awaiting-feedback、failed
  与 completed；详情按类型展示造句答案/反馈，或对话计划、开场、轮次、最终逐项反馈和自评。未完成会话
  的逐项反馈和自评必须使用用户可识别的学习项英文文本，不能显示 UUID 等内部资源 ID；服务器只为仍
  保留正文的学习项返回显示文本，已擦除墓碑统一显示“学习项已删除”，不恢复已清除内容。未完成会话
  详情也不显示 session ID；这些 ID 仅供 API 路由、关联和写入证明使用。
  进行中或等待反馈时可查看但不能删除。已完成会话（已评分或未评分）和 failed 终态可经二次确认删除；
  删除只清理该次会话记录，
  不回滚或重算 LearningItem 的排期，也不删除 SourceExample。

### 3.6 单词与外部词典

- Store Extension 的 LocalLexiconEntry 是每个安装独立的正式本机数据，不按账号分区；单词收藏永远先
  本机成功。登录、退出或换号不清除/切换本机词库，Web 编辑不回写本机。
- `CloudWordCopyMode` 默认 enabled；登录后的新本机收藏可异步提交规范词头、精确完整句、语境释义和
  收藏时间，失败不回滚本机且不覆盖 Web notes。关闭只影响后续收藏；历史本机词条只有经数量预览和
  二次确认的显式批量导入才进入 Web。
- Web `/words` 统一浏览、搜索 WordEntry，分页查看不可变 ContextObservation，且只允许编辑可清除的
  notes；headword/canonical identity 与语境快照不在本切片编辑。删除整个词条需二次确认并级联语境，
  但外部词典任务已引用时拒绝删除以保留任务/回执历史。Huayi 不为单词生成复习计划或 ScheduleState。
- 用户可在 `/words` 手动收录规范词头，并选择填写备注、原句、语境释义和来源标题。手动收录只能创建
  `sourceType=manual` 的不可变 ContextObservation；遇到既有规范词头时追加非重复语境，但不覆盖既有
  headword 或 notes。重复语境如实报告未新增，用户仍可通过词条详情确认服务器权威。
- 本机欧路导入和本机欧路/扇贝导出不要求账号；云端 WordEntry 的欧路导入和欧路/扇贝导出则继续由
  Extension 桥接。用户在 Web 或可信 Extension 显式创建一次性云任务；
  云端保存任务、待处理 item、租约、稳定错误和回执，外部词典永远不是权威。同 target/direction 同时
  只有一个未终态任务，失败任务必须显式重试，取消后不再领取新工作。
- 欧路凭据只存在 DeviceVault。欧路导出只发送规范词头和任务创建时快照的可选原句，不发送 notes、
  语境释义、标题或来源；欧路导入按页原子收敛 WordEntry/ContextObservation，不覆盖用户 notes。
- 扇贝只接收词头，最终提交必须由用户在固定页面真实点击；只有页面出现明确成功或部分失败结果才写
  回执。Cloud lease token 不进入 Content Script。
- 用户可以下载一词一行、不可用于完整恢复的 WordListExport，也可以导出不含任何凭据或会话的完整
  AccountDataExport。两者在 UI 和文件内容上必须明确区分。

### 3.7 额度与管理

- Web 与 Extension 的平台分析、结构修复、语义查重、出题、反馈和对话共享每 UTC 自然月默认
  1 美元的平台额度；BYOK 不计入。
- 用户看到统一使用百分比；80% 提醒，100% 后只禁用平台模型。BYOK、浏览、手动录入和已有数据
  继续可用。
- Web `/settings/account` 从服务器读取当前账号的 UTC 月度限额、已结算、活跃预留、剩余、使用百分比
  和提醒状态；没有 grant 时明确显示尚未配置而不伪造余额。页面同时说明 BYOK 不计入平台额度，并可
  读取和更新 IANA 时区、1–100 的每日练习目标，以及三项账号级插件偏好；新设置只影响后续查询、
  采集、收藏或每日队列，不改写已经开始的请求/会话和既有两端数据。
- 同页从 `GET /v1/account` 的单一 owner snapshot 显示规范邮箱、五项偏好、当前有效扩展设备数量和部署
  最低兼容插件版本；配对勾选和各安装的本机 recipient consent 不伪装成账号 consent 字段，平台额度
  仍由独立额度权威返回。
- 管理页支持创建或撤销邀请、停用账号、调整月额度、查看聚合用量和审计事件，不显示用户正文。
- 空 hosted/production 环境的首位 Operator 必须先以唯一 BootstrapInvitation 完成正常邀请注册，再由
  DeploymentBootstrapAuthority 把该邀请最终绑定的唯一账号晋升；不提供公开 bootstrap、任意账号
  角色授予、service-role 登录或虚构管理员。完成后该协议永久封闭，详见
  `first-operator-bootstrap.md`。
- Web `/settings/data` 提供完整 AccountDataExport 与永久删除账号。导出是版本化 NDJSON 私有任务，
  包含五项账号偏好、导出快照时尚未过期的平台 ExtensionQueryGeneration 公共内容、StudyCapture、
  分析、学习项、云端生词和练习，排除凭据/session/内部安全记录、各设备 LocalLexiconEntry 和未提交
  outbox；临时查询仍按原一小时期限删除，导出文件是用户主动创建、最多保留 24 小时的独立私有副本，
  不延长 generation 期限或建立查询历史。私有对象 ready 后设置 24 小时 expiry，每个下载 URL 最长
  15 分钟。删除要求最近认证、输入确认和二次确认，成功响应前撤销
  全部 session，随后由可恢复任务清理导出对象、主库正文和 Auth 身份；它不远程删除各设备本机词库。
  完整交互与边界见 `account-data-rights.md`。

## 4. 页面与交互

Web 主导航固定为：今日练习、待整理、分析、学习库、生词、分析历史、设置；管理员看到独立管理
入口。练习历史归入今日练习，外部词典任务归入生词，账号/设备/数据权利归入设置，并由各区段二级
入口到达，不扩张普通账号一级导航。桌面采用“顶栏 + 左侧导航 + 卡片”，窄屏把导航折叠为顶部选择
或抽屉；完整会话的学习工作台页面复用同一个 WorkspaceShell。data-rights-only、独立运营、公共、认证、
恢复和配对页不提前显示完整学习导航。使用系统字体、珍珠灰/冷白背景、低饱和钢蓝动作色、轻边框和
浅阴影，满足键盘操作、可见焦点、AA 对比度和 reduced-motion。V1 只有这一套皮肤，但全部颜色、圆角、
间距和阴影必须通过语义 token 使用。Token 依赖固定为 primitive → semantic → component，所有生产
CSS 引用必须由单一 registry 闭合；允许 `0`、`auto`、断点、结构尺寸和排版值等明确非主题例外，
不得用例外绕过颜色、间距、圆角或阴影。可执行属性边界与验收见
`web-design-token-contract.md`。

## 5. 明确不做

- 不做追问聊天、聊天树、模型记忆、MCP、语音、发音评分、提醒、排行榜或社交；
- 不做单词 SRS，不替代外部单词软件；
- 不做平台付费购买、公开注册、多租户组织、协作学习、Web 角色管理或管理员正文检索；
- 不支持 Firefox、Edge、Safari、原生移动/桌面 App、PDF/OCR 或 Chrome 内部页面；
- 不做 E2EE、插件端表达/句型学习库、云端与本机词库双向同步或 Classic WordEntry 迁移；
- 不在 V1 实现换肤 UI，也不采用本轮已否决的企业后台原型。

## 6. 发布标准

离线自动化全绿只允许进入隔离验收环境，不能直接进入 production。Cloud V1 必须先完成可重建的本机
验收环境，再完成独立 hosted acceptance；用户需要经历至少一个跨多日自然使用周期，每轮反馈都同步
需求、技术、测试和验收文档，补回归后重新部署。只有 P0/P1 清零、P2 有明确处理结论、最新 macOS/
Windows 候选门通过且用户明确批准进入生产候选，才继续正式域名、生产部署和商店发布。完整拓扑和
退出门见 `user-acceptance-environment.md`。自有根域注册、验收 Web/API 子域和 Resend 验收子域可以在
hosted acceptance 前准备；这里的“才继续”指 production 子域/cutover 和公开发布，不要求把域名采购拖到
用户验收之后。

工程可以按依赖顺序分阶段完成，但只有账号、分析、待整理、学习库、生词、外部词典桥接、两种练习、
额度、导出删除、安全披露和双平台 Chrome 验收全部通过后，才向邀请用户一次性开放完整 V1。
