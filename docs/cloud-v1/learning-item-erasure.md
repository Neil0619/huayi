# 华译 Cloud V1 已练习学习项不可逆抹除方案

状态：离线实现与实现后复审已完成；`implemented; target-platform validation pending`。影响平台：
shared。

## 1. 背景与目标

当前 `DELETE /v1/learning-items/:id` 只 hard-delete 从未进入练习会话的 LearningItem；已练习项可以
LearningItemArchive，但归档不删除任何内容。产品还需要一个含义准确的不可逆动作，让用户删除已练习
学习项的正文、来源、标签与排期，同时不偷偷级联删除另一类用户数据——PracticeSession。

本方案固定两个术语：

- **LearningItemErasure（学习项抹除）**：用户发起的不可逆数据删除动作；
- **LearningItemTombstone（学习项墓碑）**：抹除后仅为既有 PracticeSession 保留关系完整性的最小内部
  锚点，不是可读取的 LearningItem。

目标是：删除学习项本身的可学习内容，保留用户未选择删除的练习记录，释放 canonical identity，且让
并发、幂等、账号导出和后续单次练习删除都有唯一解释。

## 2. 产品裁决

1. 未练习 LearningItem 继续使用既有 hard-delete；不制造无意义墓碑。
2. 有练习引用的 LearningItem 只有先归档后才能抹除。Web 因而需要“归档”和“不可逆抹除”两次独立
   意图确认，不能把前者文案复用为后者。
3. 进行中、等待生成/反馈，或已完成但尚未自评的 session 会阻止抹除并返回
   `learning_item_in_use`。只有所有引用都已终态且无需再读取学习项或推进排期时才可抹除。
4. 抹除清除 canonical key、正文、系统属性、SourceExample、标签关联和 ScheduleState；保留的墓碑只含
   owner、opaque item ID、revision 和创建/抹除时间。相同内容之后可以重新创建为新 ID、新排期，不能
   自动连接旧历史。
5. PracticeSession 的 prompt、attempt、turn、feedback、rating 与排期前后快照不属于 LearningItem，抹除
   不改写它们。确认文案必须说明这些练习记录可能仍包含用户输入或模型生成的上下文；用户可在练习历史
   中分别删除终态 session。
6. 公共学习库 list/detail、今日队列、直接 session create、编辑、建议、合并和 LearningItem export 都
   看不到墓碑。练习历史 item 只增加 `learningItemDeletedAt?` 标记，继续使用 opaque item ID 维持一次
   session 内的反馈与 rating 对应关系，不返回已清除正文。
7. AccountDataExport 不生成 `learning-item` 墓碑记录，但仍导出用户保留的 PracticeSession；其中
   `learningItemDeletedAt` 解释为何 item ID 没有对应学习项。整账号永久删除最终清除墓碑和练习记录。
8. 删除一条终态 PracticeSession 后，如果某个墓碑已不再被任何 session 引用，服务器在同一事务中
   hard-delete 该墓碑。墓碑不是独立可管理或无限保留的产品资源。
9. failed session 属于终态且允许按练习历史既有 proof/revision 规则删除；completed 继续允许 rated/unrated
   两种历史删除，active 与 awaiting-feedback 仍不可删除。只要 completed-but-unrated 仍引用学习项，项目
   抹除就会被阻止；用户可先完成自评或删除该次历史。

## 3. 公共契约与 UI

DELETE 的请求、route、Cookie/Origin/CSRF、`Idempotency-Key`、quoted `If-Match` 和
`{expectedRevision}` 保持不变。成功响应改为：

```ts
type DeleteLearningItemResponse = {
  deleted: true;
  deletionKind: "hard-delete" | "erased";
  id: string;
};
```

- 无 practice reference 返回 `hard-delete`；
- 有且仅有安全终态 reference、同时 item 已归档时返回 `erased`；
- 有不安全 session 返回 409 `learning_item_in_use`；
- 有安全历史但 item 尚未归档返回 409 `learning_item_must_be_archived`；
- 墓碑不再是 LearningItem，后续 detail/DELETE 统一 404；同幂等键仍可从七天 snapshot 重放原响应。

LearningItem detail/list 增加必填 `hasPracticeHistory`，由服务器对任意 session 引用执行 owner-scoped
`EXISTS`，不能用只覆盖 completed+rating 的 `recentPractice` 猜测删除入口。PracticeSessionItem 与
PracticeHistorySummary item 增加可选的
`learningItemDeletedAt: instant`。字段只表示公开读取时对应 item 已被抹除，不携带正文或内部墓碑结构。

Web `/library` 的 active 详情对已练习项只提供归档；archived 详情才提供“永久删除学习项”。二次确认明确：

- 此操作不可恢复；
- 正文、来源、标签与排期会删除；
- 既有练习题、作答、对话和反馈保留，需到练习历史分别删除；
- 相同内容以后重建会成为全新学习项。

成功消息依据 `deletionKind` 区分“学习项已删除”和“学习项内容已永久删除；练习历史仍保留”。写入成功后
仍必须重新读取服务器；刷新失败不能把已提交删除误报为失败。

## 4. 数据结构与事务

Cloud V1 尚未发布，直接校准 bootstrap migration：

```sql
ALTER TABLE learning_items
  ALTER COLUMN type DROP NOT NULL,
  ALTER COLUMN canonical_key DROP NOT NULL,
  ALTER COLUMN content DROP NOT NULL,
  ADD COLUMN deleted_at timestamptz,
  ADD CONSTRAINT learning_items_live_or_tombstone CHECK (
    (deleted_at IS NULL AND type IS NOT NULL AND canonical_key IS NOT NULL AND content IS NOT NULL)
    OR
    (deleted_at IS NOT NULL AND type IS NULL AND canonical_key IS NULL AND content IS NULL
      AND system_attributes = '[]'::jsonb AND archived_at IS NULL)
  );
```

唯一键对 null 不冲突，因此抹除后 canonical identity 立即释放。所有正常 LearningItem view 和 identity
查询固定 `deleted_at IS NULL`。墓碑不进入领域 schema，也不允许通过通用 view 被误解析。

`learning.delete` 在 owner/RLS transaction 中：

1. 先读取幂等 snapshot；随后 `SELECT ... FOR UPDATE` 锁 live item 并重验 revision；
2. 锁全部引用 session，判定没有 active/awaiting-feedback、未完成生成/反馈 lease，以及
   completed-but-unrated；
3. 无引用时 hard-delete 并返回 `hard-delete`；
4. 有安全引用时要求 `archived_at IS NOT NULL`，删除 SourceExample、tag joins、ScheduleState，再把 item
   改为墓碑并返回 `erased`；
5. 保存严格响应 snapshot 后提交。

归档已经阻止新 session，并与 session create 锁同一 item；因此“归档后抹除”和新 session 不存在绕过
窗口。完成/自评与抹除同时发生时，session 行锁决定顺序：尚未完成自评的一方先出现则抹除失败；自评先
提交则抹除读取到安全终态。开始练习的旧幂等 replay 必须直接返回已保存 session，不得为了重放重新加载
已抹除正文或再次调用模型。

删除终态 session 时先记住关联 item IDs，删除 session 后只 hard-delete
`deleted_at IS NOT NULL AND NOT EXISTS(practice_session_items)` 的相应墓碑。整账号删除仍通过 owner cascade
清除全部行。

## 5. 安全、隐私与日志

- 墓碑不得包含 canonical key、content、标签、system attributes、来源正文、排期或删除原因；
- 公共 API、错误和日志不得返回引用数量、session ID、owner ID 或墓碑行；
- `learning_item_in_use` 不区分是哪一种非终态阻断；
- 幂等 snapshot 只保存删除成功响应，不保存删除前 LearningItem；
- 删除不重写 PracticeSession，因为那会把一个资源的删除意图扩展到另一资源；练习历史确认页需准确
  说明其自身删除范围；
- AccountDataExport 中没有墓碑资源，只有保留的 session 上可选删除标记；账号永久删除仍是清除所有
  账号数据的最终边界。

## 6. TDD 与测试矩阵

### Domain/Contracts

1. glossary 区分 Archive、Erasure、Tombstone、PracticeSession deletion；
2. delete response 严格接受两种 `deletionKind`，拒绝缺失/未知值与未知字段；
3. PracticeSession/history item 的 `learningItemDeletedAt` 只接受合法 instant；
4. `learning_item_must_be_archived` 进入稳定错误码；export strict record 接受带删除标记的 session。

### Migration/API/Postgres

1. live/tombstone CHECK、nullable identity、索引/RLS/idempotency allowlist 与正常 view 过滤；
2. 未练习 hard-delete 回归；已练习 active item、未归档 item、active session、awaiting session、未自评
   completed session 分别失败且零副作用；
3. archived + rated completed/安全 failed refs 原子抹除，正文/来源/tag join/schedule 清空，practice rows 与
   prompt/attempt/turn/feedback/rating/schedule snapshots 不变；
4. canonical identity 可重建为新 ID；墓碑 detail/queue/create/patch/suggest/merge/重复 delete 均不可见；
5. owner、revision、幂等 replay/conflict 与 session completion/rating 并发；
6. start-session 旧幂等 replay 在抹除后不重读正文、不调用 Provider；
7. 删除非最后一条 session 保留墓碑，删除最后一条终态 session 清理墓碑；failed 和 completed
   rated/unrated session 可删，active/awaiting-feedback 仍失败；
8. export 排除墓碑 learning-item，保留 session 与 `learningItemDeletedAt`；跨账号不可见。

### Web/E2E

1. adapter strict 解析 `deletionKind`，固定 headers/body，不接受墓碑详情；
2. active 已练习项先引导归档；archived 项使用独立不可逆确认，pending 防重复；
3. `erased` 成功后 archived list/detail 重读，刷新失败显示“删除已完成，重新载入失败”；
4. practice history 与账号导出 UI 对已删除项显示“学习项已删除”，不尝试加载 LearningItem detail；
5. actual Web journey：创建→完成并自评→归档→抹除→学习库/队列不可见→历史完整且有删除标记→删除
   历史；同时记录有效 proof/revision/幂等写证明。

## 7. 验收标准与执行顺序

执行顺序固定为 Contracts → bootstrap migration/API/Postgres → Practice replay/history cleanup →
AccountDataExport → Web → actual bundle journey。每一层先观察预期 RED，再做最小 GREEN。

验收必须证明：

- 抹除后数据库和所有公共响应都不含学习项正文、canonical key、来源、标签、系统属性或排期；
- PracticeSession 未被级联删除或改写，历史删除仍是独立用户动作；
- 非终态 session、旧 revision、跨账号和重复写不能绕过；
- identity 可安全重建且不会自动继承旧排期或历史；
- 默认测试全离线；全 workspace typecheck/build、完整 Vitest/Playwright、instructions/architecture 和
  任务文件 ESLint/Prettier 通过；
- 真实部署多连接竞争、真实登录 Cookie/CSRF 和支持平台 Chrome 未验证前保持
  `implemented; target-platform validation pending`。

## 8. 实现前复审

复审拒绝三种替代：直接 cascade 会把学习项删除意图扩展到 PracticeSession；把完整 LearningItem 复制进
每个 session 会增加正文副本并削弱删除保证；只保留原 row 加 `deleted_at` 而不清正文只是隐藏，不是删除。
最小墓碑把不可逆边界限制在关系锚点，并由最后一条 session 删除触发清理，兼顾历史完整性和数据最小化。

复审同时发现两个必须随切片修正的既有 seam：PracticeSession 公开 item 需要删除标记，否则导出存在无法
解释的 dangling ID；开始练习的幂等 replay 不能依赖 live LearningItem，否则七天重放承诺会被抹除破坏。
上述修正已进入测试矩阵。当前没有需要用户另行裁决的产品歧义，可以进入离线实现。

## 9. 实现后复审与验证

实现按既定顺序完成 Contracts → bootstrap migration/API/Postgres → Practice replay/history cleanup →
AccountDataExport → Web → actual bundle journey。实现后复审确认：

- `DELETE /v1/learning-items/:id` 由独立事务模块统一判定 hard-delete 与 erasure，并把严格响应写入既有
  幂等 snapshot；正常 LearningItem view 和候选确认查询排除墓碑；
- detail 的 `hasPracticeHistory` 使用 owner-scoped `EXISTS`，没有再用仅覆盖已自评完成练习的
  `recentPractice` 猜测删除入口；
- PracticeSession/history/export 只公开可选 `learningItemDeletedAt`，墓碑本身不进入公共 schema；
- start-session 的旧幂等重放先返回已保存 session，不会因正文已抹除而失败或再次调用 Provider；
- 删除最后一条引用 session 会在同一事务清理墓碑；active/awaiting-feedback 仍失败关闭，failed 与
  completed 终态可以按各自 proof/revision 规则删除；
- Web 把归档与不可逆删除拆成两次独立确认，并按 `deletionKind` 显示准确结果。

2026-08-14 fresh 离线证据：contracts 27/27、API/PGlite 47/47、Web 25/25 focused；全量
114/114 Node 脚本、409 个 Vitest 文件（2,573 passed / 12 skipped）、93/93 Playwright、全 workspace
typecheck/build、instructions、architecture、store release audit、任务文件精确 ESLint/Prettier 均通过。
根 `format:check` 仍只被 70 个既有非本任务文件阻断；根 `lint` 仍只被 `.agents/skills/**` 的 143 个
既有 CJS 错误阻断。Cloud release audit 按设计只因九项开发态公开配置/最终隐私事实缺失而失败关闭。

真实多连接 Postgres 竞争、真实登录 Cookie/CSRF、部署数据库与支持平台 Chrome 未经批准验证，因此本
切片保持 `implemented; target-platform validation pending`，不能据离线证据宣称发布完成。
