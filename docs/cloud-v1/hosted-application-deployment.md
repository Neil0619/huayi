# Phase 53 Hosted application deployment contract

状态：2026-08-22 docs-first、跨文档审查、离线 RED→GREEN、完整 macOS 门和候选提交推送均已完成；
0012 dry-run 只列出 FirstOperatorBootstrap，随后已经实际 push。push 后 diagnostic 证明 12 条 chain、
0012 结构和空 Operator 数据，但也暴露旧版 PostgreSQL 17 membership 校验误判。用户随后已运行修正版
只读 foundation verify 与固定 Operator status，分别返回 passed 与 `empty`。用户随后确认 Reply-To 可用、
已有 hosted DeepSeek key 并批准验收环境产生少量真实费用，同时选择首轮禁用 Store。两个 Vercel 空
project 已创建并冻结 project settings；REST 与 Dashboard 均确认零 deployment，Dashboard 还确认两个
Preview environment 均为 Disabled。两个 project 现均已连接精确 GitHub repository `Neil0619/huayi`，
Production Branch Tracking 均为 `codex/settings-configuration`；Root 独立回读两个 Git、Environment 与
Deployments 页面，确认仍无 Production deployment 或 deployment 记录，Production environment 均为
`No Environment Variables Added`。此后 hosted sender DNS 已验证；旧泄露 Resend key 与两把未使用的错误/
临时 R3-C key 均已撤销，当前只保留两把 sending-only/domain-scoped SMTP/HTTP key。Supabase Custom SMTP
已经启用。Phase 64 已完成 Supabase Auth exact URL 配置、API 21/21 与 Web 2/2 Production-only
environment 配置和结构回读；API 精确为 9 项 Sensitive、12 项 public，Web 两项均为 public，四项禁止变量
不存在。Phase 65 把 API policy 收窄为全局拒绝加 `codex/settings-configuration` 精确允许后，API 实际产生
6 个线性 source commit 的 Production deployment 与一次 redeploy；Web 继续
`git.deploymentEnabled=false` 且仍为 `No Production Deployment`。2026-08-23 application 密码轮换后的分段
diagnostic 22 个字段与正式 verifier 均已远端通过，Vercel runtime DSN 也已成功 Rotate。Rotate 后精确 SHA
`7577cdd` 已产生 Ready API deployment `3fxCRe2xku5qzZ8kdbFo4GivGiRL`；随后的 disarm 提交
`00beea8` 未产生 API/Web deployment，两个项目当前均关闭 Git 自动部署。首次 runtime smoke 揭示
`HUAYI_DATABASE_URL` 被误写为固定变量名；错误 redeploy `CHnaZQuohoNiTM4ukQqY1NXQZv2V` 保留。正确 Rotate
后从同一 source 创建的 `DyqRzj5UMN8BRpSeZyohXprnAkaT` 已通过 health 与无写入 application-role 数据库
探针。Provider/Auth、邮件、Cron 和邀请仍未完成。Web 已在后续 Phase 70 得到一条 Ready deployment 并
立即 disarm；发行邀请前还必须部署 Google fail-closed 与 password callback 校准候选。

## 1. 当前事实与目标

Hosted foundation 已在 Supabase project `kpadiulxkgckskcfydry` 完成 bootstrap 与 application login
复验。仓库和远端现均为 12 条 migration；用户以进程级 `PGPASSWORD` 完成只列出
`20260822030000_first_operator_bootstrap` 的 dry-run 后，已实际 push 这一条 migration。push 后的只读
diagnostic 显示 chain/schema/RLS/价格/Storage/空 Auth 与 0012 结构均符合预期，`first_operator_empty` 为真；
旧版 foundation verifier 仅因把 PostgreSQL 17 `NOINHERIT` 产品边误写为 `inherit=true` 并拒绝合法
creator-control 边而失败。用户已在同一工作树运行修正版 foundation verify 并通过，随后固定 Operator
status 返回 `empty`；Auth、profile、Operator 和 invitation 仍为空。
2026-08-22 的历史 bootstrap 前 DoH 复核曾显示 `app.acceptance`、`api.acceptance`、`notify.acceptance` 与
其 DMARC 名称为 NXDOMAIN；随后 `app.acceptance` 与 `api.acceptance` 已完成 Cloudflare/Vercel 配置并通过
递归 DNS、Vercel domain 与 TLS 回读。2026-08-23，Tokyo (`ap-northeast-1`) Resend sender domain
`notify.acceptance.seen-said.cn` 已完成 Resend 指定 DKIM、feedback MX、SPF 与 monitoring DMARC 的
Cloudflare 写入和公共解析复核，Dashboard 显示 `Domain verified: Your domain is ready to send emails`。
此后旧泄露 key 已撤销，Supabase SMTP 与 R3-C HTTP 两把最小权限 key 已分离托管；Custom SMTP 与 API
Production 的 R3-C 通知变量已经配置。Phase 64 又完成 Auth Site URL、五条 exact redirect 和完整 API/Web
Production environment；三项本地生成 Secret 只保存在 macOS login Keychain，不进入仓库或本文。这仍不
等于邮件已投递或应用已部署。两个 Vercel project 已连接精确
GitHub repository `Neil0619/huayi`，Preview 均为 `Disabled`，Production Branch Tracking 均为
`codex/settings-configuration`；API Production 现为 21/21，Web 为 2/2。API 有 10 条 Production deployment
记录，当前 Latest/Current source 为 `7577cdd`；Web Deployments 仍为空，API/Web Git deployment 均为
`false`。

Cloudflare DNS 与公网 TLS 门已完成：`api.acceptance.seen-said.cn` 的 CNAME 为
`7cb58e1372474614.vercel-dns-017.com.`，`app.acceptance.seen-said.cn` 的 CNAME 为
`f0cbaadacf303110.vercel-dns-017.com.`；两条均为 DNS only、Proxy disabled、TTL Auto。Cloudflare 保存后
回读一致，1.1.1.1、8.8.8.8、9.9.9.9 均解析到精确 CNAME；Vercel 两个 custom domain 均显示 properly
configured。两个 HTTPS host 的部署前 TLS 校验曾返回 `curl ssl_verify_result=0` 与预期 404；当前 API
custom-domain `/health` 已返回 TLS 校验通过、HTTP 200 与固定 JSON，Web 仍未部署。此前 NXDOMAIN 与
zero-deployment 只属于历史 bootstrap/连接阶段。

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
3. 密码轮换后的 `acceptance:hosted:application:verify` 已通过，Vercel Production Sensitive
   `HUAYI_DATABASE_URL` 已用当前 application 密码对应的 transaction pooler `6543` DSN 完成纠正 Rotate；
   exact-SHA deployment、disarm、health 与 DB-backed runtime smoke 均已通过；
4. 对话中曾出现的 Resend key 已撤销；误建 Full access 与工具诊断暴露的临时 scoped R3-C key 也已在未
   使用前撤销，均不得用于 SMTP、R3-C 或 Vercel；
5. `notify.acceptance.seen-said.cn` 已按 Resend Dashboard 实际值完成 SPF、DKIM、MX 和初始 DMARC；
6. Supabase Auth SMTP key 与 API R3-C HTTP key 已建立为两把独立、sending-only、限定该验收子域的 key；
7. 当前 production API 只接受完整 Resend hosted composition。缺 Resend、DeepSeek、数据库 CA/DSN 或任一
   secret 时必须在初始化阶段失败；禁止填假 key 或把 local disabled 模式带到公网；
8. 用户已确认 hosted DeepSeek key 可用，并批准验收环境产生少量真实费用；仍不得把 key 写入仓库、聊天
   或测试输出，部署时只写入 Vercel Production Sensitive Environment；
9. 最新候选必须是已记录的完整 commit SHA。Vercel 不部署无法追溯的未提交工作树。

Google 可以继续延期。首位 Operator 先用邮箱密码完成正常邀请注册；Google Provider 未配置时 UI/路由
不得冒充可用。

## 3. Vercel project contract

同一 Git repository 建立两个隔离 Hobby project，不建立同源 gateway：

| 项目                       | Root Directory | Framework | Build/Output                             | Runtime/Region                | Domain                        |
| -------------------------- | -------------- | --------- | ---------------------------------------- | ----------------------------- | ----------------------------- |
| `seen-said-acceptance-api` | `apps/api`     | Hono      | 原生 Hono 检测；无自定义 output          | Node 22+；Fluid；120s；`sin1` | `api.acceptance.seen-said.cn` |
| `seen-said-acceptance-web` | `apps/web`     | Vite      | `pnpm build:vercel`；`dist`；SPA rewrite | Node 22 build                 | `app.acceptance.seen-said.cn` |

两个 project 都必须启用 monorepo 的“Include source files outside of the Root Directory”，因为 API/Web
分别依赖根 workspace 下的 `packages/*`；package manager 继续使用根 `packageManager=pnpm@10.12.4` 与
frozen lockfile。Production 环境只跟踪当前受控 acceptance 分支；Preview 不得复用 production 数据库、
Auth、Storage 或 secret，也不能因缺变量而连接 hosted acceptance。若不建立独立 Preview 资源，则 Preview
部署必须保持禁用/失败关闭。

API `vercel.json` 必须把 framework 固定为 `hono`、project region 固定为 `sin1`，保留 `fluid=true` 与
`src/server.ts maxDuration=120`。Vercel 默认 `iad1` 会跨洋访问 Singapore Supabase，不能依赖 Dashboard
手工记忆。Web `vercel.json` 必须固定 `vite`、`pnpm build:vercel`、output 和 SPA rewrite；该 repository
override 先构建 learning-domain 与 cloud-contracts，再运行 Vite，并覆盖 Dashboard 空 project bootstrap
时期保留的 `pnpm build` setting。Dashboard 部署日志必须实际显示专用命令与依赖顺序，不能只以仓库 JSON
推断它已经生效，也不能机械改写历史 bootstrap 证据。

### 3.1 首次 Git 连接的零部署保险

Vercel 官方 project configuration 支持 `git.deploymentEnabled`。首次连接期间 API/Web 两份
`vercel.json` 均固定 `{ "git": { "deploymentEnabled": false } }`，临时禁用所有分支的 Git deployment；
这不是 Preview 开关，也不是长期发布策略。Phase 65 的 API-only armed policy 改为：

```json
{
  "git": {
    "deploymentEnabled": {
      "**": false,
      "codex/settings-configuration": true
    }
  }
}
```

未声明分支不能依赖平台默认值，因此必须保留 `"**": false`；Web 继续使用布尔 `false`。API policy 按分支
而非按改动路径生效，armed 期间该分支的任意后续 push 都可能再次部署 API；实际修复链已经证明它不能
当成只允许一次 deployment 的平台保证。轮换后 deployment 记录一旦产生，无论 Ready/Error 或 smoke
成败，唯一允许的下一次 push 都是用独立提交把 API 恢复为 `false`；确认关闭提交没有产生 API/Web
deployment 后，才运行 health 与真实 hosted smoke，并准备 Web 解锁。

首次创建必须按以下顺序执行并逐步保存无 secret 证据：

1. 通过 Vercel Projects REST API 创建不带 Git repository 的空 project shell；此步不得产生 deployment；
2. 通过 Projects REST API PATCH 两个 shell 的 Root Directory、framework、build/output、Node/region 等
   已冻结 project settings，并回读确认；
3. 在 Dashboard 打开两个 project 的 `Settings → Environments`，确认 Preview 行均为 `Disabled`，并再次
   确认 Deployments 页面均为 `No Production Deployment`；
4. 依次为 API、Web 执行 Vercel CLI project link 与 Git connect。每连接一个 project，立即在 Dashboard
   确认 repository 精确且 deployments 仍为空；两份 JSON 的全分支 kill switch 此时仍为 `false`；
5. Git link 建立后，分别进入 `Settings → Environments → Production → Branch Tracking`，设置并保存
   `codex/settings-configuration`，每次保存后再次确认 deployments 仍为空。Production Branch 属于 Git
   link，未连接 Git 时 Dashboard 不显示该设置，禁止再要求操作者连接前寻找或伪造它；
6. DNS、Resend、Supabase Auth/SMTP 和 Production environment 全部完成并复核后，Phase 65 受审查提交
   以 `"**": false` + exact branch `true` 只解锁 API，Web 保持 `false`。API deployment 记录产生后，无论
   Ready/Error 或 smoke 成败，唯一允许的下一次 push 都是重新关闭 API；确认关闭提交没有产生 API/Web
   deployment 后，才运行 health/smoke 并以另一受审查提交准备 Web。禁止改成允许所有分支或同时解锁两个
   project。

仓库提供三个固定入口执行上述第 1–2 步，而不要求调用方临时拼接 REST body：

- `pnpm acceptance:vercel:projects:plan`：完全离线，不读取 `VERCEL_TOKEN`；
- `pnpm acceptance:vercel:projects:apply -- --confirm-vercel-empty-projects-neil0619s-projects`：只从进程
  环境读取 `VERCEL_TOKEN`，先用 `GET /v2/teams` 精确匹配 name=`neil0619's projects` 且
  slug=`neil0619s-projects` 的 token-scoped team，再预检两个 project，最后才允许写入；
- `pnpm acceptance:vercel:projects:status -- --status-vercel-empty-projects-neil0619s-projects`：只读回查，
  仅输出 `missing`、`shell-unconfigured` 或 `settings-ready-dashboard-pending` 等有界状态，不输出 team/
  project/deployment ID 或第三方正文。

上述 `apply/status` 只适用于 empty-project bootstrap。当前 project 已有 Git、environment 与 API deployment，
不得重跑；其失败关闭不是当前远端漂移证据。现阶段只使用 Dashboard/受审查的 deployment readback。

pnpm 会把上述命令中的单个 `--` 原样转发给固定了 `apply/status` 的 Node script；CLI 只在该精确位置移除
一次分隔符，然后继续严格校验确认参数，不能接受额外参数。失败时 stderr 只输出白名单
`stage=<input|credential|resolve-team|inspect-api|...>`、`reason=<invalid-arguments|request-rejected|...>` 与
`status=<HTTP code|unavailable|not-applicable>`；这些字段用于定位安全阶段，不包含 URL、请求体、Token、team
数据或第三方错误正文。

`apply` 的创建请求固定为 `POST /v11/projects` 且 body 只有 project name，不提供 `gitRepository`；PATCH
固定走 `PATCH /v9/projects/{idOrName}`，写入 Root、Framework、Node `22.x`、root 外 source 和官方支持的
Preview 禁用字段，Web 另写 build/output，API 另写 Fluid、`sin1` 和 120 秒 resource defaults。每次写入前后
都用 `GET /v7/deployments?projectId=...&limit=1` 证明空集合，并通过 `GET /v9/projects/{idOrName}` 回读
Root/Framework/Node/build/output/resource settings 与 Git link 缺失。两个 project 在任何写入前都完成预检；
只接受不存在、安全空 shell 或与冻结设置精确一致的零 deployment/零 Git project。Vercel 新建空 shell 会把
`sourceFilesOutsideRootDirectory` 安全默认为 `true`；它与冻结目标一致，不能被误判为部分漂移。POST 响应只
作为创建成功确认，随后必须按 name 重新 GET canonical project，再检查精确 account/name、Git、environment、
custom environment、alias/integration、其余配置和零 deployment。已有 Git link、deployment、环境变量、
alias/integration 或其他部分漂移一律停止，不能覆盖；请求中途失败也立即停止，重跑只会复用已创建的安全空
shell。

Vercel 官方 PATCH 请求支持 `previewDeploymentsDisabled=true`，但当前官方 project GET response schema 不
返回这个字段，所以脚本只能安全发出幂等请求，不能把它冒充成已回读证明。Dashboard 已在两个 project 的
`Settings → Environments` 将 Preview 回读为 `Disabled`。Production Branch Tracking 只有 Git link 建立后
才出现，因此它必须在逐项目 Git connect、零 deployment 回查之后设置，并在保存后再次回查零 deployment。
Production-only 环境变量继续属于后续 secret 阶段，本 bootstrap 不创建任何 environment、domain 或
deployment。

官方依据：[Vercel project configuration: git](https://vercel.com/docs/project-configuration#git)、
[Vercel Projects REST API](https://vercel.com/docs/rest-api/reference/endpoints/projects)、
[Vercel Deployments REST API](https://vercel.com/docs/rest-api/reference/endpoints/deployments)、
[Vercel Teams REST API](https://vercel.com/docs/rest-api/reference/endpoints/teams)、
[Vercel CLI git](https://vercel.com/docs/cli/git)。本节 REST 版本和字段另按当前官方 `vercel/sdk` 生成契约
交叉核对。首次 `apply` 因 pnpm 分隔符在本机参数校验阶段退出；第二次创建 API name-only shell 后因安全的
平台默认值被旧分类器拒绝。修正版真实重跑随后完成：API/Web 两个 shell 均已冻结 project settings，REST
确认零 deployment；Dashboard 只读回查确认 API 为 Hono、`apps/api`、Node 22，Web 为 Vite、`apps/web`、
`pnpm build`/`dist`、Node 22，两者均启用 root 外 source、Preview=`Disabled`、无 Production deployment、
无 Git link。Dashboard 还证明未连接 Git 时 Production environment 只显示 `No branch configuration`，
Production Branch Tracking 尚不可设置。随后 API/Web 均已连接精确 GitHub repository `Neil0619/huayi`，
并分别把 Production Branch Tracking 保存为 `codex/settings-configuration`。Root 独立回读两个 project：
Preview 仍为 `Disabled`，Deployments 页面均为 `No Production Deployment` 且没有 deployment 记录，
Production environment 均为 `No Environment Variables Added`。本轮没有接受 permission upgrade，也没有
执行 domain、environment variable 或 deployment 动作；`git.deploymentEnabled=false` 仍使首次部署保持
关闭，不能把 Git/Branch Tracking 门通过解释为 deployment 已就绪。

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

`HUAYI_DATABASE_URL` 必须使用 application role 的 percent-encoded 当前密码和 transaction pooler `6543`；
session pooler `5432` 只供隔离验证器使用。2026-08-23 application 密码轮换后的分段 diagnostic 22 个字段与
正式 verifier 已远端通过。首次 Vercel Rotate 把值误写为固定变量名并由 runtime 500 暴露；纠正 Rotate
同时取得成功回执与 `Updated just now`，随后 exact-SHA `7577cdd` deployment
`DyqRzj5UMN8BRpSeZyohXprnAkaT` 已 Ready，API 继续关闭。结构存在、Ready 或 `/health` 单独通过都不能证明
新 DSN；当前无效 session `/v1/quota` 的精确 401 已关闭 DB-backed application-role 门。

所有 sensitive 变量只创建在 Vercel Production 并启用 Sensitive；不 pull 到仓库文件。公开变量也只作用于
Production，避免 Preview 意外连接同一项目。任何环境变量变化只对下一次 deployment 生效，修改后必须重新
部署并记录 deployment ID/SHA。

2026-08-23 Phase 64 配置结果：API Production 已完成 21/21，精确为 9 项 Sensitive、12 项 public；Web
Production 已完成 2/2 public。全部变量均只属于 Production。`HUAYI_STORE_EXTENSION_ID`、
`VITE_ACCEPTANCE_MODEL`、`VITE_DEPLOYMENT_COMMIT` 与人工创建的 `VERCEL_GIT_COMMIT_SHA` 均不存在；后者由
Vercel 在真实 deployment 时提供，不在 Dashboard 手工复制。三项本地生成 Secret 只保存在 macOS login
Keychain，service 分别为 `huayi-hosted-acceptance-refresh-encryption`、
`huayi-hosted-acceptance-secret-pepper`、`huayi-hosted-acceptance-cron-secret`，account 均为 project ref
`kpadiulxkgckskcfydry`；本文不记录值。数据库 DSN 与 DeepSeek key 由用户直接安全输入，系统剪贴板随后
清空，文档不保存值。三项通知 public 变量曾误设为 Sensitive；因 Vercel 不支持原地关闭 Sensitive，已删除
并按原值重建为 Production-only public，最终结构回读正确。Reply-To 继续只记录为“用户确认地址”。

`acceptance:hosted:deployment --verify-environment` 需要完整值做本地 composition 校验，但 Vercel Sensitive
值在托管后不可回读。因此不能从 Dashboard/API 重建该命令，也不得仅为重跑它而旋转已托管 Secret。当前
完成证据是远端变量名、目标环境和 Sensitive/public 分类的精确结构回读。固定 `/health` 不执行 SQL，只能
证明 domain/TLS/启动/固定 JSON；真实数据库值组合必须由 Rotate 后 exact-SHA deployment 加 DB-backed
application-role smoke 失败关闭验证。

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
- Redirect allowlist 使用固定 path + `\?flow=` + 恰好 43 个单字符 wildcard `?`；不使用 `*`、`**` 或
  Vercel preview wildcard。五条 path 为 `/v1/auth/callback`、`/v1/auth/password/confirm`、
  `/v1/auth/password/recovery/confirm`、`/v1/auth/reauthenticate/google/callback` 与
  `/v1/account/sign-in-methods/google:callback`。

Email/password 保持启用、email confirmation 开启、autoconfirm 关闭，密码长度与 Cloud contract 一致为
12–256。Confirm sign up 模板显示 `{{ .Token }}`，CTA 只用 `{{ .RedirectTo }}`，不得直接链接
`{{ .ConfirmationURL }}`；否则邮件扫描器可提前消费一次性 token。Custom SMTP 固定
`smtp.resend.com:465`、username `resend`、独立 SMTP
key、sender `accounts@notify.acceptance.seen-said.cn` 与品牌名 `语见`。

Google 延期时保持 Provider disabled。未来启用时使用独立 acceptance OAuth client；Google Console 的
Authorized redirect URI 是 Supabase callback
`https://kpadiulxkgckskcfydry.supabase.co/auth/v1/callback`，上面五条应用 API callback 只是 Supabase
redirect allowlist，不能互换。

Phase 64 已回读 Site URL 为 `https://app.acceptance.seen-said.cn`，redirect allowlist 仅含上述五条 exact
URL，无通配符。该状态只关闭 Auth URL 配置门；尚未通过真实 deployment 验证 callback 或邮件。

## 6. DNS、部署与 CRON 顺序

1. 在 Vercel 两个 project 添加 exact custom domain；只复制 Dashboard 当前给出的 CNAME/TXT；
2. 在 Cloudflare DNS 添加记录，初始关闭代理（DNS only），避免域名所有权/TLS 核验被代理掩盖；Vercel
   显示 Valid Configuration 且证书生效后再评估是否保持 DNS only；
3. Resend `notify.acceptance.seen-said.cn` 已逐条配置 DKIM、SPF/MX 与 Dashboard 指定的根域 `_dmarc`
   monitoring `p=none`，显示 verified，且两把分离 key 已托管、旧 key 已撤销；
4. Supabase Auth exact URL 与 SMTP 已配置；Google 保持 disabled；
5. API/Web Production environment 已完成结构复核，Vercel API Production Sensitive
   `HUAYI_DATABASE_URL` 已 Rotate；再次回读 Production Branch 与 Preview Disabled 后，由受审查提交只触发
   一个轮换后 API Production deployment，Web 继续保持零 deployment；
6. API `/health` 与 DB-backed 无写入探针通过后，以独立提交只武装 Web；Web deployment 记录出现后先
   独立关闭 Web Git deployment，再验证 Web `/`、`/privacy`、可见构建 SHA、secret-free bundle、零账号
   CORS/CSRF/SSE/callback 边界；
7. operator status 仍为 `empty` 且 Auth/profile/admin/invitation 仍为空、Web 公共门已关闭后，才能发行
   72 小时首张邀请并正常完成密码注册、SMTP 确认与 callback；
8. complete Operator 后，再通过 `/admin` 受审计切换模型 kill switch 并运行一笔真实 DeepSeek 应用路径
   smoke，完成 model/usage/price/reservation/UsageLedger 对账后恢复 kill switch；
9. 真实 R3-C 投递门关闭后，才把 `configure-supabase-cron.sql` 的固定五项任务写入 Vault/
   `pg_cron + pg_net`；不得使用 Vercel Hobby CRON。

Phase 70 校正了旧的“DeepSeek/Auth 在 Web 前完成”描述：Cloud 模型请求需要真实 Web session，且 hosted
kill switch 当前保持开启；真实 Auth/SMTP 也需要邀请、API callback 和 Web 落点。不得运行 Classic Native
Host 的 `pnpm smoke:deepseek` 冒充 Cloud smoke，不得直接创建 Supabase 用户或用 SQL 绕过 Operator。首次
Web armed policy 只允许 `codex/settings-configuration` 并保留 `"**": false`；API 继续为布尔 `false`。
任何 Web deployment 记录产生后，唯一允许的下一次 push 都是独立 Web disarm。

首次 Web deployment `87fk9rqpGH2sUcGrzCf68tuXjyu8` 已在 source `c9ee267` 上以 Error 结束；独立
disarm `26022a9` 没有新增 API/Web deployment。日志确认旧 `pnpm build` 在干净 checkout 中先解析
`@huayi/cloud-contracts`，但其 ignored `dist` 尚未生成。仓库修复保持 Git deployment 关闭，改用
`pnpm build:vercel` 先构建 learning-domain、cloud-contracts 再运行 Vite；下一次 reviewed re-arm 前必须
先完成离线门，真实 deployment 还必须回读相同构建顺序。修复提交
`aba1cc07a4bea87074068148f672424f3e615f31` 已在双项目 disarmed 状态推送；Dashboard 回读 Web 仍只有
原 Error、API 仍为 10 条，证明 fix-only push 没有触发 deployment。

第二次 reviewed re-arm `b87ef03d948934fad7faf50418e0b79a1914af30` 已产生 Web Production deployment
`6AAAVXP175oviEhrjULxH48eQjPu` 并 Ready；新记录仍在 Building 时先推送独立 disarm `c5c25f5`，两个
project 现在都恢复 `deploymentEnabled=false`，且该提交没有新增 Web/API deployment。custom-domain `/`
与 `/privacy` 均为真实 TLS/HTTP 200，页面显示 `Hosted 验收 · b87ef03`；发布 bundle secret scan、无 Cookie
CSRF/分析 401、缺参数密码 callback 400 与 12 项远端零新增计数均通过。Web 公共门已经关闭，下一门是首张
BootstrapInvitation → 正常密码注册 → Resend Custom SMTP 确认 → API callback → Web 落点；不能再次部署
Web、直接创建 Auth 用户或提前切换模型 kill switch。

## 6.1 Phase 71 邀请前 authentication hardening

Phase 70 的 Ready Web 仍显示 Google 注册/登录，但 hosted Supabase Google Provider 明确 disabled；账号
设置也会显示不可用的 Google link。首张邀请前必须先修复并重新部署：Web 缺
`VITE_GOOGLE_AUTHENTICATION=enabled` 时隐藏 join/login/link/reauth 全部 Google 动作；API 缺
`HUAYI_GOOGLE_AUTHENTICATION=enabled` 时不挂载全部 Google 路由，并在 flow/Provider 前固定 404。两项
变量当前都不得添加，既有 API 21/21 与 Web 2/2 environment 结构不变。

同一候选把密码注册待确认文案改为“打开邮件链接后自动进入工作台”，并把离线 actual-bundle 的旧共用
callback 校准为 `/v1/auth/password/callback`，精确验证 `private, no-store`、`no-referrer` 与 302 `/app`。
完成 Operator 后使用独立 `acceptance:hosted:operator:verify` read-only boolean 验证完整账号链，不能再以
宽松 `status=completed` 代替。外部顺序更新为：API one-shot deploy/disarm/Google route 404 → Web
one-shot deploy/disarm/Google UI hidden → Supabase 邮件模板回读 → 发行邀请。

实际执行中 candidate `eb57887` 在双关闭状态零 deployment；API `f1186a6` / disarm `837ec0d` 与 Web
`beac29d` / disarm `b52992e` 严格串行，分别只产生 Ready deployment
`8XRLHd9B3bFk6cLeGMG8hspQDPVW` 与 `FxmMSypN7cV7UPXQb3XUQU1JGD8L`，两个关闭提交均零新增。API 九条
Google route 全部 404，12 项数据库零状态仍为 true；Web exact SHA、密码专用 UI、零 Google 控件与 bundle
secret-shape scan 均通过。随后真实首张邀请证明 Phase 71 保存态 `{{ .ConfirmationURL }}` 仍会受 scanner
预取与 query allowlist mismatch 影响，因此该段只保留为历史证据。当前部署门以 Phase 72 的
`{{ .Token }}` + `{{ .RedirectTo }}`、inert password confirm、显式 OTP POST 和 0013 原子恢复为准。

## 6.2 Phase 72 中断恢复部署纪律

先在 API/Web 均为 `deploymentEnabled=false` 时提交并推送受审查候选。随后只允许 API arm 提交产生一条
deployment record；记录一旦出现，下一次 push 必须是独立 API disarm，并回读证明它没有产生额外
deployment。只有确认 API 已关闭，才允许 Web 按完全相同的 arm→deployment record→立即独立 disarm→
零额外 deployment 顺序执行；两个项目绝不同时 armed。

API/Web 必须继承同一受审查候选 lineage，但 Vercel 部署由后续 arm 提交触发，disarm 又是独立提交，
因此“同一候选”不表示 API/Web deployment source 必须是同一 SHA，也不表示 source 必须等于最初候选
commit。证据应记录 candidate、各自 arm/deployment source、disarm 及部署计数，而不能用“exact same SHA”
掩盖这组线性提交。

## 7. TDD 与验收标准

Fresh RED 必须先覆盖：

1. API Vercel config 缺 `"**": false` + exact production branch `true`、Web 缺全分支
   `git.deploymentEnabled=false`，或 API 缺 `framework=hono`/`regions=sin1`、Web 缺 Vite/build/output；
2. hosted Web 缺环境/SHA 可见身份，或公网 origin 接受 simulated；
3. deployment plan 缺任一 Vercel、environment、Auth redirect、SMTP、DNS 或 CRON 项；
4. verifier 输出任何 secret/value，或错误地把 preview 配成 hosted production；
5. Web bundle 含任一服务端 secret 名/值。
6. Vercel empty-project bootstrap 缺 exact team scope、name-only create、settings PATCH、双向零 deployment
   检查、Git/link/漂移失败关闭、幂等重跑、固定 status 或 Token/远端错误不回显。

最小 GREEN 提供一个零网络、零写入的 `pnpm acceptance:hosted:deployment --plan`，只输出固定 project、
Root/Framework/Build/Output/Node/region、变量名分类、五条 Auth redirect、SMTP/DNS/CRON 顺序与 pending
外部门，并明确 project shell → settings PATCH → Preview 回读 → Git connect → 零 deployment → Production
Branch Tracking → 再次零 deployment，首次部署必须由后续受审查提交解锁。`--verify-environment` 只读取
进程环境，复用生产 schema 验证格式和固定
project/origin 一致性，
只输出 fixed passed/failed，不输出变量值、URL 中密码或第三方错误。

Vercel bootstrap 的最小 GREEN 另要求：`plan` 不访问网络且不读取 Token；`apply` 只有精确确认参数才能访问
REST，先预检两个 project 再按 API→Web 顺序创建/复用；请求序列、method、query、body 和 Authorization
位置必须由 fake fetch 精确断言，且任何路径都不存在 deployment POST。API 错误状态不得读取或反射远端
正文，部分失败后安全重跑必须从空 shell 继续；`status` 只读且输出有界状态。默认自动门不得访问 Vercel。

离线退出门：focused API/Web/script tests、API/Web full、typecheck/build、Prettier/ESLint、Vercel config
schema、secret scan、`git diff --check` 和完整 `pnpm verify:macos`。Hosted 退出门另要求：

- migration 0012 applied + corrected foundation verify passed + latest application verifier passed + Operator
  status empty；
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
因此数据库 foundation 门已关闭；Vercel project settings、Git repository、Preview、Production Branch、
domain/TLS、Resend sender DNS、分离邮件 credential 与 Custom SMTP 配置门也已关闭。API 只完成 R3-C 通知
变量子集；Phase 64 已完成 Production environment 结构配置，application DSN 也已 Rotate。API 已有部署
历史，但轮换后 runtime composition、邮件、Web deployment、Cron 与邀请门仍保持关闭。

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
该证据在当时只关闭离线实现门，不代表当时已创建 Vercel project 或完成任何外部配置、部署、真实请求与
邀请；后续已单独完成 project bootstrap、Git/Branch Tracking、domain/TLS、Resend sender、分离邮件
credential、Custom SMTP、Supabase Auth exact URL、API 21/21 与 Web 2/2 Production-only environment 和零
deployment 回读。后续 API 已产生 10 条 Production 记录；application 密码轮换后的正式数据库 verifier、
纠正 Vercel DSN Rotate、exact-SHA deployment、立即 disarm 与 DB-backed runtime gate 均已完成。Phase 70
已完成首条 Ready Web deployment、立即 disarm 与零账号公共 smoke；Phase 71 API/Web authentication
hardening 各一次 one-shot Ready/disarm、Google 404/隐藏、零状态、bundle scan 与 confirmation template
回读也已完成。真实 Auth/邮件投递、DeepSeek、Cron 与邀请仍未执行；当前下一步是
BootstrapInvitation → Auth/SMTP/Operator → DeepSeek。

官方约束来源：

- [Vercel Hono](https://vercel.com/docs/frameworks/backend/hono)
- [Vercel monorepo](https://vercel.com/docs/monorepos)
- [Vercel regions](https://vercel.com/docs/functions/configuring-functions/region)
- [Vercel sensitive environment variables](https://vercel.com/docs/environment-variables/sensitive-environment-variables)
- [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates)
- [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Resend domain verification](https://resend.com/docs/dashboard/domains/introduction)
- [Resend + Supabase SMTP](https://resend.com/docs/send-with-supabase-smtp)
