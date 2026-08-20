# Phase 42：Cloud 数据边界公开披露一致性

## 1. 状态与范围

影响平台为 `shared + macOS`。本切片修复公开 `/privacy`、Extension 配对审批、隐私草案和 Store listing
之间的数据边界漂移，不修改协议、API、数据库、Provider、Extension runtime 或 Classic 0.13。

当前权威已经明确 BYOK 查询结果不上传语见，但实际 `/privacy` 仍使用“登录且同意后，严格结果才可
上传 Huayi”和“登录 BYOK 上传”等旧语义。该文案会让用户误以为登录后 BYOK 精简结果可以进入语见，
属于公开隐私事实错误，必须在下一候选前修复。

状态：`implemented and verified on macOS; Windows batch validation pending`。

## 2. 固定产品事实

公开材料必须把四类独立数据动作分别说明：

1. **BYOK 查询**：最小输入从 Extension 直达该设备选择的 OpenAI 或 DeepSeek；API Key 和该次精简
   结果不发送语见，不创建 AnalysisRecord、ReviewInbox 或 History；
2. **platform 查询**：语见 API 与平台 DeepSeek 接收完成当前查询所需的最小英文和固定指令；正文与
   精简结果最多保留一小时用于恢复和幂等，之后只保留无正文用量账本；
3. **StudyCapture**：用户手动加入，或按账号设置在显式查询句子/段落后自动加入原始学习意图；不包含
   插件精简查询结果、API Key、URL、页面标题、视频 ID 或完整页面；
4. **CloudWordCopy**：本机生词始终先保存成功；启用以后新词副本或经二次确认的历史批量导入才向语见
   提交最小单词数据，不上传 BYOK 查询结果。

账号查询模式选择 BYOK 不会隐式关闭用户另行启用的 StudyCapture 或 CloudWordCopy。三项偏好必须分别
披露、分别执行；不得把任一云端学习动作称为“BYOK 结果上传”。

撤回语见数据联网同意后，platform 查询、StudyCapture、CloudWordCopy 和云端外部词典任务停止，账号
绑定 SubmissionOutbox 正文清除；本机 BYOK、本机词库和本机外部词典仍按各自同意独立使用。

## 3. 技术方案

### 3.1 权威与渲染

- `product.md` 和 `security.md` 继续拥有行为与安全边界；
- `privacy-policy.md` 拥有完整公开事实草案；
- `store-listing.md` 拥有 Dashboard/商店披露映射；
- `PrivacyPage` 和 pairing approval 只渲染与上述权威一致的用户可见摘要。

本切片不新增只包装文案常量的浅层 module。四个公开表面用途不同，现有差异由跨材料一致性测试控制；
若以后第三个运行时页面需要同一组交互式披露，再评估共享渲染 module 的 seam。

### 3.2 数据与接口

无新数据结构、迁移、HTTP 路由或状态机。公开页面仍是纯静态 React 输出；`/privacy` 必须在没有 API
origin、Cookie 或登录时渲染，并保持零 API 请求。

### 3.3 文字约束

- 用户可见产品名使用“语见”，不得出现公开 `Huayi`；
- 必须明确“BYOK Key 与精简结果不发送语见”；
- 必须明确 StudyCapture/CloudWordCopy 是独立云端动作；
- 必须明确 platform 查询最多保留一小时且不进入待整理或分析历史；
- 禁止“登录 BYOK 上传”“严格结果上传 Huayi/语见”等可能把查询结果与学习动作混为一谈的措辞。

## 4. TDD 与验证

### 4.1 Fresh RED

先扩展以下测试并确认当前实现按预期失败：

- `privacy-page.test.tsx`：断言四类动作、BYOK 零语见结果上传、一小时临时保留、撤回语义；
- `cloud-app.test.tsx`：断言配对页分别披露 platform、StudyCapture、CloudWordCopy 与 BYOK 零结果上传；
- `cloud-release-materials.test.ts`：断言隐私草案、Store listing 与 actual Web 页面不存在旧语义并包含固定
  边界。

Focused RED/GREEN：

```bash
pnpm exec vitest run --config vitest.config.ts --project web \
  apps/web/src/privacy-page.test.tsx \
  apps/web/src/cloud-app.test.tsx \
  apps/web/src/cloud-release-materials.test.ts
```

### 4.2 Actual bundle 与静态门

```bash
pnpm exec playwright test \
  apps/web/e2e/cloud-web-journeys.spec.ts \
  apps/web/e2e/cloud-pairing-approval-journey.spec.ts \
  --grep "privacy|pairing approval"
pnpm --filter @huayi/web typecheck
pnpm --filter @huayi/web build
pnpm check:instructions
pnpm check:architecture
```

收口时执行目标 ESLint/Prettier；公开隐私与安全披露属于候选高风险 shared 改动，因此在提交前执行完整
`pnpm verify:macos`。Windows 不逐提交验证，进入下一次冻结候选批次。

### 4.3 实施证据

- Fresh RED：focused Vitest 为 3 files / 3 expected failures / 10 baseline passes；actual bundle 为
  2 expected failures，均精确缺少新披露；
- GREEN：focused Vitest 3 files / 13 tests、Web full 42 files / 192 tests、actual bundle 2/2、Web strict
  typecheck/build、目标 ESLint/Prettier、instructions/architecture 与 diff check 全绿；
- `pnpm verify:macos` 退出 0，包含 121/121 Node 脚本、Store coverage、全部 workspace build、109/109
  Playwright、release audits 和 production dependency audit；
- in-app Browser 对本机 actual `/privacy` 做了 DOM 与全页截图检查，固定事实可见且没有溢出或布局异常；
- 未运行 Windows、真实 Provider/词典、安装、Chrome 扩展、邮件、域名、DNS 或部署。

## 5. 验收标准

- `/privacy`、配对审批、隐私草案和 Store listing 对四类动作及接收方没有矛盾；
- `/privacy` 明确 BYOK Key 与精简结果不发送语见；
- `/privacy` 明确 platform 查询正文/精简结果最多保留一小时，且不进入 ReviewInbox/History；
- `/privacy` 明确 StudyCapture 与 CloudWordCopy 是独立用户选择，而不是 BYOK 结果上传；
- 撤回语见联网同意的影响和本机继续可用边界准确；
- actual `/privacy` 仍无需 API 配置、登录或 Cookie，且零 API 请求；
- 不填写运营主体、联系方式、生产区域、备份残留或正式域名等未知外部事实；
- Mac 全门通过后状态为
  `implemented and verified on macOS; Windows batch validation pending`。

## 6. 后续候选

源码审查另发现各 Web 页面复制主导航，菜单数量与顺序可能漂移；该问题记录为下一个 Mac 产品体验候选
“统一 Web 工作台外壳与主导航”。它不与本轮隐私边界修复混改。
