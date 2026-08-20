# PracticeHistory 生产入口验收方案

## 1. 状态与问题

影响平台为 `shared`。截至 2026-08-14，PracticeHistory 已有 strict 公共契约、owner-scoped API、
Postgres/PGlite 集成、Web adapter 和 React 组件测试；`/practice/history` 生产路由也已接线。现有证据能
分别证明资源边界和页面行为，但还不能证明实际 Web production bundle 会通过 Cookie/Origin/CSRF、
revision 与幂等写证明完成“筛选→详情→删除→服务器重读→返回今日练习”的组合闭环。

本切片补齐这一层离线浏览器证据，不修改生产契约、SQL、API 或页面产品行为。2026-08-14 已按本文
完成 RED→GREEN 与实现后复审，状态为 `implemented; target-platform validation pending`。

## 2. 用户需求与边界

已登录用户必须能够：

1. 在 `/practice/history` 按类型和状态读取自己的正式练习记录；
2. 打开一条 completed 受约束对话，查看角色、任务、完整轮次、总反馈、逐项反馈和自评；
3. 经第二次明确确认删除答案、对话与反馈；确认按钮出现后获得键盘焦点；
4. 删除成功后由服务器重读列表并进入诚实空态，页面明确提示学习项排期不变；
5. 返回 `/practice` 后仍能读取原来的两个学习项，证明删除 PracticeSession 不删除 LearningItem，也不
   回滚 ScheduleState。

不在本切片内：真实 Provider、真实 Supabase/Vercel、SQL/RLS 再实现、跨账号攻击矩阵、真实登录与
部署浏览器验证。上述边界已有专门层或需要目标环境，不能由 fake authority 冒充完成。

## 3. 技术路线

### 3.1 组合层

- Playwright 加载实际 `apps/web` production bundle，并从生产入口 `/practice/history` 导航；
- 新增独立 `CloudBrowserPracticeHistoryAuthority`，复用主 authority 的认证、CORS、CSRF、
  `Idempotency-Key` 与 `If-Match` 证明；
- helper 只实现本旅程消费的 history list/detail/delete、daily queue 与 learning item detail 路由；所有
  输入和输出都由 `@huayi/cloud-contracts` strict schema 解析；
- 生产页面、adapter、route parser 和 React 状态机不注入测试后门；主 authority 只按 seed 组合 helper。

独立 helper 避免继续扩张已接近 400 行的主动练习 authority，也让“进行一次练习”和“读取既有历史”
两种测试状态互不污染。

### 3.2 数据结构与状态机

fixture 使用一条 completed dialogue：

- `PracticeSession`：两个 item、三轮用户/助手对话、final feedback、两条 item feedback；
- `PracticeSessionItem`：每项都有 rating、`scheduleBefore` 与 `scheduleAfter`；
- `LearningItem`：一个 expression、一个 sentence-pattern；
- `historyPresent`：初始为 `true`，DELETE 成功后原子变为 `false`；
- `ScheduleState`：DELETE 前后保持同一个 `scheduleAfter` 投影。

状态转换为：

```text
completed history + two learning items
  -> list/detail server read
  -> second confirmation
  -> DELETE(expectedRevision, idempotency key, CSRF, If-Match)
  -> history absent + learning items and schedules unchanged
  -> list reread empty + daily queue reread still has two items
```

公开 authority snapshot 只保留路径、方法、认证类型、证明结果和聚合计数；不得保存答案、feedback、
请求正文、Cookie、CSRF、token 或幂等键。

## 4. TDD 与测试矩阵

### 4.1 已有单元/集成层

- contracts：strict list/detail/delete、null completion、固定 route、revision headers；
- API/Postgres：tenant 筛选、签名 cursor、跨 owner 404、active/lease 拒删、completed/failed 删除、
  snapshot replay/different-hash conflict；
- 领域不变量：删除后 LearningItem、ScheduleState、SourceExample 不变；
- Web component/adapter：loading/empty/error/retry、筛选/分页、详情焦点、两步删除、失败保留、成功后
  server reread、迟到响应抑制、Cookie/CSRF/Idempotency-Key/If-Match。

本切片不复制这些断言，只补组合缺口。

### 4.2 新增 actual-bundle RED→GREEN

1. RED：新增 `cloud-practice-history-journey.spec.ts`，先证明现有 authority 对 history route 失败关闭；
2. GREEN：新增 strict history helper 和一个专用 seed，最小接线到主 authority；
3. 旅程按 dialogue + completed 应用筛选，打开唯一记录并断言详情标题获得焦点；
4. 断言公开角色/任务、至少一轮用户回答、总反馈、逐项反馈和两项自评；
5. 点击删除后断言确认按钮获得焦点，DELETE 必须记为 `write-valid`；
6. 删除后断言 history 空态，再导航 `/practice` 并读取两个 learning item；
7. 在 390px、reduced-motion 下断言无横向溢出、Web Storage 为空，公开 snapshot 与主 DOM 不含
   fixture 私密答案、feedback、token 或幂等键。

## 5. 验收标准

- focused Playwright 新旅程通过，完整离线 Playwright 从 96/96 更新为 97/97；
- `apps/web` strict E2E typecheck、目标 ESLint/Prettier、workspace 测试与架构检查通过；
- list/detail 为 read proof，DELETE 为 authenticated Web `write-valid`，未知或缺 proof 请求失败关闭；
- 删除成功后 history count 为 0、daily queue item count 仍为 2，公开 snapshot 无私密内容；
- 文档、实现计划、测试矩阵、项目状态与变更记录同步；
- 真实数据库、身份、部署与浏览器验证继续标记 `target-platform validation pending`。

## 6. 实现前审查

审查结论：路线合理，可以进入 TDD。生产 contract/API/SQL/Web 行为已经覆盖所需产品语义；再修改这些
层会扩大风险且重复已有测试。唯一缺口是生产入口组合证据，使用独立 strict helper 可最小化改动、遵守
文件长度约束，并明确区分离线组合证据与真实部署证据。

## 7. 实现与复审记录

- RED 如预期在 history list 的“记录 1”失败，证明旧 `empty` authority 对未实现 route 固定 404；
- 新增 277 行独立 strict helper，既有主动练习 helper 保持 399 行；生产页面、adapter、contracts、SQL 与
  API 零改动；
- focused journey 1/1、`apps/web` strict typecheck、目标 ESLint/Prettier 和完整 Playwright 97/97 通过；
- actual bundle 已证明 completed dialogue 筛选/详情/焦点、两步删除、DELETE `write-valid`、server reread
  空态，以及返回 `/practice` 后两个 `DUE` 学习项仍可读取；公开 snapshot 无答案或 feedback；
- 实现后复审把缺失详情和 conflict 分支也统一到 strict error helper，并在详情页与今日练习页都检查
  390px 无横向溢出；未发现需要修改生产行为的新问题。

真实 Supabase/RLS、多连接数据库、真实身份、部署浏览器与目标平台验证仍未执行，不能由 97/97 离线
证据替代。
