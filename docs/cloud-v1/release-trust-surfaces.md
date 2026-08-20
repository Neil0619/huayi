# Phase 20 公开信任页与商店披露方案

## 1. 目标与边界

Phase 20 把已经实现的 Cloud V1 数据边界变成用户在登录前即可核验的公开事实，并建立与 Chrome Web
Store 草稿逐项对照的专用材料。它不提交商店、不部署站点、不替运营主体作法律判断，也不填写尚未由
生产环境验证的区域、备份残留或联系信息。

本阶段交付：

- Web 固定公开路由 `/privacy`，不依赖 API Origin、Cookie、CSRF 或登录；
- Cloud V1 专用 Store listing、权限理由和数据披露矩阵；
- 隐私正文与当前 Manifest、联网同意、账号导出/删除和第三方接收方保持同一事实；
- 自动回归锁定公开路由优先级、无网络加载、结构化文本、安全链接、窄屏和 reduced-motion。

本阶段不交付：服务条款、Cookie banner、商店上传、生产 URL、法务意见、运营主体/联系地址、真实
Supabase/Vercel 区域或备份期限。上述外部事实仍是发布阻塞项。

## 2. 政策依据与产品裁决

Chrome Web Store 要求处理用户数据的产品提供准确、最新且可从 Developer Dashboard 访问的隐私政策，
并要求 Dashboard 披露、政策和实际行为一致；网页浏览活动只能为醒目说明的用户功能所必需。官方还要求
扩展所属网站对 Google API 数据的 Limited Use 作肯定声明：

> The use of information received from Google APIs will adhere to the Chrome Web Store User Data
> Policy, including the Limited Use requirements.

权威参考：

- [Privacy Policies](https://developer.chrome.com/docs/webstore/program-policies/privacy)
- [User Data Policy](https://developer.chrome.com/docs/webstore/user_data)
- [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use/)

因此固定以下产品事实：

- Cloud listing 取代 `docs/store-v1/store-listing.md` 的纯本地产品口径；旧文件只描述未发布 Store 1.0
  基线，不能复制到 Cloud V1 提交；
- 单一用途是“理解用户主动选择的英文，并把用户主动提交的学习意图送入同一华译学习闭环”；
- 不宣称零数据外发或端到端加密。DeviceVault 中的 BYOK/欧路凭据仍只在本机，但 CloudAuthority
  中的学习内容对华译服务端可读；
- Content Script 的全站匹配只用于用户主动选择，不能变成后台浏览历史、URL、页面标题或完整页面采集；
- 插件查询可按账号选择走 Huayi 平台额度或每台设备本机 BYOK，两种路径都只产生当前卡片的精简
  ExtensionQueryResult，不写入分析历史，也不自动互相回退；
- BYOK 直达用户选择的 Provider，Huayi 不接收 Key 或该次精简结果；平台查询由 Huayi API 转发平台
  Provider，正文与精简结果最多保留一小时。独立的 StudyCapture 只提交用户学习的原始短语、句子或
  段落，不能与查询结果上传混为一项同意；
- 本机词库是每个插件安装的独立正式数据；只有用户开启以后新词复制或显式确认批量导入时，才向
  Huayi 创建独立 CloudWordCopy/WordEntry；
- Google 只用于用户主动选择的登录，不读取 Drive、Gmail、联系人或其他 Google 产品资料。

## 3. 公开页面技术路线

### 3.1 路由与依赖

`main.tsx` 必须先识别精确 `/privacy`，再解析 `VITE_API_ORIGIN`。公开页直接渲染 `PrivacyPage`，不得
构造 identity/API adapter、发 fetch、读取 storage、尝试 Cookie bootstrap 或落入 SPA 的登录失败页。
未知路径仍按现有 authenticated app 规则处理。

`App` 增加窄 public-page seam，使组件测试能证明配置缺失时仍可渲染；不把公开页塞进 `CloudApp`，避免
无意继承登录状态机。正文使用 React 文本节点和静态安全链接，不使用 `dangerouslySetInnerHTML`、远程
内容、第三方字体、分析 SDK 或动态脚本。

### 3.2 页面投影

页面是静态、版本控制的 `PrivacyNotice` 投影，不是数据库资源：

```ts
interface PrivacyNotice {
  effectiveDate: string;
  releaseStatus: "pre-release";
}
```

V1 公开前，`releaseStatus` 保持 `pre-release`，页面醒目标明“预发布隐私说明”，并如实列出仍待补齐的
运营主体、联系邮箱、实际区域和备份残留。不得用占位值伪装正式政策。真正发布时必须先把这些事实写入
版本化正文并通过发布审阅，再移除预发布状态。

不同章节包含列表、政策链接和状态提示，不强行压成可以从远端替换的通用 CMS schema；它们作为
`PrivacyPage` 中显式语义 JSX 随同版本审阅。`PrivacyNotice` 只保存必须跨章节一致的发布时间与状态。

正文至少包含：数据种类、主动触发条件、用途、每个接收方、本机秘密、服务器可读边界、保留与删除、
账号导出/删除、未成年人/适用法律待法务确认、安全与费用、Limited Use 声明和政策变更方式。

### 3.3 样式与可访问性

- 唯一 `h1`，章节使用顺序标题；提供跳到正文链接和返回产品入口；
- 外部政策链接明确标识并使用安全 `rel`；不自动打开新窗口；
- 正文最大阅读宽度、可重排数据表、20rem 窄屏无横向溢出；
- 键盘焦点可见，文本对比沿用现有 token；reduced-motion 禁用非必要过渡；
- 不用 consent checkbox 冒充法律同意，隐私页只解释事实。

## 4. Cloud Store listing 与披露矩阵

新建 `docs/cloud-v1/store-listing.md`，与旧 Store 1.0 文件并存但明确 supersede 范围。至少包含：名称、
简短说明、单一用途、功能列表、权限/host 逐项理由、数据种类×触发×接收方×用途×保留×控制矩阵、
第三方非隶属声明和截图清单。

当前 Cloud release Manifest 尚未固定生产 Web/API origin，`unlimitedStorage` 是否仍有必要也未完成候选包
审计，因此文档只能是提交草稿；不得把待定 host 或权限写成已批准事实。

## 5. TDD 与验收

### 5.1 RED

1. `App`：无 API/identity 时请求 privacy public seam，应显示政策而非配置错误；
2. `PrivacyPage`：要求全部数据/接收方/控制边界、预发布缺口、Limited Use 和安全链接；
3. `main` 路由：精确 `/privacy` 在环境解析与 adapter 构造前分流；
4. CSS contract：阅读宽度、20rem 窄屏、焦点和 reduced-motion；
5. release material test：Cloud listing 不得出现“无账户/自有后端不存在/端到端加密 Cloud/登录后上传
   BYOK 完整结果”旧断言，并必须覆盖 Manifest 当前权限、host、三项账号偏好、StudyCapture 和本机
   词库边界。

### 5.2 GREEN 与门禁

- 最小实现公开页、路由、样式和 Cloud listing；
- Web full test/typecheck/build；Store Manifest focused test；release material test；
- instructions/architecture、受影响 ESLint/Prettier、`git diff --check`；
- 根 full test/build/E2E 只在代码稳定后执行，真实网络/商店上传仍需独立批准。

### 5.3 退出标准

- `/privacy` 在 API Origin 缺失、未登录和浏览器禁用 Cookie 时仍能离线渲染；
- 页面与 Cloud listing 对数据种类、触发、接收方、用途、保留和控制无矛盾；
- 页面不发请求、不读取账号状态、不加载远程资产；
- 预发布缺口醒目且进入 release checklist；
- 不能据此宣称 Chrome Web Store 就绪，直到真实 URL、外部事实、Dashboard 问卷和人工预审全部完成。

## 6. 2026-08-13 实现记录

> 本节记录 Phase 20 当时通过的实现证据；Phase 27 改变了插件查询、StudyCapture 和本机词库边界。
> 公共页面与自动化断言必须在 Phase 27 重新基线后才能作为候选发布证据，不能沿用下述旧正文通过记录。

- Web 精确 `/privacy` 在 API Origin 解析与登录 bootstrap 前分流；缺配置、无 Cookie 和未登录状态都
  直接渲染静态版本正文，不构造 API/identity adapter。登录页提供同源隐私入口。
- 页面覆盖数据种类、触发、Huayi/DeepSeek/Supabase/Vercel/Google/Eudic/Shanbay 接收方、本机秘密、
  服务器可读边界、保留/导出/删除、Limited Use 与全部预发布缺口；不加载远程资产或政策正文。
- `store-listing.md` 建立 Cloud 专用单一用途、权限/host 理由、数据披露矩阵和截图证据清单；自动测试
  读取当前 Manifest，防止重新使用“无账号/无后端/Cloud 端到端加密”的旧产品口径。
- 组件/CSS 回归覆盖一个 `h1`、安全同页政策链接、20rem 窄屏、焦点与 reduced-motion。本机 Chrome
  实际渲染在 320px 下 `scrollWidth === innerWidth`，且没有非本地请求。
- 根离线复验通过 101 个脚本测试、362 个 Vitest 文件（2,424 passed/12 skipped）、全 workspace
  typecheck/build 与 66/66 既有扩展 E2E。真实部署、正式政策 URL、商店 Dashboard 和人工预审未运行。
