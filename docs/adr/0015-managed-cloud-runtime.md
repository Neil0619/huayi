---
status: accepted
---

# 云端运行时使用 Supabase 与两个独立 Vercel 项目

Cloud V1 在现有 pnpm/TypeScript monorepo 中使用 Supabase Auth/Postgres，并把 React/Vite Web 与
Hono API 部署为两个独立 Vercel 项目。相较一体化全栈框架或自运维数据库，这一选择让 Web、
Extension 和未来 App 共用明确的版本化接口，并以托管身份、Postgres/RLS 和较低运维负担换取供应商
锁定。生产区域默认新加坡，但上线前必须通过目标用户网络和 OAuth 可达性验证。

## Consequences

Web 不直接读写业务表，API 是业务授权、配额和事务入口；RLS 只作纵深防御。数据库迁移通过受控
部署步骤执行，不能在请求启动时自动运行。未来更换 Web 托管不改变 API 契约，更换 Supabase 则必须
迁移 Auth 身份、Postgres 数据和服务端会话。
