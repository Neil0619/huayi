# Store Extension 本地开发与商店交付流程

## 一套源码、两种环境构建、一个日常加载目录

Store Extension 统一维护 `apps/store-extension` 及其共享依赖。本地验收与 production 候选使用同一套
源码，通过既有 build profile 固定环境、Manifest 身份和网络目标；不维护两份功能代码。

| 用途                   | Profile / 产物                                        | 日常使用方式                                                     |
| ---------------------- | ----------------------------------------------------- | ---------------------------------------------------------------- |
| 本地开发与 Hosted 验收 | `hosted-acceptance` → `apps/store-extension/dist`     | 唯一日常加载目录；同 ID 原地重载                                 |
| Production 候选        | `production` → `apps/store-extension/dist-production` | 临时构建、审计和发布准备产物；不作为第二份日常安装               |
| 离线兼容与测试         | `release` → `apps/store-extension/dist-release`       | 保留给普通 workspace build、E2E 和兼容检查；不作为日常安装交付物 |

这里的“两种环境构建”指 Hosted 验收与 production。历史 `release` profile 继续服务离线兼容和
测试，不代表已经可上架的 Chrome Web Store 包。后续正式日常使用通过 Chrome Web Store 安装和
更新；实际商店条目绑定、发布候选准备与上架仍需单独完成。

## 日常开发

在仓库根目录执行：

```bash
pnpm store:local:build
pnpm store:local:status
```

这两个别名分别调用既有 `acceptance:hosted:store:build` 和 `acceptance:hosted:store:status`。
固定验收 ID 为 `hoijjhgcckfhbcefoclgbhkgninnkknd`，API 为
`https://api.acceptance.seen-said.cn`，工作区为 `https://app.acceptance.seen-said.cn/app`。

本机 macOS 日常加载路径为
`/Users/niuzhenya/Documents/huayi/apps/store-extension/dist`。在 Chrome 的扩展管理页确认该路径和
固定 ID；后续只重建此目录并对既有条目原地重载。不要卸载后重装，不要改变 key/ID，不要把产物
同步到另一安装目录。Windows 使用其实际 checkout 下的同一相对目录，并单独核验 Chrome 显示的
固定验收 ID；本机 macOS 通过不构成 Windows 安装验收。

`pnpm build` 与普通 Store workspace build 生成 `dist-release`，不会刷新日常加载的 `dist`；需要
更新本地扩展时必须使用上述专用命令。`status` 只证明产物审计结果，不证明 Chrome 已重载、账号
已配对、后端已部署或真实业务通过。记录实际产物身份、Chrome 路径/ID、重载结果和未完成项。

## Production 候选与未来商店版本

```bash
pnpm store:package:build
pnpm store:package:status
```

这两个别名分别调用既有 `production:store:build` 和 `production:store:status`，当前输出为
`apps/store-extension/dist-production`，固定目标是 `https://api.seen-said.cn` 与
`https://app.seen-said.cn/app`。它们只构建或审计本地产物，不执行上传、部署、迁移或商店发布。

当前 production 构建已绑定用户提供的 Chrome Web Store 公钥和 item ID
`kehpghgppccjlmahanlmeagnpnfbcnea`，1.0.1 候选用于更新已上传的 1.0.0 草稿。历史个人 ID
`enlolhfodncfnleiihkjanhmnfbgeggh` 不再是当前 production 预期身份，旧 Profile 和数据保留。
本地绑定或命令成功不等于正式 API 已更新、账号配对通过或“商店就绪”。
商店交付前须核验真实条目、公钥/ID、对应云端许可与配对兼容、权限披露和最终候选，并完成
[发布门槛](./release.md)及[逐项发布清单](./release-checklist.md)。

每次候选记录同一源码快照及各目标实际构建结果，分别检查 Manifest、公钥/ID、API/Web origin、
权限和产物；验收包通过不能代替 production 包通过。仅更新代码或构建包，不构成 API/Web 发布
授权，也不自动完成双平台 Chrome、真实 Provider 或商店验证。

## 旧目录归档与数据保留

旧 macOS 目录 `~/Applications/SeenAndSaid/testing` 与 `~/Applications/SeenAndSaid/production`
退出日常安装流程。一次性整理时先记录 Chrome Profile、扩展 ID 和加载路径，在 Chrome 中禁用
旧条目，再将两目录归档为非加载用途并记录实际归档位置；不要创建新的第二加载目录或同步脚本。
归档是否完成以本次操作回执为准，本文本身不构成归档完成证据。未来迭代不得重新安装或同步回
旧 testing/production 路径。

保留旧浏览器存储与原 Profile，不卸载旧条目、不清除 storage、不删除 Vault 或配对数据。
目录归档只保存扩展程序文件，不包含浏览器数据，也不自动把旧 ID 下的数据迁移到验收 ID 或未来
商店 ID。本地词表导出只有一词一行词头，缺少语境等完整记录，不能称作完整备份或恢复方案。
跨 ID 数据迁移需另行设计和验证；不要因整理目录隐式执行导出、导入、重新配对或云端写入。

## 当前未完成边界

2026-09-15 已完成 Hosted 验收 API 的回填接口部署及 0039/0040 迁移，原 status `404` 已修复；
本地唯一加载目录已包含失败提示与重试修复。真实 Chrome 重载、扇贝提交和跨设备业务验收仍须
分别完成，不能仅凭构建与接口鉴权回读声称通过。相关实现、迁移与业务验收见
[扇贝回填](./shanbay-backfill.md)。API/Web 交付使用
[Hosted 迭代 SOP](../cloud-v1/hosted-iteration-release-sop.md)，并遵守适用的本地迭代规则。

同日追加修复欧路空语境导致整页发现失败，以及检查失败阻断开启/打开已有队列的问题；
当前本地 `dist` 已重建。89 项回填/欧路/页面测试、4 项实际打包后台测试、Store 类型检查、相关
ESLint/Prettier、架构检查和本地产物审计通过；最终后台包的发现回归另行复跑通过。
打包弹窗使用模拟 Chrome 消息完成 354×600 检查，不能代替真实浏览器操作。
本次未执行全仓 CI、Windows 或真实欧路/扇贝业务验收，未新增 API 部署；用户仍须重载当前扩展
后验证真实账号。旧 testing/production 归档目录不更新。

随后针对“扇贝上传完成但数量不减少”补齐实际 div 控件、窗口内回执、原生受控输入框和重复完成文案
识别。120 项相关回归及独立浏览器测试通过；浏览器测试加载实际 Hosted Content Script/Worker，
在离线 React 页面经三次可信点击完成 41 词，持久账本与角标归零。本地 `dist` 已重建并通过产物审计。
旧版本漏记的真实上传不会自动补造成功回执；升级后还须核对该批次，重载扩展后也须刷新扇贝页面，
以加载新 Content Script。未将离线浏览器结果记作真实账号或 Windows 验收。

随后针对设置页跨分类出现回填面板、状态读取失败和欧路持续报连接失败追加修复：回填只挂载于
“外部词典”，后台接受可信 Options 标签页消息，设置页不覆盖回填按钮自己的禁用状态；欧路默认
fetch 绑定浏览器全局接收者，修复请求发出前的 `Illegal invocation`。162 项相关测试、欧路原生
Worker 离线浏览器回归、1440/390 设置页回归、Store 四项 TypeScript、相关格式/lint 和架构检查
通过。唯一 `dist` 已重建并审计通过；隔离 Chromium 直接加载此产物，确认原生设置页能收到后台
回填状态、分类显示正确、无页面错误及外部请求。该隔离环境没有真实账号，欧路实际检查仍需用户
重载扩展并刷新设置页后验证；未执行全仓 CI、Windows 验收、提交或新部署。

2026-09-16 针对 496 词时弹窗读取卡住、打开无反应及反复扫描，改为账号绑定的加密缓存读取、
来源读取移出写锁、后台请求合并及持久检查点恢复。近期缓存的 Worker 冷启动不请求 API/欧路；
停用会取消后续检查，页面激活可等待早到的旧请求结束后继续。历史词与成功、跳过、未知记录保留。
108 项回填回归、页面控制器回归、496 词实际打包 Worker 检查、41 词三批离线浏览器流程、
Store 四项类型检查、相关 lint/格式及架构检查通过。最终唯一 `dist` 已重建并审计；隔离 Chromium
直接加载最终包，三次弹窗就绪约 204/67/55 ms，固定扇贝离线页面打开、所有权校验、激活和复用通过，
无页面错误或真实外部流量。首次升级需先取得当前账号的安全缓存绑定；离线结果不代表真实账号验收。
用户须原地重载当前扩展并刷新扇贝页面后验证。未提交、推送、部署或运行全仓/Windows 验收。

2026-09-16 按用户要求把新回填批次提高到最多 100 词。新版扩展显式领取 `limit:100`；API 对省略
limit 的旧请求保留 20 词，并保留原幂等摘要。已有 20 词批次、成功和未知记录不因升级重写。页面
预填、消息、加密存储及完整回执均接受 100 词，超限仍拒绝。157 项扩展相关回归、Store 四项类型
检查、API 与依赖构建、相关 lint/格式及架构检查通过；实际 Worker/Content bundle 的离线 React
浏览器回归以五次可信点击完成 496 词（100/100/100/100/96），账本与角标归零。
运行独立 Shanbay 浏览器测试前先构建 learning-domain、cloud-contracts 和 store-domain；初次测试
曾因 Node 侧读取旧 dist 的 20 词 Schema 失败，更新这些依赖后通过，不改断言绕过问题。
唯一加载目录 `apps/store-extension/dist` 已重建并通过产物审计。此条不代表 API 已发布；须先发布
Hosted API 的兼容更新，再重载扩展和刷新扇贝页面，否则旧 API 拒绝新领取字段。新 API 保存过
100 词批次后，回滚也须保留扩大的存储 Schema。未执行新部署、真实账号提交或 Windows 验收。

2026-09-16 用户明确要求“发布到 Hosted”后，100 词兼容接口已独立提交并发布到验收 API：
`58103cae221dd385a6833e37be93f65364c45ad9` / `dpl_6jSBe8DcUrEs5ZuZRjanqx2bo24G`。准确候选 61 项回归、
API/依赖类型检查与构建通过；主任务独立回读 health 200、CORS 204、回填未鉴权 401 及准确版本。
Web 未部署，无迁移或配置修改。现可重载唯一扩展并刷新扇贝页面验证新领取的 100 词批次；
真实账号、Windows 和完整 CI 仍未验收。回执：`artifacts/shanbay-batch100-hosted-20260916/completion.md`。
