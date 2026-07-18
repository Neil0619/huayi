# v0.9.0 浮层视觉改造实施计划

1. 为词典头部、语境强调、结构化短语/辨析行、紧凑生词动作和面板状态属性添加失败测试。
2. 将 section 数据扩展为 text、context、pronunciation、list 和 entries 五种展示语义，保持
   `textContent`、键控节点和渐进数组项复用。
3. 把样式拆为设计令牌、基础浮层和分析内容三层，应用白色单层卡片、结构化布局和稳定流式
   最小高度；所有手写文件保持 400 行以内。
4. 更新生词可见标签为“生词/添加中/已加入”，保留完整 `aria-label`、禁用和错误行为。
5. 用 Playwright 覆盖翻译、解释两张 macOS Chrome 视觉基准及 320px 控件不重叠；人工检查
   实际 PNG 后更新快照。
6. 统一发布版本为 0.9.0，更新 README、架构、安全、测试、安装和各级指令；wire 继续为 v5。
7. 运行 format、lint、typecheck、全部单元测试、全部 E2E、build、指令检查和
   `git diff --check`，随后同步安装 Host、复制稳定扩展目录并在 Chrome 刷新验证 0.9.0。
