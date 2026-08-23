# DeepSeek V4 Flash usage 与分时计费校准

## 1. 范围与官方事实

影响平台为 `shared + macOS + Windows`；只修改 Cloud V1 API 的平台模型 adapter、服务端价格选择和
账本组合，不改变 Classic wire v7、Native Host、Store BYOK 或浏览器权限。

DeepSeek 官方当前约束如下：

- 固定模型仍为 `deepseek-v4-flash`，非流式 thinking 响应的 `usage` 允许包含
  `completion_tokens_details.reasoning_tokens`；该字段只用于兼容严格 Provider envelope，不进入公开
  `ModelUsage`、日志或账本，账本的 `output_tokens` 继续使用包含 reasoning 的 `completion_tokens`；
- 2026-08-16T16:00:00Z 前，cached input / cache miss input / output 价格分别为
  2,800 / 140,000 / 280,000 micro-USD per million tokens；
- 生效后 off-peak 价格为 7,000 / 220,000 / 660,000，peak 价格为
  14,000 / 440,000 / 1,320,000 micro-USD per million tokens；
- peak 使用 UTC 半开区间 `[01:00,04:00)` 与 `[06:00,10:00)`；生效点本身落在 off-peak。

这些价格是代码中的受审计常量，不再允许部署环境提交任意单价。环境只提供 legacy、off-peak、peak
三个不可变 `model_price_versions` UUID；reservation 始终按 peak 上限保守占用，请求在紧邻 Provider fetch
之前的 durable dispatch transition 读取服务端可信 UTC 时刻并选择一个完整实际计费快照。

## 2. 深模块设计

`DeepSeekPriceSchedule` 是唯一时间路由权威：

```ts
interface DeepSeekPriceSnapshot {
  priceVersionId: string;
  prices: ModelPrice;
  tier: "legacy" | "off-peak" | "peak";
}

interface DeepSeekPriceSchedule {
  at(now: Date): DeepSeekPriceSnapshot;
  byId(priceVersionId: string): DeepSeekPriceSnapshot;
}
```

`at` 只读取传入的服务器 UTC 时间，并精确处理生效点和半开窗口；`byId` 供已持久化的 reserved task
恢复同一快照。两个方法都返回防止调用者改写的不可变值，未知 ID 或无效时间失败关闭。

四条付费路径遵守相同顺序：

1. 新 generation 先使用 peak 价格计算最坏 reservation；此时还没有 Provider 副作用，也不把 begin
   时窗误当成实际计费时窗；
2. 紧邻 fetch 的 durable dispatch transition 使用同一个服务端 `now` 选择 legacy/off-peak/peak，并把
   `dispatched_at` 与 `price_version_id` 原子持久化；
3. `require_model_price_version` 在该 transition 内要求 UUID、provider、固定 model 和三项代码价格与数据库不可变行完全
   一致；任一不一致都在 Provider fetch 前映射为 `model_unavailable`；
4. Provider 的每次实际调用都用同一快照计算 billed call；completion/failure settlement 使用 request/task
   已固定的 UUID，不能在跨峰谷边界后重新选择；
5. terminal replay、active busy、旧 lease fencing 和 dispatched 后保守结算继续使用既有持久化价格版本，
   不产生第二次 Provider 调用或按“当前价格”改写历史。

`model_price_versions` 和 `usage_ledger` 已具备不可变行、外键与 append-only trigger，因此本次不新增表。
ExtensionQuery、duplicate suggestion 与 practice task 已有 `dispatched_at`；analysis request 需要最小增加
`dispatched_at` 以及原子 dispatch transition，才能区分 pre-dispatch 安全释放与 post-dispatch 保守结算。
上线前只通过受控 migration/运维步骤插入三个新 UUID 对应的精确行；禁止 update/delete 历史价格。未来
调价必须新增代码快照和数据库行，不能复用 UUID。

## 3. 接口与数据边界

- 内部 quota reserve 固定使用 peak 快照做价格行校验和保守占用；HTTP/SSE/Cloud contracts 不增加价格字段；
- durable dispatch 返回选中的快照；model/provider 调用只接收其 `prices`，不读取当前时钟；committer/store settlement 接收固定
  `priceVersionId`，不重新路由；
- practice 的 dispatch 结果在 API 内部携带快照。`reserved` task 尚未固定实际价，可按接管后的真实
  dispatch 时刻选择；`dispatched` task 已固定且永不透明再调 Provider；未知持久化 ID 失败关闭；
- Provider `completion_tokens_details` 使用严格对象，允许为空或只含可选非负安全整数
  `reasoning_tokens`，拒绝其他
  未知字段；该兼容字段不改变 `total_tokens = prompt_tokens + completion_tokens` 不变量。
- Provider envelope 的 `model` 必须逐字等于 `deepseek-v4-flash`。空值或任意其他非空模型均在解析阶段
  失败关闭，禁止把 Provider 实际返回的其他模型改写成固定模型后继续保存或结算。

## 4. TDD 与验收

Fresh RED 必须先证明：

1. 合法的 `completion_tokens_details.reasoning_tokens` 当前被 strict response schema 拒绝；
2. Provider 返回其他非空 `model` 时当前会被错误接受并以固定模型写入元数据；
3. 单一部署价格无法表达 legacy/off-peak/peak，且边界 dispatch 不能固定正确 UUID；
4. begin 后在 pre-dispatch lease reclaim 跨窗的请求若按 begin 选价，会与实际 Provider dispatch 费率不符。

GREEN 验收矩阵：

- 时间：生效前一毫秒、精确生效点、00:59:59.999/01:00、03:59:59.999/04:00、
  05:59:59.999/06:00、09:59:59.999/10:00 UTC；
- schema：reasoning token 字段接受、非整数/负数/未知字段拒绝，公开 usage 仍只有 input/cached/output；
- 模型身份：四条付费路径共享同一个 strict Provider envelope，错误 `model` 必须零成功结果、零伪造元数据；
- 组合：四条付费路径按 peak reserve，再以 dispatch snapshot 完成 fetch→actual ledger；begin/reclaim 可跨窗，
  dispatch→settlement 跨窗不漂移；
- production acceptance：完整组合必须证明 request 已 durable dispatch、实际价格 UUID 同时进入 request 与
  ledger、reservation settled、单条 usage token/cost 正确、record model metadata 与 ledger 一致；
- 数据库：三个 UUID 与三项精确价格逐一校验；不匹配零 Provider；ledger 引用固定 UUID；
- 生命周期：same-key terminal replay、active busy、ready replay、lease fencing、dispatched timeout 保守结算
  和 quota/kill switch 顺序均无回归。

离线门禁至少包含 focused provider/schedule/production/lifecycle/PGlite、API full、API strict typecheck/build、
目标 ESLint/Prettier、instructions 与 architecture。真实 DeepSeek、密钥、费用、部署数据库、安装和 Chrome
均需另行批准，不属于本阶段。

## 5. 实现前自审

- 通过：按 durable dispatch 的服务端可信 UTC 时刻选价并原子固定 UUID，满足准确账本而不是 peak 永久
  近似；begin 不选实际价，因为 pre-dispatch lease reclaim 可跨时窗；
- 通过：价格表与 ledger 的现有不可变约束足以保存历史，无需为时间窗口复制业务表；
- 通过：Provider 不自行读时钟，避免 reserve 与 usage 计算跨边界漂移；
- 通过：pre-dispatch 恢复可按新的真实 dispatch 时刻选择，post-dispatch 只按已存 UUID 保守结算，保留
  replay/lease/fencing 语义；
- 通过：官方 reasoning usage 只作为受限兼容字段，不扩大公开数据或日志；
- 风险控制：三个环境 UUID 必须互不相同并对应三条数据库行；生产配置或数据库任一缺失即失败关闭。

结论：方案不改变公开 API 或 Classic wire；为准确区分 analysis 的 dispatch 边界，需要在未发布 bootstrap
中增加一个内部时间列和 transition，属于最小必要 schema 调整，可以按上述 Fresh RED 推进。
