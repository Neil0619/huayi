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
  flow。Provider session state 加密，邮件 callback 的 flow/token hash 单次且短时，成功只签发 15 分钟 path-scoped
  recovery Cookie；该 Cookie 只能读取无身份字段的 CSRF/expiry 并完成一次改密，不能读取账号资源或变成
  Huayi session。complete 在 Provider 前锁定 owner/status/method/Origin/CSRF/lease，Provider user/email
  必须匹配；成功清 Cookie、撤销全部 Huayi Web/Extension sessions并写耐久安全通知。日志不含 email/hash、
  flow/code、Cookie/CSRF、auth state、Provider error 或密码。Web 可预先陈述“新密码必须与当前密码
  不同”这一恒真约束，但 `same_password` 仍与其他 Provider 失败统一收敛，不能形成密码相等性探测信号。
  start 不等待外部网络，有效且未限速的 202 固定至少 250ms handler floor；trusted worker 在发信前耐久
  标记 dispatch，可能已发信的丢失任务不得自动重发，以满足统一响应时间并避免邮件轰炸。安全通知使用
  独立 120 秒 lease 和有界退避；sender 必须
  用 outbox notification ID 做厂商幂等键，避免邮件成功而本地 complete 失败后的重复投递。完整矩阵见
  `password-recovery.md`。
- 恢复邮件模板不得使用会先消费 Supabase PKCE flow 的 `ConfirmationURL`；只允许精确
  `RedirectTo + TokenHash` 到语见 GET。GET 不直接验证 Provider token hash，而只返回无脚本/外链、CSP 将 `form-action` 限定为
  `'self'` 与精确配置的 Web origin 的惰性确认页；后者只允许 Chrome 跟随 API callback 到 Web 的固定
  302。用户显式 POST exact flow+code 表单后才调用 `verifyOtp(type=recovery)` 消费单次 token hash。confirm/callback 均
  no-store/no-referrer，目标固定，降低邮件 scanner 抢先消费和 Referer 泄漏风险。
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
- Popup 与 Options 共用受限的 `store/cloud-session-*` 入口，不从 Web 复制 Cookie 或登录凭据。
  “管理同步任务”只允许 `store/open-web-workspace` 的固定可选目标 `wordbooks`，映射到已验证 HTTPS
  工作台 origin 的 `/words/wordbooks`，拒绝任意 URL、未知字段和其他扩展 sender。内部消息仍为
  v5，旧消息省略目标继续打开既有工作台入口；不新增 Chrome 权限。
- 外观／网站规则刷新广播只接受当前扩展精确的 `/options.html` 或 `/popup.html`，拒绝 query、fragment、
  其他页面和网页 sender；广播只携带重新读取信号，不携带域名、页面内容或设置值。
- 手动网站规则只存 URL 解析后的规范域名，不存 path/query/userinfo；输入 URL 不发起网络请求。
  离线公共后缀表阻止对 `com`、`co.uk`、`github.io` 等后缀整体建规则；IP 与 localhost 只支持精确匹配。
  全局停用始终优先于单站例外，现有配置格式、256 条限制及本机历史规则保持不变。
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
- Hosted acceptance 运维凭据与部署 runtime secret 分离。Supabase 管理员/application 数据库密码、
  Supabase management PAT 与 Vercel Token 只存在 macOS login Keychain 的固定 service/account；共享
  consumer 可注入，其他平台固定 unsupported，禁止 `.env`、环境变量、stdin 或明文文件回退。
- Hosted Token 只进入本次操作内存与固定 HTTP Authorization header。数据库密码只进入 `0700` 临时目录
  的 `0600 .pgpass`；子进程只取得 `PGPASSFILE`，成功、失败、timeout 和终止信号后均清理。Keychain
  `present/available` 不是连接、migration、backup、restore、Cron、deployment 或 smoke 的授权。
- Hosted DeepSeek one-shot 的 HMAC keyring 使用同一 Keychain service 下独立的内部 account
  `deepseek-one-shot-hmac-keyring`，不从数据库密码、PAT 或 Vercel Token 派生。keyring 只保存 active 与有界
  retained version，执行器可在明确 execute 时首次创建，recover 缺失时失败关闭，status 不读取密钥。
- Hosted release state 只允许固定 candidate/release、随机非秘密 attempt、workflow/deployment identity 与 phase，
  不保存凭据、
  URL、远端正文或环境值。Vercel Token 仅在当前进程 HTTP header 中；质量门子进程获得显式 allowlist
  environment，不继承数据库密码、PAT、Token 或 Provider key。acceptance Store manifest/profile 与公开
  release manifest 分离，后者不得获得 Hosted origin 权限或 acceptance key。
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
- 插件平台查询的输出校验诊断额外允许服务端生成 UUID、固定结果类型、initial/repair 尝试、固定
  json/schema/assembled-result 阶段及最多 8 条字段路径和原因码。字段路径仅来自受信任 Schema，
  数组索引与路径深度有界；未知键名、实际字段值、Zod message/received/keys 和 JSON 解析异常均不写日志。
  诊断沿用生成编号关联，不写入公开查询事件或数据库正文。日志写入失败不改变修复、结果或计费。
  同一份脱敏校验反馈只在既有一次结构修复中提供给 Provider；原始无效输出以有界 JSON 字符串标记为
  不可信数据，不作为系统指令。修复后仍执行完整 Schema 校验，不增加自动调用次数。
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
  承载高频 cron；API 五条 route 共用常量时间 Bearer 认证，认证失败和成功都固定
  `Cache-Control: private, no-store`，401 不调用 worker。SQL、job 名、轮换和停用边界见
  `vercel-hobby-supabase-cron.md`。
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

### 7.1 Production logical-backup restore drill

- production raw archive 只能恢复到批准后新建、同组织/同区/同 PostgreSQL major、无 Vercel/DNS/SMTP/
  OAuth/Cron/Vault/Edge/Provider 的临时 Supabase recovery project；它不是 development 环境。禁止恢复到
  production，也禁止把 archive/row sample/plaintext SQL 复制到 fixture、日志、聊天、工单、Git 或共享
  object store；
- source manifest 必须绑定 full commit、migration head、archive/manifest/TOC SHA-256、`0700/0600` mode、
  coverage profile 与 retention deadline。global roles、source login/password、Auth/SMTP/OAuth/JWT、DNS、
  Vercel environment 和 platform config 永不恢复；target role/ACL 由 target-local fixed contract 重建；
- target-empty proof 必须在任何写入前确认 Auth/identity、Storage object、product schema/ledger/data 为空且
  outbound surface absent。恢复后只保存 RLS/Auth/admin/application-role 布尔量和以一次性进程内 HMAC key
  计算的 source/target count digest；不保存逐表计数、email、UUID、object key、正文、token/hash 或 SQL；
- Storage metadata 属于 database archive；Storage object bytes 始终是独立加密 export/restore。source object
  非零而独立 manifest/bytes 未恢复时，不能声明完整恢复；
- source 管理密码与 management token 分别读取固定 Keychain account；临时 recovery target 管理密码继续
  只从专用 TTY 隐藏读取。数据库密码进入固定 `0600 .pgpass`；management token 不进入 child environment，
  production management adapter 只能经受控 HTTP port 使用。secret 不进入 argv、环境、stdout/stderr、日志
  或 evidence；
- 无论成功或失败都必须删除 recovery project、撤销 drill credential、清理精确 container/temp 并回读
  target absent。archive 到已批准 retention deadline 后删除并留下 body-free disposition evidence；期限和
  隐私披露未决时失败关闭。完整 lifecycle 与 exact JSON keys 见
  `hosted-logical-backup-restore-drill.md`。

### 7.2 Hosted 重要批次 capture 密码边界

- Hosted pre/post capture 的 Supabase 管理员数据库密码只从固定 Keychain account 读取；本地 shape gate 以 Supabase
  建议的至少 12 个字符为下限，独立保留 512 字符安全上限，并拒绝 NUL、CR、LF。密码只进入
  `0600 .pgpass`。该边界不得复用于 application 数据库密码，后者继续保持独立的 32+ 字符契约。

### 7.3 Hosted DeepSeek stale backup 不可变退役边界

- `hosted-deepseek-0016-0021` 的 stale `pre` raw dump 与 matching rebuild evidence 只能作为一个单元保留；
  不得删除、覆盖、分别搬运、修改 candidate 或复制回 active batch。专用 exact-confirmation 入口不读取
  Hosted、TTY、密码、Keychain、环境 secret 或数据库状态，只运行有界 Git 与本地 evidence filesystem I/O；
- mutation 前必须证明 clean `HEAD==upstream`、active/history 窄 root 均 ignored、active 精确只有 strict
  `pre + rebuild` 且 `post` absent、两份 manifest 同一 stale commit、全部目录/文件为 `0700/0600` 普通对象，
  并由 Git 证明历史 commit 存在且是当前 HEAD ancestor。current/mixed/malformed/unknown/symlink/non-ancestor
  或 occupied destination 均失败关闭；
- 工具以 private candidate reservation 防覆盖，把整个 active batch 一次原子 rename 到固定
  history/batch/stale/evidence 层级，`fsync` 两侧目录并从 history 再严格验 hash/manifest。失败不得删除 dump，
  active/history 至少一侧保留完整 evidence；retained history 删除没有入口。成功后的 active absent 只允许
  既有不可覆盖 writer 为当前 candidate 重新建立 evidence，不降低 current preflight 门。

## 8. 密码注册确认与中断恢复

- Confirm sign up 邮件不得直接链接可被 scanner 消费的 Supabase `ConfirmationURL`；只显示六位 OTP，
  CTA 指向 query 严格、GET 无副作用的语见确认页。OTP/email/password 不进入 URL、日志、Referer、
  Storage 或错误响应。
- OTP 仅在用户显式 `application/x-www-form-urlencoded` POST 后交给 Supabase `verifyOtp(type=email)`；
  GET/reload/prefetch 不调用 Provider 或数据库。错误统一返回无 Provider 细节、输入留空的可重试页面。
- Hosted `mailer_otp_length` 必须由固定项目只读门禁精确验证为 6；受控修正只允许已观察到的 8→6，PATCH
  body 只能包含该字段，并在独立 GET 中证明其他 Auth 配置未漂移。不得用整份 config push 覆盖 Site URL、
  Redirect URLs、模板、SMTP 或 expiry。
- status/apply 固定失败后的 Auth config diagnostic 只允许同一固定项目 GET、禁止 redirect、10 秒超时与
  1,000,000 字节响应上限。它只能输出 Token 格式、请求到达、三位 HTTP 状态、JSON record、
  `six|eight|other|missing|not_run` OTP 分类和最终契约；无效 Token 必须零请求，任何异常不得反射 Token、原始响应、
  其他 Auth 字段或底层错误。diagnostic 不得执行 PATCH，也不能替代正式 status 成功证据。
- 0014 实际数据库写入只能由 exact-confirmation apply 入口执行。入口必须先通过绑定 clean candidate 的
  pre-backup/rebuild preflight，同一执行内只 dry-run 唯一 0014，并在 mutation 前重查 evidence 与两份
  migration mirror 的固定 SHA-256；管理员密码从固定 Keychain account 读取，只进入 `0600` 临时
  `.pgpass`，child 只取得 `PGPASSFILE`；公开 CA 只进 `0600` 临时文件。写后只读 postflight 必须验证完整 migration chain、bound column/check、函数 security
  identity 与 exact ACL；apply 或 postflight 不确定时固定禁止盲目重试，避免重复 forward migration。
- apply 返回未验证后只能运行固定 `acceptance:hosted:migration:0014:status`。该入口拒绝继承
  `PGPASSWORD` / `SUPABASE_DB_PASSWORD`，在内部固定官方 CA、Keychain 管理员密码、Singapore transaction
  pooler `6543` 与 verify-full，并只执行一个 `BEGIN READ ONLY` catalog snapshot。只有完整 14-chain + exact
  0014 artifacts/ACL 才是 `applied-exact`；只有完整 13-chain + 0014 artifacts 全部 absent 才是
  `pending-exact`；连接、进程、输出、半应用或 catalog 漂移均固定为 `uncertain`，不得反射数据库原始输出，
  也不得据此重试 apply。
- `status` 返回 `uncertain` 时只允许固定 `acceptance:hosted:migration:0014:status:diagnose`：沿用 official CA、
  Keychain account、transaction pooler `6543`、verify-full、`connect_timeout=10`、30 秒上限和 `BEGIN READ ONLY`，
  公开输出只能包含 allowlisted psql exit class、output exact、12 个核心 catalog `t/f`、bind/renew 各 10 个
  固定 ACL 分解 `t/f`、4 个 Data API roles / 全部 public SECURITY DEFINER 函数全局 `t/f` 与 final status。
  ACL 分解只允许固定的 setter/business/runtime、owner、`PUBLIC`、
  `anon`、`authenticated`、`service_role` 和 other 类别；数据库 stderr、raw ACL/OID/未知角色名、密码和 URL
  不得进入输出，函数名也不得输出；诊断结论不授权任何 Hosted 写入。Supabase 既有项目可能自动给
  public-schema 函数的 API
  roles 授予 `EXECUTE`，所以 SECURITY DEFINER 函数必须显式验证并撤销这些边，不能只撤销 `PUBLIC`。
- 真实 6543 ACL 分解已确认 0014 完整应用、Huayi role 权限正确，漂移精确为 `anon`、`authenticated`、
  `service_role` direct `EXECUTE`，且全体 public SECURITY DEFINER 的 API-role 谓词失败。禁止重跑 0014；
  只能由 forward-only 0015 在一条事务内从全部现有 public functions 撤销 PUBLIC/三个 API roles，并保留
  未列入集合的 owner/Huayi direct grants。
- 后续函数的安全默认必须同时处理两个 scope：owner=`postgres` 的 global default ACL 撤销 PUBLIC 与三个
  API roles，public per-schema default ACL 再撤销三个 API roles。PostgreSQL 明确 per-schema REVOKE 不能
  抵消 global PUBLIC default；只执行 schema-scoped PUBLIC revoke 会留下未来函数公共可执行。本阶段不改
  schema USAGE、Data API 状态、RLS、table ACL 或 role membership。完整 migration、backup 与验收契约见
  `public-function-acl-hardening.md`。
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
- `renew_interrupted_password_confirmation` 同样只授予 context setter。它只接受唯一 bound unfinished
  claim、唯一未消费 invite-registration flow、未确认且只有 email identity 的 Auth user 和零业务账号
  数据；claim 的 `bound_email` 必须由 `bind_auth_identity` 从 Auth user 服务端派生并与当前 Auth email
  精确一致。active invitation 保持 0014 边界。forward-only 0022 仅允许
  `created_by_kind='operator'` 且 invitation/claim/flow 都已过期的同一状态，把 claim/flow 续到同一个最多
  15 分钟的确认 expiry，并把 invitation 续到最多 30 分钟的 Provider 重试 expiry；deployment-bootstrap、
  active claim/flow、已确认/多 identity、任何账号数据、撤销/消费状态都零写入。函数只替换同一 flow
  hash，旧 CTA 立即失效，绝不创建第二
  invitation/claim/flow/user/identity；bound claim 继续阻止重新领取。
- Hosted 恢复不要求用户识别、复制或输入原邀请 token。token 留在原邀请 URL fragment 与 Web 内存，恢复
  提交时由 Web 自动传给 API；API 使用当前 Production pepper 计算 hash，0013 在任何写入前同时要求精确
  `registration-interrupted`、active Bootstrap invitation 与 hash equality。任何错配均失败关闭且零部分
  写入；不得打印 pepper、token、hash、DSN、email、user id、OTP 或密码。
- `acceptance:hosted:operator:pepper:verify` 仅是具有安全 managed token source 时的可选工程诊断，不是
  用户验收步骤，也不得把 opaque token 手工输入变成运维要求。

## 9. Chrome Web Store

- Extension 的单一用途是对当前英文内容提供就地翻译/解释，并按用户动作/账号偏好把原始学习采集或
  生词副本交给同一语见学习工作台；它不上传 compact BYOK result，Web 不提供远程脚本或替换扩展代码。
- 所有脚本、wasm、字体和样式随包发布。固定 API origin 只交换数据，不下载可执行逻辑。
- 登录 Extension 的业务请求除高熵 session token 外，还必须提供精确发布的
  `chrome-extension://<id>` Origin，并携带 manifest 三段版本。Chrome 扩展的 GET 不自动附加 Origin，
  Service Worker 从自己的受信 `location.origin` 补齐；不接受页面或消息参数指定 Origin。API 在查询
  token 归属前继续验证固定 Origin 与最低版本；Origin/版本只是 defense-in-depth，不能替代 token，
  不得接受通配 Extension Origin。401 清理失效会话；403/426 阻止本次操作并显示访问/版本提示，
  不把它们当成 BYOK 缺少密钥，也不删除仍在本机的会话。
- 配对、断开及偏好快照提交共用同一 vault 的本地串行边界。偏好请求返回时重新比较 token，旧账号的
  成功或 401 响应不得覆盖/清除新关联，也不得在断开后恢复旧会话。重新打开确认页复用未过期的
  pairing/PKCE；仅明确的 not_found 或过期清理 pending，瞬态错误保留原证明。
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

Hosted Cron bootstrap 不新增第五个本机凭据，也不让操作者经聊天、终端参数、环境变量或剪贴板处理中转
`CRON_SECRET`。管理员连接在 Supabase Vault 内创建或复用固定 64 位小写十六进制 bearer；值只在有界
本地进程内进入 Vercel 环境管理请求，以及后续 API worker 的 Authorization header。Vercel Sensitive
值不可解密回读，因此结构回读只验证唯一 key/type/Production target，值连续性必须由同一 Vault 来源
完成 upsert 后的新 deployment 接受鉴权、真实 worker 返回 `sent` 且重复返回 `idle` 来证明。provision
必须在 release lock 内拒绝已有 state，并只在 upsert 成功后写带随机 `releaseAttemptId` 且
`provenance=cron-bootstrap-provision` 的 schema-v3 `candidate-recorded`。API/Web deployment 必须设置
`forceNew=1`，其 metadata 必须精确匹配该 attempt；
另一个 clone 即使缺少本地 state，也不能把 upsert 前的旧同 SHA/release deployment 绑定到本次 state，且
只有 create 响应丢失后才允许按 attempt 对账。delivery 在读取 Vault 前只接受同一
clean/pushed/disarmed SHA 的 bootstrap-provenance schema-v3 `complete`，并要求 API/Web runtime
attestation 通过；普通 release 与 legacy schema-v1/v2 complete 只能用于 release status 兼容，不能授权
bootstrap delivery。首次环境允许在 R3-C 为空且恰好一个 recovery 可
claim 时 provision，再用相同 bearer 投递恢复邮件；只读门仅
返回 open/claimable/sent/ambiguous 四个计数，禁止返回邮箱、owner、flow、PKCE/provider state 或密文。
所有错误只输出固定 stage；数据库/Vercel/HTTP 原始响应、bearer、Token 和邮件身份不得进入日志或
state。该行为证据仍不替代用户真实收件与无正文告警接收方验收，也不自动授权 Cron apply。

Hosted DeepSeek one-shot 的 0016 authority foundation 创建两张 `huayi_private` forced-RLS 表和一个
`NOLOGIN NOINHERIT NOBYPASSRLS` 专用 role。PUBLIC、Supabase API roles、business/context-setter/runtime 与
该专用 role 均无表直权，trigger functions 也对这些角色撤销 execute；receipt 必须先绑定 server request，
终态证据不可改写。0016 本身不构成新的运行时、HTTP 或 Provider 能力。0017 只允许 terminal 满 24 小时
后一次性同时清除 owner、
idempotency-key HMAC 与 server request ID；不可变 marker、receipt/deployment/terminal/time evidence 和
re-revoked trigger ACL 防止提前、部分、重引入或伪造清除。0018 只新增 fixed-search-path
`SECURITY DEFINER STABLE` status；它只向
专用 executor 返回一个安全 enum，multiple/unknown 固定失败，API/business/runtime/PUBLIC 均无 execute，
专用 executor 也仍无表直权。

0019 新增仅由 owner-defined 数据库函数内部调用的 fixed-search-path `SECURITY DEFINER STABLE`
effective-fuse；PUBLIC、Supabase API、business/context-setter/runtime 与专用 executor 均无直接 execute。
它把 `reserve_quota` 与 Operator usage summary 接到同一 fail-closed read：物理 control 缺失/NULL/异常、
cleanup-pending、completed cleanup 搭配 non-terminal operation，或 operation lease 到期/超过
`armed_at + 120s` 时按 enabled；唯一 running + pending cleanup 只在 server-time bounded lease 内继续按
物理 false。读取不写 authority/runtime/quota 表，不新增 Cron、cleanup mutation、HTTP、网络或 secret seam；
两张 authority 表继续 forced RLS 与零直权。

0020 在空 authority guard 后新增最小 mutation/retention functions。每次 mutation 同时校验 operation ID、
server-time generation、raw token 的数据库内 hash、状态和 lease；live operation/cleanup lease 不可抢占，
旧 worker 不能写。arm 只建立 pending cleanup，保持 0019 的 bounded effective-fuse 窗口；dispatch marker
一旦存在永不重发 application POST。owner 仅从唯一 completed first-operator singleton 派生。

idempotency raw material 由固定 context、operation UUID 与 versioned HMAC keyring 确定性生成，key version
显式参与 material/verifier 的 HMAC domain separation。authority 表只保存 context/version/verifier；keyring
secret 与 raw key 不写 authority、日志、错误/status/inspect。产品 `analysis_requests` 仍按正常幂等合同保存
它收到的 key；private bind 只把恢复出的 raw key 当瞬时 SQL 参数，精确核对 request 的 owner/key/payload，
不将它复制到 authority。active version 只创建新 operation；retained historical version 只恢复已存在
operation。错 context/version/key/verifier 或显式损坏 verifier 固定失败，不得回退 active key。
dispatch-before-bind 恢复只接受 exact-one owner/idempotency/payload 对账；零条、多条、
错配均失败关闭并继续 cleanup。0020 的旧 settlement 入口随后由 0021 删除，caller 不再提供 receipt digest。
0021 在锁定 operation 后，以 generation/token/lease fence 原子对账并绑定唯一 request；settlement function
只从服务端产品表读取、校验并由 Postgres 生成 canonical receipt 与 SHA-256。重放必须重新得到同一
receipt/digest，否则失败关闭。临时 receipt JSON 满 24 小时随 identity 一起 scrub，digest 与部署/终态/
时间证据保留；正文和模型输出从不进入 receipt。cleanup 已完成而 operation 尚 running 时只依据持久化
dispatch/request/receipt evidence 做 authority finalization，零 Web session 或外部调用。arm 不确定但进入
`failed-cleanup-pending` 时会原子补建 pending
cleanup obligation，确保始终存在可恢复义务。0020 的 retention function 让 scrub 与 delete 共用每次
1–100 行总预算，只 scrub 满 24 小时 terminal identity 并删除满 90 天且 cleanup 已完成的 terminal
evidence；没有新增 Cron 或 HTTP route。

Phase C 首个离线切片复用既有隐藏 TTY prompt，只增加两个固定 allowlisted Operator prompt。input/output
任一不是 interactive TTY 时在读取前失败；邮箱按既有账号合同 trim/lowercase 并校验，密码保持 12–256，
两项都拒绝 C0/C1 控制字符（含 newline、tab、escape）。返回对象 frozen 且字段 non-enumerable，普通 JSON、
inspect/snapshot 不携带 credential；所有 prompt/validation failure 统一为固定错误。该层不读 argv、env、
文件或真实用户 secret，不落库/日志/状态，也尚未建立 Web session 或 production composition。底层 byte
reader 只对固定 Operator password prompt 使用 768-byte 上限，以完整容纳既有 256-character Unicode
密码合同；其余既有管理 secret prompt 继续保持 512-byte 上限。

Phase C 的 fixed normal-Web request slice 只允许深冻结的 strict body：`selectionKind=sentence`、source
只有 `type=manual`，正文固定为已审阅英文句子。private request builder 不接收 body 参数；caller approval
或 adapter 上的 title、userContext、selection/source type、正文覆盖材料均不能进入实际 application
request。既有 payload digest 直接由该对象的固定 key order canonical JSON 计算，并由固定 digest 回归
防止漂移；body 与 nested source 均冻结，且正文不从主 executor 模块额外导出。该切片不新增 HTTP
route/header、CLI、credential/session、网络或 Hosted 能力。

Phase C 的 private session lifecycle 继续保持 public executor 只有 `status/execute/recover`。session-free
preflight 与有效 operation claim 必须先于任何 login；login→password reauth→Operator readback 共用一个
绝对 10 秒 envelope。reauth response 的有效 replacement Cookie 在 rotation 校验前即取代旧 Cookie/CSRF；
partial login/reauth 只保留最新有效 Cookie 作为 logout-only material，旧 material 永不回退。所有
post-login exit 先尝试 restoration/cleanup，再用不继承 application abort 的独立绝对 10 秒 normal logout；
无论成功、失败、超时或 adapter 忽略 abort，executor 都同步幂等销毁内存 capability，logout outcome 后才
durable complete cleanup 与 terminalize operation。logout 私有错误只映射固定失败且不能抑制 durable
cleanup。应用仍为绝对 90 秒、cleanup 为独立 10 秒；arm 后 lease 必须严格覆盖这 110 秒且不越过 0019 的
`armed_at + 120s`；private arm receipt 必须提供 server-authoritative `armedAt`，executor 不以 response 后
的本地时钟放宽该上限，并要求 pre-snapshot `observedAt <= armedAt <=` arm response 后本地时钟。recovery
在 login 前另拒绝晚于 claim 后采样时钟的 future `armedAt`，再按 session→restore→logout→terminalize 运行；无效
claim 零 login。Phase D 又为 session-free preflight 增加绝对 10 秒 envelope，为 recovery reconciliation/
settlement 增加绝对 20 秒 evidence envelope；evidence 超时不能跳过后续 cleanup/logout。Vercel adapter 的
每个固定 GET 独立限制 5 秒并统一脱敏错误；API runtime headers 与 Web build-time meta 只包含 full commit、
deployment UID 和固定 release channel，不含 token、Cookie 或产品数据。这些 adapter 仍只有离线 fake/本机
parser 证据；Phase E 虽已完成 composition，但尚无真实 Cookie/凭据、Hosted 写入或模型调用。

Phase E 把这些既有边界汇聚进 production composition factory，但不提供 secret loader 或新的网络/数据库
能力。公开对象仍严格只有 `status/execute/recover`，extra opaque arguments 在任何下游调用前失败；execute
先以五秒只读 status gate 拒绝 ready/running/cleanup-pending，CLI 又严格校验 safe status 与 restored
outcome，不能把空返回或畸形结果打印为成功。`plan` 零 I/O；Phase G 前 direct non-plan package 入口不读
argv 中的 secret、环境、文件或 TTY，不构造 adapter，也不触发 mutation。

0016–0021 使用 `hosted-deepseek-migration-batch.md` 的独立恢复/migration 安全边界。Phase 91 的 15-file
evidence 不进入新 batch；新 pre 固定 head 0015，21-chain networkless rebuild 与 post 固定 head 0021。
backup evidence 只写 clone-local `0700/0600` 路径且不可覆盖；capture 继续使用 official CA、verify-full 与
固定管理员 Keychain account，rebuild 不读取 Hosted secret。真实 status 只公开 applied/pending/uncertain 三态；applied 还要
证明 authority role 非特权，且不存在可继承、可切换或额外 membership；PostgreSQL 17 可选 creator-control
边只允许唯一 `postgres`→executor 的 `admin=true / inherit=false / set=false`。owner/forced RLS/启用
trigger/SECURITY DEFINER/search path、executor allowlist 与任意额外 function/table ACL 均精确。standalone
dry-run 和 apply 都在 CA/credential read 前验证 current evidence 与 Supabase CLI `2.115.0`；apply 在任何 mutation 前
两次验证 current evidence/source identity，并夹住 exact six-file dry-run 与 read-only pending catalog，写后
只接受 applied postflight。未知
状态、child output 或外部错误不反射，继承密码在本地 gate、CA/Keychain/网络前拒绝。post-apply `uncertain`
只能进入固定脱敏只读 diagnostic：单一 snapshot 按 allowlist 输出 migration prefix、membership
absence/contract、其余 catalog/ACL 布尔叶和 psql 退出分类，禁止 stderr、raw catalog、OID、未知角色、URL、
凭据或环境反射；其结论不授权 apply、修复 SQL 或 post backup。本控制面没有装配 Phase G
keyring/session/Vercel/private query loader，也不新增 HTTP route、Provider 请求或费用能力。

0022 不继承或扩写 DeepSeek 0016–0021 的备份证据。`phase-92-0022-expired-invitation-recovery` 使用独立
head-21 pre、22-chain networkless rebuild 与 head-22 post；所有 manifest 绑定同一 clean pushed commit，
私有路径和不可覆盖规则沿用 important-batch 合同。migration-time preflight/completion 只接受该 commit
仍为 current HEAD；Vercel arm/disarm 推进 HEAD 后，`current=false` 不能授权重捕。历史完成门只读重验
exact entries、实际 dump hash、同一 candidate、时间边界及其为 clean pushed HEAD ancestor，既不连接 Hosted
也不修改 evidence。status 在一个 `BEGIN READ ONLY` snapshot 中同时要求
21-chain authority 对象/角色图/RLS/trigger/function ACL 精确，以及
`renew_interrupted_password_confirmation(text,text,timestamptz)` 的 owner、SECURITY DEFINER、唯一
`search_path=pg_catalog`、context-setter-only ACL 和前后正文 MD5 指纹；只有旧指纹+21-chain 为 pending，
新指纹+22-chain 为 applied，其他全部 uncertain。dry-run 只接受单一 0022 allowlisted transcript；apply 在
secret 前验证 current evidence、pinned CLI 与双镜像 SHA-256，同一密码会话内执行 exact dry-run、再次
preflight、read-only pending、唯一写入和 applied postflight。任何不确定结果均禁止盲重试，只能进入固定
脱敏 diagnostic；diagnostic 仅输出迁移链、authority 聚合、函数合同与 pending/applied 布尔值，不输出
邮箱、UUID、OID、正文、URL、凭据、原始 catalog 或 child output。

Phase 92/93 的 Vercel 部署证据不得写入或覆盖 Phase 81 state。三个固定 identity 只能映射到各自 clone-local
`0600` canonical JSON；共享 `0700` 目录只允许这三个已知文件，未知、partial、symlink、权限漂移或非 canonical
内容均失败关闭。每个 store 只能读写自己的 identity；one-shot 仍只做 Git/Vercel GET 与状态证据写入，真实
arm/disarm/deploy 只来自另行批准的单文件 commit/push。注册后的只读 identity snapshot 不输出 email、UUID、
token 或正文；`account_finalized_exact` 只有在普通邀请总数精确为一、唯一邀请 consumed 且 claim/flow/Auth/
profile/method/quota 均精确时才可为真。

以下不是产品决策，必须以真实环境验证后补入发布材料：Vercel/Supabase 新加坡实际部署与网络延迟、
Google OAuth 在目标网络的可达性、Supabase 备份残留、DeepSeek 当前模型 ID/价格/JSON 与 usage
契约、生产 Extension ID、Chrome 数据披露问卷和公开隐私政策 URL。

### Phase 93 invitation token recovery

恢复 token 只在 API module 内以 actor、target、idempotency key 和 request hash 确定性派生；专用派生 key
由当前 `HUAYI_SECRET_PEPPER` 经固定 domain separation 产生，不依赖可独立轮换的 refresh encryption key。
Postgres seam 使用同一当前 pepper 保存 hash，因此其连续性与普通邀请本来要求的 token 验证连续性一致。
明文 token 不进入数据库、审计、幂等 response、列表、日志或诊断。数据库函数为
`SECURITY DEFINER SET search_path=pg_catalog`，owner 固定 `postgres`，仅
`huayi_context_setter` 可执行。行锁、幂等锁与一次性 recovery audit 使并发安全；状态或 ACL 漂移均整笔
回滚。该 invitation 的永久一次性门同时是比按时间计数更严格的 mutation rate boundary。

Phase 93 readiness 诊断不接受调用方提供的 identity 或 opaque input；它在 verify-full 管理员连接上的单一
`REPEATABLE READ READ ONLY` transaction 中自动要求唯一 ordinary invitation，并镜像 0023 的 expired
invitation/claim/flow、unconfirmed lower-case email user、唯一 email identity、current token-hash 形状、零
既有 recovery audit 与二十类 subject 记录 absence。输出仅为固定有序 `t|f` 叶与
`eligible|not-eligible`，不含 email、UUID、token/hash、内容或原始 SQL/catalog error。任何叶漂移均不授权
mutation。Vercel diagnose 同样只输出计数、状态、candidate-match 布尔值以及五个固定只读 request
stage/status，不输出 URL、响应体、token、deployment id 或 commit；它不写 Phase 93 state。

`GET /v1/auth/csrf` 会轮换当前 Web session 的唯一 CSRF hash，因此管理员 mutation 不得复用页面载入或
密码重新认证时缓存的 proof。生产 adapter 必须在每次写请求的同一异步链中先取得 fresh proof、再立即发送
Origin/CSRF/Idempotency-Key 保护的 mutation；未知响应重放只复用原幂等键，CSRF 则重新获取。Phase 93
首次 Hosted recovery 因违反该客户端约束而以 403 失败关闭；没有新私有链接或 recovery 成功证据，修复部署
和 fresh readiness 前禁止重试。

post-relogin Web session 诊断是独立的只读管理面，不接收 email、UUID、Cookie、session token、invitation
token 或任意 opaque selector。目标账号只能由数据库内“唯一 ordinary invitation + finalized account”合同
自动确定；若目标不唯一或账号不精确，固定返回 `target-inconsistent`。诊断在单一 verify-full、
`REPEATABLE READ READ ONLY` transaction 中仅按 target/other、active/revoked/expired、full/non-full 与
Operator/non-Operator 统计，并以 owner/partition 自检阻止聚合误导。stdout 仅允许固定有序布尔值、非负
计数、有限 session state 与有限 verdict；数据库错误、身份、hash、时间、密文、URL 和正文均不得输出。
诊断成功仅代表报告合同完整，不代表 session 健康，也不授权注销、撤销、修复或重建账号。

### Store 本地更新与配对页说明

Hosted 验收安装保持原 `dist` 路径、公钥和 Extension ID；普通 build/E2E 与候选审计固定使用
`dist-release`，不得用不同身份产物覆盖已配对安装。扩展的外观、服务商、网站规则、DeviceVault、
安装标识与加密配对会话仍保存在原 `storage.local`，不新建云端密钥备份、跨扩展读取或权限。
Chrome 卸载后的本地配置恢复不在此保证内；不能将同一公钥复用于未授权的不同云端环境。

配对页用通俗文案和分行控件呈现，但仍继承当前账号三项偏好及 revision，保留未勾选的明确授权。
发送范围、费用及账号级影响在操作旁展示；详细保留期和隐私说明可展开阅读，不改变上传与安全断开合同。
