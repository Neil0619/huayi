# Cloud DeepSeek Flash 模型身份迁移（2026-09-10）

范围为 shared Cloud API 候选。根据本次已有本地测试凭据在 2026-09-10T01:59Z 对官方
`GET https://api.deepseek.com/models` 的只读结果，可用 ID 为 `deepseek-flash` 与
`deepseek-v4-pro`；本候选只把 Cloud 固定 Flash ID 从 `deepseek-v4-flash` 改为
`deepseek-flash`。该枚举证据不能单独证明营销名称 V4.1 与 API ID 的对应关系，也不能证明新费率。
Hosted 配置中的模型密钥为不可回读的 sensitive 变量，尚未确认它与本地测试凭据相同。

2026-09-10T02:33Z 经用户批准，用上述本地测试凭据完成且仅完成两次真实 Chat Completions
流式检查：分别请求 `deepseek-v4-flash` 与 `deepseek-flash`，均为 HTTP 200，实际返回的 `model`
均为 `deepseek-flash`。每次 usage 为未缓存输入 61、输出 16 tokens，正常 `stop` 并收到 `[DONE]`。
同一原始响应只在内存中分别交给旧解析器和本候选解析器：旧解析器均在 `frame-schema` 阶段报
`model_response_invalid`，本候选均完整接收并保留严格 usage。没有保存模型正文或密钥，也没有业务数据库写入。

生产截图诊断编号 `31538332-c693-4237-8660-927aea57fdd9` 对应的安全诊断同样记录了
`frame-schema` 失败；上述真实响应复现确认了旧固定模型名校验的缺陷。生产诊断没有保留当时的原始
响应，不能据此断言该历史请求只有这一个字段异常。两次检查是翻译 JSON 的传输及 usage 合同检查，
不是 Hosted 上完整学习流程的业务验收，也不能单独证明未带版本号的 API ID 已对应营销版本 V4.1。

`deepseek-model-identity.ts` 是无依赖的唯一身份常量：Provider 请求、SSE/JSON 严格响应校验、
新分析元数据、reserve/dispatch 价格行校验必须使用同一 ID。旧 ID、Pro 和未知 ID 的新响应均拒绝，
不重写 Provider 身份，不自动回退。历史记录、usage ledger、不可变价格行和旧元数据保持原样；
历史结算/回放测试仍保留旧模型数据。

本次保留各流程 thinking 设置、最多两次 Provider 调用（至多一次结构修复）、严格 usage/cost 校验、
durable dispatch 及固定费用快照，不增加透明重试。Classic、Native Host 和 Store BYOK 不在迁移范围。

## 2026-09-10 定价依据与内部配额参考估值

用户在本任务提供的 DeepSeek 官方平台公告指定 **2026-09-10T04:00:00.000Z**（北京时间 12:00）
生效：每百万 tokens 的 cached input / cache miss input / output 非高峰价格为 **CNY 0.02 / 1 / 4**，
高峰为 **CNY 0.04 / 2 / 8**。[官方中文定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)
核实的高峰规则为北京时间周一至周五 09:00–12:00、14:00–18:00，即 UTC 半开窗口 `[01:00,04:00)`
和 `[06:00,10:00)`；周末全部采用非高峰价格。新价格只在公告生效后选择，生效前保留既有历史选择行为。

现有配额与账本单位继续使用 micro-USD。新价格的 USD 数值是固定的**内部配额参考估值**，不是
DeepSeek 官方美元费率、实际外汇成交价或支付扣款金额，不需要等待官方另发 USD 费率才能完成此口径。
依据 [ECB 2026-09-09 欧元参考汇率](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.hr.html)，
每 EUR 对应 USD **1.1652**、CNY **7.8159**，故固定 `USD/CNY = 11652/78159`。此汇率不会随运行日更新。

`apps/api/src/deepseek-flash-tariff-20260910.ts` 版本化保存原始 CNY 微单位、公告生效时间、窗口来源、
ECB 日期/原始值/来源、有理数和舍入规则。先用 BigInt 计算
`ceil(官方 micro-CNY 单价 × 11652 / 78159)`，逐项上取整到每百万 tokens 的整数 micro-USD；
既有按 usage 的各分量上取整继续保留。六项结果如下，不能将表中的 USD 参考值称为官方美元报价：

| 时段   | 官方 CNY cached / input / output | 内部 micro-USD cached / input / output |
| ------ | -------------------------------- | -------------------------------------- |
| 非高峰 | 0.02 / 1 / 4                     | 2,982 / 149,081 / 596,323              |
| 高峰   | 0.04 / 2 / 8                     | 5,964 / 298,162 / 1,192,646            |

不修改 schema、公开 API、配额默认值或币种，不新增运行时依赖，不允许环境注入任意单价。
`DeepSeekPriceSchedule` 在每次实际 dispatch 时读取可信服务器 UTC 时间，因此同一个长驻实例可跨越
04:00 生效点。旧三个常量与 `byId` 查找结果保持稳定，新两个快照加入相同的不可变查找表。
reservation 继续按旧 peak 的 **14,000 / 440,000 / 1,320,000** 上限占用，逐项覆盖旧价与所有新价；
实际 usage 按 dispatch 固定的快照结算，结算时跨窗不会改价。

## 验收环境专用不可变价格行计划

以下映射仅用于既有 `seen-said-acceptance-api` / `api.acceptance.seen-said.cn` 及隔离验收数据库
`kpadiulxkgckskcfydry`，全部为 `provider=deepseek, model=deepseek-flash`。
这是已准备的插入与配置方案；表格本身不证明远端已执行。旧模型 UUID、历史价格行与 usage ledger
不得 update/delete，不复用旧模型 UUID。旧三档为了通过新身份校验也各使用新 UUID，保留原日期和价格。

| 环境 UUID 键（前缀均为 `HUAYI_DEEPSEEK_`） | 新 UUID                                | cached / input / output micro-USD | effective_from（UTC） |
| ------------------------------------------ | -------------------------------------- | --------------------------------- | --------------------- |
| `LEGACY_PRICE_VERSION_ID`                  | `c2da2e72-df3e-4367-9f44-893d573b4536` | 2800 / 140000 / 280000            | 2026-08-16T15:59:59Z  |
| `OFF_PEAK_PRICE_VERSION_ID`                | `88399b8b-9762-465e-9338-4b37727bd272` | 7000 / 220000 / 660000            | 2026-08-16T16:00:00Z  |
| `PEAK_PRICE_VERSION_ID`                    | `852532f1-28a3-4a0b-8b4c-8faf37fe3002` | 14000 / 440000 / 1320000          | 2026-08-16T16:00:01Z  |
| `20260910_OFF_PEAK_PRICE_VERSION_ID`       | `7717feb2-9a67-46d9-9cba-ccf3765e04d1` | 2982 / 149081 / 596323            | 2026-09-10T04:00:00Z  |
| `20260910_PEAK_PRICE_VERSION_ID`           | `aa7bbda9-3270-4df5-a70c-77d4a704add0` | 5964 / 298162 / 1192646           | 2026-09-10T06:00:00Z  |

新高峰行的 `effective_from` 是公告后第一个适用高峰 06:00，公告的全局生效点仍为 04:00。
五个 UUID 都必须提供且互异；缺失、格式错误或重复会阻断 API 配置读取。reserve/dispatch 仍原子检查
数据库 UUID、provider、model 和三项价格，缺行或不匹配均在 Provider 调用前失败关闭。
后续改价必须增加新的版本化依据、快照和 UUID，不能覆盖本次估值或历史行。

此前 `deepseek-v4-billing.md` 保留为旧实现背景；本文件规定本次新 ID 与新估值的范围。
目前核实的是 API 实际返回 `deepseek-flash`，尚未独立证明其对应营销版本 V4.1；不得把这次身份兼容与
CNY 定价更新写成营销别名已验证的证据。

离线回归覆盖新 ID 的 SSE/JSON 接收、旧 ID/Pro/未知 ID 拒绝、请求与生成元数据一致性、
指定字幕 “Not for any new products, but for what's going on behind the scenes.” 的完整输出及 usage，
以及 SQL dispatch 对匹配/不匹配模型和价格的原子校验。定价回归增加生效前 1ms/精确 04:00、周一至
周五半开窗口及周末、六项有理数舍入上下界、五个唯一必填 UUID、旧 ID 查找稳定及 reservation 上限。
PGlite 生产组合以模拟 Provider 覆盖旧 reservation → 新 dispatch，以及 dispatch → settlement 跨生效点
与峰谷边界，核实 request/ledger 固定 UUID、已知 token 的独立成本、结算状态和无新调用的 terminal replay。

这些是离线合同及数据库证据。本文件不是部署或页面验收回执；验收部署、完整学习流程、实际平台扣费、
页面效果及生产环境迁移均需各自的新证据。Hosted-only 发布必须提供上述五项配置与五条匹配新行；
正式生产环境的 UUID 与发布配置不在本次变更范围，不得直接沿用旧三 UUID 生成器部署本候选。

`scripts/acceptance-local-bootstrap.mjs` 同步支持本机模拟验收：生成五个独立本地 UUID 并插入、核实
相同的五档 `deepseek-flash` 快照。读取旧三 ID 本地配置时保留凭据并生成五个新 ID，历史行不改写；
读取完整五 ID 配置时复用其 ID。部分缺失、无效或重复 ID 拒绝生成 SQL。该脚本没有使用上表的 Hosted UUID。
本次只执行纯配置与 SQL 生成测试及内存 PGlite 核验，没有运行真实本机 bootstrap。
旧 `scripts/acceptance-hosted-deployment.mjs` 与正式 `scripts/production-release-environment.mjs`
仍保留历史三 ID 及原门禁，未因这次 Hosted-only 更新启用；本次验收发布使用独立准备的五项精确配置。
