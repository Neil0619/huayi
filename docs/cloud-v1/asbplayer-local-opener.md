# Windows 原视频打开器

影响 `shared + Windows`。此打开器是本机开发工具，不是商店扩展的后台进程，
不修改 Classic Native Host。扩展加载路径与 ID 保持不变。

## 使用

1. 启动本机打开器，在 Chrome 中点击「选择原视频」，选择 MKV 或 MP4。
2. 首次会在本机准备兼容音轨与内嵌文字字幕；原视频只读，视频画面不重新编码。
   同一文件再次打开时复用完整缓存；源文件变化后重新准备。
3. 优先勾选唯一的相邻中英双语字幕，否则优先内嵌英文文字字幕。可修改勾选，
   或通过「添加文字字幕」选择其他 SRT/ASS/VTT；最多同时导入三份文字字幕。
4. 点击「开始学习」。语见将文件交给官网文件输入控件。完整内容明确时，
   学习层预选中英文轨道，点击确认即可；没有中文时可只学英文。
5. 换片时点击播放器页「打开另一个视频」，返回打开器再选原视频。
   播放器内全屏时先退出全屏。完成后点击打开器的「退出打开器」。

仅打开原 MKV 到官网本身，仍可能没有声音或字幕；自动准备发生在这个本机打开器中。
无内嵌文字字幕、只有 PGS/VobSub 等图像字幕时会提示，需要另外提供文字字幕。
首版支持 H.264/HEVC 视频；Chrome/硬件仍须支持对应视频解码。
优先使用标记为英文的音轨，否则第一条音轨；当前不提供多音轨切换。
不会自动 OCR、翻译整片或转码整个视频画面。

## 本机配置与启动

需要 Node.js 26、FFmpeg、ffprobe 和加载了语见的 Chrome。配置 JSON 仅存于本机，示例：

```json
{
  "node": "C:\\Tools\\node\\node.exe",
  "ffmpeg": "C:\\Tools\\ffmpeg\\bin\\ffmpeg.exe",
  "ffprobe": "C:\\Tools\\ffmpeg\\bin\\ffprobe.exe",
  "chrome": "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "cacheRoot": "E:\\SeenSaidMediaCache"
}
```

```powershell
node scripts/asbplayer-open.mjs 'C:\Users\your-name\AppData\Local\SeenSaid\opener.json'

# 安装/更新固定目录和桌面快捷方式，保留已有配置：
node scripts/install-asbplayer-opener.mjs 'C:\Users\your-name\AppData\Local\SeenSaid\opener.json'
```

不传 `cacheRoot` 时使用 `%LOCALAPPDATA%\SeenSaid\media-cache`。
首次可能需要一份接近原视频大小的缓存空间；不自动删除已经成功的缓存。
关闭打开器和播放器后可删除不需要的缓存目录，不影响原视频。
缓存损坏时保留 `*-invalid-*` 目录并重新准备；失败的临时目录清理后可重试。

安装器使用固定目录 `%LOCALAPPDATA%\SeenSaid\asbplayer-opener` 和桌面「语见本机视频」快捷方式，
隐藏启动终端；PowerShell 执行策略仅为该启动进程设置，不更改系统策略。更新时仅更新打开器脚本，
保留本机配置、依赖和缓存。不要在主仓库旧提交上重建已加载扩展；开发工作树通过验证后再同步产物。

## 数据与验证边界

- Node 仅监听随机 `127.0.0.1` 端口。会话令牌通过 URL fragment 一次交给本机页面，
  随后从地址栏移除；请求使用 Authorization，校验准确 Host 和 Origin。
- 网页不能提交任意本机路径，只能触发原生文件选择；相邻字幕搜索只在视频所在目录和下一层，
  限制遍历量。文件下载只接受本次选定文件的随机 ID。
- 向官网传输的是内存 File/Blob，通过准确 opener、origin、单次 nonce 匹配；
  官网生成自己的 blob URL，原有被动桥接的同源和会话校验保持不变。
- 媒体不进入语见业务消息、Provider 请求或 Git。用户划词后仍按既有同意和 Provider 设置工作。
  官网页面取得文件的信任边界与用户手工拖入官网相同，浏览器导入不意味着上传媒体。
- 不增加 Chrome 权限，不依赖 Native Messaging，不修改账号、外部词典或系统文件关联。
- FFmpeg 用于本机解码/封装，采用外部本机可执行文件，不加入扩展依赖。
  对比纯浏览器 WASM，此方式避免整集转码的浏览器资源限制；不引入远程执行服务。
  媒体解析器仍需保持更新；本仓库不重新分发 FFmpeg 二进制。

测试分开记录：核心单元测试、正式扩展离线文件交接、官网完整学习流程、原生文件选择和快捷方式。
自动注入一个已知选择结果只能证明媒体处理与浏览器链路，不能证明原生文件选择窗口可用。
macOS 原生打开器尚未实现；共享内容脚本须通过双平台 CI，不能把 Windows 实机结果当作 Mac 通过。
