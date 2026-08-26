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
receipt 失败仍可在没有伪造 request evidence 的情况下恢复 fuse。CLI 仍只有零 I/O `plan`。

退出标准：旧预选 request ID 合同稳定 RED，新 interface、bounded status 与零重放 reconciliation 均与设计
逐项对应。Phase A 已完成；这不表示 Postgres authority、production adapter 或真实 Hosted executor 已实现。
尤其是 worker 退出后的跨进程 dispatch-before-bind 恢复仍属于 Phase B，当前 fake authority 证据不能替代它。

## 阶段 B：私有 Postgres authority

- [x] 新增 forward-only API/Supabase byte-identical migration；
- [x] 创建 `huayi_private.hosted_acceptance_operations`、单向 state、lease generation/token hash、唯一
      non-terminal constraint 和 90 天 retention；
- [ ] effective-fuse 在 cleanup 逾期时强制按 enabled 读取；不新增第六个 Cron job，不改变 exact 五项
      Cron 安装合同；
- [ ] fixed functions 覆盖 claim、arm cleanup、bind request、record settlement、complete、claim cleanup、
      status 和 retention；
- [ ] 持久化 dispatch idempotency key、owner 与 payload digest；新进程在 dispatch-before-bind 状态只允许
      exact-one reconciliation 并继续原 operation，零第二次 application POST；
- [x] 撤销 PUBLIC/API/business/runtime 权限，只允许管理员数据库入口；
- [ ] PGlite 回归覆盖并发消费、旧 lease fencing、崩溃窗口、multiple pending、cleanup-pending 不删除和
      跨租户 request binding 拒绝。

退出标准：authority 可由 production Postgres adapter 与 PGlite adapter 穿过同一内部 seam 验证。

当前检查点：首个 Phase B 离线切片已建立 operation/cleanup 私有表、operation 与 cleanup 的单向
state guard、generation/token 同步轮换结构 guard、唯一 non-terminal operation、90 天 operation retention、
强制 RLS 与 owner-only 表权限；API/Supabase migration 已由 byte identity 和 PGlite 并发/约束/ACL 回归
覆盖。专用
`NOLOGIN` executor role 目前没有表权限，也尚未获得任何函数执行权限。effective-fuse，以及 claim、arm
cleanup、bind request、record settlement、complete、claim cleanup、status、retention 与跨进程
dispatch-before-bind reconciliation 的最小 `SECURITY DEFINER` mutation functions 和真正的 fence-token
校验仍未实现，不能把本检查点当作 production adapter 或 Hosted executor 已就绪。
Phase 91 的 15-file rebuild/backup evidence 仍只证明 0015；其 loader 现在必须拒绝当前 16-file repository。
0016 在任何 Hosted dry-run/apply 前需要新的受控 backup/rebuild 批次，禁止改写或冒用 Phase 91 证据。

## 阶段 C：正常 Web session adapter

- [ ] 实现 TTY-only 邮箱/密码读取，拒绝 argv/env/file fallback 和控制字符；
- [ ] 使用现有 password login、CSRF、recent-auth、Operator readback、kill-switch 和 analyses SSE/status
      合同；
- [ ] Cookie jar 和凭据仅在内存中，finally normal logout 后主动销毁；不新增 purpose session、特殊 Cookie
      或 acceptance auth 字段；
- [ ] 固定 sentence/payload，禁止 title、userContext 和自定义正文；
- [ ] fake HTTP 回归覆盖 Cookie/CSRF 轮换、401/403、SSE 中断、started-only/status recovery、deadline、
      ignored abort、logout 失败和零透明重试。

退出标准：没有 acceptance-only 分析 route/header/body，正常 Web 合同是唯一 Provider dispatch 路径。

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
- [ ] 90 秒应用 deadline、10 秒 cleanup、cleanup-first finally、unique pending recovery 和固定 stage 错误；
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
