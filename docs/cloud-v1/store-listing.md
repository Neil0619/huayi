# 语见 · Seen & Said Cloud V1 Chrome Web Store 清单与数据披露草案

> 本文件只用于未发布 Cloud V1 候选。它 supersede `docs/store-v1/store-listing.md` 的产品口径，但在
> Phase 33 已完成当前源码的权限必要性审阅；生产 Extension ID、Web/API origin、正式候选包权限一致性
> 复核、公开隐私 URL 和 Dashboard 问卷完成前，本文件仍不是可提交材料。

## 清单文案

**名称**：语见 · Seen & Said

**Slogan**：Turn what you see into what you can say.

**简短说明**：在网页与 YouTube 中理解主动选择的英文，并把有价值的单词、短语和句型整理到语见
学习工作台中练习。

**单一用途**：帮助中文英语学习者理解当前阅读或观看语境中主动选择的英文，并把用户主动提交的
学习意图连接到同一语见账号下的分析、整理、学习与练习闭环。

**主要功能**：

- 对用户主动选择的单词、短语、句子和段落做翻译或语境解释；
- 在 YouTube 中显示可选择的英文字幕并保留播放器恢复边界；
- 用户登录并同意后，可手动或按账号设置把原始短语、句子、段落加入 Web 待分析区，再由用户在
  Web 显式发起深度教学分析；插件精简查询结果不上传为 Web 分析历史；
- 在 Web 管理生词、短语、句型、历史、练习、设备、额度和账号数据权利；
- 普通用户可在 Web 选择使用账号平台额度完成插件查询，也可切换为每台设备自行配置的
  OpenAI/DeepSeek Key；两种模式不自动互相回退，BYOK Key 只保存在本机 DeviceVault；
- 插件生词先保存在本机；用户可选择仅把以后收藏的生词复制到 Web，或显式确认批量导入；
- 用户显式创建任务时，支持欧路词典导入/导出和扇贝人工最终提交。

不得宣称：零数据外发、Cloud 内容端到端加密、官方第三方合作、自动读取完整页面、自动同步浏览历史、
无限免费平台模型或已获得 Chrome Web Store 审核。

## Manifest 能力与候选理由

| Manifest 能力                                       | 用户可见功能与最小理由                                                                                 | 候选状态           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------ |
| `http://*/*`、`https://*/*` Content Script          | 用户在任意阅读页面主动选择英文后显示工具栏；不采集浏览历史、URL、标题或完整页面，并提供全局/站点停用。 | 源码必要；候选实测 |
| YouTube 三个固定 matches                            | 提供可选择的英文字幕、双语显示和播放器状态恢复；仅顶层 frame。                                         | 已有离线 E2E       |
| `storage`                                           | 保存非敏感设置、联网同意、DeviceVault envelope、加密本地记录和耐久任务状态。                           | Phase 33 保留      |
| `unlimitedStorage`                                  | 解除 `storage.local` 10 MiB 配额，并保护正式本机词库/词典任务 IndexedDB 免受常规配额与驱逐。           | Phase 33 保留      |
| `alarms`                                            | 恢复用户已经启动的 outbox、配对轮询和外部词典耐久任务；无任务时不遥测。                                | Phase 33 保留      |
| `api.openai.com`/`api.deepseek.com`/`api.frdic.com` | Service Worker 直连用户选择的 BYOK Provider 或欧路；网页消息不能指定 URL/Header/请求体。               | Phase 33 保留      |
| 语见 API 固定 HTTPS host                            | 登录且同意后执行平台查询、提交 StudyCapture/CloudWordCopy、配对和外部词典任务。                        | 生产 origin 未固定 |
| 语见 Web 固定 HTTPS URL                             | 从 Popup/Overlay 打开同一学习工作台；不下载或执行远程扩展代码。                                        | 生产 URL 未固定    |

### Phase 33 权限必要性证据

- Chrome 官方说明：`storage` 是调用 `chrome.storage` 的必需权限；`storage.local` 无
  `unlimitedStorage` 时总量为 10 MiB，越界写入会失败；`unlimitedStorage` 同时为
  `chrome.storage.local`、IndexedDB、Cache Storage 和 OPFS 提供无限配额。扩展存储概念文档进一步说明，
  该权限使扩展免于通常的配额限制和驱逐。这里的“无限”是 Chrome 配额语义，不是无限物理磁盘、备份或
  数据永不丢失承诺。见 [Permissions](https://developer.chrome.com/docs/extensions/reference/permissions-list)、
  [chrome.storage](https://developer.chrome.com/docs/extensions/reference/api/storage) 和
  [Storage and cookies](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies)。
- 本机正式词库使用 `huayi-store-lexicon` IndexedDB
  （`apps/store-extension/src/lexicon/browser-lexicon-repository.ts:19,236-246`）。每个词条最多 1,000 条
  语境，但 schema 没有词条总数或数据库总字节上限
  （`packages/store-domain/src/lexicon.ts:35-42`）；这表示产品允许词库随用户积累增长，并不表示磁盘
  真正无上限。外部词典耐久状态另存于 `huayi-store-wordbook` IndexedDB，最多保留 20,000 个 outbox
  item 和 10,000 个 import seen ID
  （`apps/store-extension/src/wordbook/production-wordbook-export-engine.ts:8-28`、
  `apps/store-extension/src/wordbook/wordbook-state.ts:22-28`）。当前代码不使用 Cache Storage 或 OPFS，
  因而不把这两项未使用能力作为申请理由。
- `chrome.storage.local` 由受信上下文适配器保存设置、DeviceVault/三类加密凭据、Cloud install/pairing/
  session、SubmissionOutbox、本机批量导入任务和外部词典 lease
  （`apps/store-extension/src/vault/chrome-vault-storage.ts:15-50`、
  `apps/store-extension/src/service-worker/service-worker.ts:64-117,193-203`）。SubmissionOutbox 最多 20 项、
  5 MiB 明文 JSON，密文 envelope 上限 8,000,000 字符；本机批量导入快照另有 5,000,000 bytes 明文和
  8,000,000 字符密文 envelope 上限
  （`apps/store-extension/src/service-worker/submission-outbox.ts:20-22,122-126`、
  `apps/store-extension/src/service-worker/submission-outbox-vault.ts:25-53`、
  `apps/store-extension/src/service-worker/local-word-import-vault.ts:8-18,57-63,113-135`）。两类任务可以
  同时存在，连同 session/凭据/设置会越过无该权限时的 10 MiB 总配额；删除权限会让已承诺的离线恢复
  因 quota rejection 失败。
- `alarms` 是 `chrome.alarms` 的明确前置权限；当前 Service Worker 用它恢复配对轮询、StudyCapture/
  CloudWordCopy、本机批量导入和外部词典任务
  （`apps/store-extension/src/service-worker/service-worker.ts:180-203,355-383`）。见
  [chrome.alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms)。
- 三个 host 均有固定 HTTPS 调用：OpenAI Responses 与 DeepSeek Chat endpoint 固定在
  `apps/store-extension/src/analysis/provider-requests.ts:10-13`，欧路两个 endpoint 固定在
  `apps/store-extension/src/wordbook/eudic-client.ts:8-9`；Extension Service Worker 的跨源 `fetch` 需要
  host permission，见
  [Cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)。
  语见 API 当前仍为 `null`，正式候选只能在生产 origin 固定后加入精确 HTTPS host，并由候选审计复核。

不申请 `tabs`、`activeTab`、`scripting`、`nativeMessaging`、隐身模式、任意 endpoint 或远程代码。Popup
只读取 active tab ID、向已注入 Content Script 发送无 URL 的固定命令，Service Worker 只创建固定 URL
标签页和广播刷新；Chrome 官方说明这些 `tabs` 操作不要求 `tabs` 权限，只有读取 URL/title 等敏感字段
才需要。见 [chrome.tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs)。

## Chrome Web Store 数据披露矩阵

提交时按 Dashboard 当时字段人工映射；以下事实是保守下界，不以字段名称变化缩小披露。

| 数据                              | 触发                                                | 接收方                                     | 用途                           | 保留与用户控制                                        |
| --------------------------------- | --------------------------------------------------- | ------------------------------------------ | ------------------------------ | ----------------------------------------------------- |
| 主动选择的英文与必要句子上下文    | 用户点击插件查询                                    | 账号选择的平台模型路径或本机 BYOK Provider | 当前卡片翻译或解释             | BYOK 结果不上传；平台请求正文/精简结果最多保留 1 小时 |
| StudyCapture 原文与可选用户上下文 | 用户手动加入；或账号开启自动加入后显式查询句子/段落 | 语见                                       | Web 待分析与精确去重           | 保留至用户删除；插件精简结果、URL/标题/视频 ID 不上传 |
| 用户填写的来源标题                | 用户在 Web 手动填写                                 | 语见                                       | 解释来源和整理                 | 随采集/分析/学习项规则保留，可删除                    |
| 邮箱、Google 基础身份和会话元数据 | 用户选择注册/登录/配对                              | Supabase、Google、语见                     | 身份、会话与设备安全           | 可撤销设备、导出或删除账号                            |
| 分析、候选、单词、表达、句型      | 用户提交、确认、手工录入或外部导入                  | 语见/Supabase；平台模型时 DeepSeek         | 整理、跨设备学习、查重         | 保留至用户删除；归档不是删除                          |
| 练习题、回答、对话、反馈、自评    | 用户主动开始/继续练习                               | 语见/Supabase；生成时 DeepSeek             | 练习与排期                     | 历史可查看；满足安全子集时可删除                      |
| token、费用、时延、稳定错误码     | 平台模型或受控运营                                  | 语见/Supabase/Vercel                       | 额度、结算、可靠性与无正文运营 | 按运营策略；不把用户正文放入日志/管理概览             |
| 插件查询/采集/生词复制偏好        | 用户在 Web 保存或批准插件配对                       | 语见；插件仅缓存脱敏值                     | 全账号插件执行一致选择         | Web 可修改；安全断开/换号清除插件账号缓存             |
| 本机词库及可选 CloudWordCopy      | 用户在插件收藏单词；开启以后复制或显式批量导入      | 本机；选择复制时语见                       | 本机生词与独立 Web 副本        | 登录/换号不清本机；云端副本可独立删除                 |
| BYOK 与欧路凭据                   | 用户在 Extension 设置中输入                         | 本机 DeviceVault；请求时对应服务           | 用户选择的第三方功能           | 语见服务端不接收；用户可在本机清除                    |
| 欧路词头/可选原句                 | 用户显式创建导出任务                                | Eudic                                      | 外部词典导出                   | 由用户与 Eudic 控制；notes/标题/来源不发送            |
| 扇贝词头                          | 用户显式领取任务并最终点击提交                      | Shanbay 页面                               | 人工确认后的外部词表提交       | 语见不替用户执行最终提交；notes/语境/标题不发送       |
| 完整账号导出私有对象              | 用户显式请求账号导出                                | 语见/Supabase Storage                      | 数据权利                       | ready 后 24 小时过期；签名 URL 最长 15 分钟           |

完整账号导出可包含生成 snapshot 时尚未超过一小时的平台查询内容。该导出是用户主动创建的独立私有
副本，ready 后最多保留 24 小时；它不延长原查询的保留期，也不把插件查询变成可浏览历史。

语见不把数据用于广告、画像、信用判断或出售，不读取 Google Drive、Gmail、联系人、支付信息、健康信息、
精确位置或完整浏览历史。运行时第三方和本机路径以[隐私说明](./privacy-policy.md)为准。

## 首次披露与一致性

- BYOK 同意必须写明本机所选 Provider、发送字段、用途和由用户承担的费用，并明确精简结果不会上传
  为 Web 分析记录；
- 登录配对必须分别展示平台/BYOK 查询、手动/自动 StudyCapture 和 CloudWordCopy 三项账号选择，说明
  StudyCapture 只提交原始学习意图，不提交插件精简结果、Key、URL、页面标题、视频 ID 或完整页面；
- 平台模型必须说明语见 API 与平台 Provider 两级接收方、共享月度额度和最多一小时的插件查询正文/
  结果保留；Web 深度分析与练习按账号内容规则保留；
- 撤回语见数据联网同意后，平台请求、StudyCapture、CloudWordCopy 与云端词典任务停止，账号绑定
  SubmissionOutbox 清除；本机 BYOK 与本机词库按各自同意继续工作；
- Developer Dashboard、公开 `/privacy`、本清单和实际候选包任何一处变化，都必须重新做四方核对。

## 品牌、截图和人工证据

OpenAI、DeepSeek、Eudic、Shanbay、Google、Chrome、YouTube、Supabase 和 Vercel 名称只用于说明兼容
或数据接收方；语见与这些实体无隶属、认可、赞助或官方合作。截图不使用易造成官方归属误解的 Logo。

候选截图至少覆盖：主动划词与接收方披露、YouTube 可选字幕、Web 待整理、学习库、练习、设备/额度和
公开隐私页。每张截图使用 fake 数据，不显示真实邮箱、正文、token、API key、URL、视频 ID 或账单。
