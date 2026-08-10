# v0.13.0 标准设置与站点策略实施计划

1. 用协议失败测试固定 wire v7 的设置状态、Provider 切换、严格字段和 Windows 拒绝语义，并同步
   升级全仓 release identity 与 schemaVersion。
2. 建立纯 Extension 设置领域模块，集中默认值、严格解析、hostname 规范化、最具体规则匹配和
   fail-closed 决策；通过一个 storage adapter 原子读写并广播更新。
3. 将内容脚本接到设置领域模块：总开关/站点策略、直达默认动作、生词本依赖，以及存储变化后的
   即时重建；扇贝同步控制器保持豁免。
4. 将每日同步 alarm 改为可配置小时与可禁用状态，保留手动同步入口；让工具栏图标改为 Popup，
   不再直接触发同步。
5. 为 YouTube 控制器注入默认双语和快捷键开关，保证新视频 generation 的默认状态、按钮路径和
   关闭快捷键时不截获 Shift+Z。
6. 在 Host 建立安全配置控制模块，复用 Provider store 与凭据/Compatible 配置读取器，返回有界
   本地状态并只允许选择 ready Provider；Windows 固定 DeepSeek。
7. 使用原生 DOM/CSS 实现完整 Options 与紧凑 Popup，采用暖纸、深墨、陶土强调的编辑词典视觉；
   添加键盘焦点、窄屏、错误、禁用、加载和保存状态测试。
8. 更新协议、安全、测试、macOS/Windows 安装、跨平台交接、README、项目状态与各层 instructions；
   禁止真实模型、真实 API 或计费 smoke 进入默认验证。
9. 依次运行聚焦测试、format、lint、typecheck、全量 unit、E2E、build、instructions、macOS 和
   Windows 离线验证；检查 diff 与产物不含 Secret、URL 历史或 `dist` 提交。
10. 经已授权的 macOS 实机流程同步安装 v0.13.0 Host、刷新扩展并人工走查关键路径；提交到
    `codex/settings-configuration` 并推送 origin，交付 Windows Node 26+ 验证命令与预期结果。
