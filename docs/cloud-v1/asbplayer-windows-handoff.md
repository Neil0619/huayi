# asbplayer Windows Git 接续说明

2026-09-24 更新。影响平台为 shared Store 扩展与测试工具，目标验收平台为 Windows Chrome。
上一轮 Windows 100%／150% 学习流程、官网基础脚本和准确代码候选的双平台 CI 已完成；后续官网
扩展矩阵已在 150% 通过，100% 尚待补验。本机整套门禁仍有四项视觉失败，真实 YouTube 字幕仍不可用。当前结果与范围见
[Windows 验证回执](asbplayer-windows-validation.md)，不表示全部验收或发布完成。

## 通过 Git 获取候选

- 仓库：`https://github.com/Neil0619/huayi.git`。
- 当前交接分支：`codex/asbplayer-windows-validation-fixes`。
- 已通过双平台 CI 的代码候选：`b39449ee8e940701924dafe22769f73d82f7f1d2`。
- Windows 接续输入：`codex/asbplayer-windows-validation` 的
  `c67405c7ff7562e950bf5b03dc46971c2c6f5b24`；更早实现基线为 `ce0110d4eacaef9a4b9cf7e903e1be85129af58d`。
- 分支可含代码候选之后的纯回执文档提交；不能把该文档提交误写成双平台 CI 测过的 SHA。
- 候选身份以本次交接提示词提供的完整 commit SHA 为准；不能以旧基线或后来移动的分支顶端替代。

在 Windows 既有仓库读取适用 AGENTS.md，确认 origin 身份并检查工作区后，fetch 此分支。
在独立工作树检出准确 commit，保留原工作区、用户修改和已安装扩展。不要 reset、clean 或覆盖已有
目录，不依赖 Mac 的 artifacts、ZIP、补丁文件或 Codex 任务迁移。源码、测试和接续说明均由 Git 获取。
记录 `git rev-parse HEAD`、`git status --short` 以及 Node、pnpm、Chrome 和 Windows 版本。

## 构建及自动化验证

Windows 使用 Node.js 26+；pnpm 以根 package.json 的 packageManager 为准，本候选为 10.34.5。
在独立工作树运行：

```powershell
pnpm install --frozen-lockfile
pnpm exec playwright install chrome
pnpm exec playwright install chromium
pnpm verify:windows
```

先检查完整平台门禁的实际输出，保留失败回执；已通过且候选未变的测试无需重复执行。
若完整门禁提前失败，应补运行尚未覆盖的相关 Store 检查：

```powershell
pnpm exec vitest run --project store-domain --project store-extension --no-file-parallelism
pnpm --filter @huayi/store-extension typecheck
pnpm --filter @huayi/store-extension build
pnpm check:architecture
pnpm check:store-release
pnpm build
pnpm exec playwright test apps/store-extension/e2e/asbplayer-package.spec.ts apps/store-extension/e2e/asbplayer-matrix.spec.ts
pnpm exec playwright test apps/store-extension/e2e/asbplayer-bfcache.spec.ts
```

实际 Store 夹具读取本工作树的 `apps/store-extension/dist-release`。运行前确认 release 已构建，
不要混入 Hosted acceptance 的 `dist` 或 production 的 `dist-production`。另按仓库构建规范核对
三个 Store profile 的打包边界；它们的构建通过不等于各 profile 均经过官网实测。

Chrome 与 Chromium 分开安装：Playwright 发现 branded Chrome 已安装时会提前结束该安装调用。
`pnpm build` 还准备 E2E 服务器需要的工作区产物；服务器冷启动可能包含多个 profile 的构建。
若默认浏览器缓存无法启动，可设置仅用于本任务的 `PLAYWRIGHT_BROWSERS_PATH` 后重新安装
`chromium`，记录路径和版本；不要修改用户 Chrome 或已安装扩展。

用户已授权本次接续的隔离浏览器测试与加载扩展，可运行：

```powershell
New-Item -ItemType Directory -Force artifacts | Out-Null
node scripts/verify-asbplayer-store-browser.mjs --run-approved-browser-validation
node scripts/verify-asbplayer-store-matrix.mjs --run-approved-browser-validation
```

官网脚本使用合成媒体及拦截的 Provider 响应；不产生真实模型费用或外部词典写入。
实际浏览器授权不包含真实模型 smoke、欧路／扇贝写入或产品发布。

## Windows 实机与修复

按 [本地视频学习文档](asbplayer-local-video.md) 的完整矩阵，覆盖 Windows Chrome 常见窗口尺寸、
100%／150% 系统缩放、字幕轨道和偏移、切文件、双击／拖选、解释／翻译、本机收藏、暂停归属、
临时中文、全屏、弹窗、停用恢复，以及 Store YouTube SPA 和普通网页回归。
viewport 或 deviceScaleFactor 模拟不等于真实系统缩放；显式 pagehide/pageshow 不等于真实 BFCache。
无法执行的实机项目标为未验证，并给出具体人工步骤，不得改为通过。

先在 Windows 显示设置中实际切换缩放，再指定预期比例运行；该选项使用有界真实窗口、
`viewport: null`，不设置 `deviceScaleFactor` 或强制缩放参数，并在启动时核对实际 DPR：

```powershell
$env:HUAYI_ASBPLAYER_NATIVE_SCALE = '150' # 100% 时改为 '100'
pnpm exec playwright test apps/store-extension/e2e/asbplayer-package.spec.ts apps/store-extension/e2e/asbplayer-matrix.spec.ts
pnpm exec playwright test apps/store-extension/e2e/asbplayer-bfcache.spec.ts
node scripts/verify-asbplayer-store-browser.mjs --run-approved-browser-validation
# 先保留上一条命令的回执；两个脚本写同一回执路径。
node scripts/verify-asbplayer-store-matrix.mjs --run-approved-browser-validation
Remove-Item Env:\HUAYI_ASBPLAYER_NATIVE_SCALE
```

离线实际产物矩阵与官网脚本是独立证据，不能互相替代。官网基础脚本与扩展矩阵均记录原生显示
指标，后者补充上游时间／模式／文件交互及定向敌对消息。本次 Windows 的具体结果与未验证项见
[Windows 验证回执](asbplayer-windows-validation.md)。

行为问题先复现并补回归测试，再修复、重建和补受影响检查。不要降低断言或更新截图制造通过。
代码变更后原 commit 的测试证据不能代表新候选；记录完整 diff 和新的候选身份。
本次 Windows 接续按用户“全部交接仅通过 Git”的指示，将修复和脱敏回执交接到独立 codex 分支。
不合并 main、不部署、不发布商店版本；后续发布步骤仍需独立授权。

## 已有 macOS 证据及限制

Git 交接前逐文件核对：原冻结候选 2,773 个文件全部匹配，无缺失或额外文件；实现变更共 120 文件。
冻结源码摘要为 `5c6fc7ad8dd1e8c1d4a584157830818e75144b5b5fc36a3cbe08436996aa1b79`。
本次 Git 交接仅额外更新说明文档；该摘要不是包含接续说明的新 Git 树摘要。
以下原始日志在 Mac 已忽略的 artifacts 中，不随 Git 传输；本节是已有结果摘要，Windows 需生成自身证据。

| 检查                      | 已观察结果                                                                 |
| ------------------------- | -------------------------------------------------------------------------- |
| `pnpm test`               | 6,092 通过、12 项既有平台跳过                                              |
| Store 覆盖率测试          | 1,202 通过；语句 90.37%、分支 85.16%、函数 90.86%、行 92.44%               |
| 类型、架构、指令          | 通过                                                                       |
| 格式与 lint               | Git 源码范围 Prettier、排除历史 artifacts 的源码 ESLint、diff 空白检查通过 |
| 三个 Store profile        | 均构建、审计通过                                                           |
| 独立生命周期回归          | 四项先失败再修复通过；聚焦回归 251/251                                     |
| 最终实际 Store 浏览器夹具 | 6/6 通过                                                                   |
| 官网实际扩展              | release 的 SRT/VTT/ASS、学习收藏、全屏、弹窗和停用恢复通过                 |

官网验证环境为 macOS Chrome for Testing 149.0.7827.55，上游参考提交
`ff63e8fff2aaa0171ab36b1977346500713e2667`；当时官网资产摘要
`6a604e3145ce5409dd3135f77f1d16d337b658aa8f880de89f4f5f3304a95456`。
官网可能更新，Windows 应记录实际兼容基线，不能假定部署相同。

完整浏览器运行曾有 234 项中的 6 项视觉失败：Classic lexical translation、Store popup themes、
Store settings layout、Web silver practice、Web pairing themes、Web compact workspace。
六项断言均在未修改 Git 基线上重现，未降低阈值或修改截图；不声称整套浏览器检查全绿。
另一次 Store 夹具在拖选用例开始前启动超时，随后同代码单项及整组通过，原因尚未确定。
默认整仓 format/lint 曾扫描本机历史 artifacts 而被停止，不等同默认命令通过。

隐私边界保持：字幕和媒体数据不进入业务请求、日志或云端；Chrome 附带的 sender URL 包含播放页
blob 参数，Worker 会在本地授权校验中看到该元数据，不持久化或转发。因此不声称 blob 字符串绝不
进入 Worker。真实 BFCache、Windows 实机、准确候选双平台 CI 和既有视觉差异仍需分别记录。

## 最终回执

记录准确 commit（有未提交修复时附其差异身份）、产物摘要、环境版本、命令及退出结果、
实机矩阵、修复内容和剩余问题。区分已通过、失败、跳过和未运行。本机 Windows 门禁不等于远端 CI。
验收记录不包含凭据、字幕原文、媒体文件名、路径、完整播放 URL 或原始频道消息。
