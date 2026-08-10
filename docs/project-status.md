# 阶段成果与平台边界

## 当前基线

- 产品版本：`0.13.0`
- Native Messaging：`schemaVersion: 7`
- 浏览器：Google Chrome 普通 `http/https` 顶层网页及 YouTube `/watch` 英文字幕
- YouTube：可选择单词、短语和完整句的英文字幕；CC 旁“中”固定双语，按住 `Shift+Z` 或按住字幕角标临时查看 `zh-Hans`
  译文
- macOS：完整功能，默认 Provider 为已登录 Codex
- Windows：模型固定为 DeepSeek，不连接本机 Codex；支持欧路生词本
- 发布方式：从 GitHub 源码构建并加载，尚未发布 Chrome Web Store
- 验证方式：macOS/Windows 双平台 GitHub Actions 先以告警方式运行，稳定后再设为 `main`
  必需检查；系统原语仍需对应平台人工验收

## 已完成阶段

| 版本    | 阶段成果                                                          |
| ------- | ----------------------------------------------------------------- |
| 0.1–0.4 | TypeScript monorepo、MV3、严格协议、Native Host、流式展示和取消   |
| 0.5–0.7 | OpenAI、兼容 HTTP、DeepSeek Provider，以及独立凭据和诊断工具      |
| 0.8     | 单词翻译与解释职责分离，wire 升至 v5                              |
| 0.9     | 词典式浮层、稳定 DOM 更新和窄屏体验                               |
| 0.10    | Windows DeepSeek/DPAPI/SEA、欧路生词本，以及 YouTube 字幕取词基础 |
| 0.11    | 欧路全部英语收藏到扇贝的每日持久同步、角标和双平台断点批次        |
| 0.12    | 扇贝部分确认、离线词形还原、未解决词放弃/重排队及旧批次再审计     |
| 0.13    | 标准配置页、快捷弹窗、网站黑白名单、Provider 状态及可配同步/字幕  |

## 0.13.0 当前开发进度（2026-08-10）

- 新增五分区标准配置页与快捷弹窗；配置写入由 Service Worker 串行协调，避免弹窗与配置页并发
  保存时互相覆盖。缺失配置使用安全默认值，无效配置失败关闭。
- 网站策略支持默认允许或默认阻止，以及按 hostname 配置允许/阻止和子域继承；最具体规则优先。
  策略在 Content Script 和 Service Worker 两层执行，不改变 Chrome 网站权限。
- macOS 配置页可读取四种 Provider 的非敏感就绪状态并切换到已配置 Provider；Windows 仍固定
  DeepSeek。页面不读取、显示或传输 Key、endpoint、模型参数或在线测试结果。
- 生词本总开关、每日同步开关和本地小时，以及 YouTube 总开关、默认双语和可关闭/自定义快捷键
  均已进入本地配置。wire v7 新增本地状态/Provider 选择控制消息并明确拒绝 v6。
- macOS `verify:macos` 已通过，包括指令、格式、Lint、类型检查、1,529 条单元测试、构建和
  63 条浏览器 E2E。Native Host 已按个人扩展 ID
  `chanmjjealoeeheohofnljbbkkfgfnfm` 重新安装并保留既有 Provider/凭据状态；Chrome 已重载
  最终 `apps/extension/dist`，标准配置页的五个分区、`0.13.0` / Native Messaging v7 标识及
  本机 Provider 状态均实机显示正常，四种 macOS Provider 均显示为已配置，DeepSeek 为当前
  Provider。真实模型和欧路请求未运行，仍需另行批准外部数据发送及可能产生的费用。
- Windows 已使用 Node.js 26 或更高版本与 pnpm 10.12.4 通过 `verify:windows`：包括指令、
  格式、Lint、类型检查、89 条脚本测试、107 条 protocol 测试、991 条 native-host 测试
  （另有 67 条按预期跳过）、376 条 extension 测试、构建、SEA 独立 `health` 和 diff 检查；
  另行运行的 63 条 Chrome E2E 全部通过。
- Windows 已同步安装 `0.13.0` / wire v7 Extension 和 Host。当前加载路径的扩展 ID
  `kmeopbhijmkcjeckjicfinpdminhpbak` 与精确 HKCU Native Messaging 注册表项、manifest 唯一的
  `allowed_origins` 对齐，安装文件与已验证构建产物哈希一致。Chrome 实机已检查 Options 五个
  分区、Popup，以及无需联网的配置即时保存和刷新后持久化；配置页其他功能未发现问题。
- 真实 DeepSeek 验证没有通过：Windows 本地 DPAPI/PowerShell 凭据读取存在唯一已知延期问题，
  偶发约 5 秒超时；用户决定暂时忽略。真实 DeepSeek 和欧路 smoke 均未运行，仍需单独批准；
  本轮也未执行幂等卸载，因此不得据此声称整个系统集成清单或双平台发布已经完成。

## 0.12.0 当前开发进度（2026-08-10）

- YouTube 临时中文字幕已从 F8 调整为主键盘区按住 `Shift+Z`，并新增字幕卡右上角按住角标；选词浮层已
  完成暖色编辑词典视觉、分层动作卡、翻译／解释原句语境条和加载骨架。相关单元测试、62 条
  浏览器 E2E、Windows 视觉基线与 390px 窄屏实测均通过。
- Windows `verify:windows` 离线质量门已通过，包括指令、格式、Lint、类型检查、单元测试、构建与
  diff 检查；另行运行的 62 条浏览器 E2E 全部通过。Node.js 26 SEA 已完成打包和独立 `health`
  帧验证。
- Windows 已把本次 SEA 安装到 `%LOCALAPPDATA%\Huayi\native-host`，安装文件与已验证构建产物
  的 SHA-256 一致；精确 HKCU Native Messaging 注册表项和 manifest 均指向该安装，既有
  DeepSeek、欧路凭据及生词同步状态仍存在。当前 Windows 加载路径的扩展 ID
  `kmeopbhijmkcjeckjicfinpdminhpbak` 已与 manifest 唯一的 `allowed_origins` 对齐；安装后的 Host
  已通过直接 `health` 帧验证，并已被 Chrome 以该精确扩展来源成功拉起。
  Chrome 已重载最新 `0.12.0` 未打包扩展，真实 YouTube 已确认新版字幕 UI 注入；播放中选词后
  首击空白关闭并持续播放连续两轮通过，原暂停状态保持暂停，下一次普通播放器点击只切换一次。
  `Shift+Z` 由浏览器 E2E 覆盖，字幕角标按住由控制器集成单测覆盖；实机页面已确认两个入口
  可见。真实 DeepSeek
  和欧路请求未运行，仍需单独授权外部数据发送及可能产生的费用。
- macOS `verify:macos` 已通过，包括指令、格式、Lint、类型检查、1,500 条单元测试、构建和
  62 条浏览器 E2E。Native Host 已重新安装并只允许扩展 ID
  `chanmjjealoeeheohofnljbbkkfgfnfm`；安装 bundle 与已验证构建一致，既有 DeepSeek Provider
  配置保持不变。Chrome 已重载当前 `apps/extension/dist`，真实 YouTube 已分别验证人工英文轨和
  `kind: "asr"` 自动英文轨：完整句、固定双语、原生单词／短语选择、暂停所有权、首击空白关闭、
  CC 关闭／恢复、SPA 和剧院模式均通过。全屏 journey 已由 E2E 覆盖；实机快捷键进入全屏边界时
  浏览器控制会释放，重新接管后字幕 surface 仍存在。真实 DeepSeek 和欧路请求未运行，仍需另行
  授权外部数据发送及可能产生的费用。

## 仍然不支持

- Windows 上的 Codex、OpenAI 和 Compatible HTTP。
- Linux、Firefox、Edge、PDF、Chrome 内部页面、iframe 和编辑器区域。
- YouTube 直播、Shorts、OCR 和持久字幕历史；CC 关闭或当前活动轨非英文时不接管字幕。
- 分析历史记录、跨设备同步、后续对话、浏览器内密钥/端点设置和 Chrome Web Store 自动安装。

## 文档接手顺序

新的 Codex 项目从仓库根目录打开后，依次读取：

1. 根目录与目标模块的 `AGENTS.md`；
2. 本文件和 `README.md`；
3. `cross-platform-development.md` 和对应平台的 `setup-macos.md` 或 `setup-windows.md`；
4. `architecture.md`、`protocol.md`、`security.md` 和 `testing.md`；
5. 需要追溯设计决策时，再读取 `docs/superpowers/specs/` 与 `plans/`。

历史设计文档保留当时版本的边界，不代表当前发布状态；当前状态以本文件和主题文档为准。
