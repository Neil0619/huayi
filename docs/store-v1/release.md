# Huayi Store 1.0 商店披露与发布门槛

本地开发和候选构建统一按[本地开发与商店交付流程](./local-and-store-workflow.md)：日常只加载
`apps/store-extension/dist`，`dist-production` 是临时候选产物，`release` / `dist-release` 保留为
离线兼容与测试输出。production 1.0.2 候选已绑定商店 ID
`kehpghgppccjlmahanlmeagnpnfbcnea`，用于替换已上传的 1.0.1 包并修复拒审；本地绑定与构建成功不等于
正式服务验收或商店就绪，未来正式日常使用通过 Chrome Web Store 安装和更新。

## 权限说明

| 权限                             | 用途                                                                | 发布条件                                                                |
| -------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 所有 HTTP(S) 页面 Content Script | 在阅读和观看页面提供一致划词体验                                    | 安装页与首次运行显著说明；提供全局和站点关闭                            |
| `storage`                        | 保存设置、同意版本、DeviceVault key 与加密数据                      | storage area 限制为可信上下文                                           |
| `unlimitedStorage`               | 防止权威本地加密生词本被容量驱逐                                    | 说明数据规模来源，提供导出和清理入口                                    |
| `alarms`                         | 恢复耐久任务；主动开启回填后本地 08:00 检查欧路、每 15 分钟刷新云端 | 先披露并主动开启；保存分页进度且可停用                                  |
| 三个固定第三方 API 主机          | 直连 OpenAI、DeepSeek、欧路                                         | 精确 HTTPS host_permissions；消息不能指定 URL                           |
| 构建目标固定的语见 API           | 已配对账号功能和用户主动共享的扇贝回填进度                          | `release` 兼容包不含云端 API；验收/production 分别限定自己的固定 origin |

Manifest 不申请 `nativeMessaging`、`tabs`、`activeTab`、`scripting`、隐身模式或任意其他网络主机。
Popup 的站点操作只使用基础 active tab ID 和已注入 Content Script relay，不读取 tab URL。回填打开流程
也只枚举 tab ID，通过既有顶层 Content Script 的空数据 probe 确认固定收藏页并登记 tab；不新增
tabs/host 权限，不调用扇贝 HTTP API，消息不能传入任意 URL。增加权限、主机、
数据用途或远程执行能力都需要重新安全评审、更新披露并评估是否重新征得同意。

## 商店与产品披露

商店清单、隐私政策和首次联网界面必须一致说明：

- 基础 BYOK 与本机词库独立可用；支持云端的构建可连接语见账号，默认不收集遥测；
- 用户选择的文本和必要上下文会直接发送到用户选择的模型 Provider；
- 用户明确操作时，词头和允许的语境数据会发送到欧路；扇贝回填每批只发送最多 100 个不同目标词头，
  每批最终添加都由用户亲自点击；
- 主动开启回填会检查欧路、本机收藏与云端生词，首次包含已有词；默认本地 08:00 欧路检查与每
  15 分钟云端刷新均以有界分页推进。达到欧路分页上限必须显示检查不完整；
- 账号共享只上传欧路/本机词头、来源类别与回填进度，不自动创建学习项、云端生词或语境；各设备
  须使用同一扇贝账号，语见不能验证该账号身份或读取扇贝完整词表；
- 欧路和扇贝分别要求当前版本同意并显式启用；披露必须逐一列出接收方、字段、潜在费用和第三方
  远端保留，本地删除不会删除第三方副本；
- API 使用由用户自己的账户计费，Huayi 不承诺第三方可用性或数据保留策略；
- 凭据和本地词典在设备上加密，但同一 Chrome Profile 同时持有设备密钥，不防护 Profile 整体泄露；
- 本地词表导出是用户主动下载的一词一行 UTF-8 明文文件；它不含语境等完整记录，不能用于恢复。

完整账号导出使用 format 5 的专用回填记录，保留旧 format 1–4 的 allowlist；批次不导出租约 token
或 holder。删除本机词条、停用或卸载不删除云端回填账本和第三方副本；账号删除清除该账号的回填
数据。共享后的本机须重连原账号继续；换账号主动开启时保留现有本机词 baseline，以后新词仍发现。

不得使用“数据从不离开设备”“零数据共享”或“无需权限”等与行为不符的表述。隐私政策链接、
支持联系方式、数据删除说明、单一用途说明和权限理由在提交前必须可公开访问。

发布用文本分别维护在[隐私政策](./privacy-policy.md)、[商店清单与数据披露](./store-listing.md)和
[逐项发布清单](./release-checklist.md)。仓库文件不等于公开 URL；提交前必须完成清单中的托管、
素材和双平台证据。

## 自动质量门槛

默认 CI 离线且无秘密，macOS 与 Windows 都必须通过：

- 指令检查、Prettier、ESLint、严格 TypeScript；
- Store domain、Store Extension、Classic 的单元测试；
- Store 与 Classic 构建、架构依赖和循环检查；
- Overlay/设置/YouTube E2E；
- DeviceVault 遗留数据失败关闭、设置 v1→v2→v3→v4→v5→v6、Provider parser、Outbox、
  接收方 manual/alarm 前置策略、扇贝
  sender/租约/真实手势和 UI 保存路径的关键覆盖；
- YouTube MAIN/isolated 严格关联、JSON3 上限、录播/英文轨/真实手势和来源推导覆盖；
- ShanbayBackfill 三来源分页、100 个不同目标去重、逐批真实手势、一次纯词元、unknown 人工核对、
  租约续期/过期、页面消息与陈旧 alias 拒绝、scope/session 切换及本机迁移/baseline 覆盖；
- 回填 API 的版本/origin/账号/holder/CSRF/幂等/revision、强制 RLS、新旧手动任务共享锁和仅成功证据
  迁移；format 5 专用记录、无 token/holder/owner 泄露及旧 worker 不认领新格式覆盖；
- 生产依赖审计和 all-sites content、YouTube isolated、MAIN bridge、Popup 四个独立 bundle 基线预算。
- 随包 `shanbay-lemma-licenses.txt` 包含 wink-lemmatizer MIT、wink-lexicon MIT/WordNet 3.0 完整声明，
  三种构建产物均保留该声明。

两个平台 CI 都应是受保护分支的必需检查，GitHub Actions 固定到完整提交 SHA。不得以 fake OS
primitive 或单平台构建代替目标平台验证。

自动门已经接入 `pnpm check:architecture`、`pnpm test:store:coverage`、
`pnpm check:store-release` 与 `pnpm audit:prod`。双平台 `verify` 都运行浏览器 E2E；E2E 的 Store
旅程在真实构建出的 `dist/content-script.js` 上注入浏览器内 fake Chrome/Provider，不访问第三方，
覆盖分析、保存、无自动重试和站点关闭。生产依赖审计只访问包管理器安全公告，不执行产品网络代码。

## 手工发布门槛

以下检查会接触真实 Chrome、凭据、配额、第三方数据或费用，必须逐项取得单独知情批准后执行：

- macOS 与 Windows 的干净安装、旧 Vault 失败关闭、禁用/重启直接可用和卸载；
- OpenAI、DeepSeek 的固定模型、流式、取消、鉴权、限流和计费失败；
- 欧路导入、查重导出、分页边界和凭据撤销；
- 扇贝逐批人工确认、部分成功、一次词元、用户编辑保留、unknown 核对后重试及不自动提交；
- 三来源首次/日常分页、断线恢复、同账号多设备去重、迁移后重连原账号、换账号 baseline 与以后新词；
- YouTube 当前播放器、切轨、导航、双语和字幕选择；
- Chrome Web Store 草稿上传、自动审查警告、隐私问卷和最终公开操作。

实现完成但缺少目标平台或真实服务证据时，状态必须写为
`implemented; target-platform validation pending`，并列出准确命令、用户步骤和期望结果。全部
自动门槛、双平台手工门槛、隐私材料和商店审查问题都清零后，才能把新 Store ID 的版本标记为
1.0 正式发布。

回填变更涉及 API 迁移 `0039-shanbay-backfill.sql`、`0040-backfill-account-exports.sql` 及对应 Supabase
迁移；部署/迁移执行仍需对应范围授权，代码和文档不构成执行证据。`release`、Hosted 验收及
production 三种产物仍须分别记录准确 SHA、Manifest origin、构建产物与验收状态；其中
`release` 包保留为离线兼容与测试产物，不要求三包日常安装或持续同步。实际安装验收另行记录
目标、路径与版本，不能用一个目标的通过结果替代其他目标。当前行为与剩余验证边界见
[扇贝回填](./shanbay-backfill.md)。

参考：Chrome [跨域请求](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)、
[Service Worker 生命周期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)、
[用户数据政策](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)、
[披露要求](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements)和
[MV3 要求](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)。
