import { createServer } from "node:http";
import { createReadStream, openAsBlob } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { basename, dirname } from "node:path";
import { openerHtml, openerClient } from "./asbplayer-opener-ui.mjs";
import { sessionProof, sessionToken, startPersistentOpener } from "./asbplayer-opener-session.mjs";
import { fileSampleDigest } from "./asbplayer-local-files.mjs";

export async function startMediaOpener({
  pickFile,
  prepare,
  sidecars,
  identityPath,
  port = 0,
  secret,
}) {
  if (identityPath)
    return startPersistentOpener(identityPath, (identity) =>
      startMediaOpener({ pickFile, prepare, sidecars, ...identity }),
    );
  const nonce = randomBytes(32).toString("hex");
  const token = secret ? sessionToken(secret, nonce) : randomBytes(32).toString("hex");
  const localFilesScript = await readFile(
    new URL("./asbplayer-local-files.mjs", import.meta.url),
    "utf8",
  );
  let state = { status: "empty", message: "请选择原视频", files: [], generation: randomUUID() };
  let media = new Map();
  let origin, close;
  const publish = async (result, source, neighbors) => {
    const video = result.files.find((file) => file.kind === "video");
    const videoPath = await realpath(video.path);
    const info = await stat(videoPath);
    const directory = dirname(videoPath);
    const reference = {
      localName: basename(videoPath),
      size: info.size,
      lastModified: Math.trunc(info.mtimeMs),
      sampleDigest: await fileSampleDigest(await openAsBlob(videoPath)),
    };
    const entries = [
      ...result.files,
      ...(await Promise.all(
        neighbors.map(async (file) => ({
          ...file,
          bytes: await readFile(file.path),
          size: (await stat(file.path)).size,
          kind: "subtitle",
          type: "text/plain",
          sidecar: true,
        })),
      )),
    ];
    const bilingual = entries.filter(
      (file) => file.sidecar && /chs.?eng|中英|双语/iu.test(file.name),
    );
    const preferred =
      bilingual.length === 1
        ? bilingual[0]
        : (entries.find(
            (file) => file.kind === "subtitle" && /^(eng|en)$/iu.test(file.language ?? ""),
          ) ?? entries.find((file) => file.kind === "subtitle"));
    media = new Map();
    const files = entries.map((file) => {
      const id = randomUUID();
      media.set(id, file);
      return {
        id,
        name: file.name,
        size: file.size,
        kind: file.kind,
        type: file.type,
        selected: file === preferred,
        ...(file.kind === "video" ? reference : {}),
      };
    });
    state = {
      status: "ready",
      generation: randomUUID(),
      name: basename(source),
      files,
      cache: { id: createHash("sha256").update(directory).digest("hex"), directory },
      message: "已准备好，点击开始学习",
      notice: [
        result.plan.imageSubtitleCount ? "此视频含图像字幕，图像轨道暂不能用于划词学习。" : "",
        result.plan.audioIndex === null ? "原视频没有音轨。" : "",
        result.plan.audioTrackCount > 1
          ? `已优先使用英语音轨（${result.plan.audioLanguage}）。`
          : "",
      ]
        .filter(Boolean)
        .join(" "),
    };
  };
  const choose = async (subtitle) => {
    const previous = state;
    state = { ...state, status: "busy", message: "请选择文件" };
    try {
      const source = await pickFile(subtitle);
      if (!source) {
        state = previous;
        return;
      }
      if (subtitle) {
        if (!/\.(srt|ass|ssa|vtt)$/iu.test(source) || (await stat(source)).size > 16_000_000)
          throw new Error("subtitle");
        // Snapshot sidecar bytes so replacing the source cannot change an active import.
        const bytes = await readFile(source);
        const id = randomUUID();
        media.set(id, { bytes, size: bytes.length, type: "text/plain" });
        state = {
          ...previous,
          generation: randomUUID(),
          message: "字幕已添加",
          files: [
            ...previous.files.map((file) => ({ ...file, selected: false })),
            {
              id,
              name: basename(source),
              size: bytes.length,
              kind: "subtitle",
              type: "text/plain",
              selected: true,
            },
          ],
        };
      } else {
        const result = await prepare(source, (message) => {
          state = { ...state, message };
        });
        const neighbors = await sidecars(source);
        // Sidecars are small; pin content to the selected generation.
        await publish(result, source, neighbors);
      }
    } catch {
      state = {
        ...previous,
        status: previous.files.length ? "ready" : "error",
        message:
          "准备失败：请检查媒体编码、工具路径和磁盘空间；当前支持 H.264/HEVC 与文字字幕，原文件未改动。",
      };
    }
  };
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
    const reject = (code) => {
      response.writeHead(code).end();
    };
    try {
      if (request.headers.host !== new URL(origin).host) return reject(403);
      const path = request.url;
      const challenge = /^\/api\/session\?challenge=([a-f0-9]{64})$/u.exec(path);
      if (secret && request.method === "GET" && challenge) {
        if (request.headers.origin && request.headers.origin !== origin) return reject(403);
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ nonce, proof: sessionProof(secret, challenge[1], nonce) }));
        return;
      }
      if (request.method === "GET" && ["/", "/opener.js", "/local-files.js"].includes(path)) {
        response.setHeader(
          "Content-Type",
          path === "/" ? "text/html; charset=utf-8" : "application/javascript; charset=utf-8",
        );
        response.end(
          path === "/"
            ? openerHtml
            : path === "/local-files.js"
              ? localFilesScript
              : `import { browserFileReader } from "/local-files.js"; (${openerClient.toString()})(window,document,browserFileReader(window));`,
        );
        return;
      }
      if (
        request.headers.authorization !== `Bearer ${token}` ||
        (request.headers.origin && request.headers.origin !== origin)
      )
        return reject(403);
      if (request.method === "GET" && path === "/api/state") {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify(state));
        return;
      }
      if (request.method === "GET" && path.startsWith("/file/")) {
        const file = media.get(path.slice(6));
        if (!file) return reject(404);
        if (file.kind === "video") return reject(410);
        response.setHeader("Content-Type", file.type);
        response.setHeader("Content-Length", file.size);
        if (file.bytes) response.end(file.bytes);
        else
          createReadStream(file.path)
            .on("error", () => response.destroy())
            .pipe(response);
        return;
      }
      if (request.method !== "POST" || !["/api/open", "/api/subtitle", "/api/close"].includes(path))
        return reject(404);
      if (
        request.headers.origin !== origin ||
        request.headers["content-type"] !== "application/json"
      )
        return reject(403);
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 128) return reject(413);
      }
      if (body !== "{}") return reject(400);
      if (state.status === "busy") return reject(409);
      if (path === "/api/close") {
        response.writeHead(202).end();
        setTimeout(close, 100).unref();
        return;
      }
      if (path === "/api/subtitle" && !state.files.length) return reject(409);
      void choose(path === "/api/subtitle");
      response.writeHead(202).end();
    } catch {
      if (!response.headersSent) reject(500);
      else response.destroy();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
  close = () =>
    new Promise((resolve) => {
      server.closeAllConnections();
      server.close(resolve);
    });
  return { origin, token, url: `${origin}/#${token}`, close, server };
}
