# 贡献指南

## 工作方式

1. 先阅读根目录及目标模块的 `AGENTS.md` 和对应设计/实施计划。
2. 行为修改先写失败测试，确认失败原因正确后再实现。
3. 只通过 `@huayi/protocol` 公共导出连接 extension 与 native host，禁止跨包深层导入。
4. 协议、权限、安全或安装行为变化必须同步更新对应中文文档。
5. 默认测试不得访问 OpenAI、真实 Codex、真实欧路 API 或真实 macOS 钥匙串；注入 fake App
   Server、process runner、Keychain reader 和 fetch。真实 `smoke:codex` /
   `smoke:compatible` / `smoke:compare` / `smoke:deepseek` 均需用户单独知情授权；Compatible
   授权必须明确覆盖凭据
   与页面数据的明文传输和第三方费用。
6. 根包、三个 workspace 包、扩展 Manifest、Host health、App Server `clientInfo.version` 和
   欧路 `User-Agent` 必须同步；版本一致性测试必须直接覆盖每个运行时身份源。
7. 当前协议为 `schemaVersion: 5`，运行时拒绝 v4；Extension 与 Host 必须同步升级或回滚。
   删除、重命名或语义不兼容变化必须再次提升版本并附迁移说明。
8. 手写文件在超过 400 行前拆分；不要新增权限、存储、秘密或无说明的生产依赖。
9. Provider 私有 JSON Schema 只描述模型内容，不得包含 `sourceText`、`selectionKind` 或公共
   `type`；这些字段由 Host 从可信请求注入并在组装后校验。
10. Warmup 不得携带网页数据、创建 thread/turn 或产生模型输出。增量和结构化板块只是预览，
    只有 `result` 是完整成功；空词汇板块必须隐藏，禁止用虚构内容补齐。
11. Provider 校验的 stderr 只允许有界安全阶段和字段名；启动与协议诊断使用固定安全消息。
    任何 stderr 都不得记录网页、模型、原始 JSON、凭据或环境内容。
12. Provider 配置缺失时默认 Codex，其余无效状态失败关闭；请求开始时只读取一次配置并固定
    路由，API 失败不得自动回退 Codex。
13. OpenAI 生产配置固定为 Responses endpoint、`gpt-5.6-luna`、`none` effort、严格 SSE 与
    Schema；Key 只从固定 macOS 钥匙串项读取。自动测试必须使用 fake fetch/Keychain。
14. 扩展流式 DOM 更新按帧批处理，并复用 `data-huayi-section` 键控节点；测试应观察稳定行为，
    不依赖恰好在某个毫秒捕获瞬时帧。
15. Compatible Provider 使用独立 `compatible-http.json` 和专用钥匙串项；HTTP 必须显式确认，
    不得读取 Codex 配置或官方 OpenAI Key。配置、真实 smoke 和 Provider 切换是三个独立动作。
16. Compatible 默认测试只使用 fake fetch/Keychain，专用 SSE 方言之外的未知、重复、迟到、
    tool、refusal 或生命周期不匹配事件全部失败关闭。
17. DeepSeek 固定使用官方 HTTPS Chat Completions、`deepseek-v4-flash`、非思考 JSON Output 和
    独立钥匙串项；默认测试只使用 fake fetch/Keychain。配置、真实 smoke 与 Provider 切换是
    三个独立动作，禁止自动重试或回退。
18. Windows 模型运行时固定为 DeepSeek-only，不得解析 Codex 或启用 OpenAI、Compatible；欧路
    作为独立生词本能力受支持。DeepSeek Key 与欧路授权分别保存在当前用户、当前机器可解密的
    DPAPI 凭据文件中。Windows 安装、卸载、注册表或凭据行为变化必须同步更新
    `docs/setup-windows.md` 和安全文档。
19. 每项任务先按 `shared | macOS | Windows` 声明影响范围，并按
    [跨平台开发规则](docs/cross-platform-development.md) 选择自动门禁和目标平台人工验收。fake
    测试不能替代真实 Keychain、DPAPI、注册表、SEA 或 Chrome Native Messaging 验证。

## 提交前检查

在 macOS 执行 `pnpm verify:macos`；在 Windows Node.js 26 环境执行
`pnpm verify:windows`。共享改动必须等待 GitHub Actions 的 `macos-quality` 和
`windows-quality` 都通过。目标平台不可用时，状态只能写成
“implemented; target-platform validation pending”，并给出交接命令、预期结果和剩余风险。

上述门禁必须保持离线。`pnpm smoke:codex`、`pnpm smoke:compatible`、
`pnpm smoke:compare` 与 `pnpm smoke:deepseek` 不属于默认门禁，只能在
用户明确批准真实模型、ChatGPT/Codex 额度和对应 API 费用后单独执行；Compatible 还必须单独
批准凭据/页面数据的明文传输和第三方计费。本机安装、Provider 切换、Chrome 操作、钥匙串
配置/移除和真实欧路验收同样必须由用户显式批准或执行。

```bash
pnpm host:eudic:configure -- --dry-run
pnpm host:eudic:remove -- --dry-run
```

提交信息使用 Conventional Commits，例如 `feat(extension): add selection overlay`。

v0.10.0 的同步升级和回滚使用扩展 ID `kfkamoejomjdihipgdkmfjcdenlhgnpd`。macOS 保留欧路、官方
OpenAI、Compatible 与 DeepSeek 四个精确钥匙串项、两份 Provider 配置和既有 Huayi 安装路径；
具体命令只以
[macOS 安装说明](docs/setup-macos.md) 为准；Windows 从源码安装以
[Windows 安装说明](docs/setup-windows.md) 为准。
