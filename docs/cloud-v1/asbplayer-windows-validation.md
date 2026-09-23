# asbplayer Windows 开发验收回执

2026-09-23 至 24 日，影响范围为 shared Store、测试工具与 Windows 验证。最新代码候选为
`2897154`，进一步隔离 macOS Store 构建测试；本机定向检查通过，新候选 CI 进行中。上一工具
候选 `ad59af7` 的 Windows CI 已通过、macOS 构建单测超时。本机完整门禁为 238 项浏览器通过、4 项视觉
失败；更早远端 Windows 的实际 Store 超时尚未确认原因。真实 YouTube 字幕不可用，新产品及官网
扩展矩阵尚待 100% 补验，不能声明全部
验收通过。本次未合并 main、部署或发布商店版本。

## 候选与环境

- 输入候选：`c67405c7ff7562e950bf5b03dc46971c2c6f5b24`，来自
  `https://github.com/Neil0619/huayi.git` 的 `codex/asbplayer-windows-validation`。
- 最新代码候选：`2897154de5ee027609d31f7121685c10193fc3b0`；Git tree：
  `910fc79b3e055c0f28e8ca7549c0d8e6ba9d5b24`。其后纯回执文档提交不等于 CI 验证过的源码 SHA。
- 上一官网测试工具候选：`ad59af7a990dccda483042d486dee3409e6933f7`；Git tree：
  `05e8b36dc510f25ccd9b45b3ce209916e0e49abc`。Windows 完整 CI 已通过，Mac 普通 Store 构建测试超时。
- 已完成 Windows CI 的上一构建修复候选：`679808338a0f9fcd69e407e6dae59b93cd060c2c`；Git tree：
  `14be92de00579b013abd8a80813bf2a6afcd73e2`。其 macOS job 有一项浏览器失败。
- 上一轮已通过 CI 的代码候选：`b39449ee8e940701924dafe22769f73d82f7f1d2`；Git tree：
  `2169db5105d7ea0d6b92fad180f17ead68dac6be`；交接分支：`codex/asbplayer-windows-validation-fixes`。
  上一轮代码提交为 `6ac310b3b2414a11d353f0211140bf7ba5d502e7` 和上述候选；接续提交另见文末。
- 在独立工作树检出准确 SHA；原 `E:\Document\huayi` 的 `main` 和既有工作树、扩展、Host 注册保留。
  原项目保持 `c39fed3f9026f7d8943f961cfe72f54fe80b65cc`，没有覆盖用户工作区。
- Windows 11 Pro Insider Preview 25H2，10.0.26220.9223，x64；PowerShell 7.6.5；Git 2.45.1.windows.1。
- 验证使用独立安装 Node.js 26.10.0、pnpm 10.34.5、Playwright 1.61.1。
  主机原有 Node.js 24.18.0 和 pnpm 11.19.0 未替换。
- 实际 Store 夹具／官网使用 Playwright Chromium 1228、Chrome for Testing 149.0.7827.55；
  普通 E2E 使用已安装 Chrome 153.0.8010.50。
- Provider 由合成 SSE 响应替代，只写隔离扩展本机词本。未调用真实模型或外部词典写入。

默认浏览器缓存中的 Chromium 无法启动（Windows side-by-side 依赖程序集错误）。任务专用
`PLAYWRIGHT_BROWSERS_PATH` 重新安装的相同 149 版本可启动；exe、manifest、chrome.dll 和
chrome_elf.dll 与默认缓存哈希一致，不能据此断言上游二进制损坏。试用的 154.0.8037.57 能加载官网
并完成查词收藏，但全屏被浏览器拒绝（`TypeError: not granted`）；该失败保留，未改动产品代码规避。

## 最新接续结果（2026-09-24）

`0e37df7546a7bc2c18d11bc9408fefaf2c119585` 的本机 `pnpm verify:windows` 于 02:39 至 03:13
完成，退出 1。指令、整仓格式／lint／类型、全部单元测试、Store 覆盖率、架构、整仓构建及 Cloud
development-blocked 通过。脚本 1,135 通过／6 跳过，Store 191 文件／1,203 项通过；其余单元计数
与下面历史结果表相同。覆盖率仍为 90.37%／85.16%／90.86%／92.44%。完整浏览器回归 238 通过、
4 项既有视觉失败，用时 9.0 分钟；asbplayer、普通网页、离线 YouTube 和真实 BFCache 通过。
门禁停止后补跑 Store 发布边界、安全审计、Windows SEA 打包及隔离健康帧，均退出 0。

该候选 [CI 35903715683](https://github.com/Neil0619/huayi/actions/runs/35903715683) 的 macOS job
`107326002717` 成功，浏览器 242/242。Windows job `107326002624` 被 45 分钟作业上限终止；
此前三个实际 Store 用例已分别超过原 60 秒期限，不能只归因于作业时限。浏览器实际为 231 通过、
3 失败、1 中断、7 未运行；失败涉及 BFCache、时间／轨道和暂停归属。日志只有用例总超时，没有
具体等待阶段，且未上传这些用例的错误上下文，故根因尚未确认。没有延长时限或降低断言。

`6798083` 的构建入口修复采用真实进程 TDD：旧实现直接启动 `pnpm`，在只有 `.cmd`／`.ps1`
包装的 Windows 安装上无法启动；合法 JS 入口及失败子进程回归均先失败。改为当前 Node 加 pnpm
提供的 JS 入口，保留参数数组、`shell: false` 和固定 hosted profile，补足必要 Windows 环境变量。
测试检查真实子进程收到的参数与环境，过滤凭据和 `NODE_OPTIONS`；非零退出不进入审计或报告就绪。
聚焦 11/11 通过，真实 pnpm `--version` 返回 10.34.5；完整脚本 1,138 通过／6 跳过／0 失败。
指令、整仓格式、lint、完整类型检查与 diff 空白检查均通过。
准确候选 [CI 35908365313](https://github.com/Neil0619/huayi/actions/runs/35908365313) 的 macOS job
`107341649256` 浏览器 241 通过、1 失败：失效快捷键用例在失效后读到 1 次 pause 事件，预期 0。
此前单元及构建检查通过；该新增失败尚未确认是产品行为还是异步媒体事件观测竞态，不作推断。
Windows job `107341648839` 已成功，完整浏览器 242/242，实际 Store 11 项均通过。它没有复现
上一候选的超时，仍不能在缺少等待阶段证据时宣称原超时根因已修复。

真实 `pnpm acceptance:hosted:store:build` 与 `pnpm production:store:build` 均退出 0；随后 release、
hosted-acceptance、production 三个实际产物审计均返回空 violations。release 四个关键文件摘要与
下文结束字幕修复后的摘要一致。本轮不改扩展运行时代码，其他两个 profile 仍未作官网实测。
文档中旧的“七次构建／30 秒”已按既有源码校正为九个 release 入口及每次 60 秒 setup 预算，
没有修改该测试或它的时限。

Chrome 154.0.8037.58 的全屏诊断取得新证据：无扩展官网在录制／上传过程中调用本地字体 API，
默认 `local-fonts=prompt` 时 `queryLocalFonts()` 保持 pending，全屏被拒绝；仅在隔离配置中将该
权限设为 denied 后，字体调用结束、官网原生全屏成功。没有授予字体读取权限或修改日常 Chrome。
浏览器 trace 也记录到上传前约 1.3 秒的 `ForSecurityDropFullscreen` 事件。该对照确认本次默认
权限状态下的阻塞与待处理字体请求相关。提前录制再导航仍失败，不能仅归因于媒体录制或上传。

随后使用支持解压扩展的 CfT **154.0.8037.57**、实际 release 和真实 Windows **150%**，通过 Git
内的显式浏览器选项重跑完整官网基础与扩展矩阵，两条命令均退出 0。基础命令同时指定
`--deny-local-fonts --common-popup-window`；矩阵只指定 `--deny-local-fonts`。实际读数 DPR 1.5，
主窗口 outer 1280×900、inner 1266×806。四个 release 摘要与结束字幕修复后一致，官网模块摘要
仍为下文记录值；Provider 为合成响应，各脚本仅 1 次请求。此结果不是默认 Chrome 154 全部通过。

官网 Pop Out 默认实际缩为 outer 178×100、inner 163×28，轨道确认按钮在可视范围外。转发原调用的
诊断记录先 `resizeTo(494,342)`，随后用更新后的 outer 和仍旧的 inner 计算出
`resizeTo(-314,-306)`。问题来自官网两次调整之间的窗口读数；本轮未修改上游或语见运行时代码。
基础脚本的显式选项只把真实弹窗调整为 outer 1000×700、inner 986×628，DPR 保持 1.5，然后继续
原确认、学习及停用断言。自动弹窗尺寸仍失败，不能被这个常见窗口验证覆盖。

新增测试入口默认保留捆绑浏览器、原权限和自动窗口尺寸，重复／未知参数及相对执行路径失败关闭。
参数解析回归先红后绿 4/4。实际浏览器回归复现了辅助函数过早断开 CDP 导致权限恢复为 prompt；
保持该会话到隔离 context 关闭后，权限持续为 denied、字体 API 返回空数组、真实全屏成功，其他
origin 和独立 context 权限不变。回归保留所有权限与全屏断言，并在点击前激活相应页面。
Store 完整类型检查通过；为排查 Windows CI 超时，仅增加固定阶段名，不输出页面／媒体内容或凭据。
本机再次运行实际 Store 11 项和新权限回归，共 12/12 通过（1.8 分钟）。11 项使用捆绑 Chrome 149
及真实 DPR 1.5，没有启用官网浏览器／权限／弹窗选项；覆盖实际 BFCache、普通网页、离线 YouTube
首次与 SPA、结束字幕、全屏及学习闭环。独立权限回归使用普通 Playwright Chrome，未模拟系统缩放。
新增工具后的指令、整仓格式、lint、Store 完整类型检查及 diff 空白检查通过；完整脚本测试
1,142 通过、6 项既有平台跳过、0 失败。未声称这组定向检查等于整仓 Windows 门禁或新候选 CI。

上述测试工具提交为 `ad59af7a990dccda483042d486dee3409e6933f7`，已推送同一接续分支。
其准确候选 [CI 35913888907](https://github.com/Neil0619/huayi/actions/runs/35913888907) 已结束，
macOS job `107360346997` 失败于更早的 Store 实际构建单测；Windows job `107360347197` 成功，
作业耗时 44 分 4 秒。Windows 完整浏览器 243/243 通过（10.2 分钟），包括原实际 Store 11 项和新增
官网权限回归；后续 Store 发布边界、安全审计、SEA 打包及隔离健康帧均通过。新增固定阶段日志
显示本次 Store 从浏览器启动、媒体录制到 profile 清理均完成，没有复现旧候选的超时；这不等于
已确定旧超时根因。该次 Mac 浏览器门未运行，不能说已复测或修复快捷键失败。
对上一 macOS 失败，本机追加 12 轮相同快捷键流程并观测原生 pause／play／playing 事件，全部
未复现；每轮暂停事件均发生在有效快捷键阶段，失效后计数 0、视频继续播放。仅凭 Windows
未复现无法区分 macOS 产品异常和事件观测竞态，未作猜测性修复或改动原失效断言。

macOS 构建失败为 Hosted acceptance profile 用例超过原 15 秒，耗时 15.826 秒；非 API 批次
3,656 通过、1 失败、12 跳过。日志显示它与 `build-profile-isolation.test.ts` 的整套 Vite 构建
重叠，Hosted Vite 自身已用 14.78 秒。此前只把 Windows 普通 Store 和两平台覆盖率串行化，Mac
普通门仍在四 worker 的非 API 批次中运行 Store。新增真实 Vitest 回归先复现四文件重叠；尝试两个
否定 `--project` 过滤仍失败，实际 CLI 按或匹配。改为非 API 批次先排除 Store 目录，再独立串行
Store，最后保留 API 批次；原 Windows 计划、所有用例和时限不变。回归同时验证非 Store 与 API
各执行一次、Store 无重复完成，11/11 通过。完整脚本 1,143 通过／6 跳过／0 失败，本机原真实
profile 构建回归 16/16 通过；该调度修复仍需要新的准确 macOS CI，不以 Windows 契约测试代替。
指令、整仓格式、lint、完整类型检查与 diff 空白检查也通过。修复提交为
`2897154de5ee027609d31f7121685c10193fc3b0`，准确候选
[CI 35917137881](https://github.com/Neil0619/huayi/actions/runs/35917137881) 已启动；Windows job
`107371493035`、macOS job `107371493326`，本文更新时仍在运行，不声称通过。

为取得可比较的 CI 环境证据，另建诊断分支 `codex/asbplayer-ci-diagnostics`，准确提交
`78e68bd3b06b598a798a691d9d4cfc6d0acb4751`，其产品源码与 `ad59af7` 相同。该分支仅将手动入口
改接离线诊断，不是产品候选、不合并到 main，也不改变接续分支的完整门禁。
[定向诊断 35915453989](https://github.com/Neil0619/huayi/actions/runs/35915453989) 两端完成：
macOS job `107365664504` 与 Windows job `107365664850` 的快捷键各 20 轮均未复现异常；每轮
仍断言失效后零 pause 事件、继续播放和零 Provider 请求。它们保留原生事件顺序，不派发合成事件。

同一诊断的 Chrome **154.0.8037.58** 实测：CI Windows Server 10.0.26100 对相同源码字体栈的
固定中文使用 **Microsoft YaHei**（普通／粗体），本机 Windows 10.0.26220 使用 **Noto Sans SC**。
三组样本尺寸均相同：272×25.5、40×15.5、158.21875×23.25；字体实际选择不同已确认，尚未据此
把所有截图差异归为单一根因。CI 渲染器为 ANGLE／Vulkan SwiftShader，本机默认为 NVIDIA D3D11。
诊断只记录固定合成文本的字体名称／数量、尺寸和渲染器，不上传字体文件或私人页面数据。

随后在本机用同一 Chrome 154.0.8037.58 作两组对照：复制原四项测试，只把测试页面的中文回退字体
显式设为 Microsoft YaHei；第二组在此基础上加 `--use-angle=swiftshader`。原截图、行为断言、
期限和比较阈值全部保留，显式使用 `--update-snapshots=none`，没有改产品 CSS 或用户系统字体。
两组均为 Classic 两项通过、Store 两项失败，分别耗时 47.9／55.0 秒、退出 1。仅字体对照中，
Store 四主题各有 11／21／13／17 个超阈值像素，四张设置图为 29／2／8／2；加软件渲染后分别为
13／25／16／16 与 21／3／8／2。字体替换足以消除本次 Classic 截图失败，但两个 Store 测试仍不
匹配，不能把全部差异归因于字体或 GPU，也不能将默认本机四项失败改记为通过。两组外部临时
配置均未修改 Git 内原测试或截图；首次启动的模块路径错误发生在测试执行前，不计产品结果。

进一步仅加入 `--disable-gpu` 后，同一临时字体对照四项全部通过（41.6 秒）。CDP 读数显示默认
NVIDIA 和仅 SwiftShader 两组仍为 `gpu_compositing=enabled`／`skiaBackendType=GaneshGL`；
加该参数后才是 `disabled_software`／`None`。这解释了为什么只替换 ANGLE 后仍有 Store 边缘差异。
随后用浏览器 `Page.setFontFamilies` 替代临时 CSS：只指定 Hans 可修正中文页面，英文页面的中文
仍回退 Noto；同时指定通用与 Hans 的 serif／sans-serif 为 Microsoft YaHei 后，原 CSS 下四项均
通过（41.9 秒）。实际字体探针独立确认该回退变化，没有安装或修改用户字体。

正式修复新增仅由两个视觉测试文件使用的 Windows 夹具：只禁用 GPU，不再强制 ANGLE；通过 CDP
设置上述通用字体，保留显式 CSS 字体的优先级。macOS 不设置这两个条件；真实 Store 扩展、官网和
原生缩放测试不使用此夹具。原两个测试文件在本机默认 Chrome 153 下 9/9 通过（55.7 秒），包括
此前四项失败，运行明确禁止更新截图。原行为断言、截图基线、阈值和超时均未改变，产品 CSS 也未
改变。这是测试环境修复的定向结果，历史默认配置失败仍保留；完整 Windows 门和新提交 CI 待执行。

## 上一轮自动化结果（b39449e）

准确候选 CI：[35885283490](https://github.com/Neil0619/huayi/actions/runs/35885283490)。
macOS job `107263750277` 与 Windows job `107263749988` 均成功，两端浏览器回归均为 242/242。
Windows CI 为 Windows Server 2025 10.0.26100、Node 26.10.0、普通 Chrome 154.0.8037.58；
实际扩展使用 Chromium 149。它与本机 Windows 11／Chrome 153 是不同环境，结果不能相互替代。
中间候选 CI 35884101905 在候选被接续后主动取消，不算通过。

本机最终 `pnpm verify:windows` 于 2026-09-23 23:57 至 09-24 00:45（UTC+8）运行，退出 1；
停止后补跑所有剩余步骤，各自退出 0：

| 检查                                                        | 实际结果                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------ |
| 指令、整仓格式、lint、完整类型检查                          | 通过                                                         |
| 脚本测试                                                    | 1,133 通过、6 项既有平台跳过、0 失败                         |
| Store domain / learning domain / cloud contracts / protocol | 74 / 155 / 132 / 107 通过                                    |
| Native Host / Classic extension / Store extension           | 998（67 跳过）/ 383 / 1,202 通过                             |
| Web / API                                                   | 473 / 1,302 通过                                             |
| Store 覆盖率                                                | 1,202 通过；语句 90.37%、分支 85.16%、函数 90.86%、行 92.44% |
| 架构、整个工作区构建、Cloud development-blocked             | 通过                                                         |
| 完整浏览器回归                                              | 238 通过、4 项视觉失败，14.5 分钟                            |
| 补跑 Store 发布边界、依赖安全审计                           | 通过；toolchain findings 为空，全部／生产依赖无已知漏洞      |
| 补跑 Windows SEA 打包、隔离健康帧、diff 空白检查            | 全部通过；没有注册或替换已安装 Host                          |

四项视觉失败是 Classic lexical translation、Classic lexical explanation、Store popup 四主题、
Store settings 两种宽度。对应产品源码、测试和基线截图与输入 commit 相同。截图已经实际检查：
Classic 差异主要在中文文字，Store 的差异包括圆角边缘像素；未更新截图或降低阈值。
远端 Windows 完整视觉检查通过，本机差异具体成因仍不能仅凭 CI 通过认定。

已另建独立工作树检出准确输入 `c67405c7ff7562e950bf5b03dc46971c2c6f5b24`，冻结安装依赖并构建
四个共享包。预先启动原有 Vite E2E 服务后，用未改动的原 Playwright 配置复跑这四项：4/4 同样失败。
两次运行产生的 10 张 `*-actual.png` 的 SHA-256 全部一致，基线工作树的 tracked diff 为空。
这证明四项本机视觉差异不是本次提交引入；它们仍然是失败，未被转换成跳过或通过。

聚焦对照命令（在准确输入的独立工作树，先等第一个终端的服务就绪，再在第二个终端运行测试）：

```powershell
pnpm install --frozen-lockfile
pnpm --filter @huayi/learning-domain --filter @huayi/cloud-contracts --filter @huayi/store-domain --filter @huayi/protocol build
pnpm exec vite --config apps/extension/e2e/vite.config.ts --host 127.0.0.1 --port 4173
# 第二个终端；没有设置 CI，保留原配置的 reuseExistingServer 行为
pnpm exec playwright test apps/extension/e2e/results.spec.ts apps/store-extension/e2e/interface-layout.spec.ts --grep 'renders the lexical|340px popup|settings align search'
```

## 基线证据与修复

基线 `pnpm verify:windows` 的指令、格式、lint、类型通过；脚本测试 1,128 通过、6 跳过。
Store 原单测 1,200 通过、2 个实际 Vite 构建集成测试超时。两文件隔离运行 6/6 通过；限制并发后
Store domain + extension 共 1,276 通过。门禁原运行在单测阶段停止，不能称完整通过。

准确基线远端 CI：[35873792207](https://github.com/Neil0619/huayi/actions/runs/35873792207)。
macOS job 通过；Windows job 在 Taro H5 热更新测试失败。第一次 dispatch 使用了不被接受的
release_id，运行 35873582849 在候选校验前停止，不算代码验证。

上一轮修复均限测试工具和说明，没有改 Store 运行时代码、Classic wire v7、权限或安装行为：

1. Windows Store 单测限制 4 workers，保留构建测试期限；runner 契约先红后绿 7/7。
2. Taro watcher 等待 HTTP 实际返回编辑后的标记。用真实无关重编译复现旧竞态，再修复为 4/4 通过；
   HTTP 状态和编辑内容断言保留。
3. CI 分别安装 Chrome 与 Chromium；新增命令边界断言先红后绿 5/5。
4. E2E 服务器冷构建启动期限从 30 秒改为 180 秒，测试与 expect 超时不变。
5. 精确忽略生成的 asbplayer 探针、回执、Store parity 构建及小程序 bundle report；
   不使用全 artifacts 忽略。ESLint／Prettier 边界测试先红后绿 5/5。
6. 增加原生缩放校验和实际 Store 矩阵；DPR 不符、非法比例或非 Windows 会失败。
   固定 viewport 模式不变。原有关闭卡片点击移到视频左侧，避免真实窗口中点击落进词卡。
   新增解释测试等待解释文本出现并生成完成，不能用上一张翻译卡的按钮就绪代替解释完成。
7. Windows Node 脚本测试也限制为 4 个并发进程。串行重跑平台门禁时，原 SEA 尾随 stdout 用例
   在默认高并发脚本批次中先触发 1 秒超时；隔离同用例约 87 毫秒通过。新增八个真实测试进程的
   并发回归先失败，再限制调度后通过；runner 与原 SEA 检查合计 14/14，通过前未改超时或错误断言。

## Windows 实际浏览器证据

原 6 项实际 `dist-release` E2E 在 Windows 通过。新增矩阵覆盖字幕时间与轨道、暂停归属、原生 video
全屏回退、解释及关闭词卡后的收藏；上游网站和 Provider 是离线合成响应，扩展 worlds、Worker、
Storage、IndexedDB 和媒体事件是真实浏览器实现。

100% 与 150% 官网脚本在 Chrome 149 均通过：双轨 SRT 确认、翻译、本机收藏、全屏卡片保留、关闭恢复播放、
VTT／文本 ASS、更换字幕、弹出窗口、停用恢复。用户报告系统为 150%，实际读数 DPR 1.5，
inner 1266×806、outer 1280×900、screen 2390×1270；没有 viewport／DPI 模拟。
用户随后在 Windows 显示设置切至 100%，实际读数 DPR 1，inner 1264×805、outer 1280×900、
screen 3584×1904。100% 的最终整组回归 9/9 通过，独立真实 BFCache 1/1 通过；恢复 150% 后，
包含加强后的解释断言及真实 BFCache 的整组 10/10 通过。100% 首轮新测试在解释发起前过早检查
请求数失败，等待实际完成后聚焦及整组通过。系统最终保持用户原来的 150%。

真实 BFCache 使用真实导航、返回和 iframe 的 `pageshow.persisted=true`，验证词卡退役、原字幕
恢复、等待新快照和重新确认，没有新增 Provider 请求。它移除 Playwright 的默认禁用参数，
不派发合成生命周期事件。初版用 frameLocator 读取恢复帧失败；诊断确认真实 iframe 及状态已恢复，
只是 Playwright 丢失子帧句柄。正式测试从父页面读取真实同源 DOM，并以鼠标确认轨道，保留全部状态断言。

较早一次修复工作树的本地门禁通过指令、默认整仓格式／lint、完整类型检查、脚本 1,132 通过／6 跳过，
以及 Store domain 74、learning domain 155、cloud contracts 132、protocol 107、Native Host 998
通过／67 跳过、Classic extension 383。Store 为 1,201 通过／1 个构建测试超时，恰与原生浏览器
矩阵并行；不能将这次完整命令记为通过。后续重型检查串行执行，原失败不覆盖。
`pnpm audit:security` 已通过：工具链审计无 findings，完整／生产依赖均无已知漏洞。
中间候选 `6ac310b3b2414a11d353f0211140bf7ba5d502e7` 的串行门禁通过前四步，脚本为
1,131 通过／1 失败／6 跳过，失败为上述 SEA 测试进程启动超时；此候选随后由限制脚本并发的修复接续。
release、hosted-acceptance、production 三个 profile 已在该 Windows 工作树构建，三个产物审计
均返回空 violations；官网及原生缩放实测使用 release，其他两个 profile 未作官网实测。

离线实际 Store 的 YouTube 首次 watch 加载回归 1/1 通过，覆盖划词、翻译、暂停、关闭后归属恢复，
以及夹具 CC DOM 关闭后恢复原字幕；原有实际 Store SPA 回归也通过。真实 YouTube 首页可加载，
两段公开 TED 视频均可播放、英文 CC 已开启、播放器状态为 OK，但实际 timedtext 请求 HTTP 200
的响应体为 0 字节，YouTube 自身和 Store 均没有可用字幕。放行所需 Google 静态资源后仍相同。
随后在不加载任何扩展、不设置请求拦截的干净 Chrome 149 中对照：播放器状态 OK、readyState 4、
正在播放、CC 已开，timedtext 仍为 HTTP 200／0 字节、原生字幕数量 0。这证明当前现象可在语见
之外复现，但没有确定是网络、站点策略还是浏览器环境导致。
因此真实站点划词学习、SPA 和字幕切换未验证；没有改动失败关闭行为，也没有用合成字幕冒充实站通过。

官网模块 SHA-256：`6a604e3145ce5409dd3135f77f1d16d337b658aa8f880de89f4f5f3304a95456`。
release 产物 SHA-256：

最终候选完整构建后再次核对，以下四个哈希与 100%／150% 官网回执相同。原生显示测试先于最终
测试调度提交；后续未更改产品运行时代码。最终候选另外完成了上述本机完整 E2E 和双平台 CI。

| 文件                 | SHA-256                                                            |
| -------------------- | ------------------------------------------------------------------ |
| asbplayer-main.js    | `7eb7e65c01a06f5b2013754097b721050df019ad2e92b90c11cde67d89ef2bbf` |
| asbplayer-content.js | `27e4cb55712bec50a0c4d160b965ade7c245bf14e5eacfb6d30d08a551311fd7` |
| service-worker.js    | `aedc3909b13c9ccf7ac5baf35df3bb712b2643797366af6a8e8ccc0e9d948c7b` |
| manifest.json        | `535572ce7920400f0f7bb1e87b5f5eb79cbbb776241fac43d970fec15fbe6eed` |

## 接续复查（2026-09-24，进行中）

首个接续新增 `scripts/verify-asbplayer-store-matrix.mjs`，当时未改产品运行时代码、截图基线或断言阈值。
上述 `b39449e` 的双平台 CI 是历史候选证据，不能代表新增脚本所在提交；新提交需另外记录检查。

新增官网矩阵提交为 `1c381dd8a45af720eda11f156faebcd96f716cba`，已推送同一接续分支。
其 [CI 35896042114](https://github.com/Neil0619/huayi/actions/runs/35896042114) 的 Windows job
在 Store 单测失败：1,201 通过、Hosted acceptance 实际构建一项超过原 15 秒，不能记为成功。
日志明确显示它与 `build-profile-isolation.test.ts` 的完整 Vite 构建并行；此前的四 worker 上限
仍允许重型构建竞争。后续调度回归用真实 Vitest 文件观测活跃数量，普通／覆盖率门原配置分别
复现 4／2 个文件重叠；修改为 Windows 普通门按文件串行、两平台覆盖率门按文件串行后，调度
回归 10/10 通过，随后本机完整 Store 单测 191 文件／1,202 项通过，用时 292.45 秒。
完整 Store 覆盖率随后 191 文件／1,202 项通过，用时 389.28 秒；语句 90.37%、分支 85.16%、
函数 90.86%、行 92.44%。完整脚本测试 1,135 通过、6 项既有平台跳过、0 失败；所有原始用例、
时限和阈值保持。整仓格式、lint、完整类型检查与 diff 空白检查也通过；调度修复的新候选门禁
还需另记结果。

同一轮 `1c381dd` 的 macOS job 也失败：单测与覆盖率通过，浏览器 241 通过／1 失败。
`asbplayer-matrix.spec.ts` 在实际视频 `ended=true` 后仍观察到一条英文字幕，五秒内未清空。
后续诊断发现控制器只按 `currentTime` 查字幕，没有排除 `video.ended`。CI 没有记录末帧时间，
不能断言那次录制的精确长度；但延长末句至媒体结束之后，在 Windows 的单测和实际 Store E2E
均稳定复现同一残留症状。最小修复在未冻结选区时将 ended 媒体的活跃字幕置空；保留轨道确认，
回跳后按时间恢复字幕。单测先失败再通过，整个 asbplayer 目录 116/116 通过；重建后的真实
150% Store 流程 11/11 通过（含普通网页、YouTube 离线首次／SPA 和真实 BFCache）。
官网基础脚本与扩展矩阵在同一真实 150% 也通过；后者覆盖末句超出视频末尾及回跳恢复，Provider
仅 1 次。修复后的 Store 完整类型检查通过。
这次产品修复使 `asbplayer-content.js` 摘要变为
`5b8a395bab624ca0b69dcaafe906278dce4e6e12c24daccc27fe4358028afdb7`；其余三个摘要及官网资产
摘要与上文相同。新产品候选的 100% 完整流程与双平台 CI 必须重新验证，旧通过不能代替。

结束字幕修复已提交为 `1ae19b5cf1fc6e4a9ac82141e46656885fc8594d`，Git tree 为
`a71de769008533c8bdc1ff44ba1c09030e63f12e`；调度修复提交为
`e9a4ca72d728d1b75a958f6ee9c7797985a1df8c`。
其 [CI 35901831097](https://github.com/Neil0619/huayi/actions/runs/35901831097) 在两平台均因新增的
覆盖率调度回归失败，产品单测和浏览器门尚未运行。原因是 CI 临时目录含路径别名：Vitest 枚举
路径与 Vite 解析后的真实路径不一致。Windows 临时 junction 复现了相同的四文件导入失败；
夹具改为先 `realpath` 后生成配置，带真实目录别名的调度与 runner 回归在 Windows 10/10 通过；
完整脚本测试随后 1,135 通过、6 项既有平台跳过、0 失败。macOS 修复结果仍需新候选 CI 验证。
本机同候选门禁在 Store 单测阶段主动停止，以修复这项已确认问题；此前指令、格式、lint、完整
类型、脚本、共享包、Native Host 和 Classic 单测通过，完整命令不计通过。日志和中断原因保留。

- 从 Google 官方企业 MSI 解出隔离 Chrome **154.0.8037.58**，与 Windows CI 精确版本相同；
  Chrome 可执行文件 Google 签名有效。没有执行 Chrome 安装／更新，日常 Chrome 仍为 153.0.8010.50。
  MSI SHA-256：`40de51d92ebbc3d2e9b434526ec6f937bf9a62df6de7ca385dd02d0648379051`。
- 临时外部 Playwright 配置只指定浏览器可执行文件、输出目录及原服务器工作目录，保持原测试和
  截图断言。四项视觉测试仍全部失败，10 张 actual PNG 与 Chrome 153 逐字节相同；因此换到 CI
  浏览器版本不足以消除差异。另以强制浏览器比例 1 作诊断，10 张图仍相同；这不是系统 100% 实测。
- SwiftShader 单变量对照仍为四项失败，图像发生变化，不能据此宣布 GPU 是唯一根因。本机默认
  渲染器为 NVIDIA RTX 2070／D3D11（驱动 32.0.15.9186）。CDP 对与 Classic 相同 CSS 字体栈的
  中文样本确认实际回退字体为 Noto Sans SC（常规／粗体）；后续已取得相同样本的 CI 字体证据及
  字体／渲染器对照，详见本文最新接续结果。没有修改用户字体。
- 干净、无扩展浏览器的最小顶层全屏在 149、CfT 154.0.8037.57、Chrome 154.0.8037.58 均通过。
  真实官网相同合成媒体和原生全屏按钮的无扩展对照：149 通过，两种 154 都失败。
  失败调用时 `userActivation.isActive=true`、`document.hasFocus()=true`；iframe 的 HTML 全屏
  Promise 拒绝 `TypeError: not granted`，父文档未另发全屏请求。说明现象不依赖语见，仍不是
  154 官网全屏通过的证据；具体上游／浏览器兼容原因待定位。
  后续同源 iframe（含不设置 allowfullscreen 的对照）、官网顶层全屏、文件上传和媒体录制的
  最小对照均通过。官网原播放器内直接按钮仍失败；关闭自动化焦点模拟后仍报告真实焦点正常。
  隔离 profile 明确拒绝本地与回环网络权限并回读为 denied 后也仍失败，不能认定该权限是根因。
  新增同一上传状态对照：154.0.8037.58 在上传后连官网顶层直接按钮也失败，仍有用户激活与焦点；
  先前顶层成功发生在上传前，因此不能排除上传后的浏览器状态，不能将原因限定为 iframe 权限。
- 首版新官网矩阵在真实 Windows **150%**、Chrome 149、实际 release 扩展通过：正负和重复偏移、
  倍速与结束、Condensed／Auto-pause／Fast-forward／Repeat 四模式的暂停归属、单轨双语、
  切视频后的重新确认、旧频道消息隔离、实际观察到的旧修订重放拒绝、超限 cue 回退与重新加载恢复。
  Provider 请求仅 1 次，重复查询复用缓存。四个 release 摘要及官网模块摘要与上文相同。
  新矩阵的 **100% 尚未执行**，不能以旧基础流程或模拟 DPR 代替。
- 无扩展、无请求拦截的 Chrome 154.0.8037.58 YouTube 对照仍为可播放、CC 开启、英文 timedtext
  HTTP 200／0 字节、原生字幕数量 0。浏览器版本替换没有解除真实字幕阻塞。

## 剩余阻塞与未验证范围

- 历史本机四项视觉失败保留。固定浏览器字体与禁用 GPU 合成后，正式视觉夹具的两个文件 9/9
  通过；新测试环境仍须完整本机门禁及准确候选双平台 CI，不能只凭定向通过宣称全绿。
- 真实 YouTube 学习、首次加载、SPA 和字幕切换未验证。解除阻塞需先在干净隔离 Chrome 中确认
  YouTube 自身能显示英文 CC、timedtext 返回非空内容，再加载同一候选补测划词、关闭恢复及切换。
- 官网扩展矩阵已经补测列出的特殊模式、切文件与定向敌对消息；其 100% 原生缩放仍待执行。
  结束字幕修复后的产品候选还需补 100% 基础流程、官网基础脚本和真实 BFCache。
  未声称任意恶意／迟到消息组合均已验证。其他 Store profile 未做官网验证。
- Chrome 154 默认配置的官网全屏和自动弹窗失败仍保留；显式拒绝字体权限、调整实际弹窗后，
  150% 完整 Store 基础流程及扩展矩阵通过。相同选项的 100% 仍待补验，默认配置未通过。
- 历史 macOS 失效快捷键 pause 计数异常在两平台定向诊断各 20 轮均未复现，原因仍未确认；
  旧 Windows 实际 Store 超时也不能仅凭随后通过宣称根因已修复。
- 最新候选 `2897154` 修复 Mac 普通 Store 构建争用，准确双平台 CI 正在运行；旧结果不能代替。

复跑命令见 [Git 接续说明](asbplayer-windows-handoff.md)。未验证项目需要在隔离 Chrome 中按
[本地视频矩阵](asbplayer-local-video.md) 执行，并记录真实系统比例、输入类型、操作和可观察结果。
默认保存脱敏计数与状态，不把字幕、媒体、路径、完整播放 URL、频道或凭据加入 Git。
