# 贡献指南

## 工作方式

1. 先阅读根目录及目标模块的 `AGENTS.md`。
2. 行为修改先写失败测试，确认失败原因正确后再实现。
3. 只通过公共协议连接 extension 与 native host。
4. 协议、权限、安全或安装行为变化必须同步更新对应文档。
5. 默认测试不得调用真实 Codex；真实验证只使用 `pnpm smoke:codex`。

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

提交信息使用 Conventional Commits，例如 `feat(extension): add selection overlay`。
