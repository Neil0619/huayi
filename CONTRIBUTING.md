# 贡献指南

## 工作方式

1. 先阅读根目录及目标模块的 `AGENTS.md` 和对应设计/实施计划。
2. 行为修改先写失败测试，确认失败原因正确后再实现。
3. 只通过 `@huayi/protocol` 公共导出连接 extension 与 native host，禁止跨包深层导入。
4. 协议、权限、安全或安装行为变化必须同步更新对应中文文档。
5. 默认测试不得访问 OpenAI、真实 Codex、真实欧路 API 或真实 macOS 钥匙串；注入 fake App
   Server、process runner、authorization reader 和 fetch。
6. 根包、三个 workspace 包、扩展 Manifest、Host health、App Server `clientInfo.version` 和
   欧路 `User-Agent` 必须同步；版本一致性测试必须直接覆盖每个运行时身份源。
7. 当前协议为 `schemaVersion: 2`，运行时拒绝 v1；Extension 与 Host 必须同步升级或回滚。
   删除、重命名或语义不兼容变化必须再次提升版本并附迁移说明。
8. 手写文件在超过 400 行前拆分；不要新增权限、存储、秘密或无说明的生产依赖。
9. Provider 私有 JSON Schema 只描述模型内容，不得包含 `sourceText`、`selectionKind` 或公共
   `type`；这些字段由 Host 从可信请求注入并在组装后校验。
10. Warmup 不得携带网页数据、创建 thread/turn 或产生模型输出。增量和结构化板块只是预览，
    只有 `result` 是完整成功；空词汇板块必须隐藏，禁止用虚构内容补齐。
11. Provider 校验的 stderr 只允许有界安全阶段和字段名；启动与协议诊断使用固定安全消息。
    任何 stderr 都不得记录网页、模型、原始 JSON、凭据或环境内容。

## 提交前检查

```bash
pnpm check:instructions
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
git diff --check
```

上述门禁必须保持离线。`pnpm smoke:codex` 是唯一允许调用真实模型的命令，不属于默认门禁，
只能在用户明确批准真实模型与额度使用后单独执行。本机安装、Chrome 操作、欧路配置、移除和
真实欧路验收同样必须由用户显式批准或执行。

```bash
pnpm host:eudic:configure -- --dry-run
pnpm host:eudic:remove -- --dry-run
```

提交信息使用 Conventional Commits，例如 `feat(extension): add selection overlay`。

v0.4.0 的同步升级和回滚使用扩展 ID `kfkamoejomjdihipgdkmfjcdenlhgnpd`，并保留钥匙串
service `com.huayi.codex_bridge.eudic`、account `authorization` 与既有 Huayi 安装路径；具体
命令只以 [macOS 安装说明](docs/setup-macos.md) 为准。
