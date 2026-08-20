# Phase 45：Vercel Fluid Compute 与 API Function 时长契约

## 1. 目标与范围

影响平台为 `shared + macOS`；Windows 支持保留并进入下一冻结候选批次。本阶段只把 Cloud API 已有的
Vercel 运行时假设变成仓库内可审计配置，不创建项目、不部署、不读取或写入 Vercel 账号，也不处理
邮件、域名、DNS、Resend、Provider smoke、安装或 Chrome。

Phase 38 根据当时的 legacy Function 口径，把 Hobby 60 秒与 DeepSeek 90 秒应用 deadline 记录为部署
阻塞。Vercel 当前的权威时长文档区分两种执行模型：启用 Fluid Compute 时，Hobby Function 默认和最大
时长均为 300 秒；未启用 Fluid 时仍是默认 10 秒、最大 60 秒。新项目从 2025-04-23 起默认启用 Fluid，
但旧项目、导入项目和 Dashboard 状态不能由源码假定。

因此 `apps/api/vercel.json` 必须显式声明：

- `fluid: true`，让新旧项目使用同一受版本控制的执行模型；
- 唯一 Hono 入口 `src/server.ts` 的 `maxDuration: 120`；
- 不恢复 Vercel Cron；四个分钟 worker 仍由 production Supabase Cron 触发。

当前状态为
`runtime configuration implemented and verified on macOS; real deployment and Windows batch pending`，
不是“正式部署已完成”。

## 2. 时长预算

四条生产 DeepSeek adapter 的应用 deadline 上限均为 90 秒。analysis、ExtensionQuery 和 practice 最多可
发起一次结构修复调用，但首次调用和修复调用共用同一个 `AbortController` 与 90 秒 timer；duplicate
suggestion 只有一次调用。因此 90 秒是一次 API 生成操作的总 Provider 等待预算，不是每次调用各 90 秒。

Vercel `maxDuration` 固定为 120 秒：

1. 前 90 秒由应用自身 deadline 限制 Provider 首次调用与可选结构修复的总时间；
2. 额外 30 秒只为请求解析、数据库 durable dispatch、账本/业务终态写入和响应收尾留余量；
3. 平台上限不是新的业务 deadline。应用仍须在 90 秒处 abort，不得因为 Fluid 可运行 300 秒而延长模型
   调用、自动重试或改变费用结算；
4. 120 秒也不是可用性保证。真实网络、区域、冷启动、数据库和平台终止仍须在部署任务观察。

analysis 的 4 分钟 generation lease 与 5 分钟 quota reservation 是崩溃恢复/fencing 窗口，不是单次
Function 可以占用的执行时间。Function 被平台终止时，既有 pre-dispatch release、post-dispatch 保守
结算与后续 cleanup 规则继续负责恢复，不能靠延长 Function 取代 durable 状态机。

Supabase `pg_net` 的 55 秒 timeout 保持不变。四个定时 route 是有界 worker/cleanup，不执行上述
DeepSeek 生成；55 秒是调度请求自身的故障隔离上限，不再表述为“为 legacy 60 秒 Vercel 上限留 5 秒”。

## 3. 配置优先级与失败边界

Vercel 的当前配置优先级为函数源码、`vercel.json`、Dashboard、Fluid 默认值。语见不在 Hono 业务代码中
再导出另一份时长常量，而由 API 项目根 `vercel.json` 对唯一入口集中声明，避免源码与部署文件竞争。

离线测试必须解析真实 JSON 并证明：

- `fluid` 精确为 `true`；
- `functions` 精确匹配 `src/server.ts`，其 `maxDuration` 精确为 `120`；
- 没有 `crons`，也没有宽泛 glob、第二个 Function 覆盖或 legacy `builds`；
- 四个 production internal route 仍由 composition 测试覆盖，调度迁移不回退。

测试只证明仓库配置。Vercel Dashboard、部署生成的 Function、实际执行模型和 Observability 不得由静态
JSON 冒充。

## 4. Docs-first、TDD 与验收

1. 先同步本方案、architecture/security/operations/testing、Phase 38 历史口径、计划、审计、检查表、
   证据和项目状态；历史记录保留并标明由 Phase 45 取代；
2. 文档自审确认 90 秒是共享 timer 的总预算、120 秒不改变公开 API/账本/lease、55 秒 Cron timeout
   仍独立有效；
3. Fresh RED 在实现前仅含 `$schema` 的 `apps/api/vercel.json` 上证明缺少 `fluid` 和 Function 时长；
4. 最小 GREEN 只修改该 JSON，不增加依赖、不改 Provider timeout 或业务代码；
5. 运行 focused/API full、strict typecheck/build、目标 lint/format、instructions/architecture、完整离线门与
   `pnpm verify:macos`；Windows 保持 batch pending。

真实部署任务另行完成：部署后在 Vercel Settings/Functions 与生成产物确认 Fluid 已启用、入口上限为
120 秒，并在 Observability 检查正常、90 秒应用 abort、平台终止和数据库恢复。该任务需要用户账号、
云资源和单独授权，本阶段不执行。

实现证据：Fresh RED 为 `production-app.test.ts` 2 个预期失败 / 3 个基线通过，分别证明缺少 `fluid` 和
入口 `functions`；最小 JSON 修改后，配置测试与四条 DeepSeek deadline 基线为 5 files / 25 tests，API
full 为 111 files / 415 tests。最终 `pnpm verify:macos` 退出 0，覆盖 121/121 Node 脚本、447 个 Vitest
文件（2,757 passed / 12 skipped）、Store coverage 97 files / 481 tests、Playwright 110/110、全 workspace
format/lint/typecheck/build、instructions/architecture、发布审计、production audit 与 diff check。

## 5. 官方依据（2026-08-21 核验）

- [Vercel Functions duration](https://vercel.com/docs/functions/configuring-functions/duration)
- [Vercel Fluid Compute](https://vercel.com/docs/fluid-compute)
- [Vercel project configuration](https://vercel.com/docs/project-configuration/vercel-json)
- [Fluid Compute became the default for new projects](https://vercel.com/changelog/fluid-compute-is-now-the-default-for-new-projects)
