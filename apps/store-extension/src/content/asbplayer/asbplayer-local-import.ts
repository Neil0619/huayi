import { acceptLocalStream, mapStreamFile } from "./asbplayer-local-stream.js";
interface LocalImportDescriptor {
  readonly origin: string;
  readonly nonce: string;
}
export function parseLocalImport(hash: string): LocalImportDescriptor | null {
  if (!hash.startsWith("#seen-said-open=") || hash.length > 512) return null;
  try {
    const value: unknown = JSON.parse(decodeURIComponent(hash.slice("#seen-said-open=".length)));
    if (
      !value ||
      typeof value !== "object" ||
      !("origin" in value) ||
      !("nonce" in value) ||
      typeof value.origin !== "string" ||
      typeof value.nonce !== "string"
    )
      return null;
    const url = new URL(value.origin);
    if (
      url.origin !== value.origin ||
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      !/^\d+$/u.test(url.port) ||
      Number(url.port) < 1024 ||
      !/^[a-f0-9]{32}$/u.test(value.nonce)
    )
      return null;
    return { origin: value.origin, nonce: value.nonce };
  } catch {
    return null;
  }
}

export function acceptLocalFiles(descriptor: LocalImportDescriptor, opener: unknown) {
  let used = false;
  return (event: { origin: string; source: unknown; data: unknown }): File[] | null => {
    if (used || event.origin !== descriptor.origin || event.source !== opener) return null;
    const data = event.data;
    if (
      !data ||
      typeof data !== "object" ||
      !("type" in data) ||
      data.type !== "seen-said/local-files" ||
      !("nonce" in data) ||
      data.nonce !== descriptor.nonce ||
      !("files" in data) ||
      !Array.isArray(data.files)
    )
      return null;
    const files: unknown[] = data.files;
    if (
      !files.length ||
      files.length > 4 ||
      !files.every(
        (file): file is File =>
          file instanceof File &&
          file.size > 0 &&
          file.size <= 32_000_000_000 &&
          file.name.length <= 255 &&
          !/[\\/]/u.test(file.name) &&
          !file.name.includes(String.fromCharCode(0)) &&
          (/\.mp4$/iu.test(file.name) ||
            (/\.(srt|ass|ssa|vtt)$/iu.test(file.name) && file.size <= 16_000_000)),
      )
    )
      return null;
    if (files.filter((file) => /\.mp4$/iu.test(file.name)).length !== 1) return null;
    used = true;
    return files;
  };
}

function allowPlayerReplacement(view: Window, descriptor: LocalImportDescriptor, opener: Window) {
  const stop = () => {
    view.removeEventListener("message", replace);
    view.removeEventListener("pagehide", hide);
  };
  const hide = (event: PageTransitionEvent) => {
    if (!event.persisted) stop();
  };
  const replace = (event: MessageEvent<unknown>) => {
    const data = event.data;
    if (
      event.origin !== descriptor.origin ||
      event.source !== opener ||
      !data ||
      typeof data !== "object" ||
      !("type" in data) ||
      data.type !== "seen-said/local-replace" ||
      !("nonce" in data) ||
      data.nonce !== descriptor.nonce
    )
      return;
    stop();
    view.close();
  };
  view.addEventListener("message", replace);
  view.addEventListener("pagehide", hide);
}

function installOpenButton(
  doc: Document,
  view: Window,
  opener: Window,
  descriptor: LocalImportDescriptor,
) {
  const button = doc.createElement("button");
  button.textContent = "打开另一个视频";
  button.dataset.huayiLocalOpen = "";
  button.style.cssText =
    "position:fixed;top:8px;left:220px;z-index:2147483000;padding:7px 12px;background:#222;color:white;border:1px solid #aaa;border-radius:6px;cursor:pointer";
  const status = doc.createElement("span");
  status.dataset.huayiLocalOpenStatus = "";
  status.setAttribute("role", "status");
  status.style.cssText =
    "position:fixed;top:50px;left:220px;z-index:2147483000;background:#222;color:white;padding:4px 8px";
  status.hidden = true;
  let timeout: number | undefined;
  const show = (text: string) => {
    status.textContent = text;
    status.hidden = false;
  };
  const receive = (event: MessageEvent<unknown>) => {
    if (event.origin !== descriptor.origin || event.source !== opener) return;
    const data = event.data;
    if (
      !data ||
      typeof data !== "object" ||
      !("type" in data) ||
      data.type !== "seen-said/local-open-result" ||
      !("nonce" in data) ||
      data.nonce !== descriptor.nonce ||
      !("status" in data)
    )
      return;
    if (data.status !== "busy" && data.status !== "choosing") return;
    view.clearTimeout(timeout);
    show(
      data.status === "busy"
        ? "打开器正在处理文件，请稍后重试。"
        : "请在文件窗口选择原视频，准备好后到打开器点击开始学习。",
    );
  };
  button.onclick = () => {
    view.clearTimeout(timeout);
    if (opener.closed) {
      show("本机打开器已关闭，请双击桌面「语见本机视频」重新打开。");
      return;
    }
    show("正在打开选片窗口…");
    opener.postMessage(
      { type: "seen-said/local-open", nonce: descriptor.nonce },
      descriptor.origin,
    );
    // Native selection is requested explicitly; focus alone can be ignored by Chrome.
    opener.focus();
    timeout = view.setTimeout(
      () => show("打开器没有响应，请双击桌面「语见本机视频」重新打开。"),
      5000,
    );
  };
  view.addEventListener("message", receive);
  view.addEventListener("pagehide", (event) => {
    if (event.persisted) return;
    view.removeEventListener("message", receive);
    view.clearTimeout(timeout);
  });
  doc.body.append(button, status);
}

export function installLocalMediaImport(doc: Document): void {
  const view = doc.defaultView;
  if (
    !view ||
    view.top !== view ||
    view.location.origin !== "https://app.asbplayer.dev" ||
    view.location.pathname !== "/" ||
    view.location.search ||
    !view.opener
  )
    return;
  const descriptor = parseLocalImport(view.location.hash);
  if (!descriptor) return;
  const opener = view.opener as Window;
  const accept = acceptLocalFiles(descriptor, opener);
  const acceptStream = acceptLocalStream(descriptor, opener);
  view.history.replaceState(null, "", "/");
  let ready = false;
  const cleanup = () => {
    observer.disconnect();
    view.removeEventListener("message", receive);
    view.removeEventListener("pagehide", cleanup);
    view.clearTimeout(timeout);
  };
  const receive = (event: MessageEvent<unknown>) => {
    if (!ready) return;
    const input = doc.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) return;
    const stream = acceptStream(event);
    const files = stream
      ? [new File([new Uint8Array(1)], stream.video.name, { type: "video/mp4" }), ...stream.files]
      : accept(event);
    if (!files) return;
    try {
      const transfer = new DataTransfer();
      for (const file of files) transfer.items.add(file);
      input.files = transfer.files;
      const imported = () => {
        allowPlayerReplacement(view, descriptor, opener);
        opener.postMessage(
          { type: "seen-said/local-imported", nonce: descriptor.nonce },
          descriptor.origin,
        );
        installOpenButton(doc, view, opener, descriptor);
      };
      if (stream) {
        const selectedFile = input.files?.[0];
        if (!selectedFile) return;
        mapStreamFile(selectedFile, stream.video.url, imported, () => {
          opener.postMessage(
            { type: "seen-said/local-import-error", nonce: descriptor.nonce },
            descriptor.origin,
          );
        });
      }
      input.dispatchEvent(new Event("change", { bubbles: true }));
      if (!stream) imported();
    } finally {
      cleanup();
    }
  };
  const check = () => {
    if (ready || !doc.querySelector('input[type="file"]')) return;
    ready = true;
    observer.disconnect();
    opener.postMessage(
      { type: "seen-said/local-ready", nonce: descriptor.nonce },
      descriptor.origin,
    );
  };
  const observer = new MutationObserver(check);
  const timeout = view.setTimeout(cleanup, 180000);
  view.addEventListener("message", receive);
  view.addEventListener("pagehide", cleanup);
  observer.observe(doc.documentElement, { subtree: true, childList: true });
  check();
}
