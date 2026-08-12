---
status: accepted
---

# 以无密码 DeviceVault 取代日常密码门

Store Edition 自动生成随机 256 位设备 DEK，并把严格 envelope 保存到限制为
`TRUSTED_CONTEXTS` 的 `chrome.storage.local`。Provider 凭据、生词、导入任务和导出箱继续使用
现有 AES-256-GCM、独立 IV 与 AAD 密文格式；分析、本地生词和外部词典不再存在初始化、确认恢复
码、锁定、解锁或修改密码的前置状态。生词导出仅提供不含语境的一词一行明文词表，不设置备份密码。

## LegacyVaultMigration

检测到 ADR 0005 的旧 metadata 时，DeviceVault 不生成新密钥，也不覆盖未知状态。Options 只显示
一次旧数据迁移表单，用户可提供旧密码或恢复码。实现先严格解析旧 metadata 并认证解出原 DEK，
再以一次设备 key 写入作为 commit point，最后按 session、wrapper metadata 的顺序幂等清理。认证
或 commit 写入失败时全部旧数据保持可重试；commit 后清理中断时，下次启动从已提交的设备 key
继续清理。畸形 metadata、孤立 session、或缺少 metadata 但已有凭据均失败关闭，绝不重置为新库。

## Consequences

用户重载浏览器或扩展后可直接使用 Provider、本地生词本和外部词典，不再记忆或反复输入本地
密码。代价是设备 DEK 与密文位于同一个 Chrome Profile：取得该 Profile、扩展存储访问权限或
运行中可信扩展上下文的攻击者可以取得 DEK 并解密本地数据。这个方案仍防止磁盘中单条凭据或
IndexedDB 记录以明文出现，但不声称能抵御本地 Chrome Profile 整体泄露。
