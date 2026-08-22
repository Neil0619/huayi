import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const environmentPath = resolve(repositoryRoot, ".env.acceptance.local");
const databaseContainer = "supabase_db_seen-and-said-local-acceptance";
const studioContainer = "supabase_studio_seen-and-said-local-acceptance";

function runCommand(command, arguments_, { input } = {}) {
  return new Promise((resolveResult) => {
    let stdout = "";
    const child = spawn(command, arguments_, {
      cwd: repositoryRoot,
      env: process.env,
      shell: false,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 131_072) stdout += chunk;
    });
    child.once("error", () => resolveResult({ code: null, stdout: "" }));
    child.once("exit", (code, signal) =>
      resolveResult({ code: signal === null ? code : null, stdout }),
    );
    if (input !== undefined) child.stdin.end(input);
  });
}

export function parseContainerEnvironment(entries) {
  const values = new Map(
    entries.map((entry) => {
      const separator = entry.indexOf("=");
      return separator < 1 ? [entry, ""] : [entry.slice(0, separator), entry.slice(separator + 1)];
    }),
  );
  const publishableKey = values.get("SUPABASE_PUBLISHABLE_KEY");
  const serviceRoleKey = values.get("SUPABASE_SECRET_KEY");
  if (!publishableKey || !serviceRoleKey) {
    throw new Error("Local Supabase credentials are unavailable.");
  }
  return { publishableKey, serviceRoleKey };
}

function encodedDatabaseUrl(password) {
  return `postgresql://huayi_acceptance_login:${encodeURIComponent(password)}@127.0.0.1:54322/postgres`;
}

export function renderAcceptanceEnvironment(values) {
  return [
    "# Generated for local acceptance only. Never commit or share this file.",
    "HUAYI_API_ORIGIN=https://api.acceptance.localhost:8444",
    "HUAYI_WEB_ORIGIN=https://app.acceptance.localhost:8443",
    "VITE_API_ORIGIN=https://api.acceptance.localhost:8444",
    "SUPABASE_URL=https://supabase.acceptance.localhost:8445",
    `HUAYI_DATABASE_URL=${encodedDatabaseUrl(values.databasePassword)}`,
    `SUPABASE_PUBLISHABLE_KEY=${values.publishableKey}`,
    `SUPABASE_SERVICE_ROLE_KEY=${values.serviceRoleKey}`,
    `HUAYI_REFRESH_ENCRYPTION_KEY=${values.refreshEncryptionKey}`,
    `HUAYI_SECRET_PEPPER=${values.pepper}`,
    "HUAYI_SECURITY_NOTIFICATION_MODE=disabled-local-acceptance",
    `CRON_SECRET=${values.cronSecret}`,
    `HUAYI_STORE_EXTENSION_ID=${"a".repeat(32)}`,
    "HUAYI_MIN_SUPPORTED_EXTENSION_VERSION=1.0.0",
    "HUAYI_ACCOUNT_EXPORT_BUCKET=account-exports-acceptance",
    `HUAYI_DEEPSEEK_LEGACY_PRICE_VERSION_ID=${values.legacyPriceVersionId}`,
    `HUAYI_DEEPSEEK_OFF_PEAK_PRICE_VERSION_ID=${values.offPeakPriceVersionId}`,
    `HUAYI_DEEPSEEK_PEAK_PRICE_VERSION_ID=${values.peakPriceVersionId}`,
    "",
  ].join("\n");
}

function parseEnvironment(contents) {
  return new Map(
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

async function existingGeneratedValues() {
  let contents;
  try {
    contents = await readFile(environmentPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  const environment = parseEnvironment(contents);
  const databaseUrl = new URL(environment.get("HUAYI_DATABASE_URL") ?? "");
  const required = (name) => {
    const value = environment.get(name);
    if (!value || value.includes("REPLACE_WITH")) {
      throw new Error("Local acceptance environment is invalid.");
    }
    return value;
  };
  return {
    cronSecret: required("CRON_SECRET"),
    databasePassword: decodeURIComponent(databaseUrl.password),
    legacyPriceVersionId: required("HUAYI_DEEPSEEK_LEGACY_PRICE_VERSION_ID"),
    offPeakPriceVersionId: required("HUAYI_DEEPSEEK_OFF_PEAK_PRICE_VERSION_ID"),
    peakPriceVersionId: required("HUAYI_DEEPSEEK_PEAK_PRICE_VERSION_ID"),
    pepper: required("HUAYI_SECRET_PEPPER"),
    refreshEncryptionKey: required("HUAYI_REFRESH_ENCRYPTION_KEY"),
  };
}

function newGeneratedValues() {
  return {
    cronSecret: randomBytes(32).toString("base64url"),
    databasePassword: randomBytes(24).toString("base64url"),
    legacyPriceVersionId: randomUUID(),
    offPeakPriceVersionId: randomUUID(),
    peakPriceVersionId: randomUUID(),
    pepper: randomBytes(32).toString("base64url"),
    refreshEncryptionKey: randomBytes(32).toString("base64url"),
  };
}

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

export function bootstrapSql(values) {
  const password = sqlLiteral(values.databasePassword);
  return `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'huayi_acceptance_login') THEN
    CREATE ROLE huayi_acceptance_login LOGIN NOINHERIT NOBYPASSRLS;
  END IF;
END;
$$;
ALTER ROLE huayi_acceptance_login PASSWORD ${password};
GRANT huayi_runtime TO huayi_acceptance_login;

INSERT INTO public.model_price_versions (
  id, provider, model, input_micro_usd_per_million,
  cached_input_micro_usd_per_million, output_micro_usd_per_million, effective_from
) VALUES
  (${sqlLiteral(values.legacyPriceVersionId)}, 'deepseek', 'deepseek-v4-flash', 140000, 2800, 280000, '2026-08-16T15:59:59Z'),
  (${sqlLiteral(values.offPeakPriceVersionId)}, 'deepseek', 'deepseek-v4-flash', 220000, 7000, 660000, '2026-08-16T16:00:00Z'),
  (${sqlLiteral(values.peakPriceVersionId)}, 'deepseek', 'deepseek-v4-flash', 440000, 14000, 1320000, '2026-08-16T16:00:01Z')
ON CONFLICT (id) DO NOTHING;

SELECT public.require_model_price_version(
  ${sqlLiteral(values.legacyPriceVersionId)}, 'deepseek', 'deepseek-v4-flash', 140000, 2800, 280000
);
SELECT public.require_model_price_version(
  ${sqlLiteral(values.offPeakPriceVersionId)}, 'deepseek', 'deepseek-v4-flash', 220000, 7000, 660000
);
SELECT public.require_model_price_version(
  ${sqlLiteral(values.peakPriceVersionId)}, 'deepseek', 'deepseek-v4-flash', 440000, 14000, 1320000
);

INSERT INTO public.runtime_controls (name, enabled)
VALUES ('model_kill_switch', false)
ON CONFLICT (name) DO UPDATE SET enabled = false, updated_at = now();

INSERT INTO storage.buckets (id, name, public)
VALUES ('account-exports-acceptance', 'account-exports-acceptance', false)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  public = false,
  updated_at = now();
`;
}

async function localSupabaseKeys() {
  const inspected = await runCommand("docker", ["inspect", studioContainer]);
  if (inspected.code !== 0) throw new Error("Local Supabase is unavailable.");
  const document = JSON.parse(inspected.stdout);
  const entries = document?.[0]?.Config?.Env;
  if (!Array.isArray(entries)) throw new Error("Local Supabase credentials are unavailable.");
  return parseContainerEnvironment(entries);
}

async function applyDatabaseBootstrap(values) {
  const result = await runCommand(
    "docker",
    ["exec", "-i", databaseContainer, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres"],
    { input: bootstrapSql(values) },
  );
  if (result.code !== 0) throw new Error("Local acceptance database bootstrap failed.");
}

async function writeEnvironment(values) {
  const temporaryPath = `${environmentPath}.tmp`;
  await writeFile(temporaryPath, renderAcceptanceEnvironment(values), { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, environmentPath);
}

export async function bootstrapAcceptanceLocal() {
  const [generated, keys] = await Promise.all([
    existingGeneratedValues().then((value) => value ?? newGeneratedValues()),
    localSupabaseKeys(),
  ]);
  const values = { ...generated, ...keys };
  await applyDatabaseBootstrap(values);
  await writeEnvironment(values);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  bootstrapAcceptanceLocal()
    .then(() => {
      process.stdout.write("Local acceptance secrets and database bootstrap are ready.\n");
    })
    .catch(() => {
      process.stderr.write("Local acceptance bootstrap failed.\n");
      process.exitCode = 1;
    });
}
