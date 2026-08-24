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
  callback no-store/no-referrer；actual Web production bundle 覆盖 active→`/practice`、disabled→
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
- pairing production adapter 回归必须证明 exchange 只执行 role setup 加一条受控数据库函数，并由该
  statement 同时返回 session ID 和偏好 snapshot；禁止 exchange 后第二次直接 JOIN `user_profiles`。
  migration 回归还要证明 profile 缺失会回滚 consumed/session，API 实际环境必须完成单次 exchange、
  preference reread、设备列表、Web 撤销和旧 token 拒绝。
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
  detail contract/repository/Web 另必须证明 `itemLabels` 与全部未擦除 session item 一一对应、顺序稳定、
  expression/text 与 sentence-pattern/template 映射正确；已擦除项没有 label，UI 固定显示墓碑。逐项反馈和
  自评不得回显 UUID，详情标题也不得回显 session ID；真实本机对话完成后必须在历史详情看到原学习项
  英文文本且主 DOM 不含对应技术 ID。
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
- 分析历史 component 测试覆盖真实服务器筛选形状、游标分页、按结果类型显示的完整语义详情，且不把
  记录/候选/分析单元 ID、revision、协议类型或 Prompt/Schema 版本暴露为用户文案；覆盖归档与
  reviewState 独立、
  nothing-to-save、归档/恢复、二次确认删除、mutation 后 server reread、写入成功但刷新失败的诚实状态，
  以及迟到 list/detail/action 抑制、焦点、loading/empty/error/retry；adapter 回归继续证明 Cookie、CSRF、
  Idempotency-Key 与 If-Match。actual bundle 另须从 production `/history` 覆盖 StudyCapture-linked record 的
  五类筛选子集、无技术 ID 的语义详情、process→archive→restore 的服务器 revision 链、默认勾选
  capture 的两步删除、
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
  假完成也不启用重复提交；取消后保留 request ID，手动检查 running 有可见确认，编辑输入不能解锁
  第二次提交。窄屏为单列，沿用全局可见焦点与 reduced-motion 契约；
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
  数字版本比较、426 upgrade、CORS origin/header/method allowlist（含真实 Web PATCH 预检及词表下载
  `Content-Disposition` exposed header）和 token repository 不被错误 proof 调用；
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
- 环境契约必须覆盖 Store capability 缺失/非法、disabled 携带 ID、enabled 缺失/非法 ID；production
  composition 还要证明 disabled 时专用路由不存在、Extension token 在 identity 查询前 403、CORS 不回显
  Extension origin。完整 Store release audit 必须拒绝 disabled runtime 冒充 Store 候选。
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
  `/practice` bootstrap 和 manual LearningItem 写后重读。邮箱密码仍要求真实确认，不得用免确认 fake 代替；
- password authentication journey 必须从同一 actual `/join#token` 领取后提交密码注册，202 只显示待邮箱
  确认且零 session；用户显式点击本地 fake mail/provider 确认链接后，固定 callback 才可设置 HttpOnly
  Cookie 并进入 `/practice`。清 Cookie 后 `/login` 先覆盖统一错误，再由正确密码创建新 session；两个密码
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
  adapter；Operator 完成筛选、停用、一次性邀请和 kill switch 并经服务器重读；非 Operator 首次 access
  403 后只显示统一密码重新认证门，成功重新认证、CSRF 轮换并再次 access 403 后才显示无权限，且全程
  不读取运营元数据。邀请 fragment、正文、Cookie、CSRF、幂等键和 body 不进入 Web Storage 或公开
  snapshot；本地 authority 证据不替代真实角色、部署近期认证、告警或恢复演练；
- 完整需求与边界见 `browser-acceptance.md`。该层只证明离线浏览器组合，不替代真实部署、Manifest host
  授权、双平台 Chrome 安装或真实第三方服务。

### Vercel Hobby + Supabase Cron 调度适配

- `production-app.test.ts` 同时证明五个内部 worker route 继续挂载，且 `apps/api/vercel.json` 不再声明
  Hobby 不接受的分钟级 `crons`；
- `supabase-cron-operations.test.ts` 对 operations SQL 做无 secret 静态审计：扩展与 schema、Vault key、
  配置失败关闭、security-definer 固定 search_path、五路径 allowlist、角色权限撤销、Bearer/Accept header、
  ≤55 秒 timeout、五个固定 job 以及先取消再安装的重跑去重；
- 离线测试不执行 SQL、不创建 Supabase/Vercel 资源、不访问 Vault 或 HTTP。真实部署必须另行执行 SQL
  两次，检查 `cron.job` 恰好五项，并观察成功、401、5xx 与超时后的下一周期恢复；
- 这组测试只证明调度适配。当时的 legacy 60 秒/DeepSeek 90 秒仓库配置缺口由 Phase 45 supersede；
  Fluid/120 秒真实部署、Hobby 个人非商业用途、Supabase Free 暂停与无自动备份仍是独立上线裁决，详见
  `vercel-hobby-supabase-cron.md` 与 `vercel-fluid-function-duration.md`。

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
- AccountDataExport 另覆盖 strict NDJSON 八类记录、owner snapshot、包含实际 AnalysisRecord 时的 private
  serializer 权限与跨 owner 空结果、仅纳入 snapshot 时尚未过期且不延长 expiry 的
  ExtensionQueryGeneration、生产 Postgres `bigint` 字符串到 ready `byteLength` 的安全整数投影、24 小时
  object/15 分钟 URL、对象写入/清理失败与 old-worker fencing；
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

### 4.3 Phase 44 Web 语义设计 Token 契约

Web 样式门禁必须由 `main.tsx` 的生产 CSS import 清单读取全部入口，解析规则块声明并同时证明：

- `var(--*)` 引用全部由 `styles.css` 的 `:root` registry 定义，不允许 fallback 掩盖未知 Token；
- 颜色、背景、边框/轮廓色、非零 margin/padding/gap/inset、圆角和阴影使用 Token；
- `0`、`auto`、`none`、透明色、CSS 全局关键字和含 Token 的组合值是允许的结构性表达；breakpoint、
  width/height、grid/flex、transform 与 typography 不被误判为主题值；
- 失败消息包含相对文件、属性和原值，新增生产 CSS 时会自动进入同一闭包而不是手工扩第二份列表。

Fresh RED 必须覆盖未定义引用与至少一个原始颜色/间距/圆角值；GREEN 后保留现有 responsive、
reduced-motion 和组件行为断言。actual production bundle 在桌面和 390px 覆盖 `/app`、
`/settings/data`、`/privacy` 的可见性、焦点、computed danger border/privacy background、零横向溢出和
公共隐私页零 API。完整契约见 `web-design-token-contract.md`。

Phase 44 Fresh RED 为 2 个预期失败 / 7 个基线通过；GREEN 为静态契约 9/9、focused 4 files /
18 tests、Web full 43 files / 198 tests、actual bundle 3/3。最终 `pnpm verify:macos` 退出 0，并覆盖
121/121 Node 脚本、447 个 Vitest 文件、Store coverage 97 files / 481 tests 与 Playwright 110/110。
Windows 进入下一冻结候选批次。

### 4.3.1 R3-C 安全通知生产代码

- `security-notification-worker.test.ts` 覆盖固定 23 小时 deadline、8 次上限、终态零 sender、Provider
  已发送但 complete 失败时只以同 notification ID 重放，以及 alert port 只接收固定 reason/count；
- `resend-security-notification-sender.test.ts` 使用 fake fetch 锁定唯一
  `https://api.resend.com/emails`、固定模板、20 秒上限、notification ID 幂等 header 与固定失败错误；默认
  测试不访问网络、不读取真实 key；
- `security-notification-delivery-migration.test.ts` 与 `database-migration-chain.test.ts` 证明当前 baseline
  后可重放 0002–0011、API/Supabase 0011 byte-identical、超窗为 failed、耗尽为 dead-letter、一次只领取
  一个第 8 次 delivery；
- `security-notification-app.test.ts`、`production-app.test.ts` 和
  `supabase-cron-operations.test.ts` 锁定独立 bearer route、bounded outcome、production composition 与第
  五个 minute job；`acceptance-app.test.ts` 证明本机模式返回 idle 且 global fetch 零调用。

真实 DNS、verified sender、Resend 接收、重复投递观测、Dashboard 和无正文告警接收方仍必须在 hosted
acceptance 独立验收，离线 GREEN 不替代该外部门禁。

2026-08-22 Fresh RED 为 contracts 1 个预期失败，以及 API 8 个断言失败+2 个缺模块 suite；GREEN 为本节
focused contracts 6/6、API 12 files / 34 tests，随后 contracts full 15 files / 64 tests、API full 132
files / 493 tests。两包 strict typecheck/build、目标 ESLint/Prettier、instructions、architecture、migration
mirror 与 `git diff --check` 通过；全仓 `format:check` 当时仅被本纵切禁止修改的并行
`postgres-account-data-rights.test.ts` 格式差异阻塞，不归因于 R3-C 文件。

### 4.3.2 Phase 76 Provider 身份、Cron secret 与生产组合校准

- `deepseek-analysis-model.test.ts` 用非空但错误的 Provider `model` 先复现成功结果，再要求共享 strict
  envelope 只接受 `deepseek-v4-flash`；同一 parser 由 analysis、ExtensionQuery、practice 和 duplicate
  suggestion 四条付费路径复用；
- `environment.test.ts` 先证明 513 字符 `CRON_SECRET` 被 API environment 接受，再锁定与 Supabase Cron
  SQL 相同的 32–512 字符区间；边界 31/32/512/513 都有断言；
- `supabase-cron-operations.test.ts` 不再只断言“存在一次 unschedule 和五次 schedule”，而是提取
  `WHERE jobname IN (...)` 的 exact 五项有序集合，并要求每个 job/path 同时出现在 allowlist/unschedule 与
  schedule 位置；该静态检查不冒充真实 Supabase 连续执行两次的幂等证据；
- `production-analysis-acceptance.test.ts` 在本机完整 production composition 内核对 durable dispatch、
  request/ledger 的同一价格 UUID、settled reservation、64/0/32 token、实际 cost、单条 succeeded ledger
  和 record model metadata，不再只检查表行数。

阶段内 focused 聚合为 7 files / 32 tests，API full 为 138 files / 531 tests；完整 `verify:macos` 为
240/240 scripts、476 个 Vitest files（2,901 passed / 12 skipped）、Store 481/481 与 Playwright 111/111，
全部通过。这些检查全程使用 PGlite 与固定本机 Provider，不访问 DeepSeek、Supabase、Resend 或 Vercel。
真实 Provider 返回模型、90 秒应用 timeout、账单、R3-C、Cron 安装/重复执行仍由 hosted 外部门单独验收。

### 4.3.3 Hosted runtime 安全只读快照

`scripts/acceptance-hosted-runtime-gates.mjs` 把三个外部门的数据库侧证据收敛到一个深模块；专用
`acceptance-hosted-runtime-gates-sql.mjs` 只负责固定 SQL，入口只负责参数、adapter、parser 与 bounded
输出，两个手写文件都低于 400 行。其外部 interface 只有零网络 `--plan` 和固定 Singapore project-ref 的
`snapshot`；snapshot 复用 hosted foundation 的管理员 pooler、临时 CA 文件与 `verify-full`，整条 SQL 固定
在 `BEGIN READ ONLY`，只把 31 个有序字段规范化为 boolean、enum 或 64-bit 非负计数。数据库返回字段
数量、顺序、名称或值域有任一偏差都以固定错误失败，原始 stdout/stderr 不会被反射。

- R3-C 只统计五类 status、claimable/超窗数量、最大 attempts 和 23 小时/8 次/lease/sent-at 数据契约；
  不查询 profile、email、owner 或 notification ID；
- Cron 在 catalog 尚不存在时返回 `f`，存在时核对三个所需 extension、Vault 中两个固定**名称**、exact
  五个 active minute job/command、私有函数 allowlist/search-path/timeout/header 和 function/schema ACL；
  只查 `vault.secrets.name`，不查 `vault.decrypted_secrets` 或任何值；
- DeepSeek 输出 analysis request/record/ledger 聚合计数，并自动选择最新 request，映射为
  `legacy|off_peak|peak|other`，核对 dispatch、固定价格、reservation、逐 call token/cost/outcome、连续
  ordinal、每次分析最多 1–2 个 billed call、terminal record 与固定 prompt/schema model metadata。内部连接
  用 request/record ID 完成 join；输出不含这些 ID，也不含用户、原文、result 或金额。

`acceptance-hosted-runtime-gates.test.mjs` 的 Fresh RED 是模块不存在；GREEN 覆盖 plan 零调用、只读 SQL
静态安全面、verify-full fake adapter、31 字段 parser 和恶意/额外输出拒绝。测试不连接 Supabase。实际
snapshot 仍是只读观察，不会发送邮件、调用 DeepSeek、安装 Cron、切换 kill switch 或替代 Provider/
Dashboard 证据。

### 4.3.4 Phase 79 Hosted Supabase Cron 受控安装

`scripts/acceptance-hosted-cron.mjs` 是 plan/status/apply 深模块；固定 SQL 放在
`acceptance-hosted-cron-sql.mjs`，测试只穿过同一外部 interface。三个文件均低于 400 行。Fresh RED
先由 `acceptance-hosted-cron.test.mjs` 导入不存在的模块并取得 `ERR_MODULE_NOT_FOUND`；GREEN 覆盖：

- plan 零 adapter 调用、project-pinned 与无 secret/身份输出；
- status 只用一个 verify-full 管理员连接和一个 `BEGIN READ ONLY`，固定解析 18 个 boolean/stage/count；
  Vault 只读 `vault.secrets.name`，额外、乱序、恶意、越界或 adapter throw 一律固定失败；
- preflight 在任何写入前核对 13 条 migration、R3-C 已 sent 且零非终态/失败终态、Vault 两个名称、
  extension schema 可安装、无 unmanaged `huayi-*` job、函数 owner/overload/ACL 可修复，以及
  `huayi_private` schema 精确 ACL（owner `USAGE+CREATE`、`huayi_context_setter`/`huayi_business` 各
  `USAGE`，零其他 edge/grant option）；
- apply 只接受 exact project confirmation，先完成 preflight，再把仓库 operations SQL **完整且未改写**地
  交给 adapter 两次，每次保留自身事务；第一次失败不进入第二次，第二次失败不进入 postflight；
- postflight 是独立只读连接，要求 `exact`、5 个 fixed job、0 个 unmanaged job 和总合同 `t`；所有错误
  只允许固定 stage，原始数据库输出不反射。

离线 fake 只证明控制流和数据最小化，不执行 SQL，也不证明 extension 可安装、Vault 值有效、Vercel
masked `CRON_SECRET` 连续性、两次真实事务、pg_net 响应或两个周期恢复。后两类证据仍必须在 R3-C 外部门
关闭并获得 action-time confirmation 后于 Hosted 独立完成。

### 4.4 Phase 45 Vercel Fluid 与 Function 时长契约

`production-app.test.ts` 解析真实 `apps/api/vercel.json`，必须同时证明 `fluid` 精确为 `true`、唯一
`functions["src/server.ts"].maxDuration` 精确为 120、没有 `crons`，且 production composition 保留五个
既有 internal worker route。测试不得只 mock 配置读取，也不得把 Dashboard 或真实部署标为已验证。

源码复审同时绑定四条 DeepSeek adapter 的 90 秒上限：analysis、ExtensionQuery 和 practice 的可选结构
修复与首次调用共用一个 timer，duplicate suggestion 只有一次调用。120 秒 Function 上限不允许测试放宽
Provider timeout、lease/fencing、账本或自动重试。完整契约见
`vercel-fluid-function-duration.md`。

Fresh RED 必须在只含 `$schema` 的旧配置上因缺 `fluid`/`functions` 失败；最小 GREEN 只修改 JSON。离线
退出门包含 focused/API full、strict typecheck/build、目标 lint/format、instructions/architecture 和
`pnpm verify:macos`。Vercel Settings、部署产物、Observability 和实际超时恢复仍由另行授权的部署任务验证。

Phase 45 Fresh RED 为 2 个预期失败 / 3 个基线通过；GREEN 为配置与四条 DeepSeek deadline 基线
5 files / 25 tests、API full 111 files / 415 tests。最终 `pnpm verify:macos` 退出 0，覆盖 121/121 Node
脚本、447 个 Vitest 文件（2,757 passed / 12 skipped）、Store coverage 97 files / 481 tests、Playwright
110/110 及全部静态、构建和发布审计门。

### 4.5 Phase 46 第二批候选冻结门

Phase 46 不引入产品行为或生产代码，因此不得为了形式伪造 Fresh RED。可复现的真实失配是批次账本仍把
`2a035ee` 与两个新增提交写作当前状态，而 Phase 45 代码锚点已为
`15306b46b4129682278c7dcecc47ac45bbfa7f7d`。最小 GREEN 只校准冻结、证据、状态和 Windows 交接文档。

冻结前必须完成以下本地检查：

- 审查 `3aa143c..15306b4` 的累计提交、文件、行数和敏感路径；
- 证明没有新增 secret-shaped additions、凭据、依赖锁、生成物或可执行产物；
- 明确 wire/schema、协议包、DPAPI、PowerShell、注册表、SEA、Windows 安装器和 Native Messaging
  transport 是否变化；
- 在最终文档工作树执行 `git diff --check`、目标格式、instructions、architecture 和完整
  `pnpm verify:macos`；
- 仅在 Mac 门退出 0、工作树提交后固定 40 位候选 SHA；用户普通 push 后，Windows 才可拉取该精确 SHA
  并执行 `pnpm install --frozen-lockfile` 与 `pnpm verify:windows`。

旧 Windows 结果只覆盖 `3aa143c7f60ba52a941f2a2db587bc93819427eb`，不得外推到第二批候选。Windows
完整门必须从最新候选 SHA 重新开始；若修复任何失败，最终仍须对修复后的最新 SHA 重跑完整门。

最终冻结文档工作树的 `pnpm verify:macos` 已退出 0：121/121 Node 脚本、447 个 Vitest 文件（2,757
passed / 12 skipped）、Store coverage 97 files / 481 tests、Playwright 110/110；全部静态、构建、发布审计
和 diff 门同次通过。该结果记为 `F4`，只证明 Mac/共享离线候选，不证明 Windows 或任何外部项。

### 4.6 Phase 47 本机验收第一纵切：前置条件 doctor

第一纵切只建立可审计配置与失败关闭的 doctor，不启动 Docker、不拉镜像、不生成证书、不创建账号或
调用云服务。Fresh RED 必须因缺 `acceptance-local-doctor.mjs`、Supabase manifest 与环境模板失败；最小
GREEN 固定以下契约：

- 根 `supabase` CLI 精确 pin，`supabase/config.toml` 固定 local project/ports、Mailpit、真实邮箱确认和
  canonical baseline 路径；seed 在下一纵切完成前保持 disabled；
- `.env.acceptance.example` 只有固定 public local origin、变量名和 `REPLACE_WITH` 占位；真实
  `.env.acceptance.local`、Supabase 临时目录和证书私钥被忽略；
- doctor 分别检查 Node.js 22+、Docker CLI、daemon、pinned Supabase CLI、受信任本机 CA 工具、manifest、模板与
  baseline；失败只输出固定 code/message，不回显命令 stderr、环境值或路径；
- 注入 check 的 Node 测试覆盖全绿、多个 blocker、异常和输出边界；真实 doctor 缺任一系统前置条件时
  必须非零退出，不能把“代码契约已实现”写成 local-ready。

focused GREEN 后运行全部 script tests、format、lint、instructions、architecture 与 diff check；由于
Supabase/Docker/CA 属于本机运行时，只有用户批准并完成安装/信任、真实 `up/status/down/reset`、Mailpit
与重启持久化后，才升级为 local-ready。

### 4.7 Phase 47 本机 runtime、HTTPS 与邀请

- runtime 测试必须拒绝错误 network option、零项目容器、容器不在专网、任一 published host 非
  `127.0.0.1`；`start`、`status` 和 `dev` 都运行真实复核；
- HTTPS 启动覆盖 SPA 路径约束和部分端口失败后的全 server 清理；真实 smoke 不使用 `curl -k`，并核对
  8443/8444/8445 listener 均为 loopback；
- HTTPS Web 服务必须在启动时固定完整 bundle；测试先取得 snapshot，再改写磁盘入口，旧 snapshot 仍
  返回原字节。缺失 `index.html` 或非普通文件失败关闭，确保 build 不会让在线 Web 先于 API 切换；
- HTTPS 生命周期测试必须证明子进程使用 `detached + stdio=ignore + shell=false`，健康后才写入/保留 PID
  并 `unref`；不健康的新进程会被终止并清理状态，仍存活但不健康的旧进程会被替换；
- 真实生命周期 smoke 必须证明启动进程的 PPID 不再属于调用终端、`dev:status` 与三个系统信任 HTTPS
  probe 均成功，并在新的命令会话中复核，避免把一次前台 shell 成功冒充持续可用；
- bootstrap 重复运行不得输出 secret，环境权限保持 `0600`，数据库角色保持非 superuser/BYPASSRLS；
- invitation 测试证明 token 只进入 URL fragment，数据库只保存 peppered hash；链接只供本机一次性注册；
- doctor artifact contract 必须固定 Auth 密码最少 12 位且不附加 Cloud 契约之外的字符组合规则；真实
  注册前核对 Auth 容器等效加载 `12` 与空 required characters；
- acceptance API composition 的所有模型 adapter 必须使用阻断 fetch，默认测试与本机首轮均零第三方网络；
- 服务健康、构建或邀请创建不等于 Local-ready；仍须真实 Mailpit 注册/确认、Cookie/CSRF、核心旅程、
  重启持久化与 forward migration 证据。

2026-08-21 首次真实邮箱注册命中 Provider 422：邀请 claim/API rate limit 已写入，但 Auth user、identity、
profile finalization 均未发生；脱敏 Auth 日志确认本机额外要求字母与数字。Fresh RED 以 doctor artifact
contract 精确命中 `minimum_password_length = 8` 与 `letters_digits`，GREEN 5/5 固定为 `12` 与空字符要求。
配置生效时首次 persistence restart 失败关闭并保持 HTTPS 停止；完整重跑随后退出 0，Auth 容器加载新值，
Supabase/HTTPS status 通过，现有邀请与活动 claim 均保留，Auth user 仍为 0，等待用户原页面重试。

### 4.8 Phase 47 首账号初始化与第一条前向迁移

- Fresh RED 必须证明 baseline→`0002` 后，password `finalize_invitation`、Google `complete_auth_flow` 和
  既有非 deleting profile 尚无当前 UTC 月 1 美元默认 grant；
- GREEN 必须证明每条路径恰有一个 `source=default` 当前月 grant、注册重放不重复、同月 admin grant
  不被覆盖、deleting profile 不回填；
- API `0002` 与 Supabase 时间戳 migration 必须字节一致，baseline 文件保持原 version，不通过 reset
  伪造升级成功；
- `acceptance:local:migrate` 测试固定 pinned CLI 参数、先后 runtime 审计和安全输出，真实执行后
  `supabase_migrations.schema_migrations` 同时保留 baseline 与 `0002` version；
- bootstrap SQL 必须幂等创建 private `account-exports-acceptance` bucket，重复执行后仍只有一条且
  `public=false`；测试和日志不得读取 service-role key；
- 真实库执行 migration/bootstrap 前后分别记录 profile、grant、bucket、未消费邀请计数，证明没有清库、
  没有消费邀请且 HTTPS 三入口持续健康。

2026-08-21 实测：migration Fresh RED 3/3、bootstrap 与 runtime migrate 入口分别按预期失败；最小 GREEN
后 script focused 15/15、API migration/auth focused 18/18。当前库前后计数由 `1/0/0/1` 变为
`1/1/1/1`，history 保留 baseline 与 `0002`，重复 bootstrap 未增加 bucket，当前邀请仍未消费。最终
`pnpm verify:macos` 退出 0：145/145 Node scripts、449 个 Vitest files（2,761 passed / 12 skipped）、
Store 97 files / 481 tests、Playwright 110/110；门后 app/API/Supabase HTTPS 复核均为 200。

### 4.9 Phase 47 受控 reset 与虚构 seed

- Fresh RED 必须证明仓库没有 `acceptance:local:reset` 入口、`supabase/seed.sql` 或固定 reset 编排；
- 缺失、多余或错误确认参数必须在 stop、CLI、bootstrap、build、start 之前失败；正确参数必须按
  runtime verify → HTTPS stop → pinned `db reset --local --yes --sql-paths seed.sql` → runtime verify →
  bootstrap → build → HTTPS start 的固定顺序执行；
- CLI 参数不得出现 `--db-url`、`--linked`、`--project-ref` 或调用者提供的值，stdout/stderr 不转发 CLI、
  SQL、credential、容器环境或路径；中途失败不得继续后续阶段或自动恢复旧服务；
- seed 只能包含固定虚构 Operator/profile/admin role 与 current default quota；不得写 `auth.users`、
  sign-in method、邀请/token、session、正文、Provider 结果、真实邮箱域或 secret；
- doctor 必须把 seed 作为固定前置条件，package script 固定调用无 shell 的 Node 入口；普通
  start/migrate/bootstrap/build/test 不得隐式 reset；
- 本纵切只运行注入依赖的离线 reset 回归和完整 Mac 门，真实当前库保持 profile/grant/bucket/未消费邀请
  `1/1/1/1`、两条 migration 与 HTTPS 200。只有用户另行明确要求销毁本机数据后，才真实执行 reset，
  核对重建后 `1/1/1/0`、两条 migration、private bucket、默认额度和新邀请流程。

2026-08-21 实测：Fresh RED 为 3 个预期失败；最小 GREEN 后 reset/doctor/bootstrap/lifecycle/runtime
focused 31/31、scripts 156/156、seed migration 4/4、database focused 19/19。首次完整门的 6 个失败均为
全仓默认并行负载下 PGlite `beforeEach` 建库越过 10 秒；同 6 文件 32/32 与 API 420/420 单独通过。
仓库测试入口以回归测试固定全仓 Vitest 最多 4 workers 后，最终 `pnpm verify:macos` 退出 0：449 个
Vitest files（2,762 passed / 12 skipped）、Store 97 files / 481 tests、Playwright 110/110 与其余门全绿。
只执行过无确认参数的拒绝路径，真实数据、邀请、两条 migration 和三个 HTTPS 200 均未变化。

### 4.10 Phase 47 非破坏性重启与持久化指纹

- Fresh RED 必须证明 `acceptance:local:restart:verify` 模块、package 入口与固定 snapshot/restart 编排缺失；
- 任意参数必须在 runtime verify、snapshot 或 stop 前失败；成功顺序固定为 runtime verify → before
  snapshot → HTTPS stop → Supabase stop → Supabase start → forward migration → runtime verify → after
  snapshot → equality check → HTTPS start；
- snapshot runner 只能使用 `docker exec` 固定本机数据库容器和 `psql`，禁止 shell、URL、password、远端
  参数、调用者 SQL/路径；SQL 在服务器内逐表生成排序聚合 digest，stdout parser 只接受固定 relation、
  非负 count 与 digest，不把结果写入终端；
- 覆盖全部 `public` tables、`auth.users`、`auth.identities`、`storage.buckets`、`storage.objects` 与
  `supabase_migrations.schema_migrations`；缺 relation、重复 relation、格式错误、执行失败或前后差异均
  失败关闭；
- 每个失败阶段必须停止后续调用；HTTPS stop 之前失败保持环境不变，stop 之后失败不自动恢复或 reset；
  persistence 命令不得调用 bootstrap、seed、db reset、build 或 Provider；
- 真实运行前后核对三个 HTTPS 200、两条 migration、当前未消费邀请与既有 `1/1/1/1` 初始化状态；用户
  注册并创建学习数据后必须再次运行，才证明真实账号/学习内容跨重启。

2026-08-21 实测：Fresh RED 7/7 失败，分别证明 restart module 与 package entry 缺失；最小 GREEN 的
编排/解析/固定命令测试 16/16、acceptance/lifecycle/runtime focused 57/57。真实只读 snapshot 先通过，
随后 `pnpm acceptance:local:restart:verify` 完整停止并恢复 HTTPS/Supabase，以退出码 0 证明 before/after
服务器内指纹完全一致。显式聚合复核前后均为
profile/default grant/private bucket/unconsumed invite/Auth user/sign-in method/learning item/migration
`1/1/1/1/0/0/0/2`，两条 migration 名称不变；app/API/Supabase/Mailpit 均为 200。最终
`pnpm verify:macos` 退出 0：172/172 Node scripts、449 个 Vitest files（2,762 passed / 12 skipped）、Store
97 files / 481 tests、Playwright 110/110 与其余门全绿。该证据只关闭注册前初始化状态/邀请 persistence；
用户注册并创建学习数据后的第二次运行仍 pending。

### 4.10a Phase 47 首次真实邮箱确认回调回归

- actual Mailpit 首击必须证明 Supabase signup、verify 与 PKCE exchange 成功；同一确认链接第二击过期是
  正常的单次凭证语义，不能据此要求重发或重建账号；
- API 回归必须证明密码注册链接固定生成 `/v1/auth/password/callback`，该路由向 identity completion
  传 `password`，Google callback 传 `google`，password 不得完成普通 Google login flow；
- migration Fresh RED 必须先因 6 参数 completion、错误 method 修复和 `refresh_profile_email` 缺失失败；
  GREEN 证明 API/Supabase migration 字节一致，只有 email identity 的已完成邀请由 google 修复为
  password，有真实 Google identity 的账号不受影响；
- forced-RLS 回归必须以 `SET LOCAL ROLE huayi_context_setter` 成功刷新 active profile，并证明 PUBLIC 与
  `huayi_business` 无函数执行权；API 不再直接 UPDATE `user_profiles`；
- live migration 前后只记录聚合计数，不输出邮箱、code、flow、邀请或 token。升级后既有确认账号直接
  使用邮箱密码登录并创建 Web session，不再次点击已消费确认链接。

2026-08-21 实测：focused 26/26 与完整 `verify:macos` 全绿；第三条 migration 已应用，聚合状态确认
confirmed Auth user/password method/profile 为 `1/1/2`、google method/Web session 为 `0/0`、消费/可用邀请
为 `1/1`。deploy 完整重跑成功，IPv4/IPv6 六个入口探测均 200，新 password callback 缺参数为 400。
用户密码登录与首个 Web session 仍待人工完成。

### 4.10b Phase 72 scanner-safe OTP 与中断恢复回归

- Confirmation GET 必须在重复/预取条件下保持零 Provider 调用、零数据库消费、零 Cookie；只有 exact
  form POST 的 email + 6 位 ASCII OTP 才调用 `verifyOtp(type=email)`；
- 错误 OTP 返回固定可重试 HTML，不回显 email、OTP、Provider detail；flow 只允许 43 位 Base64URL；
- migration 回归必须证明 expired unbound claim 可回收并 cascade 旧 flow，expired bound claim 必须保留；
  原子恢复只接受仍有效 invitation、唯一 bound claim/flow、confirmed email identity 与零账号数据；
- Hosted Auth config gate 必须对固定 Singapore project 只读 GET 并要求
  `mailer_otp_length=6`；观测到的 8 必须失败。受控 apply 只能 PATCH 该单一字段，随后独立 GET 回读 6，
  stdout/stderr 不反射 access token；不得以本地 `supabase/config.toml` 或邮件正文测试代替 Hosted 回读；
- resend contract 必须 strict token-only；API 覆盖额外字段拒绝、IP/invitation 双限流先于数据库与
  Provider、固定 202/no-store/无 Cookie、Provider 失败可重试且不泄露。Web 覆盖 pending 与 bound-claim
  error 两个入口、StrictMode 单飞、token 仅驻内存且不进入 DOM/Storage；
- 0014 migration 必须证明 API/Supabase 镜像 byte-identical、同一过期/未过期 bound claim 都只轮换唯一
  flow，并回读服务端派生的 `bound_email`；wrong token、claim/Auth email 错配、已确认/多 identity、
  profile/method/quota/session/admin/deletion/audit 数据、
  revoked/expired invitation 与 consumed/finalized 状态全部零写入，ACL 只给 context setter；
- 0014 Hosted dry-run CLI 必须先以 Fresh RED 证明入口不存在；只接受 pinned project/migration confirmation，
  在读取 TTY 前拒绝额外参数与继承的 `PGPASSWORD` / `SUPABASE_DB_PASSWORD`。复用提示前关闭 echo 的同步
  有界 byte reader，不使用 readline；只以 `shell:false` 调用本地 pinned Supabase binary，固定 session
  pooler 无密码 URL 与 `db push --dry-run --skip-vault --db-url` 参数，child env 只含固定 locale 与进程级
  `PGPASSWORD`，stderr 丢弃、stdout 有 byte/time 上限且不落盘；严格 parser 只能接受 dry-run header、连接
  marker、唯一 `20260824010000_password_signup_otp_resend.sql` 与 finished marker，extra/missing migration、
  apply-like 或未知文本均 fixed failure 且不反射 secret/raw output。默认测试只能注入 fake process，不得
  连接 Hosted；真实运行结果必须另行记录，不能由离线 GREEN 代替；
- API 恢复必须先做 Provider password proof，再执行原子函数，失败无 Cookie/无 Web session；invitation
  token 不得进入 Provider command。Web 失败保留内存 token/email，成功才清 URL；
- actual bundle 必须覆盖 scanner/repeated GET confirm、显式 OTP POST、`/practice` Cookie 与之后密码重登；
  旧 GET password callback + code journey 不再是当前契约。
- First Operator 必须先完成 post-completion verifier，再进入 `/admin`：首次 access 的统一 `forbidden`
  显示密码重新认证表单；提交只调用既有 `reauthenticatePassword(password, currentCsrf)`，成功后轮换
  CloudApp/管理页 CSRF 并重新读取 access/usage/users，随后创建邀请必须使用新 CSRF；
- `/admin` 密码错误保持表单可重试，固定错误不得含密码或 Provider detail；重新认证成功后 access 仍为
  `forbidden` 时显示统一拒绝页，不能渲染管理控件。测试不读取 Web Storage，且实现不得新增密码存储。

### 4.10.1 Hosted 重要批次备份与可重建证据门

- Fresh RED 必须先证明仓库没有 fixed backup plan/preflight/completion module；action ledger 缺少 0014 前置
  backup gate 时也必须独立失败，不能先改文档再补正向断言；
- `backup:plan` 与 `backup:executor:plan` 必须零 filesystem、Git、network 和 write，只输出固定 project/
  batch/path/权限/清理/依赖契约；preflight/complete/readiness 继续只读，capture/rebuild 只能由三个 exact
  confirmation argument 与 package entrypoint 暴露，不能进入默认门或接受动态 project/path/image/phase；
- executor pre/rebuild/post readiness 只允许三个 exact argument；检查 clean HEAD/ignored 后只读取 allowlisted
  本地 runtime verdict。唯一 PG17 client 必须是 repository-pinned OCI index。local Docker resolver 必须拒绝
  任何 `DOCKER_HOST`/`DOCKER_CONTEXT`（包括空值），不得读取任意 env socket 或 `HOME`；macOS 从 OS 当前
  用户信息派生固定 OrbStack socket 并使用 app 内绝对 Docker executable，Linux 固定 `/var/run/docker.sock`
  与 `/usr/bin/docker`。socket/executable 类型或权限不符必须在 spawn 前失败；
  `platform-lock:verify` 必须零 Docker/零 network 地验证 CLI 2.115.0/source provenance、无 env/version
  override、14-service gate 分类、完整 lock SHA-256 tripwire、11 active index 与双平台 manifest digest；
  Realtime/ImgProxy/Supavisor 的 disabled gate 或任一合法格式 digest 漂移都失败；
- local image inspector 只允许 11 个固定 `docker image inspect` index-digest reference，测试逐 argv 证明没有
  pull/build/run/start/manifest-network verb，且远程 Docker selectors 在任何 child 前被拒绝。Docker Hub
  `RepoDigests` 必须精确匹配同一锁定仓库的 canonical name 与 index digest，不能以 registry alias 或任意
  digest 放行；真实 JSON 使用 platform-lock 模块自身 32 KiB bounded reader，不能被 executor 的短版本输出
  上限截断。FileVault、local image 或 pinned writer 任一缺失都固定失败；全部 ready 时 readiness 只回报
  fixed passed 且零 evidence；raw subprocess stdout/stderr 不得转发；
- preflight/complete 只允许固定 project `kpadiulxkgckskcfydry`、batch `phase-81-0014` 和固定 artifacts
  路径；拒绝额外 project/path/operation 参数，错误只输出 fixed failure，不反射参数、manifest 或原始错误；
- evidence fixture 必须覆盖 clean Git HEAD 精确、artifact ignored、目录 `0700`、文件 `0600`、非 symlink、
  exact directory entries、strict manifest keys、dump size/SHA-256，以及 pre `20260823010000` / post
  `20260824010000`；任一 dirty/stale/unignored/insecure/partial/extra/hash mismatch 都失败关闭；
- rebuild evidence 只允许 `repository-migrations-and-fictional-seed`，要求 candidate/migration head 精确，
  migration/seed/runtime 全 true、Hosted data absent、scratch destroyed。执行器必须使用无 tag digest reference、
  `--pull never`、`--network none` 与唯一 tmpfs PGDATA，无 host/named volume/port；精确读取 14 migration 和
  SHA-256 固定 fictional seed，验证完整 Auth/Storage DB baseline、唯一 fictional profile、零 Auth identity/
  user、零 Storage object、零 invitation/claim，并在 container 删除回查后才写 manifest。静态 migration test、
  dump listing、command exit 0 或手写 manifest 不能替代实际隔离重建；
- raw logical dump 是敏感备份，不进入测试 fixture/stdout/log。默认测试只使用不含用户数据的内存 adapter；
  测试必须区分 PG17 full-database custom archive 与 Supabase CLI filtered SQL，且断言 Storage object bytes、
  global roles 和 Hosted platform config 不在 archive 覆盖声明内；
- 容器化 writer 不得把密码放入 Docker env/argument；测试必须固定 `.pgpass`/CA `0600`、read-only mount、
  `PGPASSFILE`/`PGSSLROOTCERT` 固定 path、partial→fsync→atomic rename→directory fsync→manifest-last 与固定
  cleanup；child env 只含固定 locale（macOS 可由系统附加 `__CF_USER_TEXT_ENCODING`），输出有硬 byte/time
  上限且 overflow/timeout 失败关闭。固定 TOC 必须包含 Auth users、Storage objects、public profiles 与 migration
  ledger；TTY reader 必须在提示前关闭 echo、使用有界 byte reader 且不触发 readline redraw，macOS 真实 PTY
  回归必须证明虚构 marker 零回显；process timeout 必须等待 child `close` 后才返回，capture client 还必须在
  最多约 4.9 秒的 late-create 窗口中，只强制删除精确 name+label+digest 的自身容器并回查不存在；rebuild
  start race 出现未知同名 identity 时不得删除；container absent predicate 只接受 exit 1 + empty stdout、精确
  单个换行 `\n` 或精确 `[]\n`，必须拒绝其它空白、无换行 `[]`、其它 JSON/文本与 exit 0；既有 final
  evidence 不得覆盖；
- 真实 capture、Storage object export、scratch rebuild、Supabase 连接与 0014 apply 都是另行批准的
  Hosted 门。

### 4.11 Phase 47 本机验收模拟模型

- Fresh RED 必须证明 acceptance fetch 仍固定 `model_unavailable`、phrase trusted assembly 不能保留 strict
  phrase result、Web environment/build/banner 尚无 `simulated` 模式；不能先改实现再补绿测试；
- 模拟 Adapter 通过 production DeepSeek Adapter 驱动 phrase/sentence/passage、六类 ExtensionQuery、
  DuplicateSuggestion 与五类 PracticeGeneration；focused 测试必须解析最终公开 schema，而不是只断言
  fake 被调用；
- endpoint、POST、credentials omit、redirect error、JSON headers、本机 Authorization、request byte bound、
  abort 和未知 prompt 都失败关闭；测试替换全局 fetch 并断言调用次数为零；
- 输出固定非零虚构 usage、无 reasoning，同一 request bytes 得到字节一致 response；analysis 至少生成一个
  可收藏 Expression，duplicate/dialogue 只回显 server-owned alias，主要结果带 `【本机模拟】`；
- acceptance build 只为 Web 固定注入 `VITE_ACCEPTANCE_MODEL=simulated`；环境 schema 拒绝其他值，普通
  build 缺省不渲染。组件测试断言全页面根级 `role=status` 横幅明确“不是 DeepSeek”“不产生外部费用”；
- Google capability 单独默认关闭；普通、本机验收与 hosted build 都不因 simulated/origin 自动启用。
  组件测试覆盖 join/login/account settings 全部 Google 动作隐藏，API composition 测试覆盖关闭时路由
  不挂载且 flow/Provider 零调用；Google actual-bundle 的 Vite E2E 入口才显式注入
  `VITE_GOOGLE_AUTHENTICATION=enabled`，避免根 build 或组件默认值伪造能力；
- focused API/Web/script、strict typecheck、lint、format 和 diff 通过后运行完整 Mac 门。测试和真实本机
  smoke 均不得触网；Windows 留到验收冻结批次；
- 用户正在操作时不 build/restart 当前 bundle。部署只在空闲窗口停止并重启 HTTPS，不停止/reset/seed
  Supabase；真实浏览器验证横幅、分析→候选→学习库→练习后，再记录实现状态。
- 快照运行时首次部署后，后续 build/full gate 可在旧 HTTPS 版本在线期间执行；只有显式 stop/start 才
  同步激活新 Web/API，测试必须证明磁盘改写不会改变既有 snapshot。
- deploy 协调器必须在任何副作用前拒绝缺失、错误或多余的 downtime confirmation；成功调用顺序固定为
  runtime verify → HTTPS stop → acceptance build → HTTPS start。四个阶段分别失败时不得继续，stop 后
  失败不得自动启动；package/source contract 不得调用 runtime stop/start、migrate、reset、seed、
  bootstrap、invite 或外部 smoke。
- `*.acceptance.localhost` 的 IPv4/IPv6 双解析必须有回归：每个 8443/8444/8445 服务各生成
  `127.0.0.1` 与 `::1` 两个独立 listener，任一部分 listen 失败关闭全部 server；真实部署后再以本机 CA
  执行 `curl -4`/`curl -6`，两者都返回 200 才关闭浏览器 connection-refused 缺陷。
- lifecycle start/status 另以注入 probe 断言三个固定 URL 都执行 `family=4` 与 `family=6`；任一单次失败
  整体为 false。不能以 listener 生成单测替代 health gate，也不能让一次 hostname 请求受系统 DNS 顺序
  决定验证哪个地址族。

完整需求、技术路线和人工清单见 `local-acceptance-simulated-provider.md`。

2026-08-21 实现检查点：Fresh RED 分别因模拟模块/横幅缺失、Web strict environment 拒绝模式、build 未
注入模式而失败；独立 phrase 回归还证明 production trusted assembly 把 strict phrase result 留为
`undefined`，两次 repair 后以 `model_output_invalid` 终止。最小 GREEN 后 API focused 3 files / 37 tests、
Web focused 5 files / 17 tests、build contract 1/1、API/Web strict typecheck、目标 lint/format/diff 通过；
API 全量 114 files / 447 tests、Web 全量 44 files / 201 tests、初始 Node scripts 173/173 继续全绿。当前没有
执行 acceptance build 或重启，运行环境仍为旧的 Provider 失败关闭 bundle；根级 Vitest 451 files /
2,792 passed / 12 skipped、当前 Node scripts 176/176、Store coverage 97 files / 481 tests、Playwright
110/110 已通过。snapshot Fresh RED 因缺 export 失败；路径复审再证明 URL 规范化可能吞掉点段，最终
focused 5/5 证明磁盘改写隔离、缺入口失败关闭和原始 traversal 在 SPA fallback 前拒绝。此时完整 Mac
聚合门与真实 HTTPS 模拟旅程尚未取得，不能用源码 GREEN 冒充已部署。

随后将当前 Git 可见文件复制到排除 ignored secret/运行数据的系统临时候选，以
`pnpm install --offline --frozen-lockfile` 零下载重建依赖，并原样执行 `pnpm verify:macos`。聚合门退出 0：
176/176 Node scripts、451/451 Vitest files（2,792 passed / 12 skipped）、Store coverage 97 files / 481
tests、全部 workspace build、Playwright 110/110、development blocker、Store release、production audit 与
diff 全绿。门后 checksum 复核候选与工作树零文件内容差异；该证据关闭当前代码候选 Mac 门，但不关闭
live acceptance build/restart、真实横幅/模拟旅程或 Windows。

部署协调器必须另取 Fresh RED：模块/package script/精确确认参数尚不存在；GREEN 后运行 deploy focused、
完整 Node scripts 与静态门，但绝不在用户未确认空闲时调用真实命令。真实成功证据只能来自用户确认后的
一次 CLI 退出 0、三个 HTTPS health、横幅和模拟旅程。

部署协调器 Fresh RED 已以模块缺失失败，GREEN focused 9/9 覆盖精确确认、固定顺序、四阶段失败、异常
归一化和 package entry；真实无参数调用在副作用前退出 1，原 HTTPS 随后仍健康。用户打开邀请时再次
出现 connection refused，现场分地址族复现 IPv4 200、IPv6 拒绝；双栈 listener Fresh RED 因 export
缺失失败；第二个 RED 复现并行绑定提前清理竞态，GREEN focused 7/7。当前完整 Node scripts 187/187
通过；根级 `pnpm test` 还以 451/451 Vitest files、2,792 passed / 12 skipped 退出 0，全部静态门退出
0。尚未执行带确认 deploy，因此运行中旧进程仍只监听 IPv4，本条只能证明修复候选，不能冒充浏览器缺陷
已部署关闭。

随后为包含部署协调器与双栈修复的最新可见文件重新建立隔离候选；offline frozen install 复用 277 个包、
下载 0，原样 `pnpm verify:macos` 退出 0。结果为 187/187 Node scripts、451/451 Vitest files（2,792
passed / 12 skipped）、Store coverage 97 files / 481 tests、全部 workspace build、Playwright 110/110、
development blocker、Store release、production audit 与 diff 全绿；门后 checksum 零文件内容差异，
候选 Git 干净。证据文档回写属于 docs-only delta，需重跑文档静态门，但不要求重复构建。

门后复审发现 lifecycle health 仍只发起一次 hostname 请求，可能只验证一个地址族。Fresh RED 因缺双栈
probe export 失败，GREEN focused 7/7（新增 2 项）固定三个 URL × 两个 family，任一失败整体失败关闭。
第三次精确候选随后以零下载 offline install 执行 `pnpm verify:macos` 并退出 0：189/189 Node scripts、
451/451 Vitest files（2,792 passed / 12 skipped）、Store coverage 97 files / 481 tests、全部 workspace
build、Playwright 110/110、development blocker、Store release、production audit 与 diff 全绿；checksum
零文件内容差异且候选 Git 干净。旧 IPv4-only 进程会被新 status 正确拒绝，不能把该预期失败误报为
服务被停止。

### 4.12 Phase 47 首次真实模拟分析失败回归

- 现场先用无正文聚合证明四次请求全部停在 `running`，且 `reservation_id`、`dispatched_at`、ledger 和
  AnalysisRecord 均为空；Postgres 固定错误依次为 `model unavailable` 与
  `permission denied for function current_owner_user_id`；
- bootstrap Fresh RED 必须证明 SQL 仍把 `model_kill_switch` 写为 `true`；GREEN 固定 local-only
  `false`，不得修改 hosted/production 默认值或引入真实 Provider key；
- quota Fresh RED 使用真实 baseline、`huayi_context_setter`、owner context、`huayi_business` 与 forced
  RLS 复现 `summary()` 权限错误；GREEN 必须改由 tenant transaction 查询，不以放宽函数 grant、RLS 或
  business role 权限绕过；
- 既有 analysis failure replay 回归继续证明 reserve/preflight 失败后先取得 quota summary，再写 terminal
  event，不打开 SSE、不调用模型。现场只允许通过 `abandon_analysis_request` 回收租约过期、未 dispatch、
  未 reservation 的精确请求，并复核 `running=0`、`failed=4`；
- focused GREEN、完整 Mac 门、bootstrap/deploy、IPv4/IPv6 health 和运行库 kill switch/请求状态全部通过
  后，用户只新发起一次分析。成功后继续候选→学习库→练习；Windows 留到下一关键冻结批次。

2026-08-21 实测：bootstrap 4/4、quota/analysis focused 16/16；`pnpm verify:macos` 退出 0，覆盖
190/190 Node scripts、454/454 Vitest files（2,798 passed / 12 skipped）、Store 481/481、Playwright
110/110 与全部静态、构建、架构、发布、production audit。bootstrap 后 kill switch 为 false，四条遗留
请求为 failed、running/reservation/ledger/record 均为 0，活动 Web session 保留为 1。首次后台 deploy 在
start health 阶段安全失败；同一新构建以前台诊断证明 IPv4/IPv6 六入口均 200 后干净停止，完整 deploy
重跑退出 0，runtime/dev status 与六入口复核全绿。现在只待用户新发起一次分析。

### 4.13 Phase 47 模拟候选持久化与取消等待回归

- live 无正文聚合必须区分 completed、failed、running、dispatch、reservation、ledger 与 record；数据库
  固定错误允许证明 private candidate alias 被写入 UUID 列及其后的 settlement 失败，但不得输出正文、
  request ID、session 或 credential；
- Analysis module RED 必须让 strict `candidate-1` 通过 model seam 到达公共记录并证明未重键；GREEN 由
  server ID source 同步改写 candidates 和 phrase/sentence/passage 引用；
- post-model commit RED 必须让 committer.complete 失败，并证明 fail command 丢失 billed calls/usage/
  cost；GREEN 必须沿用已生成的计费事实，不能用 fallback cost；
- Web RED 覆盖取消后 request ID/检查入口丢失、编辑输入解锁重复提交，以及手动查询仍 running 时没有
  可见变化；GREEN 必须保持 server fence，直到 strict status 返回 completed/failed；
- dispatched 遗留请求只有 lease 过期后才调用既有恢复函数保守结算；随后部署并由用户只发起一次分析。

### 4.14 Phase 47 真实 Postgres 模拟分析闭环回归

- 新增 production composition + PGlite baseline + acceptance Provider 的纵切测试，使用无敏感固定英文输入，
  不替换 quota、request lifecycle、AnalysisStore 或 DeepSeek Adapter；只有最终事件为 completed，且同一
  事务留下 AnalysisRecord、服务器 UUID candidate、settled reservation、精确 usage ledger 与 completed
  request，才算 GREEN；
- settlement 回归必须覆盖“没有可用 billed call/usage 的失败收尾”。可信 Postgres store 从当前 active
  reservation 取得保守金额并在同一事务结算，禁止固定 `100000` 超过较小 reservation 后再次失败；错误
  分支最终必须是 failed + settled，不得留下 running + active；
- 部署后由 Codex 在本机浏览器使用生成的非敏感文本，亲自完成分析、候选收录、学习库读取和至少一次
  练习交互；同时只读取无正文、无 ID 的数据库聚合。刷新和重复状态查询都不得生成第二个 active
  generation。该现场闭环通过前不把页面交还给用户继续代测。

### 4.15 Phase 47 真实驱动与练习角色边界回归

- `analysis-database` 单测必须证明只有显式 `$N::jsonb` 参数会从 JSON 字符串解析为 driver JSON，普通
  字符串与 `$10` 等精确序号不误匹配；真实 `postgres` 探针另证明 stringified JSON 会成为 scalar，而
  原生数组为 array；
- 句子与对话 repository 测试必须在每次 tenant/trusted 查询前恢复真实角色，不能让前一个
  `SET LOCAL ROLE huayi_business` 泄漏到 trusted adapter 后掩盖权限错误；
- 所有 owner-scoped idempotency response 直接写入都使用 tenant query；begin/replay 继续只经
  `begin_idempotent_write` trusted function。角色回归应先精确得到 `permission denied for table
idempotency_records`，修复后覆盖创建、练习、历史、删除、词典和 StudyCapture；
- practice terminal settlement 必须先精确得到 context-setter 无权更新 `practice_generation_tasks`，
  再由 context-setter-only settlement function 关闭 task/quota/ledger 原子边界；API/Supabase baseline
  与 forward migration 字节一致，PUBLIC/business 无执行权；
- 真实浏览器最终至少完成 analysis completed→candidate confirm→library reread→sentence prompt→answer
  feedback→rating→history reread，并复核 running analysis、open practice task、active reservation 全为 0。
- HTTPS lifecycle 回归必须覆盖“未登记旧进程仍响应、刚启动 child 因端口冲突退出”的竞态；health 首次
  成功后等待稳定窗口，再确认 child 存活并重做六入口 probe；stop 在升级为强制信号后须再次等待退出。
  随后真实 stop→start→`dev:status` 与页面刷新都通过。

### 4.16 Phase 47 Store 服务端实际旅程与注销回执权限回归

- 本机 HTTPS adapter 单测必须证明 bodyless DELETE 产生 `Request.body === null`：无长度或
  `Content-Length: 0` 均无 body，正数长度或 `Transfer-Encoding` 才建立 stream；GET/HEAD 始终无 body；
- 使用 production API/Postgres/Auth/Mailpit 与一次性账号实际完成 ExtensionQuery 创建/状态/重放、
  StudyCapture 创建/重放/已有项/PATCH、未分析 Capture 撤销、另一 Capture 的初次分析/重分析，以及
  CloudWordCopy 单条/重放/批量；已有分析的 Capture 必须继续拒绝直接撤销；
- DeviceDisconnect 实际覆盖首次断开 204、相同 proof 幂等重放 204、旧 token 401 和设备列表归零，不能
  以 Web 管理撤销替代 Store 自断开；
- `postgres-account-data-rights` 测试 adapter 必须按生产角色运行 trusted 查询。删除 receipt replay 先
  精确得到 `permission denied for table account_deletion_jobs`，随后只通过 context-setter-only
  SECURITY DEFINER wrapper 读取匹配且未过期的固定回执；不得授予表级 SELECT；
- 部署后用正常账号删除与 worker 清理本次临时账号，并只读取聚合证明 Auth/profile/Web session/
  ExtensionSession/开放任务为 0；原始删除错误不得再被 replay 二次异常掩盖。

### 4.17 Phase 47 隔离空库与 destructive reset 回归

- 回归必须不修改地执行 current baseline 后再执行 `0002`–`0010` 全部 API forward migration；任何重复
  function、table、constraint 或 grant 都应让测试失败。每个 forward 同时保留从其旧前态升级的定向测试，
  不能通过预先 DROP 当前 baseline 对象掩盖空库链冲突；
- 真实演练使用独立 Supabase project ID、Docker network、容器名、数据库/HTTP/HTTPS 端口和生成式本机
  secret；主验收项目在演练前后都必须保持 runtime/dev status 健康且数据聚合不变；
- 隔离项目必须从无容器/无 volume 状态依次通过 start、doctor、bootstrap、build、HTTPS start/status，
  再创建可检测的临时业务状态，执行带精确确认参数的 `acceptance:local:reset`，证明业务状态消失、固定
  Operator/价格/bucket/kill switch 与全部 migration 恢复，最后通过 dev stop、runtime stop 并删除临时
  network/目录；
- 隔离副本在 build 前必须删除所有 workspace `dist`，只允许 lockfile 固定的 offline install；构建输出应
  证明共享 domain/contracts 先于 API/Web 生成，避免主工作树旧产物掩盖冷启动缺依赖；
- 真实 reset 的成功不能只看命令退出 0：重建后的只读聚合必须证明 migration 数量和最新版本正确、seed
  Operator 恰好一条、用户/Auth/学习/分析/练习为空、模型 kill switch 关闭、活动任务为 0。日志与最终证据
  不得输出数据库密码、JWT、Cookie、邀请 token 或用户正文。

### 4.18 UTC 月度额度续期与生产模型持久限速

- migration RED 必须从 baseline→全部 forward 的真实链证明 owner ensure wrapper 和持久限速表尚不存在；
  adapter RED 必须分别命中 `rate_limited` 未映射、summary 未确保 grant 且未限定当前月；
- GREEN 覆盖跨 UTC 月生成恰好一条 `default / 1_000_000` grant、同月 admin grant 保持、重复 ensure 幂等、
  非 current owner 调用失败，以及 summary 先经窄函数确保、再由 business forced RLS 只读当前月；
- 生产 reservation 回归必须证明 Web/Extension/practice/duplicate 共用的数据库入口执行滚动 60/小时、
  300/24 小时持久限制；同 request active replay 返回原 reservation 且事件总数不变，新 request 返回
  `rate_limited`，零额度单独返回 `quota_exhausted` 且不写 rate event；
- `model_rate_limit_events` 必须有 owner/time 索引、超过 24 小时清理、profile cascade、forced RLS 和零表级
  grant；owner ensure wrapper 只授 context-setter。API `0010` 与 Supabase 时间戳 migration 字节一致，
  baseline 与 `0002` 调整后 current baseline→`0002`…`0010` 必须可重放。

### 4.19 Hosted acceptance 精确 origin 配置回归

- API 环境测试必须分别拒绝 `HUAYI_API_ORIGIN`、`HUAYI_WEB_ORIGIN` 与 `SUPABASE_URL` 的 HTTP、凭据、
  非根路径、query、fragment 和尾随 `/`；API 与 Web 使用相同 origin 也必须失败；
- Web 环境测试必须对 `VITE_API_ORIGIN` 执行相同精确 HTTPS origin 约束，并证明解析失败发生在创建任何
  API client 或网络请求之前；
- 固定 `https://api.acceptance.localhost:8444`、`https://app.acceptance.localhost:8443` 与
  `https://supabase.acceptance.localhost:8445` 必须继续通过，本机模拟模式的额外限制不放宽；
- 回归只证明仓库配置失败关闭。真实 TLS、Cookie/CSRF/SSE、OAuth callback、Vercel/Supabase Dashboard
  与跨设备仍由 hosted acceptance 人工门验证。

### 4.19a Hosted Web 安全响应头回归

- 发布材料测试必须精确锁定 `apps/web/vercel.json` 的全 path header rule；缺 CSP、
  `Referrer-Policy=no-referrer`、`X-Content-Type-Options=nosniff` 或禁止 camera/microphone/geolocation 的
  `Permissions-Policy` 任一项都失败；
- CSP 必须锁定 `default-src 'self'`、`base-uri/object/frame-ancestors/frame-src/worker-src` 的拒绝边界，
  只允许同源 script/style/font/manifest、`data:` 图片、acceptance exact API origin 的 connect/form，以及
  form redirect 需要的 exact Supabase project/Google account origin；禁止 `*`，Provider 不得进入
  script/connect，也不为尚未冻结的 production origin/project 猜值；
- Fresh RED 必须证明旧 `vercel.json` 的 `headers` 缺失；GREEN 只改静态配置。离线通过不代表线上生效；
  下一次 Web-only arm/deploy/disarm 后必须对 `/`、`/privacy`、SPA 深路径和静态 asset 回读四个响应头，
  再跑密码登录、Google disabled、API credentialed fetch 与原生表单/跳转回归。COOP 保持未配置，除非另有
  popup/redirect 兼容性设计与浏览器证据。
- 2026-08-24 远端回归已由 Web arm `b80c793` / deployment `7zNFzM4LHHGwyKxbwoDLfWoYGfve` / disarm
  `0e7ef52` 关闭：`/`、`/privacy`、`/admin` 和实际 JS asset 均为 200/TLS verify 0，精确返回四项安全头并
  保留 HSTS；页面显示 arm short SHA，bundle 含完整 arm SHA，浏览器无 CSP/error log。默认 6/7 非 Canceled
  可见数为 Web 5→6、API 保持 15，两项目最终均 disarmed。

### 4.19b 普通邀请生命周期运营回归

- strict list 继续只返回 `id/createdAt/expiresAt/consumedAt/revokedAt`，创建响应以外的列表、审计、日志、
  snapshot 与 Web Storage 都不得出现 fragment/token；不新增领取账号或 claim 投影；
- 组件在固定时钟下覆盖可领取、已领取、已撤销、已过期四态；只为可领取项显示撤销，过期项不能因
  `consumedAt/revokedAt` 均空而误显示按钮；
- DELETE 必须经 active/full Cookie、recent-auth Operator、Origin、CSRF 与 Idempotency-Key；Postgres
  same-key replay 返回相同公开结果并只写一条 `invitation.revoked`、空 safeDetails 审计，新 key 对终态
  返回 `not_found`；既有 function grant/role graph 不变；
- actual production bundle fake authority 覆盖 create→一次性 path→可领取→二步 revoke→已撤销→刷新，
  验证 DELETE 为 `write-valid`、刷新后终态与 audit 可见、当前 output 被清除，token 不进入 snapshot/
  Storage；组件另覆盖 DELETE 响应不确定时立即清除 output、关闭重复撤销并要求 GET 重读。该层不创建
  或撤销 Hosted 真实邀请。候选 `526fb8b` 已由 Web-only arm `bb21817` 产生唯一 Ready Production
  deployment `2D2o6cYZJWSRKLHKQQB7XXxZRAt1`，独立 disarm `636968d` 后 Web/API 默认非 Canceled 数
  保持 7/15 且两项目均关闭；custom domain 已显示新 bundle。独立复核使用用户仍有效的 recent-auth
  会话读取到一条“已领取”和三条“已撤销”，终态行均无撤销入口且 console error 为零。当前无 active/
  expired 行，因此“可领取”及其二步撤销必须随唯一普通邀请验证，“已过期”保留到真实过期行验证。

- Phase 80 增加创建单飞与同键恢复回归：同一渲染周期连续点击只能调用一次 create；pending 时创建和
  恢复按钮均禁用；新尝试先清除旧 path；首个响应丢失后 Web API 必须以原 Idempotency-Key 重放，严格
  成功后下一次新尝试才生成不同键。错误 UI 只能显示“创建结果未知”和“安全恢复邀请结果”，不得显示
  “未创建”或把 token/key 写入 Storage、快照、日志。候选 `946e132` 双关闭零部署；Web-only arm
  `9b0860a` 只新增 Ready `V3NzjTYXtH7fb3WC2P6hpWR1twhb`，独立 `1d1f567` disarm 零新增。最终
  Web/API 为 9/16、无 in-flight，`/admin` HSTS/CSP、exact bundle SHA/recovery copy 与 bundle secret
  scan 通过。Hosted 上线后仍须以未注册邮箱完成真实 active 行、OTP/Auth SMTP 和密码重登，本地回归
  不能替代该门。

- Cloud Web 工作台重设计合并后，必须重新执行完整 macOS 门禁和受控 Hosted 部署：先确认 API/Web
  均为 disarmed，再只 arm Web 并等待唯一 deployment 进入终态，随后以独立提交 disarm；disarm
  不得产生第二条 non-canceled deployment，API 全程不得 armed。部署后至少实测 `/practice` 与
  `/admin`；若 `/admin` 的 15 分钟 recent-auth 已自然过期，只要求用户重新输入当前 Operator
  密码，不得重做 Supabase、DNS、环境变量、密钥或 First Operator bootstrap。

### 4.20 Hosted acceptance foundation bootstrap、管理员只读与应用安全复核

- Fresh RED 必须先因 `acceptance-hosted-bootstrap.mjs`、共享 foundation 常量和 verify 入口缺失失败；
  package scripts、固定 project/pooler 和三条 acceptance 价格 UUID 都由测试锁定；
- 默认只允许 `--plan`，不得连接数据库。实际写入只接受包含 project ref 的唯一确认参数；数据库管理员
  密码和 application role 密码只从环境读取，不能进入 argv、stdout、stderr、调用者 SQL 路径或本机文件；
- bootstrap SQL 在一个事务内验证精确 13 条 migration、42 张 public 表、2 张 private 表、33 张
  tenant `ENABLE + FORCE RLS + owner policy` 表和三个安全迁移角色；Auth users/identities、profile、admin、
  invitation 任一非空都必须失败，Storage 只允许 pristine 或精确已应用的 private empty bucket；
- application login 必须是 LOGIN/NOINHERIT/NOBYPASSRLS 且无 superuser/create-db/create-role/replication，
  只授 `huayi_runtime`；runtime 只授 business/context-setter，三条 direct membership 均无 ADMIN OPTION
  且无额外边。既有 role 重跑不得 `ALTER PASSWORD`；三条价格必须经
  `require_model_price_version` 精确复核；kill switch 冲突不得 DO UPDATE 为 false；bucket 冲突不得静默
  改写；
- bootstrap 必须既接受 pristine 空 Storage，也接受精确“唯一 private acceptance bucket + 0 object”的已应用
  状态，从而可安全重跑；部分状态、额外 bucket/object/price/control 必须整笔回滚；
- admin verify 只读查询必须同时证明上述 schema/role/RLS、精确价格生效时间、唯一 kill switch、唯一
  private empty bucket 和零 identity/operator/invitation。返回值不是唯一 `t` 或 psql 非零都统一失败；
- application verify 将权限 contract、context contract 与精确越权 SQLSTATE `42501`/exit `3` 分开执行；
  六项权限结果必须全真，session pooler `5432` 的同一连接还必须在同一 backend 上证明“事务 A 设置并
  COMMIT，事务 B 未设置且读到 NULL”。PGlite 另覆盖 commit 后下一事务 context 为空；连接错误、不同
  backend、输出形状漂移或只执行 ROLLBACK 都不能通过。不得用 `pg_stat_ssl` 证明 Supavisor 客户端 TLS；
- Rotate 后 deployment 必须先关闭 Git deployment，再运行 hosted HTTP smoke。无账号 DB-backed 探针使用
  `GET /v1/quota` 与非空随机 `huayi_session` Cookie，精确期待 401 `authentication_required` / `The Web
session is invalid.`；400 `invalid_request` 表示 runtime 数据库路径未关闭，Cookie 不得进入证据。当前
  deployment `DyqRzj5UMN8BRpSeZyohXprnAkaT` 已取得精确 401；
- Phase 70 的 Web-only armed RED 必须在旧 `deploymentEnabled=false` 上失败，并要求 API 继续布尔
  `false`、Web 精确为 `{"**":false,"codex/settings-configuration":true}`；deployment plan 与发布材料
  测试必须共同锁定该窗口。push 后任何 Web deployment 状态都先 disarm，不能在 armed 窗口修复；
- 当前 deployment plan 回归必须拒绝把已经完成的 migration、foundation bootstrap、BootstrapInvitation、
  First Operator complete 或首次部署再列为未来动作；固定输出当前 API/Web deployment ID/source/count、
  双项目 disarm、已完成门、用户亲自输入 `/admin` 密码的下一门和 ordinary invite → OTP/Auth SMTP → R3-C →
  Cron → audited Cloud DeepSeek 的依赖链，且不得读取 secret 或访问网络；
- Vercel Dashboard/资源页的只读证据只关闭 Fluid Enabled、`sin1` 与 Latest `/index` Node.js 24.x /
  `≤120s`；90 秒应用 abort 与平台终止必须绑定获批的真实 Cloud DeepSeek 应用路径请求，不能由空
  Observability 页面推导；
- Web Vercel build 回归必须锁定 `vercel.json.buildCommand=pnpm build:vercel` 和 Web package 的完整命令：
  learning-domain → cloud-contracts → Vite。原始反馈环先临时移走 cloud-contracts `dist` 并确认旧
  `pnpm build` 复现 Vercel resolver error；修复后在相同缺失 dist 条件运行专用构建必须成功。下一次真实
  deployment 日志仍须显示专用命令和依赖顺序，本地 GREEN 不替代远端关闭；
- 零账号公开 smoke 只允许无写入验证：Web `/`、`/privacy`、hosted build SHA、无模拟标识、bundle secret
  scan；允许 Web origin/credentials 且拒绝其他 origin 的 CORS preflight；无 Cookie 的 CSRF/SSE 入口 401；
  缺 flow/code callback 400 加 `private, no-store` / `no-referrer`。同时以只读远端状态证明 Auth/profile/
  admin/invitation/usage 仍为空。该门不调用 Supabase signup、SMTP 或 DeepSeek；
- Phase 70 真实证据已在 Web deployment `6AAAVXP175oviEhrjULxH48eQjPu` / source `b87ef03` 上关闭：Web
  TLS/200、hosted identity、三项 bundle 零秘密、CSRF/分析 401、失败 callback 400 及其缓存/referrer header
  均符合契约；只读联合计数的 Auth/profile/admin/invitation/analysis/usage/rate-limit/audit/首位 Operator
  共 12 项全部为 0。独立 disarm `c5c25f5` 没有新增 Web/API deployment；
- Cloud DeepSeek 必须在正常邀请注册并 complete Operator 后，由受审计 `/admin` 动作临时关闭 kill switch，
  再经真实 Web session 的应用路径核验 model/usage/价格 UUID/reservation/UsageLedger。Classic
  `pnpm smoke:deepseek`、公开测试 endpoint、直接 Auth 用户或 SQL 绕过均不可作为 hosted 证据；
- CLI 与 production runtime 都必须使用显式 Supabase CA 与 `verify-full`；API 环境回归拒绝 require/无 TLS、
  非 6543 pooler、错误 project ref、缺失/越界 CA，本机 disabled 模式只接受固定 loopback database DSN；
- hosted psql 子进程回归必须证明调用方不能覆盖 `PGSSLMODE=verify-full` 与临时 `PGSSLROOTCERT`；diagnostic
  布尔项只输出固定 TLS/contract/context/越权阶段的 `name|t/f`，exit class 只允许固定枚举；任何 stderr、
  SQL、SQLSTATE、PID 或密码都不能出现，并覆盖 psql code `0/1/2/3/null/other` 的精确分类；
- 本阶段 focused tests 只能证明 SQL/CLI composition 与嵌入式事务语义。真实执行仍需用户确认；执行后要用
  自定义 login 经 session pooler 完成 hardened application verify，才能把 transaction-pooler runtime DSN
  保留在 Vercel secret store。
  Supabase 托管 `postgres` 不是 superuser，preflight 只能要求精确 `postgres` 管理角色和 CREATEROLE，
  不得以 `is_superuser=on` 作为不可满足的前置。

### 4.21 首位 Operator 两阶段部署引导

- migration 必须同时通过 current baseline 空库、baseline→forward 与 Supabase mirror；issuer 约束固定
  operator+actor 或 deployment-bootstrap+null，私有 bootstrap table/function 对全部 application chain
  角色不可见；
- issue 只在 Auth/identity/profile/admin/invitation/claim/audit 全空时成功，并发只有一个赢家；数据库与
  SQL 不含明文 token；
- replace-unclaimed 只有 current invitation 零 claim、零 identity 时可用，必须撤销旧邀请并让 revision
  恰好 +1；已 claim、部分 Auth 或注册完成后全部失败关闭；
- complete 不接受 userId/email。password/Google 正常 finalization 后只能推导唯一 bound/finalized user，
  并要求唯一 profile/self owner、全部 identity/method、注册时段 default grant 和零 admin role；额外账号、错绑定、
  缺额度、重复/并发完成均不得留下部分 role/state；
- 首位账号删除必须完整移除 profile/admin role/学习数据，并只把私有 record 的 operator UUID 清空为
  deletion time；bootstrap 保持 completed 且不能重新发行；
- CLI 固定 project/pooler/verify-full/CA、精确确认参数和同 API pepper。plan/status 零写入，普通失败输出
  固定且不含 secret；invite URL 只允许一次性 secret stdout；
- pepper continuity CLI 是可选工程诊断，只能在自动化或受控运维已有安全 managed token source 时运行；
  不得要求用户识别、复制或输入 43 字符原邀请 token。单个 read-only boolean 仍同时锁定
  `registration-interrupted`、current active deployment-bootstrap invitation 与 hash equality；缺失/错配/
  额外输出全部失败，且 token/pepper/hash/DSN/身份不得出现在 argv 或 CLI 输出；
- 真实恢复由 Web 从原邀请 URL fragment 的内存状态自动提交 token；API 用 Production pepper 计算 hash，
  0013 在任何业务写入前验证 invitation provenance/active state、精确中断状态与 hash equality。错误 pepper、
  丢失 token 或状态漂移均证明零部分写入；
- hosted 人工门按 migration dry-run/push、status、真实注册、complete、admin verify、application 越权复验
  和 `/admin` Cookie/CSRF journey 执行。没有这些证据只能标记 implemented，不能标记 hosted ready。

## 5. 最终人工验收

- 在 production 前先执行 `user-acceptance-environment.md` 的两层验收：本机环境证明从空状态重建、reset、
  forward migration 和快速修复，hosted acceptance 证明真实 TLS、Cookie/CSRF/SSE、托管 Auth/Storage、
  多连接和持续使用；两者均不能由 Playwright fake authority 或 PGlite 单独替代；
- hosted acceptance 每轮绑定完整 SHA、环境资源、migration、启用能力和用户发现；Fresh RED/自动回归
  通过后必须重新部署并由用户复验原场景。至少一个跨多日自然使用周期、零开放 P0/P1 和用户明确批准
  是 production candidate 前置条件；
- macOS 与 Windows 真实 Chrome 分别验证 Web 配对三项偏好、普通网页、YouTube、退出/撤销、BYOK、
  本地凭据、平台查询、StudyCapture/当前卡撤销、两个 Inbox、本机/云端生词、离线 outbox 恢复和更新后
  旧标签失败关闭；
- Web 在目标网络验证 Google OAuth 与邮箱密码后备路径、SSE、时区队列、导出下载和账号删除；
- 经批准验证 DeepSeek 当前模型 ID、JSON、stream、usage、价格和超时；不得用一次真实 smoke 替代 fake
  回归；
- 经批准验证欧路固定接口和扇贝人工提交，不自动点击、不上传凭据到 Huayi；
- Chrome Web Store 草稿逐项核验单一用途、权限理由、远程代码、数据问卷、截图和公开隐私政策；公开
  发布仍需独立批准。
