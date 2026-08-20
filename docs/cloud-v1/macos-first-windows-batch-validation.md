# Phase 41：macOS 优先开发与 Windows 批量验证规划

## 1. 决策

语见继续保留 Windows 支持，但 Windows 完整离线门禁改为在**候选冻结节点批量执行**，不再要求每个
普通提交或每个小修复后立即去 Windows 重跑全量验证。

日常开发以 macOS 为主：先持续校准产品需求，再按功能切片完成文档、实现、回归和 macOS 验证；当一批
需求暂时冻结、macOS 完整门禁全绿且候选 SHA 固定后，再去 Windows 对这一批累计改动执行一次完整验证。

这项决策只改变验证节奏，不降低双平台发布标准。尚未执行当前候选的 Windows 批次时，状态必须写为：

```text
implemented and verified on macOS; Windows batch validation pending
```

不得把旧 Windows 结果解释为覆盖了之后的新提交，也不得在 Windows pending 时宣称跨平台候选或发布已
完成。

## 2. 当前基线

| 项目                              | 当前事实                                             |
| --------------------------------- | ---------------------------------------------------- |
| 最近一次 Windows 完整门验证的代码 | `3aa143c7f60ba52a941f2a2db587bc93819427eb`           |
| Windows 结果文档提交              | `313b5d4`                                            |
| 当前 macOS HEAD                   | `2a035ee`                                            |
| Windows 验证后新增提交            | `35fc69f` 品牌改名；`2a035ee` 跨平台候选门稳定性修复 |
| 当前裁决                          | 两个提交纳入下一批 Windows 验证，不要求立即重跑      |

这两个提交包含共享品牌文案、构建、E2E 和发布审计调整，不属于 Windows DPAPI、注册表、SEA 或安装器
实现。旧 Windows 结果不能覆盖它们，但可以和后续 Mac 开发成果一起在下一个冻结节点验证。

## 3. 哪些改动可以累计

以下改动在 macOS 完成对应 focused 或阶段门禁后，可以累计到下一次 Windows 批次：

- 产品需求、交互方案、文档和公开文案；
- Web、Extension UI、样式、品牌和可访问性调整；
- API、纯领域逻辑、共享 Schema 和离线 fixture；
- 普通单元测试、浏览器 E2E、构建和审计配置；
- 不直接操作 Windows 系统原语的跨平台实现。

累计不等于免验。每个切片都要记录影响平台、已完成的 Mac 证据和 Windows 风险；到候选冻结时统一审查
从上一个 Windows 已验证 SHA 到新候选 SHA 的完整差异。

## 4. 哪些情况提前触发 Windows

出现下列任一情况时，不继续无限累计，应尽快建立一个有界冻结点并转入 Windows 验证：

1. 修改 DPAPI、PowerShell、注册表、Windows 路径或 ACL、SEA 打包/health、Windows 安装或卸载；
2. 出现只能在 Windows 复现的故障；
3. 修改 Native Messaging 帧、Host/Extension 版本、wire 或共享传输边界；
4. 修改 `verify:windows`、Windows SEA health 或其他决定 Windows 门禁可信度的基础设施；
5. 准备执行 Windows 安装、真实 Chrome、发布候选或商店候选验收。

同一类相关修复仍可在一个有界切片中集中完成，不要求每次局部提交都跑完整 Windows 门；但在最新修复
SHA 上完成 Windows 全量门禁前，相关任务保持 Windows pending。

## 5. macOS 日常开发流程

每个产品或功能切片按以下顺序推进：

1. 先更新需求、技术方案、数据结构、测试内容和验收标准；
2. 自审文档之间是否存在冲突，明确本切片的 `shared`、`macOS`、`Windows` 影响；
3. 行为变更执行 Fresh RED，确认失败原因正是待实现能力；
4. 完成最小 GREEN，并运行 focused tests、类型、Lint、格式及受影响构建；
5. 在一个阶段或高风险共享改动收口时执行 `pnpm verify:macos`；
6. 把未执行的 Windows 证据记入批次账本，不在每个小提交后切换设备。

产品需求可以在这一阶段继续优化。需求变更先更新权威文档和 change log，再修改代码；尚未冻结的需求不
进入 Windows 批次。

## 6. Windows 候选冻结条件

只有同时满足以下条件，才开始下一次 Windows 批量验证：

- 本批需求和验收标准暂时冻结；
- 已知 P0/P1 缺陷为零，Mac 上没有待定位的阻断性问题；
- 最新 `pnpm verify:macos` 退出 0；
- 已审查从上一个 Windows 已验证 SHA 到候选 SHA 的完整 diff；
- 工作树干净，候选 SHA 已普通 push 到约定分支；
- 项目状态、变更记录和本批验收清单已经更新；
- 邮件、域名、DNS、Resend 和真实部署仍留在独立任务，不混入本批。

冻结后不得一边在 Windows 验证一边继续修改候选。任何修复都会产生新的候选 SHA，并按第 8 节回流。

## 7. Windows 批量验证步骤

在 Windows Codex App 中拉取同一分支的冻结候选：

```powershell
git switch codex/settings-configuration
git pull --ff-only origin codex/settings-configuration
git status -sb
git rev-parse HEAD
pnpm install --frozen-lockfile
pnpm verify:windows
```

验收必须同时满足：

- `git rev-parse HEAD` 等于交接记录中的精确候选 SHA；
- `pnpm verify:windows` 退出码为 0；
- 输出出现 `Windows SEA health verified.`；
- 没有为了过门新增 skip、降低 coverage/audit 或绕开失败；
- 验证结束后工作树干净。

真实安装、Chrome、凭据、Provider、词典或部署不包含在默认离线门中，仍需单独授权。

## 8. Windows 发现问题后的回流

1. 保存首个不含秘密的失败摘要、命令、候选 SHA 和环境版本；
2. 判断是 Windows 专属问题还是 shared 问题，补能复现症状的回归；
3. 只做最小修复；相关 Windows 问题可集中在同一修复批次；
4. shared 修复回到 macOS 重新执行受影响检查和 `pnpm verify:macos`；
5. 推送新的精确 SHA，再在 Windows 从头执行完整 `pnpm verify:windows`；
6. focused 通过只能用于定位，不能代替最终 Windows 全量门。

## 9. 每批必须记录的证据

| 字段                      | 要求                                                           |
| ------------------------- | -------------------------------------------------------------- |
| 上一个 Windows 已验证 SHA | 明确批次差异起点                                               |
| 初始候选与最终候选 SHA    | 修复后两者都记录，不混用                                       |
| 累计改动分类              | product、Web、Store、API、protocol、build、Windows integration |
| macOS 结果                | 命令、退出码、关键计数、日期                                   |
| Windows 环境              | Windows、Node.js、pnpm 版本                                    |
| 首个失败和修复            | 若无则写 `none`                                                |
| Windows 最终结果          | 全量计数、SEA health、退出码                                   |
| CI 状态                   | 已触发/未触发及对应 SHA                                        |
| 未执行外部操作            | Chrome、安装、凭据、真实服务和部署逐项写明                     |

证据按批次记录，不为每个普通提交单独建立 Windows 验证记录。

## 10. Phase 41 执行顺序

### 41-A：产品需求继续校准

- 在 Mac 继续收集和优化产品需求；
- 先更新产品、技术、数据、测试和验收文档；
- 审查需求冲突及 Classic 0.13/Cloud V1 边界；
- 本阶段不要求 Windows 验证。

### 41-B：Mac 功能切片开发

- 按已审文档执行 Fresh RED→GREEN；
- 每个切片运行 focused gate，共享高风险边界扩大验证；
- 可以生成多个小提交，不逐提交去 Windows；
- 每次提交都保持 Windows 风险和 pending 状态可追溯。

### 41-C：Mac 候选冻结

- 停止加入新需求，关闭已知 Mac 阻断问题；
- 运行完整 `pnpm verify:macos`；
- 审查累计 diff、秘密、依赖、生成物和发布材料；
- 固定并 push 精确候选 SHA，生成 Windows 交接。

### 41-D：Windows 一次性批量验证

- 对冻结 SHA 执行第 7 节完整流程；
- 若有缺陷，按第 8 节集中修复并对新 SHA 完整重跑；
- 通过后回写证据，结束本批 Windows pending。

### 41-E：跨平台候选裁决

- 核对 Mac 与 Windows 证据是否指向最终同一 SHA；
- CI、真实 Chrome、安装和外部服务未完成时继续分别标记 pending；
- 只有适用门禁全部完成后，才能宣称该候选跨平台完成。

## 11. 下一项任务

下一项直接执行 **Phase 41-A：在 Mac 继续校准下一批产品需求，并同步产品、开发、测试和验收文档**。
随后在同一任务中进入 41-B 开发，不安排立即 Windows 全量验证。等产品需求和 Mac 端 bug/优化形成稳定
候选后，再执行 41-C→41-D，一次性完成 Windows 批量验证。
