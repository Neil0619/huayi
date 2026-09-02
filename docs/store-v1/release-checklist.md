# Huayi Store 1.0 发布清单

所有项目必须有同一候选提交产生的新鲜证据。任何一项未完成时状态都是
`implemented; target-platform validation pending`，不得公开上架。

macOS 当前候选的逐项实机证据和阻塞记录见
[macOS 验收记录](./macos-acceptance-notes.md)。该记录来自脏工作树，只用于收敛缺陷，不能替代
最终候选提交的新鲜证据。

## 当前发布阻塞项

- OpenAI `gpt-5.6-luna`、DeepSeek `deepseek-v4-flash` 仍是候选模型，尚无本轮真实双平台证据。
- 尚未分配新 Store Extension ID，未提供公开隐私政策 HTTPS 地址、128×128 商店图标、截图和
  最终支持信息。
- macOS、Windows 的真实 Chrome、Provider、欧路、扇贝、升级与卸载证据尚未完成。
- 本地脱敏 DiagnosticEvent 与用户主动“反馈问题”入口尚未实现；默认远程错误遥测仍禁止。未来若
  增加自动上报，必须先具备接收后端、保留/删除机制、隐私披露和单独明确同意。

Store 不提供 Classic 设置包或旧密码库迁移 UI；旧候选数据只做失败关闭识别。Store 生产 imports
已转为 `zod/v3` 兼容子路径，Provider JSON
Schema 改为随包静态定义；不放宽的严格发布审计已能通过实际 Store dist，但每个候选
提交仍必须重新生成证据。

## 自动门

在干净安装依赖后依次执行：

```text
pnpm check:instructions
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:store:coverage
pnpm check:architecture
pnpm build
pnpm test:e2e
pnpm check:store-release
pnpm audit:prod
git diff --check
```

`test:store:coverage` 对 DeviceVault、Provider、设置迁移、生词仓储和 Outbox 等关键实现文件执行 V8
覆盖率，statements、branches、functions、lines 的聚合阈值均为 85%。`check:architecture` 检查
Classic/Store 包边界、公开包导入、Store domain 平台中立性、Store 生产循环和 400 行上限。
`check:store-release` 只接受审定文件集和 Manifest，拒绝额外文件、Classic 标记、权限或固定 host
漂移；JavaScript 禁止 `eval`、`Function` 构造器、`importScripts` 和任何动态 `import()`，HTML
禁止内联可执行脚本和 `on*` 事件处理器，只允许引用包内文件的 `<script src>`。审计基于 JS 语法树
和 HTML 标签/属性，不会把注释、字符串、数据属性或 `application/json` 数据块误判为代码。
`audit:prod` 只查询生产依赖安全公告，不运行产品网络代码。

GitHub `main` 分支保护必须要求以下两个 workflow job；UI 显示名通常为
`Cross-platform quality / macos-quality` 和 `Cross-platform quality / windows-quality`：

- `macos-quality`
- `windows-quality`

两个 job 都安装 Chrome 并运行全部上述门。Windows 随后额外打包、探测 SEA；这只验证 Classic
封存构建，不把 Native Host 带入 Store 包。Actions 均固定完整提交 SHA，注释保留 `v6`；2026-08-11
通过三个官方 GitHub 仓库的 tag refs 核验，其中 pnpm annotated tag 使用 peeled commit。

## 商店材料

- [ ] 把[隐私政策](./privacy-policy.md)发布到固定、无需登录的 HTTPS 地址并填写到清单。
- [ ] 复核[商店文案和数据披露](./store-listing.md)，逐项保存问卷截图。
- [ ] 上传原创 128×128 图标、至少一张真实产品截图和不造成第三方官方归属误解的宣传素材。
- [ ] 权限理由与实际 Manifest、首次运行披露完全一致。
- [ ] 支持地址可访问；第三方非隶属声明可见。
- [ ] 解压候选 ZIP，确认 `pnpm check:store-release` 审定的 11 个文件之外没有任何内容。

## 双平台手工检查（需要逐项批准）

在 macOS 与 Windows 的当前稳定 Chrome 上分别使用新用户配置文件：

- [ ] 从候选 ZIP 干净安装；记录 Chrome 版本、OS 版本、Store ID、候选提交和时间。
- [ ] 干净安装无需密码直接可用；构造旧候选 wrapper 时必须失败关闭并提示清除扩展数据，页面不得
      出现密码、恢复码或迁移表单。
- [ ] 在普通网页验证单词、短语、句子的翻译/解释、取消、错误、手动重试、站点关闭和本地保存。
- [ ] 在 Options 逐一选择去青月白、流银镜白、香槟晨霜、霁蓝瓷光，确认默认流银镜白、刷新后
      当前设备持久化、Popup 继承且没有第二个选择器；写入失败只提示本次有效且不改写 Settings v6。
- [ ] 四套外观分别验证 Popup、Options、普通网页词卡、YouTube 和扇贝提示；打开词卡原位换肤时
      不关闭、不丢失流式内容或输入。`pearl | parchment` 在每套外观中只改变词卡材质。
- [ ] 分别用固定 OpenAI/DeepSeek 模型验证流式成功、鉴权失败、限流/配额和取消；确认不自动回退。
- [ ] 验证欧路一次性导入、0–50 页上限、查重导出、撤回同意和本地删除不删远端。
- [ ] 验证扇贝预填、人工最终点击、部分成功和重试；确认扩展从不自动点击提交。
- [ ] 在 YouTube 录播验证英文/双语、切轨、SPA 导航、字幕选择、保存和离开 `/watch` 后清理。
- [ ] 从前一 Store 候选升级，验证设置 v1→v2→v3→v4→v5→v6、加密记录和 Outbox；禁用、重载、升级后
      DeviceVault 直接可用；旧 v4 Content Script 只显示刷新提示，重新加载后使用消息 v5。
- [ ] Classic 与 Store 并存时确认 Store 不读取或修改 Classic storage、Native Host 与平台凭据；
      在 Store 中重新配置站点、YouTube、词卡皮肤和凭据。
- [ ] 验证一词一行 UTF-8 词表导出、卸载及本地/第三方删除边界；确认界面不再提供加密备份、
      恢复或明文 JSON，并明确词表不能完整恢复语境数据。

真实密钥、页面文本和模型正文不得进入验收记录。只记录用例、固定错误码、计数、版本和结论。

## 提交与回滚

- [ ] 先上传 Chrome Web Store 草稿，处理远程代码、权限和数据披露警告，不执行最终公开按钮。
- [ ] 记录审核反馈及修复提交；任何代码变化都重跑全部自动门和受影响手工检查。
- [ ] Classic 与 Store 使用不同 ID 且可并存。主流程核对前不卸载 Classic；Store 不读取或修改 Native Host。
- [ ] Store 候选失败时停用/撤回草稿；已经公开的缺陷通过更高补丁版本修复，不复用旧包或旧证据。
- [ ] 全部自动、材料和双平台手工项完成后，才单独批准最终公开操作。
