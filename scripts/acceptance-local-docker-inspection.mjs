import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { userInfo } from "node:os";
import { dirname, resolve } from "node:path";
import { isAbsolute as isPosixAbsolute, join as joinPosix } from "node:path/posix";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const macOsOrbStackDockerExecutable = "/Applications/OrbStack.app/Contents/MacOS/xbin/docker";
const linuxDockerExecutable = "/usr/bin/docker";
const linuxDockerSocket = "/var/run/docker.sock";

export function canonicalDockerHubRepoDigest(repository, digest) {
  if (!repository.startsWith("docker.io/")) return null;
  const path = repository.slice("docker.io/".length).replace(/^library\//u, "");
  return path.length === 0 ? null : `${path}@${digest}`;
}

export function runBoundedLocalInspection(
  command,
  arguments_,
  { maxOutputBytes = 32_768, timeoutMilliseconds = 5_000 } = {},
) {
  return new Promise((resolveResult) => {
    let settled = false;
    let stdout = "";
    let timeout;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveResult(result);
    };
    const child = spawn(command, arguments_, {
      cwd: repositoryRoot,
      env: { LANG: "C", LC_ALL: "C" },
      shell: false,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
    timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ code: null, stdout: "" });
    }, timeoutMilliseconds);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (stdout.length < maxOutputBytes) {
        stdout += chunk.slice(0, maxOutputBytes - stdout.length);
      }
    });
    child.once("error", () => finish({ code: null, stdout: "" }));
    child.once("exit", (code, signal) => {
      finish({ code: signal === null ? code : null, stdout });
    });
  });
}

function selectFixedLocalDockerPaths(platform, getCurrentUser) {
  if (platform === "darwin") {
    const currentUser = getCurrentUser();
    if (
      typeof currentUser?.homedir !== "string" ||
      currentUser.homedir.length === 0 ||
      !isPosixAbsolute(currentUser.homedir)
    ) {
      throw new Error("Local Docker inspection target is unavailable.");
    }
    return {
      command: macOsOrbStackDockerExecutable,
      socket: joinPosix(currentUser.homedir, ".orbstack", "run", "docker.sock"),
    };
  }
  if (platform === "linux") {
    return { command: linuxDockerExecutable, socket: linuxDockerSocket };
  }
  throw new Error("Docker inspection platform is unsupported.");
}

export async function resolveLocalDockerInspectionTarget({
  environment = process.env,
  getCurrentUser = userInfo,
  inspectPath = stat,
  platform = process.platform,
} = {}) {
  if (Object.hasOwn(environment, "DOCKER_HOST") || Object.hasOwn(environment, "DOCKER_CONTEXT")) {
    throw new Error("Docker environment selectors are forbidden.");
  }

  const paths = selectFixedLocalDockerPaths(platform, getCurrentUser);
  try {
    const [executable, socket] = await Promise.all([
      inspectPath(paths.command),
      inspectPath(paths.socket),
    ]);
    if (
      executable.isFile() !== true ||
      (executable.mode & 0o111) === 0 ||
      socket.isSocket() !== true
    ) {
      throw new Error("invalid target");
    }
  } catch {
    throw new Error("Local Docker inspection target is unavailable.");
  }

  return Object.freeze({
    command: paths.command,
    host: `unix://${paths.socket}`,
  });
}
