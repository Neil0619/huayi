---
status: accepted
---

# Classic 行为仍是 Cloud Extension 的查询功能下限

Cloud Extension 继续继承 Classic 0.13 已验证的网页/YouTube 选区、ActionCard、六类严格结果、模式
切换、取消、错误重试和媒体暂停所有权，取代 ADR 0007 对纯本地 Store 的描述。云端方案只改变持久
学习动作：登录后的完整结果进入 Web 待整理区，浮层不再直接编辑或保存本地词条；未登录 BYOK
查询仍只存在于当前 CardSession。

ActionCard 是独立的紧凑双按钮入口，不复用 ResultCard 的固定宽度和品牌头。进入分析后才建立
ResultCard 稳定壳层；Provider JSON 增量沿用 Classic 的 tokenizer、文本 delta 与已校验结构化 section
映射，完整结果仍需通过模型和公开结果 Schema。Cloud 可以改变传输 envelope，但不得把渐进结构
降级为只在结束时一次渲染，也不得自行缩写已经验证的 Provider prompt 或输出约束。

## Consequences

Cloud 工作不能以 Web 重建为理由降低扩展查询体验，也不能把 Classic Native Host、wire v7 或平台
差异带入 Cloud。原本写入本地词典的顶部生词动作、纯本地历史假设和 Store BYOK-only 限制不再是
对齐要求。

## Amendment

ADR-0019 以 StudyCapture 取代“完整结果进入待整理”，但不改变本 ADR 的查询体验下限。ADR-0020 恢复
本机生词动作：单词永远先写 LocalLexiconEntry，再按账号偏好可选提交 CloudWordCopy。
