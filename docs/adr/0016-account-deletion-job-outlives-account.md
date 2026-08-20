---
status: accepted
---

# 账号删除任务必须独立于被删除账号

Cloud V1 把 AccountDeletionJob 存在仅供受信运行时访问的运营表中，不让它通过 `user_profiles` 外键随
账号正文级联删除。任务必须在导出文件、主库正文或 Supabase Auth 任一步失败后仍能继续恢复；相较
同步请求内直接级联，代价是短期保留最小用户 UUID、稳定阶段和重试时间，并在完成后立即清除 UUID、
只留下有界运营结果。公开 API 不提供删除任务详情，也不把该表纳入 AccountDataExport。
