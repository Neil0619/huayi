# 语见 · Seen & Said 正式站隐私说明

最后更新：2026-09-06。

本服务由 Neil 维护，供本人及受邀朋友进行非商业英语学习。隐私、账号删除与安全问题请联系
[niu0619@gmail.com](mailto:niu0619@gmail.com)。正式站为 https://app.seen-said.cn，公开隐私地址为
https://app.seen-said.cn/privacy。测试站使用独立账号、数据库和密钥；两站不会自动同步数据。
扩展以手动加载包提供，尚未发布到 Chrome Web Store。

数据库、身份服务和私有导出存储使用 Supabase 新加坡区域；API 使用 Vercel 新加坡区域，Web 静态
资源通过 Vercel 全球网络分发。Resend 发件域选择东京区域，邮件还会经过收件人的邮件服务。
平台模型由 DeepSeek 处理。第三方服务可能涉及跨境传输，选择本机 BYOK 时还适用该供应商的政策。

本服务不面向儿童；未成年人如需使用，请先由监护人联系维护者。隐私请求与争议可先通过上述邮箱联系；
本说明不限制适用法律赋予你的权利，也不限制向有权机构寻求处理。

## 我们处理的数据

- 错误诊断：语见服务自动记录错误码、阶段、状态码、耗时、版本、账号和请求关联编号；插件仅在
  用户独立开启“自动上传错误诊断”并连接账号后自动上报，不再逐次要求报告。接收方是当前构建的
  语见 API 与其 Supabase 数据库，仅管理员可查。诊断不含原文、URL、模型回答、密钥、请求体或原始
  异常文本。服务器日志保留 30 天，插件待上传记录最多 100 条、256 KiB、24 小时；关闭开关或退出账号
  清除待上传记录。已有服务器记录到期清理，删除账号时随账号删除。诊断开关独立于学习内容联网同意。

- 账号资料：邮箱、邀请状态、设备标签和安全会话元数据；
- 账号偏好：插件查询使用平台额度或本机 BYOK、是否自动加入待学习区、是否把以后收藏的本机生词
  复制到 Web；这些偏好对同一账号关联的全部插件生效；
- 学习采集：用户主动加入或按其账号设置自动加入的短语、句子或段落原文，以及用户后来在 Web 填写
  的可选标题和上下文；
- 学习内容：用户在 Web 显式发起的深度分析、候选、收藏的云端单词/表达/句型、标签、练习题、
  回答/对话、反馈和自评；
- 临时插件查询：使用平台额度时，语见 API 与平台模型接收完成当前翻译或解释所需的最小英文；请求
  与精简结果最多保留一小时用于恢复和幂等，此后只保留不含正文的用量账本；
- 使用资料：模型与 schema 版本、token、费用、请求时延、稳定错误码和额度状态；
- 本机数据与秘密：BYOK、欧路凭据及插件本机词库保存在 Store Extension。BYOK/欧路凭据不发送给
  语见服务器；本机词条只有在用户开启以后新词复制，或显式确认批量导入时，才向 Web 创建独立副本。

语见不会自动收集 URL、页面标题、完整网页、浏览历史、视频 ID 或 Google Drive 等额外账号资料。
用户可以自行填写来源标题。

## 用途与接收方

- 语见 API 接收登录用户主动提交的 StudyCapture、CloudWordCopy、Web 深度分析和练习数据，用于
  待分析、待收藏、历史、跨设备学习与练习；插件 BYOK 的精简查询结果不会上传为 Web 分析记录；
- 平台模型接收平台插件查询、Web 深度分析或练习所需的最小英文与固定指令；插件平台查询的正文与
  精简结果最多保留一小时，Web 学习内容则按账号数据规则保留；
- 用户选择 BYOK 时，插件直接把最小查询输入发送给该设备所选 OpenAI 或 DeepSeek；语见不接收
  API Key，也不接收该次精简结果，但用户独立开启的 StudyCapture/CloudWordCopy 仍可发送给语见；
- Supabase/Vercel 承载身份、数据库、API 与 Web；当前不启用 Google 登录；Resend 用于验证、
  密码恢复和安全通知；
- Eudic/Shanbay 只在用户显式创建任务时接收最小数据：欧路导出接收词头和可选原句，扇贝只接收
  词头；notes、语境释义、标题与来源不发送。欧路凭据由插件直达欧路，扇贝最终提交由用户点击。

Cloud V1 不是端到端加密产品，语见服务器在提供功能时能够读取学习内容。运行日志和管理页不提供
正文浏览；内容不会用于广告或出售。

当前不启用 Google 登录；语见不读取 Google Drive、Gmail、联系人或其他 Google 产品资料。
The use of information received from Google APIs will adhere to the Chrome Web Store User Data
Policy, including the Limited Use requirements.

## 保留与控制

- StudyCapture、正式分析、云端学习项、生词和练习保留至用户删除；归档不是删除；
- 平台插件查询的正文与精简结果最多保留一小时；随后只保留不含正文的用量账本；
- 用户主动请求完整账号导出时，snapshot 可包含当时尚未过期的平台查询；生成的私有导出文件是独立
  副本，ready 后最多保留 24 小时，因此可能晚于原查询删除，但不会建立查询历史或延长原查询期限；
- 用户可以删除单条分析、学习项、单词或练习，导出一词一行词表或完整账号数据；
- 删除账号会立即撤销会话，主数据库内容在 24 小时内删除；供应商备份边界见下文；
- 插件“断开此设备”只撤销当前服务器设备会话，并在服务器确认后清除账号绑定本机状态；不退出其他设备、
  Web，也不删除本机词库或本机第三方凭据；
- Extension 待提交箱最多 20 条/5 MiB，7 天过期，可由用户提前删除；
- 用户撤回语见数据联网同意后，插件不再调用平台模型，也不再提交 StudyCapture、CloudWordCopy 或
  云端外部词典任务，并清除尚未提交的账号绑定正文；已有云端数据仍可在 Web 导出或删除。本机 BYOK
  查询和本机词库/外部词典能力在用户另行接受对应第三方条款后仍可独立使用。

## 安全与费用

传输使用 TLS，数据库由托管平台加密并以账号/RLS 隔离。平台模型请求计入账号公开显示的月度额度；
BYOK 费用由用户与对应供应商结算，密钥不由语见托管。安全问题请联系 [niu0619@gmail.com](mailto:niu0619@gmail.com)。
影响账号的事故通过账号邮箱通知。

## 供应商备份与恢复边界

当前使用 Supabase Free，未启用时间点恢复，也未建立语见自行保存的离线备份。供应商的灾难恢复
副本按其数据处理协议管理；账号删除不等于终止托管合同。语见不承诺供应商全部备份副本的固定清除
天数，也不提供这些副本的逐账号恢复。如需进一步的删除协助，请联系维护者。请自行保存需要长期保留
的账号导出；供应商免费套餐并不构成本服务的数据恢复保证。

供应商协议中的合同终止后 30 天条款，不是单个语见账号删除后的备份清除期限。本服务不会将二者混同。

## 第三方说明与政策变化

- [Supabase 数据处理协议](https://supabase.com/legal/customer-resources/data-processing-addendum)
- [Supabase 备份规则](https://supabase.com/docs/guides/platform/backups)
- [Vercel 隐私说明](https://vercel.com/legal/privacy-notice)
- [Resend 隐私政策](https://resend.com/legal/privacy-policy)
- [DeepSeek 隐私政策](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html)
- [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/user_data)
- [Chrome Web Store Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use/)

改变数据种类、触发条件、接收方、用途或保留规则前，会更新本页与扩展披露并通知受影响用户；不会以
静默更新扩大用途。以上供应商链接不代表语见与它们有官方合作，也不表示扩展通过了商店审核。
