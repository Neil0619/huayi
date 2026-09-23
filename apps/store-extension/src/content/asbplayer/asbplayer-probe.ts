import type { AsbplayerAdapter } from "./asbplayer-adapter.js";
import type { AsbplayerPlaybackContext } from "./asbplayer-location.js";
import { selectAsbplayerVideo } from "./asbplayer-video.js";

interface AsbplayerProbeOptions {
  readonly document: Document;
  readonly adapter: AsbplayerAdapter;
  readonly readContext: () => AsbplayerPlaybackContext | null;
}

/** M0-only diagnostic surface; deliberately has no subtitle rendering or external services. */
export function mountAsbplayerProbe(options: AsbplayerProbeOptions): () => void {
  const { document, adapter, readContext } = options;
  const view = document.defaultView;
  if (view === null) {
    adapter.dispose();
    return () => undefined;
  }
  const host = document.createElement("aside");
  host.setAttribute("data-seen-said-asbplayer-probe", "");
  // Official toolbar is at the top and playback menus open at the right.
  host.style.cssText = "position:fixed;left:12px;top:64px;z-index:2147483647;";
  const shadow = host.attachShadow({ mode: "open" });
  const panel = document.createElement("section");
  panel.style.cssText =
    "font:12px/1.5 system-ui;color:#fff;background:#17202a;border:1px solid #5b6d7c;border-radius:8px;padding:12px;max-width:320px;";
  const heading = document.createElement("strong");
  heading.textContent = "语见 · asbplayer M0 探针";
  const status = document.createElement("pre");
  status.style.margin = "8px 0";
  const controlStatus = document.createElement("div");
  controlStatus.textContent = "仅显示计数；播放操作需手动点击。";
  const pause = document.createElement("button");
  pause.textContent = "暂停测试";
  pause.dataset.action = "pause";
  const play = document.createElement("button");
  play.textContent = "播放测试";
  play.dataset.action = "play";
  panel.append(heading, status, pause, play, controlStatus);
  shadow.append(panel);
  let disposed = false;

  function currentVideo(): HTMLVideoElement | null {
    const context = readContext();
    if (context === null || adapter.getSnapshot().status !== "ready") return null;
    return selectAsbplayerVideo(document, context.mediaUrl);
  }

  function render(): void {
    if (disposed) return;
    if (!host.isConnected) document.documentElement?.append(host);
    const snapshot = adapter.getSnapshot();
    const video = currentVideo();
    const tracks = new Set(snapshot.cues.map((cue) => cue.track)).size;
    Object.assign(host.dataset, {
      status: snapshot.status,
      reason: snapshot.reason ?? "none",
      cues: String(snapshot.cues.length),
      tracks: String(tracks),
      offsetMs: String(snapshot.offsetMs),
      videoAvailable: String(video !== null),
      paused: video === null ? "unknown" : String(video.paused),
      session: String(snapshot.session),
      revision: String(snapshot.revision),
    });
    status.textContent = [
      `状态: ${snapshot.status} / ${snapshot.reason ?? "none"}`,
      `字幕: ${snapshot.cues.length} 条 / ${tracks} 轨`,
      `偏移: ${snapshot.offsetMs} ms`,
      `可控视频: ${video !== null ? "可用" : "不可用"}`,
      `暂停: ${video === null ? "未知" : video.paused ? "是" : "否"}`,
      `广播暂停: ${snapshot.playback === null ? "未知" : String(snapshot.playback.paused)}`,
      `播放模式: ${snapshot.playModes?.join(",") ?? "未知"}`,
      `会话/版本: ${snapshot.session}/${snapshot.revision}`,
    ].join("\n");
    pause.disabled = video === null;
    play.disabled = video === null;
  }

  pause.addEventListener("click", () => {
    const video = currentVideo();
    if (disposed || video === null) return;
    video.pause();
    controlStatus.textContent = "已发送本地暂停操作。";
    render();
  });
  play.addEventListener("click", () => {
    const video = currentVideo();
    if (disposed || video === null) return;
    void video
      .play()
      .then(() => {
        if (disposed || currentVideo() !== video) return;
        controlStatus.textContent = "本地播放操作成功。";
        render();
      })
      .catch(() => {
        if (disposed || currentVideo() !== video) return;
        controlStatus.textContent = "本地播放操作失败。";
        render();
      });
  });

  // Subscribe in the entry before DOM readiness; render separately so frame broadcasts are cheap.
  const interval = view.setInterval(render, 250);
  render();
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    view?.clearInterval(interval);
    view?.removeEventListener("pagehide", dispose);
    adapter.dispose();
    host.remove();
  }
  view.addEventListener("pagehide", dispose, { once: true });
  return dispose;
}
