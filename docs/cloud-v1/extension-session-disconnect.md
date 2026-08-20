# 华译 Cloud V1 Store 设备安全断开方案

状态：需求、技术方案、离线实现与实现后复审已完成；`implemented; target-platform validation pending`。
影响平台：shared（Store Extension + API + Web 设备投影）。Classic/Native Host 不受影响。

## 1. 背景与目标

当前 Store Popup 的“本机断开”立即删除 ExtensionSessionVault 与账号绑定队列，但服务器
DeviceSession 仍保持有效，直到 Web 设备页撤销或 90 天到期。该行为虽然没有伪称服务器撤销，却让一次
常见的“断开此设备”操作留下仍有效的 bearer credential，与账号页设备投影和用户安全预期不一致。

本切片把动作校准为 **DeviceDisconnect（设备安全断开）**：当前安装持有哪个 DeviceSession，就只撤销
该服务器会话；服务器确认后再清除本机账号会话、pending pairing、账号偏好缓存及账号绑定任务。它不
退出 Web、不撤销其他设备，也不删除本机 LocalLexiconEntry、BYOK/Eudic 凭据或网站设置。

## 2. 产品语义

1. Popup 已连接状态的动作改名为“断开此设备”；点击后先尝试撤销当前服务器 DeviceSession。
2. 服务器返回 204 后，Service Worker 才清除本机 session、pending pairing、SubmissionOutbox、
   CloudWordCopy 批量导入任务及其他现有 account-data clearer 覆盖的数据；LocalLexiconEntry 和独立本机
   凭据保持不变。
3. 网络、超时或 5xx 时不清 token、不清队列，Popup 显示“暂时无法安全断开；本机会话仍保留，请联网后
   重试”。不能显示 disconnected，也不能把失败伪装成成功。
4. 已被 Web/管理员撤销、已过期或服务器上不存在的 token 仍可通过 self-revoke route 得到 204；服务端
   不泄露 token 是否存在。随后本机正常清理。
5. pending pairing 尚未产生服务器 DeviceSession；断开只需清 pending secret 和账号绑定队列，不调用
   self-revoke。
6. 断开不要求最低支持版本。旧客户端也必须能够安全撤销自身，但仍要求合法三段版本 header、固定
   Extension Origin 与严格 `HuayiExtension` token 语法。
7. 本操作不提供离线“仅忘记本机”快捷路径。若立即清 token，服务器撤销能力会永久丢失；用户仍可从
   Web 设备页撤销离线设备。

## 3. HTTP 契约

新增固定端点：

```http
DELETE /v1/extension-session
Origin: chrome-extension://<release-extension-id>
Authorization: HuayiExtension <current-token>
X-Huayi-Client-Version: <strict-semver>
```

- 请求无 Cookie、CSRF、body、session ID、owner ID 或 Idempotency-Key；
- 有效 proof 统一返回 204，无响应 body；随机、过期、已撤销 token 也返回 204；
- Origin、Authorization scheme/token shape 或版本语法非法返回 403；
- endpoint 不执行最低版本 426 gate，因为安全退出不能被升级阻断；
- token 只可撤销自身，不能提交任意 session ID 或 user ID；
- CORS 仍只允许候选 Extension Origin，响应 `Cache-Control: private, no-store`。

Store `CloudIdentityApi.disconnectExtensionSession(token)` 只接受 204。非 2xx 只保留安全 code/status，不读取
或显示服务器 message。Service Worker Runtime message 保持无参数，Popup/Options/Content Script 都不能
获得 token、session ID、API URL 或请求结果正文。

## 4. 数据与事务

不新增表或客户端 secret。bootstrap migration 增加 trusted 函数：

```sql
revoke_current_extension_session(token_hash text) returns boolean
```

函数只执行：

```sql
UPDATE extension_sessions
SET revoked_at = COALESCE(revoked_at, now())
WHERE token_hash = $1
  AND revoked_at IS NULL
  AND expires_at > now();
```

返回值只供内部测试，不进入 HTTP。函数为 `SECURITY DEFINER`、固定 `search_path`，撤销 PUBLIC 与业务角色
执行权，只授予 trusted context setter。数据库保存的仍是 peppered hash，日志、错误和 rate-limit key 都
不得出现 token/hash。

Service Worker 顺序固定：

1. 读取加密 session；没有 session 时只清 pending/local account-bound data；
2. 调用 self-revoke；204 是远端提交点；
3. 再运行现有 account-data clearer、清 pending 与 ExtensionSessionVault；
4. 返回 `disconnected`；任一步远端提交前失败都保留原 session 和账号绑定数据。

若 204 响应丢失，客户端保留 token 并重试；服务器第二次仍统一 204，因此最终可安全清本地。若服务器
已撤销而本地清理失败，下次重试同样得到 204，再完成本地收口。

## 5. 安全与隐私

- self-revoke 是持有当前 token 即可使用的单用途最小权限能力，只能减少权限；不依赖 profile active，
  不列举或探测 session；
- 不接受客户端 session ID，避免跨设备、跨账号撤销面；
- 不用幂等表保存 token/hash；数据库更新天然幂等，HTTP 统一 204 防止状态枚举；
- Popup 只显示成功/可重试失败，不显示 token、API origin、request ID 或内部错误；
- local-first WordEntry、BYOK/Eudic 凭据与网站偏好不属于 HuayiAccount，不因断开删除；
- 账号绑定队列必须在远端确认后清除，避免断开后由旧账号正文继续提交。

## 6. TDD 与测试矩阵

### Contracts/API/Postgres

1. 固定 singular route，拒绝客户端提交 session/owner/body；
2. exact Origin + token scheme/shape + strict version 才可调用，旧于 minimum 的合法版本仍可退出；
3. 当前 token 原子撤销且 Web account/device list 立即不再投影；其他设备保持有效；
4. 随机、已撤销、过期 token 统一 204；跨账号无法指定目标；
5. SQL 函数 security-definer/search-path/grant/revoke 与 token/hash 无日志；
6. production composition 路由存在，开发态错误配置继续失败关闭。

### Store/Popup

1. API adapter 使用 DELETE、credentials omit、严格 extension headers、无 body；
2. connected disconnect 先远端 204，再清 session/pending/account-bound data；调用顺序可观察；
3. 网络/5xx 时 session、pending 和队列零变化，状态不冒充 disconnected；
4. pending/disconnected 不发 self-revoke；
5. Popup 文案为“断开此设备”，成功后显示未连接，失败显示可重试的安全提示；
6. Runtime response/DOM 不出现 token、URL、session ID、服务器 message。

### Actual bundle journey

离线 CloudBrowserAuthority 为当前 Store session 建立服务器设备投影。journey 形成离线待提交内容后点击
“断开此设备”，证明 self-revoke request 先发生、服务器设备计数归零、旧 token 后续请求失败、本机队列
清空、LocalLexiconEntry 保留；另用一次网络失败证明本地 session/queue 保留且可以重试成功。

## 7. 验收标准与执行顺序

执行顺序固定为 glossary/ADR/contracts → SQL/API → Store adapter/manager → Popup → actual bundle journey。
每层先观察 RED，再做最小 GREEN。

验收必须证明：

- 成功断开不留下有效服务器 DeviceSession；
- 不撤销其他设备、Web session 或本机独立数据；
- 远端失败不会丢失撤销能力或账号绑定正文；
- 旧/随机 token 不可探测，旧客户端不会被 426 阻止退出；
- 默认测试离线；contracts/API/PGlite/Store focused、全 workspace typecheck/build、Vitest/Playwright、
  instructions/architecture 与任务文件 ESLint/Prettier 通过；
- 未完成真实 API/Chrome 双平台验证前保持 `implemented; target-platform validation pending`。

## 8. 实现前与实现后复审

复审确认 self-revoke 不接受 owner/session ID，持有 token 只能减少自身权限；统一 204 让响应丢失后的
重复请求可安全收口，也不暴露 token 状态。logout route 独立于 minimum-version gate，但保留 exact Origin
和严格版本语法，旧客户端不会被 426 困住。

现有 `clearAccountData` 已组合 SubmissionOutbox、外部词典 lease 和本机批量导入任务；偏好缓存在加密
session 内随 session 一起删除，LocalLexiconEntry 与 BYOK/Eudic 凭据不在该 seam 中。因此 remote-first
不会在服务器确认前误删账号绑定正文，也不会扩大到独立本机数据。account switch 复用同一 disconnect，
断网时必须先恢复网络或从 Web 撤销，不能用换号绕过安全顺序。Web 设备列表继续只读服务器权威。

拒绝新增离线 revocation secret/outbox：它会在用户以为已断开后保留另一份凭证并扩大 vault/migration
面；也拒绝 best-effort 后无条件清本地，因为它重现原安全缺口。当前方案无需新增数据列，路线可进入
离线实现。

实现后复审确认代码与上述边界一致：singular contract、无最低版本闸门的 DELETE adapter、固定
`search_path` 的 self-revoke SQL、remote-first Store manager、Popup 安全失败文案和 actual bundle
authority 已接线。Postgres 细节没有塞回临界尺寸的身份聚合模块，而是由独立 adapter 隐藏 token hash、
trusted transaction 与无返回值语义；生产组合和测试内存 adapter 共同证明 `revoke(token)` 是真实 seam。

未发现需要反向修改产品目标的偏差。实现没有增加新表、客户端 secret、离线撤销队列或 Classic wire；
其他 DeviceSession、Web session、LocalLexiconEntry、独立凭据和网站设置仍保持原权威边界。

## 9. 实现证据与待验收项

- DeviceDisconnect focused Vitest：9 个文件、53 项通过；
- workspace typecheck 通过；完整单元/数据库集成测试 411 个文件、2580 项通过、12 项既有平台条件跳过；
- workspace build 通过；Playwright actual bundles 93/93 通过；
- architecture、任务文件 ESLint/Prettier 通过；
- Web build 仍有既有 500 kB chunk warning，不是本切片新增失败；
- 真实 API、真实发布 Chrome、macOS/Windows 手工断开与设备页投影验证尚未执行，且分别需要批准；在此
  之前状态保持 `implemented; target-platform validation pending`。
