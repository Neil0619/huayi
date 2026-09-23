# asbplayer 临时 CI 诊断

此文件所在 `codex/asbplayer-ci-diagnostics` 是独立诊断分支，不是产品候选，也不合并到 main。
产品候选仍在 `codex/asbplayer-windows-validation-fixes`。本分支将已有手动工作流入口接到离线
诊断，以取得 CI 的实际字体回退及媒体事件证据；其成功不表示完整质量门禁通过。

运行前校验准确 Git commit，Windows 使用 Node 26、macOS 使用 Node 24，pnpm 仍为 10.34.5。
诊断不会调用真实模型、外部词典或修改日常浏览器配置，也不更新截图基线或放宽行为断言。

```powershell
pnpm install --frozen-lockfile
pnpm exec playwright install chrome
pnpm exec playwright install chromium
node scripts/diagnose-browser-rendering.mjs --run-offline-diagnostic
pnpm --filter @huayi/learning-domain --filter @huayi/cloud-contracts --filter @huayi/store-domain --filter @huayi/protocol build
pnpm --filter @huayi/store-extension build
node scripts/diagnose-asbplayer-shortcut.mjs --run-offline-diagnostic
```

字体诊断读取当前源码中的字体栈，仅对三段固定合成文字查询浏览器实际使用的字体；输出版本、
字体名称／字形数量、渲染器及尺寸，不读取或上传字体文件。可用 `--browser-executable <绝对路径>`
指定隔离浏览器作精确版本对照。固定 viewport 的 DPR 是渲染诊断读数，不是原生 Windows 缩放验收。

快捷键诊断重复 20 轮原失效流程，保留有效时暂停／恢复、失效后零 pause 事件及继续播放断言。
额外监听原生媒体事件，仅记录有界事件名、阶段、播放状态和合成媒体时间；不注入媒体事件或修改
产品 API。发生失败即非零退出，回执保留失败阶段；未复现不能证明此前 macOS 失败已修复。

工作流只上传两个 `.codex-pet-runs/targeted-ci/` 下的 JSON 回执，不上传媒体、字幕、频道、页面 URL、
Chrome profile 或凭据。诊断结果应摘录回产品候选的 Windows 验收文档，通过 Git 交接。
