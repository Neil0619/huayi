# Huayi 观看与划译

Huayi 帮助用户在不离开当前阅读或观看内容的情况下理解英文，并把需要记忆的词汇加入个人
生词本。以下词汇用于统一描述 YouTube 字幕体验。

## Language

**CurrentPlayer（当前播放器）**:
当前标准 YouTube 录播页面中，用户正在观看且 Huayi 可以安全关联的视频播放器。
_Avoid_: movie player、video element

**ActiveSourceTrack（活动源轨）**:
用户已在 YouTube 中开启并实际显示的英文字幕轨；Huayi 只接受它，不替用户选择另一条轨道。
_Avoid_: 首选英文轨、最佳英文轨

**TranslatedCaptionTrack（译文轨）**:
与活动源轨对应、面向简体中文的 YouTube 自动翻译字幕轨，只用于辅助理解。
_Avoid_: 模型翻译、整句翻译结果

**SubtitleSentence（字幕句）**:
由一组连续源字幕片段构成、在同一时间窗内完整展示和作为分析上下文的英文句子。
_Avoid_: 当前 cue、整条字幕

**EnglishMode（英文模式）**:
只展示字幕句英文原文的观看模式，也是每个新视频的默认模式。
_Avoid_: 单语开关关闭

**BilingualMode（双语模式）**:
在英文原文下同时展示有效简体中文译文的观看模式，可固定或通过按住快捷键临时进入。
_Avoid_: 翻译模式

**PauseOwnership（暂停所有权）**:
Huayi 因有效字幕选区而暂停一个原本正在播放的视频后，取得的有限恢复播放资格；用户操作可
立即撤销它。
_Avoid_: 自动恢复、暂停状态

**CaptionGeneration（字幕代次）**:
一次视频及播放器身份稳定期间的字幕会话；导航、换视频或播放器替换都会开始新的代次。
_Avoid_: 缓存版本、请求序号
