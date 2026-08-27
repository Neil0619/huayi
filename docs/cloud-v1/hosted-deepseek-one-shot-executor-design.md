# Hosted Cloud Web DeepSeek one-shot executor 设计

状态：Accepted design；Phase A 离线控制合同、Phase B 私有 Postgres authority、Phase C 私有 session 与
normal Web production-shaped HTTP transport、Phase D fenced reconciliation/server-frozen settlement 与
只读 deployment attestation adapters，以及 Phase E production composition root/CLI 已实现。Phase E/F
提交 `d9ffb4a03c984d2f94c37031660a146068f31a3a` 的 exact-SHA Cross-platform quality run
`33076976013` 已由 macOS/Windows 两 job 通过。后续独立 0016–0021 recovery/migration 离线控制面见
`hosted-deepseek-migration-batch.md`；当前该控制面尚未 commit/push，真实 Hosted migration/deployment、
受控 secrets 注入和付费验收仍未执行。

日期：2026-08-27

## 目标与边界

本设计把一次真实 Hosted Cloud Web DeepSeek 验收做成可恢复、可审计、默认失败关闭的深模块。它验证真实 Web HTTP 合同、Hosted DeepSeek 调用、服务端结算和恢复闭环，但不把验收能力暴露给普通产品用户。

不在本设计内：Classic、Provider smoke、直接调用 Cloud domain module、浏览器自动化、部署、付费模型调用，以及放宽现有 owner RLS。任何真实 Hosted 执行仍需单独知情批准。

## 三种明显不同的接口

### A. 最小生命周期接口

```ts
interface HostedDeepSeekOneShotExecutor {
  status(): Promise<HostedDeepSeekSafeStatus>;
  execute(approval: OneShotApproval): Promise<OneShotOutcome>;
  recover(): Promise<RecoveryReport>;
}

type OneShotApproval = {
  candidateCommit: string;
  confirmation: "--confirm-hosted-cloud-web-deepseek-one-shot-kpadiulxkgckskcfydry";
  maximumReservationMicroUsd: number;
};
```

用法只有“查看安全状态、执行、恢复”。`status` 自动选择 absent、ready、running、cleanup-pending 或
terminal，不返回 operation ID；`recover` 只能领取唯一可恢复 candidate：cleanup-pending、lease 已过期的
running operation，或 cleanup 已完成但 operation 尚未 terminal 的 finalization gap；live lease、多条或状态
不确定时失败关闭。`execute` 持有从批准、session-free 部署证明、operation claim、Operator 登录、开闸、单次请求、
服务端 receipt、恢复开关到销毁会话的完整顺序。相同批准只能形成一个 operation；发生错误时返回稳定的
分类错误，不能把密钥、Cookie、
CSRF、输入或模型输出带入错误。网络调用有显式超时，数据库状态转换为常数次往返；不轮询模型之外的
无界资源。

Phase A 的离线 seam 已固定为冻结对象上的这三个方法。测试 authority 的 `status` 读取最多返回一条已知
状态记录：零条分类为 absent，一条分类为 ready、running、cleanup-pending 或 terminal；多条、未知状态、
不完整结果和五秒 deadline 均固定失败关闭。该读取不调用 adapter mutation。direct lifecycle/adapter
orchestration 只存在于模块闭包和测试 composition root，不再导出给调用者。

Phase E production composition root 只接收受控 private query、snapshot、keyring、credential 和网络能力，
再组合既有 authority/evidence、normal Web HTTP/session 与 deployment attestation；它不复制 lifecycle
阶段，也不接受 endpoint/body/operation ID。CLI 只有在 executor 返回 exact
`{killSwitchRestored:true,outcome}` 安全结果后才打印固定成功文本；undefined、额外字段、false restore 或未知
outcome 全部映射同一固定失败。真实 private-port loader 留到 Phase G 单独审阅，因此当前 direct non-plan
package 入口不会猜测环境变量、文件或终端 secret，而是在零 adapter/零外部 I/O/零 mutation 下失败关闭。

Phase A 与 0016 foundation 的离线合同还固定：先捕获并验证 fresh pre-snapshot，之后才允许 claim
operation；claim 同时钉住固定 payload digest 与 exact API/Web deployment pair。operation 后续私有写入都
携带 raw claim token 与 lease generation，cleanup 完成写入携带 raw cleanup token 与 claim generation；
cleanup 以 operation ID 为唯一身份，不另造 JS-only cleanup ID，也不携带或要求持久化 raw idempotency
key/owner。claim 后的 login→password reauth→Operator readback 共用一个绝对 10 秒 session-establishment
envelope；arm 后 operation lease 必须严格覆盖 90 秒应用、10 秒 cleanup 与 10 秒 logout 共 110 秒，且
不能借此越过 0019 的 `armed_at + 120s` 上限。余量不足时在开闸前失败。claim 后快照过期时使用已验证
lease 终结失败 operation，cleanup arm 已尝试但未能证明关闭时保守进入 cleanup-pending。recovery 完成
cleanup 时还必须原子终结 operation，使 `status()` 进入 terminal 并释放唯一 non-terminal slot。生产 SQL
functions 已在 forward-only 0020 实现这些转换与 fence 校验；外部 caller seam 仍只有
`status/execute/recover`。

POST 已发出但客户端尚未观察到 `analysis.started` 就发生进程内 transport disconnect 时，执行器不会重发
POST，而是在同一 bounded application deadline 内，以 authority 已记录的 idempotency key、owner 和固定
payload digest 调用 reconciliation adapter。只有一条完整且三元组精确匹配的 server request 可被转换为
`analysis.started` handle、绑定并继续 settlement；零条、多条、不完整或错配结果均失败关闭，并继续执行
cleanup safety。Phase B 另以两个独立 executor/authority 实例共享同一 PGlite authority，证明旧 worker
停在 dispatch-before-bind 后，新进程以 operation identity 和 retained HMAC version 恢复同一幂等 material，
只做一次 exact-one reconciliation，application POST 总数仍为一；零条或多条结果失败关闭并完成 cleanup。

实现隐藏 SQL 状态机、lease/fencing、SSE 解析、Vercel 证明、Cookie/CSRF、receipt 读取和补偿恢复。生产依赖为 Postgres、Vercel management API、Web HTTP 和受控终端凭据输入；测试 adapter 为内存状态库、虚拟时钟、脚本化 HTTP 和固定部署证明。

权衡：调用面最深、误用面最小，但必须在模块内部精确定义恢复语义。

### B. 可编排阶段接口

```ts
interface HostedDeepSeekOneShotStages {
  approve(input: ApprovalInput): Promise<ApprovalRequestId>;
  attestDeployments(id: ApprovalRequestId): Promise<DeploymentPair>;
  authenticate(id: ApprovalRequestId): Promise<OperatorSession>;
  armCleanup(id: ApprovalRequestId): Promise<void>;
  openFuse(id: ApprovalRequestId): Promise<void>;
  dispatch(id: ApprovalRequestId): Promise<AnalysisRequestId>;
  settle(id: ApprovalRequestId): Promise<SettlementReceipt>;
  closeFuse(id: ApprovalRequestId): Promise<void>;
  revoke(id: ApprovalRequestId): Promise<void>;
}
```

调用者可插入步骤或 UI，但必须理解严格顺序、lease、重试和补偿。每个方法都需暴露更多中间错误与对象；性能与数据库往返随步骤增长。生产和测试 adapters 与 A 相同，却由调用者协调。

权衡：扩展最灵活，但 interface 较浅，容易出现“已开闸但未登记 cleanup”“重复 POST”或泄漏会话对象；不作为公开模块。

### C. 默认调用最简单的 ports-and-adapters

```ts
interface OneShotRunner {
  run(): Promise<OneShotOutcome>;
}

interface OneShotPorts {
  authority: AcceptanceAuthorityPort;
  deployments: DeploymentAttestationPort;
  web: HostedWebPort;
  receipt: SettlementReceiptPort;
  clock: ClockPort;
}
```

composition root 注入 production 或 test ports；默认 `run()` 最容易使用，也最容易离线测试。顺序、不变量和错误仍由 runner 统一，ports 必须有超时和数据上限。

权衡：测试 seam 清楚，但若 ports 进入公开 API，调用者会绕过 lifecycle；单一 `run()` 也不足以表达跨进程恢复和审计。

### 选择：A + C hybrid

公开 seam 采用 A 的三个入口；C 的 ports 只存在于实现和 composition root。B 的阶段只作为私有状态机，
不成为可独立调用 API。这个位置同时获得：高 depth（隐藏恢复复杂度）、高 leverage（CLI 执行和显式恢复
复用）与 locality（验收风险集中在一个模块）。

## 权威生命周期

### authority 与 schema

唯一生命周期权威是 Hosted Postgres 的 `huayi_private` schema，不是 CLI 进程、本地文件、Git 或 Vercel。新增两类私有记录：

- operation：批准标识、规范请求摘要、部署对、状态、lease generation、fence token hash、dispatch marker、绑定后的 server request ID、receipt digest、脱敏错误和保留期限；
- cleanup obligation：恢复 kill switch 的独立义务及其 claim generation。

表对 API roles 无 grant；专用 `NOLOGIN` executor role 只能执行最小 `SECURITY DEFINER` 函数。函数固定 `search_path`、校验调用者与 operation，并撤销 `PUBLIC` execute。

2026-08-27 的 0016 forward migration 完成首个 schema/ACL foundation：两张 private forced-RLS 表、唯一
non-terminal operation、单向状态 guard、generation/token 同步轮换 guard、不可改写的 dispatch/request/
receipt/terminal 证据和 90 天 retention 字段。专用 executor role 当前无表权限也无函数执行权限，因此尚无
production 可调用 authority。0017 只新增不可变 `identity_scrubbed_at` 和结构 guard：terminal operation
满 24 小时后，只允许一次同时清除 owner、idempotency-key HMAC 与 server request ID；receipt digest、部署
证明、terminal/safe-error/time evidence 保持不变，提前、部分、重引入或第二次 scrub 均失败。0017 没有
新增 callable retention function 或执行者。0018 新增唯一 callable read：
`huayi_private.read_hosted_acceptance_status()` 以单个 snapshot 只返回 `absent` 或当前安全状态；多个
non-terminal、未知状态均用固定错误失败关闭，历史 terminal 只按最新 operation 投影为 `terminal`。该
`SECURITY DEFINER STABLE` function 固定 `search_path`，只授予专用 executor，仍不给任何角色表直权。

0020 是只向前的新 migration。它在空 authority guard 后新增固定 `SECURITY DEFINER` mutation functions，
覆盖 claim、arm、dispatch marker、request bind、settlement、operation/cleanup completion、cleanup claim
和 bounded retention；全部固定 `search_path`，只授予专用 executor，helpers 对 executor 也无 execute，
其他 application/API roles 全部拒绝。owner 只从唯一 completed first-operator singleton 派生。0021 再以
只向前 migration 删除 caller-digest settlement signature，新增 fenced atomic reconciliation+bind 和
server-side read+validate+hash+freeze functions；三者同样只授予专用 executor。

idempotency material 使用固定 context
`huayi.hosted-deepseek-one-shot.idempotency.v1` 和正整数 key version。新 operation 只使用 active version；
恢复中的既有 operation 可使用 retained historical version，由 operation UUID 确定性重建 raw material，再
以持久化 verifier 做 timing-safe 验证。key version 显式进入 material 与 verifier 的 HMAC domain
separation，即使两个 version 意外复用相同 key bytes 也不能互换。错 context/version/key/verifier 固定失败；
显式提供但格式损坏的 recovery verifier 不得回退到 active key；旧 version 不得创建新 operation。authority
表、错误、status 和 inspect 都不保存或输出 raw key/keyring secret。

### lease、fencing 与顺序

`execute` 领取最多 120 秒 operation lease；每次续租递增 generation，并返回不可持久化的 fence token。
每次状态转换同时校验 operation ID、generation、token hash、前置状态和服务器时间。旧 worker 即使恢复
运行也不能写入。session establishment 在 claim 后、arm 前共用一次绝对 10 秒 deadline；arm 前必须重验
lease 尚可严格覆盖其后 110 秒。若建立会话耗尽余量，则不 arm、不关闭 fuse，也不续出超过 120 秒的 lease。
`armCleanup` receipt 必须带 server-authoritative `armedAt`；executor 以该值而非 arm 返回后的本地时钟验证
`operation.leaseExpiresAt <= armedAt + 120s`，并要求 pre-snapshot `observedAt <= armedAt <=` arm response
后的本地时钟，避免未来时间或 network RTT 放宽开闸窗口。recovery 同样要求 `armedAt <= claim` 后立即采样
的本地时钟，未来 arm receipt 在 login 前失败关闭。

cleanup recovery 使用 60 秒 claim；其中 session establishment 10 秒、settlement/reconciliation evidence
20 秒、单次 cleanup 10 秒和 normal logout 10 秒，给终态写入保留 10 秒余量。以下顺序是硬不变量：

1. session-free 捕获并验证 approval、candidate 与精确 deployment pair；
2. authority 原子 claim operation；claim 无效时零 login、零 logout；
3. 在共享 10 秒 envelope 内建立普通 password Web session、password reauth 并 read back Operator；
4. 持久化 cleanup obligation；
5. 关闭 kill switch；
6. 在发送 HTTP 前原子写入 `dispatch_attempted_at`；
7. 只发送一次真实 Web analysis POST；
8. 绑定 server-generated request ID，冻结 receipt；
9. 先尝试恢复 kill switch 并捕获 post evidence；
10. 以不继承 application abort 的独立 10 秒 deadline 恰好尝试一次 normal logout；
11. 已知 logout outcome 后才关闭 cleanup obligation，并终结 operation。

`dispatch_attempted_at` 一旦存在，任何 worker 都不得再次发送 application POST。结果不确定时，恢复逻辑
通过 0021 的 fenced SQL 在同一 operation row lock 内原子查询并绑定既有 server request；无法证明唯一匹配
就失败关闭，不用重放换取成功。

claim cleanup 不抢占未过期的 live operation/cleanup lease；running crash 只在 operation lease 到期后轮换
generation/token，cleanup-pending 可立即领取。若崩溃发生在 fuse-off、dispatch marker 之前，恢复只做
cleanup 并以 failed 终结，零 POST。相同 request 的 server-frozen settlement 重放必须重新生成相同
canonical receipt/digest；caller 无权选择 digest。若 cleanup 已完成但 operation 尚未 terminal，恢复直接
依据持久化 dispatch/request/receipt evidence
完成 authority finalization，零 login、reauth、reconcile、cleanup、logout 或 POST。

### recovery trigger 与 fail-closed

恢复只有两个执行入口：`execute` 的 `finally` 和显式 CLI `recover`。CLI 的 `status` 在任何新 operation 前
先检查 pending cleanup；只要存在唯一 cleanup-pending 就拒绝 `execute` 并要求先恢复。不得为验收新增
第六个 Cron job，现有 exact 五项 Cron 合同保持不变。

只要存在到期且未完成的“恢复 kill switch”义务，数据库 effective-fuse 读取就立即按 enabled 处理，使
后续平台模型请求失败关闭；显式 `recover` 再经正常 recent-auth admin HTTP mutation 把物理 runtime
control 收敛为 enabled。因此 runner 崩溃不会留下可继续放行的窗口，也不会由后台任务在无人监督时读取
凭据或执行管理 mutation。

0019 把该离线数据库合同接入两个既有读取 seam：新 reservation 与 Operator usage summary。物理
`runtime_controls` 仍是唯一 mutation 权威；private effective read 不写表。刚 armed 的义务不会立即自锁：
只有唯一 `running` operation、cleanup 仍为 `pending`、server-time lease 未到期且不晚于 `armed_at + 120s`
时可继续按物理 `false` 读取；cleanup-pending、expired/claimed/future/超长 lease、completed cleanup 搭配
non-terminal operation，以及缺失/NULL/未知或多行异常均按 enabled 或以数据库错误失败关闭。它没有新增
Cron、cleanup mutation、HTTP 或 Provider 能力。

### retention

- Operator email/password、Vercel token 和管理员数据库密码只经受控 TTY 输入并存在于进程内存，从不
  落库、日志、argv 或继承环境；
- Cookie、CSRF 和 fence token 只在内存中，绝不持久化；
- 未完成 cleanup 永不自动清除；
- 0020 提供显式、每次 scrub 与 delete 共用 1–100 行总预算的 private retention function；0021 扩展其
  scrub，使 terminal 满 24 小时后原子清除 owner、idempotency-key HMAC、server request ID 与临时 canonical
  receipt，并用不可变 marker 区分“已清除”与“从未绑定”；
- terminal 且 cleanup 已完成的部署证明、receipt digest、状态事件与安全错误码在 90 天后删除；
- 未新增 Cron 或自动调度；调用该 bounded function 仍属于后续 production composition/运维入口；
- 产品 `analysis_requests`、`analysis_records`、quota 和 `usage_ledger` 继续遵守既有产品保留策略，验收器不越权删除用户记录。

## approval 与 server request ID

`ApprovalRequestId` 是批准系统生成的验收标识；`AnalysisRequestId` 只能取自服务端 `analysis.started` 事件或私有 reconciliation 查询。二者永不假设相等。

dispatch 前生成单次 idempotency key，并把其 HMAC、owner ID 和规范请求摘要写入 operation。首次收到
`analysis.started` 时，private bind function 以瞬时参数接收 raw key，并精确核对产品
`analysis_requests` 的 owner、idempotency key 和请求摘要后原子绑定 server request ID；raw key 不写入
authority 表。若连接在 started 前断开，recovery 用相同三元组查找服务端已建 request。零匹配表示未证明
成功，多匹配或摘要不符表示安全错误。

## 真实 Web 路径与 Operator 安全

验收必须走与产品相同的语义路径：

1. session-free `GET /analysis`，确认 Web route 可达并取得完整 runtime deployment attestation；
2. authority 成功 claim operation；
3. 通过现有 password login 建立 secure Cookie session；
4. password re-auth 获得 recent-auth，服务端轮换 Cookie 与 CSRF，再 read back Operator authorization；
5. 调用真实 admin kill-switch HTTP 合同关闭 DeepSeek fuse；
6. `POST /v1/analyses:stream`，携带 Cookie、`Origin`、轮换后的 CSRF 和 `Idempotency-Key`，消费到一个终态；
7. 读取私有 server settlement receipt；
8. 经 admin HTTP 尝试恢复 fuse，再通过正常 Web logout 关闭本次 session；
9. logout outcome 已知后才完成 durable cleanup 与 operation terminalization。

production adapter 只创建普通 password Web session，不新增 acceptance session 类型、特殊 Cookie 或认证
字段。Cookie jar 仅在进程内存中且不从 private adapter 暴露。login transport 的 rejection 必须是
failure-atomic，表示服务端未创建可用 session；若 response 已带有效 Cookie 但 CSRF 缺失或畸形，则先保留
该 Cookie 作为 logout-only material，再失败关闭并尝试一次 normal logout。reauth response 只要带有效新
Cookie，就必须在 rotation 校验前采纳并立即淘汰旧 Cookie/CSRF；新 CSRF 缺失、畸形或未轮换仍失败关闭，
其后 cleanup 与 logout 只能使用最新可用 material，绝不回退旧 material。

每个 post-login exit 都先尝试 fuse restoration/cleanup，再以独立 signal 和绝对 10 秒 deadline 恰好尝试
一次 normal logout；application abort 不能取消它。无论 logout 成功、失败、超时或忽略 abort，executor
随后同步、幂等调用 private `destroySession()` 清除内存 capability，再做 durable cleanup completion 与
operation terminalization。logout 失败只产生固定失败文本，不能抑制 durable cleanup。进程崩溃时不把
session token 写入 authority，也不批量撤销 Operator 的其他 session；残留 session 只按既有 Web session
到期策略失效，cleanup authority 只负责恢复 kill switch。

Phase C production-shaped transport 固定连接 acceptance API/Web origin 与既有 password login、password
reauth、Operator access、kill-switch、analysis stream、request status 和 logout routes。它不接受 endpoint、
path、header、body 或 session 类型覆盖；Node transport 显式携带 normal Web Cookie、Origin、CSRF 与
Idempotency-Key，但只把固定 analysis body 发送到 API。SSE 在本地执行 byte/event/single-event bounds；只有
已经观察到 `analysis.started` 的完整 started-only stream 或 transport interruption 才允许对该严格 UUID
request ID 做一次 status read，started 前不得访问 status，也不得重发 POST。public Web 没有按
idempotency/owner/digest
查询 request 的 route，因此 dispatch-before-bind exact-one reconciliation 继续留在私有 authority adapter，
HTTP transport 固定失败且零网络，不能发明 acceptance route。

`capturePreSnapshot()` 仍是 injected、session-free seam；它运行期间不会 login 或 logout。Phase D 已在
orchestrator 外层固定绝对 10 秒 preflight deadline，并在 Vercel/Web adapter 内给每个管理面和运行时 GET
独立 5 秒上限；即使 transport 忽略 abort，deadline race 仍先失败关闭。Phase E 已把该 adapter 汇聚进
production composition root，但尚未装配真实 private loader，因此实现完成不等于真实外部读取已执行。

禁止用 direct Provider、Cloud module、SQL mutation 或 Classic smoke 替代上述路径。`/analysis` 是 Web 页面证明，真正的分析 mutation 是 `/v1/analyses:stream`。

## server settlement receipt 与 RLS

成功条件由服务端冻结的 `SettlementReceipt` 决定，而不是 runner 自报。0021 专用私有函数锁定并 fence
operation，在同一数据库 statement 内连接 server request、terminal analysis record、quota reservation、
price snapshot 和 `usage_ledger`，验证：

- request 为终态且只有一个对应 terminal record；
- provider 为 DeepSeek，reservation 已 settle；
- ledger 有 1–2 条，`call_ordinal` 从 0 连续到 `N - 1`，币种、token 与金额一致；
- receipt 绑定规范输入摘要、server request ID 和精确 deployment pair。

函数由 Postgres `jsonb_build_object` 构造 canonical receipt，并以数据库 `digest(..., 'sha256')` 生成 hex
digest，一次性写入私有 operation；caller 不提供 digest，冻结后不可改写。24 小时 scrub 清除 canonical
receipt 和身份绑定，只保留 digest 与非身份审计证据。产品 owner projection 继续经过强制 RLS；receipt 函数
只授予专用 `NOLOGIN` role，不新增 public/API billing receipt route，也不放宽 RLS。

## deployment identity

可信部署来源是 Vercel management API：固定 team/project、production target、READY 状态、零 in-flight、
不可变 deployment UID（`dpl_...`）和完整 source commit SHA。API 固定 `/health` 以 response headers 返回
commit/UID/release channel；Web 固定 `/analysis` 的 build-time HTML meta 返回同三项。两者都与管理面最新
non-canceled deployment 交叉验证，redirect、非 200、错误 content type、超限 body 或身份漂移均失败关闭。

API 和 Web 可来自两个分别受控、可审阅的 source SHA；不要求二者 SHA 相同。operation 绑定精确 `(apiDeploymentId, apiSha, webDeploymentId, webSha)`。Git HEAD 只证明本地审阅 lineage，页面显示的短 SHA 不可作为身份。

## 固定输入、验收文本与隐私

唯一允许的 analysis payload 是：

```json
{
  "selectionKind": "sentence",
  "source": { "type": "manual" },
  "sourceText": "The team checked every detail before it made one careful decision."
}
```

调用者不能覆盖输入。CLI 只允许阶段、boolean/count/enum、HTTP 状态类和 receipt digest；operation、
deployment、owner、request、ledger 等 opaque ID 只保留在私有 authority，不进入终端。禁止密码、Cookie、
CSRF、authorization、原始 SSE、输入正文、模型输出、usage 明细和数据库行。

终端只允许以下固定文本：

- `Hosted Cloud Web DeepSeek one-shot accepted; kill switch restored; Web session closed.`
- `Hosted Cloud Web DeepSeek one-shot recovery completed; kill switch restored.`
- `Hosted Cloud Web DeepSeek one-shot failed closed.`

错误分类固定为 `approval_invalid`、`deployment_untrusted`、`lease_lost`、`recent_auth_failed`、`fuse_failed`、`dispatch_uncertain`、`stream_invalid`、`receipt_invalid`、`cleanup_pending` 和 `internal_safe_failure`。细节只进入脱敏内部事件。

## 性能与验收不变量

一项 approval 最多一次 application POST 和一次付费 terminal request。login、password reauth 与 Operator
readback 共用一个绝对 10 秒 session-establishment envelope；应用为绝对 90 秒，cleanup 与 logout 各有
独立绝对 10 秒 envelope。logout 不继承 application signal。SSE 总字节、事件数和单事件大小有上限；
receipt 读取为有界索引查询；`recover()` 先用 `SKIP LOCKED` claim 唯一 pending operation，claim 无效时零
login；有效时按 login/reauth/readback→restore/post evidence→logout→durable completion/terminalization
执行。不得无限重试或把 cleanup 等待与模型调用混为一体。

离线测试必须覆盖 lease 过期、stale fence、每个 crash point、started 前断线 reconciliation、重复
idempotency、reauth Cookie/CSRF 轮换与 partial response、ignored-abort logout 后同步销毁、receipt ordinal
0 起始、RLS 不变、部署错配、effective-fuse、日志敏感词和所有固定终端文本。真实 Hosted 执行只能在这些检查、migration、normal Web session adapter 与
receipt function 均已实现、双平台 CI 通过并单独获批后进行。
