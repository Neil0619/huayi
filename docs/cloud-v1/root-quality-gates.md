# Phase 29：根级离线质量门收口

## 1. 状态与范围

影响平台为 `shared`。本阶段只校准仓库根 `pnpm format:check` 与 `pnpm lint` 的检查边界，机械修复
仍在产品门内的格式问题；不改变 Classic 0.13、Native Host、wire v7、Cloud 产品行为或安全边界。

状态：`implemented and reviewed; root offline format/lint gates closed`。

Fresh RED（2026-08-14）：

- `pnpm format:check` 失败，共 70 个文件：65 个位于 `.agents/skills/**`，其余为 3 个 Web 源文件、
  `docs/cross-platform-development.md` 与 `pnpm-lock.yaml`；
- `pnpm lint` 失败，共 143 条错误，全部来自 `.agents/skills/**` 下 7 个 CommonJS 脚本。

## 2. 需求与检查范围

1. 根门禁必须继续检查 `apps/**`、`packages/**`、`scripts/**`、根配置、全部产品文档、workspace manifest
   和 `pnpm-lock.yaml`，不能通过隐藏产品文件或放宽规则取得绿灯；
2. `.agents/skills/**` 是供编码代理读取的外部设计技能、参考资料、模板和脚本，不在 pnpm workspace，
   产品源码和构建脚本也不导入它；它不是 Huayi 产品运行时、发布包或产品质量门的输入；
3. 辅助技能资产只允许用精确 `.agents/skills/**` 路径排除。不得排除 `.agents/**`，从而让未来同级产品
   配置或说明意外逃逸；
4. 门内格式问题只用仓库既有 Prettier 配置机械重写，不改变行为、契约或依赖版本；
5. 默认验证保持离线、无秘密，不运行 Provider smoke、真实服务、安装或真实 Chrome。

## 3. 技术路线

- 新增根 `.prettierignore`，只列 `.agents/skills/**`；
- 在 ESLint flat config 的全局 `ignores` 中只新增同一路径；
- 增加 Node 配置回归测试，读取 Prettier ignore 与 ESLint 顶层 ignore，断言精确排除技能子树，同时断言
  `.agents/**` 没有被整体排除；
- 对 Fresh RED 中剩余 5 个门内文件执行 `prettier --write`。这是 TSX、Markdown 和 lockfile 的机械
  排版，不手改产品逻辑；
- 最后重跑根 format/lint，并用 instructions、architecture、workspace typecheck、测试、E2E 与 build
  证明检查边界没有掩盖产品回归。

## 4. 数据与依赖

本阶段不新增或迁移业务数据，也不修改 API、数据库 Schema、权限、Manifest、版本或依赖声明。
`pnpm-lock.yaml` 只接受 Prettier 机械归一化；包解析结果和依赖版本必须保持不变。

## 5. 测试与验收

### 配置与 focused 验证

- Fresh RED 保存根 format 70 个文件、lint 143 条错误的逐文件输出；
- 配置测试在实现前因缺少精确 ignore 而失败，实现后通过；
- `pnpm format:check` 与 `pnpm lint` 均从仓库根返回 0；
- 显式对门内代表文件运行 ESLint/Prettier，确认 ignore 没有扩到 `.agents/**` 或产品目录。

### 回归门禁

- `pnpm check:instructions`
- `pnpm check:architecture`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:e2e`
- `pnpm build`

### 退出标准

1. 根 format/lint 均全绿，不再使用“70/143 既有阻断”作为完成例外；
2. 唯一新增排除为 `.agents/skills/**`，产品源码、文档、配置、manifest 与 lockfile 仍受门禁；
3. 5 个门内格式文件只含 Prettier 机械差异，lockfile 的依赖解析内容未变化；
4. 回归门禁全绿；外部服务和目标平台人工发布门仍明确保持 pending。

## 6. 方案自审与变更记录

实现前自审结论：路线合理。直接改写 150 个外部技能文件会把 Huayi 格式偏好施加到独立工具资产并
制造大范围无关 diff；忽略 `.agents/**` 又过宽。精确排除 `.agents/skills/**`，同时用配置测试和根门禁
约束边界，是最小且可验证的方案。剩余 5 个文件属于 Huayi 权威工作树，必须真实修复，不能排除。

- 2026-08-14：建立 Phase 29；记录 Fresh RED、范围判定、技术路线、测试矩阵与验收标准。
- 2026-08-14：配置回归先以 2 passed / 1 expected failure 证明精确 ignore 尚不存在；最小实现后
  3/3 通过。根 format/lint 均返回 0，完整离线门禁为 115/115 Node 脚本、444 个 Vitest 文件
  （2,721 passed / 12 skipped）、Playwright 109/109，以及 workspace typecheck/build、instructions/
  architecture 全绿。Prettier `--debug-check` 证明 5 个门内文件的机械重排保持可解析结构。
- 实现后复审结论：`.prettierignore` 只有 `.agents/skills/**`，ESLint 全局 ignore 也只新增同一路径；
  `.agents/**`、产品目录、配置、文档、manifest 与 lockfile 没有被扩大排除。外部服务、真实 Chrome 和
  目标平台人工发布门未运行，状态保持 pending。
