import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const ACCEPTANCE_LOCAL_CHECK_IDS = Object.freeze([
  "node-runtime",
  "docker-cli",
  "docker-daemon",
  "loopback-network",
  "supabase-cli",
  "local-ca",
  "leaf-certificate",
  "supabase-config",
  "environment-template",
  "migration-baseline",
  "migration-forward",
  "seed-data",
]);

const SAFE_MESSAGES = Object.freeze({
  "docker-cli": "Docker CLI is not ready.",
  "docker-daemon": "Docker daemon is not ready.",
  "environment-template": "The local acceptance environment template is missing.",
  "leaf-certificate": "The local acceptance certificate is not ready.",
  "local-ca": "The local trust tool is not ready.",
  "loopback-network": "The local acceptance network is not safely bound to loopback.",
  "migration-baseline": "The Cloud database baseline is missing.",
  "migration-forward": "The Cloud database forward migration is missing.",
  "node-runtime": "Node.js 22 or newer is required for local acceptance.",
  "seed-data": "The local acceptance seed is missing.",
  "supabase-cli": "The pinned Supabase CLI is not ready.",
  "supabase-config": "The local Supabase manifest is missing.",
});

function runCommand(command, arguments_, expectedStdout) {
  return new Promise((resolveResult) => {
    let stdout = "";
    const child = spawn(command, arguments_, {
      env: process.env,
      shell: false,
      stdio: ["ignore", expectedStdout === undefined ? "ignore" : "pipe", "ignore"],
      windowsHide: true,
    });
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      if (stdout.length < 128) stdout += chunk;
    });
    child.once("error", () => resolveResult({ ok: false, stdout: "" }));
    child.once("exit", (code, signal) =>
      resolveResult({
        ok:
          code === 0 &&
          signal === null &&
          (expectedStdout === undefined || expectedStdout.test(stdout.trim())),
        stdout,
      }),
    );
  });
}

async function fileContains(path, markers) {
  try {
    const contents = await readFile(path, "utf8");
    return { ok: markers.every((marker) => contents.includes(marker)) };
  } catch {
    return { ok: false };
  }
}

async function localCaIsTrusted() {
  if (process.platform !== "darwin") return { ok: false };
  const caroot = await runCommand("mkcert", ["-CAROOT"], /.+/u);
  if (!caroot.ok) return { ok: false };
  return runCommand("security", [
    "verify-cert",
    "-c",
    resolve(caroot.stdout.trim(), "rootCA.pem"),
    "-p",
    "ssl",
  ]);
}

async function migrationBaselineMatches(root) {
  try {
    const [apiBaseline, supabaseBaseline] = await Promise.all([
      readFile(resolve(root, "apps/api/migrations/0001-cloud-v1-foundation.sql"), "utf8"),
      readFile(resolve(root, "supabase/migrations/20260821000000_cloud_v1_foundation.sql"), "utf8"),
    ]);
    return { ok: apiBaseline === supabaseBaseline };
  } catch {
    return { ok: false };
  }
}

async function migrationForwardMatches(root) {
  const migrations = [
    ["0002-account-default-quota.sql", "20260821010000_account_default_quota.sql"],
    ["0003-password-auth-callback-method.sql", "20260821020000_password_auth_callback_method.sql"],
    ["0004-analysis-reservation-fallback.sql", "20260821030000_analysis_reservation_fallback.sql"],
    [
      "0005-practice-generation-settlement.sql",
      "20260821040000_practice_generation_settlement.sql",
    ],
    ["0006-owner-scoped-analysis-export.sql", "20260821050000_owner_scoped_analysis_export.sql"],
    ["0007-analysis-export-owner-wrapper.sql", "20260821060000_analysis_export_owner_wrapper.sql"],
    [
      "0008-extension-pairing-atomic-snapshot.sql",
      "20260821070000_extension_pairing_atomic_snapshot.sql",
    ],
    ["0009-account-deletion-replay.sql", "20260821080000_account_deletion_replay.sql"],
    [
      "0010-quota-lifecycle-and-model-rate-limit.sql",
      "20260822010000_quota_lifecycle_and_model_rate_limit.sql",
    ],
    [
      "0011-security-notification-delivery.sql",
      "20260822020000_security_notification_delivery.sql",
    ],
    ["0012-first-operator-bootstrap.sql", "20260822030000_first_operator_bootstrap.sql"],
    [
      "0013-password-signup-interruption-recovery.sql",
      "20260823010000_password_signup_interruption_recovery.sql",
    ],
  ];
  try {
    const pairs = await Promise.all(
      migrations.map(async ([apiName, supabaseName]) =>
        Promise.all([
          readFile(resolve(root, "apps/api/migrations", apiName), "utf8"),
          readFile(resolve(root, "supabase/migrations", supabaseName), "utf8"),
        ]),
      ),
    );
    return { ok: pairs.every(([apiForward, supabaseForward]) => apiForward === supabaseForward) };
  } catch {
    return { ok: false };
  }
}

async function leafCertificateIsReady(root) {
  const certificatePath = resolve(root, "supabase/certs/local-acceptance.pem");
  const keyPath = resolve(root, "supabase/certs/local-acceptance-key.pem");
  const certificate = await runCommand(
    "openssl",
    ["x509", "-in", certificatePath, "-noout", "-ext", "subjectAltName"],
    /DNS:app\.acceptance\.localhost.*DNS:api\.acceptance\.localhost.*DNS:supabase\.acceptance\.localhost/su,
  );
  if (!certificate.ok) return { ok: false };
  try {
    const key = await stat(keyPath);
    return { ok: (key.mode & 0o777) === 0o600 };
  } catch {
    return { ok: false };
  }
}

async function defaultCheck(id, root) {
  if (id === "node-runtime") {
    return { ok: Number.parseInt(process.versions.node.split(".")[0] ?? "", 10) >= 22 };
  }
  if (id === "docker-cli") return runCommand("docker", ["--version"]);
  if (id === "docker-daemon") {
    return runCommand("docker", ["info", "--format", "{{.ServerVersion}}"]);
  }
  if (id === "loopback-network") {
    return runCommand(
      "docker",
      [
        "network",
        "inspect",
        "seen-said-local-acceptance",
        "--format",
        '{{index .Options "com.docker.network.bridge.host_binding_ipv4"}}',
      ],
      /^127\.0\.0\.1$/u,
    );
  }
  if (id === "supabase-cli") {
    return runCommand(
      process.execPath,
      [resolve(root, "node_modules/supabase/dist/supabase.js"), "--version"],
      /^2\.115\.0$/u,
    );
  }
  if (id === "local-ca") return localCaIsTrusted();
  if (id === "leaf-certificate") return leafCertificateIsReady(root);
  if (id === "supabase-config") {
    return fileContains(resolve(root, "supabase/config.toml"), [
      'project_id = "seen-and-said-local-acceptance"',
      "[db.migrations]",
      "enable_confirmations = true",
    ]);
  }
  if (id === "environment-template") {
    return fileContains(resolve(root, ".env.acceptance.example"), [
      "HUAYI_API_ORIGIN=https://api.acceptance.localhost:8444",
      "REPLACE_WITH",
    ]);
  }
  if (id === "migration-baseline") return migrationBaselineMatches(root);
  if (id === "migration-forward") return migrationForwardMatches(root);
  if (id === "seed-data") {
    return fileContains(resolve(root, "supabase/seed.sql"), [
      "local-acceptance-operator@seen-said.localhost",
      "ensure_current_default_quota",
    ]);
  }
  return { ok: false };
}

export async function inspectAcceptanceLocal({ check = defaultCheck, root = repositoryRoot } = {}) {
  const blockers = [];
  for (const id of ACCEPTANCE_LOCAL_CHECK_IDS) {
    let result;
    try {
      result = await check(id, root);
    } catch {
      result = { ok: false };
    }
    if (result?.ok !== true) blockers.push({ code: id, message: SAFE_MESSAGES[id] });
  }
  return { blockers, ready: blockers.length === 0 };
}

export async function runAcceptanceLocalDoctor({
  inspect = inspectAcceptanceLocal,
  stderr = process.stderr,
  stdout = process.stdout,
} = {}) {
  const result = await inspect();
  if (result.ready) {
    stdout.write("Local acceptance prerequisites are ready.\n");
    return 0;
  }
  stderr.write("Local acceptance prerequisites are blocked.\n");
  for (const blocker of result.blockers) {
    stderr.write(`- ${blocker.code}: ${blocker.message}\n`);
  }
  return 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAcceptanceLocalDoctor()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch(() => {
      process.stderr.write("Local acceptance prerequisite inspection failed.\n");
      process.exitCode = 1;
    });
}
