# 语见 Cloud V1 数据模型

本文件描述逻辑表和不变量；具体 SQL 迁移必须保持同名语义。V1 基础迁移由 API 创建 UUIDv4，不依赖
数据库扩展；所有公开列表都以 `(created_at,id)` 稳定游标排序，因此不把 UUID 本身当作时间。时间使用
`timestamptz`，金额使用 `bigint micro_usd`，用户正文使用 `text/jsonb`。

练习生成的 `practice_generation_tasks` 与 `quota_reservations` 由
`settle_practice_generation_quota` 建立终态一致性：成功只接受 `ready + output + active reservation`；
失败接受 `failed|abandoned + stable_error_code + active|released reservation`。函数从 task kind 派生固定
usage feature 和 price version，校验 1–2 条调用及总 cost 后追加 ledger 并把 reservation 置为 settled；
不新增公开表或客户端字段。

## 身份与运营

| 表                             | 关键字段                                                                                           | 约束与语义                                                                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `user_profiles`                | `user_id`, `email`, status、timezone、daily goal、三项插件偏好、`preferences_revision/updated_at`  | email 为规范投影；偏好默认 platform/manual/enabled；同一 revision 原子更新                                                   |
| `account_sign_in_methods`      | `owner_user_id`, `method`, `linked_at`                                                             | owner+password/google 唯一；Huayi 登录授权 fence，不保存 provider subject/token                                              |
| `invitations`                  | `id`, `token_hash`, expiry/consume/revoke、`created_by_kind`, `created_by?`                        | token hash 唯一；operator 必须有 actor，deployment-bootstrap 必须无 actor；消费使用行锁                                      |
| `invitation_claims`            | `ticket_hash`, invitation、expiry、`bound_user_id/email`、`finalized_user_id`                      | 15 分钟短时租约；领取后仍受父邀请撤销与过期约束                                                                              |
| `auth_flows`                   | `flow_hash`, `kind`, ticket/owner/session、stage/lease、started/consumed、provider state、expiry   | invite 持票；两种 link 分 purpose 四阶段、单 open flow/30 秒 lease                                                           |
| `password_recovery_flows`      | flow/owner、stage、加密 provider state、recovery session/CSRF hash、lease、expiry/consumed         | 未登录一次改密权威；每 owner 单 open flow；不产生 Huayi session                                                              |
| `web_sessions`                 | `id`, `user_id`, access、encrypted refresh、`reauthenticated_at/method`、expiry/revoked            | 普通登录 method=null；显式 reauth 写 password/google；full/data-rights 隔离                                                  |
| `extension_sessions`           | `id`, `user_id`, `install_id_hash`, `token_hash`, `last_used_at`, `expires_at`, `revoked_at`       | token hash 唯一；Web 可按 owner+ID 撤销，设备可按当前 token hash 只撤销自身                                                  |
| `security_notification_outbox` | `id`, owner、固定 kind/status、attempt、delivery deadline、available/lease/sent/created timestamps | 安全事件耐久后置发送；120 秒 lease+有界退避+最大尝试；sent/failed-dead-letter 终态；不保存密码、token、IP 或 Provider detail |

普通邀请运营四态不新增列：`revoked_at` 非空为已撤销，否则 `consumed_at` 非空为已领取，否则
`expires_at <= now` 为已过期，其余为可领取。`admin_list_invitations` 只投影上述时间戳与公开 ID/创建时间；
撤销仍锁定原行并只允许未领取、未撤销记录，claim/finalization 继续同时检查 revoke/expiry。明文 token、
领取账号与 claim ticket 不进入管理列表。

未确认的密码注册重发不新增表或第二条 flow。0014 为 claim 补充服务端派生的规范 `bound_email`，并让
`bind_auth_identity` 将同一 Auth user id/email 一起锁定；客户端不能提交或替换该邮箱。
`renew_interrupted_password_confirmation` 锁定同一 active invitation、唯一 bound unfinished claim 与唯一
未消费 `invite-registration` flow，并要求 claim email 与 `auth.users` 精确一致、未确认 email identity
唯一且业务账号数据为零；成功只延长同一 claim 并原子替换同一 flow 的 hash/expiry。新 expiry 最多
15 分钟且不超过 invitation expiry；旧 flow 立即失效，任意时刻仍恰好一条
invitation/claim/flow/Auth user/email identity。

该 R3-C 语义已进入当前未发布 baseline 与 `0011-security-notification-delivery.sql`：固定 23 小时 deadline
小于 Resend 24 小时幂等窗口，最多 8 次；到期为 `failed`，耗尽为 `dead-letter`。claim 先以最多 100 条
批次终态化超窗/耗尽行再领取一条发送任务，因而不会为已终态行调用 Provider；发送成功但本地 complete
失败只在 deadline 内以同 notification ID 重放。

`account_sign_in_methods` 启用并强制 RLS；普通业务 role 仅可在 owner context 下 SELECT，不能直接
INSERT/UPDATE/DELETE。邀请 finalization 与后续显式绑定只能经固定 search path、已撤销公开权限的
SECURITY DEFINER 函数原子写入。账号删除随 profile 级联，账号导出只包含 method 与 `linkedAt`。
Google link 的 `link_stage` 固定为 claimed/refreshed/provider-started/completed；`link_lease_hash/expires_at`
只允许一个 continue worker 推进当前 refresh generation。refreshed 提交同时替换 Web session 的 encrypted
refresh 并保存 protected provider state，provider-started 再保存 callback PKCE state；终态事务新增 method、
撤销其他 sessions并轮换当前 session。
Password link 使用 claimed/refreshed/provider-updated/completed；refreshed 同样先提交新 encrypted refresh 与
protected provider session state，provider-updated 只记录无秘密阶段，不保存新密码。两个 link purpose 各自
最多一条 open flow，不能相互消费或共享 callback/state。

PasswordRecovery 不扩展 `auth_flows` kind，而使用更窄的 `password_recovery_flows`：requested→sent→
verified→provider-updated→completed，失败可进入 failed；request flow 30 分钟、browser session 15 分钟、
dispatch claim 60 秒、complete lease 30 秒且两者分 purpose。flow/recovery session/CSRF/lease 只存 keyed
hash，worker 所需 flow secret 与 Provider state 加密，新密码和完整邮箱不入表。邮件 worker 在 Provider
前写 dispatch，回执不明确时不得自动重发。
业务 role 无
直接权限；trusted function 固定 active profile+password method、owner、expiry 和 stage。成功事务撤销全部
Huayi sessions、保持 method 不变并写一条 `password-reset-completed` 通知 outbox。完整字段与跨系统恢复
裁决见 `password-recovery.md`。两表、约束、partial unique、forced RLS、业务 role 零直访、12 个 recovery
与 3 个 notification fixed-search-path SECURITY DEFINER 状态转换及 100 条 cleanup 已进入基础 migration。
notification 的 0011 forward、Resend adapter、独立 route、无正文告警 port 与第五个 Cron job 均有离线
回归；真实 DNS/verified sender、分离 SMTP/HTTP key、Custom SMTP 与 API 完整 Production environment 已
关闭对应 hosted 配置门，Resend 真实投递、重复投递观测和监控目的地仍待验收。

Store DeviceDisconnect 不新增 secret 或表。`revoke_current_extension_session(token_hash)` 只把匹配、未撤销、
未过期的当前行置为 revoked；SECURITY DEFINER 固定 search path 并撤销公共/业务角色权限。HTTP 不返回该函数
布尔值，随机、过期和已撤销 token 统一 204。完整 remote-first 顺序见
`extension-session-disconnect.md`。
| `extension_pairings` | `id`, `state_hash`, `pkce_challenge`, `install_id_hash`, `status`, `expires_at`, `user_id` | `pending                                                                   | approved | consumed | expired`; 只能消费一次 |
| `admin_roles` | `user_id`, `role`, `created_at` | 仅服务端可写；不能信任 Auth 可编辑 metadata |
| `audit_events` | `id`, `actor_user_id`, `action`, `subject_id`, `safe_details`, `created_at` | `safe_details` 使用字段白名单，禁止正文与秘密 |

`huayi_private.first_operator_bootstrap` 最多一行，保存 invited/completed、current invitation、revision、
issued/completed time、最终 operator user ID 与可选 deletion time，不保存 token/hash/email。只有项目
`postgres` 管理员可经固定
SECURITY DEFINER issue/replace-unclaimed/complete 函数改变它；application/runtime/business/context-setter
均无表或函数权限。BootstrapInvitation 使用正常 claim/Auth/finalization，complete 从锁定的 invitation 与
claim 推导唯一账号，不接收 userId。该记录是部署证据，不是伪造 actor 的 OperationalAuditEvent。完整
不变量见 `first-operator-bootstrap.md` 与 ADR-0023。首位账号删除前的窄 trigger 清除 record 中的 user UUID
并保存 deletion time，使账号/角色正常删除但不重新打开 bootstrap。

`huayi_private.hosted_acceptance_operations` 与
`huayi_private.hosted_acceptance_cleanup_obligations` 只服务 Hosted DeepSeek 单次验收。0016 首切片保存
approval/payload digest、精确 API/Web deployment pair、operation/cleanup 状态、generation/token hash、
dispatch/request/receipt 证据与 90 天 retention；partial unique 只允许一个 non-terminal operation。两表
forced RLS 且对 API/business/runtime 和专用 `NOLOGIN` executor role 均无直权；trigger 只提供单向状态、
同步轮换与证据不可改写的结构 guard。专用 role 目前没有函数执行权限，claim/bind/settlement/status/
retention、fence-token 验证与 effective-fuse 仍未实现。0017 新增不可变 `identity_scrubbed_at`：terminal 满
24 小时后，结构 guard 只允许一次同时清除 owner、idempotency-key HMAC 与 server request ID，并保留
receipt/deployment/terminal/safe-error/time evidence；提前、部分、receipt-free、重引入与重复 scrub 均拒绝。
这只是结构许可，没有 callable retention executor，不能把 migration 存在解释为自动清除或可运行 authority。

`GET /v1/account` 不新增聚合表。它在一个 owner repeatable-read snapshot 中只读取 active
`user_profiles` 的规范 email 与五项偏好，并读取当前未撤销、未过期的 `extension_sessions` 公开字段；
最低插件版本来自启动配置。配对确认、
首次联网同意和 Eudic/Shanbay recipient consent 均不写成账号列，避免虚假账号 consent 权威。

## 查询、学习采集与分析

| 表                            | 关键字段                                                                                                                                            | 约束与语义                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `study_captures`              | `id`, owner、kind、source text/hash、status、title/context、first/last captured、count、revision、timestamps                                        | kind 为 phrase/sentence/passage；owner/kind/hash 唯一；pending/analyzing/analyzed |
| `analysis_records`            | `id`, owner、`study_capture_id?`、review/archive、source type/title/context/text/hash、kind、V2 result、model metadata、revision、timestamps        | source 为 manual/study-capture；capture 删除只设空；review 与 archive 独立        |
| `analysis_candidates`         | `id`, analysis/owner、candidate type/payload、analysis unit id、ordinal、created                                                                    | 创建后不可变；只允许 expression/sentence-pattern；引用必须属于结果                |
| `analysis_requests`           | `id`, owner、capture?、idempotency/hash/unit count、state/lease/reservation/price/recovery ledger/terminal event、timestamps                        | Web 深度分析生成；owner/key 唯一；租约、预留与恢复账本由服务端固定                |
| `extension_query_generations` | `id`, owner/session、idempotency/hash/action/kind/source、最小输入、state/lease/reservation/price/dispatch、strict result/error、expiry、timestamps | 平台插件查询临时权威；不连 AnalysisRecord；正文/结果完成后最多一小时              |
| `idempotency_records`         | `owner_user_id`, `operation`, `key`, `request_hash`, `response`, `expires_at`                                                                       | 非 generation 写操作三元组唯一；不同 payload 重用 key 返回冲突                    |

Web 深度分析先创建 `analysis_requests` 并取得生成租约，再创建晚于租约到期的额度预留。
完成/失败事务必须先以租约 token 锁定请求，再按同一顺序锁定并结算预留，最后写入严格 terminal event；
陈旧 worker 在写记录或账本前即被拒绝。租约过期不透明重跑模型：恢复事务使用请求固定的价格版本和预分配
恢复账本 ID，按预留额保守结算一次并写入可重放失败事件。用户如需重试必须使用新的幂等键。

DeepSeek 分时费率要求 `analysis_requests` 与其他 generation/task 一样持有 `dispatched_at`：reservation
阶段按 peak 上限占用且价格可尚未固定；紧邻 Provider fetch 的 transition 用同一可信 UTC `now` 原子写入
实际 `price_version_id` 与 `dispatched_at`。pre-dispatch 过期安全释放 reservation，post-dispatch 过期才按
固定 UUID 保守结算。`model_price_versions` 不可变行与 `usage_ledger` 外键继续保存全部历史。

`extension_query_generations` 在 Provider dispatch 前必须同时持久化 request、价格与 quota reservation，
再以当前 lease 写入 `dispatched_at`，成功后才可发 Provider HTTP。未 dispatch 的过期 lease 释放
reservation 且不写 UsageLedger；已 dispatch 的过期 lease 按 ADR-0018 以预留上限保守结算，不透明重领。
终态 source/result 仅用于同 CardSession 恢复和幂等重放，完成后最多一小时由跨 owner trusted maintenance
有界硬删；UsageLedger 只保存无正文用途、token、价格、费用和 outcome。

StudyCapture 规范化为 NFKC、弯引号统一、trim 与空白折叠，保留大小写/标点。唯一 hash 命中后还需比较由
source_text 重算的规范全文；碰撞失败关闭。同 Idempotency-Key 重放不增计数，新 occurrence key 才推进
lastCapturedAt/count/revision。`analysis_records.study_capture_id` 是唯一关系字段；最新分析由 owner transaction
按 `(created_at,id)` 投影，不再保存可漂移的 latest FK。首次分析失败以 generation fencing 恢复
pending；reanalysis 期间 capture 保持 analyzed，失败保留旧 latest，成功才 append 并更新投影。

`analysis_requests.study_capture_id/capture_intent` 只负责付费生成生命周期：同 capture 最多一个 running
request。begin 在同一事务校验 owner/revision/status 并推进 capture；finish/abandon 以 lease fencing 原子
恢复或完成状态。公开 Capture 详情只投影 running requestId，不暴露该表的 lease/额度字段。

历史读默认只返回未归档记录，并以 `(created_at,id)` 降序 keyset 分页。process/archive/restore 每次成功将
revision 增一；delete 删除 AnalysisRecord 与未确认 Candidate，但 `source_examples.analysis_id` 设空，
独立来源快照和 LearningItem 不删除。删除 capture-linked 当前分析时，默认同时删除 capture 但可取消；
保留 capture 时服务器从剩余关联记录投影最新，没有剩余则 pending。

四类历史写操作使用 owner-scoped `idempotency_records` 保存 request hash 与完整严格响应，所以 delete
后仍可安全重放。`analysis_records.result` 的公共形状为严格 V2 判别联合：

```ts
type WebDeepAnalysis =
  | {
      type: "phrase-analysis-v2";
      translationZh: string;
      contextualMeaningZh: string;
      analysisUnitId: "u1";
      structureAndCollocationZh: string[];
      usageNotes: TeachingPoint[];
      register?: string;
      candidateIds: string[]; // Expression only
    }
  | {
      type: "sentence-passage-analysis-v2";
      overall: { translationZh: string; understandingZh: string; contextAndToneZh?: string };
      sentences: Array<{
        analysisUnitId: `u${number}`;
        ordinal: number;
        sourceText: string;
        translationZh: string;
        structure: TeachingPoint[];
        grammar: TeachingPoint[];
        expressions: TeachingPoint[];
        languageNotes: TeachingPoint[];
        candidateIds: string[]; // Expression or SentencePattern
      }>;
    };

type TeachingPoint = {
  label: string;
  explanationZh: string;
  evidenceText?: string;
  commonMistakeZh?: string;
  generatedExample?: { sourceText: string; translationZh: string };
};
```

TeachingPoint 每项最多一条 GeneratedExample，且生成例句不进入 Candidate/SourceExample。插件 compact
六类结果语义继续位于 `learning-domain`/Store adapter，但不能被 AnalysisRecord schema 接受；Cloud 契约
不反向依赖本地消息、repository 或 Vault 类型。

Candidate 与 SourceExample 以 `analysis_unit_id=u1..u40` 关联；phrase 固定只有 u1，sentence/passage 的
确定性分句按顺序分配。每个 candidate 必须被恰好一个 unit 引用，不能用 `sentence_id` 把短语伪装成句子。

## 学习库

| 表                                       | 关键字段                                                                                                                                                     | 约束与语义                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `learning_items`                         | `id`, `owner_user_id`, `type`, `canonical_key`, `content`, `system_attributes`, `revision`, timestamps                                                       | type 为 expression/sentence-pattern；同 owner/type/key 唯一  |
| `source_examples`                        | `id`, `owner_user_id`, `learning_item_id`, `analysis_id?`, `analysis_unit_id?`, `source_text`, `translation_zh?`, `source_type`, `source_title?`, timestamps | 保存独立快照；analysis 可空或删除后置空                      |
| `tags`                                   | `id`, `owner_user_id`, `normalized_name`, `display_name`, timestamps                                                                                         | `(owner,normalized_name)` 唯一；仅用户确认后创建             |
| `learning_item_tags`                     | `learning_item_id`, `tag_id`                                                                                                                                 | 复合主键；两端 owner 必须一致                                |
| `schedule_states`                        | `learning_item_id`, `owner_user_id`, `level`, `due_at`, `consecutive_mastered`, `last_rating`, `revision`, timestamps                                        | 新项 level -1/due null；已练 level 0–5；三类 rating 严格枚举 |
| `learning_duplicate_suggestion_requests` | owner/source revision/key/hash/state/generation/lease/dispatch/reservation/price、candidate aliases、bounded response/error、timestamps                      | forced RLS restricted task；terminal≤24h；账号删除级联       |

`learning_items.content` 使用严格判别联合：

```ts
type LearningItemContent =
  | {
      type: "expression";
      text: string;
      meaningZh: string;
      usageZh: string;
      register?: "neutral" | "formal" | "informal" | "literary" | "spoken";
    }
  | {
      type: "sentence_pattern";
      template: string;
      slots: Array<{ name: string; descriptionZh: string }>;
      functionZh: string;
      usageZh: string;
    };
```

PracticeHistory detail 的 `itemLabels` 是同一 owner transaction 内由 `practice_session_items` 连接
`learning_items.content` 得到的只读投影，不新增快照列或第二份学习项正文。expression 使用 `text`，
sentence-pattern 使用 `template`；`deleted_at` 非空或 content 已擦除时不投影 label，页面只能显示固定墓碑
文案。投影按 session position 排序，并由 strict contract 校验与全部未擦除 session item 一一对应。

规范键执行 Unicode NFKC、首尾空白清理、内部空白折叠和英文大小写折叠。Expression 保留标点但
统一弯/直引号；SentencePattern 还要按槽位顺序规范成稳定占位符。跨类型不比较唯一键。标签使用同样
的 NFKC、引号/空白统一和英文大小写折叠作为唯一键，并保留首次确认时的 display name。

`learning_items.archived_at` 为 null 表示 active，非 null 表示可逆归档时间。归档不改 ScheduleState 或
既有关系；默认学习库、DailyPracticeQueue 和新 session item lookup 只读 active，详情和账号导出可读两种
状态。恢复清空 archived_at 并沿用最新排期。列表索引覆盖 `(owner_user_id,archived_at,created_at,id)`。

维护写操作在一个 owner tenant transaction 内重验 revision。硬删除仅允许没有
`practice_session_items` 引用的 LearningItem，并级联 ScheduleState、SourceExample 与
`learning_item_tags`；孤立 Tag 行保留以供规范键复用。安全合并只允许 source 没有练习引用且
ScheduleState 仍为 level -1；target 的 identity/core/schedule 原样保留，元数据与来源去重追加后 source
硬删。archive/restore 保留全部关系并递增 revision；归档项不能 patch/merge/suggest。

语义建议 request 使用 `(owner_user_id,idempotency_key)` 唯一键；request hash 固定 source ID/revision 与
prompt/schema version，候选 alias→item ID/revision 只由服务器创建。未 dispatch 租约过期时释放 reservation
并删除旧 request，使同 key 可新 claim；已 dispatch 过期时按预留上限写唯一 failed ledger 并终态失败。
completed/failed 只保存 bounded public response 或 allowlisted error，最多 24 小时后由 `SKIP LOCKED`
maintenance 每批总处理不超过 100 条。begin transition 在读取相同 owner/key 后先返回有效 terminal
response/error 或 busy/conflict；仅新 generation 才校验 `model_price_versions` 的 provider/model/三项单价，
随后执行 kill switch/额度检查并创建 reservation。当前 begin 原子插入 `running` + lease，不伪造一个尚未
落库的 `pending` 阶段。

已练习项的不可逆删除采用 LearningItemErasure。`learning_items.deleted_at` 为空时 type/canonical_key/
content 必须齐全；非空时三者必须为 null、system_attributes 为空且 archived_at 清空。墓碑只保留 owner、
opaque ID、revision 与创建/抹除时间，不进入 LearningItem schema。抹除同时删除 ScheduleState、
SourceExample 和 tag joins；PracticeSession 不变并通过 `learningItemDeletedAt` 解释 opaque ID。正常 view、
identity、queue 与 session create 固定排除墓碑；最后一条 practice reference 删除后墓碑 hard-delete。
学习库 detail/list 的 `hasPracticeHistory` 由 `practice_session_items EXISTS` 投影，不能用最近 completed+rating
摘要代替。完整事务与并发规则见 `learning-item-erasure.md`。

## 单词与外部词典

LocalLexiconEntry 位于每个 Store Extension 的加密 IndexedDB，不属于本文件的 Postgres 表，也不按账号
分区。登录/退出/换号不清除；它与 WordEntry 只通过 CloudWordCopy 或用户显式确认的本机批量导入单向相交。

| 表                        | 关键字段                                                                                                                                 | 约束与语义                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `word_entries`            | `id`, `owner_user_id`, `headword`, `canonical_key`, `notes?`, `revision`, timestamps                                                     | `(owner,canonical_key)` 唯一；不建 ScheduleState                       |
| `context_observations`    | `id`, `owner_user_id`, `word_entry_id`, `source_text?`, `contextual_meaning?`, `source_type`, `source_title?`, `observed_at`, timestamps | 同批重复使用内容 hash 幂等；确认时保存可信来源快照；欧路来源可没有语境 |
| `external_wordbook_jobs`  | `id`, owner, target/direction/state, `next_page?`, `last_error_code?`, lease nonce hash/expiry、revision、timestamps                     | HMAC-signed token 明文不落库；同类只有一个未终态任务                   |
| `external_wordbook_items` | `id`, owner, job/word IDs, `payload_snapshot`, state、attempt count、stable error、receipt、timestamps                                   | `(job,word_entry)` 唯一；payload/receipt 是 server strict snapshot     |

WordEntry headword/canonical key 是不可变 identity，当前 PATCH 只替换可空 notes 并递增 revision；
ContextObservation 是不可编辑的来源快照，公开详情按 `(observed_at,id)` 降序分页。词条 hard-delete 只在没有
`external_wordbook_items` 引用时开放，并级联 contexts；已有任务引用不能借现有 ON DELETE CASCADE 静默抹去
任务 item/receipt，因此返回 `word_entry_in_use`。`word.patch|word.delete` 使用 owner operation/key/hash 与
删除前响应快照。当前 0001 是未发布 bootstrap，既有开发库需重建，不能当增量 migration 重放。
Phase 47 开始持续用户验收前必须冻结这份 canonical baseline；验收数据库建立后，任何 schema 变化都
只能新增 forward-only migration，并至少验证空库重建、baseline→当前升级和一次失败迁移回滚。seed 与
首个账号 bootstrap 不能手工掩盖 schema 缺口。local seed 只可在显式 destructive reset 中创建固定虚构
Operator/profile/admin role，并调用已迁移的默认额度 helper；不得成为 Auth、邀请、session、学习数据或
环境 provisioning 权威。hosted/production 首位 Operator 只走 forward migration 提供的
FirstOperatorBootstrap，不能复制 local seed。完整环境路线见 `user-acceptance-environment.md`。

external job state 是 `pending|active|completed|failed|cancelled|source-limit-reached`；export item state 是
`pending|in-flight|delivered|failed|cancelled`。export 创建在同一 transaction 中快照现有 WordEntry：Eudic
保存 `{headword,contextLine?}`，Shanbay 只保存 headword。import 不预建未知远端词的 item，而是通过
`next_page=0..51` 领取页；成功 receipt transaction 才 upsert WordEntry/context 并建立 delivered item。
公开 processed/failed/total count 从 item 聚合，客户端计数不入权威。完整字段和状态转换见
`external-wordbooks.md`。

手动 upsert 以 `(owner_user_id,canonical_key)` 收敛 WordEntry；notes 只在新建时采用，既有 headword/notes
不被覆盖。可选语境由服务器固定 `source_type=manual` 与 `observed_at=now`，`content_hash` 对严格的手动
语境正文/释义/标题计算且不包含时间，因此同词同内容重复提交不产生第二条记录。新词及首条语境以
revision 1 原子建立；向既有词条成功追加语境时才递增 WordEntry revision。`word.upsert` 的幂等响应保存
word/core 与 created/existing、created/duplicate/omitted 结果，不保存 owner 或内部 hash。

CloudWordCopy 复用相同 owner/canonical/context transaction，但 request 只允许规范词头、精确完整句、
语境释义和设备观察的收藏时间；服务器另保存 received time，拒绝 URL、标题、结果、Provider、Key 和
owner，并固定 ContextObservation `source_type=extension-collection`。它永不覆盖 notes。
`words:import-local` 每个 strict entry 含稳定 `entryKey`、规范词头及 0–1,000 个带稳定 `contextKey` 的
不可变语境；语境只允许完整句、可选语境释义与观察时间。单批最多 100 个词条、1,000 条语境，响应按
entry/context 返回 created/existing/duplicate 和聚合计数。单条 copy 与 batch import 的内容 hash 使用共同
`extension-local-copy` namespace，只含正文与可选释义、不含 collectedAt/sourceType，因此跨两条路径也
精确去重；首次写入的 `source_type=extension-collection|extension-local-import` 保留。既有词条同一批新增
一个或多个语境都只递增一次 revision；零语境词条仍可创建。UI 在首批发送前显示完整快照的词条数与
语境数并只二次确认一次。

## 练习

| 表                          | 关键字段                                                                                                                                                   | 约束与语义                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `practice_sessions`         | `id`, owner, type/status, `prompt?`, dialogue plan, final/item feedback, generation lease, `current_generation_id?`, `completed_at?`, revision, timestamps | pending start 可省略 prompt；完成时间首次写入后固定              |
| `practice_session_items`    | `session_id`, `learning_item_id`, `position`, `rating?`, `schedule_before`, `schedule_after?`                                                              | `(session,item)` 唯一，保证一次会话只计一次                      |
| `practice_turns`            | `id`, `session_id`, `ordinal`, `role`, `content`, `created_at`                                                                                             | role 为 user/assistant；对话 3–5 个用户-助手 round；造句一次回答 |
| `practice_attempts`         | `id`, `session_id`, `answer`, `feedback?`, `submitted_at`, feedback lease, `current_generation_id?`                                                        | 句子作答独立于 dialogue turn；一个 sentence session 一次作答     |
| `practice_generation_tasks` | `id`, owner/session/attempt, kind/state/hash, lease, reservation/price, reserved cost, dispatched time, strict output/error, timestamps                    | 一次可计费平台生成；ready output 应用后清除                      |

阶梯 `D=[1,3,7,14,30,60]` 天。新项任意首次自评都进入 level 0；已有项目“不会”回 level 0，
“勉强”保持 level，“掌握”进入 `min(level+1,5)`。`dueAt=ratingTime+D[level]`；只有“掌握”增加
`consecutiveMastered`，其余清零。自评和排期推进在同一事务中完成。重复提交同一
Idempotency-Key 返回原结果；不同 key 但 revision 过期返回冲突，不能重复推进阶梯。

`practice_sessions_one_active` 将 active 与 awaiting-feedback 都视为账号活跃会话。领域 feedback/generation
lease 使用 token + expiry 做 claim/fencing；句子答案与对话用户 turn 仍在模型前持久化，final 只在 3–5 个
完整 DialogueRound 后 claim，逐项反馈必须一一覆盖 session items。

真实付费调用另由 `practice_generation_tasks` 表达 `claimed|reserved|dispatched|ready|applied|failed|abandoned`。
同 session 只允许一个非终态 task；task ID 是 quota request ID。`claimed|reserved` 尚未 dispatch，可在租约
过期后安全接管；`dispatched` 过期只允许 fencing 的保守结算和 abandoned，不能透明再调用；`ready` 保存
strict output，领域事务应用后置 applied 并清除 output。`sentence-prompt|dialogue-start` pending 时 prompt
可空，不能保存占位正文。完整字段与约束见 `paid-practice-generation.md`。当前 Cloud 未发布，0001 是
bootstrap；既有开发库需重建，不伪装增量升级。

历史列表把未完成会话作为 `completed_at=NULL` 的正式记录稳定列出，再按 `(completed_at,id)` 降序列出
已完成会话。单次删除只允许 completed 或 failed 且无 generation/feedback lease 的 session；FK 级联只
删除该 session 的 items、turns、attempts 与反馈。它不删除或回写 live LearningItem、ScheduleState、
SourceExample；若最后一条引用指向墓碑，则同时清理该墓碑，
因此已评分会话删除后 due、level、连续掌握与最后一次自评保持原值；未评分 completed 会话也可删除。
`practice.delete` 使用删除前响应快照支持同 key 重放。

## 配额

| 表                        | 关键字段                                                                                                              | 约束与语义                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `model_price_versions`    | `id`, `provider`, `model`, token 单价, `effective_from`                                                               | 生效时间不重叠；历史不可修改                       |
| `quota_grants`            | `id`, `user_id`, `period_start`, `period_end`, `limit_micro_usd`, `source`, timestamps                                | 同用户同周期只有一个有效 grant；覆盖写审计         |
| `quota_reservations`      | `id`, `user_id`, `request_id`, `reserved_micro_usd`, `status`, `expires_at`, timestamps                               | status 为 active/settled/released；request 唯一    |
| `model_rate_limit_events` | `owner_user_id`, `request_id`, `occurred_at`                                                                          | request 唯一；共享滚动小时/24 小时计数             |
| `usage_ledger`            | `id`, `user_id`, `request_id`, `feature`, token counts, `price_version_id`, `cost_micro_usd`, `outcome`, `created_at` | 追加写；request/调用序号唯一；失败调用也可产生费用 |

额度余额由 grant 减去 ledger 与 active reservation 计算，不维护可漂移的客户端余额字段。
`usage_ledger.feature` 至少区分 extension-query-translate、extension-query-explain、web-deep-analysis 与
practice 五类生成；全部平台调用共享同一 grant/reservation 并发边界，BYOK 与纯数据写入不入账。

邀请注册事务在写入 profile/sign-in method 后调用默认额度初始化：当前 UTC 月只允许一个未 supersede
grant，默认值为 `1_000_000 micro_usd`、`source=default`；同月已有 admin grant 时保持 admin 权威。
`0002` migration 对既有非 deleting profile 使用同一规则幂等回填。该 migration 不依赖 Supabase
`storage` schema；私有导出 bucket 属于环境 provisioning。

此后每次 production reserve 与 owner quota summary 都复用同一 helper 惰性确保当前 UTC 月 grant，
因此无需依赖月初 CRON；summary 只查询该月，不能返回已过期历史 grant。所有平台模型功能在
`reserve_quota` 内共享每账号滚动 60 次/小时、300 次/24 小时限制；只有新成功 reservation 写一条事件，
active request replay 不重复写，quota 拒绝也不消费限速。事件超过 24 小时后在下一次成功 reserve 清理，
单账号存量受日上限约束。

## RLS 与删除

- 所有用户表启用 RLS。业务连接使用 `NO BYPASSRLS` 专用角色，API 在事务内把已验证 session 的
  userId 写入只读事务上下文，policy 只允许 `owner_user_id` 等于该上下文；跨表写入还必须由用例校验
  owner 一致。客户端提交的 userId 永远不能设置该上下文。
- 管理操作不使用普通用户 RLS 绕行；API 在服务端校验 `admin_roles` 后以专用用例执行并写审计。
- Operator 列表只读取 `user_profiles` 的规范化登录 email、状态、创建时间和无正文聚合；email 在成功
  Supabase 身份验证时刷新，不由管理页修改，也不通过 service role 临时拼接。管理写入使用 actor 归属的
  `idempotency_records` snapshot，邀请明文 token 不进入 snapshot。详见 `admin-operations.md` 和 ADR-0017。
- `account_data_export_jobs` 是 owner-RLS tenant 表，保存 pending/running/ready/failed/expired、format
  version、记录/字节/hash、内部 object metadata 与 lease；同 owner 只有一个 open/ready job。导出在
  同一账号 snapshot 中生成版本化 NDJSON；不包含 owner、session、token hash、凭据、内部审计或
  `reasoning_content`。ready object 设置 24 小时 expiry，signed URL 最长 15 分钟；到期先停止签发再清理。
- `account_deletion_jobs` 是只供受信 worker 访问的非 tenant 运营表，不引用 user_profiles FK。账号删除
  请求先在事务中置 deleting 并撤销 session/pairing；worker 再按 exports→database→Auth stage 幂等推进。
  主库步骤还清理 invitation/claim/auth-flow/audit/runtime-control 中的直接用户 UUID。完成后任务把
  subject_user_id 置空；失败任务保留最小 UUID 供恢复。完整约束见 `account-data-rights.md`。
- disabled profile 重新完成 Supabase 身份验证时只创建 `web_sessions.access_scope=data-rights`；普通认证函数
  仍要求 active+full。deleting profile 不创建 session。这样停用不阻止数据权利，也不会放宽业务 RLS。
- 普通 Google login 使用 `auth_flows.kind=login` 且 ticket_hash=null；callback 只查已存在 profile 与已
  登记 `google` method，不调用 finalize invitation、创建 profile 或补 method。`invite-registration` 保持
  ticket 非空并只登记实际注册 method。
