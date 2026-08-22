import { request as requestHttp } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

import { verifyAcceptanceRuntime } from "./acceptance-local-runtime.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = resolve(repositoryRoot, "apps/web/dist");

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".woff2", "font/woff2"],
]);

export function resolveStaticPath(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.split("/").includes("..")) return null;
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const candidate = resolve(root, relative);
  return candidate === root || candidate.startsWith(`${root}${sep}`) ? candidate : null;
}

export function requestPathname(requestTarget) {
  const pathname = requestTarget.split("?", 1)[0];
  return pathname.startsWith("/") ? pathname : null;
}

export async function loadWebBundleSnapshot(root) {
  const assets = new Map();
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) {
          await visit(path);
          return;
        }
        if (!entry.isFile()) throw new Error("Web bundle is incomplete.");
        assets.set(path, {
          body: await readFile(path),
          contentType: contentTypes.get(extname(path)) ?? "application/octet-stream",
          isIndex: path === resolve(root, "index.html"),
        });
      }),
    );
  };
  await visit(root);
  const index = assets.get(resolve(root, "index.html"));
  if (index === undefined) throw new Error("Web bundle is incomplete.");
  return Object.freeze({
    lookup(pathname) {
      const path = resolveStaticPath(root, pathname);
      if (path === null) return null;
      return assets.get(path) ?? index;
    },
  });
}

function parseEnvironment(contents) {
  return Object.fromEntries(
    contents
      .split(/\r?\n/u)
      .filter((line) => line !== "" && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        if (separator < 1) throw new Error("Local acceptance environment is invalid.");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

function requestHeaders(request) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value !== undefined) headers.set(name, value);
  }
  return headers;
}

export function requestCarriesBody(method, headers) {
  if (method === "GET" || method === "HEAD") return false;
  const transferEncoding = headers["transfer-encoding"];
  if (
    (Array.isArray(transferEncoding) && transferEncoding.some((value) => value !== "")) ||
    (typeof transferEncoding === "string" && transferEncoding !== "")
  ) {
    return true;
  }
  const contentLength = headers["content-length"];
  const values = Array.isArray(contentLength)
    ? contentLength
    : contentLength === undefined
      ? []
      : [contentLength];
  return values.some((value) => /^[0-9]+$/u.test(value) && BigInt(value) > 0n);
}

async function writeFetchResponse(response, outgoing) {
  outgoing.statusCode = response.status;
  const cookies = response.headers.getSetCookie?.() ?? [];
  for (const [name, value] of response.headers) {
    if (name !== "set-cookie") outgoing.setHeader(name, value);
  }
  if (cookies.length > 0) outgoing.setHeader("set-cookie", cookies);
  if (response.body === null) {
    outgoing.end();
    return;
  }
  Readable.fromWeb(response.body).pipe(outgoing);
}

async function createApiHandler(environment) {
  const { createAcceptanceApp } = await import(
    new URL("../apps/api/dist/acceptance-app.js", import.meta.url)
  );
  const app = createAcceptanceApp(environment);
  return async (incoming, outgoing) => {
    try {
      const method = incoming.method ?? "GET";
      const body = requestCarriesBody(method, incoming.headers)
        ? Readable.toWeb(incoming)
        : undefined;
      const request = new Request(
        new URL(incoming.url ?? "/", "https://api.acceptance.localhost:8444"),
        {
          ...(body === undefined ? {} : { body, duplex: "half" }),
          headers: requestHeaders(incoming),
          method,
        },
      );
      await writeFetchResponse(await app.fetch(request), outgoing);
    } catch {
      if (!outgoing.headersSent) outgoing.writeHead(500);
      outgoing.end();
    }
  };
}

function createSupabaseProxyHandler(incoming, outgoing) {
  const upstream = requestHttp(
    {
      headers: {
        ...incoming.headers,
        host: "127.0.0.1:54321",
        "x-forwarded-host": "supabase.acceptance.localhost:8445",
        "x-forwarded-proto": "https",
      },
      hostname: "127.0.0.1",
      method: incoming.method,
      path: incoming.url,
      port: 54321,
    },
    (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(outgoing);
    },
  );
  upstream.once("error", () => {
    if (!outgoing.headersSent) outgoing.writeHead(502);
    outgoing.end();
  });
  incoming.pipe(upstream);
}

function createWebHandler(webBundle) {
  return async (incoming, outgoing) => {
    const pathname = requestPathname(incoming.url ?? "/");
    if (pathname === null) {
      outgoing.writeHead(400);
      outgoing.end();
      return;
    }
    const asset = webBundle.lookup(pathname);
    if (asset === null) {
      outgoing.writeHead(400);
      outgoing.end();
      return;
    }
    outgoing.setHeader("content-type", asset.contentType);
    outgoing.setHeader("cache-control", asset.isIndex ? "no-store" : "no-cache");
    outgoing.end(asset.body);
  };
}

function listen(server, port, host) {
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolveListen());
  });
}

function close(server) {
  return new Promise((resolveClose) => server.close(() => resolveClose()));
}

export function createLoopbackEndpoints(ports, createServer) {
  return ports.flatMap((port, serviceIndex) =>
    ["127.0.0.1", "::1"].map((host) => ({
      host,
      port,
      server: createServer(serviceIndex),
    })),
  );
}

export async function listenServers(endpoints, listenServer = listen, closeServer = close) {
  const results = await Promise.allSettled(
    endpoints.map(({ host, port, server }) => listenServer(server, port, host)),
  );
  const failure = results.find((result) => result.status === "rejected");
  if (failure === undefined) return;
  await Promise.all(endpoints.map(({ server }) => closeServer(server)));
  throw failure.reason;
}

export async function serveAcceptanceLocal() {
  if (!(await verifyAcceptanceRuntime())) {
    throw new Error("Local acceptance Supabase runtime is not safely bound to loopback.");
  }
  const [certificate, key, environmentContents, webBundle] = await Promise.all([
    readFile(resolve(repositoryRoot, "supabase/certs/local-acceptance.pem")),
    readFile(resolve(repositoryRoot, "supabase/certs/local-acceptance-key.pem")),
    readFile(resolve(repositoryRoot, ".env.acceptance.local"), "utf8"),
    loadWebBundleSnapshot(webRoot),
  ]);
  const tls = { cert: certificate, key };
  const environment = parseEnvironment(environmentContents);
  const handlers = [
    createWebHandler(webBundle),
    await createApiHandler(environment),
    createSupabaseProxyHandler,
  ];
  const endpoints = createLoopbackEndpoints([8443, 8444, 8445], (serviceIndex) =>
    createHttpsServer(tls, handlers[serviceIndex]),
  );
  await listenServers(endpoints);
  process.stdout.write("Local acceptance Web, API, and Supabase HTTPS endpoints are running.\n");
  const shutdown = async () => {
    await Promise.all(endpoints.map(({ server }) => close(server)));
    process.exitCode = 0;
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

function runChild(command, arguments_, options = {}) {
  return new Promise((resolveResult) => {
    let stdout = "";
    const child = spawn(command, arguments_, {
      cwd: repositoryRoot,
      env: options.env ?? process.env,
      shell: false,
      stdio: options.capture ? ["ignore", "pipe", "ignore"] : "inherit",
      windowsHide: true,
    });
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      if (stdout.length < 4096) stdout += chunk;
    });
    child.once("error", () => resolveResult({ code: null, stdout: "" }));
    child.once("exit", (code, signal) =>
      resolveResult({ code: signal === null ? code : null, stdout }),
    );
  });
}

async function launchTrustedChild() {
  const caroot = await runChild("mkcert", ["-CAROOT"], { capture: true });
  if (caroot.code !== 0 || caroot.stdout.trim() === "") {
    throw new Error("Local CA root is unavailable.");
  }
  const result = await runChild(
    process.execPath,
    [fileURLToPath(import.meta.url), "--trusted-child"],
    {
      env: {
        ...process.env,
        NODE_EXTRA_CA_CERTS: resolve(caroot.stdout.trim(), "rootCA.pem"),
      },
    },
  );
  return result.code ?? 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const operation =
    process.argv[2] === "--trusted-child" ? serveAcceptanceLocal() : launchTrustedChild();
  operation
    .then((exitCode) => {
      if (typeof exitCode === "number") process.exitCode = exitCode;
    })
    .catch(() => {
      process.stderr.write("Local acceptance HTTPS services failed to start.\n");
      process.exitCode = 1;
    });
}
