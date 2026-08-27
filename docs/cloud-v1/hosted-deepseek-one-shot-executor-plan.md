# Hosted Cloud Web DeepSeek 单次验收执行器实施计划

影响平台：`shared + hosted-acceptance`。所有默认测试离线、无秘密、无真实模型和费用；真实 Hosted
执行必须在实现、审查、双平台 CI 与前置 Auth/R3-C/Cron 门完成后另行批准。

## 阶段 A：更新控制面合同（Fresh RED）

- [x] 先写回归，证明 approval 不再接受 owner/request/idempotency 等 opaque 输入；
- [x] 证明 authority seam 在 mutation 前生成 operation/idempotency，并在 SSE `analysis.started` 后绑定
      server-generated request ID；
- [x] 证明 POST 后、客户端观察 `analysis.started` 前的进程内 transport disconnect 只对账并绑定原
      request，cleanup recovery 前后 application POST 总数仍为一；
- [x] 把 tests 从直接编排 lifecycle/adapter 迁移到 executor 的 `status/execute/recover` interface；
- [x] 用五秒 bounded authority read 覆盖 absent、ready、running、cleanup-pending、terminal，且 status 零
      mutation、多条/未知状态失败关闭。

当前检查点：Phase A 已用离线 lifecycle/fake HTTP 完成 Fresh RED→GREEN；caller 只能取得冻结的
`status/execute/recover` 对象；进程内 transport disconnect 只允许 exact-one reconciliation，dispatch
receipt 失败仍可在没有伪造 request evidence 的情况下恢复 fuse。fresh pre-snapshot 在 claim 前验证；
claim 钉住固定 payload digest 与 exact deployment pair；operation/cleanup 私有写入分别携带 generation 与
raw token；cleanup 沿用 operation ID 且不持久化 raw idempotency key/owner，operation lease 覆盖应用与
cleanup 完整窗口，claim 后过期会安全终结，cleanup arm 不确定会保守进入 cleanup-pending；recovery 完成
cleanup 时同步终结 operation。CLI 仍只有零 I/O `plan`。

退出标准：旧预选 request ID 合同稳定 RED，新 interface、bounded status 与零重放 reconciliation 均与设计
逐项对应。Phase A 已完成；Postgres authority 与跨进程 dispatch-before-bind 恢复随后由 Phase B 闭合，
但 production HTTP adapter、composition root 或真实 Hosted executor 仍未实现。

## 阶段 B：私有 Postgres authority

- [x] 新增 forward-only API/Supabase byte-identical migration；
- [x] 创建 `huayi_private.hosted_acceptance_operations`、单向 state、lease generation/token hash、唯一
      non-terminal constraint 和 90 天 retention；
- [x] 新增 0017 retention-scrub structure：terminal 满 24 小时后只允许一次同时清除 owner/HMAC/request，
      其余 receipt/deployment/terminal/time evidence 不可改写；0020 再提供 bounded private retention function；
- [x] 0019 effective-fuse 在 cleanup 逾期/异常时强制按 enabled 读取，并接入 reservation 与 Operator summary；
      正常 running + pending cleanup 仅在 server-time lease 未到期且不超过 armed 后 120 秒时继续放行；
      不新增第六个 Cron job，不改变 exact 五项 Cron 安装合同；
- [x] 新增 0018 strict private status：只返回 absent/单一安全状态，multiple/unknown 固定失败关闭，且
      EXECUTE 只授予专用 executor；
- [x] fixed functions 覆盖 claim、arm cleanup、bind request、record settlement、complete、claim cleanup、
      retention；
- [x] 只持久化 versioned HMAC verifier/context/version、owner 与 payload digest，不持久化 raw key；新进程
      以 operation identity + retained version 重建并验证同一 material，在 dispatch-before-bind 状态只允许
      exact-one reconciliation 并继续原 operation，零第二次 application POST；
- [x] 撤销 PUBLIC/API/business/runtime 权限，只允许管理员数据库入口；
- [x] PGlite 回归覆盖并发消费、旧 lease fencing、崩溃窗口、multiple pending、cleanup-pending 不删除和
      跨租户 request binding 拒绝。

退出标准：authority 可由 production Postgres adapter 与 PGlite adapter 穿过同一内部 seam 验证。

当前检查点：Phase B 已由 forward-only 0016–0020 离线闭合。0020 的 fixed-search-path
`SECURITY DEFINER` functions 使用 server-time generation/token fencing；arm 保持 cleanup=pending，live
operation/cleanup lease 不可抢占，pre-dispatch crash 只恢复 fuse，completed-cleanup crash gap 只做 authority
finalization。versioned HMAC keyring 固定 context，新 operation 只用 active version，旧 version 只为既有
operation recovery 保留，raw material/key 均不进入 authority 或日志。相同 request+receipt digest 可幂等
恢复，不同 digest 拒绝；key version 参与 HMAC domain separation，bind 精确核对产品 request 的
owner/raw key/payload，raw key 不写入 authority。bounded retention 以 scrub/delete 共用总预算，正向证明
24 小时 scrub、90 天 terminal delete 与 cleanup-pending 保留。
两个独立 executor/authority 实例共享同一 PGlite 的回归证明 dispatch-before-bind 后重启只做 exact-one
reconciliation，application POST 总数仍为一；零条/多条均失败关闭并完成 cleanup/terminal failure。
Phase 91 的 15-file rebuild/backup evidence 仍只证明 0015；其 loader 必须拒绝当前 20-file repository。
0016–0020 在任何 Hosted dry-run/apply 前需要新的受控 backup/rebuild 批次，禁止改写或冒用 Phase 91 证据。

## 阶段 C：正常 Web session adapter

- [x] 实现离线可注入的 TTY-only 邮箱/密码读取层：两项均经 hidden prompt，拒绝非交互 input/output、
      argv/env/file fallback、非法邮箱/密码与全部 C0/C1 控制字符；返回 frozen non-enumerable 内存对象；
- [x] 私有 lifecycle 只在 session-free preflight 与 operation claim 均有效后，使用现有 password login、
      password reauth 与 Operator readback；三步共用一个绝对 10 秒 session-establishment envelope；
- [x] 私有 Cookie/CSRF adapter 只保存在内存，reauth 先采纳 replacement 再校验 rotation，旧 material 永不
      回退；partial login/reauth 的有效新 Cookie 只保留作 logout-only material；
- [x] 所有 post-login exit 先 cleanup、再以不继承 application abort 的独立绝对 10 秒 normal logout；
      logout outcome 后同步幂等销毁 capability，才 durable complete cleanup / terminalize operation；
- [x] 把上述 private seam 接到 production password/CSRF/Operator/kill-switch/analyses SSE/status HTTP
      transport；不新增 purpose session、特殊 Cookie 或 acceptance auth 字段；
- [x] 在 Phase A private request builder 固定 normal-Web sentence body，source 只含 `type: manual`，禁止
      caller/adapter contract 覆盖 title、userContext、selection/source type 或正文；canonical JSON 与既有
      SHA-256 payload digest 由同一深冻结对象回归绑定；
- [x] fake session 回归覆盖顺序、claim 前零 login/logout、Cookie/CSRF rotation 与 partial response、
      application abort、ignored-abort logout、固定 logout 失败、durable cleanup 和 recovery 顺序；
- [x] production-shaped fake HTTP 覆盖 401/403、Cookie/CSRF rotation、SSE 中断、started-only/status
      recovery、deadline/JSON/SSE bounds 与零透明重试；Phase B 的 exact-one reconciliation regression 继续
      覆盖私有 authority port，public HTTP transport 对该未连接 port 固定失败且零网络。

退出标准：没有 acceptance-only 分析 route/header/body，正常 Web 合同是唯一 Provider dispatch 路径。

当前检查点：fixed normal-Web request body 已离线接入 Phase A 的唯一
`invokeCloudWebAnalysis(request, control)` 调用；private session lifecycle 与内存 adapter 也已按
preflight→claim→login/reauth/readback→arm/application→cleanup→logout→durable completion/terminalization
闭合。arm 后必须留出 90 秒 application + 10 秒 cleanup + 10 秒 logout，不能越过 0019 的
`armed_at + 120s`；私有 arm receipt 带 server-authoritative `armedAt`，executor 禁止用响应后的本地时间
替代，并拒绝早于 pre-snapshot 或晚于本地 arm response 的值。recovery 也在 login 前拒绝晚于 claim 后
采样时钟的 `armedAt`。recovery 采用 60 秒 cleanup claim，为三个 10 秒 envelope 后的终态写入保留 30 秒。
`capturePreSnapshot()` 当前仍是 session-free injected seam，production Vercel/Web per-call deadline 属于
Phase D，不能冒充为已 bounded。normal Web production-shaped transport 已固定连接既有 password login、
password reauth、Operator access、kill-switch、analysis SSE、request status 和 logout routes；不接受
endpoint/body 覆盖，不新增 acceptance route/header/session。SSE 只有在已知且严格 UUID 的 server request ID
后才做一次 bounded status read，started 前断线的 exact-one query 仍由尚未连接的私有 Phase D authority
adapter 承担。
`status/execute/recover`、CLI 与 public HTTP contract 均未扩大；这仍不表示 production composition root、
Hosted session 或真实调用已实现。

## 阶段 D：deployment 与 settlement adapters

- [ ] Vercel adapter 固定 team/API/Web project，只读 READY Production identity/in-flight，并校验 live health/
      release banner；
- [ ] Postgres receipt reader 只 join 已绑定 request 的 request/reservation/record/metadata/UsageLedger；
- [ ] 验证一至两条连续 billed call、实际 token/cost、price UUID/slot、reservation、owner delta、候选部署和
      kill-switch restoration；
- [ ] 输出 parser 只接受 fixed boolean/count/enum/receipt，不反射 UUID、owner、request、正文或 raw error。

退出标准：legacy/拼接/跨租户/旧 deployment/聚合 usage 等弱证据全部稳定失败关闭。

## 阶段 E：deep module 与 CLI

- [ ] 把 Phase A 已完成的 `status()`、`execute(approval)`、`recover()` 接入 production composition root；
- [ ] CLI 保留零 I/O `plan`，新增固定 `status`、exact-confirmation `execute` 和无 opaque ID 的 `recover`；
- [x] 内部合同固定共享 10 秒 session establishment、90 秒应用、10 秒 cleanup、独立 10 秒 logout、
      cleanup-first finally、valid-claim-only recovery 和 logout outcome 后终态化；
- [ ] 新 operation 遇到 cleanup-pending、dirty/unpushed candidate、deployment drift、recent-auth drift、预算
      不足或非固定输入时零 mutation。

退出标准：interface 之外没有调用者可见的步骤编排；删除 module 会让复杂性回到多个 caller，证明其具有
实际 depth。

## 阶段 F：离线完整验证与文档

- [ ] focused RED→GREEN、`pnpm test:scripts`、API PGlite、cloud-contracts、format、lint、typecheck、
      architecture、build 和 `pnpm verify:macos` 全绿；
- [ ] shared 候选 push 后触发 exact-SHA Cross-platform quality，macOS/Windows 两 job 均 success；
- [ ] 更新 API/data/security/testing/operations/release checklist/evidence，明确“implemented”不等于真实
      paid acceptance；
- [ ] 审查无 secret、远程代码、动态 endpoint、测试后门和 Classic 行为变化。

退出标准：`implemented; target-platform validation pending` 只能在对应 Windows 证据缺失时使用，不能把
fake/PGlite/Mac 冒充真实 Hosted 请求。

## 阶段 G：真实 Hosted one-shot（独立批准）

- [ ] 前置 exact-SHA CI、同一邀请/Auth、R3-C、Cron、Operator password recent-auth 与小额预算均关闭；
- [ ] read-only status 为 ready，API/Web 精确 READY 且双 deployment policy 继续 disarmed；
- [ ] 用户明确批准一次小额 peak reservation 后只运行一次 `execute`；
- [ ] 验证 model、usage、实际 price、reservation、UsageLedger、90 秒分类和实际账单；
- [ ] 无论成功失败都证明 kill switch restored；cleanup-pending 时只运行 `recover`，禁止第二次 execute；
- [ ] 导出脱敏 receipt，完成 retention 与正常 Web 数据清理决定。

退出标准：真实 Web 应用路径、费用事实、账本和恢复全部一致；随后才可关闭 Cloud DeepSeek 发布门。
