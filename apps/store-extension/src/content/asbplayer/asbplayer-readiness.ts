import type { AsbplayerSnapshot } from "./asbplayer-snapshot.js";
/** Offset changes preserve the user's track decision, but never mask source edits. */
export function onlyAsbplayerOffsetChanged(
  previous: AsbplayerSnapshot | null,
  next: AsbplayerSnapshot,
): boolean {
  return (
    previous !== null &&
    previous.status === "ready" &&
    next.status === "ready" &&
    previous.offsetKnown &&
    next.offsetKnown &&
    previous.session === next.session &&
    previous.offsetMs !== next.offsetMs &&
    previous.cues.length === next.cues.length &&
    next.cues.every((cue, index) => {
      const old = previous.cues[index];
      return (
        old !== undefined &&
        old.index === cue.index &&
        old.track === cue.track &&
        old.text === cue.text &&
        old.originalStartMs === cue.originalStartMs &&
        old.originalEndMs === cue.originalEndMs
      );
    })
  );
}
export function asbplayerFallbackMessage(
  snapshot: AsbplayerSnapshot,
  nativeFullscreen: boolean,
): string {
  if (snapshot.status === "invalidated") {
    switch (snapshot.reason) {
      case "invalid-message":
        return "字幕超出支持范围或播放器消息异常，已保留原字幕。请检查字幕文件，拆分过大的字幕后重新加载播放器。";
      case "channel-unavailable":
        return "播放器通信不可用，已保留原字幕。请重新加载 asbplayer 播放器。";
      case "closed":
        return "播放器已关闭，学习字幕已停止。请重新打开播放器。";
      default:
        return "媒体会话已变化，已保留原字幕。请重新加载播放器以获取完整字幕。";
    }
  }
  return nativeFullscreen
    ? "原生视频全屏不支持学习字幕。请退出全屏，使用播放器的页面全屏。"
    : "未找到唯一可用的视频，已保留原字幕。请确认只打开一个可见播放器，或重新加载。";
}
