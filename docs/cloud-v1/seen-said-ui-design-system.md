# 语见 C/G/H/I 主 UI 设计规范

## 1. 状态与范围

本规范是 2026-09-02 经用户批准的 Cloud V1 UI 唯一生产视觉权威，覆盖 Cloud Web 与
Store Extension。批准依据是仓库外的全站可交互原型、四主题统一布局证据和 293/293 项原型验收。

Classic 0.13、Native Host、Cloud API、数据库、路由、权限、请求合同和业务状态机不因本规范改变。
生产实现必须重写为受测试保护的组件和样式，不得复制原型的查询参数、状态切换器、模拟数据或
throwaway JavaScript。

## 2. 外观与稳定值

| 设计代号 | 生产值      | 用户名称 | 核心气质               | 操作色与主要前景 |
| -------- | ----------- | -------- | ---------------------- | ---------------- |
| C        | `moon`      | 去青月白 | 月白、烟蓝灰、克制冷光 | 深墨蓝           |
| G        | `silver`    | 流银镜白 | 高亮银白、冷灰反射     | 黛黑石墨，默认   |
| H        | `champagne` | 香槟晨霜 | 微暖乳白、淡香槟光     | 深咖             |
| I        | `porcelain` | 霁蓝瓷光 | 微冷瓷白、低饱和霁蓝   | 靛蓝             |

四套均为明亮外观，不提供暗色、跟随系统或主题专属布局。Web 与 Store 分别保存于当前设备：

- Web：`huayi.web.appearance.v1`；
- Store：`huayi.store.appearance.v1`；
- 缺失、非法或不可读取时使用 `silver`；
- Web 不使用 URL、Cookie、账号 API 或服务器数据同步外观；
- Store 外观不进入 `StoreSettings` v6，也不迁移或改写其他设置。

## 3. Token 架构

Web 与 Store 各自维护 `primitive → semantic → component` 三层 registry，不建立跨包运行时 CSS
依赖。依赖方向固定为：

```text
primitive 原始值
  ↓
semantic 产品含义，仅此层由 data-appearance 覆盖
  ↓
component 组件组合，不含主题专属 DOM 或布局
```

页面和组件 CSS 不得直接引用主题颜色 primitive。间距、圆角和结构尺寸可以直接引用对应 primitive
尺度；所有颜色、渐变、阴影和玻璃填充必须经 semantic 或 component token。

### 3.1 共享 primitive

```css
--white: #ffffff;
--white-92: rgb(255 255 255 / 92%);
--white-72: rgb(255 255 255 / 72%);
--white-42: rgb(255 255 255 / 42%);
--white-20: rgb(255 255 255 / 20%);

--danger-surface: #fff4f3;
--danger-text: #9a3f43;
--danger-fill: rgb(154 63 67 / 10%);
--danger-border: rgb(154 63 67 / 31%);
--success-fill: rgb(66 104 82 / 11%);
--success-border: rgb(66 104 82 / 28%);
--success-text: #365e49;
--warning-fill: rgb(132 96 55 / 10%);
--warning-border: rgb(132 96 55 / 27%);
--warning-text: #755331;

--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-8: 32px;
--space-10: 40px;
--space-12: 48px;
--space-16: 64px;
--space-20: 80px;

--radius-sm: 12px;
--radius-control: 18px;
--radius-card: 28px;
--radius-stage: 42px;
--radius-pill: 999px;

--control-height: 48px;
--duration-fast: 160ms;
--duration-normal: 240ms;
--blur-clear: 34px;
--blur-deep: 30px;
--blur-soft: 22px;
--workspace-max: 1312px;
```

危险、成功、警告和焦点是稳定语义，不得随外观任意染色。危险操作必须同时使用文字、图标或确认
结构表达，不能只靠红色。

### 3.2 四套 semantic registry

#### C / `moon`

```css
--surface-canvas-solid: #f1f3f4;
--surface-canvas:
  radial-gradient(circle at 79% 8%, rgb(206 215 226 / 58%), transparent 25rem),
  radial-gradient(circle at 7% 75%, rgb(231 226 218 / 42%), transparent 31rem),
  linear-gradient(145deg, #f7f8f8 0%, #eef1f2 48%, #e5e9ec 100%);
--surface-glass: linear-gradient(138deg, rgb(255 255 255 / 71%), rgb(235 239 242 / 43%));
--surface-glass-strong: linear-gradient(142deg, rgb(255 255 255 / 84%), rgb(232 237 241 / 55%));
--surface-glass-soft: linear-gradient(145deg, rgb(255 255 255 / 62%), rgb(231 235 238 / 34%));
--surface-inner: rgb(255 255 255 / 44%);
--surface-input: rgb(255 255 255 / 61%);
--surface-hover: rgb(255 255 255 / 72%);
--text-primary: #1f2c3b;
--text-secondary: #445264;
--text-muted: #596676;
--text-on-action: #ffffff;
--accent: #5c6d83;
--accent-soft: rgb(92 109 131 / 16%);
--action: #29394b;
--action-hover: #192839;
--border-glass: rgb(255 255 255 / 82%);
--border-inner: rgb(56 72 91 / 16%);
--border-strong: rgb(45 61 81 / 34%);
--focus-ring: #536b88;
--shadow-glass:
  0 30px 80px rgb(44 57 73 / 13%), 0 8px 24px rgb(44 57 73 / 7%), inset 0 1px rgb(255 255 255 / 72%);
--shadow-control: 0 14px 30px rgb(31 44 59 / 19%), inset 0 1px rgb(255 255 255 / 42%);
```

#### G / `silver`

```css
--surface-canvas-solid: #f5f8fa;
--surface-canvas:
  radial-gradient(circle at 75% 2%, rgb(215 224 233 / 64%), transparent 27rem),
  radial-gradient(circle at 13% 84%, rgb(226 231 237 / 48%), transparent 32rem),
  linear-gradient(128deg, #fbfcfd 0%, #f3f6f8 30%, #e7edf2 52%, #f8fafb 76%, #edf2f5 100%);
--surface-glass: linear-gradient(136deg, rgb(255 255 255 / 75%), rgb(224 231 238 / 39%));
--surface-glass-strong: linear-gradient(140deg, rgb(255 255 255 / 88%), rgb(225 232 239 / 52%));
--surface-glass-soft: linear-gradient(145deg, rgb(255 255 255 / 66%), rgb(224 231 237 / 31%));
--surface-inner: rgb(255 255 255 / 48%);
--surface-input: rgb(255 255 255 / 66%);
--surface-hover: rgb(255 255 255 / 78%);
--text-primary: #25292e;
--text-secondary: #464d54;
--text-muted: #5d666e;
--text-on-action: #ffffff;
--accent: #707a84;
--accent-soft: rgb(70 77 84 / 15%);
--action: #24282d;
--action-hover: #15181b;
--border-glass: rgb(255 255 255 / 88%);
--border-inner: rgb(37 41 46 / 15%);
--border-strong: rgb(37 41 46 / 34%);
--focus-ring: #59636e;
--shadow-glass:
  0 32px 84px rgb(38 54 69 / 14%), 0 8px 26px rgb(38 54 69 / 7%), inset 0 1px rgb(255 255 255 / 72%);
--shadow-control: 0 14px 32px rgb(29 33 37 / 20%), inset 0 1px rgb(255 255 255 / 42%);
```

#### H / `champagne`

```css
--surface-canvas-solid: #fbf6ef;
--surface-canvas:
  radial-gradient(circle at 76% 4%, rgb(239 222 200 / 58%), transparent 27rem),
  radial-gradient(circle at 6% 82%, rgb(229 214 197 / 40%), transparent 32rem),
  linear-gradient(145deg, #fffdfa 0%, #f9f4ed 48%, #eee2d5 100%);
--surface-glass: linear-gradient(138deg, rgb(255 255 252 / 76%), rgb(239 226 210 / 40%));
--surface-glass-strong: linear-gradient(142deg, rgb(255 255 252 / 88%), rgb(239 226 210 / 53%));
--surface-glass-soft: linear-gradient(145deg, rgb(255 254 250 / 68%), rgb(236 222 204 / 32%));
--surface-inner: rgb(255 253 248 / 51%);
--surface-input: rgb(255 254 251 / 68%);
--surface-hover: rgb(255 254 250 / 80%);
--text-primary: #43362d;
--text-secondary: #5e4d42;
--text-muted: #6f5e52;
--text-on-action: #ffffff;
--accent: #897158;
--accent-soft: rgb(137 113 88 / 17%);
--action: #503c31;
--action-hover: #3d2c24;
--border-glass: rgb(255 255 252 / 88%);
--border-inner: rgb(82 62 48 / 15%);
--border-strong: rgb(82 62 48 / 34%);
--focus-ring: #795e48;
--shadow-glass:
  0 32px 84px rgb(94 70 51 / 14%), 0 8px 26px rgb(94 70 51 / 7%), inset 0 1px rgb(255 255 255 / 72%);
--shadow-control: 0 14px 32px rgb(78 57 44 / 20%), inset 0 1px rgb(255 255 255 / 42%);
```

#### I / `porcelain`

```css
--surface-canvas-solid: #f5f7fd;
--surface-canvas:
  radial-gradient(circle at 77% 2%, rgb(211 220 244 / 64%), transparent 28rem),
  radial-gradient(circle at 8% 84%, rgb(222 227 241 / 45%), transparent 32rem),
  linear-gradient(145deg, #fbfcff 0%, #f2f5fc 48%, #e4eaf7 100%);
--surface-glass: linear-gradient(138deg, rgb(255 255 255 / 74%), rgb(224 230 246 / 39%));
--surface-glass-strong: linear-gradient(142deg, rgb(255 255 255 / 87%), rgb(221 228 246 / 52%));
--surface-glass-soft: linear-gradient(145deg, rgb(255 255 255 / 65%), rgb(219 226 243 / 31%));
--surface-inner: rgb(255 255 255 / 48%);
--surface-input: rgb(255 255 255 / 66%);
--surface-hover: rgb(255 255 255 / 78%);
--text-primary: #243251;
--text-secondary: #465575;
--text-muted: #5e6a87;
--text-on-action: #ffffff;
--accent: #6679a9;
--accent-soft: rgb(102 121 169 / 17%);
--action: #304477;
--action-hover: #223463;
--border-glass: rgb(255 255 255 / 87%);
--border-inner: rgb(42 58 99 / 15%);
--border-strong: rgb(42 58 99 / 34%);
--focus-ring: #5269a2;
--shadow-glass:
  0 32px 84px rgb(47 62 104 / 14%), 0 8px 26px rgb(47 62 104 / 7%),
  inset 0 1px rgb(255 255 255 / 72%);
--shadow-control: 0 14px 32px rgb(43 61 112 / 20%), inset 0 1px rgb(255 255 255 / 42%);
```

### 3.3 Component token 与玻璃构造

```css
--glass-radius: var(--radius-card);
--glass-blur: var(--blur-soft);
--glass-fill: var(--surface-glass);
--glass-border: var(--border-glass);
--glass-shadow: var(--shadow-glass);
--button-radius: var(--radius-pill);
--button-height: 50px;
--button-fill: var(--action);
--button-fill-hover: var(--action-hover);
--button-text: var(--text-on-action);
--stage-padding-x: clamp(54px, 6vw, 88px);
--stage-padding-y: clamp(88px, 9vw, 124px);
```

标准玻璃表面由六部分共同组成，缺一不可：

1. 1px `border-glass` 光学外边缘；
2. `surface-glass` 半透明渐变填充；
3. `blur(22px) saturate(118%)` 背景折射；深层舞台使用 30px，清透层使用 34px；
4. 顶边 `white-72` 与左边 `white-42` 内高光；
5. 左上径向高光和 112° 微光带；
6. `shadow-glass` 双层外阴影与 1px 内高光。

玻璃不是透明度本身。承载正文的表面必须使用 strong 填充或足够不透明的内部面，确保任意背景上
仍达到 AA。`backdrop-filter` 不可用或 `forced-colors: active` 时，使用 `surface-canvas-solid`/系统
`Canvas` 实色、1px 边框、无阴影；信息和层级不能消失。

允许使用本地、低幅度的 CSS 噪点作为 component token，透明度上限 2%。禁止高饱和幻彩、彩虹
渐变、大面积品牌色块、远程图片和无关图库照片。

## 4. 排版与图标

字体只使用本地系统栈，不加载远程字体：

```css
font-family:
  "Avenir Next",
  Avenir,
  -apple-system,
  BlinkMacSystemFont,
  "Segoe UI",
  "PingFang SC",
  sans-serif;
```

- 页面主标题：`clamp(3rem, 5.7vw, 5.15rem)`，字重 430，行高 0.98–1.05；
- 批次/阅读页标题：`clamp(3rem, 7vw, 5.8rem)`，同一编辑式层级；
- 区块标题：1.25–1.55rem，字重 600；
- 正文：0.88–1rem，行高 1.55–1.7；
- eyebrow/索引：0.61–0.68rem，字重 700–760，字距 0.12–0.18em；
- 技术 ID 不进入普通用户正文；数字使用 `font-variant-numeric: tabular-nums`。

图标使用本地内联 SVG，20px 基准、1.6px 描边、圆角端点。图标按钮必须有可访问名称，不能用
Unicode 装饰符替代稳定图标。

## 5. 统一布局

所有主题复用 C 的结构：顶部品牌栏、悬浮玻璃主导航、12 列工作区、主舞台、右侧队列和下方辅助
入口。页面可根据业务内容使用相同的 heading/list/detail/state primitives，但不得按主题改变结构。

桌面 `/practice` 基准：

- 顶栏高 84px，左右 padding 为 `clamp(24px, 4.5vw, 72px)`；
- 主导航高至少 52px，胶囊玻璃，当前项使用 2px accent 下划线；
- 工作区最大 1312px，宽度扣除 `clamp(48px, 9vw, 128px)`，12 列、14px gap；
- 主舞台占 1–8 列、前两行，最小高 650px，42px 圆角强玻璃；
- 今日队列占 8–12 列并与舞台轻叠，最小高 326px；
- 辅助面位于右下和第三行，保持主要任务唯一突出；
- 控件触控区域至少 44×44px，主要按钮高 50px。

其他页面使用同一 Bento 语法：一个明确主舞台、一个索引/队列面、少量辅助面。不得恢复“每段内容
一张同权卡片”的管理后台式布局。

## 6. 响应式规则

验收视口固定为 1440、1024、768、390px；实现断点如下：

- `>1120px`：完整顶部悬浮导航和 12 列重叠 Bento；
- `≤1120px`：导航进入文档流，工作区两侧 24px，保持 12 列；
- `≤860px`：主导航横向可滚动；所有主舞台、队列、详情和辅助面转为单列；
- `≤520px`：两侧 10px，卡片圆角 24px、舞台圆角 30px；标题 2.75–3.55rem；主要操作全宽；
- 任何宽度均不得出现页面级横向溢出；仅明确的导航/索引带允许局部横向滚动；
- 200% zoom 后仍可到达全部操作，确认层不得超出视口。

窄屏可以把外观选择器放进导航层，但复用同一四选一 DOM/行为，不创建主题专属移动结构。

## 7. 组件与状态

### 7.1 外观选择器

- 四个用户可见名称：去青月白、流银镜白、香槟晨霜、霁蓝瓷光；
- 单一选中态，包含文字和 `aria-checked`/等价语义；
- 支持 Tab、方向键、Home、End、Enter/Space；
- 选择即时生效；保存失败时本页继续预览，并由 polite live region 宣告
  “本次有效，未能保存”；
- 不显示 C/G/H/I 字母，不通过 URL 保存。

### 7.2 按钮与输入

- 主按钮：action 实色、白色文字、pill 圆角、50px 高；hover 仅上移 1px并使用 action-hover；
- 次按钮：玻璃内部面、strong border；hover 提升边界，不使用新强调色；
- 危险按钮：稳定 danger 语义，并保留明确危险文字；
- disabled 优先于 loading/active/focus/hover；不得只降低到不可读透明度；
- 输入使用 `surface-input`、strong border、18px 圆角；错误与说明由 `aria-describedby` 关联。

### 7.3 状态面

每个适用页面至少覆盖正常充实、空、加载和错误；流式、确认、危险、权限拒绝只在真实业务存在时
显示。加载骨架使用低对比 accent-soft 动画；`prefers-reduced-motion` 下取消 shimmer。错误、成功和
警告同时使用图标/标题/正文，不以颜色单独表达。

### 7.4 确认与焦点

确认层打开后焦点进入标题或首个安全操作，Tab 保持在确认层内，Escape 只在业务允许时关闭，关闭后
返回触发器。永久删除、撤销和管理员危险操作必须保留现有二次确认与权限门。

## 8. Store 独立材质

Store `pearl | parchment` 是词卡材质 component variant，不能映射为整页外观：

- `pearl`：更通透，使用当前 appearance 的 `surface-glass`、34px blur 和更明显内高光；
- `parchment`：更柔雾，使用当前 appearance 的 `surface-glass-strong`、22px blur 和更低反射；
- 两者继承 C/G/H/I 的颜色，不改变 DOM、尺寸、状态、流式内容或存储值；
- Popup 调色板按钮继续只切换该材质；Options“常用设置”是唯一整页外观选择入口；
- YouTube 字幕继续使用必要的高对比遮罩，appearance 只影响边缘和控件强调；
- Shadow DOM 同时携带 `data-appearance` 与现有材质属性，广播后原位更新。

## 9. 无障碍与降级

- 正常正文和操作文字至少 4.5:1；大字、控件边界和焦点至少 3:1；
- 所有交互可键盘操作并有至少 3px 可见 focus ring、3px offset；
- 保留 skip link、语义 heading、表单 label、live region、`aria-current` 和现有焦点恢复；
- `prefers-reduced-motion: reduce` 将非必要 animation/transition 降到 0.01ms 或移除；
- `forced-colors: active` 使用 Canvas/CanvasText/Highlight，不保留不可读玻璃；
- 不支持 blur 时使用实色 fallback，不以功能或文字消失作为降级；
- 不加载远程字体、远程代码或远程视觉素材。

## 10. 生产与测试合同

- 生产只发布四个稳定 appearance 值，不包含 `?variant=`、`?appearance=`、原型状态控制器或字母；
- Web/Store 主题只覆盖 semantic token；组件/page CSS 不得使用主题 raw color；
- 四套主题必须定义同一组 semantic token，引用闭合；
- 外观切换不得改变请求、路由、权限、状态恢复、流式端口、输入或确认状态；
- Web actual bundle 默认 G 覆盖所有路由与 390px；代表页覆盖四主题；
- Store actual bundle 覆盖四主题和两材质，包含 Popup、Options、词卡、YouTube 与 Shanbay；
- macOS 与 Windows 使用分离视觉基线；CI 证据不能替代另行批准的真实 Chrome 人工验收。

本规范取代 `product.md`、`cloud-web-ui-redesign.md` 与 `web-design-token-contract.md` 中“单一皮肤”、
“不实现换肤 UI”和旧纸上语言馆配色方向；它们保留的业务、安全和 Token-only 约束继续有效。
