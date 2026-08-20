# Phase 27 现有实现差距与迁移审计

状态：2026-08-13 文档期只读审计完成；这是实施前历史基线。2026-08-14 的 27A–27G 离线实现状态以
`implementation-plan.md` 和 `docs/project-status.md` 为准。本文保留旧实现与目标的原始对应，防止历史
通过记录被误当成新需求已经完成。

## 1. 审计范围与结论

审计覆盖 `learning-domain`、`cloud-contracts`、`store-domain`、Store Extension、API/bootstrap migration、
Web、离线 browser authority、公开隐私/商店材料和发布审计。Classic 0.13、Native Host 与 wire v7 只做
边界核对，不进入修改范围。

结论：现有 Cloud 基础（身份、RLS、额度、分析生成生命周期、学习库、练习、Web shell、Store BYOK/
DeviceVault/本机词库）可以复用，但查询产物、账号偏好、采集、Web 分析 schema、outbox payload 和词库
所有权存在系统性漂移。不能用兼容 shim 同时保留两个产品答案；Cloud 从未发布，应在 bootstrap 和公共
契约中直接收敛到 Phase 27。

## 2. 冲突矩阵

| 现有实现证据                                                                                                  | 当前问题                                                            | Phase 27 目标                                                                                               | 修改阶段                                                 |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `cloud-contracts/analysis-contracts.ts` 的 start 接受 action、word、web/youtube source，并公开 `import` route | Web 与插件输入/产物混在一个 schema                                  | Web start 仅 manual phrase/sentence/passage；StudyCapture 独立 endpoint；删除 import                        | 27B                                                      |
| `learning-domain/domain-schemas.ts` 允许 WordCandidate、Store result 和 V1 passage 共存于 AnalysisRecord      | compact 结果可被历史权威接受，候选类型过宽                          | AnalysisRecord 只接受 WebDeepAnalysis V2 和 Expression/SentencePattern candidate                            | 27B                                                      |
| `learning-domain/analysis-results.ts` 与 `store-domain/analysis.ts` 只支持 sentence、无 passage               | 插件多句选区被压成 sentence                                         | compact result 增 passage；单词/短语/句子/段落保持 strict 判别                                              | 27B/27D                                                  |
| `store-domain/selection.ts` 以标点/换行/8 词规则判断，`read-selection.ts` 不接收可信边界                      | 无句号完整字幕可能误判 phrase；普通 DOM 结构信号丢失                | 分类器接受可信 SubtitleSentence/Segmenter/semantic block evidence，再落本地规则                             | 27B/27D                                                  |
| `StoreAnalysisStartMessage` 仍携带泛化 `context`，Content 可把相邻 DOM 文本传给 SW/Provider                   | 超过 word/phrase 单句语境或 sentence/passage 精确选区的最小输入边界 | 删除 raw context；只允许 exact selection、word/phrase 的 sentenceContext 与无正文 trusted boundary evidence | 27B/27D                                                  |
| `account-contracts.ts`、`user_profiles`、Web form 只有 timezone/dailyGoal                                     | 三项账号插件偏好不存在且没有 revision                               | 五项 AccountPreferences + 三项 Extension projection；platform/manual/enabled 默认值                         | 27B/27C                                                  |
| pairing approve 只有 deviceLabel，exchange 只返回 token/expiry                                                | 配对不能原子确认偏好，插件也无可信首个快照                          | approve 带三项值+expected revision；exchange 返回 session+偏好                                              | 27B/27C                                                  |
| `analysis-session.ts` 永远调用本机 engine，并在成功后 `captureByok`                                           | 登录平台模式不存在，BYOK 终态被当成上传触发器                       | QueryRouter 在请求开始固定 platform/byok；终态零 analysis import                                            | 27D                                                      |
| `cloud-byok-import-api.ts`、API import route/module                                                           | 上传完整 compact 结果并创建 pendingReview AnalysisRecord            | 删除 route/adapter/use case；proof 迁移到 platform query/capture/word copy                                  | 27B–27F                                                  |
| `submission-outbox.ts`/vault 只保存 `ImportAnalysisRequest`                                                   | 队列资源错误，且 API null 会清正文                                  | strict `study-capture                                                                                       | cloud-word-copy` union；暂时未配置/网络故障 blocked 保留 | 27F |
| Overlay 只有 Web 入口和本机生词按钮                                                                           | 无 manual/automatic capture 状态或 current-card undo                | ResultCard 显示加入/已有/待联网/撤销；ActionCard 不出现学习动作                                             | 27F                                                      |
| migration 无 StudyCapture/ExtensionQueryGeneration，也无偏好列                                                | 无法表达新状态、RLS、唯一性和短期保留                               | 直接修改未发布 bootstrap，新增表/列/index/policy/operation allowlist                                        | 27C/27E                                                  |
| Web `/analysis` 显示 action 与 word，`/app` 只有 AnalysisRecord Inbox                                         | 与固定深度分析和两阶段整理冲突                                      | 无 action/word；StudyInbox 拆 CaptureInbox/ReviewInbox                                                      | 27E                                                      |
| pairing UI 声称上传“完整分析结果”                                                                             | 数据披露与真实目标相反                                              | 分别披露 platform query、StudyCapture、CloudWordCopy 和 BYOK 不上传结果                                     | 27C/27H                                                  |
| 本机 `BrowserLexiconRepository` 已是正式数据，但 Cloud 文案/Options 只突出云任务                              | 本机能力被误写成临时缓存或被云任务替代                              | LocalLexiconEntry 永远本机先写；Options 同时呈现本机与云任务                                                | 27G                                                      |
| 本机 save 只返回 saved/duplicate                                                                              | 无法在本机提交后独立触发 CloudWordCopy，也无法表达不回滚            | SW local save 完成后异步 copy；响应仍以本机成功为准并另投影 copy 状态                                       | 27G                                                      |
| AccountDataExport 六类记录且偏好只有 timezone/dailyGoal                                                       | 缺临时查询、StudyCapture/三项偏好，可能误称包含本机词库             | 八类云端记录；只含 snapshot 时未过期查询且不延长 expiry；明确排除 LocalLexicon/outbox/本机凭据              | 27B/27E/27G                                              |
| Phase 22 fake authority 与 74 条 E2E 验证 Store import→pendingReview                                          | 浏览器绿灯锁定了被废止路径                                          | 替换为 platform temporary、capture→deep analysis、BYOK no-import、local-first word journeys                 | 27H                                                      |
| privacy page/release audit 检查旧上传文案                                                                     | 公开事实会与新数据流冲突                                            | 页面、listing、audit 固定三项偏好和四条数据路径，禁止 old import language                                   | 27H                                                      |

## 3. 可复用边界

以下基础可在严格回归下复用，不为重做而重写：

- ExtensionSessionVault、固定 Extension Origin/client-version proof、PKCE pairing 状态机和设备撤销；
- DeviceVault、BYOK OpenAI/DeepSeek adapters、compact ResultCard streaming、Content 无 token/Key 边界；
- 本机加密 Lexicon repository、欧路/扇贝本机与云任务 adapters；
- API owner transaction、forced RLS、signed cursor、revision/idempotency、quota reservation/ledger、
  durable dispatch/fencing、DeepSeek adapter；
- Web Cookie/Origin/CSRF adapters、App shell、分析历史、学习库、练习、设备和数据权利页面；
- SubmissionOutbox 的 AES-GCM、20 条/5 MiB/7 天、升级阻塞、alarm 和脱敏 Popup 投影机制。

复用的条件是 public schema 和产品文案先变成新含义；不得给旧 `analysis-import` 增加隐藏兼容分支。

## 4. 依赖顺序与 RED 入口

### 27B：领域与契约

先写失败测试，要求：

1. AccountPreferences 五项 strict 资源、revision headers、三项 Extension snapshot、pairing 原子 request；
2. WebDeepAnalysis V2 与 compact result 互斥，Web 拒绝 word/action/WordCandidate/Store result；phrase 固定
   `analysisUnitId=u1`，sentence/passage 使用稳定 `u1..u40` 与 `unitCount`，不再暴露 sentenceId；
3. StudyCapture、ExtensionQueryGeneration、CloudWordCopy 与新 routes；
4. SelectionKind passage 与可信边界 evidence；
5. 删除 `importAnalysisRequestSchema`/`analysisHttpRoutes.import` 后编译失败精确指出全部旧调用者。

公共包 GREEN 后按 `cloud-contracts → store-domain → API/Web/Store` 顺序构建，禁止 source alias 绕过公开
包产物。

### 27C：数据库、偏好与配对

先让 migration/PGlite 因缺列、表、RLS、唯一索引和 operation allowlist 失败。最小实现直接更新未发布
`0001`；开发数据库重建，不把 bootstrap 重放当升级。偏好和 pairing approval 必须在同一 owner transaction
以一个 revision 提交，revision conflict 不创建 session。

### 27D：插件模型路由

先让 Store tests 证明当前总走 BYOK、无 passage、无缓存和无 fallback guard。实现小而深的 QueryRouter；
platform adapter 与 BYOK engine 返回同一 compact event/result。mode 在 start 固定，任何错误都不进入另一
adapter。ExtensionQueryGeneration 使用服务端 durable-before-dispatch 与一小时清理。

### 27E：StudyCapture 与 Web

先让 API/Web 因资源/页面不存在 RED。Postgres 测并发 exact upsert、hash collision、同 key replay、
occurrence revision、linked manual analysis、undo/delete/reanalysis。Web 用两个 tab 和独立 generation guard；
V2 detail 不用 raw HTML，GeneratedExample 明确标注且不提供收藏动作。

### 27F：Store capture/outbox

先把旧 full-result capture 测试改为必须零 import，再要求 manual/automatic/undo 状态。Vault schema version
升级并只接受两种 item；旧开发 envelope 安全清除并给固定提示。API adapter null/暂不可用时保持 blocked，
只有账号/同意/session 安全边界变化才清正文。

### 27G：本机生词与云端副本

先证明本机 save 在 copy 失败时仍成功、换号不清本机、关闭模式 future-only。CloudWordCopy 不覆盖 Web
notes；显式批量导入先读本机 count、二次确认，再以有界批次/稳定 key 提交。Options 同时呈现本机欧路/
扇贝能力和 Web 任务，不能复用一个开关表达两套 authority。

### 27H：联合验收与发布材料

替换旧 Store import browser journey；重新基线 privacy/listing/release audit 和 AccountDataExport。完整门禁
绿后仍只声称离线实现完成；真实 Provider、部署、Store ID、双平台 Chrome、第三方词典和商店上传分别
保持待批准/待验证。

## 5. 删除与兼容策略

- Cloud V1 从未发布，没有真实 StudyCapture、analysis import 或 CloudWordCopy 用户数据；不做双写、
  backfill 或旧 API 兼容。
- bootstrap `0001` 可修改，但每个 SQL 约束仍以空库 migration、PGlite 和 RLS fixture 验证；已有开发库
  必须重建。
- Store 本机 Lexicon 是既有正式数据，任何 schema 改动必须保持可读或提供显式本机迁移；账号状态绝不
  作为删除本机数据的触发器。
- 旧 encrypted analysis-import outbox 不是用户正式数据，检测到时只在未发布开发态清除并显示固定迁移
  状态；不能尝试把它翻译成 StudyCapture 或 AnalysisRecord。
- Classic/Host 不导入 Cloud package，也不随 Cloud 版本或 migration 改动。

## 6. 文档审查门槛

开始 27B 前必须满足：

1. 产品、领域语言、架构、数据、API、安全、测试、隐私、listing、release checklist 和本审计对同一
   数据路径没有相反答案；
2. 旧 Phase 22–26 文档明确标为历史证据或被 Phase 27 修订；
3. 每个新增表/资源都有 owner、生命周期、幂等、删除、导出、保留和日志边界；
4. 每个付费调用都有 durable-before-dispatch、额度、无 fallback 和失败恢复语义；
5. 每个本机资源都明确账号切换、清理和云端副本关系；
6. 文档格式、链接、指令检查和 diff 检查通过。

通过上述门槛只授权进入 TDD，不代表业务实现或发布已经完成。
