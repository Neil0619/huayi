# 语见 Cloud V1 安全设计

## 1. 数据分类与信任边界

- **秘密**：Supabase service role、DeepSeek 平台密钥、邮件密钥、Web refresh token、Extension
  session token、BYOK 与欧路凭据。任何秘密不得出现在日志、客户端包、账号导出或管理页。
- **用户正文**：StudyCapture、平台插件查询临时输入/结果、Web 分析输入/结果、来源标题/用户上下文、
  云端单词语境、学习项、练习题、回答、对话和反馈。服务器
  可读，必须做租户隔离、用途限制、删除与导出。
- **认证资料**：email、Google subject、邀请、设备标签与 session 元数据。只用于身份、安全和运营。
- **用量资料**：模型版本、token、费用、时延、稳定错误码。不得与正文一起记录。
- 网页、YouTube、模型、Content Script、第三方词典页面、浏览器存储和所有 HTTP 输入均不可信。

信任链为：Web/Extension → Hono API 认证与授权 → 业务用例 → Postgres；RLS 是第二道防线。DeepSeek、
Google、邮件服务、Eudic 与 Shanbay 都是外部接收方，分别使用最小数据。

本机真实 PostgreSQL 验收不得通过扩大 `huayi_context_setter` 权限修复业务写入。owner-scoped
`idempotency_records` 由 `huayi_business` 在 owner context 下写；context-setter 只调用固定函数。
`settle_practice_generation_quota` 仅授予 context-setter，PUBLIC/business 均无执行权；函数重新校验当前
owner context、generation/reservation 归属、task 成功或失败终态、价格版本、调用条数/token/cost 和预留
上限后才写 usage ledger 并 settle reservation。不一致时 task、session、ledger 与 quota 同事务回滚。

## 2. 身份、会话与租户隔离

- 邀请 token 使用至少 256 位随机数，数据库只存带 pepper 的 hash；72 小时过期、一次消费、创建/
  验证/领取均限速。不绑定邮箱的转发风险必须在邀请创建页明确提示。
- Web 只从受控 `/join#<token>` fragment 读取邀请，因此首个页面 HTTP 请求和托管/CDN path 日志均不
  含 token；领取请求使用 `no-referrer`，成功立即用 `replaceState` 移除地址栏 token。邀请
  token 与 claim ticket 不进入 localStorage、sessionStorage、query、hash 或日志。claim ticket 只在
  当前页面内存和固定 API 原生 POST 的单个隐藏字段中短暂存在，注册成功后立即从组件状态清除。
- Google start 对 JSON 与表单按 Content-Type 分支严格解析；表单恰好接受一个合法 `claimTicket`，
  拒绝额外、重复、缺失和越界字段。Web 只能从已验证的 HTTPS API origin 构造 form action，不能把
  用户或 URL 提供的 destination 带入导航。
- Google 能力默认关闭：API 只有显式 `HUAYI_GOOGLE_AUTHENTICATION=enabled` 才挂载 Google 注册、登录、
  callback、link 与 reauthentication 路由；Web 只有显式 `VITE_GOOGLE_AUTHENTICATION=enabled` 才显示对应
  动作。缺失/未知值失败关闭，API 在 rate-limit、flow、Cookie 和 Provider 前返回固定 404。两端不能单边
  启用；hosted acceptance 首轮保持缺失并继续让 Supabase Google Provider disabled。
- 密码注册 202 不设置 Web Cookie；邮箱确认 callback 成功前不得进入工作台。密码确认与 Google 使用
  不同固定 callback，由服务端路由确定并向数据库显式传递 `password|google`，不得从上游邮箱或 query
  猜测 method。密码注册/登录响应统一 `Cache-Control: private, no-store`，登录失败使用相同认证错误，
  不暴露账号存在性或 provider 细节。
- Supabase user/identity 只证明 provider 认证，不直接授予 Huayi 数据权。邀请事务只登记本次实际 method；
  普通密码/Google 登录必须命中 owner-scoped `account_sign_in_methods` 才能建 session。相同邮箱或上游
  auto-link 不能创建 profile、补 method 或越过邀请；普通业务 role 对该表只有 SELECT，method 写入只经
  锁定邀请/会话的 SECURITY DEFINER 状态机。
- Provider 成功后的规范邮箱刷新只经 `refresh_profile_email` 窄 SECURITY DEFINER 函数；仅
  `huayi_context_setter` 可执行，PUBLIC、业务角色和 runtime 角色本身均无直接执行权。函数只更新指定
  active/disabled profile 的 email/updated_at；找不到 profile 时 Web-session 事务整体失败，不能先完成
  部分会话写入。
- 普通 Google start 只接受 strict 空 JSON 或空原生 form，不接受 email、claim ticket、return URL 或身份
  字段。Google start/callback 禁止缓存；callback 成功和失败都固定 `Referrer-Policy: no-referrer`，避免
  API URL 中短时 flow/code 作为 Referer 进入 Web 或第三方。完整矩阵见
  `google-authentication-acceptance.md`。
- 密码近期重认证不接收 email/userId，也不先消费当前 refresh token。active/full Cookie+Origin+CSRF 先
  解析服务端邮箱并确认 password method；每 IP+owner 每分钟最多五次 Provider 尝试。只有 Provider 返回
  同一 user ID 才由受控 SECURITY DEFINER 事务写新 encrypted refresh/session/CSRF 并撤销旧 hash；错误
  密码、错 user、停用/删除、旧 session 重放和事务失败均不设置新 Cookie、不推进 `reauthenticated_at`。
- Google 近期重认证 start 同样要求 active/full Cookie+Origin+CSRF 和已登记 google method；公开 body 只
  返回固定 continuePath。opaque intent 只在 HttpOnly Secure SameSite=Strict、continue-path-scoped Cookie
  中保留 15 分钟；数据库 flow 绑定 purpose/owner/session 且 continue 只能启动一次。callback user 不同会
  消费 flow但保留旧 session；同一 user 才原子写新 encrypted refresh/session/CSRF。flow/code/state/token
  不进入 Web URL、Storage、日志或公开响应。
- 身份绑定不把“普通登录发生在 15 分钟内”视为 recent-auth proof。Web session 内部另存
  `reauthenticated_method`：普通登录/邀请为 null，显式 password/Google reauth 才写对应值。Google link
  必须同时要求新鲜 password provenance，设置 password 必须要求新鲜 Google provenance；字段不进入
  Cookie、公开响应、账号导出或日志。
- Google manual link 以数据库 unique open-flow 和 30 秒 hashed lease 串行化 refresh generation；lease、
  clear refresh/access token 不进入 URL、Cookie、公开 schema 或日志。refresh 成功后必须先在同一事务
  替换 encrypted refresh 并保存 protected Auth state，之后才允许 manual link；callback 只读已保存的
  provider-started state，并在 purpose/session/user 匹配的事务中新增 method、撤销其他 sessions和轮换
  当前 Cookie。错误 lease、不同 user 与 replay 均不得留下 method/session 部分写。
- Password link 使用独立 purpose/lease，不能复用 Google link flow。Google reauth provenance 后先持久化
  refresh rotation 与 protected provider state，再调用 authenticated `updateUser({password})`；新密码只在
  strict POST 请求和单次 Provider 调用内存中存在，不写数据库、状态、URL、Cookie、响应或日志。Provider
  返回同一 user 才允许标记 provider-updated，最终事务才插入 method并撤销其他 sessions；任一中断按 stage
  恢复，不自动降级到管理员改密或跳过 Supabase secure-password-change 检查。
- 重复绑定只在数据库函数已经锁定并验证 active/full session、固定 Origin、CSRF 与目标绑定要求的
  recent-auth provenance 后返回 409
  `sign_in_method_already_linked`；该结果不创建 flow、不调用 Provider、不轮换或撤销 session。无效、撤销、
  过期、普通登录、错误 recent-auth 或跨账号 proof 仍统一 `authentication_required`，避免把
  already-linked 变成账号探测信号。
- PasswordRecovery 与登录/绑定隔离：公开 email start 对未知、Google-only、非 active 与 eligible 账号
  使用相同 202/no-store body 和文案；只有 trusted email lookup 确认 active+password method 后才创建独立
  flow。PKCE/provider state 加密，邮件 callback 的 flow/code 单次且短时，成功只签发 15 分钟 path-scoped
  recovery Cookie；该 Cookie 只能读取无身份字段的 CSRF/expiry 并完成一次改密，不能读取账号资源或变成
  Huayi session。complete 在 Provider 前锁定 owner/status/method/Origin/CSRF/lease，Provider user/email
  必须匹配；成功清 Cookie、撤销全部 Huayi Web/Extension sessions并写耐久安全通知。日志不含 email/hash、
  flow/code、Cookie/CSRF、auth state、Provider error 或密码。start 不等待外部网络，有效且未限速的 202
  固定至少 250ms handler floor；trusted worker 在发信前耐久标记 dispatch，可能已发信的丢失任务不得
  自动重发，以满足统一响应时间并避免邮件轰炸。安全通知使用独立 120 秒 lease 和有界退避；sender 必须
  用 outbox notification ID 做厂商幂等键，避免邮件成功而本地 complete 失败后的重复投递。完整矩阵见
  `password-recovery.md`。
- 恢复邮件 GET 不直接交换 Provider code，而只返回无脚本/外链、CSP 限定 `form-action 'self'` 的惰性确认
  页；用户显式 POST exact flow+code 表单后才消费单次 code。confirm/callback 均 no-store/no-referrer，
  目标固定，降低邮件 scanner 抢先消费和 Referer 泄漏风险。
- Web Cookie 使用随机不透明 ID；会话固定攻击通过登录后轮换 ID 防止。CSRF 同时校验固定 Web Origin
  与随机 token；OAuth callback 只把 HttpOnly session Cookie 带回 API origin，再由固定 Web Origin
  调用无缓存 bootstrap 原子轮换 CSRF hash。CORS 只允许固定 Web origin 携带 Cookie；Extension 使用
  独立 token 认证，不依赖浏览器凭据 CORS。允许方法与公开路由严格对齐，包括 Web 学习项和账号偏好
  所需的 PATCH；只额外暴露下载契约需要的固定 `Content-Disposition` 响应头，不暴露认证或内部头。
  预检通过不替代 Cookie、Origin、CSRF、If-Match 和幂等校验。
- 配对采用 state + PKCE，批准页显示请求设备，授权码单次且 10 分钟过期。Extension token 只在
  Worker 和专用加密 ExtensionSessionVault 内出现，Content Script 无法读取。pending state/verifier
  同样使用 DeviceVault DEK 下的独立严格 envelope 持久化；通用 CredentialSlot 不新增 session 槽，
  避免 Options 获得读取能力。公开轮询不返回 consumed、设备标签或 token；exchange 成功后轮询为
  not_found。
- 配对审批页在签发 session 前展示并可修改三项账号插件偏好，再分别披露：platform 查询会发送最小
  选区并最多保留一小时；StudyCapture/CloudWordCopy 只在对应设置/动作下发送；BYOK result/Key、页面
  URL、标题、视频 ID 与完整页面不发送 Huayi。批准与偏好 revision 在同一事务提交。
- pairing exchange 必须在一条 SECURITY DEFINER statement 中原子消费 PKCE/state、创建 ExtensionSession
  并返回 owner preference snapshot；不得先提交 token hash/session，再由 context-setter 直接查询
  forced-RLS profile。profile snapshot 缺失必须使整个 exchange 回滚，避免 consumed pairing 和客户端
  未收到 token 的幽灵设备。函数仍只授权 context-setter，PUBLIC/business 不获得执行权。
- API 根据已验证 session 得到 ownerUserId。Repository 方法不接受“任意 owner”；普通用例在请求
  scope 中固定 owner。管理员另走显式模块并写审计。
- Web 设备列表只返回当前账号未撤销且未过期的 session 元数据。设备撤销要求 Web Cookie、固定
  Origin 与 CSRF，数据库函数同时匹配 owner 与 session ID；跨账号 ID 使用 not_found，避免归属探测。
  Store“断开此设备”另走当前 token 的 singular self-revoke：只能撤销自身、随机/已失效 token 统一 204，
  且远端确认后才清本机秘密；网络失败不能丢 token 或伪称撤销。详见
  `extension-session-disconnect.md` 与 ADR-0022。
- `GET /v1/account` 只接受 active/full Web Cookie，在 owner RLS snapshot 内再次要求 profile active 并返回
  no-store；只含规范
  email、五项偏好、有效 extension session 公开字段和公开最低版本，不含 owner、Web session、token、
  hash、install ID、quota、正文或虚构 consentVersion。disabled data-rights session 不能调用。
- 额度读取只接受 Web HttpOnly Cookie，经固定 Web origin 的 credentialed CORS 调用；Extension token、
  query/body owner、客户端时间都不能取得或改变投影。响应 `private, no-store` 且只含 bounded 数值、
  UTC 周期和 warning，不含 ledger 行、request ID、模型正文或账号标识。BYOK 不进入云端额度账本。
- 账号偏好完整 GET 只接受 Web Cookie；PATCH 还必须通过固定 Origin、CSRF、Idempotency-Key、If-Match
  与 body revision。owner 从 session 取得且不在请求/响应出现；Postgres 在 forced-RLS owner transaction
  内读写。Extension Authorization 只能访问单独的三项插件偏好只读投影，不能写设置或读取练习偏好。
- 每张用户内容表启用并测试 RLS；普通业务连接使用专用 `NO BYPASSRLS` 角色，事务账号上下文只能
  由 API 从 session 设置。service role 只在 API 环境中执行 Auth 管理，不用于普通业务 SQL，也不
  暴露给 Web。
- 历史详情/分页把 AnalysisRecord 与 Candidate 放在同一 RLS 租户事务快照内读取。内部记录序列化函数
  撤销 PUBLIC/业务角色执行权，只能由受控 SECURITY DEFINER 写函数内部调用，防止凭 UUID 绕过 RLS。
- Web 分析历史只通过固定 API origin 与现有 Cookie/CSRF adapter 访问；页面不接受 owner、API URL 或
  authority 字段，也不渲染 raw HTML。来源正文、模型结果、候选理由与标题均作为不可信纯文本显示。
- 学习库 GET 只从 HttpOnly Web session 得到 owner，不接受请求 owner。列表过滤、服务器时间 due/new、
  ScheduleState 与最近 completed practice 摘要都在同一 tenant transaction 的强制 RLS 下读取；跨账号
  UUID 返回与不存在相同的 not_found。响应不含 owner、练习正文/反馈、内部排期 revision 或账号秘密。
- 学习库创建要求 HttpOnly Cookie、固定 Web Origin、CSRF 与 strict `Idempotency-Key`；正文不得携带
  owner、revision、排期或来源。受控幂等函数只额外允许固定 `learning.create` operation，PUBLIC/业务
  角色仍无执行权；tenant transaction/RLS 原子写 item、level -1 排期和规范化标签。
- 学习库 patch/delete/merge confirm 同样要求 Cookie、Origin、CSRF、Idempotency-Key、If-Match 与 body
  revision；受控幂等 allowlist 只有 `learning.patch|delete|merge`。owner/current/type/revisions、练习引用
  和 source level 均在同一 RLS transaction 重验；冲突响应不返回 practice session 或引用计数。删除后
  重放来自严格快照。语义模型只见 server-owned bounded 候选，输出不能注入 item/owner/provider 字段。
  语义 request 表 forced RLS 且撤销 business role 全部直访；只有固定 search_path、owner-context 校验的
  definer transitions 可 reserve/dispatch/terminal/cleanup。dispatch 前过期零账本释放，dispatch 后过期按
  预留上限保守结算且不重发。公开 suggestion route 要求 active/full Cookie、固定 Origin、CSRF 与专用
  strict `Idempotency-Key`，拒绝 `If-Match` 和客户端候选；相同 owner/key 的 terminal replay 先于新价格
  预检，只有新 generation 才执行 price→kill/quota→reservation→dispatch→Provider。独立 cleanup route
  只接受常量时间比较的 `CRON_SECRET` bearer、固定 no-store，并只返回最多 100 的安全计数。
- 练习 GET/mutation 同样只从 Cookie session 得 owner；mutation 要求固定 Origin、CSRF、Idempotency-Key
  与匹配 revision。PracticeAttempt 的答案先在 tenant/RLS transaction 落库；feedback lease 原子条件更新
  且 completion/failure 按 token fencing，避免并发 retry 重复调用或旧 worker 覆盖。客户端不能提交
  feedback、ScheduleState、owner 或模型字段。
- 对话用户 turn 必须先在 owner tenant transaction 落库；start/assistant/final generation 只能在持有
  未过期 DB lease 时调用，completion/release 都按 token fencing。活跃 lease 不产生第二次调用或永久
  错误 replay；1–3 项 snapshot、逐项反馈与 ratings 均受 RLS/owner/idempotency 约束。中途响应不含
  正确性反馈，SourceExample 仅在 completed 后由既有 learning detail authority 读取。
- 真实平台练习调用必须在 Provider dispatch 前持久化 `practice_generation_tasks`、价格快照、额度预留和
  durable dispatch mark。session/attempt 只引用当前 task，不持有价格、token 或原始 Provider 响应；Provider
  只见有界学习正文与请求内别名，不见 owner/UUID/排期/来源 URL/凭据。严格输出先进入 task ready，再由
  owner tenant transaction 应用到 session 并清除临时 output。
- 已 durable dispatch 的 task 发生 worker 丢失时，不得因租约过期透明调用第二次；trusted recovery 只能
  以最坏预留额保守结算并 abandoned，用户显式新 key 才能创建下一 task。ready task 重放零调用，旧 token
  不能覆盖新 task/session。错误响应不得返回 prompt、Provider body、价格、usage、reservation 或 task state。
- 练习历史 GET 只从 Cookie session 取得 owner，服务端在 forced-RLS transaction 内完成筛选、游标与详情
  投影；跨账号 UUID 与不存在统一 404。响应不含 owner、lease token、内部 prompt reservation 或幂等
  记录。DELETE 另要求固定 Origin、CSRF、Idempotency-Key 与匹配 revision，只允许无 worker lease 的
  completed/failed 终态会话；409 不披露引用数或 lease 状态。删除不获得修改 live 排期或学习项的能力，
  只可在最后引用消失时清理非内容墓碑。
- 生词 GET 同样只从 Cookie session 得到 owner，normalized 搜索、word/context cursor 与详情均在 forced-RLS
  transaction 内完成；跨账号 ID 与不存在统一 404。响应不含 owner、content hash 或外部任务数据。
  notes PATCH/word DELETE 另要求固定 Origin、CSRF、Idempotency-Key 和匹配 revision；path ID 进入 hash。
  外部任务引用冲突只返回 `word_entry_in_use`，不披露 job/state/count，删除不获得修改分析/学习/练习权力。
- 手动 `POST /v1/words` 只接受 Web Cookie + 固定 Origin + CSRF + Idempotency-Key；请求不能提交 owner、
  ID、canonical key、sourceType 或 observedAt。服务器固定 manual 来源并在 owner forced-RLS transaction
  内规范化、去重和写快照；未来 Eudic import 必须走独立 Extension session/lease 入口，不能借手动接口
  伪造外部来源。
- 所有 AnalysisRecord 历史 mutation 只接受 Web Cookie + Origin + CSRF，并在一个数据库事务内校验
  owner、幂等 hash 与 expected revision。Extension 只能写 StudyCapture/CloudWordCopy，不能维护历史。
  revision/idempotency 冲突不会产生部分归档、处理或删除。
- 候选确认只接受 Web Cookie/CSRF，并在 SECURITY DEFINER 幂等入口后由强制 RLS
  事务校验 analysis、candidate 和 merge target 的 owner/type/canonical key。该内部入口只接受固定
  `analysis.confirm` operation，撤销 PUBLIC/业务角色执行权；客户端不能借 candidate/target UUID
  跨租户读取、合并或把部分批次写入。
- Hosted Web 的 Vercel 静态响应必须在所有 path 上统一返回 CSP、`Referrer-Policy: no-referrer`、
  `X-Content-Type-Options: nosniff` 和禁止 camera/microphone/geolocation 的 `Permissions-Policy`。CSP
  默认只允许同源脚本、样式、字体和 manifest；图片只额外允许 `data:`；frame、object、worker 与
  frame ancestor 全部禁用。`connect-src` 只额外允许冻结的 exact API origin；`form-action` 除 API 外只
  允许实际 OAuth 302 链需要的 exact Supabase project origin 与 `https://accounts.google.com`，因为 Chrome
  可能继续对表单提交后的 redirect 执行该指令。不得使用 wildcard，也不得把两个 Provider origin 加入
  script/connect allowlist。当前 acceptance API 与 Supabase project 精确固定；正式 production origin/
  project 尚未冻结，不得猜测写入，发布前必须校准并重跑认证旅程。
- 本阶段不设置 Cross-Origin-Opener-Policy。当前 Google 流程包含跨 origin 顶层导航，未来可能使用需要
  opener 互操作的 OAuth popup；在没有浏览器回归证明前加入 COOP 会扩大兼容性风险。它必须作为独立安全
  变更评估，不能顺手附加到本次明确缺失响应头修复。

## 3. 内容与模型安全

- prompt 以固定系统说明和标记边界包含用户文本，明确文本中的指令只是待分析内容。模型不连接工具、
  URL 或数据库。
- 输出先做字节、深度、数组长度和字符串长度限制，再 JSON 解析和严格 Schema。未知字段、HTML
  控制意图、错误 sentence ID 或越界 candidate 引用均失败关闭。
- Provider candidate ID 仅是严格 private output 内的 alias；可信 Analysis module 为公共候选分配服务器
  UUID 并原子改写所有 result 引用。Provider 不能选择数据库主键，浏览器也不能提交候选 identity。
- 客户端只以文本节点或安全 Markdown 子集呈现；禁止模型 HTML、事件属性、脚本 URL、远程模块、
  `eval`、`new Function` 和动态代码下载。
- preview 不持久化、不可收藏。最终结果在校验后落库；结构修复只能接收原始有界 JSON 并输出同一
  schema，不重新解释网页任务。
- Web 粘贴分析只构造严格 `source.type=manual` 请求，不接受 owner、Provider、model、quota 或任意
  endpoint 字段，也不接受 action 或 word。StudyCapture 分析由 path capture 与服务器关系固定
  `source.type=study-capture`，客户端不能伪造网页/YouTube 来源。Cookie 和 CSRF proof 仍由固定 API
  adapter 注入。preview 只在页面内存展示，不进
  持久存储或收藏权威。AbortSignal 只终止当前页面读取，运行代次同时丢弃取消后的迟到事件；它不
  伪装成服务器撤销，也不改变服务器最终 AnalysisRecord 权威。
- `reasoning_content` 在 adapter 内丢弃，绝不传客户端、落库或记录。

## 4. 凭据与 DeviceVault

- 平台密钥仅存在 Vercel API 环境；生产启动校验必需环境变量，但诊断只能列出缺失变量名。
- BYOK 与欧路凭据只存在 Extension DeviceVault，并只发给用户选择的固定供应商 origin。Huayi API
  不接受这些字段，strict schema 会拒绝 `apiKey`、`authorization`、`baseUrl` 和任意 Header。
- BYOK 模型路由与 Huayi 数据动作分别授权。账号 mode=byok 不代表 Huayi 自动收不到用户主动开启的
  StudyCapture、CloudWordCopy 或云端外部词典任务；公开披露与 UI 必须分别列出接收方和字段。
- 外部词典云任务只把 server-created 有界 export payload 发给已配对 Extension。Eudic 导出只有 headword
  与可选原句；Shanbay 只有 headword。lease token 只在 Service Worker/独立加密 lease vault 中存在，
  Shanbay Content Script 只看到随机本机别名。Web、Options DOM、Popup 和日志不显示 payload 或回执正文。
- DeviceVault 的设备 DEK 与密文同处 Chrome Profile，因此只提供静态纵深保护，不宣称抵抗整个
  Profile 或运行中可信 Worker 被攻破。
- 退出账号会删除 Extension session；删除 BYOK/欧路凭据是独立显式动作，避免退出意外破坏本机
  配置。卸载由 Chrome 清理扩展存储。

## 5. 配额与滥用

- 邀请制不能替代限速。Vercel 部署以平台覆盖的 `x-vercel-forwarded-for` 为可信客户端 IP；登录、邀请、
  配对、导出和模型端点分别按 pepper hash 后的 IP、账号和设备执行窗口限制。当前 Phase 3 已接入邀请、
  Google/密码登录与配对创建/轮询/交换，其余入口在对应纵向切片实现时接入同一 port。
- 模型请求先取得持久的 owner/key 请求声明和 4 分钟生成租约，再持有用户 advisory lock 与 5 分钟
  费用预留；可结构修复的 adapter 在同一个 90 秒应用 deadline 内最多调用 Provider 两次，预留和租约
  是崩溃恢复窗口而不是 Function 时长。完成、失败和过期恢复均按
  request→reservation 的固定锁序执行，租约 token 在任何记录/账本写入前 fencing 陈旧 worker。
- Vercel API 显式使用 Fluid Compute 与 120 秒入口上限。平台时长必须晚于 90 秒应用 abort 并留出终态
  写入余量，但不得被当成新的 Provider deadline；平台提前终止仍由 durable dispatch、保守结算和 cleanup
  恢复。配置与离线/真实部署证据边界见 `vercel-fluid-function-duration.md`。
- 租约过期不自动重跑可能已计费的供应商调用；恢复只使用请求固定的价格版本和预分配账本 ID，原子
  保守结算并写可重放失败。跨租户状态查询由 RLS 隔离，同 key 不同正文在 SSE 前失败关闭。
- Provider 已返回 usage 后的 trusted assembly 或数据库 commit 失败，失败路径必须保留同一 billed calls、
  usage 和实际成本；不得回退到可能超过 reservation 的默认成本并让 settlement 再次失败。
- quota summary 必须在已设置 owner context 的业务 tenant transaction 内通过 forced RLS 读取；不得让
  context-setter/trusted 角色直接查询 quota 表。当前月 grant 的惰性确保只经校验参数等于 current owner
  的窄函数调用；该函数只授 context-setter，PUBLIC/business/runtime 无执行权。预检失败后的 terminal
  event 依赖同一安全摘要路径，权限错误不能把已声明请求留在 `running`。只允许恢复函数回收租约已
  过期且归属精确匹配的请求。
- 账本只追加，价格快照不可回写。缺失 usage 保守扣预留；运营人员只能增加新 grant，不能删除历史
  消耗。
- `model_rate_limit_events` 只保存 owner、request ID 和时间，不保存正文、Provider 请求或输出；表启用并
  强制 RLS，但不授 PUBLIC、business、context-setter 或 runtime 表权限。只有 `reserve_quota` 在用户锁和
  quota 检查后原子写入；active request replay 在计数前返回，quota 拒绝回滚且不产生限速事件。
- 全局 kill switch、单账号停用和 Extension session 撤销必须独立生效；kill switch 不影响导出、
  删除和查看既有数据。
- 本机验收是唯一部署例外：bootstrap 关闭 kill switch 只为固定、零网络、页面持续标识的模拟 Adapter；
  它不读取 DeepSeek key，也不能访问第三方网络。hosted acceptance 与 production 不复用该 bootstrap，
  foundation 必须显式建立 `model_kill_switch=true`，只创建 NOBYPASSRLS application login、不可变价格和
  private bucket；Auth、profile、Operator 与邀请保持为空。首个真实 Operator 只能经两阶段
  FirstOperatorBootstrap 建立：项目管理员发行唯一 BootstrapInvitation，正常 Auth/finalization 后只晋升
  该邀请绑定的唯一账号。私有 record 与邀请生命周期记录部署动作，不把 DeploymentBootstrapAuthority
  伪装成 OperationalAuditEvent actor；不能复制 `.localhost` seed、接受任意 userId、创建公开 route 或以
  service-role session 代替。完成后协议永久封闭。
- FirstOperatorBootstrap record 不得以外键阻止 AccountDataErasure。首位账号删除前只清除 record 的
  operator user UUID 并写 deletion time；保留的 completion/invitation deployment evidence 不含 email、正文、
  Auth identity 或 session，也不能再次执行 issue/complete。
- hosted/production 管理脚本与 application runtime 数据库连接必须固定 Supabase transaction pooler、
  `6543`、`/postgres`、同一 project ref 与 `sslmode=verify-full`；application 隔离验证器是唯一例外，只用
  session pooler `5432` 保证同一 psql 连接跨事务复用 backend，不能作为 runtime DSN。两类连接都显式加载
  Supabase CA、启用证书链和 hostname 校验。`sslmode=require` 只保证加密而不满足身份验证；CA 缺失、
  project ref 不一致、端口用途漂移或本机验收 DSN 漂移都失败关闭。`pg_stat_ssl` 在 Supavisor 后只能观察
  pooler 到 PostgreSQL 的 backend 链路，不能作为客户端 TLS 证据；客户端门禁由强制 verify-full、固定 CA
  和成功连接共同证明。application login 只能精确继承 runtime→business/context-setter，不得有 ADMIN
  OPTION、额外 membership、public CREATE、直接 context setter 或切换 `postgres` 的能力；其中精确角色
  图、额外 membership 与 ADMIN OPTION 由 foundation 管理员 verify 证明，application verify 只证明登录
  账号实际可见的 runtime 能力面与越权拒绝，连接失败不能作为越权测试成功。owner context 还必须在 session pooler 的前一事务提交后，于同一 backend 的下一
  事务为空。
- disabled 账号重新认证后只能取得 `DataRightsSession`；普通 session/authenticate seam 仍严格要求
  active+full。受限会话不能访问分析、学习库、练习、生词、设备或管理端点，deleting 不创建会话。
- 普通 Google login flow 没有 claim ticket，只允许 Supabase 返回的既有 user ID；不得自动创建 profile、
  消费 invitation、绑定另一个 identity 或把 callback 错误细节/邮箱放入 URL 与日志。

## 6. 日志、监控与管理员

- 允许日志字段：request ID、route name、客户端版本、稳定错误码、状态、时延、模型/价格版本、token
  数和 micro-USD。禁止 sourceText、title、answer、turn、result、prompt、cookie、token、email 明文、
  URL、第三方响应和堆栈中的请求对象。
- 错误监控发送前使用白名单序列化；禁止自动捕获 request body、breadcrumb 输入或 DOM replay。
- 管理页只有运营元数据，不实现正文搜索、代登录或任意 SQL。紧急排障依赖 request ID 和无正文指标。
- 审计记录管理员的邀请、启停、额度和设备撤销动作，不记录秘密或用户正文。
- 普通邀请的一次性 fragment 只在创建响应后的组件内存显示。链接丢失时不得从数据库、日志或幂等
  snapshot 还原明文；Operator 重新认证后只读取白名单生命周期时间戳，撤销对应“可领取”邀请，再按需
  创建新邀请。无法唯一定位时先撤销所有可能受影响的可领取邀请，不能留下未知有效链接。确认发起撤销
  当前邀请时立即清除组件内的一次性输出；响应不确定时先重读权威状态，期间不再显示撤销按钮。已领取、
  已撤销和已过期项也不提供撤销按钮。
- Operator GET 只接受 active/full Cookie session、显式 operator role 和 15 分钟内重新认证；mutation 另
  要求固定 Origin、CSRF 与 Idempotency-Key。DataRightsSession 和 Extension token 不能访问管理端。
- `/admin` 对首次统一 `forbidden` 只提供既有 password reauthentication，不在客户端推断是角色缺失还是
  recent-auth 过期。密码只存在于受控输入和组件内存，不进入 URL、日志、状态文案或 Web Storage；成功
  必须轮换 CSRF 并重新请求服务端 access，第二次仍拒绝即显示统一无权限页，不得绕过 API 安全门。
  邀请 token 由服务端 secret 与 actor/key/strict request hash 派生，数据库只保存 hash；幂等 snapshot
  和审计都不得保存明文 token。停用只能 active→disabled，并原子撤销 Web/Extension session 与未完成 pairing；deleting
  不能由管理端恢复，Operator 不能停用自己。

## 7. 保留、导出与删除

- 正式 AnalysisRecord、LearningItem、WordEntry 和 PracticeSession 保留至用户删除；归档不改变保留。
- LearningItem 归档不删除正文、排期或练习关系，账号导出仍包含其 `archivedAt` 与完整公开记录；UI 和
  隐私材料不得把归档称为删除。归档项不能通过旧队列或直接 ID 创建新 session，session-create transaction
  必须重验 active。
- LearningItemErasure 只对已归档且没有非终态/未自评/活跃 lease 引用的项目开放；它清除正文、canonical
  key、来源、标签、系统属性和排期，只保留 owner+opaque ID+时间的关系墓碑。墓碑不进入学习库或账号
  导出，PracticeSession 只暴露 `learningItemDeletedAt`，不得泄露引用数量或 session ID。删除最后一条引用
  session 后墓碑清理；整账号删除最终清除两者。
- ExtensionQueryGeneration 的正文/compact result 在终态后最多保留一小时，之后硬删；无正文 UsageLedger
  继续按运营/合规策略保留。完整 AccountDataExport 的 owner snapshot 可包含当时尚未过期的公开临时
  查询内容；导出对象是用户主动创建、最多保留 24 小时的独立私有副本，可能晚于原 generation 删除，
  但不得延长原 generation expiry、建立可浏览查询历史或包含 session、lease、reservation、
  idempotency/request hash。StudyCapture 保留到用户删除，analyzed 状态仍作为 exact dedupe anchor。
- ExtensionQuery 在 Provider HTTP 前必须 durable 写 `dispatched_at`。lease 过期但未 dispatch 只能释放
  reservation、零 UsageLedger；已 dispatch 则按预留上限保守结算并终态化，任何路径都不得透明二次调用。
  定时清理使用固定 CRON_SECRET、常量时间比较、每批 100 条和 `SKIP LOCKED`；公开响应只有两个计数，
  不允许 owner、sourceText、result、quota、reservation/lease 或原始错误进入 cron 响应/日志。
- production 的五个 minute trigger 由 Supabase `pg_cron + pg_net` 调用既有 HTTPS route；私有
  security-definer adapter 只接受五个精确 path，从 Vault 运行时读取 HTTPS API origin 与 32–512 字符
  secret，固定 search_path 且不向 `PUBLIC`、业务角色或 service role 授予执行权。Vercel Hobby 配置不再
  承载高频 cron；SQL、job 名、轮换和停用边界见 `vercel-hobby-supabase-cron.md`。
- Extension SubmissionOutbox 最多 20 条/5 MiB、7 天后硬删除；配对码 10 分钟、邀请 72 小时、
  AccountDataExport 私有对象 ready 后设置 24 小时 expiry、单个下载地址最长 15 分钟。到期先停止签发，
  清理失败只保留内部 key 并告警重试。幂等记录默认保留
  7 天，账本和安全审计按运营/合规策略另行固定。
- Cloud SubmissionOutbox 与外部词典 outbox 使用不同 storage key、严格 envelope 和 AAD；前者只由
  Service Worker 组合，以 DeviceVault DEK 加密 strict StudyCapture/CloudWordCopy。Content Script、Options、
  Popup 消息和日志都不能读取 payload、幂等键或 session token。认证失败、session 过期、本机断开和
  新 session 建立会清空队列，防止旧账号正文由新账号提交；远程撤销在下一次固定 API 提交的 401/403
  被发现。用户撤回联网同意后，alarm 在发出任何请求前清除剩余正文。
- 本机词库批量导入另用独立的 Service Worker-only 加密任务与 AAD，不与 SubmissionOutbox 混存。Options
  只能发送无正文的 preview/confirm/retry/status 命令并观察词条数、语境数、批次进度和聚合 outcome；
  完整词条快照、稳定 batch Idempotency-Key、session token 与原始错误不能进入 Options DOM/消息或日志。
  确认前必须重新快照并验证 previewId，防止用户确认后本机内容悄然变化。断开、换号、session 失效或
  撤回联网同意时，在下一次网络动作前清除该账号绑定任务正文。
- 426 只在加密 outbox state 内增加触发阻塞的客户端版本；公开消息仅投影升级枚举、条数和最早时间，
  不返回服务器最低版本、响应正文或 URL。同版本 `process()` 必须 fail-before-fetch，版本变化仅解除
  本地阻塞并允许重新探测，不代表服务器已接受。
- 外部词典的正式 outbox 位于 CloudAuthority；本机 `ExternalWordbookLeaseVault` 只保存 Shanbay 当前
  云租约到本机别名的有界映射，不是第二任务权威。租约 token 以独立 HMAC 上下文绑定 job/kind/nonce/
  expiry，服务器只保存 nonce hash 与 expiry；新租约 fencing 旧 worker。取消后的 export 迟到回执只记录
  已经发生的第三方副作用，取消后的 import 页不得继续创建 WordEntry。
- Popup 的 SubmissionOutbox 管理消息只接受本扩展精确 `popup.html` sender 和无参数固定命令；响应
  只含有界状态、结果、条数与规范 ISO 最早时间。升级状态也不含客户端/服务器版本。清空必须在 Popup
  二次确认，但 Service Worker 仍将
  命令权限限制在可信 Popup；联网同意撤回或 session 无效时，状态读取也清除旧账号绑定 payload。
  网络/API/版本暂不可用只进入 blocked/retry 并保留有效 session 的密文。不得返回原始错误、正文、结果、
  幂等键、session token、storage key、路径或 URL。
- 账号导出不包含凭据、session、token hash、内部审计、模型隐藏推理或其他用户数据。
- 账号删除立即使所有 session 失效，主库 24 小时内完成硬删除。备份残留期限必须在生产 Supabase
  策略确认后写入公开隐私政策；无法验证前不得填写猜测数字。
- Supabase service-role 仅封装在 private Storage/Auth Admin adapter，不得作为 RLS 业务读取通道；worker
  secret、object key、signed URL、subject UUID 和内部 stage 不进入日志或公开 job。数据权利 worker 使用
  lease fencing；导出分析记录只能调用 owner-scoped private wrapper，由它匹配显式 owner 与当前 owner
  context。仅凭 record ID 的底层 serializer 不授权 context/business 角色，只供受信数据库函数内部互调；
  删除完成后运营任务必须清除直接 subject UUID。详见 `account-data-rights.md`。
- 删除请求 receipt replay 只保存高熵 session 的 pepper hash，并同时绑定 idempotency key/body hash；旧
  Cookie 只能在完成后 24 小时内取得固定 accepted 响应，不能恢复 session、读取任务或访问普通 API。

## 8. 密码注册确认与中断恢复

- Confirm sign up 邮件不得直接链接可被 scanner 消费的 Supabase `ConfirmationURL`；只显示六位 OTP，
  CTA 指向 query 严格、GET 无副作用的语见确认页。OTP/email/password 不进入 URL、日志、Referer、
  Storage 或错误响应。
- OTP 仅在用户显式 `application/x-www-form-urlencoded` POST 后交给 Supabase `verifyOtp(type=email)`；
  GET/reload/prefetch 不调用 Provider 或数据库。错误统一返回无 Provider 细节、输入留空的可重试页面。
- Hosted `mailer_otp_length` 必须由固定项目只读门禁精确验证为 6；受控修正只允许已观察到的 8→6，PATCH
  body 只能包含该字段，并在独立 GET 中证明其他 Auth 配置未漂移。不得用整份 config push 覆盖 Site URL、
  Redirect URLs、模板、SMTP 或 expiry。
- `POST /v1/auth/password/register/resend` 只接受 Web 内存自动提交的原 invitation token；strict body 不接收
  email、password、OTP 或 flow，固定响应不披露账号状态。API 在 IP 每小时 5 次、pepper-hashed invitation
  每小时 3 次门后，先原子轮换同一 claim/flow，再调用 Supabase signup resend；Provider 失败不建
  profile/session/第二用户，并允许后续受限重试。
- 确认页 `form-action` 只允许 `'self'` 和精确配置的 Web origin；后者用于允许 API 完成 POST 后跳转
  Web 工作台，禁止通配域名。
- 已绑定 Provider user 的过期 invitation claim 是恢复证据，不能由普通重新领取删除。恢复同时要求原
  invitation token、Provider 密码证明和数据库精确中断状态；Provider user id/email 只取服务器 session。
- `resume_interrupted_password_registration` 只授予 context setter，在单事务内检查邀请/claim/flow/Auth
  identity/零账号数据后创建 profile、password method、default quota 并消费旧状态；失败不得部分写入。
- `renew_interrupted_password_confirmation` 同样只授予 context setter。它只接受 active invitation、唯一
  bound unfinished claim、唯一未消费 invite-registration flow、未确认且只有 email identity 的 Auth user
  和零业务账号数据；claim 的 `bound_email` 必须由 `bind_auth_identity` 从 Auth user 服务端派生并与
  当前 Auth email 精确一致。它只更新同一 claim 的 expiry 并替换同一 flow hash，旧 CTA 立即失效，
  绝不创建第二 invitation/claim/flow/user/identity。
- Hosted 恢复不要求用户识别、复制或输入原邀请 token。token 留在原邀请 URL fragment 与 Web 内存，恢复
  提交时由 Web 自动传给 API；API 使用当前 Production pepper 计算 hash，0013 在任何写入前同时要求精确
  `registration-interrupted`、active Bootstrap invitation 与 hash equality。任何错配均失败关闭且零部分
  写入；不得打印 pepper、token、hash、DSN、email、user id、OTP 或密码。
- `acceptance:hosted:operator:pepper:verify` 仅是具有安全 managed token source 时的可选工程诊断，不是
  用户验收步骤，也不得把 opaque token 手工输入变成运维要求。

## 9. Chrome Web Store

- Extension 的单一用途是对当前英文内容提供就地翻译/解释，并按用户动作/账号偏好把原始学习采集或
  生词副本交给同一华译学习工作台；它不上传 compact BYOK result，Web 不提供远程脚本或替换扩展代码。
- 所有脚本、wasm、字体和样式随包发布。固定 API origin 只交换数据，不下载可执行逻辑。
- 登录 Extension 的业务请求除高熵 session token 外，还必须由浏览器提供精确发布
  `chrome-extension://<id>` Origin，并携带 manifest 三段版本。API 在查询 token 归属前验证固定 Origin
  与最低版本；Origin/版本只是 defense-in-depth，不能替代 token。不得接受通配 Extension Origin。
- Store capability 是必填的 fail-closed 部署开关。`disabled` 必须没有 Extension ID，并从 CORS、配对/
  设备和 Store 专用 production composition 移除 Extension surface；混合路由也在 identity 查询前拒绝
  任意 Extension authorization。`enabled` 才允许配置精确 ID，不能以占位 ID 模拟禁用。
- Manifest 权限逐项绑定用户可见功能；实现结束后由打包检查证明无未使用权限、任意 host、动态代码
  或秘密。
- 首次把网页内容发送 Huayi API 前重新展示接收方、字段、用途、费用与保留；用户撤回后平台查询、
  StudyCapture、CloudWordCopy 和云任务立即停止并清除待提交正文。BYOK 查询仍只受对应 Provider 同意
  控制，撤回 Huayi 数据同意不会删除本机词库或 BYOK/欧路凭据。

## 10. 发布前未决的外部事实

隔离验收环境是 production 前的强制安全门：local 只绑定 loopback 受信任 HTTPS，hosted acceptance
使用独立数据库/Auth/Storage/OAuth client/secret/Provider Key/额度且不复制 production 数据。hosted
acceptance 首选自有根域下的同站 Web/API 子域并保持精确 CORS/Origin/CSRF；无域名时才通过单一 gateway
origin 代理 Web/API。两者都不把 Cookie 改为 `SameSite=None`，也不把 service role 或 bootstrap secret
暴露为 HTTP route。Resend key 只进入 hosted secret store，验收 `notify.acceptance` 与 production
`notify` 分离；Supabase Auth SMTP credential 不复用 R3-C HTTP sender key。R3-C 仓库代码固定 23 小时
deadline、8 次上限、failed/dead-letter、notification-ID 幂等键、独立 bearer route/第五个 Cron 和仅含
reason/count 的 alert port；本机模式被固定 localhost origin 限定且零发送。DNS/SMTP 验证仍不能替代
真实 Resend 投递与监控接收方验收。acceptance Store Manifest 使用独立固定开发 key/ID 和精确
host/CSP，不能污染发布 Manifest。完整边界见 `user-acceptance-environment.md`。

以下不是产品决策，必须以真实环境验证后补入发布材料：Vercel/Supabase 新加坡实际部署与网络延迟、
Google OAuth 在目标网络的可达性、Supabase 备份残留、DeepSeek 当前模型 ID/价格/JSON 与 usage
契约、生产 Extension ID、Chrome 数据披露问卷和公开隐私政策 URL。
