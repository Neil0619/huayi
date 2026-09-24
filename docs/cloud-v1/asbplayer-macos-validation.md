# asbplayer Mac Git 接续与真实 YouTube 验证回执

2026-09-24。本轮接续 Windows 候选，未修改产品源码。Mac 两个无扩展、无请求拦截的隔离浏览器
均能播放用户指定的真实 YouTube 视频，但英文字幕响应为空，原生字幕未出现。因此真实站点学习
闭环及推荐点击 SPA 仍未验证，不能宣布全部开发验收完成。没有用合成字幕页面替代此项结果。

## 准确候选与环境

- 仓库：`https://github.com/Neil0619/huayi.git`。
- 输入分支：`codex/asbplayer-windows-validation-fixes`；准确接续提交：
  `bb952f5c3186331f55c932501c799c13a2fdb5ab`。
- 输出分支：`codex/asbplayer-mac-validation`。其回执提交由 Git 历史标识，不将文档 HEAD 说成
  CI 验证过的源码提交。
- 已通过完整门禁的代码候选：`83c1ab0445bcc20e7018f2fdba85c7ee299afe99`；Git tree：
  `f2b63d5cc5be4a3b2afdafdfabf9b710f369340c`。
- 本轮核对 [CI 35920547519](https://github.com/Neil0619/huayi/actions/runs/35920547519)
  的 headSha 与两个 job，Windows/macOS 均成功，各浏览器 243/243。`83c1ab0..bb952f5` 只有四份
  文档变化，本轮也只提交文档；没有无理由重跑相同候选的全量 CI。
- 原 Mac checkout 保留分支 `codex/asbplayer-windows-validation` 和 HEAD
  `c67405c7ff7562e950bf5b03dc46971c2c6f5b24`，原有源码未改写。先核对 origin、工作区和固定包，
  fetch 后创建独立工作树检出准确 SHA；未 reset、clean、合并 main。
- macOS 27.0，build `26A428`，arm64；Node.js 24.18.0、pnpm 10.34.5、Playwright 1.61.1。
  独立工作树执行 frozen-lockfile 安装和 Mac 构建，没有复制 Windows node_modules 或构建文件。
- 安装版 Chrome 153.0.8010.53；Playwright Chrome for Testing 149.0.7827.55。
  真站对照使用有头浏览器、全新临时 Profile、`viewport: null`、1280×900 窗口，实读 DPR 2。

## 真站对照及限制

目标为用户在任务中提供的 watch 页面。回执不保存完整播放 URL、字幕原文、签名参数、请求头、
账号、媒体文件名或浏览器凭据。只观察状态、响应字节数、语言和有界显示指标。

| 对照                      | 观察                                                                                       | 结论                                    |
| ------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------- |
| 安装版 Chrome 首次        | 导航阶段 Error，没有取得 net::ERR                                                          | 原失败保留，未到字幕检查；原因未知      |
| 安装版 Chrome，单次补诊断 | 播放器 OK、readyState 4、播放中、非广告；CC ON，en/asr；timedtext 200／0 字节，原生字幕 0  | 字幕前置条件阻塞                        |
| CfT 149 首次版本对照      | 视频可播放，最终 CC OFF，未观察 timedtext                                                  | 非等价对照，不能证明 CC ON 下的字幕结果 |
| CfT 149，就绪门禁对照     | 等待 readyState 4、播放推进超过 2 秒，实读 CC ON；en/asr timedtext 200／0 字节，原生字幕 0 | 同样阻塞                                |

后面三次分别在 2026-09-24 14:44:36–14:45:12、14:45:35–14:46:04、14:46:53–14:47:25
（UTC+8）运行。每次都没有扩展和请求拦截，也没有注入字幕、合成 YouTube 导航事件、安全绕过、
复制日常 Profile 或配置 Provider。初次导航错误未再现，不能追补其网络错误码。CfT 追加一次
对照是为纠正探针的播放器就绪／CC 前置条件，未修改产品代码。

这些结果说明空字幕现象可在语见之外复现，并与 Windows 隔离环境记录相同；不能由此判定具体
网络、站点策略、自动化或隔离配置是根因，也不否定用户报告的 Windows 日常 Chrome 正常情况。
脚本退出 0 仅表示完成观察，回执状态为 `blocked`，不是验收通过。

| 真实 Store + YouTube 验收项目                    | 本轮状态                       |
| ------------------------------------------------ | ------------------------------ |
| 首次进入并接管真实英文字幕                       | 未运行，原生字幕前置条件不满足 |
| 双击、拖选，翻译和解释完成                       | 未运行                         |
| 本机词本收藏、去重                               | 未运行                         |
| 语见暂停归属、关闭恢复、原本暂停保持             | 未运行                         |
| 临时双语快捷键、CC 开关恢复                      | 未运行                         |
| 点击推荐视频触发真实 SPA、旧会话失效、新字幕接入 | 未运行                         |

无扩展对照中读取 CC 状态不等于 Store 的 CC 开关回归通过。没有配置或调用真实／合成 Provider，
没有外部词典写入。诊断浏览器全部关闭，其一次性 Profile 已清理；日常浏览器资料未读取或复制。

原始记录留在本机忽略目录，脱敏结论通过本文件进入 Git。供本机核对的 SHA-256：

| 回执                   | SHA-256                                                            |
| ---------------------- | ------------------------------------------------------------------ |
| 原始导航失败           | `d48d340c23f187fa43463155ccbdec7ac84be709a5c253ec4da6eeb8cfc02cbd` |
| Chrome 153 对照        | `5ece03a80ad8510ed4c57b1bac23d78b709e8d46b56d071b83c44fbd169eb501` |
| CfT 149 首次非等价对照 | `ed327590085c21047c73ce746fd4c180ae9d2467f0a49422d42cb27bd8c5ff8a` |
| CfT 149 就绪门禁对照   | `79026b318f43eadada08ed55ba9586a3d0a2f1f06353545016c1c37523848a62` |

## Mac Hosted 固定目录更新

从准确接续提交的相同代码构建 Hosted 包，仍使用唯一日常路径
`/Users/niuzhenya/Documents/huayi/apps/store-extension/dist`。没有创建第二个日常安装目录，
未从原 checkout 的旧代码重新构建。release 包只保留在隔离工作树作测试用途。

| 检查                                                                                                                                              | 结果与范围                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `pnpm install --frozen-lockfile`、四个 Store 共享依赖构建、Store release 构建                                                                     | 通过；Mac 本机产物                                     |
| `pnpm store:local:build`、`pnpm store:local:status`                                                                                               | 通过；Hosted 固定 ID 正确                              |
| `HUAYI_STORE_E2E_PACKAGE_PROFILE=hosted pnpm exec vitest run --project store-extension apps/store-extension/src/packaged-query-streaming.test.ts` | 1/1；实际打包 Worker、合成响应                         |
| `HUAYI_STORE_E2E_PACKAGE_PROFILE=hosted pnpm exec playwright test apps/store-extension/e2e/packaged-query-interaction.spec.ts`                    | 7/7，17.4 秒；实际打包 Content、离线交互页面           |
| 固定目录全部文件与审计包比较                                                                                                                      | 23/23 文件名及 SHA-256 一致                            |
| 隔离 CfT 从固定目录实际加载，外部网络阻断                                                                                                         | 固定 ID 正确，asbplayer 设置可见且默认英文，页面错误 0 |

固定目录加载检查使用 CfT 149.0.7827.55 和新临时 Profile，无 Provider 凭据。首次探针错误地
打开“网站管理”分类，而 asbplayer 设置属于“常用”，可见性检查失败；保留该失败回执。核对
打包 HTML 后，仅修正探针分类并单次复测通过，未修改或重建产品。这是设置页加载检查，不能
代替真实字幕学习或日常浏览器已重载。两次隔离浏览器均已关闭并清理各自临时 Profile。

新旧 Manifest 公钥完全相同，均计算为 `hoijjhgcckfhbcefoclgbhkgninnkknd`，版本仍为 1.0.0。
旧包 21 文件，新包 23 文件，新增两个 asbplayer 入口、八项变化、十三项不变，无删除文件。
更新前确认两端目录及子文件无符号链接；再次检查旧摘要防止并发改写，备份旧程序文件，再逐文件
原子替换，最后更新 Manifest 并核对完整清单。未卸载条目、迁移／清除 storage、重新配对或修改 key。
旧程序备份位于本轮工作树忽略目录 `artifacts/stable-install-mac-20260924/previous-dist`，
同目录 `receipt.json` 记录逐文件新旧摘要。备份不含浏览器数据，不作为源码交接包。

| Hosted 文件     | SHA-256                                                            |
| --------------- | ------------------------------------------------------------------ |
| 更新前 Manifest | `b638157db849d115cb3ce3d07c50cd4262516d25f9058a1a7979f3e72f68df70` |
| 更新后 Manifest | `8c8803f6e9374258a9a032dcc11f6126bff11274f92fc8c9a0fc56c1b2675e91` |
| 更新后 Worker   | `511c58d18872daa31bea8430aaf597263eb8a94703ba1c34d4ee77d4f09fbe6f` |

以上是 Hosted 摘要，不能与诊断记录中另行计算的 dist-release Manifest／Worker 摘要混用。
本轮没有源码变更，也没有重新构建 production 商店包、部署 API/Web 或发布商店版本。

日常 Chrome 详情 URL 和窗口标题已对应预期 ID 的语见，但工具未取得详情页内部加载路径或重载
控件：浏览器连接先报 request-header policy 错误，原生访问详情内容无可用 AX，截图为空白。
**固定程序目录更新不等于日常条目已重载，日常加载路径与重载状态尚未核验。**

## 下一步与保留边界

1. 在日常 Chrome 的扩展管理页核对既有语见条目 ID 与上述固定路径，点击同一条目的“重新加载”，
   再刷新学习网页。不要卸载、清空存储或改用 dist-release；本轮未执行日常账号业务。
2. 先在获授权的隔离浏览器取得真实原生英文字幕。可由用户在 Mac 的访客窗口打开任务中提供的
   视频并开启英文 CC，报告是否出现；不登录、不复制日常浏览器数据。这个人工对照用于区分环境，
   本身也不算完整学习验收。现有证据不足以选择产品修复。
3. 原生字幕可用后，再用实际 Store + 合成 Provider + 隔离本机词本完成上表全部项目，包括真正
   点击推荐视频的 SPA。不得以离线夹具、构建通过或 Mac 检查替代 Windows 实机结果。
4. 保留 [Windows 回执](asbplayer-windows-validation.md) 的所有历史失败及环境条件。Chrome 154
   官网基础流程依赖显式拒绝本地字体权限和调整弹窗尺寸，扩展矩阵依赖拒绝字体权限；默认全屏／
   自动弹窗失败未解决。共享代码若发生新修复，必须取得新准确候选的对应双平台检查。

本轮文档提交不包含凭据、原始网络响应、字幕或媒体内容；只通过 Git 交接，不合并 main、不部署。
