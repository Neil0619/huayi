# 个人使用的测试与正式环境

语见用于本人及朋友小范围、非商业使用。测试环境和正式环境分别部署，继续采用邀请制。
正式环境沿用 Vercel、Supabase、Resend，优先使用当前免费套餐；创建资源时仍以实际账户额度为准。

## 环境身份

| 项目             | Hosted 测试环境                       | 独立正式环境                           |
| ---------------- | ------------------------------------- | -------------------------------------- |
| Web              | `https://app.acceptance.seen-said.cn` | `https://app.seen-said.cn`             |
| API              | `https://api.acceptance.seen-said.cn` | `https://api.seen-said.cn`             |
| 发布渠道         | `hosted-acceptance`                   | `production`                           |
| 页面标识         | 保留 Hosted 验收横幅及版本            | 不显示验收横幅                         |
| 数据、账号和密钥 | 保留既有验收资源                      | 使用新建的独立资源                     |
| 扩展构建目录     | `apps/store-extension/dist`           | `apps/store-extension/dist-production` |
| 扩展 ID          | `hoijjhgcckfhbcefoclgbhkgninnkknd`    | `enlolhfodncfnleiihkjanhmnfbgeggh`     |

表中的正式地址是代码约定，不代表资源已创建或正式站已上线。Vercel 平台的技术环境名
`production` 不等于语见产品的正式发布，两个独立项目都可能使用该技术环境名。

Web 使用 `VITE_DEPLOYMENT_ENVIRONMENT`，API 使用 `HUAYI_DEPLOYMENT_ENVIRONMENT` 指定上述发布渠道。
两端在显式配置渠道时要求完整的 `VERCEL_GIT_COMMIT_SHA` 和 `VERCEL_DEPLOYMENT_ID`；Web 构建将
完整提交和部署 ID 写入 HTML，API 响应头包含对应身份。正式渠道只接受正式 Web/API 地址，固定连接
独立项目 `pxqqgxfumovegbcxnmzb`；数据库连接与 Supabase API 必须指向同一个项目。
最终发布适配器还必须核对平台返回的实际生产项目 ID，运行时校验不能代替资源核对。

既有 API 验收部署暂不要求新增渠道变量；其完整 Vercel 身份仍按 `hosted-acceptance` 回读。
正式地址必须显式配置 `production`，不能靠省略变量、移除横幅或改写回执把验收环境升级为正式环境。

## 发布顺序

1. 保留验收站，创建独立的正式 Supabase 和 Vercel 项目，记录平台返回的真实身份。
2. 独立设置 Auth、数据库、Storage、邮件域、密钥、配额和维护任务，不复制验收账号或数据。
3. 完成正式 Web 安全响应头、Store 构建配置及发布材料。`apps/web/vercel.mjs` 按明确渠道生成响应头，
   正式发布检查设置 `HUAYI_RELEASE_ENVIRONMENT=production` 和 `HUAYI_STORE_BUILD_PROFILE=production`，
   读取该候选的实际配置；发布检查必须核对编译后的扩展配置、真实消费者、包内容和独立 ID。
   `acceptance-hosted-*` 适配器仍固定验收目标，不能直接用于正式发布。
4. 冻结最终候选，在测试环境验收，并完成该准确 SHA 的双平台完整 CI 与相关专项门禁。
5. 按 API → Web 发布到正式资源，核对 DNS/TLS、实际版本、鉴权、环境隔离及核心功能。

已有 Hosted 部署和旧候选 CI 仅证明对应版本的验收里程碑。正式资源、最终候选验证和线上回读完成后，
才能将“发布到生产”记为完成。数据库密码由操作者直接设置并妥善保存，不进入聊天或仓库。

独立正式候选沿用 `cross-platform-quality.yml` 的两个原生 job，dispatch 的 `candidate_sha` 为冻结的
完整 SHA，`release_id` 为 `production-<同一 SHA>`。候选断言同时接受原来的 Hosted 标识和正式标识，
均必须与实际 checkout 相同；工作流、平台命令和失败阻断语义保持不变。

初始化凭据通过 macOS 的 `pnpm production:credentials:configure` 独立保存；具体顺序和隔离范围见
[macOS 配置说明](../setup-macos.md#配置正式环境初始化凭据)。该命令只保存本机凭据，不执行迁移或部署。

Web 使用 Vercel 官方支持的 [programmatic configuration](https://vercel.com/docs/project-configuration/vercel-ts)，
同一项目仅保留 `vercel.mjs`。测试渠道保留原来的四项安全响应头；正式 CSP 只允许正式 API 与
`pxqqgxfumovegbcxnmzb.supabase.co` 登录跳转。未知渠道和跨环境 API 配置直接失败。
历史 `acceptance-vercel-one-shot-*` 回执继续绑定原候选的 JSON 配置，不用于此次发布。

本人及朋友使用的扩展通过 `pnpm production:store:build` 构建并检查，`pnpm production:store:status`
只检查已有包。它是独立的手动加载包，不表示已经发布 Chrome Web Store 或已安装到浏览器。
固定公钥用于保持手动加载 ID；不保存对应私钥，不与 Hosted 条目共用 ID、浏览器存储或配对会话。
普通 `pnpm build` 继续生成不连接云端的 `dist-release`，不会覆盖两套云端包。

## 正式发布工具与公开说明

`scripts/production-release-vercel.mjs` 固定两个独立正式项目 ID、团队、域名、框架和源码目录；每次
操作重新回读身份和生产变量，不复用验收适配器。初始化只允许空配置或完整一致的已配置状态，变量
使用 encrypted 且仅作用于 Production；不覆盖部分配置、Preview 变量或身份漂移。
密钥由 `production-runtime-inputs.mjs` 从正式 Keychain 和精确 Supabase 项目读取，不落入回执或客户端。
Vercel 账户管理凭据仍由既有 Keychain 管理；运行时凭据和数据保持环境隔离。

发布驱动必须用 `production-release-evidence.mjs` 校验准确 SHA 的两个原生 CI job 和实际平台验证步骤，
持有同一个正式发布写锁，并在提交前写入排他、同步落盘的尝试记录。记录已存在或响应不确定时，只允许
按原候选和尝试 ID 对账；不能重新生成尝试 ID 绕过。API 就绪并通过 HTTPS 版本回读后才能发布 Web。
这些工具不安装维护任务、不发邮件、不调用模型，也不把部署创建成功当作业务验收完成。

正式站使用 [个人使用隐私说明](./privacy-policy-production.md) 和
[手动扩展包披露](./store-listing-production.md)。测试站及普通开发构建继续使用原来的预发布说明，
正式发布审计只读取正式材料，并拒绝混用 Web/Store 渠道。Free 套餐没有已验证的逐账号供应商备份
清除天数；公开说明如实披露这个限制，不把 Supabase 合同终止条款当成账号注销承诺。
