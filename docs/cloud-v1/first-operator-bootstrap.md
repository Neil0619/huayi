# Phase 52 首位 Operator 部署引导方案

状态：2026-08-22 已完成需求、领域、技术、测试与验收方案、离线实现和文档自审；远端第 12 条 migration
已经实际应用，hardened foundation/application verifier 与空 Operator status 当时已通过。2026-08-23 已
发行首张邀请；真实密码确认中断后，Phase 72 已应用第 13 条 migration 并原子恢复账号。2026-08-24 只读
status 先达到 `registered`，随后 First Operator completion 与完整 post-completion verifier 均通过，最终
status 精确为 `completed`。当前不得再运行要求空身份的 pristine foundation verifier，也不得重新发行或
替换 BootstrapInvitation；真实 `/admin` 密码重新认证与四区只读复核随后已经完成，当前下一门是明确
授权一个收件人后创建唯一普通邀请。

## 1. 问题与目标

hosted foundation 完成后，Auth、profile、Operator 和邀请均为空。普通邀请只能由现有 Operator 经
`admin_create_invitation` 创建，因此空环境存在启动闭环。本阶段只解决首位真实 Operator，不实现通用
角色管理，也不改变普通邀请、登录或管理端公开契约。

成功结果必须同时满足：

1. 首位账号仍通过现有 `/join#<token>`、Supabase Auth、邀请 finalization 建立真实 `user_profiles`、
   `account_sign_in_methods` 与当前 UTC 月默认额度；
2. 只有 BootstrapInvitation 最终绑定的唯一账号能被晋升，不能由 CLI 接收任意 userId/email；
3. 不创建公开 bootstrap HTTP route、service-role Web session、虚构 profile/Auth identity 或长期
   bootstrap secret；
4. 协议可安全检查、可在未领取前显式替换丢失的邀请、完成后永久封闭；
5. 部署动作和 Operator 动作保持不同审计语义，明文 token、密码、邮箱和数据库凭据不落库或日志。

影响平台为 `shared + macOS + hosted-acceptance`。本阶段不改变 Classic、Store wire、Windows 原生集成
或 production 数据。

## 2. 领域与状态

- `DeploymentBootstrapAuthority` 是运行固定 CLI 的项目管理员，不是 HuayiAccount/Operator；
- `BootstrapInvitation` 是唯一来源为 `deployment-bootstrap` 的邀请，领取与注册行为与普通邀请完全相同；
- `FirstOperatorBootstrap` 只有 `invited -> completed` 两个持久状态；未领取邀请可在严格空身份条件下
  替换，替换只推进 revision，不新增状态；
- `OperationalAuditEvent` 只记录已认证 Operator 的管理动作。部署引导记录不伪造 `actorUserId`，而由
  私有 bootstrap record、邀请 created/revoked/consumed 时间和最终 `admin_roles.created_at` 组成证据。

```text
empty foundation
  -- issue --> invited + BootstrapInvitation
  -- replace-unclaimed --> invited(revision+1) + old invitation revoked
  -- normal registration --> invited + finalized HuayiAccount
  -- complete --> completed + exact account becomes Operator
```

`completed` 没有回退或第二次执行路径。后续 Operator 授予/撤销不复用本协议。

## 3. 数据结构与数据库边界

### 3.1 邀请来源

`invitations.created_by` 调整为 nullable，并增加：

```sql
created_by_kind text not null default 'operator'
```

约束固定为：

- `operator` 必须有 `created_by`；
- `deployment-bootstrap` 必须没有 `created_by`；
- 其他值拒绝。

普通 `admin_create_invitation/admin_execute` 不变，继续写 `operator + actorUserId`。公开 invitation resource
不暴露 issuer 字段。

### 3.2 私有记录

`huayi_private.first_operator_bootstrap` 恰好最多一行，字段为 singleton、state、current invitation ID、
revision、issuedAt、completedAt、operatorUserId 与 operatorDeletedAt。它不保存 token/hash、email、
密码、Auth provider
资料或数据库凭据；PUBLIC、business、context-setter、runtime 和 application login 均无表权限。

数据库只提供三个 project-admin-only、固定 `search_path` 的 SECURITY DEFINER 操作：

```ts
interface FirstOperatorBootstrap {
  issueInvitation(input: HashedInvitation): Promise<IssuedBootstrap>;
  replaceUnclaimedInvitation(input: HashedInvitation): Promise<IssuedBootstrap>;
  complete(): Promise<CompletedBootstrap>;
}
```

该窄接口是测试面；CLI 负责生成/哈希秘密、TLS、确认参数和固定输出，数据库函数独占并发锁、空状态
guard、状态迁移和精确账号推导。没有接受 userId/email/role 的通用 seam。

### 3.3 强 guard

`issue` 在同一事务和 advisory lock 下要求：当前角色为项目 `postgres` 管理员；bootstrap record、Auth
users/identities、profile、admin role、invitation、claim 与 audit 均为空。它只插入一张
BootstrapInvitation 和一行私有 record。

`replace-unclaimed` 要求 state=invited、当前邀请未消费/未撤销、该邀请零 claim、Auth/profile/admin
继续为空；旧邀请写 `revoked_at`，新邀请成为 current，revision +1。任何 claim、identity 或部分注册
出现后都失败关闭。

`complete` 不接收账号标识。它锁定 current invitation/claim 并要求：邀请已消费且未撤销；恰好一个
finalized claim；bound/finalized user 相同；环境恰好一个 Auth user、一个 profile 且 owner=self；全部
Auth identity、sign-in method 和注册时段 default grant 均属于该账号；admin role 仍为空。随后在同一事务插入
唯一 `operator` role 并把私有 record 置 completed。任何额外账号、错绑定、缺额度、重复或漂移都回滚。

若首位 Operator 后续通过正常 AccountDataErasure 删除账号，`user_profiles` 的窄 `BEFORE DELETE` trigger
只把私有 record 的 operatorUserId 清空并写 operatorDeletedAt；它不会阻止账号、角色或学习数据删除，也
不会重新打开 bootstrap。status 显示 `completed-operator-deleted`，后续恢复运营能力必须走独立受控角色
管理变更。

## 4. CLI 与执行顺序

实现提供六个 Operator 命令、一个可选工程 pepper continuity 诊断和一个零联网 plan：

1. `pnpm acceptance:hosted:operator --plan`：零联网、零写入；
2. `pnpm acceptance:hosted:operator:status --status-first-operator-kpadiulxkgckskcfydry`：只读，只输出
   empty/invited/registering/registration-interrupted/registered/completed/
   completed-operator-deleted/invalid；
3. `pnpm acceptance:hosted:operator:invite --confirm-first-operator-invitation-kpadiulxkgckskcfydry`：要求
   固定管理员 Keychain account、官方 CA、与未来 API 完全
   相同的 `HUAYI_SECRET_PEPPER`；生成至少 256 位 token，只把完整 `/join#...` URL 显示一次；
4. `acceptance:hosted:operator:replace`：仅用于输出丢失且尚无 claim/identity 的邀请；
5. `acceptance:hosted:operator:complete`：用户正常注册后运行；不接受 userId/email；
6. `acceptance:hosted:operator:verify`：complete 后只读验证完整首账号链；不接受 userId/email，也不输出
   UUID、邮箱、hash、Cookie 或数据库错误。
7. `acceptance:hosted:operator:pepper:verify`：仅当自动化或受控运维已有安全、非回显的 managed token
   source 时使用；固定 project，只返回 fixed passed/failed。它不是用户验收步骤，不能要求用户识别、
   复制或输入原邀请 URL fragment。

两条较长命令的精确形式为：

```zsh
pnpm acceptance:hosted:operator:replace \
  --confirm-replace-unclaimed-first-operator-invitation-kpadiulxkgckskcfydry
pnpm acceptance:hosted:operator:complete \
  --confirm-complete-first-operator-kpadiulxkgckskcfydry
pnpm acceptance:hosted:operator:verify \
  --verify-completed-first-operator-kpadiulxkgckskcfydry
pnpm acceptance:hosted:operator:pepper:verify \
  --verify-hosted-pepper-continuity-kpadiulxkgckskcfydry
```

命令固定 Singapore transaction pooler、project ref、`sslmode=verify-full` 与已校验 Supabase CA，继承
foundation CLI 的临时 0600 root certificate 和有界错误输出。argv、SQL、stdout/stderr 不含数据库密码；
数据库只接收 token hash。邀请 URL 是唯一允许的 secret stdout，调用者不得粘贴到聊天、文档或日志。
可选 pepper 诊断只能从 managed token source 取值，不能由用户手工提供。

pristine 环境的原始顺序为：完成 hardened foundation verify -> 创建并配置隔离 API/Web/Supabase Auth ->
确认部署 commit/health -> 发行邀请 -> 用户浏览器正常注册 -> complete -> post-completion verify -> 用户重新
登录/重新认证并访问 `/admin`。Phase 72 中断恢复已按以下顺序完成：0013 diagnostic/application verifier ->
API/Web 严格串行部署 -> 浏览器自动提交原邀请 + Provider 密码证明 -> API/0013 在写入前验证 pepper
continuity -> status `registered` -> complete -> post-completion verify -> status `completed`。当前非空状态不运行
pristine foundation verifier，也不 replace、不重新 claim、不新发 BootstrapInvitation；`/admin` recent-auth
与四区只读已经完成，普通邀请只能在明确授权一个收件人后创建。

## 5. TDD 与验证矩阵

1. migration RED：current baseline、baseline->forward、Supabase mirror、约束、权限和重复执行；
2. issue RED：精确空状态成功；任一 Auth/profile/admin/invitation/claim/audit 非空、非管理员、并发调用
   失败；token 明文不存在于 SQL/DB；
3. replace RED：只有零 claim/零 identity 的 current invitation 可替换；旧邀请撤销、revision 单步推进；
4. complete RED：password 与 Google 两条正常 finalization 均可推导同一账号；错 claim、额外账号、缺
   method/quota、已撤销邀请、重复完成和并发完成均零部分写；
5. 权限 RED：application/runtime/business/context-setter 不能读私表、调用函数、直接写 issuer/admin role；
6. CLI RED：plan/status 零写入，确认/project/TLS/CA/pepper 缺失先失败；固定 stdout/stderr 不泄露；
   post-completion verify 使用一个 read-only transaction/boolean，严格验证 completed bootstrap、当前消费邀请、
   唯一 claim/confirmed Auth user/active self-owned profile、password-only method、1,000,000 default grant、唯一
   Operator、已消费 invite flow、唯一 full session、仍开启 kill switch，以及零 audit/analysis/usage/reservation/
   rate-limit；任一漂移失败关闭；
7. 集成 GREEN：PGlite 跑完整注册事务再 complete，并证明普通 Operator 邀请行为未变；
8. 完整门：format、lint、typecheck、test、e2e、build、`verify:macos`、diff/secret scan。

真实 hosted 门另要求 migration dry-run/显式 push、admin status、一次浏览器注册、complete、admin verify、
application role 越权复验和 `/admin` 真实 Cookie/CSRF journey。离线测试不能替代这些证据。

## 6. 验收与恢复

- 邀请发行前故障：事务回滚，状态仍 empty；
- 发行成功但 URL 丢失：只有完全未领取时可 replace；否则停止并调查，不能 reset 或删除 Auth 行；
- 注册中断：复用现有邀请/claim/auth-flow 恢复规则，不运行 complete；
- 注册完成但 complete 失败：修复 guard 所揭示的漂移后重跑，同一账号不会重复 role；
- complete 成功但 UI 失败：只读 verify 后重新登录/重新认证，不重新发行邀请或手工写 role；
- 任一远端写入前必须记录无 secret 的 migration、project ref、commit 和回滚边界；数据库只通过新的
  forward migration 修复，不能 down/reset。

## 7. 文档自审结论

2026-08-22 按产品、架构、数据、API、安全、测试和运维边界复审后，方案保留正常账号权威，且没有把
部署管理员伪装成 Operator。两阶段虽增加一次人工步骤，但避免公开 bootstrap endpoint、任意 userId
晋升和 service-role session，接口比单阶段“直接插 profile/admin row”更窄。替换只限零 claim/零 identity，
关闭了 token 丢失时最危险的人工 SQL 诱因。实现审查又发现私有 operatorUserId 外键会阻断首位账号
删除，现已改为删除时清除 UUID、保留无身份 completion record 的 trigger，并加入回归。当前无待用户
决策；新的 forward migration 获得显式远端写入确认前不得 push 到 Supabase。

## 8. 2026-08-22 离线实现记录

- baseline 与 `0012-first-operator-bootstrap.sql`/Supabase timestamp mirror 已加入 issuer constraint、私有
  record、三条 project-admin-only function 和账号删除身份清理 trigger；current baseline 重放与旧 schema
  升级均通过；
- hosted CLI 已固定 project/pooler/verify-full CA、plan/status/invite/replace/complete、同 API pepper hash
  与一次性 fragment URL；package scripts 不接受 candidate userId；
- focused 数据库 8/8、CLI 5/5、hosted/local scripts 18/18、既有认证/管理/migration 38/38、账号删除
  15/15 通过；targeted Prettier/ESLint 与 diff check 通过；
- fresh `pnpm verify:macos` 原样退出 0，覆盖 207/207 Node scripts、473/473 Vitest files（2,855 passed /
  12 skipped）、Store coverage 481/481、Playwright 110/110、全部 workspace build、architecture、development
  blocker、Store release 和 production dependency audit；
- 第 12 条 migration 后续已经 dry-run、明确确认并实际 push；首张邀请发行后形成的
  `registration-interrupted` 状态已由 Phase 72 的 0013 和中断恢复流程接管。0013 已作为第 13 条 migration
  实际应用，恢复、First Operator complete、post-completion verify 与最终 `completed` status 均已完成；
  `/admin` recent-auth UI 已受控部署；后续真实密码重新认证与四区只读复核也已完成，当前只等待明确授权
  一个收件人后创建唯一普通邀请并执行 OTP journey。
