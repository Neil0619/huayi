---
status: accepted
---

# 平台模型与 BYOK 并存并使用统一费用账本

Web 只使用平台提供的 DeepSeek V4 Flash；Store Extension 同时保留本机 OpenAI/DeepSeek BYOK 和
平台模型。平台请求使用 thinking high、JSON Output、严格最终 Schema 和至多一次仅修结构的调用；
全部平台分析、语义查重和练习调用共享每账号每 UTC 月默认 1 美元的额度，BYOK 不计入。

## Consequences

平台调用以带生效时间的价格快照和整数微美元记账，先预留最坏费用再按供应商用量结算；同一账号
最多一个并发生成请求。BYOK 凭据永不上传 Huayi，且 BYOK 不自动发起第二次付费修复。达到平台
额度只禁用平台模型，不妨碍 BYOK、浏览、手动录入和已有学习数据。

## Amendment

ADR-0021 进一步规定插件使用账号全局 platform/BYOK 模式，默认 platform，只能在 Web 修改且不按设备
覆盖；任一故障都不自动回退。ADR-0019 规定插件平台查询也是临时 ExtensionQueryGeneration，不自动
成为 AnalysisRecord。
