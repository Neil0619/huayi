---
status: accepted
---

# 插件查询模型模式按账号全局选择且不自动回退

HuayiAccount 保存 `ExtensionQueryModelMode=platform|byok`，默认 platform，并对全部关联插件生效。设置只
能在 Web 修改；每台插件仍分别保存自己的 BYOK Provider/Key。每次查询开始时固定 mode，额度、网络、
平台停用、Key 缺失或 Provider 失败都不能让 platform 与 BYOK 自动切换。

## Considered Options

- 只支持 BYOK：运营简单，但多数普通用户没有配置 API Key 的能力。
- 逐设备模式：灵活，却让用户难以预测同一账号的费用和行为。
- 故障自动回退：成功率更高，但可能在用户不知情时改变数据接收方或费用承担方。
- 账号全局模式且无回退：需要偏好同步和明确错误，却使费用、隐私和设备行为可预测。

## Consequences

首次配对显示并可修改默认值；插件只读缓存，离线时只允许继续最后缓存的 BYOK 模式。平台模式隐藏
Provider/model 选择并消耗共享 UsageAllowance；BYOK 按设备配置且不计入。模型路由只决定查询调用，
不自动关闭 StudyCapture、CloudWordCopy 或账号云任务。

本 ADR 细化 ADR-0013 的“平台与 BYOK 并存”，并禁止任何隐式双向回退。
