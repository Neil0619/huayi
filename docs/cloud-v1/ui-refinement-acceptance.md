# 插件与 Web 紧凑界面验收

影响平台：shared（Store Extension 与 Cloud Web）。Classic、Native Host、数据库与 Chrome 权限不变。

## 行为与安全

- Popup 固定 340px，四主题与插件设置、打开的词卡共享现有 appearance 存储；失败恢复原选择。
- 绿／红／灰点表示模型联网许可／未许可／停用或读取中，不表示网络连接测试结果。
- 待上传没有内容时隐藏，有内容显示数量、重试和二次确认清空；读取失败、需升级和不支持上传均
  明确提示。不改变现有安全断开、会话失效及撤回许可时的队列清理规则。
- 两处账号入口复用受信 Worker 的 PKCE 配对命令与明确网页批准；不读取网页 Cookie 或真实密钥。
- 网站规则最多 256 条，每页 20 条，支持规范化、搜索、过滤、修改范围、删除末页和根域关闭／单站
  开启。全局开关优先，同域精确规则优先，相似后缀不匹配；尾点域名在保存、运行时匹配与 Popup
  开关处一致规范化，历史规则无需迁移；保留运行时内网站点精确匹配。
- 外部词典入口只打开既有 HTTPS 工作台的 `/words/wordbooks`；不接受用户提供的任意跳转地址。

## 依赖评估

`@huayi/store-domain` 显式依赖 `tldts@6.1.86`，用于随包提供的离线公共后缀（含 private suffix）解析。
该版本已存在于依赖树；不新增网络服务、远程代码或 Chrome 权限。自行维护后缀白名单容易漏掉
`co.uk`、`github.io` 等边界，浏览器 URL 本身又不判断公共后缀，因此未采用这两种替代方案。
域名文本不离开设备；后续升级应重跑公共／私有后缀、IDNA、IP、localhost 和边界匹配测试及生产依赖审计。

## 离线回归入口

```sh
pnpm exec vitest run --project store-domain --project store-extension --project web
pnpm exec playwright test apps/store-extension/e2e/interface-layout.spec.ts apps/web/e2e/workspace-compact-layout.spec.ts apps/web/e2e/cloud-ui-appearance-journey.spec.ts
pnpm verify:macos
```

测试使用仓库夹具、模拟会话和离线 Chromium，不打开真实账号。Popup 四主题、设置搜索高度／位置、
帮助聚焦／Esc、长规则列表及末页删除用行为与几何断言覆盖。Web 检查 1440×900（含验收横幅）首个
业务区不超过 240px、28px 标题、208px 设置侧栏、窄屏折叠与无页面横向溢出；待整理分类切换还须
保留原标签按钮及键盘焦点。

视觉快照按平台区分。macOS 更新不等于 Windows 已通过；Windows 须在对应平台重验并审阅其快照，
运行 `pnpm verify:windows`。不得复制 macOS 位图伪装 Windows 验证。

## 交付包

完整门禁中的默认 build/E2E 固定生成不带 Hosted 配置的 `apps/store-extension/dist-release`，不会覆盖
已安装的 Hosted 目录或改变其身份。需要更新本地验收包时执行：

```sh
pnpm acceptance:hosted:store:build
pnpm acceptance:hosted:store:status
```

产物为 `apps/store-extension/dist`，固定 acceptance Extension ID 和已批准的 API/Web origin 由构建
脚本与包审计共同校验。这里不安装插件、不触发部署、不运行真实账号配对或模型请求；这些步骤和
双平台真实 Chrome 验收分别取得授权，不能由本地测试或构建成功推断完成。

## 此前界面与配对配置验证（2026-09-04）

- macOS `pnpm verify:macos` 全部门禁通过：979 项脚本测试、3,137 项单元／集成测试和 123 项浏览器
  回归通过；另有既有的 12 项测试跳过。Store 覆盖率复跑 541 项，行覆盖率 92.75%。
- 格式、lint、类型、架构、构建及包审计通过；生产依赖审计最终通过，未发现已知漏洞。
- 已审阅四主题、桌面／窄屏视觉快照；域名尾点、历史规则、畸形输入与标签焦点均有回归覆盖。
- 最终 `acceptance:hosted:store:build` 和 `acceptance:hosted:store:status` 通过；交付的是本地
  Hosted 验收包，不是已安装或已发布版本。
- 已核对 macOS Chrome 中现有 Store 扩展的版本与加载路径；用户随后反馈设备配对已完成（非自动化实测）。
  Windows CI／视觉与真实 Chrome 验收尚未执行；未提交或部署。

## 真实浏览器验收发现的配置回归

在用户授权后的 macOS Chrome 验收中，已确认 Store 1.0.0 加载自本地 Hosted 产物，但账号区仍显示
“此安装包不支持账号连接”。根因是生产 Worker 将带 `/app` 的工作台地址传入只接受纯 origin 的
配对管理器；管理器在访问会话或发出请求之前即返回 `not-configured`，与用户是否已经网页登录无关。

修复将构建配置中的 Web origin 与工作台地址分开，后者仍由同一固定 origin 拼接 `/app`。配对入口
只使用前者，不放宽 HTTPS、凭据、路径、查询或片段校验，也不改变账号配对、上传与安全断开的边界。
新增离线夹具直接执行实际 Vite 产物，通过真正的 Worker 消息监听器验证未连接状态、模拟配对请求
和准确的确认页／工作台跳转；不再只检查产物中是否包含域名字符串。普通 release 包仍不可连接云端。

## 配对页与配置保留整改（2026-09-04）

- 配对说明改为通俗文案，长详情折叠；表单逐项分行、控件至少 44px，默认设备名为“我的 Chrome 浏览器”，
  用户可编辑。三项设置保留账号级范围、当前偏好及显式授权，不执行真实账号修改。
- 原普通构建与 Hosted 构建共写 `dist`、只有 Hosted manifest 带固定公钥；回归已复现输出冲突。
  普通 build/E2E 和审计现改为 `dist-release`，Hosted 继续使用现有 `dist` 与固定 ID，不要求重装。
- 离线回归覆盖真实打包 Worker 连续三次重启并清空临时会话，保留外观、服务商、三类加密凭据、
  网站规则、安装标识和有效配对状态。未读取或复制用户 Chrome 数据，也不做跨 ID 密钥迁移。
- 旧扩展已被用户卸载，历史 ID 不可取得，因此不能断言每次重复安装都由同一原因造成；本轮确认并
  修复的是构建身份覆盖风险。卸载清除的旧本地设置无法由新插件自动恢复。

复现与定向回归入口：

```sh
pnpm exec vitest run apps/store-extension/src/build-profile-isolation.test.ts
pnpm exec vitest run apps/store-extension/src/packaged-settings-retention.test.ts
pnpm exec playwright test apps/web/e2e/pairing-layout.spec.ts
```

整改前，六种构建的输出隔离断言全部失败；配对页默认名称为空，控件高度约 29.6px，未满足独立行与
44px 控件要求。整改后上述回归全部通过，八张 macOS 四主题／双尺寸快照已审阅，键盘帮助与展开详情通过。

最终 `pnpm verify:macos` 退出码 0：981 项脚本测试、3,145 项单元／集成测试、126 项浏览器回归通过，
保留既有 12 项跳过。Store 覆盖率复跑 549 项，行覆盖率 93.12%。指令、格式、lint、类型、架构、
构建、Store／Cloud 门、生产依赖审计及 diff 检查均通过；依赖审计未发现已知漏洞。
完整门禁前后，Hosted 目录所有产物的 SHA-256 一致，最终 Hosted status 审计通过。
本轮未提交、部署或操作真实账号；Windows `pnpm verify:windows`、对应平台快照和实机重载仍待验收，
预期全部门禁通过且同一插件 ID、各配置及配对状态保持不变。

## 后续人工 Chrome 检查（macOS）

浏览器工具禁止接管插件内部页面，因此不采用其他工具或间接方式绕过。用户已授权本地重载与账号
关联，用户已反馈配对完成，因此不再重复配对。模型调用、账号安全设置修改与部署不在本轮操作范围内。
需要人工验收原地更新时，在 Chrome 检查：

1. 打开 `chrome://extensions`；对当前已加载、路径为
   `apps/store-extension/dist` 的语见 · Seen & Said 扩展点击“重新加载”，并确认版本为 `1.0.0`、ID 为
   `hoijjhgcckfhbcefoclgbhkgninnkknd`。
2. 刷新已打开的普通网页，再打开扩展 Popup 或 Options；确认新的紧凑界面与四主题能够正常显示。
3. 确认此前的外观、服务商、密钥已配置状态、欧路授权、网站规则和账号连接仍在；不要卸载现有扩展，
   不需要再次配对。新配对页仅在后续获批的 Web 部署后可见，本地构建不等于线上页面已更新。
4. 记录成功或失败的可复现现象、扩展版本和时间；不要在验收记录中写入账号、Cookie、密钥、页面正文
   或模型内容。

该交接是人工 Chrome／账号验收，尚未由本地构建、离线测试或本记录替代；Windows 仍须在 Windows
目标机按相同边界重新验收。

## 2026-09-04 四张截图的后续修复

本轮状态为 `implemented; target-platform validation pending`，影响 `shared` 的 Store 扩展与 Web
设备批准页；未提交、推送、部署或调用真实模型。

- 图 1：欧路授权输入框与操作行原来没有间距，焦点外框压到按钮；相邻操作行现在保留 12px 间距，
  已在 1440px/390px 检查聚焦状态及无横向溢出。
- 图 2：复核工作区已有的“连接语见插件”表单，设备名称、查询模型、句段收集、生词保存独立分行，
  每项说明对应当前选项，详细隐私说明可展开。实际 Web 构建的四主题、窄屏及批准后刷新回读通过。
  此页面尚未部署，线上仍可看到旧版本。
- 图 3：待确认时提供“重新打开”，复用未过期的同一次配对证明；前台每秒检查批准结果并直接交换，
  后台 alarm 保留为关闭扩展页面后的补充。配对/断开/快照提交串行，避免重复消费及断开后旧响应复活。
  明确的 pairing 404 可重新发起；暂时断网保留原配对。
- 图 4：隔离 Chromium 实测扩展 GET 默认不带 Origin，触发 API 的 403；旧缓存把 403 当成账号失效，
  删除关联后又误报 BYOK 缺密钥。受信 Worker 现在补上自己的 Origin，API 的固定 Origin/token/版本
  校验保持严格。账号失效、访问被拒、版本不支持和本机缺密钥分别提示；当前账号请求失败不会转用 BYOK。

离线证据：Store/domain 642/642，Web 批准与 API 鉴权 15/15，浏览器布局/批准旅程 7/7；Store/Web/domain
类型检查、目标 lint/format、指令/架构/diff 检查通过。内容脚本继续满足原 56KiB 上限。使用真实源码
请求头 helper 的隔离 Chromium GET/POST/DELETE 均通过本地固定 Origin 检查；测试没有使用真实账号。

本地验收包仍输出到 `apps/store-extension/dist`。用户下一步是在 `chrome://extensions` 重新加载已有
语见扩展，并刷新测试网页与设置页；如果此前错误已清除关联，需要重新连接一次。Web 批准页需另行授权
Hosted 部署后才能在线验收。Windows、双平台完整 CI、真实账号/模型链路尚未执行，不能由这些离线结果替代。
