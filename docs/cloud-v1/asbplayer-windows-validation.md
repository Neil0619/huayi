# asbplayer Windows 开发验收回执

2026-09-23 起，影响范围为 shared 测试工具与 Windows 验证。此记录区分源码、离线实际 Store
产物、官网和原生系统缩放；不表示商店发布或全部验收完成。

## 候选与环境

- 输入候选：`c67405c7ff7562e950bf5b03dc46971c2c6f5b24`，来自
  `https://github.com/Neil0619/huayi.git` 的 `codex/asbplayer-windows-validation`。
- 在独立工作树检出准确 SHA；原 `E:\Document\huayi` 的 `main` 和既有工作树、扩展、Host 注册保留。
- Windows 11 Pro Insider Preview，10.0.26220，x64；PowerShell 7.6.5；Git 2.45.1.windows.1。
- 验证使用独立安装 Node.js 26.10.0、pnpm 10.34.5、Playwright 1.61.1。
  主机原有 Node.js 24.18.0 和 pnpm 11.19.0 未替换。
- 实际 Store 夹具／官网使用 Playwright Chromium 1228、Chrome for Testing 149.0.7827.55；
  普通 E2E 使用已安装 Chrome 153.0.8010.50。
- Provider 由合成 SSE 响应替代，只写隔离扩展本机词本。未调用真实模型或外部词典写入。

默认浏览器缓存中的 Chromium 无法启动（Windows side-by-side 依赖程序集错误）。任务专用
`PLAYWRIGHT_BROWSERS_PATH` 重新安装的相同 149 版本可启动；exe、manifest、chrome.dll 和
chrome_elf.dll 与默认缓存哈希一致，不能据此断言上游二进制损坏。试用的 154.0.8037.57 能加载官网
并完成查词收藏，但全屏被浏览器拒绝（`TypeError: not granted`）；该失败保留，未改动产品代码规避。

## 基线证据与修复

基线 `pnpm verify:windows` 的指令、格式、lint、类型通过；脚本测试 1,128 通过、6 跳过。
Store 原单测 1,200 通过、2 个实际 Vite 构建集成测试超时。两文件隔离运行 6/6 通过；限制并发后
Store domain + extension 共 1,276 通过。门禁原运行在单测阶段停止，不能称完整通过。

准确基线远端 CI：[35873792207](https://github.com/Neil0619/huayi/actions/runs/35873792207)。
macOS job 通过；Windows job 在 Taro H5 热更新测试失败。第一次 dispatch 使用了不被接受的
release_id，运行 35873582849 在候选校验前停止，不算代码验证。

本次修复均限测试工具和说明，没有改 Store 运行时代码、Classic wire v7、权限或安装行为：

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

修复后的本地完整门禁已通过指令、默认整仓格式／lint、完整类型检查、脚本 1,132 通过／6 跳过，
以及 Store domain 74、learning domain 155、cloud contracts 132、protocol 107、Native Host 998
通过／67 跳过、Classic extension 383。Store 为 1,201 通过／1 个构建测试超时，恰与原生浏览器
矩阵并行；不能将这次完整命令记为通过。后续重型检查串行执行，原失败不覆盖。
`pnpm audit:security` 已通过：工具链审计无 findings，完整／生产依赖均无已知漏洞。
release、hosted-acceptance、production 三个 profile 已在该 Windows 工作树构建，三个产物审计
均返回空 violations；官网及原生缩放实测使用 release，其他两个 profile 未作官网实测。

离线实际 Store 的 YouTube 首次 watch 加载回归 1/1 通过，覆盖划词、翻译、暂停、关闭后归属恢复，
以及夹具 CC DOM 关闭后恢复原字幕；原有实际 Store SPA 回归也通过。真实 YouTube 首页可加载，
两段公开 TED 视频均可播放、英文 CC 已开启、播放器状态为 OK，但实际 timedtext 请求 HTTP 200
的响应体为 0 字节，YouTube 自身和 Store 均没有可用字幕。放行所需 Google 静态资源后仍相同。
因此真实站点划词学习、SPA 和字幕切换未验证；没有改动失败关闭行为，也没有用合成字幕冒充实站通过。

官网模块 SHA-256：`6a604e3145ce5409dd3135f77f1d16d337b658aa8f880de89f4f5f3304a95456`。
release 产物 SHA-256：

| 文件                 | SHA-256                                                            |
| -------------------- | ------------------------------------------------------------------ |
| asbplayer-main.js    | `7eb7e65c01a06f5b2013754097b721050df019ad2e92b90c11cde67d89ef2bbf` |
| asbplayer-content.js | `27e4cb55712bec50a0c4d160b965ade7c245bf14e5eacfb6d30d08a551311fd7` |
| service-worker.js    | `aedc3909b13c9ccf7ac5baf35df3bb712b2643797366af6a8e8ccc0e9d948c7b` |
| manifest.json        | `535572ce7920400f0f7bb1e87b5f5eb79cbbb776241fac43d970fec15fbe6eed` |

## 尚待收口

验证仍在进行：修复后的串行 Windows 门禁、准确新候选双平台 CI
和最终 Git 身份待补入。官网完整上游特殊模式／文件替换／恶意及迟到消息矩阵、
真实 YouTube 站点首次加载与字幕切换尚不能由离线夹具代替。

复跑命令见 [Git 接续说明](asbplayer-windows-handoff.md)。未验证项目需要在隔离 Chrome 中按
[本地视频矩阵](asbplayer-local-video.md) 执行，并记录真实系统比例、输入类型、操作和可观察结果。
默认保存脱敏计数与状态，不把字幕、媒体、路径、完整播放 URL、频道或凭据加入 Git。
