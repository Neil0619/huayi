# AnalysisHistory 生产入口验收方案

## 1. 状态与问题

影响平台为 `shared`。截至 2026-08-14，AnalysisHistory 已有 strict 公共契约、独立签名 cursor、
owner-scoped API/Postgres 事务、Web adapter 与完整 React 组件回归；production `/history` 入口也已接线。
现有分层证据不能单独证明实际 Web bundle 会组合 Cookie/Origin/CSRF、revision、幂等写入、筛选状态和
写后服务器重读。

本切片补齐生产入口的离线组合层，不修改生产 contract、SQL、API 或页面行为。2026-08-14 已完成
RED→GREEN 与实现后复审，状态为 `implemented; target-platform validation pending`。

## 2. 用户需求与不变量

已登录用户必须能够：

1. 从 `/history` 用字面搜索、归档、整理状态、来源与选区条件读取服务器历史；
2. 打开 linked StudyCapture 产生的 pendingReview passage，查看完整原文、结构化结果、候选和公开模型
   元数据，详情标题获得焦点；
3. 执行“无需收藏，标记已整理”，服务器 revision 前进且记录仍未归档；
4. 归档 reviewed 记录，归档不能把它改回 pendingReview；再从同一服务器权威恢复；
5. 经第二次确认删除分析；linked StudyCapture 默认勾选一并删除，确认按钮获得焦点；
6. 删除成功后服务器重读为空；已复制到 LearningItem 的 SourceExample 保留由 Postgres 层证明，本组合
   fixture 不伪造第二份学习库权威。

关键不变量是 `reviewState` 与 `archivedAt` 正交，且每个 mutation 使用上一轮服务器返回的 revision；页面
不得通过本地乐观改写冒充成功。

不在本切片内：真实 DeepSeek、真实 Supabase/Vercel、HMAC cursor 算法或 RLS 再实现、跨账号攻击矩阵、
真实身份和部署浏览器。它们已有其他测试层或必须在目标环境验证。

## 3. 技术路线与数据结构

### 3.1 组合 seam

- Playwright 加载实际 Web production bundle，并从 `/history` 进入生产 route/parser/adapter/page；
- 新增独立 `CloudBrowserAnalysisHistoryAuthority`，按专用 seed 组合进主 authority；
- helper 只处理 history list/detail/process/archive/restore/delete，并复用主 authority 的认证、CORS、CSRF、
  `Idempotency-Key` 和 quoted `If-Match`；
- 所有 query、body 与响应都通过 `@huayi/cloud-contracts` strict schema；错误统一走脱敏 error helper；
- 独立 helper 不扩张已超过单一职责的主 authority，也不影响现有分析 streaming/ReviewInbox journey。

### 3.2 fixture 与状态机

初始数据：

- 一个 `AnalysisRecord`：passage、pendingReview、未归档、source type 为 `study-capture`、revision 1；
- 一个关联 StudyCapture 聚合计数；
- 完整 passage result、一个 Expression candidate 与公开 DeepSeek metadata；
- 私密测试正文只存在 helper 内存响应，不进入公开 snapshot。

状态转换固定为：

```text
pendingReview + unarchived + revision 1 + capture present
  -> process nothing-to-save
reviewed + unarchived + revision 2
  -> archive
reviewed + archived + revision 3
  -> restore
reviewed + unarchived + revision 4
  -> delete(deleteStudyCapture=true)
analysis absent + capture absent
```

每个 operation 以 `(path, idempotency key, body hash)` 保存 response snapshot；same-key/same-body 重放原
响应，same-key/different-body 冲突。公开 snapshot 只汇总 analysis/capture 数量与脱敏 request facts。

## 4. TDD 与测试矩阵

### 4.1 已有分层证据

- contracts：五类筛选、fixed routes、strict process/archive/restore/delete body 与 response；
- cursor/API/Postgres：默认/归档筛选、字面 ILIKE 转义、稳定 keyset、签名篡改与跨资源拒绝、同事务
  detail、revision/幂等 replay/conflict、owner/RLS、删除后 LearningItem/SourceExample 保留；
- Web adapter/component：真实 query shape、完整纯文本结构化详情、分页、焦点、pending mutation 去重、
  nothing-to-save、archive/restore、linked capture 默认删除、两步确认、写入成功/刷新失败分离，以及
  list/detail/action 迟到抑制。

本切片只补 actual-bundle 组合证据，不复制上述数据库或组件断言。

### 4.2 新增 actual-bundle RED→GREEN

1. RED：新增 `/history` journey，先使用现有 `empty` seed，预期在筛选后的唯一记录处失败；
2. GREEN：新增专用 strict helper/seed，并在主 authority 认证后、通用 analyses handler 前接线；
3. 应用 `query=frank`、`sourceType=study-capture`、`selectionKind=passage`，打开唯一记录；
4. 断言详情焦点、原文、结果、候选和公开模型 metadata；
5. 依次 process、archive、restore，每步等待状态提示和服务器重读，断言 reviewed/archived 正交；
6. 点击删除，断言 linked StudyCapture checkbox 默认选中、确认按钮聚焦、DELETE 为 `write-valid`；
7. 删除后断言筛选空态、analysis/capture count 为 0，四个 mutation request facts 均为有效 Web 写；
8. 390px/reduced-motion 下详情与空态无横向溢出，Web Storage 为空；删除后 DOM 与公开 snapshot 不含
   fixture 正文、结果或幂等键。

## 5. 验收标准

- focused journey 1/1，完整离线 Playwright 从 97/97 更新为 98/98；
- `apps/web` strict E2E typecheck、目标 ESLint/Prettier、workspace tests、instructions/architecture 通过；
- list/detail 为 `read`，process/archive/restore/delete 均为 authenticated Web `write-valid`；
- revision 依次为 1→2→3→4，任一旧 revision、错误 proof、未知字段或非法状态失败关闭；
- 删除后 analysis/capture 聚合均为 0，公开 snapshot 和 post-delete DOM 无正文/结果/token/key；
- 文档、实现计划、测试矩阵、路由覆盖矩阵、项目状态和变更记录同步；
- 真实模型、数据库、身份、部署与目标平台仍标记 `target-platform validation pending`。

## 6. 实现前审查

审查结论：路线合理，可以进入 TDD。现有生产行为完整且各层契约一致；新增生产接口或重新实现 SQL 会
扩大风险。专用 stateful helper 能以最小测试接线验证四次真实 adapter mutation、revision 链与 linked
capture 删除，同时明确不冒充 Postgres/RLS 或真实部署证据。

## 7. 实现与复审记录

- RED 如预期在筛选后的唯一记录失败，旧 `empty` authority 未伪造 history 维护能力；
- 新增 205 行独立 strict helper 与专用 seed；生产页面、adapter、contracts、API 和 SQL 零改动；
- actual bundle 已通过 query/source/selection 筛选、完整详情/焦点、revision 1→2→3→4、
  process→archive→restore 正交状态，以及默认 linked StudyCapture 两步删除；
- list/detail 为 `read`，四个 mutation 都是 authenticated Web `write-valid`；删除后 analysis/capture 聚合
  同时归零，post-delete DOM 与公开 snapshot 无正文或结果；
- focused 1/1、Web strict typecheck、目标 ESLint/Prettier 和完整 Playwright 98/98 通过；390px、
  reduced-motion、无横向溢出与空 Web Storage 同时通过；
- 实现后复审只收紧了重复结构化文本的 Playwright locator，未发现生产行为问题。

真实 Postgres/RLS、多连接数据库、身份、DeepSeek、部署浏览器和目标平台验证仍未执行，不能由离线
98/98 证据替代。
