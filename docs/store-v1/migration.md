# Classic Edition 到 Store Edition 的升级边界

> Store 1.0 不提供 Classic 设置包导入、旧密码或恢复码迁移界面。两个版本使用不同扩展身份与
> 存储空间；用户在 Store 中重新配置所需功能。

## 产品关系

Classic 0.13 与 Store 1.0 使用不同扩展 ID、存储命名空间和发布生命周期。Store 不读取 Classic
的 Chrome storage、Native Host manifest、Keychain、DPAPI 文件或 Host 状态，也不会修改或卸载
Classic。两个版本可以并存，用户完成 Store 主流程核对后再自行决定是否卸载 Classic。

Classic 维护线只接受严重安全或 Chrome/Provider 兼容性修复，不再新增 Provider、同步行为或
Store 功能。封存标签和维护分支属于单独的 Git 发布操作。

## 重新配置与学习数据

- Store 中重新选择全局开关、默认动作、站点策略、YouTube 偏好和词卡皮肤。
- 重新输入 OpenAI、DeepSeek 与欧路凭据；Store 不自动读取或迁移 Classic 凭据。
- 既有欧路词汇可通过 Store 的一次性 EudicImportJob 导入本地生词本。
- Classic 中尚未人工确认的扇贝批次需在 Classic 完成或明确放弃，内部队列不会搬运。
- 早期 Store 候选遗留的密码 wrapper 会被识别并失败关闭，避免把密文误当空数据；当前产品不再
  提供解锁或迁移入口。需要继续使用当前 Store 版本时，应清除扩展数据并重新配置。

## 用户步骤

1. 在 Classic 中完成或放弃未决扇贝批次，并保留仍需核对的数据。
2. 安装 Store Edition；DeviceVault 自动初始化，重新输入凭据并完成联网披露。
3. 按需运行一次性欧路导入，核对数量、来源上限和抽样词条。
4. 重新设置网站、YouTube 和词卡皮肤偏好。
5. 验证网页、YouTube、本地保存及所需导出目标后，自行决定是否卸载 Classic。

任一步失败都不会修改 Classic 数据。Store 不提供账户或云端恢复，也不会自动删除任何第三方副本。
