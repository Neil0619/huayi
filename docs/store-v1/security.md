# Huayi Store 1.0 安全与数据流

## 数据分类

- **秘密**：OpenAI API Key、DeepSeek API Key、欧路 Authorization、DeviceVault DEK。
- **加密个人数据**：WordEntry、ContextObservation、导入任务、导出箱和回执。
- **非敏感设置**：功能开关、站点规则、YouTube 偏好、已同意的披露版本。
- **临时页面数据**：用户当前选择和最多 2,000 字符的必要上下文，只存在于一次分析生命周期。

Huayi 开发者收集零遥测，但这不表示数据永不离开设备：用户同意后，选择和上下文会直接发给
所选模型 Provider；词条和语境会在用户导出时发给欧路或呈现在扇贝操作流程中。

## DeviceVault 格式与遗留数据边界

1. 干净安装自动生成随机 256 位设备 DEK，并以严格版本化 envelope 保存到
   `chrome.storage.local`；local/session 都通过 `setAccessLevel` 限制为 `TRUSTED_CONTEXTS`。
2. 每条持久秘密或个人记录使用 DEK 或由它按用途分离出的密钥、独立 12 字节随机 IV 和
   AES-256-GCM 加密；AAD 绑定产品身份、记录类型、记录 ID 和 Schema 版本。
3. DeviceVault 通过同源 Web Locks 串行化 Options 与 Service Worker 的首次创建；实例内操作也
   串行化，避免并发初始化提交不同 DEK。
4. 早期候选的旧密码 wrapper 只保留严格解析与失败关闭兼容代码，防止把现有密文当作空数据；
   当前 Options 不暴露密码、恢复码或迁移入口。检测到遗留 wrapper 时提示清除扩展数据后重新配置。
5. 畸形 metadata、孤立旧 session、或缺少 metadata 但已有凭据都返回稳定损坏错误，不生成新 DEK，
   不把现有生词或凭据当作空数据。

设备 DEK 与密文同处一个 Chrome Profile，因此本设计不抵御整个本地 Profile 被读取或可信扩展
上下文被攻陷；攻击者在这种情况下可取得 DEK。它仍避免凭据和 IndexedDB 学习记录以明文保存。
Content Script 不得直接访问任何扩展存储。

## 加密生词与词表导出

生词仓储不会把规范词头直接作为 IndexedDB key。它从当前 session DEK 通过 HKDF-SHA-256 派生
独立的索引 HMAC 密钥和记录加密密钥；规范词头的 HMAC 摘要是唯一持久索引。每次新建或修改
记录都生成独立 12 字节 IV。AES-GCM AAD 同时绑定产品 `huayi-store`、记录类型、不透明 ID、
记录 Schema 版本和 revision，所以篡改 revision、交换两个记录的密文或移动记录都会认证失败。
解密后还必须通过严格 WordEntry Schema，并重新计算不透明 ID 与 envelope 比对。

IndexedDB 只保存不透明 ID、非敏感 revision/generation、算法标识、版本、IV 与密文；不得保存
词头、原句、语境释义、URL、标题或完整模型结果。任何写操作前都会解密并校验现有记录；损坏、
未知或更新 Schema 使写入失败关闭，不以空库或部分结果覆盖。WebCrypto 在事务开始前完成；事务
内只有读取、CAS、写入和 generation 更新，因此不会因异步密码学使事务失活。

用户可主动导出一词一行的 UTF-8 纯文本词表。Repository 只解密并读取规范词头，按词条身份排序、
去重并在末尾保留换行；导出不访问 DeviceVault 凭据，也不包含语境、释义、来源或时间。Store 1.0
不提供加密备份、恢复或明文 JSON，因此词表不能用于完整恢复本地生词本。

普通网页 Overlay 只在完整单词结果上显示本地保存动作，并以真实用户手势触发。Content Script
提交的消息不允许 URL、页面标题、完整模型结果或导出目标；Service Worker 严格拒绝未知字段，
消息也不能声明 `source`。Worker 从 sender URL 判定普通网页为 `web`，只把三个固定 HTTPS
YouTube 主机的精确 `/watch` 判为 `youtube`，再交给 Repository 生成时间和 ID。语境释义在消息层
最多 1,000 字符，原句最多 2,000 字符；同一来源的重复原句不会新增记录。

## 外部数据流与同意

| 接收方            | 发送数据                             | 不发送                      | 触发条件                                   |
| ----------------- | ------------------------------------ | --------------------------- | ------------------------------------------ |
| OpenAI / DeepSeek | 选择、必要上下文、动作、固定模型请求 | URL、标题、生词本、其他密钥 | Provider 已配置、当前披露已同意            |
| 欧路导入          | 欧路凭据与固定分页请求               | 页面选择、模型密钥          | 当前欧路同意、已启用且用户显式开始或恢复   |
| 欧路导出          | 规范词头及明确允许的语境字段         | URL、标题、完整模型结果     | 当前欧路同意、已启用且 Outbox 执行         |
| 扇贝              | 词头及用户可见的页面操作数据         | Provider/欧路密钥           | 当前扇贝同意、已启用且用户打开流程人工确认 |

每个接收方的披露文本都有版本。字段或目的扩大时必须增加版本并重新取得同意。拒绝、撤回或
撤回或停用后不得产生新的外发请求。

Store 设置 Schema v6 为欧路和扇贝分别保存 `{ consent, enabled }`，并严格保存词卡皮肤，以
`disabled | english | bilingual` 保存 YouTube 偏好，并保存可空的严格组合快捷键、默认
动作、全局开关及一个最多 256 条规则的 `sitePolicy`。站点策略保存 allow/block
默认值与排序、去重的精确/包含子域规则；最具体 hostname 优先，同一 hostname
的精确规则优先于包含子域规则。Consent 含接收方独立的披露
版本与授予时间；旧版本按未同意处理，不能因 `enabled: true` 放行。v1 设置首次读取时迁移为两个
接收方都未同意且停用，并必须成功落盘；落盘失败会使设置读取失败关闭，不能只在内存继续。授予
同意不会自动启用，撤回会在一次写入中清空同意并停用。v1 迁移补齐接收方，v2→v3 默认英文
YouTube 模式，v3→v4 默认全局启用且无停用 host，v4→v5 将 `disabledHosts`
一次性转为默认 allow 的精确 block 规则；每步迁移必须落盘成功，不能只在内存继续。

Store 不提供 Classic 设置包导入入口，也不读取 Classic storage、Native Host 或平台凭据。
生词历史只经用户显式发起的欧路导入进入 Store；站点、YouTube 与词卡皮肤偏好重新配置。

Content Script 的站点 query/toggle 请求不能携带 URL 或 hostname；Worker 只从 `sender.url` 推导
host，并在付费分析、本地保存、扇贝 claim/resolve 和 YouTube 设置读取前重新校验。站点关闭时，
isolated-world 生命周期注册表同步停止普通选择、扇贝和 YouTube controller；扇贝迟到 claim 与
YouTube 迟到 settings 响应都有 generation guard，不能重新写 DOM。Popup 不读取 tab URL，只把
当前 tab ID 用于 content relay；active tab ID 变化会显示错误并拒绝提交。Popup 契约不读取凭据或 DeviceVault，只返回运行状态、全局开关和词卡皮肤。Options 广播只含固定 refresh 类型，不含规则或
页面数据。

YouTube isolated controller 与静态 MAIN bridge 为支持从非播放页进入播放页的 SPA 导航，只随包注入
三个固定 HTTPS YouTube host 的 `/*` match。非精确 `/watch` 时只保留导航/消息监听器：不得读取
设置或播放器、不得创建字幕视图，也不得包装 fetch/XHR；进入 `/watch` 才激活，离开时立即销毁。
所有特权路径仍要求 pathname 精确为 `/watch`、非直播/广告、有限时长、CC 开启及英文活动轨。MAIN 只在一次有界 capture
期间包装 fetch/XHR，只接受 `https://{youtube hosts}/api/timedtext`、当前视频/轨、`fmt=json3` 和固定
`tlang=zh-Hans` 条件，正文、事件、轨和 segment 均有上限，并在 `finally` 恢复 wrapper 与播放器。
随机 channel/capability、pending requestId、origin/source、generation、fingerprint 和当前播放器状态
只用于关联、防陈旧/重放与缩小接受面；同页脚本可观察 postMessage，因此不构成对恶意同页脚本的
密码学认证。任何桥接字幕都继续按不可信网页输入解析，URL、标题和视频 ID 不进入 Provider 请求、
生词消息或持久记录。

首次模型联网前，Service Worker 必须从限制为 `TRUSTED_CONTEXTS` 的本地设置读取当前版本的
显式同意回执，并在同一次 session 中固定 Provider。Content Script 既不能授予同意或切换
Provider，也不能在分析消息中携带 endpoint、model、key、URL、Header 或请求体。无同意或缺少
Provider 凭据时，session 在付费请求前以固定错误码失败；不存在本地密码门。

欧路客户端只构造 `api.frdic.com` 下两个固定 OpenAPI 地址，不接受调用者 URL，也不尝试设置浏览器
禁止控制的 `User-Agent`。响应体有字节上限并经过严格 Schema；导出固定执行查询后再添加，远端已
存在即形成成功回执，绝不覆盖远端内容。导入的 `context_line` 可进入加密本地语境，但通用 `exp`
不会被保存为语境释义。

随包 Options 页是可信扩展页面，直接使用同一 DeviceVault 与设置适配器完成凭据写入/删除；仅当
检测到旧 wrapper 时失败关闭并提示清除扩展数据，不再渲染迁移表单。它只把凭据读取结果转换为“已配置/未配置”，立即丢弃返回
值，不写入 DOM、不记录日志且不回填输入框。页面、Content Script 和外部消息都不能指定凭据槽
之外的键或取得该适配器；真正的 Provider 请求仍只由 Service Worker 发起。

欧路 Authorization 沿用上述可信 Options/Vault 路径，不通过 runtime 消息。导入和导出箱消息只
接受当前扩展自身精确 `options.html` sender；未知字段和 URL 字段在调用引擎前拒绝。扇贝内容脚本
只在 `https://web.shanbay.com/wordsweb/#/collection` 激活，Worker 再独立验证 sender URL。页面
只能取得当前有界批次的词头、随机租约 token 和不透明 Outbox ID；不能取得欧路或 Provider 凭据。

Worker 从 `TRUSTED_CONTEXTS` 设置自行计算策略，不读取消息中的 enablement、consent、目标或 URL。
网页保存先提交本地 Repository，再只为当时允许的目标创建意图；无允许目标时仍成功，启用设置
本身不扫描或补发旧词。欧路手工 start/resume/step/process 与每次 import/export Alarm 都在任何
引擎调用前重新读取策略。扇贝 page-ready 同样在认领和预填前检查；被拒绝时分别返回
`consent-required` 或 `recipient-disabled`，Options 和扇贝页面显示稳定中文原因。
划译不会点击“批量添加”，也不会覆盖用户已有输入。只有真实用户点击后新增的严格成功/部分失败
结果可提交；结果必须精确分区当前未过期批次，旧 token、合成点击、残留成功提示和伪造 ID 均失败
关闭。本地删除可取消尚未发送或扇贝已认领但未确认的任务；已发出的欧路请求仍保留迟到审计回执，
但不会复活本地词条。

## 边界与失败策略

- 页面与模型输出都不可信；所有消息和最终结果使用严格 Schema，拒绝未知字段。
- Manifest 不申请 `nativeMessaging`、`activeTab` 或隐身模式，只允许固定 HTTPS API 主机。
- CSP 只允许随包脚本和固定 API 的 `connect-src`，禁止 eval、远程脚本和动态模块 URL。
  Store 生产包的运行时契约使用 `zod/v3` 兼容子路径，Provider JSON Schema 为随包静态
  Schema；严格发布审计仍直接拒绝 `eval`、`Function` 构造器与动态导入。
- Content Script 不能选择 endpoint；Service Worker 不转发页面提供的 URL、Header 或请求体。
- 日志和错误只包含有界阶段、字段名与固定错误码，不包含秘密、页面文本、原始 JSON 或环境。
- 流断开、Worker 终止、超时或结果校验失败都失败关闭，不自动重试可能计费的请求。
- 加密、迁移或索引损坏时停止写入并提示清除扩展数据，不以空库覆盖未知状态。

任何真实凭据、Provider、欧路、扇贝或 Chrome 安装验证都需要单独知情批准，不进入默认离线
测试。旧库 PBKDF2 兼容、DeviceVault 存储与记录加密实现发布前需按 OWASP Cryptographic Storage
指南复核，并在两种支持平台的真实 Chrome 中验证 WebCrypto 与 Web Locks 行为。
