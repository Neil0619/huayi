# v0.13.0 标准设置与站点策略设计

## 目标

把划译中适合用户调整的本地行为收敛到标准 Chrome 设置页与工具栏面板，消除默认动作、
每日同步时间和 YouTube 展示偏好等散落常量，并新增可解释、可测试的站点允许/阻止策略。
本版统一升级为 `0.13.0` 和 Native Messaging wire v7，Extension 与 Host 必须同步升级。

本版设置只保存在当前设备，不做账号、云同步、历史、导入导出、多语言或视觉主题。网页内容、
URL、凭据和 Provider 私有配置不得进入 Chrome storage。

## 设置所有权

Extension 在 `chrome.storage.local` 中拥有一份严格的 `settingsVersion: 1` 配置：

- `enabled`：划译总开关，默认开启；
- `defaultAction`：`ask | explain | translate`，默认 `ask`；
- `sitePolicy`：默认策略 `allow | block` 与站点规则数组；
- `wordbook`：生词本开关、自动同步开关、每日同步小时，默认开启、开启、08:00；
- `youtube`：增强字幕开关、默认英文/双语、临时翻译快捷键，默认开启、英文、Shift+Z；快捷键
  可改为至少含一个修饰键的字母、数字或 F1–F24，也可关闭。

缺失整份配置或缺失字段使用上述默认值；类型错误、未知字段、重复站点规则、越界时间或超量规则
都视为非法设置并 fail closed：普通页面不初始化划译或 YouTube 功能，设置页显示修复提示并允许
恢复默认值。设置整体原子写入，内容脚本和后台收到 storage change 后立即应用。

Native Host 继续拥有 Provider 选择、Compatible HTTP 配置和所有凭据。Extension 只能经 wire v7
读取有界的非敏感状态、选择一个已经配置且受当前平台支持的 Provider；不得读取、写入或显示
Key、URL、模型输入、环境变量或原始错误。macOS 支持 Codex、OpenAI、OpenAI-compatible HTTP
和 DeepSeek；Windows 固定 DeepSeek，拒绝切换请求。

## 设置页与工具栏

Manifest 注册 `options_page` 和 `action.default_popup`，新增最小权限 `storage` 与 `activeTab`。
设置页使用左侧导航，依次为通用、网站、模型服务、生词本、YouTube；窄屏退化为顶部横向导航。
页面使用原生 DOM、CSS 和 TypeScript，不增加 UI 框架，不使用远程资源。

工具栏面板只承载高频动作：总开关、当前站点精确规则、当前 Provider 摘要、生词同步摘要、手动
同步和打开完整设置。点击图标不再直接开始生词同步。设置保存后立即反馈，不提供独立“保存”按钮。

Provider 页面展示平台、当前 Provider、四个固定 Provider 的 `ready | not-configured |
unsupported` 状态。只有 `ready` 且当前平台支持的 Provider 可选。状态检查只验证本地二进制、
受保护凭据或严格配置是否存在且有效，不发网络请求、不消费 API 额度。

## 运行时行为

总开关或站点策略阻止当前页面时，不显示选区工具栏、不发送 warmup/分析/生词请求，也不启用
YouTube 增强字幕。扇贝收藏页的同步控制器独立于该判断，确保同步工作流始终可恢复。

`defaultAction: ask` 保持先显示解释/翻译操作条；`explain` 或 `translate` 在当前 selection kind
支持该动作时立即进入原有 loading/streaming/result 状态并发送请求。段落遇到 `explain` 时回退
到操作条，不隐式改成翻译。

生词本关闭时不查询词状态、不显示添加生词操作，也不运行自动同步；手动同步同样不可用。开启后
恢复状态查询。自动同步按本地时区在配置小时的整点运行；关闭时删除每日 alarm，修改时间时重建。
手动同步不依赖自动同步开关，但依赖生词本开关。

YouTube 增强字幕关闭时不创建字幕控制器。默认双语在每个新视频 generation 的翻译轨就绪后固定
显示中文；默认英文保持当前行为。关闭 Shift+Z 时页面不截获该组合键，播放器上的“按住显示中文”
按钮仍可使用。

## 站点规则

站点规则只保存规范化 hostname 与布尔值 `includeSubdomains`、`action: allow | block`。输入可为
URL 或 hostname；只接受可解析的 HTTP(S) hostname，统一小写、移除尾随点并通过 URL 解析完成
IDNA 规范化。URL 中的端口、路径、查询和 fragment 不参与匹配且不持久化；拒绝凭据、通配符、
单标签域名和空 hostname。最多 200 条，
同一 hostname 不得重复。

匹配时先找所有命中规则：精确 hostname 始终命中；父规则仅在 `includeSubdomains` 为 true 时命中
子域。按 hostname 标签数最多者优先，因而 `docs.example.com` 可覆盖 `example.com`；无匹配规则
使用默认策略。规则不修改 Chrome host permissions，只决定内容脚本在已经获准注入的页面上是否
启用产品功能。

## Wire v7

新增控制请求与结果：

- `settings-status` -> `settings-status-result`；
- `settings-select-provider` -> `settings-provider-selected`。

状态结果只包含平台、当前 Provider、Provider 有界状态和 `wordbookConfigured`。控制请求进入独立
控制路径，不占用分析并发队列；活动分析在开始时已经固定 Provider，不因随后切换而迁移或回退。
未知、越权、未配置、Windows 切换或无效配置统一返回现有安全错误事件，不将本地路径或原始错误
暴露给 Extension。

## 安全与隐私

- `storage.local` 不保存访问过的站点、当前 URL、选区、模型输出、凭据或诊断；站点规则是用户主动
  输入的配置，最多 200 条；
- `activeTab` 只在用户打开工具栏面板时用于读取当前 HTTP(S) hostname；不新增后台浏览历史能力；
- 设置页和工具栏所有动态文本使用 `textContent`，禁止 `innerHTML`；
- Host 状态探测不得联网，stderr 仍只允许固定安全消息与既有 allowlist 诊断；
- 版本、协议、安装和安全边界文档在同一变更中同步更新。

## 验证

默认质量门保持离线、无 Secret：设置解析、站点优先级、存储更新、默认动作、总开关、生词依赖、
定时 alarm、YouTube 偏好、Popup/Options DOM、v7 wire、Host 状态和切换都使用本地 fake 覆盖。
macOS 实机验证包括构建、同步安装 Host、加载 `apps/extension/dist`、设置页保存、工具栏当前站点、
允许/阻止规则、Provider 状态/切换以及普通网页划词。不得运行真实 Provider smoke。

Windows 本轮只运行共享和 `verify:windows` 离线门；Node SEA、DPAPI、注册表和 Chrome 实机验证由
用户在 Windows 上按交接命令完成，未验证前状态必须报告为 `implemented; target-platform
validation pending`。
