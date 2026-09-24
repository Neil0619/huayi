# Windows 桌面入口闪退修复回执

2026-09-25。影响 Windows 打开器安装和迁移；扩展、媒体处理、回环服务及 Classic Host 未改动。

## 根因与复现

旧安装根为 `%LOCALAPPDATA%\SeenSaid\asbplayer-opener`。本机 Codex 由 MSIX 应用运行，
写入被重定向到其 `LocalCache\Local\SeenSaid\asbplayer-opener`。继承开发应用环境的命令能读到
这些文件；普通资源管理器却看不到逻辑安装路径。

实际从资源管理器启动旧快捷方式时，PowerShell 在执行脚本前以 `-196608` 退出，原始错误是
`-File` 参数的脚本不存在。原生进程记录确认启动父进程为资源管理器；其环境下的独立文件探针
确认正常 AppData 安装目录不存在、应用私有目录存在。只执行 `powershell -Command exit` 成功。
这区分了路径不可见与 PowerShell 本身不可用，也解释了此前开发进程直接启动的假阳性。

此前 [选片窗口回执](asbplayer-windows-picker-validation.md) 只解决窗口所有者问题；
其中“最初红色闪退未复现”的状态由本次证据接续，不把旧测试改写为已覆盖本故障。

## 修复

- 固定安装根改为 `%USERPROFILE%\SeenSaid\asbplayer-opener`，不依赖 AppData 虚拟化或开发应用包名。
- 首次迁移保留旧配置；新安装已有配置时以新配置为准。旧文件与媒体缓存保留。
- 仅迁移目标程序和参数均匹配本工具的旧快捷方式，拒绝覆盖无关同名入口。
- 本机实际目录为 `C:\Users\niu06\SeenSaid\asbplayer-opener`；桌面名称仍为「语见本机视频」。
  扩展仍使用 `E:\Document\huayi\apps\store-extension\dist`，没有重新构建或更换扩展身份。

## 验证

- TDD 安装路径回归先失败于仍返回 AppData 路径，修复后通过。
- 原生快捷方式迁移回归先失败于旧入口不能迁移，修复后实际通过 `.lnk` 执行生成的 PowerShell，
  Node 收到准确配置路径；同时检查无关入口未被替换。
- 本机打开器、安装、原生窗口、媒体与回环服务共 10 项定向测试通过，0 跳过。
- 安装后新旧配置内容一致，旧配置哈希未变，原缓存目录仍存在。
- 修复后通过界面实际双击桌面文件夹中的快捷方式，Chrome 打开「从原视频开始学习」页面，
  新安装的 Node 进程持续运行，回环页面返回 200。再点击「选择原视频」，实际观察到原生文件窗口。

本机为 Windows 11 Pro Insider 25H2（10.0.26220.9223），Node 26.10.0、pnpm 10.34.5、
Windows PowerShell 5.1.26100.9223，Chrome 153.0.8010.53，系统缩放保持 150%。

完整质量门禁与准确候选身份待本轮验证完成后补记。100% 新打开器界面仍按用户此前决定暂缓；
本轮没有重做整集声音、字幕和 Provider 学习流程，原媒体流程证据仍归属原候选。
未调用真实付费 Provider、外部词典；未合并 main、部署或发布商店版本。
