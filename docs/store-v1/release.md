# Huayi Store 1.0 商店披露与发布门槛

## 权限说明

| 权限                             | 用途                                           | 发布条件                                      |
| -------------------------------- | ---------------------------------------------- | --------------------------------------------- |
| 所有 HTTP(S) 页面 Content Script | 在阅读和观看页面提供一致划词体验               | 安装页与首次运行显著说明；提供全局和站点关闭  |
| `storage`                        | 保存设置、同意版本、DeviceVault key 与加密数据 | storage area 限制为可信上下文                 |
| `unlimitedStorage`               | 防止权威本地加密生词本被容量驱逐               | 说明数据规模来源，提供导出和清理入口          |
| `alarms`                         | 恢复耐久导入/导出任务，不做每日远端轮询        | 任务必须源于用户动作并可暂停                  |
| 三个固定 API 主机                | 直连 OpenAI、DeepSeek、欧路                    | 精确 HTTPS host_permissions；消息不能指定 URL |

Manifest 不申请 `nativeMessaging`、`tabs`、`activeTab`、`scripting`、隐身模式或任意其他网络主机。
Popup 的站点操作只使用基础 active tab ID 和已注入 Content Script relay，不读取 tab URL。增加权限、主机、
数据用途或远程执行能力都需要重新安全评审、更新披露并评估是否重新征得同意。

## 商店与产品披露

商店清单、隐私政策和首次联网界面必须一致说明：

- Huayi 开发者不运营账户、代理服务或遥测接收端；
- 用户选择的文本和必要上下文会直接发送到用户选择的模型 Provider；
- 用户明确操作时，词头和语境数据会发送到欧路或用于扇贝页面流程；
- 欧路和扇贝分别要求当前版本同意并显式启用；披露必须逐一列出接收方、字段、潜在费用和第三方
  远端保留，本地删除不会删除第三方副本；
- API 使用由用户自己的账户计费，Huayi 不承诺第三方可用性或数据保留策略；
- 凭据和本地词典在设备上加密，但同一 Chrome Profile 同时持有设备密钥，不防护 Profile 整体泄露；
- 本地词表导出是用户主动下载的一词一行 UTF-8 明文文件；它不含语境等完整记录，不能用于恢复。

不得使用“数据从不离开设备”“零数据共享”或“无需权限”等与行为不符的表述。隐私政策链接、
支持联系方式、数据删除说明、单一用途说明和权限理由在提交前必须可公开访问。

发布用文本分别维护在[隐私政策](./privacy-policy.md)、[商店清单与数据披露](./store-listing.md)和
[逐项发布清单](./release-checklist.md)。仓库文件不等于公开 URL；提交前必须完成清单中的托管、
素材和双平台证据。

## 自动质量门槛

默认 CI 离线且无秘密，macOS 与 Windows 都必须通过：

- 指令检查、Prettier、ESLint、严格 TypeScript；
- Store domain、Store Extension、Classic 的单元测试；
- Store 与 Classic 构建、架构依赖和循环检查；
- Overlay/设置/YouTube E2E；
- DeviceVault 遗留数据失败关闭、设置 v1→v2→v3→v4→v5→v6、Provider parser、Outbox、
  接收方 manual/alarm 前置策略、扇贝
  sender/租约/真实手势和 UI 保存路径的关键覆盖；
- YouTube MAIN/isolated 严格关联、JSON3 上限、录播/英文轨/真实手势和来源推导覆盖；
- 生产依赖审计和 all-sites content、YouTube isolated、MAIN bridge、Popup 四个独立 bundle 基线预算。

两个平台 CI 都应是受保护分支的必需检查，GitHub Actions 固定到完整提交 SHA。不得以 fake OS
primitive 或单平台构建代替目标平台验证。

自动门已经接入 `pnpm check:architecture`、`pnpm test:store:coverage`、
`pnpm check:store-release` 与 `pnpm audit:prod`。双平台 `verify` 都运行浏览器 E2E；E2E 的 Store
旅程在真实构建出的 `dist/content-script.js` 上注入浏览器内 fake Chrome/Provider，不访问第三方，
覆盖分析、保存、无自动重试和站点关闭。生产依赖审计只访问包管理器安全公告，不执行产品网络代码。

## 手工发布门槛

以下检查会接触真实 Chrome、凭据、配额、第三方数据或费用，必须逐项取得单独知情批准后执行：

- macOS 与 Windows 的干净安装、旧 Vault 失败关闭、禁用/重启直接可用和卸载；
- OpenAI、DeepSeek 的固定模型、流式、取消、鉴权、限流和计费失败；
- 欧路导入、查重导出、分页边界和凭据撤销；
- 扇贝人工确认、部分成功、重试和不自动提交；
- YouTube 当前播放器、切轨、导航、双语和字幕选择；
- Chrome Web Store 草稿上传、自动审查警告、隐私问卷和最终公开操作。

实现完成但缺少目标平台或真实服务证据时，状态必须写为
`implemented; target-platform validation pending`，并列出准确命令、用户步骤和期望结果。全部
自动门槛、双平台手工门槛、隐私材料和商店审查问题都清零后，才能把新 Store ID 的版本标记为
1.0 正式发布。

参考：Chrome [跨域请求](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)、
[Service Worker 生命周期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)、
[用户数据政策](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)、
[披露要求](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements)和
[MV3 要求](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)。
