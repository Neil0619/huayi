# 学习项归档方案

状态：2026-08-14 需求、技术方案、文档复审与离线实现已完成；目标环境验证待批准。本文固定
LearningItemArchive 的产品边界、公共契约、数据结构、事务、队列影响、测试矩阵与验收标准，并记录
实现后的复审结论。

## 1. 问题与目标

当前学习项只允许从未进入 `practice_session_items` 的记录 hard-delete。一旦参加过练习，删除会被
`learning_item_in_use` 阻止，这是正确的数据保护，但用户无法停止继续练习该项；它仍会出现在学习库、
DailyPracticeQueue 和显式新练习入口。旧文档以“archive/tombstone”合称后续方案，没有区分可逆退出学习
与不可逆清除数据，容易让实现误用 FK cascade 删除既有练习关系。

本切片只实现可逆的 LearningItemArchive：

1. 任意 active LearningItem，包括已练习项目，都可显式归档；
2. 归档项默认离开学习库、今日练习队列和新练习创建入口；
3. 归档不删除或重置 LearningItem、ScheduleState、SourceExample、Tag、PracticeSession 或既有关系；
4. 用户可从“已归档”筛选查看详情并恢复，恢复沿用归档期间保持的原排期；
5. 从未练习项目的既有 hard-delete 规则不变；已练习项目不 hard-delete，而由独立
   LearningItemErasure 清除内容并保留最小关系墓碑。

不可逆删除的后续裁决已在 `learning-item-erasure.md` 固定；它仍是独立切片，不改变本文的归档语义。
UI、API 和公开材料不得把归档称为删除。

## 2. 状态与边界

LearningItem 只有两个可见状态：

- `active`：`archivedAt=null`，可进入正常学习库、DailyPracticeQueue、新句子/对话练习和维护操作；
- `archived`：`archivedAt` 为服务器时间，默认列表排除，不进入新练习；只允许读取、恢复，以及在仍满足
  “从未练习”条件时使用既有 hard-delete。

状态转换：

```text
active --archive--> archived --restore--> active
```

- archive/restore 各自递增 LearningItem revision、更新 `updatedAt`；同 key 同请求只重放一次结果；
- 对当前状态重复使用新 key 失败为 `invalid_request`，旧 revision 先失败为 `revision_conflict`；
- 已经创建的 active/awaiting-feedback PracticeSession 继续完成。归档只阻止后续 session 创建；既有评分
  仍可更新保留的 ScheduleState，恢复后使用该最新权威；
- 归档项不可 patch、duplicate suggestion 或作为 merge source/target，返回稳定
  `learning_item_archived`；避免在用户以为已退出学习时继续改变其学习身份；
- canonical uniqueness 不因归档释放。相同内容仍是 exact duplicate，用户应恢复原项而不是创建第二项；
- AnalysisRecord、Candidate、WordEntry、PracticeSession 归档/删除语义均不受影响。

## 3. 公共契约

`LearningItemDetailResponse` 在 wrapper 层增加必填状态，不污染纯 LearningItem 内容模型：

```ts
type LearningItemDetailResponse = {
  archivedAt: string | null;
  item: LearningItem;
  recentPractice: RecentPracticeSummary | null;
  schedule: ScheduleState;
};
```

列表 query 增加 `archived:boolean=false`。`false` 只返回 active，`true` 只返回 archived，不提供混合状态页。
cursor 的签名 payload 必须包含完整规范化筛选 fingerprint（含 archived），不能跨筛选重放；这同时收紧
既有 type/tag/systemAttribute/query/due cursor 的误用边界。

新增固定路由：

- `POST /v1/learning-items/:id/archive`
- `POST /v1/learning-items/:id/restore`

两者 body 均为 strict `{expectedRevision}`，使用 Web Cookie + 固定 Origin + CSRF + `Idempotency-Key` +
匹配 `If-Match`，成功返回完整 `LearningItemDetailResponse`。公共错误码新增
`learning_item_archived`，只表达维护/新练习被归档状态阻止，不暴露跨账号存在性。
HTTP 状态为 409，与 `learning_item_in_use`/revision conflict 一样表示当前资源状态不允许该动作。

AccountDataExport 的 `learning-item` record 增加 `archivedAt`，归档项仍完整导出。归档不是数据删除，也
不改变隐私保留期限。

## 4. 数据与事务

Cloud V1 尚未发布，直接校准 bootstrap migration：

```sql
ALTER TABLE learning_items ADD COLUMN archived_at timestamptz;
CREATE INDEX learning_items_owner_archive_created
  ON learning_items(owner_user_id, archived_at, created_at, id);
```

不新增状态表或 archive event 表。Postgres maintenance repository 在一个 owner/RLS transaction 中：

1. `begin_idempotent_write(owner,'learning.archive|learning.restore',key,hash)`；
2. `SELECT revision,archived_at ... FOR UPDATE`，跨账号/缺失统一 404；
3. 校验 revision 和目标状态；
4. 更新 `archived_at`、revision、updated_at；
5. 使用同一 transaction 的完整 view 生成 strict response 并保存七天幂等 snapshot。

archive/restore 不检查 practice references，因为保留全部关系就是此状态的目的。hard-delete 仍在同一锁下
检查任何 `practice_session_items` 引用。patch/merge/suggestion 锁定后要求 `archived_at IS NULL`；merge 的
source 和 target 都必须 active。

## 5. 读取、排期与并发

- `learningLibraryViewSql` 投影 `archived_at`；list SQL 固定按 query 状态过滤，detail 可读取两种状态；
- library cursor boundary 仍为 `(createdAt,id)`，HMAC payload 另含规范化筛选 hash，防止 cursor 跨
  active/archived 或其他筛选使用；
- DailyPracticeQueue 查询固定要求 `archived_at IS NULL`；通用 `findPracticeItem` 保留两种状态供既有会话
  恢复读取，句子/对话新 session 则统一经过 `requireActivePracticeItem` 并锁行。请求在归档提交后使用旧
  ID 时返回 `learning_item_archived`，不能伪装成可练习；
- session create 与 archive 同时发生时，两者必须锁同一 LearningItem。先取得锁的一方确定线性化顺序：
  session 已创建则可继续，archive 已提交则新 session 不创建；
- archive 不改 dueAt/level/rating。队列读取后、session create 前发生归档时，以 create transaction 的再查
  为准，不能只相信浏览器旧队列；
- 恢复后项目按原 schedule 重新参与队列；若已过期则下一次队列自然选中，不制造补偿任务。

## 6. Web 行为

- `/library` 增加“使用中／已归档”服务器筛选，默认使用中；切换筛选清空详情和旧 cursor；
- active 详情增加“归档学习项”二次确认，明确“停止新练习但保留内容、排期和历史”；
- archived 列表/详情显示“已归档”和时间，维护区只提供“恢复学习”及仍可能失败关闭的永久删除；不显示
  编辑、语义建议或合并入口；
- archive/restore 成功后重新读取当前筛选的列表，不在客户端局部改权威。刷新失败如实提示“操作已完成，
  重新载入失败”，不把已提交 mutation 报成失败；
- action pending 期间防重复，revision conflict 保留详情并提示刷新；迟到 list/detail/action 不能覆盖较新
  筛选或操作；完成后焦点回到列表标题或恢复后的详情标题；
- archive、delete 和练习历史 delete 的文案必须明确不同。

## 7. TDD 与测试矩阵

### Domain/Contracts

1. root glossary 固定 LearningItemArchive，不再把 archive 与 tombstone/delete 混称；
2. strict detail 必须含 `archivedAt`，接受 null/instant，拒绝缺失、非法时间与未知状态字段；
3. list query 默认 archived=false，路由、request/response、revision headers 严格；
4. `learning_item_archived` 进入稳定错误码；账号导出记录必须含 archive 状态。

### API/Postgres

1. archive/restore 的 owner、revision、幂等 replay/conflict、当前状态和 strict snapshot；
2. 已练习 item 可归档且 practice rows、schedule、sources/tags 数量不变；恢复保留更新后的 schedule；
3. active/archived 列表、完整筛选 fingerprint 的签名 cursor 隔离、跨 owner 404；
4. archived item 的 patch/suggestion/merge source/target 与新 sentence/dialogue session 失败关闭；
5. 归档与 session create 的共享行锁竞态；既有 active session 可继续评分；
6. AccountDataExport 包含 active/archived 全部记录及准确 `archivedAt`；
7. migration RLS/allowlist/index 检查，production routes 接线。

### Web

1. adapter 的固定 route、Cookie/Origin/CSRF/idempotency/If-Match 与 strict parse；
2. 默认 active、显式 archived 筛选及 cursor 重置；
3. archive/restore 二次确认、pending、防重复、revision conflict、写后重读和刷新失败诚实状态；
4. archived 详情不显示 patch/suggestion/merge，新练习入口不接受旧项；
5. loading/empty/error/retry、焦点、live region、窄屏和 reduced-motion；
6. actual Web journey：创建/读取已练习项→归档→默认库和今日队列消失→历史仍在→已归档筛选可见→恢复
   后按原排期回到队列。

## 8. 验收标准

- 文档、术语、契约、bootstrap migration、API/Postgres、Web 和账号导出按上述顺序 RED→GREEN；
- 已练习项归档绝不删除或改写练习历史；新 session 在 archive 后无法创建；恢复不重置排期；
- 全 workspace typecheck/build、完整 Vitest/Playwright、instructions/architecture、精确 ESLint/Prettier
  通过；根门禁既有阻塞单独归因；
- 真实部署数据库竞争、真实登录和 Chrome journey 未验证时保持
  `implemented; target-platform validation pending`；
- 本切片完成后，archive 不再列为未实现；不可逆删除按 `learning-item-erasure.md` 独立推进。

## 9. 方案复审

复审拒绝三条路线：直接删除会触发 `practice_session_items` cascade 并让历史失去引用；在每个练习会话中
立即复制完整 LearningItem 再删除会扩大正文冗余、导出与删除权边界；只把 dueAt 设空会破坏
ScheduleState 规则且不能区分新项。单列 `archived_at` 是可逆、可解释且与 AnalysisRecord archive 一致的
最小权威；它为独立 LearningItemErasure 墓碑保留空间。文档逻辑、依赖顺序与现有 RLS/幂等架构一致，当前
没有阻止离线实现或进入目标环境验证的产品或技术问题。

## 10. 实现后复审与证据

离线实现按 Contracts→bootstrap migration/API/Postgres→Practice queue/session→AccountDataExport→Web→
actual bundle journey 完成。复审确认：

- public detail/export 的 `archivedAt` 为必填 nullable 字段，列表 cursor 绑定完整规范化筛选 hash；
- archive/restore 在 owner transaction 内以 `FOR UPDATE`、revision 与七天幂等 snapshot 串行化；已练习项
  的 schedule、source 和 practice links 在 PGlite 证据中均保持不变；
- 新句子/对话会话使用活动项锁定读取，既有会话继续使用可读两态的通用 view，避免把“阻止新会话”误做成
  “破坏已有会话”；
- Web 归档使用二次确认并说明保留数据；归档详情显示时间，只暴露恢复及仍受服务端练习引用规则约束的
  hard-delete，不暴露编辑、语义建议或合并；所有 mutation 后重新读取服务器；
- actual Web bundle 已覆盖创建→详情→二次确认归档→已归档筛选→恢复→使用中筛选，并记录 archive/restore
  的有效 Cookie/Origin/CSRF/idempotency/revision 写证明；已练习数据保留、queue 排除和既有 session 可读由
  PGlite 集成测试覆盖。

本轮 fresh 完整离线门为 114/114 Node 脚本、409 个 Vitest 文件（2,568 passed / 12 skipped）及 93/93
Playwright；全 workspace typecheck/build、instructions、architecture 与本任务精确 ESLint/Prettier 通过。
根 format/lint 仍分别被 70 个既有文件与 `.agents/skills/**` 的 143 个既有 CJS 错误阻断，不归因于本切片。

剩余证据仅为真实部署数据库的多连接竞争、真实登录 Cookie/CSRF、部署 Web 和支持平台 Chrome；在取得
独立批准前状态保持 `implemented; target-platform validation pending`。LearningItemErasure 已另行完成
设计并进入离线 TDD，不属于本切片的实现证据。
