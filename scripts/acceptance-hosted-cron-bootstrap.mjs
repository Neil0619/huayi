import { pathToFileURL } from "node:url";

import {
  readHostedCredential,
  rejectLegacyHostedCredentialEnvironment,
} from "./acceptance-hosted-credentials.mjs";
import { upsertHostedCronSecret } from "./acceptance-hosted-cron-bootstrap-vercel.mjs";
import {
  renderEnsureVaultSourceSql,
  renderReadVaultSourceSql,
} from "./acceptance-hosted-cron-bootstrap-sql.mjs";
import { hostedCronStatusArgument, readHostedCronStatus } from "./acceptance-hosted-cron.mjs";
import { verifyHostedCronRepositoryCandidate } from "./acceptance-hosted-cron-repository.mjs";
import {
  hostedAcceptancePoolerUrl,
  hostedAcceptanceProjectRef,
  runHostedPsql,
} from "./acceptance-hosted-foundation.mjs";
import { fetchHostedAcceptanceOfficialCaCertificate } from "./acceptance-hosted-official-ca.mjs";
import { runHostedRuntimeSnapshotQuery } from "./acceptance-hosted-runtime-gates.mjs";

export const hostedCronProvisionConfirmation = `--confirm-provision-hosted-cron-secret-after-r3c-pending-${hostedAcceptanceProjectRef}`;
export const hostedCronDeliverConfirmation = `--confirm-deliver-hosted-r3c-after-secret-release-${hostedAcceptanceProjectRef}`;

const apiOrigin = "https://api.acceptance.seen-said.cn";
const notificationUrl = `${apiOrigin}/internal/security-notifications/run`;
const knownStages = new Set([
  "arguments",
  "credentials",
  "cron-absent",
  "delivery",
  "postflight",
  "r3c-pending",
  "repository-candidate",
  "vault-read",
  "vault-write",
  "vercel",
]);

class HostedCronBootstrapError extends Error {
  constructor(stage) {
    super(`Hosted Cron bootstrap failed at stage: ${stage}.`);
    this.name = "HostedCronBootstrapError";
    this.stage = stage;
  }
}

function fail(stage) {
  throw new HostedCronBootstrapError(stage);
}

function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validSecret(value, { maximum, minimum }) {
  return (
    typeof value === "string" &&
    Buffer.byteLength(value) >= minimum &&
    Buffer.byteLength(value) <= maximum &&
    value.trim() === value &&
    !/[\0\r\n]/u.test(value)
  );
}

function pendingR3c(snapshot) {
  return (
    record(snapshot) &&
    snapshot.r3c_total === "1" &&
    snapshot.r3c_pending === "1" &&
    snapshot.r3c_sending === "0" &&
    snapshot.r3c_sent === "0" &&
    snapshot.r3c_failed === "0" &&
    snapshot.r3c_dead_letter === "0" &&
    snapshot.r3c_claimable === "1" &&
    snapshot.r3c_overdue_nonterminal === "0" &&
    snapshot.r3c_max_attempts === "0" &&
    snapshot.r3c_contract_exact === "t"
  );
}

function exactCronAbsent(status) {
  return (
    record(status) &&
    status.cron_installation_state === "absent" &&
    status.cron_fixed_jobs_count === "0" &&
    status.cron_unmanaged_jobs_count === "0" &&
    status.cron_jobs_exact === "f" &&
    status.cron_function_contract_exact === "f"
  );
}

function sentR3c(snapshot) {
  return (
    record(snapshot) &&
    snapshot.r3c_total === "1" &&
    snapshot.r3c_pending === "0" &&
    snapshot.r3c_sending === "0" &&
    snapshot.r3c_sent === "1" &&
    snapshot.r3c_failed === "0" &&
    snapshot.r3c_dead_letter === "0" &&
    snapshot.r3c_claimable === "0" &&
    snapshot.r3c_overdue_nonterminal === "0" &&
    /^(?:[1-8])$/u.test(snapshot.r3c_max_attempts) &&
    snapshot.r3c_contract_exact === "t"
  );
}

function parseCronSecret(result, stage) {
  if (result?.code !== 0 || typeof result.stdout !== "string") fail(stage);
  const match = /^([0-9a-f]{64})\n$/u.exec(result.stdout);
  if (match === null) fail(stage);
  return match[1];
}

async function readInfrastructure({ environment, fetchCaCertificate, readCredential }) {
  try {
    const caCertificate = await fetchCaCertificate();
    const administratorPassword = await readCredential("supabase-admin-db-password", {
      environment,
    });
    if (!validSecret(administratorPassword, { maximum: 512, minimum: 12 })) fail("credentials");
    return { administratorPassword, caCertificate };
  } catch {
    fail("credentials");
  }
}

async function requireRepositoryCandidate(verifyRepositoryCandidate) {
  try {
    if ((await verifyRepositoryCandidate()) !== true) fail("repository-candidate");
  } catch {
    fail("repository-candidate");
  }
}

async function readSnapshot(secrets, runSnapshotQuery) {
  try {
    const snapshot = await runSnapshotQuery(secrets);
    if (!record(snapshot)) fail("r3c-pending");
    return snapshot;
  } catch {
    fail("r3c-pending");
  }
}

async function requireCronAbsent({ environment, readCronStatus, runPsql, secrets }) {
  try {
    const status = await readCronStatus({
      arguments_: ["status", hostedCronStatusArgument],
      environment,
      fetchCaCertificate: async () => secrets.caCertificate,
      readPassword: async () => secrets.administratorPassword,
      runPsql,
    });
    if (!exactCronAbsent(status)) fail("cron-absent");
  } catch (error) {
    if (error instanceof HostedCronBootstrapError) throw error;
    fail("cron-absent");
  }
}

function databaseRequest(secrets) {
  return {
    databaseUrl: hostedAcceptancePoolerUrl,
    environment: {
      HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: secrets.caCertificate,
    },
    password: secrets.administratorPassword,
    timeoutMilliseconds: 30_000,
  };
}

export function renderHostedCronBootstrapPlan() {
  return `Hosted Cron/R3-C bootstrap plan (zero filesystem / zero Git / zero network / zero write)
- Requires exactly one claimable password-reset security notification and no installed Cron surface.
- Fixed order: provision -> exact-SHA API release -> deliver -> user inbox confirmation -> Cron apply.
- Provision creates or reuses one 64-character lowercase-hex Vault bearer, sends it only in memory to Vercel Sensitive Production configuration, and never prints it.
- A Vercel environment change affects only a later deployment; deliver therefore fails closed until the approved release is READY.
- Deliver reads the bearer into bounded process memory, runs the normal product worker twice, and requires sent then idle to prove idempotent handling.
`;
}

export async function provisionHostedCronSecret({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetch_ = globalThis.fetch,
  fetchCaCertificate = fetchHostedAcceptanceOfficialCaCertificate,
  readCredential = readHostedCredential,
  readCronStatus = readHostedCronStatus,
  runPsql = runHostedPsql,
  runSnapshotQuery = runHostedRuntimeSnapshotQuery,
  verifyRepositoryCandidate = verifyHostedCronRepositoryCandidate,
} = {}) {
  if (
    arguments_.length !== 2 ||
    arguments_[0] !== "provision" ||
    arguments_[1] !== hostedCronProvisionConfirmation
  ) {
    fail("arguments");
  }
  try {
    rejectLegacyHostedCredentialEnvironment(environment);
  } catch {
    fail("credentials");
  }
  await requireRepositoryCandidate(verifyRepositoryCandidate);
  const secrets = await readInfrastructure({ environment, fetchCaCertificate, readCredential });
  if (!pendingR3c(await readSnapshot(secrets, runSnapshotQuery))) fail("r3c-pending");
  await requireCronAbsent({ environment, readCronStatus, runPsql, secrets });
  let cronSecret;
  try {
    cronSecret = parseCronSecret(
      await runPsql({
        ...databaseRequest(secrets),
        captureOutput: true,
        input: renderEnsureVaultSourceSql(),
      }),
      "vault-write",
    );
  } catch (error) {
    if (error instanceof HostedCronBootstrapError) throw error;
    fail("vault-write");
  }
  let token;
  try {
    token = await readCredential("vercel-token", { environment });
    if (!validSecret(token, { maximum: 4_096, minimum: 16 })) fail("credentials");
  } catch {
    fail("credentials");
  }
  try {
    await upsertHostedCronSecret({ cronSecret, fetch_, token });
  } catch {
    fail("vercel");
  }
  return Object.freeze({ outcome: "provisioned" });
}

async function requestNotification({ cronSecret, fetch_ }) {
  try {
    const response = await fetch_(notificationUrl, {
      cache: "no-store",
      credentials: "omit",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${cronSecret}`,
      },
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
    if (!response?.ok || response.status !== 200) fail("delivery");
    const text = await response.text();
    if (text.length === 0 || text.length > 1_024) fail("delivery");
    const parsed = JSON.parse(text);
    if (!record(parsed) || Object.keys(parsed).length !== 1) fail("delivery");
    return parsed.outcome;
  } catch (error) {
    if (error instanceof HostedCronBootstrapError) throw error;
    fail("delivery");
  }
}

export async function deliverHostedR3cNotification({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetch_ = globalThis.fetch,
  fetchCaCertificate = fetchHostedAcceptanceOfficialCaCertificate,
  readCredential = readHostedCredential,
  readCronStatus = readHostedCronStatus,
  runPsql = runHostedPsql,
  runSnapshotQuery = runHostedRuntimeSnapshotQuery,
  verifyRepositoryCandidate = verifyHostedCronRepositoryCandidate,
} = {}) {
  if (
    arguments_.length !== 2 ||
    arguments_[0] !== "deliver" ||
    arguments_[1] !== hostedCronDeliverConfirmation
  ) {
    fail("arguments");
  }
  try {
    rejectLegacyHostedCredentialEnvironment(environment);
  } catch {
    fail("credentials");
  }
  await requireRepositoryCandidate(verifyRepositoryCandidate);
  const secrets = await readInfrastructure({ environment, fetchCaCertificate, readCredential });
  const before = await readSnapshot(secrets, runSnapshotQuery);
  const alreadySent = sentR3c(before);
  if (!alreadySent && !pendingR3c(before)) fail("r3c-pending");
  await requireCronAbsent({ environment, readCronStatus, runPsql, secrets });
  let cronSecret;
  try {
    cronSecret = parseCronSecret(
      await runPsql({
        ...databaseRequest(secrets),
        captureOutput: true,
        input: renderReadVaultSourceSql(),
      }),
      "vault-read",
    );
  } catch (error) {
    if (error instanceof HostedCronBootstrapError) throw error;
    fail("vault-read");
  }
  const first = await requestNotification({ cronSecret, fetch_ });
  if (alreadySent ? first !== "idle" : first !== "sent") fail("delivery");
  if (!alreadySent && (await requestNotification({ cronSecret, fetch_ })) !== "idle") {
    fail("delivery");
  }
  const after = await readSnapshot(secrets, runSnapshotQuery);
  if (!sentR3c(after)) fail("postflight");
  return Object.freeze({ outcome: "delivered" });
}

export async function runHostedCronBootstrapCli({
  arguments_ = process.argv.slice(2),
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
  ...dependencies
} = {}) {
  if (arguments_.length === 1 && arguments_[0] === "--plan") {
    writeOutput(renderHostedCronBootstrapPlan());
    return 0;
  }
  try {
    const result =
      arguments_[0] === "provision"
        ? await provisionHostedCronSecret({ arguments_, ...dependencies })
        : await deliverHostedR3cNotification({ arguments_, ...dependencies });
    writeOutput(
      result.outcome === "provisioned"
        ? "Hosted Cron secret source provisioned; an exact-SHA API release is required.\n"
        : "Hosted R3-C notification delivered once and duplicate processing was idle.\n",
    );
    return 0;
  } catch (error) {
    const stage =
      error instanceof HostedCronBootstrapError && knownStages.has(error.stage)
        ? error.stage
        : "arguments";
    writeError(`Hosted Cron bootstrap failed at stage: ${stage}.\n`);
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedCronBootstrapCli();
}
