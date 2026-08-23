# Cloud Web 内容优先 UI 重构

## 1. 目标与范围

影响平台为 `shared / Cloud Web`。本次重构解决工作台“管理后台化”的结构问题：固定工具栏、同质卡片、
外露维护表单、过粗字重和缺少主视觉层级。方向为“纸上语言馆”：安静、克制、内容优先，服务阅读、
表达与练习，而不是展示系统模块。

不修改 API 数据结构、请求顺序、权限、业务状态机、Classic 0.13、Native Host 或 Store runtime。唯一
跨边界行为变化是完整认证默认落点改为 `/practice`；服务器 callback、Web 登录、authority 与浏览器
验收必须同步。`/app` 仍是“待整理”页面。

## 2. 设计契约

- 画布使用温暖 chalk surface、graphite text 与单一 mineral-blue action；危险和焦点语义保持独立；
- 视觉值遵守 primitive→semantic→component 三层 token，页面 CSS 不直接使用原始色值；
- 桌面使用 13.75rem 的安静章节索引，主内容占据连续画布；移动端复用同一原生
  `details/summary` 导航 DOM，48rem 以下默认关闭；
- 一级导航仍恰好七项并保持原顺序和路径，按“开始／积累／回看／账户”分组只改变呈现，不改变
  accessible link name 或权限；
- 页面标题采用编辑式非对称网格和更强字级，正文仍用系统无衬线；不加载远程字体；
- 普通列表主要依靠留白、索引和细分隔线，不为每个区块添加悬浮卡片；只有当前任务、选中详情和确认
  操作使用有限 elevation；
- 学习库、生词和分析历史的筛选／手动收录进入原生渐进披露；默认关闭时主阅读内容仍完整可见；
- 动效仅用于 160–240ms 状态反馈，`prefers-reduced-motion` 必须关闭非必要过渡。

## 3. 页面优先级

1. `/practice` 是完整账号默认入口，聚焦今日队列与当前练习；
2. `/app`、`/library`、`/words` 与 `/history` 使用索引／详情阅读结构，维护工具后置；
3. `/analysis` 使用编辑台与阅读流，不把输入、状态和结果堆成同权卡片；
4. 设置、数据权利和运营页只统一 token、排版和控件，不弱化权限、危险操作或确认语义。

## 4. 无障碍与响应式

- 每页保持一个 `#main-content`、一个主导航、一个 `aria-current` 和 skip link；
- 原生 summary 支持 Enter/Space；折叠内容打开后表单可见、可聚焦、提交后状态通过 live region 宣告；
- 触控控件至少 44px，焦点轮廓可见，正文和控件达到 WCAG AA；
- 390px、769px、1024px、1280px 与 1440px 不得产生横向溢出或 fixed overlay；
- data-rights、认证、恢复、配对、公共页和 `/admin` 不得泄露完整学习导航。

## 5. 验收

- 单元测试锁定 token、对比度、导航分组、默认 `/practice`、折叠工具和 StrictMode 异步表单生命周期；
- API 测试锁定 Google 与密码确认 full session 的 `Location: /practice`，data-rights 保持
  `/settings/data`；
- production-bundle Playwright 覆盖桌面 tabs 不重叠、390px 导航、键盘展开／手动收录／焦点恢复、
  Google、密码、恢复和邀请后的默认入口；
- 默认门禁保持离线、无 secret、无 hosted 写入；真实部署、Google、Supabase、邮件和双平台 Chrome
  仍需各自批准后验收。
