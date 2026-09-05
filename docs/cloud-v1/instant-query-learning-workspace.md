# 即时查询与学习工作台

2026-09-05，本地实现与离线验收。未提交、推送、部署、调用真实模型或执行数据库/调度变更。
本文更新 product.md、Phase 23 与 Phase 27 中的当前交互；原有账号、数据归属、额度与删除边界继续生效。

## 使用流程

```text
阅读查询 → 加入收集箱 → 用户开始深度分析 → 勾选表达/句型 → 加入学习库
                                                      ↓
今日总览 ← 反馈与自评 ← 提交自己的答案 ← 引导造句 / 自由造句 / 受约束对话
```

四个主入口是今日练习、收集箱、学习库、设置。`/analysis` 进入收集箱粘贴，`/history` 是收集箱内的
分析历史，`/words` 属于学习库，`/practice/history` 属于今日练习；旧路由仍可访问。

收集箱将 StudyCapture 与最新 AnalysisRecord 连续展示，底层仍分别持久化。只收集不调用模型；
“保存并开始分析”先保存当前原文、类型及可选信息，再提交任务。排队或生成中可切换条目、编辑、
离开；回来读取任务和已保存结果。候选勾选与编辑不会因切换条目消失，确认后提供立即练习和继续整理。

今日练习默认总览，列出学习项、今日进度和恢复入口。引导模式先建立可保存草稿的会话，再后台出题；
失败仍可重试、自由造句、换项、返回或结束。自由模式按 LearningItem 确定性生成任务说明，不调用
出题模型。答案提交后才请求反馈，完成后显示来源例句与自评；跳过或结束未完成内容不推进排期。
对话保留 1–3 项、3–5 轮、明确角色/结束条件，提供同一套暂停、草稿与后台反馈能力。

## Popup 与卡片生命周期

- Popup 本机外观、开关、设置入口各自加载；账号/待上传查询失败不禁用其他控件。外观更改本地立即
  保存并广播，无需清空后重读。账号摘要绑定 session，5 分钟 TTL，后台 singleflight 同步；关联、
  断开、换号、过期、明确 401 均更新或清除，token/revision fence 拒绝迟到响应。设备断开仍先撤销服务器。
- 鼠标划词不主动聚焦；键盘保持可见焦点。头部/底部不随正文滚动，正文限制高度；两列使用 minmax
  与英文换行。页面滚动重新定位，原选区离开视口后卡片停靠可见区域。
- 关闭、Esc、卡外点击只结束显示订阅；停止是独立按钮，并等待服务端确认。相同输入重开会加入原
  请求或读取完成缓存；模式分别计入身份，外观变化不计入。
- QueryResultCache 位于 Service Worker 管理的 TRUSTED_CONTEXTS session storage，最多 30 条、
  30 分钟、2 MiB，键包含身份、原文、必要上下文、选区类型、模式与配置版本的摘要。只有最终严格
  通过 Schema 的结果可入缓存；有界预览只供进行中订阅重放。
- 平台 QueryTaskJournal 只持久化身份摘要、请求键、任务 ID 和时间，SW 重启复用同一任务/提交键。
  未知派发结果不被当作失败自动重试；账号清理同步清除 journal 与缓存。Content Script 不可读取它们。
- 该缓存不是学习库或查询历史；服务器 ExtensionQueryGeneration 的既有最长一小时正文保留期不变。

## 执行与流式协议

Provider 固定 deepseek-v4-flash。`stream:true` 与 `include_usage:true`；即时查询、造句题目、对话开场/
回复使用 disabled thinking，句子/对话反馈使用 low thinking，深度分析与查重保留 high。
[DeepSeek 官方契约](https://api-docs.deepseek.com/api/create-chat-completion/) 支持这些参数。

Provider SSE 采用 fatal UTF-8 增量解码，处理拆分 Unicode/CRLF，限制帧及总字节、请求/模型/choice，
必须有 finish、usage 与 DONE。只读取允许的内容字段；reasoning 不发送客户端，原始 JSON 不进入 UI。
文本字段增量追加，列表只有完整有效条目才显示；最终 strict Schema 是成功依据。一次结构修复与
初次调用共享 90 秒 deadline 和费用上限，失败保留稳定错误与诊断 ID，不把预览当结果。

`ModelExecution` 传递 AbortSignal、beforeDispatch、onPreview、onSession 与 onTiming，费用仍由各领域
生成模块预留和结算。取消不抹去已发生费用；缺少确定 usage 的派发失败保持既有保守结算及对账规则。
旧 v1 SSE 保留兼容转换；`query.preview-v2` 与任务协议显式 version=2。

| 接口                                         | 行为                                                   |
| -------------------------------------------- | ------------------------------------------------------ |
| `POST /v2/learning-tasks`                    | Owner 身份+幂等键提交，202 返回任务与当前状态          |
| `GET /v2/learning-tasks`                     | 当前 owner 最近 100 条任务；插件只可访问即时查询       |
| `GET /v2/learning-tasks/:id`                 | 恢复任务快照，不触发生成                               |
| `GET /v2/learning-tasks/:id/events?cursor=N` | SSE 或 JSON；有序游标、有限连接、重连续读              |
| `POST /v2/learning-tasks/:id/cancel`         | 排队立即取消；执行中置 cancelling，由 worker 确认终态  |
| `GET /internal/learning-tasks/run`           | 既有 Cron Bearer 保护的独立 worker；每次领取一个任务   |
| `POST /v2/study-captures`                    | Web 保存原始采集，不自动分析                           |
| `GET /v2/practice-workspace[/:id]`           | 读取可恢复会话或指定会话                               |
| `POST /v2/practice-workspace/start`          | 引导/自由会话，均不在此接口调用模型                    |
| `POST /v2/practice-workspace/:id/draft`      | 独立 draftRevision CAS 保存                            |
| `POST /v2/practice-workspace/:id/control`    | 暂停、恢复、结束、跳过、自由模式；独立 controlRevision |

Web 写入沿用 Cookie、Origin/CSRF；Extension 使用有效 token 与版本检查，不能读取 Web 学习任务。
快照与事件都 no-store，未知字段/身份/乱序数据失败关闭。重连不会重新提交任务，订阅取消不隐式取消
worker。客户端对同一任务只接受单调游标，跳过已读事件，拒绝缺口和不同 taskId。

## 持久队列与故障恢复

`learning_tasks` 保存 command、owner、幂等键/hash、优先级、lease、dispatch、cursor、终态和耗时；
`learning_task_events` 保存有界可展示事件；`learning_task_submission_keys` 记录包括被合并点击在内的
所有提交身份。业务角色只有 owner 隔离的只读视图，写操作通过受限 definer 函数，表启用 forced RLS。

同 owner 同输入的 queued/running/cancelling/unknown 任务合并。每个请求键都绑定原任务，完成后的
网络重放仍返回同一任务；结果过期后保留 7 天无正文 tombstone，旧键被拒绝，不透明重启模型。
交互优先级 0、查重 10、深度分析 20；同账号单运行租约、既有单活跃费用预留保护不变。

claim 使用 SKIP LOCKED，lease 2 分钟；worker 心跳及每次 Provider dispatch 前重新验证租约。
queued 取消立即生效；running 先 cancelling，再尽力中止，完整已保存结果优先于同时到达的取消。
过期的未派发工作可重新领取；已经派发进入 unknown，禁止透明重试。

unknown 从既有业务权威对账：保存的 query/analysis 终态、查重回执、practice 幂等响应；已收费的
practice ready 输出通过原 complete 事务应用并更新原回执，恢复路径不包含 Provider 或新预留。
无法证明结果的任务继续显示诊断 ID，留待核对；不能把它改为 queued 来重新计费。

终态 query 任务/事件副本保留 30 分钟，其他终态任务副本 7 天；unknown 留到对账完成，但即时查询
超过原有一小时上限即清除任务正文、输出和事件，仅留无正文对账身份，排队过期不再调用模型。正式
AnalysisRecord、PracticeSession 等仍按既有用户数据保留策略，队列过期不删除业务结果。

pg_net 仅承担异步唤起；正式任务事实保存在普通 Postgres 表。其非持久请求队列不能作为业务权威，
参见 [Supabase 官方说明](https://supabase.com/docs/guides/database/extensions/pg_net)。每分钟 pg_cron
补偿遗漏唤起并回收过期工作；提交与任务完成均立即唤起一次，多个并发唤起由数据库租约裁决。

## 草稿与排期

PracticeSession 仍保存题目、作答、反馈、自评。workspace_state 保存 phase/mode/draft、draftRevision、
controlRevision。暂停/恢复不增加作答 revision，排队的已提交答案可在 paused 会话继续生成反馈；
ended/skipped 不接受新作答。换自由模式/结束/跳过增加作答版本，并取消对应旧任务。迟到题目只清理
旧生成关联，不能替换自由题目或草稿。

Web 每次输入先写 sessionStorage 缓冲，再以 250ms debounce 串行同步到服务器；缓冲限制 20 条、
每条 4000 字符、7 天。只有服务器成功读取同一会话后才可恢复本地缓冲，避免跨账号显示；页面刷新
默认仍显示总览。控制操作随请求提交当前草稿，不等待后台保存响应，模型结束也不能覆盖输入。

`practice_session_items.rated_at` 在首次自评时写入且保持不变，今日进度按用户时区统计；一次自评仍
使用原原子幂等排期事务。草稿同步、暂停或结束不改变自评日期。

## 离线验收和性能口径

批次依次完成 popup/浮层症状回归、模型/队列回归、收集箱/练习闭环。主要回归入口：

- `popup-responsive`、偏好刷新/撤销/迟到响应、query-cache、query-task-journal、overlay controller/stop；
- `deepseek-stream`、四类 Provider、learning-task-migration/streaming、practice-workspace；
- Web study-inbox、practice-workspace-page、practice/dialogue、duplicate maintenance、workspace-shell；
- Playwright `query-interaction.spec.ts`：真实浏览器控件、增量先于完成、长列、滚动停靠、关闭重开、
  主题切换、缓存模型调用数与本地延迟；
- Playwright `learning-workspace-journey.spec.ts`：实际 Web 构建离线 HTTP fixture，采集两条、离开后
  完成分析、选学习项、自由造句零出题调用、刷新草稿、反馈、自评一次、返回总览及 390px 视口。

本地门槛：已有本机状态的 popup 控件 <200ms、缓存命中到显示 <100ms、有效查询增量到呈现 <250ms。
这些浏览器测量是离线 fixture 的 UI/缓存开销，不是 Provider 性能。任务 timings 分别保留排队、
provider-first-token、first-display-field、generation-complete、repair-start/complete、saved；其中
provider-first-token 可包含未展示的 reasoning 首片段，first-display-field 才是可读内容。两者不混报。
页面用有界 Performance measures 记录 `seen-said:*:increment-to-paint`，不含正文、身份，也不自动遥测。

真实模型首字和完整时间 P50/P95 **尚未测量**。以后经单独授权，用请求诊断 ID 关联分阶段时序，
分别报告样本数、模式、成功/失败及缓存是否命中；不得将本地 fixture 数值代替真实模型时延。
截图中的具体 Provider 失败仍需请求级证据，本次不推断为某种已证实的模型错误。

## 交付依赖

以下仅生成文件，尚未执行：

1. API migration 0024 与对应 Supabase `20260905010000`：队列、事件、提交键、RLS、租约/取消/恢复函数。
2. API migration 0025 与对应 Supabase `20260905020000`：练习工作状态、占用索引、首次自评时间。
3. `apps/api/operations/configure-learning-task-scheduler.sql`：复用既有 Vault origin/Cron secret、
   pg_net 与 pg_cron 的唤起及补偿配置。与应用 build 分开，必须在迁移后经批准安装。

这次本地代码验收不等于 Hosted 已可使用新流程。后续 Web/API 发布沿用 Hosted 规则；Store 还需
macOS/Windows 的实际 Chrome 验收。不能将本机 jsdom、PGlite、Chrome 离线 fixture 当作远程部署、
真实模型或 Windows 完成证据。
