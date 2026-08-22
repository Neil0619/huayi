# Phase 53 Hosted application deployment contract

状态：2026-08-22 docs-first、跨文档审查、离线 RED→GREEN、完整 macOS 门和候选提交推送均已完成；
0012 dry-run 只列出 FirstOperatorBootstrap，随后已经实际 push。push 后 diagnostic 证明 12 条 chain、
0012 结构和空 Operator 数据，但也暴露旧版 PostgreSQL 17 membership 校验误判。用户随后已运行修正版
只读 foundation verify 与固定 Operator status，分别返回 passed 与 `empty`。用户随后确认 Reply-To 可用、
已有 hosted DeepSeek key 并批准验收环境产生少量真实费用，同时选择首轮禁用 Store。Vercel project 仍未
创建，DNS/Auth/SMTP/secret、应用部署和邀请也仍未执行。

## 1. 当前事实与目标

Hosted foundation 已在 Supabase project `kpadiulxkgckskcfydry` 完成 bootstrap 与 application login
复验。仓库和远端现均为 12 条 migration；用户以进程级 `PGPASSWORD` 完成只列出
`20260822030000_first_operator_bootstrap` 的 dry-run 后，已实际 push 这一条 migration。push 后的只读
diagnostic 显示 chain/schema/RLS/价格/Storage/空 Auth 与 0012 结构均符合预期，`first_operator_empty` 为真；
旧版 foundation verifier 仅因把 PostgreSQL 17 `NOINHERIT` 产品边误写为 `inherit=true` 并拒绝合法
creator-control 边而失败。用户已在同一工作树运行修正版 foundation verify 并通过，随后固定 Operator
status 返回 `empty`；Auth、profile、Operator 和 invitation 仍为空。
2026-08-22 通过 Google DoH 复核，`app.acceptance`、`api.acceptance`、`notify.acceptance` 与其 DMARC 名称
仍为 NXDOMAIN；Vercel project/link 也尚不存在。

本阶段目标是建立可重复、默认失败关闭的 hosted application deployment contract，然后按固定顺序部署：

```text
remote migration 0012
  -> two Vercel projects + exact custom domains
  -> verified Resend subdomain + separated credentials
  -> Supabase Auth URL/SMTP
  -> production-only Vercel environment
  -> API then Web deployment
  -> TLS/Cookie/CORS/SSE/Auth/Storage smoke
  -> five Supabase Cron jobs
  -> FirstOperatorBootstrap invitation
```

影响平台为 `shared + hosted-acceptance`。不修改 Classic、Store wire、Windows 原生集成或 production
环境。本阶段不启用 Google、真实 Store、外部词典或公开注册。

## 2. 不能绕过的前置条件

1. 第 12 条 migration 已经按“dry-run 只列出 FirstOperatorBootstrap → 用户明确确认 → actual push”完成；
   不得重跑 migration；
2. 修正版 `acceptance:hosted:verify` 已通过，随后 `acceptance:hosted:operator:status` 已返回 `empty`；不能
   重跑 foundation bootstrap；
3. 对话中曾出现的 Resend key 必须先撤销，不能用于 SMTP、R3-C 或 Vercel；
4. `notify.acceptance.seen-said.cn` 必须先按 Resend Dashboard 实际值完成 SPF、DKIM、MX 和初始 DMARC；
5. Supabase Auth SMTP key 与 API R3-C HTTP key 必须是两把独立、sending-only、限定该验收子域的 key；
6. 当前 production API 只接受完整 Resend hosted composition。缺 Resend、DeepSeek、数据库 CA/DSN 或任一
   secret 时必须在初始化阶段失败；禁止填假 key 或把 local disabled 模式带到公网；
7. 用户已确认 hosted DeepSeek key 可用，并批准验收环境产生少量真实费用；仍不得把 key 写入仓库、聊天
   或测试输出，部署时只写入 Vercel Production Sensitive Environment；
8. 最新候选必须是已记录的完整 commit SHA。Vercel 不部署无法追溯的未提交工作树。

Google 可以继续延期。首位 Operator 先用邮箱密码完成正常邀请注册；Google Provider 未配置时 UI/路由
不得冒充可用。

## 3. Vercel project contract

同一 Git repository 建立两个隔离 Hobby project，不建立同源 gateway：

| 项目                       | Root Directory | Framework | Build/Output                            | Runtime/Region                | Domain                        |
| -------------------------- | -------------- | --------- | --------------------------------------- | ----------------------------- | ----------------------------- |
| `seen-said-acceptance-api` | `apps/api`     | Hono      | 原生 Hono 检测；无自定义 output         | Node 22+；Fluid；120s；`sin1` | `api.acceptance.seen-said.cn` |
| `seen-said-acceptance-web` | `apps/web`     | Vite      | `pnpm build`；`dist`；SPA exact rewrite | Node 22 build                 | `app.acceptance.seen-said.cn` |

两个 project 都必须启用 monorepo 的“Include source files outside of the Root Directory”，因为 API/Web
分别依赖根 workspace 下的 `packages/*`；package manager 继续使用根 `packageManager=pnpm@10.12.4` 与
frozen lockfile。Production 环境只跟踪当前受控 acceptance 分支；Preview 不得复用 production 数据库、
Auth、Storage 或 secret，也不能因缺变量而连接 hosted acceptance。若不建立独立 Preview 资源，则 Preview
部署必须保持禁用/失败关闭。

API `vercel.json` 必须把 framework 固定为 `hono`、project region 固定为 `sin1`，保留 `fluid=true` 与
`src/server.ts maxDuration=120`。Vercel 默认 `iad1` 会跨洋访问 Singapore Supabase，不能依赖 Dashboard
手工记忆。Web `vercel.json` 必须固定 `vite`、build/output 和 SPA rewrite。Dashboard 部署后再核对文件配置
确实生效，不能以仓库 JSON 代替生成 Function 的 region/duration 证据。

### 3.1 首次 Git 连接的零部署保险

Vercel 官方 project configuration 支持 `git.deploymentEnabled`。当前 API/Web 两份 `vercel.json` 均固定
`{ "git": { "deploymentEnabled": false } }`，含义是临时禁用所有分支的 Git deployment；这不是 Preview
开关，也不是长期发布策略。即使 GitHub App 权限或连接步骤发生误操作，当前候选也不能因 push 或首次
repository connect 自动创建 deployment。

首次创建必须按以下顺序执行并逐步保存无 secret 证据：

1. 通过 Vercel Projects REST API 创建不带 Git repository 的空 project shell；此步不得产生 deployment；
2. 通过 Projects REST API PATCH 两个 shell 的 Root Directory、framework、build/output、Node/region 等
   已冻结 project settings，并回读确认；
3. 在 Dashboard 分别把 Production Branch 设为 `codex/settings-configuration`；这项设置属于 project，不在
   `vercel.json` 中伪造；
4. 本机只在对应 project link 下执行 Vercel CLI 的 Git connect；两份 JSON 的全分支 kill switch 此时仍为
   `false`，连接完成后确认 deployments 仍为空；
5. DNS、Resend、Supabase Auth/SMTP 和 Production environment 全部完成并复核后，另做一次受审查提交，
   根据当时官方 schema 冻结“只允许 `codex/settings-configuration`”的精确 Git deployment policy，再先
   API、后 Web 发起首次正式 deployment。禁止为了省略该提交直接把布尔值改成允许所有分支。

仓库提供三个固定入口执行上述第 1–2 步，而不要求调用方临时拼接 REST body：

- `pnpm acceptance:vercel:projects:plan`：完全离线，不读取 `VERCEL_TOKEN`；
- `pnpm acceptance:vercel:projects:apply -- --confirm-vercel-empty-projects-neil0619s-projects`：只从进程
  环境读取 `VERCEL_TOKEN`，先用 `GET /v2/teams` 精确匹配 name=`neil0619's projects` 且
  slug=`neil0619s-projects` 的 token-scoped team，再预检两个 project，最后才允许写入；
- `pnpm acceptance:vercel:projects:status -- --status-vercel-empty-projects-neil0619s-projects`：只读回查，
  仅输出 `missing`、`shell-unconfigured` 或 `settings-ready-dashboard-pending` 等有界状态，不输出 team/
  project/deployment ID 或第三方正文。

`apply` 的创建请求固定为 `POST /v11/projects` 且 body 只有 project name，不提供 `gitRepository`；PATCH
固定走 `PATCH /v9/projects/{idOrName}`，写入 Root、Framework、Node `22.x`、root 外 source 和官方支持的
Preview 禁用字段，Web 另写 build/output，API 另写 Fluid、`sin1` 和 120 秒 resource defaults。每次写入前后
都用 `GET /v7/deployments?projectId=...&limit=1` 证明空集合，并通过 `GET /v9/projects/{idOrName}` 回读
Root/Framework/Node/build/output/resource settings 与 Git link 缺失。两个 project 在任何写入前都完成预检；
只接受不存在、全空 shell 或与冻结设置精确一致的零 deployment/零 Git project。已有 Git link、deployment、
环境变量、alias/integration 或部分漂移一律停止，不能覆盖；请求中途失败也立即停止，重跑只会复用已创建的
安全空 shell。

Vercel 官方 PATCH 请求支持 `previewDeploymentsDisabled=true`，但当前官方 project GET response schema 不
返回这个字段，所以脚本只能安全发出幂等请求，不能把它冒充成已回读证明。第 3 步必须在 Dashboard 同时
核对 Preview Deployments disabled，并设置 Production Branch；两项均完成前不得连接 Git。Production-only
环境变量继续属于后续 secret 阶段，本 bootstrap 不创建任何 environment、domain 或 deployment。

官方依据：[Vercel project configuration: git](https://vercel.com/docs/project-configuration#git)、
[Vercel Projects REST API](https://vercel.com/docs/rest-api/reference/endpoints/projects)、
[Vercel Deployments REST API](https://vercel.com/docs/rest-api/reference/endpoints/deployments)、
[Vercel Teams REST API](https://vercel.com/docs/rest-api/reference/endpoints/teams)、
[Vercel CLI git](https://vercel.com/docs/cli/git)。本节 REST 版本和字段另按当前官方 `vercel/sdk` 生成契约
交叉核对。本节记录的是待执行 runbook；截至当前脚本尚未执行外部 `apply`，未创建 Vercel project、连接
repository 或产生 deployment。

`.vercel/` 只保存本机 project link，不提交。项目 ID、team ID、deployment ID 和 custom-domain 记录可写入
无 secret 发布证据；token 与环境变量值不可写入仓库或聊天。

2026-08-22 候选范围复核：当前工作树有 116 个 tracked 修改、103 个未跟踪交付文件、0 个 staged 项；
没有冲突、symlink、超过 1 MiB 的候选、生成目录、归档/可执行/私钥文件或已知泄露 Resend key。通用
`re_` 扫描只命中四个测试文件中的显式假值。该结果证明当前范围可继续收口，不等于已有可部署 commit；
用户已于 2026-08-22 明确确认把完整受审查范围形成候选 commit 并 push，随后实际推送 0012；执行时仍须
重跑 diff/secret/完整 SHA 检查。不得让 Vercel 从未提交工作树或旧远端 SHA 构建。

## 4. Environment contract

### 4.1 API production-only variables

| 变量                                       | 值/来源                                                                 | 分类       |
| ------------------------------------------ | ----------------------------------------------------------------------- | ---------- |
| `HUAYI_API_ORIGIN`                         | `https://api.acceptance.seen-said.cn`                                   | public     |
| `HUAYI_WEB_ORIGIN`                         | `https://app.acceptance.seen-said.cn`                                   | public     |
| `HUAYI_DATABASE_URL`                       | application role + Singapore transaction pooler + `sslmode=verify-full` | sensitive  |
| `HUAYI_DATABASE_TLS_CA_BASE64`             | Supabase Singapore CA 的单证书 base64                                   | sensitive  |
| `SUPABASE_URL`                             | `https://kpadiulxkgckskcfydry.supabase.co`                              | public     |
| `SUPABASE_PUBLISHABLE_KEY`                 | 当前 project publishable key                                            | sensitive  |
| `SUPABASE_SERVICE_ROLE_KEY`                | 当前 project service role key，仅 DataRights/Auth 删除 adapter          | sensitive  |
| `HUAYI_REFRESH_ENCRYPTION_KEY`             | 新生成 32-byte base64url key                                            | sensitive  |
| `HUAYI_SECRET_PEPPER`                      | 新生成 32+ 字符；后续 bootstrap CLI 必须使用同一个值                    | sensitive  |
| `CRON_SECRET`                              | 新生成 32+ 字符 bearer                                                  | sensitive  |
| `HUAYI_DEEPSEEK_API_KEY`                   | 用户已确认可用的独立验收 key；已批准少量真实验收费用                    | sensitive  |
| `HUAYI_DEEPSEEK_LEGACY_PRICE_VERSION_ID`   | `8a7c5397-dbba-4e28-bc0d-107c4d04c3c3`                                  | public     |
| `HUAYI_DEEPSEEK_OFF_PEAK_PRICE_VERSION_ID` | `dad0deb1-cbdc-4311-b3ad-b492c7ece757`                                  | public     |
| `HUAYI_DEEPSEEK_PEAK_PRICE_VERSION_ID`     | `e4479ddf-f4da-4a75-825a-2b25c1a145cf`                                  | public     |
| `HUAYI_STORE_EXTENSION_CAPABILITY`         | 首轮固定 `disabled`；缺失/非法值拒绝启动                                | public     |
| `HUAYI_STORE_EXTENSION_ID`                 | 仅 capability=`enabled` 时必填真实稳定 Chrome ID；首轮必须不存在        | public     |
| `HUAYI_MIN_SUPPORTED_EXTENSION_VERSION`    | `1.0.0`                                                                 | public     |
| `HUAYI_ACCOUNT_EXPORT_BUCKET`              | `account-exports-acceptance`                                            | public     |
| `HUAYI_SECURITY_NOTIFICATION_MODE`         | `resend`                                                                | public     |
| `HUAYI_RESEND_API_KEY`                     | 独立 R3-C sending-only/domain-scoped key                                | sensitive  |
| `HUAYI_SECURITY_NOTIFICATION_FROM`         | `语见 <security@notify.acceptance.seen-said.cn>`                        | public     |
| `HUAYI_SECURITY_NOTIFICATION_REPLY_TO`     | 用户已确认且可收件的支持地址；值不写入仓库或计划输出                    | public PII |

所有 sensitive 变量只创建在 Vercel Production 并启用 Sensitive；不 pull 到仓库文件。公开变量也只作用于
Production，避免 Preview 意外连接同一项目。任何环境变量变化只对下一次 deployment 生效，修改后必须重新
部署并记录 deployment ID/SHA。

首轮 Web-only hosted acceptance 不伪造 Store ID：API composition 不注册配对、设备、ExtensionQuery、
CloudWordCopy、Extension preferences/self-disconnect 等 Store 专用路由，CORS 只允许 Web origin；混合
Web/Store 路由收到任意 `HuayiExtension` token 也固定拒绝。以后启用 Store 必须在同次配置中把 capability
改为 `enabled` 并提供真实 `[a-p]{32}` ID，随后重跑 release audit、部署和真实 Chrome 门禁。

### 4.2 Web build variables and visible identity

- `VITE_API_ORIGIN=https://api.acceptance.seen-said.cn`；
- `VITE_DEPLOYMENT_ENVIRONMENT=hosted-acceptance`；
- build 从 Vercel `VERCEL_GIT_COMMIT_SHA` 注入完整 commit，不要求人工复制；页面只显示
  `Hosted 验收 · <short SHA>`，但 DOM/构建仍可证明完整 SHA；
- hosted 时 `VITE_ACCEPTANCE_MODEL` 必须不存在。`simulated` 只允许固定
  `https://api.acceptance.localhost:8444`，任何公网 origin + simulated 组合在 Web bootstrap 前失败；
- Web bundle secret scan 必须证明 API key、service role、DB URL/CA、pepper、CRON secret 与 Resend key
  均不存在。

## 5. Supabase Auth contract

URL Configuration 固定：

- Site URL：`https://app.acceptance.seen-said.cn`；
- Redirect allowlist 只含以下 exact API path，不使用 `/**` 或 Vercel preview wildcard：
  - `https://api.acceptance.seen-said.cn/v1/auth/callback`
  - `https://api.acceptance.seen-said.cn/v1/auth/password/callback`
  - `https://api.acceptance.seen-said.cn/v1/auth/password/recovery/confirm`
  - `https://api.acceptance.seen-said.cn/v1/auth/reauthenticate/google/callback`
  - `https://api.acceptance.seen-said.cn/v1/account/sign-in-methods/google:callback`

Email/password 保持启用、email confirmation 开启、autoconfirm 关闭，密码长度与 Cloud contract 一致为
12–256。邮件模板必须使用 Supabase 当前动态 RedirectTo/ConfirmationURL，不能硬编码 Site URL，否则
注册/恢复会绕过 API callback。Custom SMTP 固定 `smtp.resend.com:465`、username `resend`、独立 SMTP
key、sender `accounts@notify.acceptance.seen-said.cn` 与品牌名 `语见`。

Google 延期时保持 Provider disabled。未来启用时使用独立 acceptance OAuth client；Google Console 的
Authorized redirect URI 是 Supabase callback
`https://kpadiulxkgckskcfydry.supabase.co/auth/v1/callback`，上面五条应用 API callback 只是 Supabase
redirect allowlist，不能互换。

## 6. DNS、部署与 CRON 顺序

1. 在 Vercel 两个 project 添加 exact custom domain；只复制 Dashboard 当前给出的 CNAME/TXT；
2. 在 Cloudflare DNS 添加记录，初始关闭代理（DNS only），避免域名所有权/TLS 核验被代理掩盖；Vercel
   显示 Valid Configuration 且证书生效后再评估是否保持 DNS only；
3. 在 Resend 添加 `notify.acceptance.seen-said.cn`，逐条复制其 DKIM、SPF/MX，并添加初始
   `_dmarc.notify.acceptance` `p=none`；Resend 显示 verified 后创建两把新 key并撤销旧 key；
4. 配置 Supabase Auth URL/SMTP；Google 保持 disabled；
5. 配置 API/Web Production environment，先部署 API，再部署 Web；
6. API `/health`、Web `/` 与 `/privacy` 通过真实 TLS 后，验证 Cookie/CORS/CSRF/SSE/password callback；
7. 只有稳定 API custom domain 通过后，才把 `configure-supabase-cron.sql` 的固定五项任务写入 Vault/
   `pg_cron + pg_net`；不得使用 Vercel Hobby CRON；
8. operator status 仍为 `empty` 且 Auth/profile/admin/invitation 仍为空后，才能发行 72 小时首张邀请。

## 7. TDD 与验收标准

Fresh RED 必须先覆盖：

1. API/Web Vercel config 缺全分支 `git.deploymentEnabled=false`，或 API 缺
   `framework=hono`/`regions=sin1`、Web 缺 Vite/build/output；
2. hosted Web 缺环境/SHA 可见身份，或公网 origin 接受 simulated；
3. deployment plan 缺任一 Vercel、environment、Auth redirect、SMTP、DNS 或 CRON 项；
4. verifier 输出任何 secret/value，或错误地把 preview 配成 hosted production；
5. Web bundle 含任一服务端 secret 名/值。
6. Vercel empty-project bootstrap 缺 exact team scope、name-only create、settings PATCH、双向零 deployment
   检查、Git/link/漂移失败关闭、幂等重跑、固定 status 或 Token/远端错误不回显。

最小 GREEN 提供一个零网络、零写入的 `pnpm acceptance:hosted:deployment --plan`，只输出固定 project、
Root/Framework/Build/Output/Node/region、变量名分类、五条 Auth redirect、SMTP/DNS/CRON 顺序与 pending
外部门，并明确 project shell → settings PATCH → Production Branch → Git connect 仍为零 deployment，首次
部署必须由后续受审查提交解锁。`--verify-environment` 只读取进程环境，复用生产 schema 验证格式和固定
project/origin 一致性，
只输出 fixed passed/failed，不输出变量值、URL 中密码或第三方错误。

Vercel bootstrap 的最小 GREEN 另要求：`plan` 不访问网络且不读取 Token；`apply` 只有精确确认参数才能访问
REST，先预检两个 project 再按 API→Web 顺序创建/复用；请求序列、method、query、body 和 Authorization
位置必须由 fake fetch 精确断言，且任何路径都不存在 deployment POST。API 错误状态不得读取或反射远端
正文，部分失败后安全重跑必须从空 shell 继续；`status` 只读且输出有界状态。默认自动门不得访问 Vercel。

离线退出门：focused API/Web/script tests、API/Web full、typecheck/build、Prettier/ESLint、Vercel config
schema、secret scan、`git diff --check` 和完整 `pnpm verify:macos`。Hosted 退出门另要求：

- migration 0012 applied + corrected foundation verify passed + Operator status empty；
- 两个 deployment 均绑定记录的 commit，API 位于 `sin1`、Fluid/120s；
- custom-domain TLS、exact CORS、host-only Secure SameSite=Lax Cookie、CSRF、SSE 与五条 callback 通过；
- Resend domain/SMTP/R3-C 两把 key、一次真实确认邮件和一次 R3-C 通知通过，无重复投递；
- 五项 Cron 写入、人工触发与有界响应通过；
- 验收前 Auth/profile/admin/invitation 为空，随后 FirstOperatorBootstrap 完整闭环并访问 `/admin`。

2026-08-22 离线实施证据：Fresh RED 精确命中 API/Web Vercel config、Hosted Web environment/identity、
公网 simulated 和 deployment CLI 缺口；GREEN focused 为 API 1 file / 5 tests、Web 5 files / 15 tests、
deployment Node 4/4。API full 为 136 files / 506 tests，Web full 为 45/45 files / 208 tests，Node scripts
211/211。使用合成 SHA 的 Hosted Web 实际 build 证明短 SHA 横幅、完整 SHA 构建证据及服务端 secret marker
零命中；当前 Vercel schema 识别所固定字段。最终 `pnpm verify:macos` 原样退出 0，覆盖 211/211 Node、
474/474 Vitest files（2,859 passed / 12 skipped）、Store 481/481、Playwright 110/110、全 workspace
format/lint/typecheck/build、architecture、development blocker、Store release 与 production audit。

0012 已实际 push；当前新增的 PostgreSQL 17 membership 修复把三条产品边固定为唯一
`admin=false / inherit=false / set=true`，仅允许可选 `postgres` creator-control
`admin=true / inherit=false / set=false`，并由 bootstrap/verify/diagnostic 复用同一 SQL 契约。实现修复阶段
未连接远端；修正版远端只读 verify 与固定 Operator status 已由用户实际运行并分别得到 passed / `empty`，
因此数据库 foundation 门已关闭；Vercel/DNS/Auth/SMTP/secret/deployment 与邀请门仍保持关闭。

## 8. 文档审查结论与外部输入

2026-08-22 已对 product/architecture/environment/operations/release/implementation plan 做交叉审查。
部署顺序与当前 production composition 一致；主要校准是把 Resend 从“部署后补充”移到 API 部署前，固定
Singapore Function region、五项 CRON、五条 Auth redirect，并让 hosted Web 可见标识 commit。未发现需要
推翻现有架构的阻塞问题，允许按第 7 节进入离线实现。

三项原待定输入现已全部明确，且不使用假值代替：

1. 用户已提供可收件的 Reply-To/支持邮箱；值只在外部配置动作前再次确认，不写入计划输出；
2. 用户已有 hosted DeepSeek key，并批准验收环境产生少量真实费用；key 值只由用户直接写入 Vercel
   Production Sensitive Environment；
3. 首轮 Store 明确禁用，production API 已用 capability=`disabled` 建模并要求 Extension ID 不存在，不填
   `aaaaaaaa...` 冒充真实客户端。未来启用时再要求真实稳定 Chrome ID 和完整 Store 门禁。

本轮 Store-disabled 实现与上述输入校准已通过 fresh 根级 `pnpm verify:macos`：214/214 Node、474/474
Vitest files（2,862 passed / 12 skipped）、Store 481/481、Playwright 110/110，以及全部
format/lint/typecheck/build、architecture、release 和 production audit；production 依赖审计无已知漏洞。
该证据只关闭离线实现门，不代表已创建 Vercel project 或完成任何外部配置、部署、真实请求与邀请。

官方约束来源：

- [Vercel Hono](https://vercel.com/docs/frameworks/backend/hono)
- [Vercel monorepo](https://vercel.com/docs/monorepos)
- [Vercel regions](https://vercel.com/docs/functions/configuring-functions/region)
- [Vercel sensitive environment variables](https://vercel.com/docs/environment-variables/sensitive-environment-variables)
- [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Resend domain verification](https://resend.com/docs/dashboard/domains/introduction)
- [Resend + Supabase SMTP](https://resend.com/docs/send-with-supabase-smtp)
