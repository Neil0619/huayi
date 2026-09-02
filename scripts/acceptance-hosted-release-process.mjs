import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const maximumOutputBytes = 1_000_000;
const allowedEnvironmentNames = Object.freeze([
  "CI",
  "GIT_ASKPASS",
  "GIT_SSH_COMMAND",
  "GPG_TTY",
  "HOME",
  "LANG",
  "LC_ALL",
  "PATH",
  "SHELL",
  "SSH_AUTH_SOCK",
  "TERM",
  "TMPDIR",
  "XDG_CONFIG_HOME",
  "npm_execpath",
]);

export function hostedReleaseChildEnvironment(environment = process.env) {
  const result = {};
  for (const name of allowedEnvironmentNames) {
    const value = environment[name];
    if (typeof value === "string" && value.length > 0 && !/[\0\r\n]/u.test(value)) {
      result[name] = value;
    }
  }
  return result;
}

async function inherited(command, arguments_, options) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, arguments_, {
      cwd: options.cwd,
      env: options.environment,
      shell: false,
      stdio: "inherit",
    });
    child.once("error", () => resolvePromise({ status: 1, stderr: "", stdout: "" }));
    child.once("exit", (code, signal) =>
      resolvePromise({
        status: code === 0 && signal === null ? 0 : 1,
        stderr: "",
        stdout: "",
      }),
    );
  });
}

export async function runHostedReleaseProcess(command, arguments_, options = {}) {
  if (options.inherit === true) return inherited(command, arguments_, options);
  try {
    const result = await execFileAsync(command, arguments_, {
      cwd: options.cwd,
      encoding: "utf8",
      env: options.environment,
      maxBuffer: maximumOutputBytes,
      shell: false,
    });
    return { status: 0, stderr: result.stderr, stdout: result.stdout };
  } catch {
    return { status: 1, stderr: "", stdout: "" };
  }
}
