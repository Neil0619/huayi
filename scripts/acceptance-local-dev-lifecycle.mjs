import { spawn } from "node:child_process";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { request as requestHttps } from "node:https";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverEntrypoint = resolve(repositoryRoot, "scripts/acceptance-local-dev.mjs");
const statePath = resolve(repositoryRoot, ".acceptance-local-dev.pid");

export function parsePid(contents) {
  if (!/^\d+\s*$/u.test(contents)) return null;
  const pid = Number(contents.trim());
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

export function spawnDetachedServer({ environment, spawnProcess = spawn }) {
  const child = spawnProcess(process.execPath, [serverEntrypoint, "--trusted-child"], {
    cwd: repositoryRoot,
    detached: true,
    env: environment,
    shell: false,
    stdio: "ignore",
    windowsHide: true,
  });
  child.once?.("error", (error) => {
    void error;
  });
  return child;
}

export async function startPersistentServer(options) {
  const currentPid = await options.existingPid();
  if (currentPid !== null && options.isRunning(currentPid)) {
    if (await options.probe(currentPid)) return true;
    options.stopProcess(currentPid);
    for (let attempt = 0; attempt < 100 && options.isRunning(currentPid); attempt += 1) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    }
    if (options.isRunning(currentPid)) options.stopProcess(currentPid, "SIGKILL");
  }
  if (currentPid !== null) await options.removePid();

  const child = options.spawnServer();
  if (!Number.isSafeInteger(child.pid) || child.pid <= 0) return false;
  await options.writePid(child.pid);
  child.unref();
  if (await options.probe(child.pid)) return true;

  options.stopProcess(child.pid);
  await options.removePid();
  return false;
}

async function existingPid() {
  try {
    return parsePid(await readFile(statePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function writePid(pid) {
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${pid}\n`, { mode: 0o600 });
  await rename(temporaryPath, statePath);
}

async function removePid() {
  await rm(statePath, { force: true });
}

function stopProcess(pid, signal = "SIGTERM") {
  try {
    process.kill(pid, signal);
  } catch {
    // A process that already exited is stopped.
  }
}

function runMkcert() {
  return new Promise((resolveResult) => {
    let stdout = "";
    const child = spawn("mkcert", ["-CAROOT"], {
      cwd: repositoryRoot,
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 4096) stdout += chunk;
    });
    child.once("error", () => resolveResult(null));
    child.once("exit", (code, signal) =>
      resolveResult(code === 0 && signal === null ? stdout.trim() : null),
    );
  });
}

function probeEndpoint(url, ca, family) {
  return new Promise((resolveResult) => {
    const request = requestHttps(url, { ca, family, method: "GET", timeout: 2_000 }, (response) => {
      response.resume();
      resolveResult(response.statusCode === 200);
    });
    request.once("error", () => resolveResult(false));
    request.once("timeout", () => {
      request.destroy();
      resolveResult(false);
    });
    request.end();
  });
}

export async function probeLoopbackEndpoints(ca, probe = probeEndpoint) {
  const urls = [
    "https://app.acceptance.localhost:8443/app",
    "https://api.acceptance.localhost:8444/health",
    "https://supabase.acceptance.localhost:8445/auth/v1/health",
  ];
  const results = await Promise.all(
    urls.flatMap((url) => [4, 6].map((family) => probe(url, ca, family))),
  );
  return results.every(Boolean);
}

export async function waitUntilHealthy(
  pid,
  ca,
  {
    delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)),
    isRunning: checkRunning = isRunning,
    probe = probeLoopbackEndpoints,
  } = {},
) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!checkRunning(pid)) return false;
    if (await probe(ca)) {
      await delay(100);
      if (!checkRunning(pid)) return false;
      if (await probe(ca)) return true;
    }
    await delay(50);
  }
  return false;
}

async function localCa() {
  const caroot = await runMkcert();
  if (caroot === null || caroot === "") return null;
  try {
    return {
      path: resolve(caroot, "rootCA.pem"),
      value: await readFile(resolve(caroot, "rootCA.pem")),
    };
  } catch {
    return null;
  }
}

async function start() {
  const ca = await localCa();
  if (ca === null) return false;
  return startPersistentServer({
    existingPid,
    isRunning,
    probe: (pid) => waitUntilHealthy(pid, ca.value),
    removePid,
    spawnServer: () =>
      spawnDetachedServer({
        environment: { ...process.env, NODE_EXTRA_CA_CERTS: ca.path },
      }),
    stopProcess,
    writePid,
  });
}

async function status() {
  const [ca, pid] = await Promise.all([localCa(), existingPid()]);
  return ca !== null && pid !== null && isRunning(pid) && (await probeLoopbackEndpoints(ca.value));
}

export async function stopPersistentServer({
  delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)),
  existingPid: readExistingPid,
  isRunning: checkRunning,
  removePid: clearPid,
  stopProcess: signalProcess,
}) {
  const pid = await readExistingPid();
  if (pid === null) return true;
  if (checkRunning(pid)) signalProcess(pid);
  for (let attempt = 0; attempt < 100 && checkRunning(pid); attempt += 1) {
    await delay(50);
  }
  if (checkRunning(pid)) {
    signalProcess(pid, "SIGKILL");
    for (let attempt = 0; attempt < 100 && checkRunning(pid); attempt += 1) {
      await delay(50);
    }
  }
  await clearPid();
  return !checkRunning(pid);
}

async function stop() {
  return stopPersistentServer({
    existingPid,
    isRunning,
    removePid,
    stopProcess,
  });
}

export async function runPersistentDev(action) {
  if (action === "start") return start();
  if (action === "status") return status();
  if (action === "stop") return stop();
  return false;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const action = process.argv[2];
  runPersistentDev(action)
    .then((succeeded) => {
      if (!succeeded) {
        process.stderr.write("Local acceptance HTTPS service lifecycle failed.\n");
        process.exitCode = 1;
        return;
      }
      process.stdout.write(
        action === "stop"
          ? "Local acceptance HTTPS services stopped.\n"
          : "Local acceptance HTTPS services are running.\n",
      );
    })
    .catch(() => {
      process.stderr.write("Local acceptance HTTPS service lifecycle failed.\n");
      process.exitCode = 1;
    });
}
