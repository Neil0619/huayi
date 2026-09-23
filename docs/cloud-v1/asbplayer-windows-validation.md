# asbplayer Windows 开发验收回执

2026-09-23 至 24 日，影响范围为 shared Store、测试工具与 Windows 验证。历史候选 `b39449e` 的双平台
CI、Windows 原生 100%／150% 基础学习流程及官网脚本通过；接续候选 `1c381dd` 的两平台 CI
均失败，原因及后续修复见文末。本机仍有四项视觉差异，真实 YouTube 字幕不可用，新官网扩展矩阵
尚待 100% 补验；不能声明全部实机验收通过。本次未合并 main、部署或发布商店版本。

## 候选与环境

- 输入候选：`c67405c7ff7562e950bf5b03dc46971c2c6f5b24`，来自
  `https://github.com/Neil0619/huayi.git` 的 `codex/asbplayer-windows-validation`。
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
  中文样本确认实际回退字体为 Noto Sans SC（常规／粗体）；尚无相同样本在 CI 的字体证明，
  不将字体差异推测写成已确认根因，也不修改用户字体。
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

- 本机四项已在输入候选复现的视觉差异仍保留失败状态；需要在相同浏览器版本、系统字体和渲染条件下继续定位。
  当前不能用远端 Windows 的成功覆盖本机失败，也不能直接接受新截图。
- 真实 YouTube 学习、首次加载、SPA 和字幕切换未验证。解除阻塞需先在干净隔离 Chrome 中确认
  YouTube 自身能显示英文 CC、timedtext 返回非空内容，再加载同一候选补测划词、关闭恢复及切换。
- 官网扩展矩阵已经补测列出的特殊模式、切文件与定向敌对消息；其 100% 原生缩放仍待执行。
  结束字幕修复后的产品候选还需补 100% 基础流程、官网基础脚本和真实 BFCache。
  未声称任意恶意／迟到消息组合均已验证。其他 Store profile 未做官网验证。
- Chrome for Testing 154 的官网全屏失败仍保留；149 的成功不代表 154 官网矩阵通过。

复跑命令见 [Git 接续说明](asbplayer-windows-handoff.md)。未验证项目需要在隔离 Chrome 中按
[本地视频矩阵](asbplayer-local-video.md) 执行，并记录真实系统比例、输入类型、操作和可观察结果。
默认保存脱敏计数与状态，不把字幕、媒体、路径、完整播放 URL、频道或凭据加入 Git。
