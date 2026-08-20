# Cloud V1 Phase 37-B Windows 离线验证交接

## 1. 状态与目标

影响平台为 `Windows + shared handoff`。本交接只在 Windows Node.js 26+ 目标机验证 Cloud V1 候选的
完整离线质量门、Windows SEA 打包和仓库外独立 health；不安装 Native Host、不读取或配置 DPAPI
凭据、不启动真实 Chrome，不调用 DeepSeek、欧路、扇贝、Supabase、Vercel、Google、Resend 或其他
真实服务。

当前状态：`Windows local offline validation complete; repair commit pushed; remote CI not triggered`。

Windows 必须使用 Codex App 当前原生任务能力。已废弃的 `/Users/niuzhenya/Documents/windows-codex`
项目及其插件、Hooks、Skills、MCP、runner、job、SSH 或配对流程不得安装、恢复或使用。

## 2. 固定来源与拉取前置

- 目标远端：`origin`（`https://github.com/Neil0619/huayi.git`）；
- 目标分支：`codex/settings-configuration`；
- Cloud V1 候选基线提交：`e9abf514807cd5bf9eba54c531a4d7d6ef426c05`；
- Windows 开始验证的 HEAD 必须包含该基线以及本交接文档，不要求 HEAD 恰好等于基线；
- macOS 本地提交未推送前，Windows `git pull` 无法取得它们。必须先由用户明确授权发布基线，或由
  用户本人把当前分支 push 到 `origin`；不得用 Windows 上的旧远端 HEAD 代替。

在 Windows PowerShell 中取得代码后执行：

```powershell
git fetch origin
git switch codex/settings-configuration
if ($LASTEXITCODE -ne 0) { git switch --track origin/codex/settings-configuration }
git pull --ff-only origin codex/settings-configuration
git status --short
git rev-parse HEAD
git merge-base --is-ancestor e9abf514807cd5bf9eba54c531a4d7d6ef426c05 HEAD
if ($LASTEXITCODE -ne 0) { throw 'Windows checkout does not contain the Cloud V1 candidate baseline.' }
```

`git status --short` 在开始验证前必须为空。不得 force-push、rebase、amend `e9abf51`、merge `main`，
也不得把其他工作树的未提交文件复制进来。

## 3. 工具链前置

```powershell
node --version
pnpm --version
```

- Node.js 必须是 26 或更高版本；更低版本不得运行或声称 SEA 验证完成；
- pnpm 使用仓库固定的 `10.12.4`；Node.js 26 不保证内置 Corepack；
- 使用 Windows 10/11、Git 与可启动的 Google Chrome。自动门会启动离线 Playwright，但不会加载真实
  用户扩展、访问 Chrome Dashboard 或使用用户凭据；
- 不把 Key、Authorization、Cookie、`.env`、`%LOCALAPPDATA%` 凭据文件或注册表内容发给 Codex、写入
  命令、日志或仓库。

依赖安装：

```powershell
pnpm install --frozen-lockfile
```

如果安装因网络或包注册表不可用失败，记录为环境失败并恢复网络后重试；不得删除 lockfile、改用不同
依赖版本或降低 audit 门槛。

## 4. Fresh Windows 验证

先记录起点，不修改代码：

```powershell
git rev-parse HEAD
git status --short
node --version
pnpm --version
pnpm verify:windows
```

`pnpm verify:windows` 按固定顺序执行：

1. instructions、format、lint、全 workspace strict typecheck；
2. 完整 Node/Vitest 测试与 Store coverage；
3. architecture、全 workspace build、固定九项 Cloud development blocker；
4. 109 条离线 Playwright、Store release audit、production dependency audit；
5. Windows Node SEA 打包；
6. 从仓库外临时目录、清除 `NODE_PATH` 并使用临时 `LOCALAPPDATA` 的真实 `.exe` health；
7. `git diff --check`。

成功必须同时满足：命令退出码为 0、输出含 `Windows SEA health verified.`、没有未解释的新 skip，且
验证后 `git status --short` 仍为空。production dependency audit 会查询安全公告，但不会运行 Provider、
词典或云服务请求。

## 5. 失败与修复边界

若 Fresh Windows 门失败，Windows Codex 必须：

1. 保存首个失败命令、退出码、测试名和安全的错误摘要；先分类为 code、test fixture、tooling、network
   或 Windows environment，不把时间相邻当成直接因果；
2. 先运行最小失败子命令取得稳定复现，再修改相关源码/测试/文档；行为缺陷必须保留 regression test；
3. 只修复当前 Cloud 候选的 Windows/shared 缺陷。不得跳过 Windows 测试、放宽 RLS/secret/release
   audit、删除 Windows 支持、恢复废弃 windows-codex 项目或改变邮件/域名/DNS 延期边界；
4. 不执行 `host:install`、凭据 configure/remove、Provider/词典 smoke、真实 Chrome、卸载、部署或上传；
   这些操作都需要各自单独批准；
5. focused GREEN 后重新运行完整 `pnpm verify:windows`。只有最终完整命令退出 0 才能关闭 Phase 37-B；
6. shared 代码修复仍须保留 macOS/Windows CI 契约；Windows 结果不能替代后续 macOS/CI 复核。

不要用 `--force`、测试 `.skip`、忽略脚本、降低覆盖率阈值、改 audit level 或删除失败断言制造绿灯。

## 6. 结果记录与提交

Windows 全绿后，在本文件末尾“执行结果”填写真实值，并同步：

- `docs/project-status.md` 的 Phase 37-B 状态；
- `docs/cloud-v1/release-checklist.md` 的 Windows 自动门项；
- 如有代码修复，`docs/cloud-v1/change-log.md` 记录根因、Fresh RED、最小修复与最终门禁。

证据回写后至少重跑文档/架构静态门：

```powershell
pnpm check:instructions
pnpm format:check
pnpm check:architecture
```

只暂存本阶段文件并复审：

```powershell
git status --short
git diff --check
git diff --stat
git add -- <本阶段精确文件列表>
git diff --cached --check
git diff --cached --stat
git commit -m "test: verify Cloud V1 candidate on Windows"
git push origin codex/settings-configuration
```

如有生产代码修复，可使用更精确的 Conventional Commit，例如 `fix(host): ...`、`fix(build): ...` 或
`fix(extension): ...`，再以单独 `test:`/`docs:` 提交记录 Windows 全绿证据。不得提交 `dist/`、coverage、
Playwright traces、`test-results/`、SEA `.exe`、凭据或 `.env`。

push 后记录：

```powershell
git status -sb
git log -3 --oneline --decorate
```

分支必须与 `origin/codex/settings-configuration` 对齐；不得 force-push。GitHub macOS/Windows CI 若已由
push 触发，其链接和终态也应写入执行结果；若没有自动触发，明确记录 `not triggered`，发布检查表的
Windows + CI 总项继续保持未勾选。本地 Windows 退出 0 不替代失败或尚未运行的远端 CI。

## 7. 给 Windows Codex 的首条指令

在确认 checkout 已包含候选基线后，可把下面这段作为 Windows Codex 新任务的首条请求：

```text
请完整阅读仓库 AGENTS.md、docs/cross-platform-development.md、docs/setup-windows.md 和
docs/cloud-v1/windows-validation-handoff.md，严格执行 Phase 37-B。先记录干净工作树、HEAD、Windows、
Node.js 与 pnpm，再 Fresh 运行 pnpm verify:windows。若失败，先保存首个安全失败证据并定位根因，
只做 Windows/shared 最小修复和 regression，最终必须完整重跑 verify:windows。全绿后按交接文档回写
结果、精确暂存、提交并普通 push 到 codex/settings-configuration。不要安装、操作真实 Chrome、读取或
配置凭据、运行 Provider/词典 smoke、部署、force-push，也不要恢复已废弃的 windows-codex 项目。
```

## 8. 回到当前任务时提供的信息

只需告诉当前任务以下非敏感摘要：

1. Windows 版本、`node --version`、`pnpm --version`；
2. 开始 HEAD、最终 HEAD 和 push 后远端分支；
3. Fresh `pnpm verify:windows` 是直接通过还是失败；若失败，首个失败点和修复文件；
4. 最终完整门退出码、Node/Vitest/Playwright 数量、`Windows SEA health verified.` 是否出现；
5. Windows Codex 创建的提交；
6. GitHub macOS/Windows CI 状态；
7. 是否保持未运行安装、真实 Chrome、真实 Provider/词典、凭据和部署。

不要粘贴凭据、完整环境变量、数据库 URL、Authorization、Cookie、用户目录内容或原始第三方响应。

## 9. 执行结果（由 Windows Codex 填写）

- Windows：`Windows 11 Pro 10.0.26220（build 26220）`
- Node.js：`v26.7.0`，官方 x64 portable，下载 SHA-256 已核验
- pnpm：`10.12.4`
- 开始 HEAD：`c6af3c0bbdf94600d936a2a13394d705e9695d08`
- Fresh `pnpm verify:windows`：`exit 1`；首个失败是根 `AGENTS.md` 12,404 字节超过
  12,288 字节上限
- 首个失败与根因：首个门禁失败属于 instructions 文件大小；修复后继续暴露 fresh checkout 中 Store
  Vite/coverage 配置缺少 workspace source alias、依赖包尚无 `dist` 时无法解析的问题；浏览器全套负载
  还暴露两项 journey 时序缺陷：切到“已归档”筛选后没有重新选择条目，以及 Google 离线 journey 用
  默认 5 秒标题断言间接等待两次 API 与重定向
- 修复与 regression：语义压缩根 `AGENTS.md` 至 12,287 字节；为 Store Vite 与 coverage 配置补齐
  workspace source alias；归档筛选后显式重选条目；Google journey 改为等待精确 Provider HTTP 200。
  受影响 targeted 9/9 通过，最慢 12.4 秒
- 最终 `pnpm verify:windows`：`exit 0`；instructions、format、lint、strict typecheck、development/Store
  release audits、production dependency audit、九项 Cloud development blocker、9 个 build、SEA health
  与 `git diff --check` 全绿；production audit 无已知漏洞
- Node/Vitest/Playwright：脚本 118、store-domain 44、learning-domain 20、cloud-contracts 63、protocol
  107、native-host 991 passed / 67 macOS skipped、Classic Extension 383、Store Extension 481；聚合门内
  各次测试调用共 2,797 passed / 67 skipped。Store coverage 为 97 files / 481 tests，statements/lines
  92.66%、branches 87.87%、functions 88.09%；Playwright 109/109、无 skip
- SEA health：出现精确成功文案 `Windows SEA health verified.`；仓库外 `.exe` 返回
  `codexVersion=null`、`hostVersion=0.13.0`、`model=deepseek-v4-flash`、
  `provider=deepseek-chat-completions`、`ready=true`、`requestId=verify-windows-sea-health`、
  `schemaVersion=7`、`type=health-result`
- 本机验证日志：SHA-256 `1BD8…B416`；路径仅为本机临时证据，未纳入仓库
- 修复提交：`3aa143c7f60ba52a941f2a2db587bc93819427eb`
- 完整 Windows 门所验证的修复 HEAD：
  `3aa143c7f60ba52a941f2a2db587bc93819427eb`；随后只提交验证结果文档，不把文档提交冒充完整门证据
- push：修复提交 `3aa143c7f60ba52a941f2a2db587bc93819427eb` 已普通 push 至
  `origin/codex/settings-configuration`，无 force
- GitHub macOS/Windows CI：`not triggered`；该分支无开放 PR，GitHub Actions 无该分支 run，本地 Windows
  已全绿但远端 CI 尚未运行
- 外部操作确认：`未运行安装、真实 Chrome、凭据、Provider/词典 smoke 或部署`

## 10. Windows 结果回流与 macOS 复验（2026-08-20）

- Windows 结果文档提交 `313b5d409e5fa49e9a0391b6e7d791eea8a28893` 已普通 push；它的完整
  Windows 门证据仍以被验证的修复 HEAD `3aa143c7f60ba52a941f2a2db587bc93819427eb` 为准；
- 当前任务把 Windows 两个提交与“语见 / Seen & Said”品牌提交线性 rebase。根 `AGENTS.md` 同时保留
  新品牌口径和 Windows 的压缩修复，当前为 12,206 bytes，低于 12 KiB 上限；
- 首次隔离 macOS 复验在其他门全绿后得到 Playwright 107/109：Store 首个 journey 被 Vite cold
  dependency discovery 强制刷新；Cloud 学习库在第二次归档完成前切换筛选，列表请求与 mutation 竞态；
- 修复只让 E2E Vite 启动时显式扫描 Classic/Store 两组 fixture，并让归档 journey 等到“恢复学习项”
  出现后再切换筛选、重新选择条目；另把 Cloud release Web 隐私 artifact marker 从旧公共名称校准为
  `语见 Cloud V1 隐私说明`，固定九项 development blocker、覆盖率和发布审计阈值均未改变；
- Fresh 配置 RED 为 1 expected failure / 3 baseline passed、修后 4/4；归档竞态修前 repeat 1/3、修后
  两条目标 journey 10/10；品牌审计 marker RED 为 7 expected failures / 6 baseline passed、修后 release
  audit 13/13，development blocker 恢复精确通过；
- 最终 `pnpm verify:macos` 退出 0：446 个 Vitest 文件（2,748 passed / 12 skipped）、Store coverage
  97 files / 481 tests（statements/lines 92.66%、branches 87.87%、functions 88.09%）、Playwright
  109/109、9 个 workspace build、instructions、format、lint、typecheck、architecture、release audits、
  production dependency audit 与 `git diff --check` 全绿；
- 该复验没有运行安装、真实 Chrome、凭据、Provider/词典 smoke 或部署。因为品牌提交和本节 shared
  harness/audit 修复晚于 Windows 已验证 HEAD，当前精确候选的 `verify:windows`/远端双平台 CI 仍待重跑；
  不把早先 Windows 结果外推为当前 HEAD 的完成证明。

## 11. Phase 46 第二批 Windows 候选交接（2026-08-21）

本节 supersede 第 2 节“只需包含旧 Cloud 基线”的宽松起点，用于下一次真实 Windows 批次。旧执行结果
继续只证明 `3aa143c`，不能覆盖当前候选。

- 上次 Windows 验证代码：`3aa143c7f60ba52a941f2a2db587bc93819427eb`；
- Phase 45 代码锚点：`15306b46b4129682278c7dcecc47ac45bbfa7f7d`；
- Mac 冻结提交：由当前任务完成本节、最终 `pnpm verify:macos` 和本地提交后，以聊天中报告的**完整
  40 位 SHA**为唯一候选；该 SHA 必须包含上述代码锚点和本节；
- 该候选相对上次 Windows 验证代码共 9 commits：到 Phase 45 锚点为 8 commits，随后一个为本节所在
  docs-only 冻结提交；
- 当前远端仍为 `313b5d409e5fa49e9a0391b6e7d791eea8a28893`。用户普通 push 前，Windows 不得开始，不能拿旧远端
  HEAD 冒充第二批候选。

用户 push 后，在 Windows Codex App 原生任务中把 Mac 报告的 SHA 填入 `$ExpectedCandidate`：

```powershell
$ExpectedCandidate = '<Mac 任务报告的 40 位候选 SHA>'
git fetch origin
git switch codex/settings-configuration
git pull --ff-only origin codex/settings-configuration
if ((git rev-parse HEAD) -ne $ExpectedCandidate) { throw 'Windows checkout is not the frozen candidate.' }
git merge-base --is-ancestor 15306b46b4129682278c7dcecc47ac45bbfa7f7d HEAD
if ($LASTEXITCODE -ne 0) { throw 'Windows checkout does not contain the Phase 45 code anchor.' }
git status --short
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm verify:windows
git status --short
```

验收仍按第 4–8 节执行，但当前浏览器基线是 Playwright 110/110，不再沿用旧结果的 109/109。必须看到
`Windows SEA health verified.`、最终状态干净且零新增 skip/门禁弱化。若 Fresh 失败，保存首个安全
失败、最小回归与修复；任何修复都会生成新候选，必须回到 Mac 对最新 SHA 完整重跑，再由 Windows
从头完整验证。

本批累计包含品牌/Manifest/Native Host 文案、跨平台 E2E 启动稳定性、Cloud 公开披露、Web 工作台壳与
Token、API Fluid/Function 配置及文档。明确不运行安装、真实 Chrome、DPAPI 凭据、Provider/词典 smoke、
Supabase/Vercel 部署、邮件、域名、DNS 或 Resend；Windows 完整离线门通过也不会关闭这些外部项。
