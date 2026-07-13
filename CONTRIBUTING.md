# 贡献指南

## 工作方式

1. 先阅读根目录及目标模块的 `AGENTS.md` 和对应设计/实施计划。
2. 行为修改先写失败测试，确认失败原因正确后再实现。
3. 只通过 `@huayi/protocol` 公共导出连接 extension 与 native host，禁止跨包深层导入。
4. 协议、权限、安全或安装行为变化必须同步更新对应中文文档。
5. 默认测试不得访问 OpenAI、真实 Codex、真实欧路 API 或真实 macOS 钥匙串；注入 fake App
   Server、process runner、authorization reader 和 fetch。
6. 根包、三个 workspace 包、扩展 Manifest、Host 版本和 User-Agent 必须同步。
7. 当前协议为 `schemaVersion: 2`；删除、重命名或语义不兼容变化必须再次提升版本并附迁移
   说明。
8. 手写文件在超过 400 行前拆分；不要新增权限、存储、秘密或无说明的生产依赖。

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

`pnpm smoke:codex` 是唯一允许调用真实模型的命令，不属于默认门禁，也不要在自动测试中调用。
本机欧路配置、移除和真实欧路验收同样必须由用户显式执行。

```bash
pnpm host:eudic:configure -- --dry-run
pnpm host:eudic:remove -- --dry-run
```

提交信息使用 Conventional Commits，例如 `feat(extension): add selection overlay`。
