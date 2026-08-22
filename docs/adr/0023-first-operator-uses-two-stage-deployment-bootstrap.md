---
status: accepted
---

# 首位 Operator 使用两阶段部署引导

空 hosted/production 环境中的首位 Operator 通过两阶段部署协议建立：DeploymentBootstrapAuthority 先以
项目管理员数据库凭据发行唯一 BootstrapInvitation，真实用户继续经过现有邀请领取、Supabase Auth、
profile、sign-in method 与默认额度事务；注册完成后，第二条受控命令只能把该邀请最终绑定的唯一账号
写入 `admin_roles`。协议不新增公开 HTTP route，不复用本机 seed，也不直接构造 Auth/profile。

这样保留了正常账号权威和邀请门槛，同时打破“只有 Operator 才能创建邀请”的启动闭环。代价是部署
需要两次显式命令、一次真实浏览器注册和独立私有 bootstrap record；丢失尚未领取的明文邀请时只能在
零 claim/零 identity 条件下显式替换，不能从数据库恢复 token。DeploymentBootstrapAuthority 不是
Operator，因此其动作不伪装成 OperationalAuditEvent；邀请来源、替换 revision、最终账号和完成时间由
私有 bootstrap record 与邀请生命周期持久记录。协议完成后永久封闭，后续角色管理仍属于独立部署变更。
