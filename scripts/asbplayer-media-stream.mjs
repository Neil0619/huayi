import { randomBytes } from "node:crypto";
import { open, realpath, stat } from "node:fs/promises";

function byteRange(header, size) {
  if (header === undefined) return { start: 0, end: size - 1, partial: false };
  if (typeof header !== "string" || header.length > 80) return null;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const first = Number(match[1]),
    last = Number(match[2]);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) return null;
  if (!match[1] && last <= 0) return null;
  const start = match[1] ? first : Math.max(0, size - last);
  const end = match[1] && match[2] ? Math.min(last, size - 1) : size - 1;
  return start < size && start <= end ? { start, end, partial: true } : null;
}

/** Capabilities authorize one immutable file identity, never a browser-supplied path. */
export function createMediaStreams() {
  const entries = new Map();
  const active = new Set();
  return {
    async publish(path) {
      path = await realpath(path);
      const info = await stat(path);
      if (!info.isFile() || info.size <= 0 || info.size > 32_000_000_000)
        throw new Error("缓存视频不可用。");
      const capability = `/stream/${randomBytes(32).toString("hex")}`;
      entries.set(capability, { path, info });
      while (entries.size > 4) entries.delete(entries.keys().next().value);
      return capability;
    },
    async serve(request, response, origin) {
      if (!/^\/stream\/[a-f0-9]{64}$/u.test(request.url)) return false;
      const end = (code) => {
        response.writeHead(code).end();
        return true;
      };
      if (
        request.headers.host !== new URL(origin).host ||
        (request.headers.origin &&
          ![origin, "https://app.asbplayer.dev"].includes(request.headers.origin))
      )
        return end(403);
      if (!["GET", "HEAD"].includes(request.method)) return end(405);
      const entry = entries.get(request.url);
      if (!entry) return end(410);
      if (active.size >= 16) return end(429);
      // Reserve before filesystem awaits so simultaneous requests cannot bypass the limit.
      active.add(response);
      response.once("close", () => active.delete(response));
      let handle;
      try {
        if ((await realpath(entry.path)) !== entry.path) return end(410);
        handle = await open(entry.path, "r");
        const info = await handle.stat();
        if (response.destroyed) return true;
        if (
          !info.isFile() ||
          ["dev", "ino", "size", "mtimeMs"].some((key) => info[key] !== entry.info[key])
        )
          return end(410);
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Referrer-Policy", "no-referrer");
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
        response.setHeader(
          "Access-Control-Allow-Origin",
          request.headers.origin ?? "https://app.asbplayer.dev",
        );
        response.setHeader("Vary", "Origin");
        response.setHeader("Accept-Ranges", "bytes");
        response.setHeader("Content-Type", "video/mp4");
        const range = byteRange(request.headers.range, info.size);
        if (!range) {
          response.setHeader("Content-Range", `bytes */${info.size}`);
          return end(416);
        }
        response.statusCode = range.partial ? 206 : 200;
        response.setHeader("Content-Length", range.end - range.start + 1);
        if (range.partial)
          response.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${info.size}`);
        if (request.method === "HEAD") {
          response.end();
          return true;
        }
        const stream = handle.createReadStream({ start: range.start, end: range.end });
        handle = undefined; // The stream now owns and closes this exact descriptor.
        response.once("close", () => {
          stream.destroy();
        });
        stream.once("error", () => response.destroy());
        stream.pipe(response);
        return true;
      } catch {
        if (!response.headersSent) return end(410);
        response.destroy();
        return true;
      } finally {
        await handle?.close();
      }
    },
    clear() {
      entries.clear();
      for (const response of active) response.destroy();
      active.clear();
    },
  };
}
