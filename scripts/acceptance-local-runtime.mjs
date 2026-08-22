import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { inspectAcceptanceLocal } from "./acceptance-local-doctor.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const ACCEPTANCE_LOCAL_NETWORK = "seen-said-local-acceptance";
export const ACCEPTANCE_LOCAL_BINDING_OPTION = "com.docker.network.bridge.host_binding_ipv4";
const supabaseEntrypoint = resolve(repositoryRoot, "node_modules/supabase/dist/supabase.js");
const supabaseProject = "seen-and-said-local-acceptance";

function runCommand(command, arguments_, { capture = false } = {}) {
  return new Promise((resolveResult) => {
    let stdout = "";
    const child = spawn(command, arguments_, {
      cwd: repositoryRoot,
      env: process.env,
      shell: false,
      stdio: ["ignore", capture ? "pipe" : "ignore", "ignore"],
      windowsHide: true,
    });
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      if (stdout.length < 131_072) stdout += chunk;
    });
    child.once("error", () => resolveResult({ code: null, stdout: "" }));
    child.once("exit", (code, signal) =>
      resolveResult({ code: signal === null ? code : null, stdout }),
    );
  });
}

async function inspectNetwork(run) {
  const result = await run(
    "docker",
    ["network", "inspect", ACCEPTANCE_LOCAL_NETWORK, "--format", "{{json .Options}}"],
    { capture: true },
  );
  if (result.code !== 0) return { exists: false, safe: false };
  try {
    const options = JSON.parse(result.stdout.trim());
    return {
      exists: true,
      safe: options?.[ACCEPTANCE_LOCAL_BINDING_OPTION] === "127.0.0.1",
    };
  } catch {
    return { exists: true, safe: false };
  }
}

export async function ensureAcceptanceLoopbackNetwork({ run = runCommand } = {}) {
  const existing = await inspectNetwork(run);
  if (existing.exists) return existing.safe;
  const created = await run("docker", [
    "network",
    "create",
    "--driver",
    "bridge",
    "--opt",
    `${ACCEPTANCE_LOCAL_BINDING_OPTION}=127.0.0.1`,
    "--label",
    "com.seen-said.acceptance=local",
    ACCEPTANCE_LOCAL_NETWORK,
  ]);
  if (created.code !== 0) return false;
  const verified = await inspectNetwork(run);
  return verified.exists && verified.safe;
}

export async function verifyAcceptanceRuntime({ run = runCommand } = {}) {
  const network = await inspectNetwork(run);
  if (!network.exists || !network.safe) return false;
  const listed = await run(
    "docker",
    ["ps", "--filter", `label=com.supabase.cli.project=${supabaseProject}`, "--format", "{{.ID}}"],
    { capture: true },
  );
  const containerIds = listed.stdout.trim().split(/\s+/u).filter(Boolean);
  if (listed.code !== 0 || containerIds.length === 0) return false;
  const inspected = await run(
    "docker",
    ["inspect", "--format", "{{json .NetworkSettings}}", ...containerIds],
    { capture: true },
  );
  if (inspected.code !== 0) return false;
  try {
    const containers = inspected.stdout
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return (
      Array.isArray(containers) &&
      containers.length === containerIds.length &&
      containers.every((container) => {
        const networks = container?.Networks;
        const ports = container?.Ports;
        return (
          typeof networks === "object" &&
          networks !== null &&
          Object.hasOwn(networks, ACCEPTANCE_LOCAL_NETWORK) &&
          typeof ports === "object" &&
          ports !== null &&
          Object.values(ports).every(
            (bindings) =>
              bindings === null ||
              (Array.isArray(bindings) &&
                bindings.every((binding) => binding.HostIp === "127.0.0.1")),
          )
        );
      })
    );
  } catch {
    return false;
  }
}

async function runSupabase(arguments_, run = runCommand) {
  return run(process.execPath, [supabaseEntrypoint, ...arguments_, "--output", "json"]);
}

export async function migrateAcceptanceDatabase({
  run = runCommand,
  verify = verifyAcceptanceRuntime,
} = {}) {
  if (!(await verify({ run }))) return false;
  const result = await runSupabase(["migration", "up", "--local"], run);
  return result.code === 0 && (await verify({ run }));
}

async function startRuntime() {
  if (!(await ensureAcceptanceLoopbackNetwork())) {
    process.stderr.write("Local acceptance network is not safely bound to loopback.\n");
    return 1;
  }
  const prerequisites = await inspectAcceptanceLocal();
  if (!prerequisites.ready) {
    process.stderr.write("Local acceptance prerequisites are blocked. Run the doctor command.\n");
    return 1;
  }
  const result = await runSupabase(["start", "--network-id", ACCEPTANCE_LOCAL_NETWORK]);
  if (result.code !== 0) {
    process.stderr.write("Local acceptance services failed to start.\n");
    return 1;
  }
  if (!(await verifyAcceptanceRuntime())) {
    process.stderr.write("Local acceptance services are not safely bound to loopback.\n");
    return 1;
  }
  process.stdout.write("Local acceptance Supabase services started on loopback.\n");
  return 0;
}

async function statusRuntime() {
  const result = await runSupabase(["status"]);
  if (result.code !== 0) {
    process.stderr.write("Local acceptance Supabase services are not ready.\n");
    return 1;
  }
  if (!(await verifyAcceptanceRuntime())) {
    process.stderr.write("Local acceptance services are not safely bound to loopback.\n");
    return 1;
  }
  process.stdout.write("Local acceptance Supabase services are running.\n");
  return 0;
}

async function migrateRuntime() {
  if (!(await migrateAcceptanceDatabase())) {
    process.stderr.write("Local acceptance database migration failed.\n");
    return 1;
  }
  process.stdout.write("Local acceptance database migrations are current.\n");
  return 0;
}

async function stopRuntime() {
  const result = await runSupabase(["stop"]);
  if (result.code !== 0) {
    process.stderr.write("Local acceptance Supabase services failed to stop.\n");
    return 1;
  }
  process.stdout.write("Local acceptance Supabase services stopped.\n");
  return 0;
}

export async function runAcceptanceLocalRuntime(action) {
  if (action === "start") return startRuntime();
  if (action === "status") return statusRuntime();
  if (action === "migrate") return migrateRuntime();
  if (action === "stop") return stopRuntime();
  process.stderr.write("Usage: acceptance-local-runtime.mjs <start|status|migrate|stop>\n");
  return 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAcceptanceLocalRuntime(process.argv[2])
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch(() => {
      process.stderr.write("Local acceptance runtime command failed.\n");
      process.exitCode = 1;
    });
}
