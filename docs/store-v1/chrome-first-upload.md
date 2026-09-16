# Chrome Web Store 首次上传与身份绑定

## 当前起点

截至本轮准备，语见尚无既有 Chrome Web Store 条目。此处采用首次创建条目的流程，不要求先提供
一个尚不存在的 item ID。当前 `production` 构建固定的个人 ID
`enlolhfodncfnleiihkjanhmnfbgeggh` 尚未获商店绑定核验，不能当作已存在的商店 ID。

本指南适用于未来商店使用的 production 候选：API 为 `https://api.seen-said.cn`，Web 为
`https://app.seen-said.cn/app`。`dist` 是 Hosted 验收日常目录，`dist-release` 是无云端的离线兼容
产物，均不能冒充该候选。详见[本地与商店流程](./local-and-store-workflow.md)。

**顺序：本地候选检查 → 首传草稿 → 获取真实 item ID/公钥 → 绑定并重建 → 正式 API/迁移与验收
就绪 → 更新同一草稿 → 送审 → 单独公开。** 首传草稿用于取得身份，不代表最终候选就绪。
本文没有执行上传、部署、迁移或 Git 发布。

## 1. 准备首传 ZIP

本轮主任务将首传 ZIP 与回执生成在 `artifacts/store-release-20260916/`；以实际回执中的文件名
和哈希为准。使用标明“仅首次草稿上传”的 ZIP，核对其候选提交、版本、SHA-256、Manifest 和
产物审计结果。通常来源是 `pnpm store:package:build` 生成的 `dist-production`；
`pnpm store:package:status` 只证明本地产物审计，不证明商店、账号或服务器状态。

ZIP 根目录必须直接包含 `manifest.json`，只包含审定的扩展文件、图标及必要许可证；不包含
源码、`.env`、凭据、私钥、浏览器存储、验收记录或整个仓库目录。公钥可用于身份核验，但旧个人
Manifest key 不是商店身份凭证；是否为首传移除该 key，应由可复现的打包步骤记录，保留原产物。
不能靠在 ZIP 里临时改 key 后声称源码和审计仍完全一致。

本轮候选已加入沿用产品眼睛标识的 16/48/128 像素图标，仍须核对实际 ZIP 中的 Manifest 引用和
文件；商店截图另行核验。首传前核验版本、名称、图标、权限、CSP 和固定网络目标。上传后若修改 Manifest，需要重新打包；
后续上传版本应递增，避免占用版本后仍重复使用同一版本。参见
[Google 打包准备说明](https://developer.chrome.com/docs/webstore/prepare)。

## 2. 创建未送审草稿，获取身份

1. 使用预定发布者账号打开 [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)。
   若未注册，先按 Dashboard 完成开发者账号设置；费用或账号验证按当时页面处理，不代填身份信息。
2. 选择 **Add new item / 新增条目**，上传已核对的首传 ZIP。
3. 上传完成后保留草稿，记录 Dashboard item ID、版本、上传结果和警告截图。
4. 打开 **Package → View public key**，复制 `BEGIN PUBLIC KEY` 与 `END PUBLIC KEY` 之间的
   Base64 内容，去掉换行；记录其与 item ID 的对应关系。公钥不是私钥，无需提供账号密码、会话
   Cookie、API Key 或任何 `.pem` 私钥。
5. 把 **item ID、公钥、实际上传版本、草稿状态及警告** 返回当前任务，继续绑定和验证。
   此时不要点击 **Submit for Review** 或 **Publish**，也不重复创建第二个条目。

Google 官方明确支持先上传而不发布，从 Package 取得公钥，并比较本地 ID 与 Dashboard item ID：
[Manifest key 指南](https://developer.chrome.com/docs/extensions/reference/manifest/key)。
如果上传结果不确定，先回看 Dashboard 对账，不盲目再次上传或新建。

## 3. 绑定真实商店 ID，再生成送审候选

取得真实值后，在同一开发任务内协调修改和验证下列身份边界：

- `apps/store-extension/manifest.production.json` 的公钥；
- `scripts/production-store-build.mjs` 的预期 ID 与相关测试；
- `apps/api/src/environment.ts` 的 production 身份约束及相关测试；
- `scripts/production-release-environment.mjs` 的正式环境身份声明；
- 正式 API 的 `HUAYI_STORE_EXTENSION_ID`、能力开关、Extension origin 许可和账号配对行为。

不能只改环境变量：当前 API 源码也校验旧个人 ID。公钥导出的 ID、构建审计预期 ID、Dashboard
item ID 与 API 接受的 origin 必须一致。不要修改 Hosted 验收 ID 或通过放宽 origin 白名单绕过校验。

按新身份重建并记录新候选提交、版本、产物哈希；必要时递增所有受约束的组件版本，检查 API
版本兼容。获得真实 Chrome 验收范围授权后，用独立测试 Profile 核对加载后的 ID 与 Dashboard
相同。旧 ID 下的本机生词、凭据和会话不会因新 ID 自动迁移；保留旧 Profile，不以卸载、清空
存储或覆盖日常验收目录解决身份问题。

## 4. 正式后端、公开披露及验收完成后才送审

创建草稿可先解决身份依赖；提交审核前，审核员能使用的正式服务必须支持最终候选：

- 在对应范围授权内完成正式 API 部署、真实商店 origin/配对许可及数据库核对；不能把 Hosted
  验收环境已通过或构建成功当作正式环境完成。
- 回填功能需要 `apps/api/migrations/0039-shanbay-backfill.sql`、
  `0040-backfill-account-exports.sql` 及对应 Supabase 迁移；确认正式库实际迁移状态、API 路由
  与导出 worker 兼容，而不是只确认 SQL 文件存在。迁移前保留专项备份/恢复与数据安全门禁。
- 记录生产部署身份、候选 SHA、迁移状态和只读回读。账号配对、真实模型、欧路/扇贝及邮件等
  业务写入/费用验证需已有相应明确授权；只读健康检查不能冒充功能验收。
- 完成最终候选的[发布门槛](./release.md)与[逐项发布清单](./release-checklist.md)，包括准确候选
  的双平台自动检查及所需真实 Chrome/服务验收。首传不自动豁免正式发布门禁；缺失项明确待补。
- 将[商店文案](./store-listing.md)、公开隐私页面、首次联网披露和实际代码对齐。当前历史政策稿
  对账号、自动回填、诊断的覆盖不完全相同，须完成公开版本统一，不能只填写一个 URL。
- 填写单一用途、权限理由、数据类别、无远程扩展代码声明、支持信息、原创图标与真实截图；
  逐项留存问卷证据。当前账号为邀请制，须准备审核员可执行的测试说明与专用测试访问方式，
  不提供个人凭据，也不在普通文档或截图中保存测试秘密。

若 API、迁移、身份、隐私或验收仍未完成，状态保持“首次草稿已上传；送审候选未就绪”。
部署、迁移、送审和公开均按各自已有授权范围执行；编写本指南不构成这些动作已获授权或已完成。

## 5. 更新同一条目、送审与公开

将绑定真实身份并通过门禁的递增版本 ZIP 上传到**已有的同一 item**，处理所有影响提交的警告。
在明确送审授权后点击 **Submit for Review**；若尚未批准自动公开，在确认对话框取消“审核通过后
自动发布”，选择延后公开。审核通过、等待发布和已经公开是不同状态，分别记录回执。
参见 [Google 发布流程](https://developer.chrome.com/docs/webstore/publish)。

最终公开仍须独立核对授权及全部剩余门禁。商店安装和升级验证需记录实际 ID、版本、平台及
账号行为；不要把草稿上传成功或审核通过描述为用户已经可以正常使用。

## 回执最小字段

| 阶段       | 必须记录                                                            |
| ---------- | ------------------------------------------------------------------- |
| 首传准备   | 候选提交、ZIP 路径/哈希、版本、实际检查、已知未完成项               |
| 草稿上传   | 发布者身份、item ID、版本、公钥/ID 对应、草稿状态、警告             |
| 绑定后候选 | 新候选提交/版本/哈希、Manifest ID 与 API origin 许可一致性          |
| 送审前     | 正式 API 部署、迁移与兼容证据、公开政策、问卷、双平台验收和测试说明 |
| 送审/公开  | 各自授权范围、Dashboard 状态与时间、审核反馈、实际商店安装验收      |

回执留在忽略的本地 artifacts 中，不写入秘密。当前任务应清楚指出下一步是用户上传草稿并返回
item ID/公钥，还是候选仍有本地阻塞；仅交付 ZIP 时不要声称商店已就绪。
