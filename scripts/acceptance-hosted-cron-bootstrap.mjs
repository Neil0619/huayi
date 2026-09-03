import { pathToFileURL } from "node:url";

import {
  readHostedCredential,
  rejectLegacyHostedCredentialEnvironment,
} from "./acceptance-hosted-credentials.mjs";
import { upsertHostedCronSecret } from "./acceptance-hosted-cron-bootstrap-vercel.mjs";
import {
  claimablePasswordRecovery,
  emptyR3c,
  pendingR3c,
  sentPasswordRecovery,
  sentR3c,
} from "./acceptance-hosted-cron-bootstrap-state.mjs";
import {
  databaseRequest,
  failHostedCronBootstrap as fail,
  HostedCronBootstrapError,
  parseCronSecret,
  readInfrastructure,
  readR3cSnapshot as readSnapshot,
  requestWorker,
  requireCronAbsent,
  requireRepositoryCandidate,
  validSecret,
} from "./acceptance-hosted-cron-bootstrap-support.mjs";
import {
  renderEnsureVaultSourceSql,
  renderReadVaultSourceSql,
} from "./acceptance-hosted-cron-bootstrap-sql.mjs";
import { readHostedCronStatus } from "./acceptance-hosted-cron.mjs";
import { createHostedCronBootstrapReleaseGate } from "./acceptance-hosted-cron-bootstrap-release.mjs";
import { verifyHostedCronRepositoryCandidate } from "./acceptance-hosted-cron-repository.mjs";
import { hostedAcceptanceProjectRef, runHostedPsql } from "./acceptance-hosted-foundation.mjs";
import { fetchHostedAcceptanceOfficialCaCertificate } from "./acceptance-hosted-official-ca.mjs";
import { runHostedRuntimeSnapshotQuery } from "./acceptance-hosted-runtime-gates.mjs";
import { runHostedPasswordRecoveryBootstrapSnapshotQuery } from "./acceptance-hosted-password-recovery-bootstrap-state.mjs";

export const hostedCronProvisionConfirmation = `--confirm-provision-hosted-cron-secret-for-bootstrap-${hostedAcceptanceProjectRef}`;
export const hostedCronPasswordRecoveryConfirmation = `--confirm-deliver-hosted-password-recovery-after-secret-release-${hostedAcceptanceProjectRef}`;
export const hostedCronDeliverConfirmation = `--confirm-deliver-hosted-r3c-after-secret-release-${hostedAcceptanceProjectRef}`;

const apiOrigin = "https://api.acceptance.seen-said.cn";
const passwordRecoveryUrl = `${apiOrigin}/internal/password-recovery/run`;
const notificationUrl = `${apiOrigin}/internal/security-notifications/run`;
const knownStages = new Set([
  "arguments",
  "credentials",
  "cron-absent",
  "delivery",
  "postflight",
  "password-recovery-delivery",
  "password-recovery-pending",
  "password-recovery-postflight",
  "r3c-pending",
  "repository-candidate",
  "release",
  "vault-read",
  "vault-write",
  "vercel",
]);

export function renderHostedCronBootstrapPlan() {
  return `Hosted Cron/R3-C bootstrap plan (zero filesystem / zero Git / zero network / zero write)
- Requires either one claimable password recovery before the first reset or one claimable R3-C notification, with no installed Cron surface.
- Fixed order: provision -> exact-SHA API release -> recovery -> user password reset -> deliver -> user inbox confirmation -> Cron apply.
- Provision creates or reuses one 64-character lowercase-hex Vault bearer, sends it only in memory to Vercel Sensitive Production configuration, and never prints it.
- Provision reserves an unused exact-SHA schema-v2 release state with a random attempt identity after the environment upsert.
- The release force-creates attempt-bound deployments; delivery freshly attests their IDs before reading Vault, and rejects legacy state.
- Recovery and deliver read the bearer into bounded process memory, run the normal product worker twice, and require sent then idle to prove idempotent handling.
`;
}

export async function provisionHostedCronSecret({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetch_ = globalThis.fetch,
  fetchCaCertificate = fetchHostedAcceptanceOfficialCaCertificate,
  readCredential = readHostedCredential,
  readCronStatus = readHostedCronStatus,
  releaseGate,
  repositoryRoot = process.cwd(),
  runPsql = runHostedPsql,
  runRecoverySnapshotQuery = runHostedPasswordRecoveryBootstrapSnapshotQuery,
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
  try {
    releaseGate ??= await createHostedCronBootstrapReleaseGate({ fetch_, repositoryRoot });
  } catch (error) {
    if (error instanceof HostedCronBootstrapError) throw error;
    fail("release");
  }
  try {
    return await releaseGate.provision(async () => {
      const secrets = await readInfrastructure({ environment, fetchCaCertificate, readCredential });
      const snapshot = await readSnapshot(secrets, runSnapshotQuery);
      if (!pendingR3c(snapshot)) {
        if (!emptyR3c(snapshot)) fail("r3c-pending");
        let recoverySnapshot;
        try {
          recoverySnapshot = await runRecoverySnapshotQuery(secrets, { runPsql });
        } catch {
          fail("password-recovery-pending");
        }
        if (!claimablePasswordRecovery(recoverySnapshot)) {
          fail("password-recovery-pending");
        }
      }
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
    });
  } catch (error) {
    if (error instanceof HostedCronBootstrapError) throw error;
    fail("release");
  }
}

export async function deliverHostedPasswordRecovery({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetch_ = globalThis.fetch,
  fetchCaCertificate = fetchHostedAcceptanceOfficialCaCertificate,
  readCredential = readHostedCredential,
  readCronStatus = readHostedCronStatus,
  releaseGate,
  repositoryRoot = process.cwd(),
  runPsql = runHostedPsql,
  runRecoverySnapshotQuery = runHostedPasswordRecoveryBootstrapSnapshotQuery,
  runSnapshotQuery = runHostedRuntimeSnapshotQuery,
  verifyRepositoryCandidate = verifyHostedCronRepositoryCandidate,
} = {}) {
  if (
    arguments_.length !== 2 ||
    arguments_[0] !== "recovery" ||
    arguments_[1] !== hostedCronPasswordRecoveryConfirmation
  ) {
    fail("arguments");
  }
  try {
    rejectLegacyHostedCredentialEnvironment(environment);
  } catch {
    fail("credentials");
  }
  await requireRepositoryCandidate(verifyRepositoryCandidate);
  try {
    releaseGate ??= await createHostedCronBootstrapReleaseGate({ fetch_, repositoryRoot });
    await releaseGate.attestCompleted();
  } catch {
    fail("release");
  }
  const secrets = await readInfrastructure({ environment, fetchCaCertificate, readCredential });
  if (!emptyR3c(await readSnapshot(secrets, runSnapshotQuery))) fail("r3c-pending");
  let before;
  try {
    before = await runRecoverySnapshotQuery(secrets, { runPsql });
  } catch {
    fail("password-recovery-pending");
  }
  const alreadySent = sentPasswordRecovery(before);
  if (!alreadySent && !claimablePasswordRecovery(before)) fail("password-recovery-pending");
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
  const first = await requestWorker({
    cronSecret,
    fetch_,
    stage: "password-recovery-delivery",
    url: passwordRecoveryUrl,
  });
  if (alreadySent ? first !== "idle" : first !== "sent") fail("password-recovery-delivery");
  if (
    !alreadySent &&
    (await requestWorker({
      cronSecret,
      fetch_,
      stage: "password-recovery-delivery",
      url: passwordRecoveryUrl,
    })) !== "idle"
  ) {
    fail("password-recovery-delivery");
  }
  let after;
  try {
    after = await runRecoverySnapshotQuery(secrets, { runPsql });
  } catch {
    fail("password-recovery-postflight");
  }
  if (!sentPasswordRecovery(after)) fail("password-recovery-postflight");
  return Object.freeze({ outcome: "recovery-delivered" });
}

export async function deliverHostedR3cNotification({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetch_ = globalThis.fetch,
  fetchCaCertificate = fetchHostedAcceptanceOfficialCaCertificate,
  readCredential = readHostedCredential,
  readCronStatus = readHostedCronStatus,
  releaseGate,
  repositoryRoot = process.cwd(),
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
  try {
    releaseGate ??= await createHostedCronBootstrapReleaseGate({ fetch_, repositoryRoot });
    await releaseGate.attestCompleted();
  } catch {
    fail("release");
  }
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
  const first = await requestWorker({
    cronSecret,
    fetch_,
    stage: "delivery",
    url: notificationUrl,
  });
  if (alreadySent ? first !== "idle" : first !== "sent") fail("delivery");
  if (
    !alreadySent &&
    (await requestWorker({
      cronSecret,
      fetch_,
      stage: "delivery",
      url: notificationUrl,
    })) !== "idle"
  ) {
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
        : arguments_[0] === "recovery"
          ? await deliverHostedPasswordRecovery({ arguments_, ...dependencies })
          : await deliverHostedR3cNotification({ arguments_, ...dependencies });
    writeOutput(
      result.outcome === "provisioned"
        ? "Hosted Cron secret source provisioned; an exact-SHA API release is required.\n"
        : result.outcome === "recovery-delivered"
          ? "Hosted password recovery delivered once and duplicate processing was idle.\n"
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
