import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

export const hostedCredentialService = "cn.seen-said.huayi.hosted.acceptance";

export const hostedCredentialIds = Object.freeze([
  "supabase-admin-db-password",
  "supabase-application-db-password",
  "supabase-management-token",
  "vercel-token",
]);

const credentialLabels = Object.freeze({
  "supabase-admin-db-password": "语见 Hosted Supabase administrator database password",
  "supabase-application-db-password": "语见 Hosted Supabase application database password",
  "supabase-management-token": "语见 Hosted Supabase management token",
  "vercel-token": "语见 Hosted Vercel token",
});

const legacyEnvironmentNames = Object.freeze([
  "PGPASSWORD",
  "SUPABASE_DB_PASSWORD",
  "HUAYI_HOSTED_APP_DATABASE_PASSWORD",
  "HUAYI_HOSTED_MANAGEMENT_TOKEN",
  "HUAYI_HOSTED_SOURCE_DATABASE_PASSWORD",
  "HUAYI_HOSTED_TARGET_DATABASE_PASSWORD",
  "SUPABASE_ACCESS_TOKEN",
  "VERCEL_TOKEN",
]);

const maximumSecurityOutputBytes = 8_192;

export class HostedCredentialError extends Error {
  constructor(state) {
    super("Hosted credential is unavailable.");
    this.name = "HostedCredentialError";
    this.state = state;
  }
}

function assertCredentialId(credentialId) {
  if (!hostedCredentialIds.includes(credentialId)) {
    throw new Error("Hosted credential name is invalid.");
  }
}

export function rejectLegacyHostedCredentialEnvironment(environment = process.env) {
  if (legacyEnvironmentNames.some((name) => Object.hasOwn(environment, name))) {
    throw new Error("Hosted plaintext credential environment is forbidden.");
  }
}

function securityEnvironment(environment) {
  const allowedNames = ["HOME", "LOGNAME", "PATH", "TMPDIR", "USER"];
  return {
    ...Object.fromEntries(
      allowedNames.flatMap((name) =>
        typeof environment[name] === "string" ? [[name, environment[name]]] : [],
      ),
    ),
    LANG: "C",
    LC_ALL: "C",
  };
}

export function runSecurityCommand({
  arguments_,
  environment = process.env,
  interactive = false,
  spawnProcess = spawn,
  timeoutMilliseconds,
} = {}) {
  return new Promise((resolveResult) => {
    const effectiveTimeoutMilliseconds = timeoutMilliseconds ?? (interactive ? 300_000 : 5_000);
    let stderr = "";
    let stdout = "";
    let outputBytes = 0;
    let overflow = false;
    let settled = false;
    let timedOut = false;
    let timer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult(result);
    };
    let child;
    try {
      child = spawnProcess("/usr/bin/security", arguments_, {
        env: securityEnvironment(environment),
        shell: false,
        stdio: interactive ? "inherit" : ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch {
      finish({ code: null, stderr: "", stdout: "" });
      return;
    }
    timer = setTimeout(() => {
      timedOut = true;
      stderr = "";
      stdout = "";
      child.kill("SIGKILL");
    }, effectiveTimeoutMilliseconds);
    if (!interactive) {
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      const append = (current, chunk) => {
        outputBytes += Buffer.byteLength(chunk);
        if (outputBytes > maximumSecurityOutputBytes) {
          overflow = true;
          stderr = "";
          stdout = "";
          child.kill("SIGKILL");
          return current;
        }
        return current + chunk;
      };
      child.stdout.on("data", (chunk) => {
        stdout = append(stdout, chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr = append(stderr, chunk);
      });
    }
    child.once("error", () => finish({ code: null, stderr: "", stdout: "" }));
    child.once("close", (code, signal) =>
      finish({
        code: timedOut || overflow || signal !== null ? null : code,
        stderr: timedOut || overflow ? "" : stderr,
        stdout: timedOut || overflow ? "" : stdout,
      }),
    );
  });
}

function classifySecurityFailure(result) {
  if (result.code === 44 || /could not be found/iu.test(result.stderr)) return "missing";
  if (result.code === 36 || /interaction is not allowed|keychain is locked/iu.test(result.stderr)) {
    return "locked";
  }
  if (
    result.code === 128 ||
    /user canceled|authorization denied|access.*not allowed/iu.test(result.stderr)
  ) {
    return "denied";
  }
  return "unavailable";
}

function requireDarwin(platform) {
  if (platform !== "darwin") throw new HostedCredentialError("unsupported");
}

function securityReadArguments(credentialId, includePassword) {
  return [
    "find-generic-password",
    "-s",
    hostedCredentialService,
    "-a",
    credentialId,
    ...(includePassword ? ["-w"] : []),
  ];
}

function credentialValueIsValid(credentialId, value) {
  const byteLength = typeof value === "string" ? Buffer.byteLength(value) : 0;
  if (typeof value !== "string" || /[\0\r\n]/u.test(value)) return false;
  if (credentialId === "supabase-application-db-password") {
    return byteLength >= 32 && byteLength <= 512;
  }
  if (credentialId === "supabase-admin-db-password") {
    return byteLength >= 12 && byteLength <= 512;
  }
  return byteLength >= 16 && byteLength <= 4_096 && value.trim() === value;
}

function passwordFromSecurityOutput(stdout) {
  if (!stdout.endsWith("\n")) return undefined;
  return stdout.slice(0, -1);
}

export async function inspectHostedCredential(
  credentialId,
  { platform = process.platform, runSecurity = runSecurityCommand } = {},
) {
  assertCredentialId(credentialId);
  if (platform !== "darwin") return "unsupported";
  const result = await runSecurity({
    arguments_: securityReadArguments(credentialId, false),
    interactive: false,
  });
  return result.code === 0 ? "present" : classifySecurityFailure(result);
}

export async function readHostedCredential(
  credentialId,
  { environment = process.env, platform = process.platform, runSecurity = runSecurityCommand } = {},
) {
  assertCredentialId(credentialId);
  rejectLegacyHostedCredentialEnvironment(environment);
  requireDarwin(platform);
  const result = await runSecurity({
    arguments_: securityReadArguments(credentialId, true),
    interactive: false,
  });
  if (result.code !== 0) throw new HostedCredentialError(classifySecurityFailure(result));
  const value = passwordFromSecurityOutput(result.stdout);
  if (!credentialValueIsValid(credentialId, value)) throw new HostedCredentialError("invalid");
  return value;
}

export function readHostedAdministratorPassword({
  environment = process.env,
  readCredential = readHostedCredential,
} = {}) {
  rejectLegacyHostedCredentialEnvironment(environment);
  return readCredential("supabase-admin-db-password", { environment });
}

async function writeHostedCredential({ credentialId, runSecurity, stderrIsTTY, stdinIsTTY }) {
  if (!stdinIsTTY || !stderrIsTTY) throw new HostedCredentialError("unavailable");
  const result = await runSecurity({
    arguments_: [
      "add-generic-password",
      "-U",
      "-s",
      hostedCredentialService,
      "-a",
      credentialId,
      "-l",
      credentialLabels[credentialId],
      "-w",
    ],
    interactive: true,
  });
  if (result.code !== 0) throw new HostedCredentialError(classifySecurityFailure(result));
}

async function deleteHostedCredential({ credentialId, runSecurity }) {
  const result = await runSecurity({
    arguments_: ["delete-generic-password", "-s", hostedCredentialService, "-a", credentialId],
    interactive: false,
  });
  if (result.code === 0) return "removed";
  const state = classifySecurityFailure(result);
  if (state === "missing") return state;
  throw new HostedCredentialError(state);
}

function parseCliArguments(arguments_) {
  let normalizedArguments = arguments_[0] === "--" ? arguments_.slice(1) : [...arguments_];
  const operation = normalizedArguments.shift();
  if (normalizedArguments[0] === "--") normalizedArguments = normalizedArguments.slice(1);
  const [option, credentialId, ...rest] = normalizedArguments;
  if (!new Set(["configure", "diagnose", "remove", "rotate", "status"]).has(operation)) {
    return undefined;
  }
  if (option === undefined && credentialId === undefined && rest.length === 0) {
    if (operation === "rotate") return undefined;
    return { credentialIds: hostedCredentialIds, operation };
  }
  if (option !== "--name" || credentialId === undefined || rest.length !== 0) return undefined;
  if (!hostedCredentialIds.includes(credentialId)) return undefined;
  return { credentialIds: [credentialId], operation };
}

function stateFromError(error) {
  return error instanceof HostedCredentialError ? error.state : "unavailable";
}

export async function runHostedCredentialsCli({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  platform = process.platform,
  runSecurity = runSecurityCommand,
  stderrIsTTY = process.stderr.isTTY === true,
  stdinIsTTY = process.stdin.isTTY === true,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  const command = parseCliArguments(arguments_);
  if (command === undefined) {
    writeError("Hosted credential command failed.\n");
    return 1;
  }
  try {
    rejectLegacyHostedCredentialEnvironment(environment);
    requireDarwin(platform);
    if (new Set(["configure", "rotate"]).has(command.operation) && (!stdinIsTTY || !stderrIsTTY)) {
      throw new HostedCredentialError("unavailable");
    }
    const results = [];
    const recordResult = (credentialId, state, immediate = false) => {
      results.push([credentialId, state]);
      if (immediate) writeOutput(`credential|${credentialId}|${state}\n`);
    };

    if (new Set(["configure", "remove"]).has(command.operation)) {
      const preflight = [];
      for (const credentialId of command.credentialIds) {
        const state = await inspectHostedCredential(credentialId, { platform, runSecurity });
        if (state !== "present" && state !== "missing") {
          throw new HostedCredentialError(state);
        }
        if (command.operation === "configure" && state === "present") {
          await readHostedCredential(credentialId, { environment, platform, runSecurity });
        }
        preflight.push([credentialId, state]);
      }
      for (const [credentialId, state] of preflight) {
        if (command.operation === "configure") {
          if (state === "present") {
            recordResult(credentialId, "present", true);
            continue;
          }
          writeOutput(`credential|${credentialId}|input-required\n`);
          await writeHostedCredential({ credentialId, runSecurity, stderrIsTTY, stdinIsTTY });
          await readHostedCredential(credentialId, { environment, platform, runSecurity });
          recordResult(credentialId, "configured", true);
          continue;
        }
        if (state === "missing") {
          recordResult(credentialId, "missing", true);
          continue;
        }
        recordResult(
          credentialId,
          await deleteHostedCredential({ credentialId, runSecurity }),
          true,
        );
      }
      return results.every(([, state]) => new Set(["configured", "present", "removed"]).has(state))
        ? 0
        : 1;
    }

    for (const credentialId of command.credentialIds) {
      if (command.operation === "status") {
        const state = await inspectHostedCredential(credentialId, { platform, runSecurity });
        if (state !== "present" && state !== "missing") {
          throw new HostedCredentialError(state);
        }
        recordResult(credentialId, state);
        continue;
      }
      if (command.operation === "diagnose") {
        try {
          await readHostedCredential(credentialId, { environment, platform, runSecurity });
          recordResult(credentialId, "available");
        } catch (error) {
          const state = stateFromError(error);
          if (!new Set(["denied", "invalid", "locked", "missing"]).has(state)) throw error;
          recordResult(credentialId, state);
        }
        continue;
      }
      writeOutput(`credential|${credentialId}|input-required\n`);
      await writeHostedCredential({ credentialId, runSecurity, stderrIsTTY, stdinIsTTY });
      await readHostedCredential(credentialId, { environment, platform, runSecurity });
      recordResult(credentialId, "rotated");
    }
    for (const [credentialId, state] of results) {
      writeOutput(`credential|${credentialId}|${state}\n`);
    }
    return results.every(([, state]) =>
      new Set(["available", "configured", "present", "removed", "rotated"]).has(state),
    )
      ? 0
      : 1;
  } catch (error) {
    writeError(
      error instanceof HostedCredentialError && error.state === "unsupported"
        ? "Hosted credential command is unsupported on this platform.\n"
        : "Hosted credential command failed.\n",
    );
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedCredentialsCli();
}
