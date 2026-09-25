export const openerHtml = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>语见 · 本机视频</title>
<style>body{font:16px/1.6 system-ui;background:#f5f4f0;color:#212725;margin:0;padding:40px 20px}main{max-width:760px;margin:auto;background:white;padding:32px;border:1px solid #ddd;border-radius:18px}h1{font-size:28px}button{font:inherit;border:0;border-radius:8px;padding:10px 18px;background:#176453;color:white;cursor:pointer;margin:8px 8px 8px 0}button:disabled{opacity:.5;cursor:wait}p{overflow-wrap:anywhere}label{display:block;padding:8px;background:#f5f4f0;margin:4px 0;border-radius:6px}.muted{color:#56625c}#status{min-height:2em}#subtitles:empty{display:none}</style>
<main><p class="muted">语见 · 本机视频</p><h1>从原视频开始学习</h1><p>选择 MKV 或 MP4。自动准备浏览器音轨和文字字幕，原视频保持不变。</p><button id="open">选择原视频</button><button id="learn" disabled>开始学习</button><p id="status" role="status">准备就绪</p><section id="cache" hidden><p>缓存位置：<code id="cache-path"></code></p><p class="muted">每个缓存文件夹首次使用时授权读取；同目录的下一集会复用授权。浏览器收回权限时需要重新授权。</p><button id="authorize" hidden>授权缓存目录</button><button id="copy-cache">复制缓存路径</button></section><h2 id="title"></h2><div id="subtitles"></div><p id="notice" class="muted"></p><p class="muted">再次点击“选择原视频”即可换片。处理结果仅保存在本机缓存；第一次准备需要一些时间，再次打开会复用缓存。</p><p class="muted">请在已加载语见扩展的 Chrome 中使用。图像字幕暂不支持学习，可另选文字字幕。</p><button id="subtitle" disabled>添加文字字幕</button><button id="close">退出打开器</button></main><script type="module" src="/opener.js"></script></html>`;

export function openerClient(view, doc, reader) {
  const token = view.location.hash.slice(1);
  view.history.replaceState(null, "", "/");
  const open = doc.querySelector("#open"),
    learn = doc.querySelector("#learn");
  const status = doc.querySelector("#status"),
    subtitles = doc.querySelector("#subtitles");
  let current = null,
    generation = "",
    player = null,
    importing = false,
    choosing = false,
    authorizing = false,
    directoryReady = false;
  const authorize = doc.querySelector("#authorize");
  const controls = () => {
    const busy = importing || choosing || authorizing || current?.status === "busy";
    open.disabled = busy;
    doc.querySelector("#close").disabled = busy;
    doc.querySelector("#subtitle").disabled = current?.status !== "ready" || busy;
    learn.disabled = current?.status !== "ready" || busy || !directoryReady;
    authorize.hidden = current?.status !== "ready" || directoryReady;
    authorize.disabled = busy || typeof view.showDirectoryPicker !== "function";
  };
  let lastMessage = "";
  let acceptedPlayer = null,
    acceptedNonce = "";
  const request = (path, options = {}) =>
    view.fetch(path, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
  const fail = () => {
    status.textContent = "无法连接本机打开器，请通过启动快捷方式重新打开。";
  };
  const refresh = async () => {
    try {
      const response = await request("/api/state");
      if (!response.ok) {
        fail();
        return;
      }
      current = await response.json();
      controls();
      if (!importing && current.message !== lastMessage) status.textContent = current.message;
      lastMessage = current.message;
      if (generation === current.generation) return;
      generation = current.generation;
      directoryReady = false;
      controls();
      doc.querySelector("#cache").hidden = !current.cache;
      doc.querySelector("#cache-path").textContent = current.cache?.directory ?? "";
      doc.querySelector("#title").textContent = current.name ?? "";
      doc.querySelector("#notice").textContent = current.notice ?? "";
      subtitles.replaceChildren();
      for (const file of current.files.filter((file) => file.kind === "subtitle")) {
        const label = doc.createElement("label"),
          input = doc.createElement("input");
        input.type = "checkbox";
        input.value = file.id;
        input.checked = file.selected;
        label.append(input, ` ${file.name}`);
        subtitles.append(label);
      }
      if (current.status === "ready") {
        const selectedGeneration = generation;
        try {
          await reader.read(
            current.cache.id,
            current.files.find((file) => file.kind === "video"),
          );
          if (generation === selectedGeneration) directoryReady = true;
        } catch (error) {
          if (generation === selectedGeneration) status.textContent = error.message;
        }
        controls();
      }
    } catch {
      fail();
    }
  };
  const choose = async (path) => {
    choosing = true;
    controls();
    status.textContent = "请在文件选择窗口中选择文件…";
    try {
      await request(path, { method: "POST", body: "{}" });
      await refresh();
    } catch {
      fail();
    } finally {
      choosing = false;
      controls();
    }
  };
  authorize.onclick = async () => {
    if (!current?.cache || authorizing || importing) return;
    authorizing = true;
    const selectedGeneration = generation;
    controls();
    try {
      await reader.authorize(
        current.cache.id,
        current.files.find((file) => file.kind === "video"),
      );
      if (generation === selectedGeneration) {
        directoryReady = true;
        status.textContent = "缓存目录已授权，点击开始学习。";
      }
    } catch (error) {
      status.textContent =
        error.name === "AbortError" ? "已取消目录授权，可再次点击授权缓存目录。" : error.message;
    } finally {
      authorizing = false;
      controls();
    }
  };
  doc.querySelector("#copy-cache").onclick = async () => {
    if (!current?.cache) return;
    try {
      await view.navigator.clipboard.writeText(current.cache.directory);
      status.textContent = "缓存路径已复制，可粘贴到目录选择窗口。";
    } catch {
      status.textContent = "无法复制，请使用上方显示的缓存路径。";
    }
  };
  open.onclick = () => choose("/api/open");
  doc.querySelector("#subtitle").onclick = () => choose("/api/subtitle");
  doc.querySelector("#close").onclick = async () => {
    const response = await request("/api/close", { method: "POST", body: "{}" });
    if (!response.ok) {
      status.textContent = "当前正在处理文件，请完成后退出。";
      return;
    }
    view.clearInterval(timer);
    status.textContent = "打开器已退出，可关闭此页。";
    open.disabled = learn.disabled = true;
  };
  learn.onclick = () => {
    if (!current || importing || !directoryReady) return;
    const selected = new Set(
      [...subtitles.querySelectorAll("input:checked")].map((input) => input.value),
    );
    const files = current.files.filter((file) => file.kind === "video" || selected.has(file.id));
    if (files.length === 1) {
      status.textContent = "请先选择或添加文字字幕，才能使用学习功能。";
      return;
    }
    if (files.length > 4) {
      status.textContent = "最多选择三份文字字幕。";
      return;
    }
    const cacheId = current.cache.id;
    const nonce = view.crypto.randomUUID().replaceAll("-", "");
    let sent = false,
      active = true;
    const receive = async (event) => {
      if (
        event.origin !== "https://app.asbplayer.dev" ||
        event.source !== player ||
        event.data?.nonce !== nonce
      )
        return;
      if (event.data.type === "seen-said/local-imported") {
        if (acceptedPlayer && !acceptedPlayer.closed && acceptedPlayer !== player) {
          acceptedPlayer.postMessage(
            { type: "seen-said/local-replace", nonce: acceptedNonce },
            "https://app.asbplayer.dev",
          );
        }
        acceptedPlayer = player;
        acceptedNonce = nonce;
        cleanup();
        status.textContent = "已送入播放器。可在播放器确认轨道；换片时返回此页。";
        return;
      }
      if (event.data.type !== "seen-said/local-ready" || sent) return;
      sent = true;
      status.textContent = "正在将视频和字幕交给播放器…";
      try {
        const payload = [];
        for (const file of files) {
          if (file.kind === "video") {
            payload.push(await reader.read(cacheId, file));
            continue;
          }
          const response = await request(`/file/${file.id}`);
          if (!response.ok) throw new Error("file unavailable");
          payload.push(new view.File([await response.blob()], file.name, { type: file.type }));
        }
        if (!active) return;
        player.postMessage(
          { type: "seen-said/local-files", nonce, files: payload },
          "https://app.asbplayer.dev",
        );
      } catch (error) {
        directoryReady = false;
        cleanup();
        status.textContent = error.message || "文件导入失败，请重新打开原视频后再试。";
        controls();
      }
    };
    const cleanup = () => {
      active = false;
      importing = false;
      view.removeEventListener("message", receive);
      view.clearTimeout(timeout);
      controls();
    };
    const timeout = view.setTimeout(() => {
      cleanup();
      status.textContent = "未收到播放器确认。请检查语见扩展已启用，再点开始学习。";
    }, 180000);
    importing = true;
    controls();
    view.addEventListener("message", receive);
    player = view.open(
      `https://app.asbplayer.dev/#seen-said-open=${encodeURIComponent(JSON.stringify({ origin: view.location.origin, nonce }))}`,
      "_blank",
    );
    if (!player) {
      cleanup();
      status.textContent = "请允许此页打开播放器窗口。";
    } else status.textContent = "正在打开播放器…";
  };
  const timer = view.setInterval(refresh, 800);
  void refresh();
}
