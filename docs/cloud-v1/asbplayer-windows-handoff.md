# asbplayer Windows Git 接续说明

2026-09-24 影视库扩测已形成产品修复 `a3eaf05855b6cbebd4ff945a19c122fa71549f5d`，
修复原 ASS 中个别片头／混排 cue 使整份文件不能确认的问题，并补充空字幕提示。
最新验证候选 `9a1d00b07be8c6fa21a18c7823af666ac4c4b429` 另修复 CI 样片录制等待问题，产品源码不变。
该准确候选的 Windows／macOS 完整 CI 均通过，两端浏览器各 246/246；Windows 产品已完成本机
100%／150% 验证，新增 shared 行为仍需 Mac 实机复验。
当前验证状态、9 个原文件与 4 个 AAC 副本的边界、固定加载目录更新见[影视库扩测与字幕修复回执](asbplayer-windows-library-validation.md)。
普通下载资源不能仅凭文件后缀保证音轨和文本字幕兼容；没有新增转码或 OCR，也未发布。

同日后续针对用户指定的另一原文件复现了 AC-3 无音频解码、内嵌 SRT 未进入网页学习层，
已生成整集 AAC 副本并提取英文 SRT，两种外挂字幕学习均通过。产品代码不变，实际缩放已读到
150%；详见[指定媒体无声与内嵌字幕复验](asbplayer-windows-embedded-media-validation.md)。

## 历史接续证据（83c1ab0 及更早候选）

Mac 后续接续已记录于 [Mac 验证回执](asbplayer-macos-validation.md)，输出分支为
`codex/asbplayer-mac-validation`，输入为准确提交 `bb952f5c3186331f55c932501c799c13a2fdb5ab`。
该轮无产品源码变化，CI 代码候选仍为 `83c1ab0`；Mac 两个无扩展隔离浏览器也观察到英文
timedtext 200／0 字节；同日后续原生访客和普通启动 CfT 字幕正常。使用显式非零调试端口的
隔离 CfT 149、实际 Store release、合成 Provider 和本机词本，真实学习／推荐 SPA 矩阵已通过。
历史空响应原因仍未知，不删除失败记录。Mac 固定 Hosted 程序目录已更新，用户确认已重载；
日常加载路径仍未由工具核验。详见 Mac 回执，Mac 通过不替代 Windows 条件或真实模型验证。

2026-09-24 更新。影响平台为 shared Store 扩展与测试工具，目标验收平台为 Windows Chrome。
该历史轮产品构建的 Windows 100%／150% 学习流程、真实 BFCache、官网基础及扩展矩阵均已取得通过
证据；官网显式字体权限与常见弹窗条件见回执，不能写成默认配置通过。该历史候选本机整套门禁和
准确代码候选的双平台 CI 已通过。用户已确认恢复 150%，日常 Chrome 的真实 YouTube 英文 CC 与
快捷键正常。接续 Mac 准确提交 `cac6f62914ee182c0fdb19fcf788de6c454437c5` 后，本机隔离
Chrome 已补齐真实 YouTube 划词、解释、收藏、暂停归属、CC 和推荐 SPA；临时中文仍受翻译字幕
429 阻塞。用户影视的画面与拆轨后学习通过，原 AC-3 音频未解码、原 ASS 不能直接单轨确认。
本次新增实测为实际 100%，详见 [本机影视与 YouTube 补测](asbplayer-windows-real-media-validation.md)；
既有门禁及历史条件见 [Windows 验证回执](asbplayer-windows-validation.md)，不表示全部验收或发布完成。

较早的用户视频对照曾在实际 release／Chrome 149 与无扩展、无请求拦截的本机 Chrome 153 干净配置
中复核：均能播放、CC 已开，但英文 timedtext HTTP 200／0 字节，原生字幕仍缺失。两项均实读
DPR 1.5；未调用真实 Provider。后续显式非零端口和仅 Provider 拦截条件下已取得非空英文字幕，
但不据此确定历史空响应根因，也不删除失败记录。

此前接续另外修复了视频结束后末句残留，已用失败单测及实际 Store 浏览器复现；新产品构建的
150% 基础／扩展流程通过，100% 已在 `83c1ab0` 的相同 release 产物补验通过。不可把历史候选结果移用到新构建。
后续 `6798083` 修复 Windows Hosted Store 构建入口，真实 Hosted／production 构建与三个 profile
审计通过。`0e37df7` 的 macOS CI 成功，但 Windows 三项 Store 用例超时后作业被时限终止；
`6798083` 的准确 Windows CI 已通过（浏览器 242/242），macOS 为 241 通过、失效快捷键暂停计数
一项失败。当前新增官网选项在真实 150% 下通过基础／扩展矩阵，本机 Store 与权限回归 12/12 通过；
显式字体权限、弹窗尺寸条件及后续 100% 结果均见回执。工具候选 `ad59af7` 的 Windows 完整 CI
已通过（浏览器 243/243）；macOS 在 Hosted profile 构建单测超时，浏览器门未运行。后续 `2897154` 隔离并串行化
macOS 普通 Store 批次，原测试及 15 秒期限保留；准确 Mac CI 已通过，Windows 浏览器 242 通过、
一项 Classic 短语拖选失败。独立诊断在两平台各 100 轮未复现，不表示已修复根因。各次失败不以重跑覆盖。
截图环境对照确认字体回退与 GPU 合成条件影响结果。新视觉夹具只在 Windows 的两个视觉测试文件
固定浏览器通用字体并禁用 GPU，原文件 9/9 通过；产品 CSS、原截图和阈值保持。历史失败及逐步
对照计数见回执。包含该夹具的 `83c1ab0` 本机完整 Windows 门禁已通过，浏览器 243/243；准确提交的
双平台 CI 也已通过，两端浏览器各 243/243。视觉夹具不替代官网或原生缩放实测。

## 通过 Git 获取候选

- 仓库：`https://github.com/Neil0619/huayi.git`。
- 当前交接分支：`codex/asbplayer-windows-validation-fixes`。
- 最新验证候选：`9a1d00b07be8c6fa21a18c7823af666ac4c4b429`；Git tree：
  `488df112f6b7314641d51a96fd7ddced79baf60f`，准确 CI 状态见影视库扩测回执。
- 更早 Mac CI 已通过候选：`2897154de5ee027609d31f7121685c10193fc3b0`，Windows 一项拖选失败。
- 更早 Windows CI 已通过候选：`ad59af7a990dccda483042d486dee3409e6933f7`，macOS 构建单测超时。
- 历史双平台 CI 通过候选为 `83c1ab0445bcc20e7018f2fdba85c7ee299afe99`；更早候选
  `b39449ee8e940701924dafe22769f73d82f7f1d2` 的结果另存。
- Windows 接续输入：`codex/asbplayer-windows-validation` 的
  `c67405c7ff7562e950bf5b03dc46971c2c6f5b24`；更早实现基线为 `ce0110d4eacaef9a4b9cf7e903e1be85129af58d`。
- 分支可含代码候选之后的纯回执文档提交；不能把该文档提交误写成双平台 CI 测过的 SHA。
- 候选身份以本次交接提示词提供的完整 commit SHA 为准；不能以旧基线或后来移动的分支顶端替代。

在 Windows 既有仓库读取适用 AGENTS.md，确认 origin 身份并检查工作区后，fetch 此分支。
在独立工作树检出准确 commit，保留原工作区、用户修改和已安装扩展。不要 reset、clean 或覆盖已有
目录，不依赖 Mac 的 artifacts、ZIP、补丁文件或 Codex 任务迁移。源码、测试和接续说明均由 Git 获取。
记录 `git rev-parse HEAD`、`git status --short` 以及 Node、pnpm、Chrome 和 Windows 版本。

## Windows 固定日常加载入口

本机 Chrome 日常加载 **`E:\Document\huayi\apps\store-extension\dist`**，与 Mac 的
`/Users/niuzhenya/Documents/huayi/apps/store-extension/dist` 同为 Hosted `dist`，固定 ID
`hoijjhgcckfhbcefoclgbhkgninnkknd`。后续交付继续更新这个既有目录，用户只重载同一个条目并刷新
网页。候选工作树的 `dist-release` 是独立测试产物，不作为长期加载路径；此前将它作为日常加载
建议不正确。不要卸载已有条目或把 release 包复制成 Hosted 安装。

2026-09-24 后续已从 `a3eaf05` 重新构建并审计 Hosted 包，备份原固定目录后更新，23 个文件名称与
SHA-256 全部匹配；隔离 Chrome 从该固定路径加载后读到正确 ID，asbplayer 设置可见、页面错误 0。
日常 Chrome 尚未由代理重载，账号业务及 Hosted 官网完整矩阵未因此声称通过。主仓库源码与 main
保持不变；候选尚未接续前，不从旧 main 重新构建覆盖该目录。详见
[统一工作流](../store-v1/local-and-store-workflow.md)和 [Windows 回执](asbplayer-windows-validation.md)。

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

```powershell
pnpm acceptance:hosted:store:build
pnpm acceptance:hosted:store:status
pnpm production:store:build
pnpm production:store:status
```

Hosted 构建从 pnpm package 命令取得 JS 入口，由当前 Node 执行；缺少入口时失败，不在 Windows
回退到 shell。以上命令只构建／审计本地独立目录，不加载或重装用户扩展，也不部署或发布。

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

需对照其他已安装的测试浏览器时，两脚本支持 `--browser-executable <绝对路径>`；路径按参数原样
传给 Playwright，不通过 shell。`--deny-local-fonts` 只在本次隔离配置中拒绝官网的本地字体权限，
退出浏览器后结束；默认不改变权限。必须在回执中区分默认配置与显式拒绝后的结果。
基础脚本还支持 `--common-popup-window`，要求先设置真实 Windows 缩放校验变量；它将实际弹窗
调整至 1000×700，并记录调整前后窗口尺寸和实际 DPR，不模拟 viewport 或系统缩放。

```powershell
# browser 指向本机已安装、支持加载解压扩展的测试 Chrome；先核实实际 OS 缩放为 150%。
$browser = 'E:\Document\huayi-validation-tools\cft-154.0.8037.57\chrome-win64\chrome.exe'
$env:HUAYI_ASBPLAYER_NATIVE_SCALE = '150'
node scripts/verify-asbplayer-store-browser.mjs --run-approved-browser-validation --browser-executable $browser --deny-local-fonts --common-popup-window
# 先保存 artifacts/asbplayer-store-browser-receipt.json，再运行矩阵。
node scripts/verify-asbplayer-store-matrix.mjs --run-approved-browser-validation --browser-executable $browser --deny-local-fonts
Remove-Item Env:\HUAYI_ASBPLAYER_NATIVE_SCALE
```

这些选项用于明确条件的诊断与常见窗口验证。Chrome 154 默认字体请求阻塞全屏、官网自动弹窗
缩小的失败仍应保留，不能把附加条件下通过写成默认配置通过。当前诊断及版本见 Windows 回执。

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
pnpm exec playwright test apps/store-extension/e2e/asbplayer-package.spec.ts apps/store-extension/e2e/asbplayer-matrix.spec.ts apps/store-extension/e2e/store-youtube-package.spec.ts
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
