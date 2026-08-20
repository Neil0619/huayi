# 语见 Cloud V1 测试与验收

## 1. 原则

- 所有行为先写失败测试，确认失败原因与预期一致，再实现最小代码并重构。
- 领域与用例通过公开 interface 验证结果，不断言内部 repository 调用次数。
- 默认门禁完全离线、无秘密，不访问真实 DeepSeek、Supabase Cloud、Google、邮件、Eudic、Shanbay
  或 Chrome Web Store。
- 数据库/RLS 使用临时本地 Postgres/Supabase；远程依赖使用严格 fake adapter。真实服务和费用 smoke
  必须逐项取得知情批准。
- shared/Extension 变更必须通过 macOS 与 Windows CI；真实 OS/Chrome 验证不能被 jsdom 或 fake
  `chrome.*` 替代。
- 根 format/lint 检查产品源码、脚本、配置、文档、manifest 与 lockfile；只精确排除不进入 Huayi
  workspace、运行时或发布包的 `.agents/skills/**` 代理辅助资产，不排除 `.agents/**`。

## 2. 自动测试分层

### `packages/learning-domain`

- Expression/SentencePattern 判别联合、字段长度、未知字段与槽位引用；
- Unicode/空白/引号规范化、同类型精确键和跨类型不合并；
- 候选确认：WebDeepAnalysis 只允许 Expression/SentencePattern 创建 LearningItem；来源快照、合并追加且
  不覆盖用户核心字段；WordEntry 通过独立 words 流程测试；
- SelectionKind 覆盖可信 SubtitleSentence、普通 DOM 句界、无标点短台词、phrase 与跨句 passage；
- StudyCapture NFKC/引号/空白规范化、大小写/标点保留、kind 隔离和 hash collision fail closed；
- 固定排期：新项、不会、勉强、掌握、60 天上限和用户时区边界；
- 一次对话内同一 item 只计一次；重复自评结果幂等；
- micro-USD 价格计算、缓存/非缓存输入、输出、上限与整数舍入。

### `packages/cloud-contracts`

- 每个请求、响应、SSE 事件和错误码的成功样例；
- 未知字段、越界字符/数组、错误 union、非法 cursor/revision/idempotency key 拒绝；
- 客户端契约兼容快照：`/v1` patch 版本可新增 optional 字段，不改变已有含义；
- 证明契约不接受 userId、角色、凭据、endpoint、Header、reasoning 或任意 URL。

### `apps/api` 单元与集成

- 邀请：过期、撤销、重放、并发 claim 仅一人成功、Auth/finalization 失败可恢复、孤立身份不可登录并
  可清理；
- 登录方式 fence：密码/Google 邀请只登记实际 method；普通 provider 成功但 method 缺失时零 session；
  既有 profile 邀请失败且不消费；active/disabled/deleting 为 full/data-rights/reject；业务 role 不能直接
  写 method，forced RLS、账号导出与 actual-bundle 统一 401/零 Cookie 均有回归；
- 普通 Google 登录：identity-owned strict 空 request，JSON/form 分支、固定 redirect、15 分钟 login flow、
  callback no-store/no-referrer；actual Web production bundle 覆盖 active→`/app`、disabled→
  `/settings/data`、未登记 google method→统一失败/零 Cookie，并证明 flow/code/Provider state/session 不进入
  Web URL、Storage 或公开 snapshot。Fresh RED→GREEN 后 contracts 6/6、Cloud foundation HTTP 11/11、
  专项 Playwright 3/3 与完整离线 Playwright 108/108 通过。详见
  `google-authentication-acceptance.md`；
- 密码近期重认证：strict `{password}`、Cookie/Origin/CSRF、password method、服务端规范邮箱、错误密码/
  Provider 错 user/限速均在 Provider 或 session 写边界失败关闭；内存与 PGlite 证明新 encrypted refresh、
  Cookie/CSRF/`reauthenticated_at` 单次原子轮换，旧 session 失效且并发/重放不产生第二条 session；
- Google 近期重认证：strict `{}` start、固定 continuePath、path-scoped intent Cookie、缺失/错误 session、
  flow 15 分钟、continue 单次、provider state 顺序、callback purpose/session/user 匹配、错 user 与 callback
  replay；PGlite 证明错 CSRF 零 flow、错 user 只消费 flow且旧 session 保留、同 user 原子轮换 encrypted
  refresh/session/CSRF；
- recent-auth provenance：普通 password/Google 登录与邀请 session 的 method 固定 null；两种显式 reauth
  分别写 password/google。link 前同时测试 15 分钟 freshness 与 method，证明刚登录、错误来源、过期来源
  均零 provider/method/session 写；
- Google manual link lease：同一 session 只能有一个 open flow；claimed/refreshed/provider-started/completed
  每阶段重放、进程中断和过期恢复；refreshed state 必须先持久化再 linkIdentity，旧 generation 不并发消费；
  callback 错 purpose/session/user、并发 callback 与 method 唯一冲突均零部分写；成功撤销除当前新 session
  外全部 Web/Extension session。当前 HTTP 8/8、深模块 1/1 与专项 PGlite 1/1 已覆盖主成功链、普通登录
  provenance 拒绝、30 秒租约竞争/过期接管、错误 lease、refreshed 外部失败恢复、callback 错 user、全局
  撤销和 replay；
- Password manual link：Google provenance/15 分钟、strict password、单 open flow/30 秒 lease、refresh
  generation 只消费一次、refreshed 后 Provider 失败重试、provider-updated 后数据库失败重试、错 provider
  user、secure-password-change/weak-password 失败、重复绑定和 replay；任何 repository/state/log fixture 均不
  含明文 password，成功才新增 method并撤销其他 Web/Extension session；
- already-linked：内存与 PGlite 两种 adapter 都必须在 active/full session+Origin+CSRF+正确 recent-auth
  provenance 成功后返回 409
  `sign_in_method_already_linked`，且 flow/Provider/session/extension 状态零变化；无效 session 仍为统一 401。
  普通登录/错误 provenance 与无效 session 仍为统一 401。HTTP 固定 no-store/error envelope，Web stale
  view 收到 409 后只重读 canonical method list并显示已绑定；
- PasswordRecovery：strict start/confirm/callback/session/complete contracts；unknown/Google-only/disabled/deleting/
  eligible 的 start 统一 202/no-store，非 eligible 零 flow/dispatch，eligible 公开请求也零 Provider；邮件
  worker 必须先耐久 dispatch，回执不明确不得自动重发。Supabase fake 固定 PKCE begin→exchange→update
  与同 owner user/email。内存/PGlite 覆盖独立状态机、30/15 分钟 expiry、30 秒 lease、callback/complete
  replay、provider-updated 恢复、forced RLS、全部 Huayi session 撤销和单条安全通知。Web actual
  bundle 覆盖登录入口、统一 start、用户显式 fake mail、inert confirm→显式 callback、一次改密、旧 session
  失效与显式重登；新浏览器可消费最新邮件，过期/旧邮件/重复链接统一失败且 DOM/Storage/snapshot
  零秘密。详见 `password-recovery.md`；R1 strict contracts 5/5、Supabase recovery 与既有 auth adapter
  回归 8/8，R2 深模块+内存状态机 11/11、当时 migration+PGlite adapter 19/19；R3-A HTTP 8/8、R3-B
  通知 worker/adapter 6/6、notification PGlite 1/1，当前完整 contracts 62/62、API 102 files、360/360，API
  typecheck/build 与目标 lint/format 通过。R4 Web 单元 17/17、production-bundle fake-mail Playwright 1/1，
  覆盖另一浏览器的最新邮件、旧邮件/replay、inert confirm、purpose Cookie、全 session 撤销、旧/新密码
  重登与零秘密公开证据。route-fulfilled fake HTTPS 的 opaque-origin 限制只在邮件表单上下文使用
  `bypassCSP`，生产 CSP header 与 exact HTML 仍由浏览器/HTTP 单元分别断言。真实 sender/CRON/告警、
  Supabase/邮件/部署与双平台 Chrome 仍 pending。R5 新鲜证据为 Web 184/184、完整 Playwright 105/105、
  `check:instructions`、workspace typecheck/build、`pnpm test`、目标 ESLint/Prettier 与 diff check 通过；
  当时根级 format/lint 仍分别被既有 70 个文件与 `.agents/skills/**` 143 条错误阻塞，后由 Phase 29
  关闭；
- Google start：严格 JSON 兼容与原生表单 302 都覆盖；表单缺失、重复、额外、过长/非法字段和错误
  Content-Type 必须在 provider 调用前失败，序列化调用记录不包含 claim ticket；
- Web 会话：Cookie 属性、CSRF、Origin、轮换、登出、账号停用与重新认证；
- Extension：PKCE、错误 verifier、码猜测限速、过期、并发 exchange、设备撤销；
- 多租户：对每张用户表验证账户 A 不能通过 API 或 RLS 读写账户 B，并证明客户端 userId 不能设置
  事务账号上下文、业务连接没有 BYPASSRLS；
- 幂等/revision：相同请求返回相同结果，不同 payload 冲突，过期编辑无副作用；
- 分析历史：默认/归档及五类筛选、字面 ILIKE 转义、同时间戳 ID 降序、签名 cursor 篡改、详情同事务
  快照；process/archive/restore/delete 的 header/body revision、一致重放、冲突回滚和跨租户隔离；
- 删除分析：未确认候选删除，已复制 SourceExample 与 LearningItem 保留且 analysis 引用设空；业务角色
  不得直接执行内部 SECURITY DEFINER 序列化函数绕过 RLS；
- 分析：输入限制、确定性分句、SSE 顺序、取消、断线查询、一次结构修复、无部分落库；两个模块/数据库
  adapter 共享请求声明时只调用一次模型，同 key 不同 payload 在 SSE 前冲突，terminal 跨实例重放；
- 分析恢复：4 分钟租约短于 5 分钟预留；过期事务产生严格失败事件和唯一保守账本，陈旧 worker 在
  写记录/结算前被拒绝，成功/失败事务回滚不留下半终态，跨租户不可见；
- ExtensionQueryGeneration：Extension proof、输入最小化、持久化/预留/dispatch 顺序、同 key 重放与
  different hash 冲突、无 platform/BYOK fallback、一小时清理后正文/结果消失且 ledger 保留；
  单测明确断言 durable `dispatched_at` 先于 fake Provider，mark 失败零 Provider。PGlite 分别覆盖 expired
  undispatched 释放且零 ledger、expired dispatched 预留上限保守结算、并发 cleanup `SKIP LOCKED` 不重复
  ledger、terminal 到期硬删、running 未安全终态前不被删。Cron 路由覆盖缺失/错误 secret 401、严格
  bounded 计数且无正文/owner/结果字段；
- StudyCapture：并发 exact upsert 只一行，同 key 不增 count、新 key 增一次、手动 AnalysisRecord 自动
  linked、kind correction exact conflict、stale/current undo、首次分析失败回 pending、reanalysis 期间
  保持 analyzed 且失败保留旧 latest/成功 append-only；
- capture/analysis 删除：最新分析默认删除 capture/可取消、非最新拒绝该选项、保留时回退剩余最新或
  pending，SourceExample/LearningItem 不变；
- prompt injection：正文伪造系统指令、HTML、额外候选、错误 analysisUnitId、超长数组均被普通处理或
  拒绝；phrase 固定 u1，sentence/passage 的 unitCount、u1..u40 与 Candidate/SourceExample 引用一致；
- 配额：并发 reservation、不超支、失败仍结算、缺失 usage 保守结算、UTC 月切换、价格版本、kill
  switch、管理员覆盖；公开 quota route 另覆盖 Web Cookie-only、无 grant、strict projection、used-only
  percent、committed exhausted 与 no-store；
- DeepSeek V4 价格与 usage：覆盖 2026-08-16T16:00:00Z 生效点、两个 UTC 半开 peak 窗口的起止边界、
  legacy/off-peak/peak 三套精确 micro-USD、三个 UUID 唯一性、数据库 mismatch 零 Provider、peak
  reservation、begin/reclaim 跨窗后按真实 dispatch 选价、settlement 跨窗固定 UUID，以及合法
  `completion_tokens_details.reasoning_tokens` 兼容但不进入公开 usage；完整矩阵见
  `deepseek-v4-billing.md`；

Phase 34 Fresh RED 覆盖 schedule 缺失、合法 reasoning details 被拒绝、production dispatch 跨窗错价和
导出价格常量可变；GREEN focused 为 7 files / 55 tests，API full 为 110 files / 407 tests。Root 修复
Phase 33 权限口径的过期发布材料断言后，当前工作树完整 `pnpm test` 为 118/118 脚本、445 个 Vitest
文件（2,741 passed / 12 skipped），随后 `pnpm verify:macos` 退出 0，并覆盖 Store coverage 97 files /
480 tests、Playwright 109/109、全 workspace typecheck/build、format/lint、instructions/architecture、
development-blocked、Store release 与 production dependency audit。该证据仍不替代 Windows、真实
DeepSeek、生产价格行、部署、安装或 Chrome。

- 学习库：Expression/SentencePattern 批量确认原子性、精确重复、create/merge、同 key 重放、旧 revision、
  跨租户与后项失败整批回滚；merge 保留核心字段并递增 revision，可信 SourceExample 不会被客户端
  伪造；语义重复建议 S1–S4 已证明 strict key/no-store/error-status、固定 DeepSeek Provider、空候选零
  调用、paid module 顺序、forced-RLS/零 business 直访、durable replay/fencing、原子 ledger/settlement、
  terminal replay 先于新价格预检、新 generation 的 price/kill/quota-before-fetch、dispatch 前释放重领、
  dispatch 后保守失败、≤100 cleanup、production composition 与 actual bundle；
- 学习库只读：strict list/detail view 包含 LearningItem、ScheduleState 与最近 completed practice 的最小
  摘要；PGlite 证明 type/tag/systemAttribute/query/due/new 在 tenant SQL 内过滤、服务器时间决定 due、
  跨账号详情为 404，签名 cursor 篡改失败。Web component 覆盖 loading/empty/error/retry、筛选、分页、
  详情焦点/live region 与窄屏单列；HTTP adapter 只调用固定 Cookie GET，不发送 owner；
- 学习库手动创建：strict request/header/response、Cookie+Origin+CSRF、同 key 重放、不同 body 冲突、
  精确重复、level -1 排期与标签复用；Web 覆盖两种类型、显式句型槽位、duplicate 保留草稿、成功后
  server list/detail 重读、详情焦点和 live announcement；
- 手动生词 upsert：契约拒绝客户端 owner/ID/canonical/sourceType/observedAt 和空语境；模块固定服务器
  manual/now/ID 与稳定内容 hash。PGlite 覆盖新词、既有词保留 notes、语境 created/duplicate/omitted、
  revision 只在真实追加时推进、不同 key 唯一键收敛、同 key replay/different-body conflict 与跨租户
  隔离。Web 覆盖可选字段、提交中禁用、成功后 list/detail 重读、重复语境诚实提示、失败保留草稿、
  焦点/live region、320px 单列与 reduced-motion；
- 学习库维护：strict patch/delete/suggestion/preview/confirm 与固定 route；PGlite 覆盖 canonical 更新精确
  重复、标签复用、未练习 hard-delete 及删除后 snapshot replay/different-hash conflict；
  merge 覆盖 owner/type/双 revision、source 未练习+level -1、target schedule 保留、metadata/source/tag
  去重与 source 删除后 replay。fake model 越权 ID 被丢弃，production model fail-closed。Web 覆盖类型
  专属编辑、duplicate/conflict 草稿保留、二次删除确认焦点、preview/explicit confirm、迟到建议抑制、
  live region、窄屏和 reduced-motion；真实登录/部署 journey 仍待。
- 学习项归档：strict archivedAt/list filter/archive/restore 契约，已练习项目可归档但所有 practice rows 与
  schedule 保留，active/archived cursor 隔离，queue/direct session create 排除，既有 session 继续完成，
  archived patch/suggest/merge 阻止，restore 沿用排期，账号导出包含状态；完整矩阵见
  `learning-item-archive.md`。离线 actual Web bundle 另覆盖二次确认归档、服务器已归档筛选、恢复及写证明；
  真实部署多连接竞争、真实登录和支持平台 Chrome 不由 fake authority 代替；
- 学习项抹除：strict `deletionKind`、`learningItemDeletedAt` 与稳定错误；PGlite 覆盖必须先归档、非终态/
  未自评/lease 阻断、安全终态内容清除、identity 重建、练习历史不变、旧 start 幂等重放、最后引用删除
  清墓碑和 export 排除墓碑。Web/actual bundle 覆盖归档→独立不可逆确认→抹除→历史删除；完整矩阵见
  `learning-item-erasure.md`；
- 练习：题目、答案延迟揭示、对话 3–5 轮、中途无纠错、最终反馈、排期原子推进；
- 最小句子练习：服务器时钟+profile timezone 换日、due-first created/id 稳定顺序、新项补 dailyGoal、
  active account/tenant 隔离；答案先持久化、awaiting-feedback 占 active、模型失败保留答案、显式 retry、
  lease 活跃抑制/过期接管/旧 token fencing；反馈后才能 rating，同 rating 重放、不同 rating 冲突且
  schedule 只推进一次。Web 覆盖 loading/empty/error/retry、丢失提交响应后重读权威、三种未完成状态恢复、
  未落库时保留本地草稿、来源延迟显示、feedback focus/live region 和窄屏。
- 平台练习生成：五类 Provider 调用都必须先有领域 claim、`practice_generation_tasks` 与 quota reservation；
  fake Provider 断言 durable dispatch mark 早于 HTTP。PGlite 覆盖 claimed/reserved 安全接管、dispatched
  过期保守结算且零透明 retry、ready 零调用 replay、旧 token fencing、task output 与 UsageLedger 同事务、
  apply 与 output 清除同事务，以及分析/练习共享每账号单一 active reservation。
- Provider adapter 覆盖固定 DeepSeek endpoint/model、credentials omit、redirect error、90 秒预算、strict
  五类 output、item alias 重绑、一回结构修复、两次实际调用分别计费、reasoning/原始错误丢弃。production
  composition 缺价格、模型或 quota 配置时必须 fail closed；全部默认测试离线。
- 账号偏好：五项 strict Web projection、三项 Extension projection、platform/manual/enabled defaults、
  revision/If-Match/idempotency、pairing 原子选择与 exchange snapshot；PGlite forced RLS/cross-owner，Web
  草稿冲突，Store session-bound cache/断开清理和无逐设备 override；DeviceDisconnect 另覆盖 singular
  self-revoke、旧版本仍可退出、统一 204、远端先于本机清理、网络失败零本机变化和其他设备保持有效，
  完整矩阵见 `extension-session-disconnect.md`。
- 受约束对话：strict 1–3 item/turn/retry/finish/rating contracts；开场与 3–5 round 状态机；user turn
  先落库；start/assistant/final lease 的活跃抑制、expired takeover 与 stale worker fencing；逐项 feedback
  全覆盖；多项 rating 同事务推进；pending start 不公开占位 prompt。Web 选择、pending 显式重试、
  丢失 turn 响应后重读且按落库事实保留/清空草稿、完成前隐藏来源、focus/live、narrow/reduced-motion。
  默认 fake fetch，不访问真实模型；production composition 的 health/路由测试也不得触网。

手动 upsert 验收标准：不能伪造非 manual 来源或客户端时间；重复请求不能覆盖用户 notes 或制造重复
语境；严格服务器响应后页面必须重新读取权威，刷新失败需区分“写入已完成”与“刷新失败”；全受影响
contract/API/Web 测试、PGlite migration 集成、typecheck/build、ESLint/Prettier、architecture/diff 均通过。

- 练习历史：strict list/detail/delete 与固定 route，null completion 和 `(completedAt,id)` 签名游标、跨资源
  cursor 篡改、status/type 的 tenant SQL 筛选、造句/对话完整公开投影和跨租户 404。PGlite 覆盖 active
  拒删、completed rated/unrated 与 failed 删除、删除后同 key snapshot replay/different-hash conflict，并证明
  LearningItem、ScheduleState 与 SourceExample 不变。Web 覆盖 loading/empty/error/retry、筛选/分页、
  详情焦点、两步删除、失败保留详情、迟到详情抑制、live region、窄屏与 reduced-motion。actual bundle
  另须从生产 `/practice/history` 入口覆盖 dialogue/completed 筛选、完整结构化详情、确认焦点、有效写证明、
  删除后 server reread 空态，并返回 `/practice` 证明两个 LearningItem 与 ScheduleState 仍可读取；fixture、
  私密字段与 390px 验收见 `practice-history-acceptance.md`。
- 生词库：strict core/list/detail/context-page/PATCH/DELETE 与固定 route，word/context HMAC 上下文隔离和
  context word-ID 绑定；PGlite 覆盖 normalized literal wildcard、createdAt/id 与 observedAt/id 稳定分页、
  forced RLS/cross-owner 404、notes clear/revision/replay、external task 引用拒删、无引用 contexts cascade、
  post-delete snapshot replay/different-hash conflict。Web 覆盖 loading/empty/error/retry、搜索/分页、语境、
  notes 冲突保留草稿、两步删除焦点、成功 server reread、迟到详情抑制、live/narrow/reduced-motion。
- 外部词典：strict job/list/detail/lease/receipt/retry/cancel union 与固定路由；PGlite 覆盖 export snapshot、
  同类未终态任务收敛、nonce 重放、活跃 lease 抑制、过期重领、新 token fencing、取消后 export 迟到
  回执、取消后 import 不落词、部分失败/显式 retry。Eudic page transaction 覆盖同词 notes 保留、语境
  hash 去重、cursor/第 51 页不完整终态与 response replay；Store Eudic client 必须用自身固定 10 秒
  deadline 覆盖默认永不超时的 alarm/bridge signal，并验证 caller abort、fetch abort、稳定 `timeout` 与零
  自动重试；Shanbay 覆盖本机别名、可信点击和明确页面结果。完整矩阵与分阶段验收见
  `external-wordbooks.md`；
- 账号导出与删除：快照一致、不含秘密、先撤销 session、失败恢复和 24 小时任务状态。

### 2.1 发布前 fake model/mail/third-party 分支矩阵

“成功、失败、取消、超时、额度”按能力是否定义分别验收，不能要求没有额度概念的邮件或人工 Shanbay
页面制造伪额度：

| 能力                                                          | 必须覆盖的离线分支                                                                                                                                         |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| platform DeepSeek analysis/ExtensionQuery/suggestion/practice | strict success、HTTP/结构/transport failure、provider deadline、billed failure；新 generation 的 kill/quota-before-fetch、durable dispatch、replay/fencing |
| Store BYOK                                                    | OpenAI/DeepSeek success、HTTP/结构/stream stall/overall timeout、caller cancel、零自动 fallback；platform quota 不进入本机 Provider                        |
| recovery fake mail                                            | 固定正文 success、sender failure/backoff、旧 flow invalidation、latest-only callback；没有模型额度概念                                                     |
| Eudic                                                         | fixed endpoint success、auth/rate/network/invalid failure、10 秒内部 timeout、caller cancel、failed-only explicit retry、job cancel/late receipt           |
| Shanbay                                                       | exact sender、success/partial failure/reject、用户取消、lease expiry/late receipt；Huayi 不自动提交第三方请求，因此没有 Provider HTTP timeout/quota        |

Phase 37-A 范围审计必须先复用现有覆盖，只对真实缺口补测试。当前实现前审查确认缺口为：Store Eudic
默认调用没有内部 deadline；ExtensionQuery quota-before-provider 没有直接 module 回归；ExtensionQuery
timeout 配置上限和三个非 analysis DeepSeek adapter 的实际 abort 没有各自回归。

### `apps/web`

- React 组件测试覆盖键盘、焦点、错误、空态、loading、窄屏和 reduced-motion；
- 邀请/认证组件测试覆盖 StrictMode 下单次 claim、失败重试、成功清除地址栏、内存 claim ticket、
  固定原生 Google POST、邮箱验证等待和密码登录；DOM/浏览器存储不回显或持久化邀请材料，provider
  未返回严格成功前不得伪造登录；identity adapter 另证明固定 HTTPS origin、严格响应和 Cookie 边界；
- 待整理 focused component 测试使用注入 fake `InboxApi`，覆盖列表 loading/empty/error、详情、字段编辑、
  勾选批量确认、nothing-to-save 后焦点交接，以及精确重复时不丢草稿；adapter 测试另证明 CSRF、
  幂等/revision header 和稳定错误码不会在 UI seam 丢失；
- StudyInbox 覆盖 CaptureInbox/ReviewInbox 两个资源 tab；capture 覆盖 kind/title/context、显式分析、失败
  重试、reanalysis 费用警告、pending 二次删除，以及 analysis 删除默认勾选/取消/非最新关系；
- 分析历史 component 测试覆盖真实服务器筛选形状、游标分页、完整结构化详情、归档与 reviewState 独立、
  nothing-to-save、归档/恢复、二次确认删除、mutation 后 server reread、写入成功但刷新失败的诚实状态，
  以及迟到 list/detail/action 抑制、焦点、loading/empty/error/retry；adapter 回归继续证明 Cookie、CSRF、
  Idempotency-Key 与 If-Match。actual bundle 另须从 production `/history` 覆盖 StudyCapture-linked record 的
  五类筛选子集、结构化详情、process→archive→restore 的 revision 链、默认勾选 capture 的两步删除、
  server reread 空态、390px 与公开 snapshot 脱敏；完整矩阵见 `analysis-history-acceptance.md`。
- 设备页 component 测试覆盖 loading/empty/error/retry、严格元数据、二次确认、确认焦点、撤销成功与
  失败保留；identity adapter 证明 GET 带 Cookie、DELETE 带 Cookie+CSRF 且非法 ID 不发请求。API 与
  embedded Postgres 测试证明跨账号撤销不生效，owner 撤销后列表立即移除；
- 账号额度页 component 测试覆盖 loading、0 grant 空配置、错误重试、UTC 周期、金额/百分比、80% warning、
  active reservation exhausted、BYOK 排除、live/focus 与响应式/reduced-motion；identity adapter 证明固定
  `/v1/quota` Cookie GET 和未知字段失败关闭；
- 账号登录方式面板覆盖 password-only/Google-only/canonical 双 method、当前密码与新密码的原生
  autocomplete、错误保留输入但 DOM 状态不回显、password reauth 后新 CSRF 才能开始 Google link，以及
  password link 后重新 bootstrap Cookie/CSRF 并服务器重读 method；actual bundle 分别走两种 Google
  provider callback 与 production identity adapter，公开 snapshot/DOM 不含 password、token、provider
  subject 或 flow material；stale password-link actual bundle 还必须在正确 recent-auth 后接收 409、重读
  canonical method list、清除密码且不把冲突误报成认证失败；
- 页面集成使用 fake API/SSE，验证 preview 不可收藏、completed 后进入正式记录；
- Web 粘贴分析用 fake AsyncIterable 覆盖 strict manual phrase/sentence/passage、无 action/word、
  2,000/500/1,000 字符边界、started 与
  preview live region、completed 到既有 Inbox 的交接、严格 failed 文案、保留输入的新 key 重试、
  AbortSignal 取消与迟到 terminal 抑制。started-only 流必须查询 owner-scoped status；running 不显示
  假完成也不启用重复提交。窄屏为单列，沿用全局可见焦点与 reduced-motion 契约；
- Playwright 覆盖邀请注册、登录、分析、待整理、编辑/批量确认、学习库、语义建议→预览→显式确认→
  server reread、两种练习、生词、归档恢复、配额耗尽、设备撤销、导出和删号；
- landmark、label、dialog、aria-live 与焦点恢复已有组件/浏览器证据；AA token 自动检查现按 WCAG sRGB
  公式计算 normal text 对全部浅色 surface≥4.5:1、focus ring≥3:1，并解析真实 var/alpha 合成。Phase 28
  actual production bundle 另证明 suggestion 后 item 数不变、preview 不写入、confirm 后 source 才删除，
  再以 target GET 读取服务器权威；公开 snapshot/Web Storage 不含正文、prompt、raw output、reservation
  或 task。该 fake authority 组合证据不替代真实 DeepSeek、部署或目标平台 Chrome。

### `apps/store-extension`

- Service Worker 单元测试覆盖 token/BYOK/欧路凭据永不进入 Content Script；
- platform query、StudyCapture、CloudWordCopy 与 external wordbook adapters 共享 strict session-header
  module，测试固定
  Authorization/client-version、非法 token/version fail-before-fetch；API 测试固定 Extension Origin、
  数字版本比较、426 upgrade、CORS allowlist 和 token repository 不被错误 proof 调用；
- 消息严格拒绝 URL、页面标题、Header、token、userId、endpoint、泛化 raw context 和未知 sender；只
  允许精确选区、word/phrase 的一条 sentenceContext 与无正文 trusted boundary evidence，来源从可信
  sender 与页面状态派生；
- signed-out=BYOK；signed-in 按账号缓存 platform/byok，query start 固定 mode，设置变化只影响下一请求；
  quota/network/platform/key/provider 错误全部零自动 fallback，平台/BYOK 结果使用同一 compact UI；
- 每次已关联 query/StudyCapture/CloudWordCopy 前有界同步偏好；API 可达必须使用最新 revision，API
  不可达仅允许有效 session 绑定缓存，cached BYOK 可离线、cached platform 失败关闭；
- BYOK terminal 零 analysis import。SubmissionOutbox 只接受 StudyCapture/CloudWordCopy strict union，覆盖
  20 条/5 MiB/7 天、稳定幂等重试、current-card queued remove、网络/API/版本 blocked 保留、撤回同意/
  断开/过期/换 session 清除；blocked current-card remove 必须为剩余 item 保留版本阻塞；旧
  analysis-import 与 StudyCapture-only envelope 只在未发布迁移中清除；
- SubmissionOutbox adapter 暂缺回归必须在有效 session + `allowUpload=true` 下分别覆盖：`enqueue` 不清
  既有密文且不新增无法提交的意图，`process` 与 `status` 都不清队列并稳定返回带 count/oldest 的
  `not-configured`；handler/Popup 显示“仍加密保存在本机”、禁用 retry、允许二次确认 clear，且不会安排
  alarm。`api=null` enqueue 仍先执行七天裁剪；同版本 426 阻塞的 process 仍先校验 session。对照测试
  继续证明 consent 撤回、session 缺失/过期、鉴权失败、disconnect/换号仍清账号队列；
- automatic capture 只在 sentence/passage query start，manual 只在 phrase/sentence/passage ResultCard；
  同 CardSession mode switch 不重复，created 有 undo、existing 无 undo、关闭后不恢复、stale revision 不误删；
- Phase 27 current-card StudyCapture 与固定 Web 入口纳入页面 bundle 后，Content Script/YouTube isolated 的
  经审查预算分别为 55 KiB/72 KiB；仍必须断言不包含 Zod、Provider 或 Service Worker 模块；
- LocalLexiconEntry 始终先写；CloudWordCopy 失败不回滚，关闭偏好只影响新收藏，账号切换不清本机词库；
  显式本机批量导入预览词数+语境数、确认时重验 snapshot、一次二次确认、100 词/1,000 语境自动分批，
  覆盖零语境、多语境、欧路无释义语境、稳定 key 重试、单条 copy→batch 跨路径去重、notes 不覆盖；
  加密导入任务与 SubmissionOutbox 分离，断开/换号/失效/撤回同意清正文，本机与云端外部词典入口同时
  存在且不混 authority；
- 426 另测加密版本标记、正文/session/key 保留、同版本 `process` 零 fetch/零 alarm、新版本解除标记并
  复用原 key、blocked 状态继续有界 capture、阻断前持久删除超过 7 天的密文项，以及 Popup upgrade
  文案/retry disabled/二步 clear/live region/320px/reduced-motion；
- Web 入口消息必须无参数且严格拒绝 URL、analysisId 与 token；Service Worker 只打开发布配置注入的
  HTTPS 工作台 URL，未配置时严格失败且 Manifest 不新增 `tabs` 权限；
- 配对消息只允许本扩展 Popup/Options 发无参数 start/status/disconnect；state、verifier 和 token
  必须在独立加密 vault 中，公开响应和 Popup DOM 只能观察脱敏状态。轮询按固定间隔重排 alarm，
  consumed 不得被 GET 序列化；Web 审批必须展示三项偏好、Huayi/Provider 各自接收字段并显式确认；当前
  本机 disconnect 只证明删除本地秘密，不替代服务端撤销测试；
- PairingApproval actual bundle 必须从 production `/pair-extension/:id` 读取 pending pairing 与 revisioned
  三项偏好，验证完整披露、设备标签、consent gate、Cookie/Origin/CSRF strict approve body，并在 reload
  后仅以 GET approved 恢复；approve 恰好一次且不使用 Idempotency-Key/If-Match，不创建 session/token，
  完整矩阵见 `pairing-approval-acceptance.md`；
- 当前账号聚合：strict AccountResource 拒绝旧 consent/status 与秘密字段；active/full Cookie + no-store；
  owner repeatable-read snapshot 返回 email、五项偏好、稳定排序的未撤销/未过期设备和公开最低版本；
  跨账号/缺失或 disabled profile/data-rights 失败关闭且不更新 lastUsedAt。Web 账号页直接用嵌套偏好初始化，
  不重复 GET；
- ClassicParity 差分覆盖紧凑双按钮 ActionCard、稳定 ResultCard 壳层、单词结构化 section、文本
  delta、Provider prompt/JSON Schema 与最终模型解析约束一致；任何一层不得通过放宽公开 Schema
  修复；
- SubmissionOutbox 覆盖严格无参数 status/retry/clear 消息、精确 Popup sender、聚合响应白名单；
  `not-configured` 只有存在保留队列时才携带有界 count/oldest，空队列仍使用无正文状态。另覆盖规范
  ISO 时间、原幂等键重试、pending alarm 重排、upgrade 停重试与二次确认清空；断开、撤回同意或
  session 无效会清账号绑定队列，API adapter 暂缺只 blocked。Popup 不得把本地排队称为“已保存”或
  “已进入待整理”，且 DOM/响应
  不含正文、结果、幂等键、token、storage key 或任意 URL；
- Chrome E2E 覆盖普通网页、YouTube、配对偏好、撤销、BYOK、平台模型 fake、StudyCapture/undo/outbox、
  LocalLexicon/CloudWordCopy 与旧标签页升级；
- 包审计证明无远程代码、`eval`/`new Function`、动态 URL、秘密和未声明 host。

### Cloud 发布证据

- `check:cloud-release` 用完整 fake 候选证明 Store 源码/bundle/Manifest、Web 构建、privacy URL、正式政策
  与 listing 一致，并分别注入配置、host/CSP、runtime origin、远程代码、服务端 secret、预发布文案和
  旧 Store 口径漂移；同一审计还必须证明候选/API Extension ID 相同、候选 Manifest 版本不低于严格
  最低版本，并覆盖数值三元组、前导零与安全整数边界；
- 当前真实开发构建必须以固定安全 code 返回 blocked，且输出不包含输入 origin、Extension ID、secret
  或文件内容；既有 `check:store-release` 无参数 profile 必须继续通过；
- ready 只属于离线候选一致性证据，不替代 TLS/DNS、OAuth、备份、Dashboard、双平台 Chrome 或商店
  人工预审。
- Phase 42 公开数据边界回归必须同时读取 actual `PrivacyPage`、pairing approval、`privacy-policy.md` 和
  `store-listing.md`：四方分别说明 BYOK 查询、platform 查询、StudyCapture 与 CloudWordCopy；禁止
  “登录 BYOK 上传”或“严格结果上传 Huayi/语见”，并证明 `/privacy` 零 API、platform 查询最多一小时且
  不进入 ReviewInbox/History。
- Phase 43 WorkspaceShell contract 必须从公开 interface 验证普通账号七项标签/顺序/绝对路径、恰好一个
  `aria-current`、受限访问形态和 skip link；页面 integration 覆盖待整理两 tab、分析、学习库、练习历史、
  外部词典、完整账号 settings 与 data-rights-only 会话。运营、配对和公共/认证页必须没有学习主导航。
  actual bundle 在桌面及 390px 验证 details 默认收起、键盘展开、完整导航和“今日练习”真实跳转；禁止
  用源码快照代替可见/可操作行为断言。

### 双端同步切片门禁

- 每个 Phase 4–8 纵向切片分别运行 Web 和 Store Extension focused tests，允许独立迭代；
- 合并前由 API、Web、Store 三方解析同一 `cloud-contracts` fixture，并运行对应 API 集成测试；
- Web 分析、配对、StudyCapture/ReviewInbox、学习库、CloudWordCopy 与云端外部词典切片必须各有跨端
  journey，证明两端观察同一 CloudAuthority
  状态；只有一端完成不算该切片关闭。
- PGlite 负责默认离线迁移/RLS/事务证据；真实多连接 Postgres 竞争与 Supabase Auth 组合测试进入受控
  CI 或目标环境门禁，不以单实例 Promise 并发替代。

### Cloud 离线浏览器联合验收

- `pnpm test:e2e` 构建实际 Web production bundle 和 packaged Store Content Script，现有 Extension fixture
  server 不启动第二个 Web/API 进程；`web.huayi.invalid` 与 `api.huayi.invalid` 均由 Playwright 本地
  route fulfill，不访问 DNS、TLS 或外部网络；
- Web journey 覆盖 Cookie/Origin/CSRF/Idempotency/revision、Inbox confirm→Learning Library、公共隐私页
  零 API 与 signed-out 不读学习正文；
- Store journey 覆盖实际 AnalysisSession→StudyCaptureClient→SubmissionOutbox→Web CaptureInbox，再由
  actual Web 显式分析进入 ReviewInbox；另证 BYOK compact result 没有 import。测试 adapter 只替换
  Provider、session/vault、time/ID，不冒充真实 Chrome Service Worker；
- CloudWordCopy journey 覆盖 production lexicon message handler 先写本机 repository，再按偏好使用 HTTP
  copy client；开启时 actual Web `/words` 可重读，关闭时 authority 零写入，离线失败不回滚本机保存，
  关闭 ResultCard 后共享 outbox 仍可由 production alarm runner 恢复；
- 显式历史本机导入 journey 使用 production Options controller、加密 import runtime 与 alarm runner：
  先显示词条/语境数量并只确认一次，201 个词条（含无语境词）按 100+100+1 三批续传；完成后 Web 可
  重读、本机 201 条仍保留，authority 可证明恰有三次严格 batch 写入；
- 账号断开 journey 先离线保存本机词并形成 CloudWordCopy 待提交项，再运行 production
  DeviceDisconnect：第一次网络失败保留 session/queue，重试成功先让 authority 的服务器设备计数归零，
  再由 account-data clearer 清队列；旧 token 后续请求失败、authority 零内容写入，同一词仍从
  LocalLexiconEntry 显示为已保存；
- 换号 journey 使用 production CloudSessionManager 执行 disconnect、pairing start、approved exchange；
  旧账号离线队列不进入新账号，本机旧词仍存在，新收藏通过第二个 session 创建 Web 副本；
- LocalEudicImport journey 使用 production BrowserWordbookExportEngine 读取 fake 欧路页：先只写
  LocalLexiconEntry 并证明 authority 零写入，再由用户预览 2 词/1 语境并二次确认，经加密 local import
  runtime 创建 Web 副本；无语境词与本机保留均需重验；
- Cloud Eudic export/import journey 从 actual Web 创建任务，production Store bridge 领取租约并提交精确
  receipt；export 使用云端 WordEntry 快照，import page 只写云端 WordEntry，处理插件的本机词库保持 0；
  fake Eudic 网络失败必须形成 `network-error` 稳定投影，只有 Web 用户显式点击重试后才重新领取并完成；
- Shanbay Cloud journey 经 production CloudShanbayBridge、独立加密 lease vault 和 exact-sender handler；
  页面只看到本机 batch/item 别名与词头，DOM 无云 job ID/lease token，只有明确用户点击才提交 confirmed
  receipt，Web 随后重读 1/1 完成；两词 batch 还必须精确提交一项 confirmed、一项 failed 并让 Web 重读
  1/2 与稳定错误；另用两个实际页面证明 active job 二次确认取消后，当前租约的迟到 confirmed receipt
  可被审计接收，但 Web 权威状态始终保持 cancelled；
- fake authority 的公开 snapshot 必须保持无正文、候选 payload、Cookie、session token、CSRF、幂等键
  和完整 Header，并覆盖 same-key replay、different-body conflict 与缺 proof 失败关闭；
- 练习 journey 使用同一 actual Web bundle 和 authority：pending sentence 在显式点击前聚合 Provider 次数为
  0，随后完成题目、反馈、来源揭示与自评；两项 dialogue 完成三轮、逐项反馈与原子自评。两个 journey
  最后都从账号页重读 quota，snapshot 仍不得包含答案、task、reservation 或 operation；
- `apps/web/e2e/**` 与 `apps/store-extension/e2e/**` 分别由 workspace 的 `tsconfig.e2e.json` 纳入 strict
  TypeScript 门禁，不能只依赖 Playwright 运行时转译；
- onboarding journey 从 `/join#token` 的 actual bundle 开始，证明首个 document request 无 fragment、
  claim 仅一次、地址栏清理、原生 Google POST、fake Provider 用户点击、callback Secure HttpOnly Cookie、
  `/app` bootstrap 和 manual LearningItem 写后重读。邮箱密码仍要求真实确认，不得用免确认 fake 代替；
- password authentication journey 必须从同一 actual `/join#token` 领取后提交密码注册，202 只显示待邮箱
  确认且零 session；用户显式点击本地 fake mail/provider 确认链接后，固定 callback 才可设置 HttpOnly
  Cookie 并进入 `/app`。清 Cookie 后 `/login` 先覆盖统一错误，再由正确密码创建新 session；两个密码
  响应必须 private/no-store，snapshot/Web Storage/URL 不含邮箱、密码、ticket、flow/code 或会话秘密；
- analysis review journey 从 actual `/analysis` 提交无 action 的 strict manual passage，消费
  started/preview/completed
  SSE 后只通过 `/app` server GET 进入待整理；候选确认后 `/library` 再以 list/detail GET 重读 LearningItem
  和 SourceExample。start same-key replay 不得新增 AnalysisRecord，different-body 必须冲突；
- AccountDataRights journey 从 actual `/settings/data` 请求 strict export，经服务器 GET 重读 ready，
  使用真实 `window.open` 打开本地私有对象；随后通过 checkbox、精确短语、最终确认焦点删除账号。
  accepted 必须清 Cookie 并让 Cloud App 切换 signed-out，后续数据 API 返回 401；signed URL/token 不得
  进入主 DOM、Web Storage 或公开 authority snapshot；
- AdminOperations actual bundle 必须从 `/admin` 经过 production access/usage/users/invitations/audit
  adapter；Operator 完成筛选、停用、一次性邀请和 kill switch 并经服务器重读，非 Operator 在 access
  403 后不得继续读取运营元数据。邀请 fragment、正文、Cookie、CSRF、幂等键和 body 不进入 Web
  Storage 或公开 snapshot；本地 authority 证据不替代真实角色、部署近期认证、告警或恢复演练；
- 完整需求与边界见 `browser-acceptance.md`。该层只证明离线浏览器组合，不替代真实部署、Manifest host
  授权、双平台 Chrome 安装或真实第三方服务。

### Vercel Hobby + Supabase Cron 调度适配

- `production-app.test.ts` 同时证明四个内部 worker route 继续挂载，且 `apps/api/vercel.json` 不再声明
  Hobby 不接受的分钟级 `crons`；
- `supabase-cron-operations.test.ts` 对 operations SQL 做无 secret 静态审计：扩展与 schema、Vault key、
  配置失败关闭、security-definer 固定 search_path、四路径 allowlist、角色权限撤销、Bearer/Accept header、
  ≤55 秒 timeout、四个固定 job 以及先取消再安装的重跑去重；
- 离线测试不执行 SQL、不创建 Supabase/Vercel 资源、不访问 Vault 或 HTTP。真实部署必须另行执行 SQL
  两次，检查 `cron.job` 恰好四项，并观察成功、401、5xx 与超时后的下一周期恢复；
- 这组测试只证明调度适配。Vercel Hobby 60 秒 Function 上限、DeepSeek 90 秒应用超时、个人非商业用途、
  Supabase Free 暂停与无自动备份仍是独立上线裁决，详见 `vercel-hobby-supabase-cron.md`。

## 3. 日志与隐私验证

- 对每条失败路径捕获日志并断言不存在正文、标题、答案、完整结果、email、cookie、token、key、URL、
  prompt、reasoning 和原始第三方响应；
- 管理员 API/页面只能获得白名单运营字段；禁止用 service role 实现正文检索；
- Phase 19 另覆盖 operator/recent-auth、GET 与 mutation 的 CSRF 差异、users/invitations/audit cursor
  context、email literal search、全部管理写入的同 key 重放/冲突/单一审计、自停用与 deleting 拒绝、
  disable 原子 session/pairing 撤销、kill switch 阻断/恢复和邀请 token 不落库；完整矩阵见
  `admin-operations.md`；
- Phase 19 Web 回归还覆盖服务器证明后才显示入口、分区失败不清空其他已确认投影、users/invitations/audit
  签名分页、一次性邀请 path 仅存组件内存、账号/设备/邀请/熔断二步确认焦点、mutation 成功后刷新失败的
  诚实状态，以及窄屏/reduced-motion CSS contract；
- AccountDataExport 和 WordListExport 使用 golden fixtures 验证内容范围；WordListExport 另覆盖 canonical
  排序、Unicode、空文件、LF/末尾换行、UTF-8 MIME 与无 notes/context/ID/owner/credential；
- AccountDataExport 另覆盖 strict NDJSON 八类记录、owner snapshot、仅纳入 snapshot 时尚未过期且不延长
  expiry 的 ExtensionQueryGeneration、24 小时 object/15 分钟 URL、对象写入/清理失败与 old-worker
  fencing；
- 删除测试覆盖数据库级联、非 FK 直接 UUID 清理、RLS、session/pairing 即时撤销、exports→database→Auth
  顺序、逐 stage 幂等/过期接管及完成后 subject UUID 清除。详细矩阵见 `account-data-rights.md`。

## 4. 阶段门禁

每阶段至少执行 focused tests、`git diff --check`、`pnpm format:check`、`pnpm lint`、`pnpm typecheck`
和受影响 workspace build。共享契约、数据库、安全、认证或公开 API 变更还必须执行全量：

```text
pnpm check:instructions
pnpm check:architecture
pnpm check:cloud-release # 仅正式候选应为 ready；开发态预期 blocked
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
pnpm verify:macos
pnpm verify:windows
```

真实模型、第三方词典、安装和商店上传不属于默认门禁，必须分别批准并记录接收字段与费用。

### 4.1 当前 macOS 聚合门禁证据（2026-08-14）

`pnpm verify:macos` 已在 macOS 真实执行并以退出码 0 完成，覆盖 instructions、format、lint、
typecheck、完整测试、Store coverage、architecture、build、109/109 Playwright、Store release、生产依赖
审计和 `git diff --check`。生产依赖审计未发现已知漏洞。该命令没有运行真实 Provider/词典、安装、真实
Chrome 或云部署；Windows 仍须在 Node.js 26 或更高版本的目标机独立执行 `pnpm verify:windows`。
其中 `git diff --check` 只覆盖已跟踪差异；候选提交前必须另行确认全部应发布 Cloud V1 文件已进入版本
控制，不能用该退出码替代版本控制范围审计。

### 4.2 Phase 31 开发态发布阻塞基线

`pnpm check:cloud-development-blocked` 必须在完成 build 后读取真实工作树，并且只在
`privacy-not-final`、`release-config-api-extension-id`、`release-config-api-origin`、`release-config-extension-id`、
`release-config-min-extension-version`、`release-config-privacy-url`、`release-config-web-origin`、
`store-api-origin`、`store-web-workspace-url` 九项恰好全部存在时成功。少一项说明
工作树已被部分候选化，多一项说明新增发布漂移；两者都失败。测试必须覆盖乱序、重复、少项、多项以及
仅固定安全 code 的失败输出，并继续证明正式候选 `check:cloud-release` ready 语义不变。

macOS/Windows 聚合门禁都在 `pnpm build` 后立即调用该命令，保证它审计当前产物。该离线门禁不得访问
网络、读取 secret、运行真实 Provider/词典、安装或 Chrome；成功只证明开发态阻塞集合未漂移。

Phase 31 Fresh RED 为 2 passed / 3 expected failures；GREEN focused 为 17/17。完整 `pnpm test` 为
118/118 Node 脚本测试与 444 个 Vitest 文件（2,721 passed / 12 skipped）。更新后的
`pnpm verify:macos` 以退出码 0 完成，实际顺序为 build→development-blocked→E2E，并继续通过 Store
coverage 97 files / 480 tests、Playwright 109/109、Store release、生产依赖审计和 `git diff --check`。
Windows 仍须在目标机独立执行同一更新后的聚合命令。

## 5. 最终人工验收

- macOS 与 Windows 真实 Chrome 分别验证 Web 配对三项偏好、普通网页、YouTube、退出/撤销、BYOK、
  本地凭据、平台查询、StudyCapture/当前卡撤销、两个 Inbox、本机/云端生词、离线 outbox 恢复和更新后
  旧标签失败关闭；
- Web 在目标网络验证 Google OAuth 与邮箱密码后备路径、SSE、时区队列、导出下载和账号删除；
- 经批准验证 DeepSeek 当前模型 ID、JSON、stream、usage、价格和超时；不得用一次真实 smoke 替代 fake
  回归；
- 经批准验证欧路固定接口和扇贝人工提交，不自动点击、不上传凭据到 Huayi；
- Chrome Web Store 草稿逐项核验单一用途、权限理由、远程代码、数据问卷、截图和公开隐私政策；公开
  发布仍需独立批准。
