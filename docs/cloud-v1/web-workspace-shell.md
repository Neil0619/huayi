# Phase 43：Web 工作台外壳与主导航

## 1. 状态与范围

影响平台为 `shared + macOS`。本阶段统一 Cloud Web 登录后工作台的品牌顶栏、跳转主内容、一级导航、
当前区段和窄屏折叠菜单，不修改 API、数据库、认证、业务状态机、Classic 0.13 或 Store runtime。

当前页面同时存在一个 `PracticeShell`、四份完整外壳复制和一份删减导航。结果已经产生真实错误：部分
页面的“今日练习”指向不存在的 `#今日练习` 或错误的 `/`，练习历史把“今日练习”标成当前页，外部词典
只在部分外壳中成为一级入口，窄屏则仍是横向滚动链接而不是产品要求的顶部选择或抽屉。

状态：`implemented and verified on macOS; Windows batch validation pending`。

## 2. 页面与导航契约

### 2.1 登录后工作台

以下页面必须使用同一个 WorkspaceShell：

- `/app` 的待分析与待收藏两个 tab；
- `/analysis`、`/library`、`/practice`、`/practice/history`；
- `/words`、`/words/wordbooks`、`/history`；
- 完整账号会话的 `/settings/account`、`/settings/devices`、`/settings/data`。

公共 `/privacy`，邀请/登录/密码恢复，Extension 配对审批，以及尚未确认 session 的 loading、signed-out、
approved/error 状态和独立 `/admin` 运营面不使用完整 WorkspaceShell。它们没有可证明的完整学习工作台
访问权，或属于另一权限面，不能提前显示账号导航。data-rights-only session 可以使用 WorkspaceShell 的
受限形态承载 `/settings/data` 内容，但不得渲染完整一级或账号设置导航。

### 2.2 一级导航

普通账号一级导航的标签、顺序与目标固定为：

1. 今日练习 → `/practice`；
2. 待整理 → `/app`；
3. 分析 → `/analysis`；
4. 学习库 → `/library`；
5. 生词 → `/words`；
6. 分析历史 → `/history`；
7. 设置 → `/settings/account`。

当前区段的链接使用 `aria-current="page"` 并指向 `#main-content`；其他链接必须使用上面的绝对路径。
Operator 入口不是一级导航第八项。只有 `/settings/account` 已经通过服务器 authority 验证后，才在
账号设置二级导航显示“运营控制台”→`/admin`；独立运营面提供返回工作台的明确链接。

子页面归入已有一级区段：练习历史属于“今日练习”，外部词典任务属于“生词”，三个账号子页面属于
“设置”。练习页继续以页内链接进入练习历史；生词和外部词典页面增加同一组二级文字导航；设置页面
继续使用现有账号设置二级导航。二级页面不扩张普通账号一级导航。

### 2.3 响应式与无障碍

- 桌面保持“顶栏 + 左侧导航 + 主内容”；
- 同一个一级导航使用原生 `details/summary`；WorkspaceShell 监听 48rem media query，桌面保持 open 并
  隐藏 summary，48rem 及以下默认 closed 并显示 summary。展开后按固定顺序显示完整链接，不使用横向
  滚动作为唯一导航方式，也不复制第二份桌面/移动 DOM；
- summary 必须显示当前区段，支持键盘 Enter/Space，链接触控高度至少 44px；
- 每页恰好一个“主导航”、一个 `#main-content` 和一个跳到主要内容链接；当前项恰好一个；
- 保留现有语义 token、可见焦点、AA 对比度与 reduced-motion，不引入新 UI 依赖或远程资源。

## 3. 技术方案

### 3.1 深 module 与 seam

新增 `WorkspaceShell` module，interface 只有：

```ts
type WorkspaceSection =
  "practice" | "inbox" | "analysis" | "library" | "words" | "history" | "settings";

type WorkspaceShellProps =
  | { access: "full"; activeSection: WorkspaceSection; children: ReactNode }
  | { access: "data-rights"; children: ReactNode };
```

module implementation 独占品牌顶栏、skip link、一级条目/路径/顺序、active 语义、受限访问形态和响应式
details。seam 位于 `CloudApp` 已完成 identity bootstrap、即将组合业务页的位置；组合根把
`practice-history → practice`、`wordbooks → words`、三个 settings route → `settings`，并只包一次外壳。
页面不能再复制导航数组、href 条件链或外壳 DOM。删除 `PracticeShell`，不保留只转发 props 的兼容
wrapper；测试通过 WorkspaceShell interface 验证行为。

这是一条纯 in-process seam，不需要 adapter 或外部 port。生词二级导航目前只有两个调用方，保留在各页
的显式语义 HTML；在出现第三个调用方或独立行为前不创建浅层通用导航 module。

### 3.2 数据与路由

无新请求、状态、数据结构或 route parser。所有 href 都使用现有 production route；页面切换仍是普通
同源顶层导航，不在本阶段引入客户端 router。Operator 可见性继续使用既有服务器 access 结果。

## 4. TDD 与验收

### 4.1 Fresh RED

先扩展页面测试和新增 shell contract，证明：

- 当前普通外壳并非固定七项，且“今日练习”目标错误；
- StudyCapture、ReviewInbox、分析、学习库和设备页使用不同外壳；
- 外部词典当前项扩张一级导航，独立运营面也被追加为第八项；
- data-rights-only session 暴露完整学习/账号导航；
- 窄屏没有可折叠 summary。

Focused 命令：

```bash
pnpm exec vitest run --config vitest.config.ts --project web \
  apps/web/src/workspace-shell.test.tsx \
  apps/web/src/cloud-app.test.tsx \
  apps/web/src/study-inbox.test.tsx \
  apps/web/src/inbox-app.test.tsx
```

### 4.2 GREEN 与实际页面

```bash
pnpm --filter @huayi/web test
pnpm --filter @huayi/web typecheck
pnpm --filter @huayi/web build
pnpm exec playwright test apps/web/e2e/cloud-web-journeys.spec.ts \
  --grep "workspace navigation"
pnpm check:instructions
pnpm check:architecture
```

实际页面至少检查 390px 和桌面宽度：窄屏默认只显示 summary，键盘可展开并到达七项，点击“今日练习”
进入 `/practice`；桌面左侧七项顺序不变且无水平溢出。收口执行目标 ESLint/Prettier 和完整
`pnpm verify:macos`。Windows 进入下一次冻结候选批次。

## 5. 验收标准

- 所有已登录工作台页面只通过 WorkspaceShell 渲染一级导航；源码只剩一份一级条目与路径定义；
- 普通账号恰好七项且顺序、href、active 归组全部符合 2.2；运营不进入一级导航；
- 练习历史、外部词典和设置子页面仍可双向到达，不被误做独立一级区段；
- 公共、认证、恢复、配对、独立运营和 data-rights-only 页面不泄露完整工作台导航；
- 桌面、390px 窄屏、键盘、skip link、焦点、AA token 与 reduced-motion 验收通过；
- 不改变任何业务请求、业务状态或公开数据契约；
- Mac 全门通过后状态为
  `implemented and verified on macOS; Windows batch validation pending`。

## 6. 明确不混入

本阶段不重新设计视觉品牌、不加入图标或客户端 router，不改变页面命名、信息架构、练习/词典/设置
业务，不处理邮件、域名、DNS、Resend、真实部署、Provider、安装或 Chrome。

> 2026-08-24 补充：本节是 Phase 43 的历史边界。当前视觉契约已由
> `cloud-web-ui-redesign.md` 取代；一级标签、路径、权限与单一 WorkspaceShell 契约继续有效。

## 7. 实现与验证证据

- Fresh RED 为 4 个 focused Web 文件：缺少 WorkspaceShell module，另有 5 个预期行为失败和 12 个
  基线通过，分别证明今日练习错误目标、页面切 tab 丢失外壳、设备/词典 active 漂移与 data-rights-only
  导航泄露；
- 最小实现由 `CloudApp` 在 identity bootstrap 后统一组合 WorkspaceShell，各业务页只返回内容；删除
  `PracticeShell`，普通一级导航只剩一份七项定义，运营面和 data-rights-only 均保持独立权限边界；
- 首轮 actual-bundle 复核暴露原生 closed details 即使 CSS 子项为 flex 仍会从渲染/无障碍树隐藏。最终
  只保留一份导航 DOM，由 48rem media query 控制 desktop open/mobile closed；390px 键盘、指针展开、
  七项顺序与跳转，以及桌面重排均由浏览器回归固定；
- GREEN 为 focused 4 files / 20 tests、Web full 43 files / 196 tests、Workspace actual bundle 1/1；完整
  Playwright 首轮又以 2 个预期失败证明两条旧移动 journey 未先展开导航，修正为真实用户展开后 focused
  2/2，最终完整 Mac 聚合门覆盖 110/110 Playwright；
- Web strict typecheck/build、目标 ESLint/Prettier、instructions、architecture、diff check 和最终
  `pnpm verify:macos` 均通过。本证据不包含 Windows、真实 Provider/词典、安装、Chrome、邮件、域名、
  DNS、Resend 或部署。
