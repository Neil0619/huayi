# Phase 44：Web 语义设计 Token 契约

## 1. 目标与范围

Phase 44 关闭 `product.md` 已经规定、但源码尚未完整执行的单一皮肤约束：Web 生产入口使用的颜色、
间距、圆角和阴影都必须由集中 Token registry 提供。当前账号数据权利页引用未定义的
`--red-600`，浏览器会丢弃危险区边框色声明；数据权利、待整理和隐私页还保留多处原始主题值，现有
测试也没有读取全部生产 CSS。

影响平台为 `shared + macOS`，只涉及 Web CSS、静态契约、离线 actual bundle 验收和对应文档。不得
改变 DOM、路由、请求、账号权限、数据模型或现有视觉尺寸；不得新增依赖、皮肤切换或运行时主题
系统。Windows 支持保留，本阶段状态只能是
`implemented and verified on macOS; Windows batch validation pending`。

邮件、域名、DNS、Resend、真实部署、Provider、词典、安装和 Chrome Extension 均不在本阶段。

## 2. Token 架构

`apps/web/src/styles.css` 的 `:root` 是唯一 registry，依赖方向固定为：

1. **Primitive Token**：稳定的原始颜色、间距阶梯、圆角阶梯、阴影素材和动效时长；只有这一层可以
   直接保存 hex、rgb、rem、px 或复合 shadow 数值。
2. **Semantic Token**：把 primitive 映射为 `surface`、`text`、`border`、`action`、`focus` 等产品语义；
   页面不能直接把 primitive 当作颜色契约。
3. **Component Token**：只在一个组件需要组合值或独立语义时使用，例如隐私页光晕、危险区边框、
   卡片阴影和待整理浮动标签；component 必须继续引用 semantic 或 primitive，不复制原始主题值。

所有 `var(--*)` 引用必须闭合：名称必须由 registry 定义，且 fallback 不能掩盖未知 Token。页面 CSS
可以直接复用通用 `--space-*`、`--radius-*` 等 primitive 尺度；颜色必须使用 semantic/component
别名。V1 仍只有一套皮肤，不新增 dark mode 或用户可配置主题。

## 3. 可执行属性边界

下列生产声明必须至少包含一个 Token 引用，不能直接写非零主题值：

- `color`、`background`、`background-color`、`border-color`、`outline-color`；
- `margin` 及其长属性、`padding` 及其长属性、`gap`、`row-gap`、`column-gap`；
- `top`、`right`、`bottom`、`left`、`inset` 及其逻辑长属性；
- `border-radius` 及其长属性、`box-shadow`。

以下是明确的结构性例外，不代表主题值：

- reset 或布局语义的 `0`、`auto`、`none`、`normal`、`transparent`、`currentColor` 与 CSS 全局关键字；
- 由 Token 参与的组合表达式，例如 `calc(-1 * var(--space-2))`、`0 auto var(--space-4)`；
- media/container query 的 breakpoint，以及 `width`、`height`、`min/max-*`、grid/flex、transform、
  typography、line-height、letter-spacing、text-decoration 和百分比/fr/ch/vh/vw 等结构或排版值。

边框宽度和样式可以保留字面量，但边框颜色必须来自 Token；渐变的全部颜色 stop 必须来自 Token。
本阶段不改变既有 breakpoint、控件尺寸、字体或视觉数值，只把同一数值归入 registry。

## 4. 实现方案

1. 由 `main.tsx` 的生产 CSS import 清单驱动静态测试，避免维护第二份不完整文件列表；
2. 测试解析每个规则块的声明，建立 `:root` 定义集、引用集和受控属性检查，不用单个跨文件正则推断
   CSS 语义；错误必须返回相对文件、属性和原值；
3. Fresh RED 必须同时证明未定义 `--red-600` 和生产页原始颜色/间距/圆角值能被发现；
4. 最小 GREEN 扩充 primitive/semantic/component registry，并等值替换全部生产 CSS 入口中的违规声明；
5. actual production bundle 在桌面与 390px 下检查 `/app`、`/settings/data` 和 `/privacy`：无横向溢出，
   待整理 tabs、危险区和隐私 notice 可见，危险区 computed border color 不回退，公共隐私页仍为零 API。

不新增 CSS-in-JS、Tailwind、运行时 resolver 或生产 parser。静态解析器只存在于测试。

## 5. TDD 与验收

### Fresh RED

- Token 引用闭合测试报告 `account-data-rights-page.css` 的 `--red-600` 未定义；
- 受控属性测试报告 data-rights、privacy、StudyInbox 以及其他生产入口中仍存在的原始主题值；
- 原有 responsive、reduced-motion 和页面行为测试保持基线通过。

### GREEN

- 所有由 `main.tsx` 引入的 CSS 都通过引用闭合和受控属性契约；
- 账号数据权利、待整理和隐私页的现有组件测试通过，DOM/请求事实不变；
- actual bundle 覆盖桌面和 390px，键盘焦点可见、危险边框/隐私背景 computed style 有效、无横向
  溢出；
- Web full tests、strict typecheck/build、目标 ESLint/Prettier、`check:instructions`、
  `check:architecture` 与 `git diff --check` 通过；
- `pnpm verify:macos` 退出 0。Windows、真实服务、安装和 Chrome 继续明确 pending。

## 6. 文档与数据审查

本阶段落实现有产品视觉约束，没有新增产品需求，也不改变架构模块、HTTP/SSE、数据库、RLS、日志、
隐私或安全边界，因此不修改 `architecture.md`、`data-model.md`、`api.md` 或 `security.md`。若实现必须
改变颜色、尺寸、焦点语义或页面结构，应先停止并重新审阅产品方案，不能把视觉变化伪装成 Token
迁移。
