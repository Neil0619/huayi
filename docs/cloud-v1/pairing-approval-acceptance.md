# PairingApproval 生产入口验收方案

## 1. 状态与校准结论

影响平台为 `shared`。Extension pairing 的 state/PKCE、10 分钟过期、pending→approved→consumed 状态机、
偏好原子更新、exchange 单次 session token、Store 加密 pending/session vault 和账号换号 journey 已有离线
证据；Web `/pair-extension/:id` 页面、identity adapter 与组件测试也已实现。当前缺口是 production Web
bundle 的审批入口组合证据。

全局复审同时发现 `api.md` 单点漂移：它声称 approve 需要 `Idempotency-Key` 与 `If-Match`，但权威 Phase
27 方案、strict body、内存/生产 identity module、Postgres transaction 和 Web adapter 都定义为一次性
pending→approved 转换。正确契约是 Cookie+Origin+CSRF 加 strict body 内的
`expectedPreferencesRevision`；丢失 204 后 GET pairing 读到 approved，不能重放 approve。本文同步校正
API 文档，不新增虚假的 idempotency snapshot 或 header 契约。

2026-08-14 已完成文案 RED、actual-bundle RED→GREEN 与实现后复审，状态为
`implemented; target-platform validation pending`。

## 2. 用户需求与安全边界

已登录用户从扩展生成的固定 `/pair-extension/:id` 进入后必须：

1. 先由 Cookie bootstrap 取得 full access 与 CSRF，再读取 pending pairing 和当前账号插件偏好；
2. 看到明确的数据披露：platform 最小选区、StudyCapture、CloudWordCopy 的条件性上传，以及 BYOK
   result/Key、页面 URL、标题、视频 ID、完整页面不上传；
3. 输入 1–100 字符设备标签，并可在批准前原子修改 query model、capture 与 word-copy 三项账号偏好；
4. 未勾选本次云端同步知情同意时按钮不可提交；勾选后才允许批准；
5. approve body 的 `expectedPreferencesRevision` 必须匹配服务器当前 revision；冲突不能批准 pairing 或
   部分更新偏好；
6. 204 丢失或页面刷新时以 GET pairing 的 approved 投影恢复成功态；approval 本身不重放；
7. approved 尚未创建 ExtensionSession；只有 Store 持有的 state+verifier 完成 exchange 后才签发 token。

页面不得接触 state、verifier、install hash、session token、token hash 或 owner。公开测试 snapshot 不保存
设备标签、三项选择、CSRF、Cookie 或请求正文。

## 3. 技术路线与数据结构

### 3.1 actual-bundle seam

- Playwright 加载实际 Web production bundle，并从 `/pair-extension/pairing-approval-1` 进入 route parser；
- 新增独立 `CloudBrowserPairingApprovalAuthority` 与专用 seed；主 authority 仍统一处理 Cookie、CORS、
  Origin 与 CSRF；
- helper 只处理 CSRF 之后的 pairing GET、preferences GET 与 approve POST，所有 body/response 使用
  `@huayi/cloud-contracts` strict schema；
- approve 使用 `webMutationProof`，明确要求无 `If-Match`；不接 idempotency replay seam；
- Store create/poll/exchange、PKCE 与 token vault 已有独立跨端测试，本切片不复制或伪造 extension token。

### 3.2 fixture 与状态机

```text
pairing pending
preferences revision 3 = platform/manual/enabled
  -> user chooses byok/automatic/disabled + device label + consent
  -> POST approve(expectedPreferencesRevision=3, Cookie+Origin+CSRF)
pairing approved
preferences revision 4 = byok/automatic/disabled
  -> page reload GET pairing + GET preferences
approved success view; no second POST; no ExtensionSession yet
```

helper 内部可保存 pairing status 与更新后偏好，仅向页面返回 strict projection；公开 snapshot 只记录脱敏
request facts。

## 4. TDD 与测试矩阵

### 4.1 已有分层证据

- contracts/domain：fixed path、strict create/poll/approve/exchange、三项偏好和 revision；
- identity/Postgres：PKCE/state hash、过期、pending-only approval、revision conflict 原子回滚、单次 exchange、
  consumed 后 404、账号隔离与 token 不公开；
- Web component/adapter：未登录跳登录、pending/approved/error、设备标签、三项默认值、consent gate、
  Cookie/Origin/CSRF 与非法 pairing ID 拒绝；
- Store/cross-end：production CloudSessionManager 的 create/poll/exchange、加密 vault、换号队列隔离与偏好
  session snapshot。

### 4.2 新增 actual-bundle RED→GREEN

1. RED：新增 pairing approval journey，先用旧 `empty` seed，预期在审批页标题失败；
2. GREEN：新增 strict pairing helper/seed，在认证后接线三条 Web API；
3. 断言 pending 页、三项服务器默认值、完整披露与未同意时 disabled；
4. 输入设备标签，选择 byok/automatic/disabled，勾选 consent 并提交；
5. helper 严格验证 body revision、Cookie/Origin/CSRF、无 If-Match/Idempotency-Key，并投影 204；
6. 断言成功态，随后 reload 仍从 GET approved 恢复且 approve POST 总数仍为 1；
7. 断言 GET pairing/preferences 为 `read`、POST approve 为 `write-valid`，公开 snapshot 不含设备标签或
   偏好 body；
8. 390px/reduced-motion、无横向溢出、空 Web Storage 同时通过。

## 5. 验收标准

- focused journey 1/1，完整 Playwright 从 98/98 更新为 99/99；
- Web strict typecheck、目标 ESLint/Prettier、workspace tests、instructions/architecture 通过；
- production route/parser/identity adapter/CloudApp 组合完成 pending→approved，并在 reload 后 GET 恢复；
- approval 恰好一次，revision 3→4，proof 为 Web `write-valid`，无 token/session 创建或私密 snapshot；
- `api.md` 与实现统一为 body revision + one-shot/GET recovery，不再声称虚假 replay headers；
- 真实 Supabase、部署 Cookie、真实 Chrome Web↔Store 配对和双平台验证继续 pending。

## 6. 实现前审查

审查结论：校正文档后路线合理，可以进入 TDD。一次性 approval 与 GET recovery 已由状态机自然提供；为
它增加 idempotency key/If-Match 会要求新公共 header schema、数据库 replay snapshot 与不同错误语义，既
无产品收益也与既有 consumed 安全边界冲突。actual-bundle helper 只补 Web 审批组合层，不重复 Store
exchange 或真实部署验收。

## 7. 实现与复审记录

- 组件 RED 先证明旧审批文案缺少“最小选区/最多一小时”和“标题、视频 ID 不上传”，随后最小修正文案；
- actual-bundle RED 如预期在审批页标题失败，旧 `empty` authority 未伪造 pairing route；
- 新增独立 strict pairing helper/seed；production contracts、API、Postgres 与 identity adapter 零改动；
- production route 已通过服务器三项默认值、完整披露、设备标签、consent gate、revision 3→4、
  Cookie/Origin/CSRF 一次性 204，以及 reload 后 GET approved 恢复；
- approve request fact 恰好一次且为 `write-valid`，GET pairing/preferences 为 `read`，
  ExtensionSession count 为 0，公开 snapshot 无设备标签或偏好 body；
- focused component 8/8、journey 1/1、Web strict typecheck、目标 ESLint/Prettier 与完整 Playwright 99/99
  通过；390px、reduced-motion、无横向溢出和空 Web Storage 同时通过；
- 实现后复审将 helper 的 strict body 错误固定为 400、proof/header 错误固定为 403；未发现其他生产问题。

真实 Supabase、部署 Cookie、Web↔Store Chrome 配对、session token vault 与双平台验证仍未执行，不能由
离线 99/99 替代。
