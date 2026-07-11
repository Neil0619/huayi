# 贡献指南

## 工作方式

1. 先阅读根目录及目标模块的 `AGENTS.md`。
2. 行为修改先写失败测试，确认失败原因正确后再实现。
3. 只通过公共协议连接 extension 与 native host。
4. 协议、权限、安全或安装行为变化必须同步更新对应文档。
5. 默认测试不得调用真实 Codex、真实欧路 API 或真实 macOS 钥匙串；欧路测试必须注入 fake
   authorization reader、fake fetch 和 fake process runner。
6. 根包、三个 workspace 包和扩展 Manifest 的发布版本必须同步；版本一致性由仓库测试校验。
7. 欧路协议、安全边界或安装生命周期变化时，同步更新对应中文文档。

## 提交前检查

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm build
git diff --check
```

本机欧路配置和清理由显式命令完成，不应在自动测试中调用：

```bash
pnpm host:eudic:configure -- --dry-run
pnpm host:eudic:remove -- --dry-run
```

提交信息使用 Conventional Commits，例如 `feat(extension): add selection overlay`。
