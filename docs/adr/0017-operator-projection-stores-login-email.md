---
status: accepted
---

# 运营账号投影保存已验证登录邮箱

Cloud V1 在 `user_profiles` 保存由 Supabase 身份验证返回并规范化的当前登录邮箱，供受限 Operator
账号列表识别用户；不在每次管理查询中使用 service role 枚举 Auth 用户再与业务库拼接。这样列表、
游标、审计和状态变更能在同一 Postgres 快照内完成，也避免把 service role 变成普通业务读取 adapter。
代价是邮箱变更只能在下一次成功身份验证时刷新，且它属于认证资料，必须进入账号完整导出和删除范围，
不能用于学习数据搜索或公开响应。
