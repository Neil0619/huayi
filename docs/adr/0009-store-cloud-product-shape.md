---
status: accepted
---

# Store Edition 由云端 Extension 与 Web App 共同组成

Store Edition 直接演进为同一个云端产品中的两个客户端：Extension 保留就地查询价值，Web App
承载完整分析、待整理内容、学习库和主动练习；Classic 0.13 继续冻结。这个选择取代 ADR 0002 的
“纯扩展且无账户后端”，避免分别发布两个功能重叠的 Store 扩展，也让未来 App 可以复用同一云端
接口。Web 不是扩展的远程代码宿主，Extension 仍须独立满足 Chrome 的单一用途和随包代码要求。

## Consequences

Store Extension 可以在未登录时使用本机 BYOK 做临时查询；登录后，无论 BYOK 还是平台模型，完整
已校验结果都会进入账号的云端待整理区。扩展浮层不承担编辑、标签或合并，复杂学习活动统一转到
Web。尚未发布的本地词库实现不形成兼容或迁移义务。

## Amendment

ADR-0019 修订“完整插件结果进入待整理”：插件结果只属于当前查询，用户送往 Web 的是独立
StudyCapture，之后才显式运行 Web 深度分析。ADR-0020 同时确认本机词库是插件独立使用的正式数据，
不因 Cloud WordEntry 存在而失去产品地位。
