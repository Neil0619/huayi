# Hosted Cloud Web DeepSeek one-shot executor 设计

状态：Accepted design；Phase A 离线控制合同基础已实现，私有 authority、production adapters、真实
executor、部署与 Hosted 验收仍未实现。

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
terminal，不返回 operation ID；`recover` 只能领取唯一 cleanup-pending operation，多条或状态不确定时失败
关闭。`execute` 持有从批准、部署证明、Operator 登录、开闸、单次请求、服务端 receipt、恢复开关到销毁
会话的完整顺序。相同批准只能形成一个 operation；发生错误时返回稳定的分类错误，不能把密钥、Cookie、
CSRF、输入或模型输出带入错误。网络调用有显式超时，数据库状态转换为常数次往返；不轮询模型之外的
无界资源。

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

### lease、fencing 与顺序

`execute` 领取 120 秒 operation lease；每次续租递增 generation，并返回不可持久化的 fence token。每次状态转换同时校验 operation ID、generation、token hash、前置状态和服务器时间。旧 worker 即使恢复运行也不能写入。

cleanup 使用独立 30 秒 claim 和 10 秒单次外部尝试，避免 operation worker 阻塞恢复。以下顺序是硬不变量：

1. 保存 approval、固定输入摘要和部署对；
2. 建立普通 password Web session 并完成 recent-auth；
3. 持久化 cleanup obligation；
4. 关闭 kill switch；
5. 在发送 HTTP 前原子写入 `dispatch_attempted_at`；
6. 只发送一次真实 Web analysis POST；
7. 绑定 server-generated request ID，冻结 receipt；
8. 恢复 kill switch；
9. 通过正常 logout 关闭本次 Web session；
10. 关闭 cleanup obligations 后终结 operation。

`dispatch_attempted_at` 一旦存在，任何 worker 都不得再次发送 application POST。结果不确定时，恢复逻辑通过 authority 查询并绑定既有 server request；无法证明未发送就失败关闭，不用重放换取成功。

### recovery trigger 与 fail-closed

恢复只有两个执行入口：`execute` 的 `finally` 和显式 CLI `recover`。CLI 的 `status` 在任何新 operation 前
先检查 pending cleanup；只要存在唯一 cleanup-pending 就拒绝 `execute` 并要求先恢复。不得为验收新增
第六个 Cron job，现有 exact 五项 Cron 合同保持不变。

只要存在到期且未完成的“恢复 kill switch”义务，数据库 effective-fuse 读取就立即按 enabled 处理，使
后续平台模型请求失败关闭；显式 `recover` 再经正常 recent-auth admin HTTP mutation 把物理 runtime
control 收敛为 enabled。因此 runner 崩溃不会留下可继续放行的窗口，也不会由后台任务在无人监督时读取
凭据或执行管理 mutation。

### retention

- Operator email/password、Vercel token 和管理员数据库密码只经受控 TTY 输入并存在于进程内存，从不
  落库、日志、argv 或继承环境；
- Cookie、CSRF 和 fence token 只在内存中，绝不持久化；
- 未完成 cleanup 永不自动清除；
- owner、idempotency key、server request ID 和 analysis ID 在 cleanup 关闭 24 小时后清除；
- 部署证明、receipt digest、状态事件与安全错误码保留 90 天后删除；
- 产品 `analysis_requests`、`analysis_records`、quota 和 `usage_ledger` 继续遵守既有产品保留策略，验收器不越权删除用户记录。

## approval 与 server request ID

`ApprovalRequestId` 是批准系统生成的验收标识；`AnalysisRequestId` 只能取自服务端 `analysis.started` 事件或私有 reconciliation 查询。二者永不假设相等。

dispatch 前生成单次 idempotency key，并把其 HMAC、owner ID 和规范请求摘要写入 operation。首次收到 `analysis.started` 时，authority 以 owner、idempotency key 和请求摘要原子绑定 server request ID；若连接在 started 前断开，recovery 用相同三元组查找服务端已建 request。零匹配表示未证明成功，多匹配或摘要不符表示安全错误。

## 真实 Web 路径与 Operator 安全

验收必须走与产品相同的语义路径：

1. `GET /analysis`，确认 Web route 可达并取得完整 runtime deployment attestation；
2. 通过现有 password login 建立 secure Cookie session；
3. password re-auth 获得 recent-auth，服务端轮换 Cookie 与 CSRF；
4. 调用真实 admin kill-switch HTTP 合同关闭 DeepSeek fuse；
5. `POST /v1/analyses:stream`，携带 Cookie、`Origin`、轮换后的 CSRF 和 `Idempotency-Key`，消费到一个终态；
6. 读取私有 server settlement receipt；
7. 经 admin HTTP 恢复 fuse，再通过正常 Web logout 关闭本次 session。

production adapter 只创建普通 password Web session，不新增 acceptance session 类型、特殊 Cookie 或认证
字段。Cookie jar 仅在进程内存中；reauth 后立即销毁旧 Cookie/CSRF，finally 调用正常 logout 后销毁全部
内存值。进程崩溃时不把 session token 写入 authority，也不批量撤销 Operator 的其他 session；残留 session
只按既有 Web session 到期策略失效，cleanup authority 只负责恢复 kill switch。

禁止用 direct Provider、Cloud module、SQL mutation 或 Classic smoke 替代上述路径。`/analysis` 是 Web 页面证明，真正的分析 mutation 是 `/v1/analyses:stream`。

## server settlement receipt 与 RLS

成功条件由服务端冻结的 `SettlementReceipt` 决定，而不是 runner 自报。专用私有函数在一个 repeatable-read snapshot 内连接 operation、server request、terminal analysis record、quota reservation、price snapshot 和 `usage_ledger`，验证：

- request 为终态且只有一个对应 terminal record；
- provider 为 DeepSeek，reservation 已 settle；
- ledger 有 1–2 条，`call_ordinal` 从 0 连续到 `N - 1`，币种、token 与金额一致；
- receipt 绑定规范输入摘要、server request ID 和精确 deployment pair。

函数将 canonical bytes 与 digest 一次性写入私有 operation；冻结后不可改写。产品 owner projection 继续经过强制 RLS；receipt 函数只授予专用 `NOLOGIN` role，不新增 public/API billing receipt route，也不放宽 RLS。

## deployment identity

可信部署来源是 Vercel management API：固定 team/project、production target、READY 状态、production alias、不可变 deployment UID（`dpl_...`）和完整 source commit SHA。API 与 Web origin 各自返回完整 runtime commit attestation，并与 management API 交叉验证。

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

一项 approval 最多一次 application POST 和一次付费 terminal request。每个外部调用有独立 deadline；SSE
总字节、事件数和单事件大小有上限；receipt 读取为有界索引查询；`recover()` 只用 `SKIP LOCKED` claim
唯一 pending operation。不得无限重试或把 cleanup 等待与模型调用混为一体。

离线测试必须覆盖 lease 过期、stale fence、每个 crash point、started 前断线 reconciliation、重复
idempotency、reauth Cookie/CSRF 轮换、receipt ordinal 0 起始、RLS 不变、部署错配、effective-fuse、日志
敏感词和所有固定终端文本。真实 Hosted 执行只能在这些检查、migration、normal Web session adapter 与
receipt function 均已实现、双平台 CI 通过并单独获批后进行。
