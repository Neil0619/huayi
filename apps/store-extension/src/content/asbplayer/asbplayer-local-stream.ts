import { parseLocalStreamUrl } from "../../asbplayer-stream-url.js";
import { isRecord } from "./asbplayer-snapshot.js";
export function installStreamMediaCors(doc: Document, url: string): () => void {
  let panel: HTMLDivElement | undefined;
  const message =
    "本机视频暂时无法读取。请保持打开器运行，并在 Chrome 提示时允许播放器访问本机服务。";
  const error = (event: Event) => {
    if (
      !(event.target instanceof HTMLVideoElement) ||
      event.target.src !== url ||
      event.target.preload !== "auto"
    )
      return;
    if (!panel) {
      panel = doc.createElement("div");
      panel.dataset.huayiLocalStreamError = "";
      panel.setAttribute("role", "status");
      panel.style.cssText =
        "position:fixed;top:55px;left:12px;right:12px;z-index:2147483000;background:#222;color:white;padding:12px;border-radius:8px";
      const label = doc.createElement("p"),
        retry = doc.createElement("button");
      label.textContent = message;
      retry.textContent = "重试本机播放";
      retry.onclick = async () => {
        retry.disabled = true;
        try {
          // A trusted click can request Chrome's site-level loopback permission.
          const response = await fetch(url, {
            method: "HEAD",
            credentials: "omit",
            referrerPolicy: "no-referrer",
          });
          if (!response.ok) throw new Error("unavailable");
          label.textContent = "正在重新加载本机视频…";
          for (const video of doc.querySelectorAll("video")) if (video.src === url) video.load();
        } catch {
          label.textContent =
            "请确认打开器仍在运行、缓存未被修改，并在地址栏的网站权限中允许访问本机服务后重试。";
        } finally {
          retry.disabled = false;
        }
      };
      panel.append(label, retry);
      doc.body.append(panel);
    }
    panel.hidden = false;
  };
  const ready = (event: Event) => {
    if (
      panel &&
      event.target instanceof HTMLVideoElement &&
      event.target.src === url &&
      event.target.preload === "auto"
    )
      panel.hidden = true;
  };
  const update = () => {
    for (const video of doc.querySelectorAll("video"))
      if (video.src === url && video.crossOrigin !== "anonymous") video.crossOrigin = "anonymous";
  };
  const observer = new MutationObserver(update);
  const stop = () => {
    observer.disconnect();
    doc.defaultView?.removeEventListener("pagehide", hide);
    doc.removeEventListener("error", error, true);
    doc.removeEventListener("loadeddata", ready, true);
    panel?.remove();
  };
  const hide = (event: PageTransitionEvent) => {
    if (!event.persisted) stop();
  };
  observer.observe(doc, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src"],
  });
  doc.defaultView?.addEventListener("pagehide", hide);
  doc.addEventListener("error", error, true);
  doc.addEventListener("loadeddata", ready, true);
  update();
  return stop;
}

interface StreamImport {
  readonly video: { readonly url: string; readonly name: string; readonly size: number };
  readonly files: File[];
}
export function acceptLocalStream(descriptor: { origin: string; nonce: string }, source: unknown) {
  let used = false;
  return (event: { origin: string; source: unknown; data: unknown }): StreamImport | null => {
    const data = event.data;
    if (
      used ||
      event.origin !== descriptor.origin ||
      event.source !== source ||
      !isRecord(data) ||
      data.type !== "seen-said/local-stream" ||
      data.nonce !== descriptor.nonce ||
      !isRecord(data.video) ||
      !Array.isArray(data.files)
    )
      return null;
    const video = data.video;
    const url = parseLocalStreamUrl(video.url, descriptor.origin);
    if (
      !url ||
      typeof video.name !== "string" ||
      video.name.length > 255 ||
      !/^[^\\/]+\.mp4$/iu.test(video.name) ||
      video.name.includes(String.fromCharCode(0)) ||
      typeof video.size !== "number" ||
      !Number.isSafeInteger(video.size) ||
      video.size <= 0 ||
      video.size > 32_000_000_000 ||
      data.files.length < 1 ||
      data.files.length > 3 ||
      !data.files.every(
        (file): file is File =>
          file instanceof File &&
          file.size > 0 &&
          file.size <= 16_000_000 &&
          file.name.length <= 255 &&
          !/[\\/]/u.test(file.name) &&
          !file.name.includes(String.fromCharCode(0)) &&
          /\.(srt|ass|ssa|vtt)$/iu.test(file.name),
      )
    )
      return null;
    used = true;
    return { video: { url, name: video.name, size: video.size }, files: data.files };
  };
}

/** One exact File, one upstream URL creation; ordinary files and blobs retain native behavior. */
export function mapStreamFile(
  file: File,
  url: string,
  consumed: () => void = () => undefined,
  expired: () => void = () => undefined,
): () => void {
  const original = URL.createObjectURL;
  const restore = () => {
    if (URL.createObjectURL === mapped) URL.createObjectURL = original;
    clearTimeout(timer);
    window.removeEventListener("pagehide", restore);
  };
  const mapped = (object: Blob | MediaSource) => {
    if (object !== file) return original.call(URL, object);
    restore();
    consumed();
    return url;
  };
  const timer = setTimeout(() => {
    restore();
    expired();
  }, 10_000);
  window.addEventListener("pagehide", restore);
  URL.createObjectURL = mapped;
  return restore;
}
