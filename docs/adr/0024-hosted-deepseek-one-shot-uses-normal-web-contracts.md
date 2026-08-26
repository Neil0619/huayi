---
status: accepted
---

# Hosted DeepSeek 单次验收复用正常 Web 合同与私有证据权威

Hosted Cloud Web DeepSeek 单次验收使用正常 password Web session、recent-auth、Cookie、Origin、CSRF、
Idempotency-Key、`/v1/analyses:stream` 和 request-status 合同；不驱动浏览器 DOM，也不新增
acceptance-only 模型 route/header/body。Analysis module 继续生成 request ID，私有 acceptance authority 在
收到 `analysis.started` 后从服务器 row 取得 owner 并原子绑定 request。

跨进程 single-use、lease fencing 和 cleanup recovery 由 `huayi_private` 中仅管理员可访问的 operation
authority 负责；真实 Provider dispatch、kill-switch mutation 和账本 settlement 仍只发生在既有产品路径。
执行器对调用者只公开 `status/execute/recover` 三入口，opaque ID、Cookie、CSRF、密码、deployment 查询、
SSE 恢复与无正文 receipt 都隐藏在 module implementation 中。

否决真实浏览器 UI 自动化，因为它把 profile/DOM/焦点和凭据生命周期泄漏到 interface；否决私有模型测试
入口，因为它不能证明真实 Web 行为并可能成为生产付费后门。代价是需要新增私有 migration、正常 HTTP
session adapter 与只读 settlement reader，但复杂性集中在一个可由 PGlite/fake 和 production adapters 共同
验证的深 module 内。
