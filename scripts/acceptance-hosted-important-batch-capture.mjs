import { open, rm } from "node:fs/promises";
import { join } from "node:path";

import { resolveLocalDockerInspectionTarget } from "./acceptance-local-docker-inspection.mjs";
import { persistHostedImportantBatchBackup } from "./acceptance-hosted-important-batch-artifacts.mjs";
import {
  assertHostedImportantBatchArtifactContract,
  hostedPhase81ArtifactContract,
} from "./acceptance-hosted-important-batch-contracts.mjs";
import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";
import {
  assertFixedLocalDockerTarget,
  fixedDockerRunArguments,
  hostedImportantBatchAdministratorUser,
  hostedImportantBatchDatabaseName,
  hostedImportantBatchPostgresRuntimeReference,
  hostedImportantBatchSessionPoolerHost,
  hostedImportantBatchSessionPoolerPort,
  inspectHostedImportantBatchContainer,
  isHostedImportantBatchContainerAbsent,
  runHostedImportantBatchProcess,
  settleHostedImportantBatchContainer,
} from "./acceptance-hosted-important-batch-execution-contract.mjs";

export const hostedImportantBatchCapturePreArgument = `--confirm-capture-pre-0014-important-batch-backup-${hostedAcceptanceProjectRef}`;
export const hostedImportantBatchCapturePostArgument = `--confirm-capture-post-0014-important-batch-backup-${hostedAcceptanceProjectRef}`;

const coveragePatterns = Object.freeze([
  /^\d+;\s+\d+\s+\d+\s+TABLE DATA auth users \S+$/u,
  /^\d+;\s+\d+\s+\d+\s+TABLE DATA storage objects \S+$/u,
  /^\d+;\s+\d+\s+\d+\s+TABLE DATA public user_profiles \S+$/u,
  /^\d+;\s+\d+\s+\d+\s+TABLE DATA supabase_migrations schema_migrations \S+$/u,
]);

const preCaptureContractSql = `/* hosted_important_batch_capture_contract */
SELECT 'migration_head|' || COALESCE(max(version), '')
FROM supabase_migrations.schema_migrations;
SELECT 'storage_objects_zero|' || CASE WHEN count(*) = 0 THEN 't' ELSE 'f' END
FROM storage.objects;
`;

function assertSecretMaterial(administratorPassword, caCertificate) {
  if (
    typeof administratorPassword !== "string" ||
    administratorPassword.length < 12 ||
    administratorPassword.length > 512 ||
    /[\0\r\n]/u.test(administratorPassword)
  ) {
    throw new Error("Hosted important-batch administrator password is invalid.");
  }
  if (
    typeof caCertificate !== "string" ||
    Buffer.byteLength(caCertificate) > 65_536 ||
    !/^-----BEGIN CERTIFICATE-----\n[\s\S]+\n-----END CERTIFICATE-----\n$/u.test(caCertificate)
  ) {
    throw new Error("Hosted important-batch CA certificate is invalid.");
  }
}

function pgpassSource(password) {
  const escaped = password.replaceAll("\\", "\\\\").replaceAll(":", "\\:");
  return (
    [
      hostedImportantBatchSessionPoolerHost,
      hostedImportantBatchSessionPoolerPort,
      hostedImportantBatchDatabaseName,
      hostedImportantBatchAdministratorUser,
      escaped,
    ].join(":") + "\n"
  );
}

async function writePrivateFile(path, value) {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.chmod(0o600);
    await handle.writeFile(value, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function credentialMountArguments(pgpassPath, caPath) {
  return [
    "--mount",
    `type=bind,src=${pgpassPath},dst=/run/huayi/pgpass,readonly`,
    "--mount",
    `type=bind,src=${caPath},dst=/run/huayi/database-ca.crt,readonly`,
    "--env",
    "PGPASSFILE=/run/huayi/pgpass",
    "--env",
    "PGSSLROOTCERT=/run/huayi/database-ca.crt",
    "--env",
    "PGSSLMODE=verify-full",
  ];
}

function databaseArguments() {
  return [
    "--host",
    hostedImportantBatchSessionPoolerHost,
    "--port",
    hostedImportantBatchSessionPoolerPort,
    "--username",
    hostedImportantBatchAdministratorUser,
    "--dbname",
    hostedImportantBatchDatabaseName,
  ];
}

function captureContainerIdentity(artifactContract, phase, step) {
  const label = `${artifactContract.captureIdentityPrefix}-capture-${phase}-${step}`;
  return { label, name: `huayi-${label}` };
}

function captureRuntimeIsExact(source, label) {
  try {
    const inspected = JSON.parse(source);
    return (
      inspected?.Config?.Image === hostedImportantBatchPostgresRuntimeReference &&
      inspected?.Config?.Labels?.["com.seen-said.acceptance"] === label
    );
  } catch {
    return false;
  }
}

async function runCaptureContainer({
  artifactContract,
  dockerTarget,
  extraArguments,
  options,
  phase,
  runProcess,
  step,
  tailArguments,
  wait,
}) {
  const identity = captureContainerIdentity(artifactContract, phase, step);
  const existing = await inspectHostedImportantBatchContainer(
    dockerTarget,
    identity.name,
    runProcess,
  );
  if (!isHostedImportantBatchContainerAbsent(existing)) {
    throw new Error("Hosted important-batch capture identity is occupied.");
  }
  let result;
  let operationError;
  try {
    result = await runProcess(
      dockerTarget.command,
      [
        ...fixedDockerRunArguments(dockerTarget, [
          "--name",
          identity.name,
          "--label",
          `com.seen-said.acceptance=${identity.label}`,
          ...extraArguments,
        ]),
        ...tailArguments,
      ],
      options,
    );
  } catch (error) {
    operationError = error;
  }
  const cleaned = await settleHostedImportantBatchContainer({
    dockerTarget,
    name: identity.name,
    runProcess,
    runtimeIsExact: (source) => captureRuntimeIsExact(source, identity.label),
    wait,
    waitForLateAppearance: operationError !== undefined || result?.code === null,
  });
  if (!cleaned) throw new Error("Hosted important-batch capture cleanup failed.");
  if (operationError !== undefined) throw operationError;
  return result;
}

async function runDatabaseContract({
  artifactContract,
  caPath,
  dockerTarget,
  pgpassPath,
  phase,
  runProcess,
  wait,
}) {
  const result = await runCaptureContainer({
    artifactContract,
    dockerTarget,
    extraArguments: [
      "--network",
      "bridge",
      "--read-only",
      "--security-opt",
      "no-new-privileges",
      "--cap-drop",
      "ALL",
      ...credentialMountArguments(pgpassPath, caPath),
      "--entrypoint",
      "psql",
    ],
    options: { maxOutputBytes: 512 },
    phase,
    runProcess,
    step: "contract",
    tailArguments: [
      ...databaseArguments(),
      "--no-psqlrc",
      "--tuples-only",
      "--no-align",
      "--quiet",
      "--set",
      "ON_ERROR_STOP=1",
      "--command",
      preCaptureContractSql,
    ],
    wait,
  });
  const migrationHead =
    phase === "pre" ? artifactContract.preMigrationHead : artifactContract.postMigrationHead;
  const expected = `migration_head|${migrationHead}\n` + "storage_objects_zero|t\n";
  if (result.code !== 0 || result.stdout !== expected) {
    throw new Error("Hosted important-batch capture contract failed.");
  }
}

async function runCustomDump({
  artifactContract,
  archivePartialPath,
  caPath,
  dockerTarget,
  pgpassPath,
  phase,
  runProcess,
  wait,
}) {
  const result = await runCaptureContainer({
    artifactContract,
    dockerTarget,
    extraArguments: [
      "--network",
      "bridge",
      "--read-only",
      "--security-opt",
      "no-new-privileges",
      "--cap-drop",
      "ALL",
      ...credentialMountArguments(pgpassPath, caPath),
      "--mount",
      `type=bind,src=${archivePartialPath},dst=/evidence/database.dump`,
      "--entrypoint",
      "pg_dump",
    ],
    options: { maxOutputBytes: 1 },
    phase,
    runProcess,
    step: "pg-dump",
    tailArguments: [
      ...databaseArguments(),
      "--format",
      "custom",
      "--file",
      "/evidence/database.dump",
      "--no-owner",
    ],
    wait,
  });
  if (result.code !== 0 || result.stdout !== "") {
    throw new Error("Hosted important-batch custom archive failed.");
  }
}

async function verifyCustomDump({
  archivePartialPath,
  artifactContract,
  dockerTarget,
  phase,
  runProcess,
  wait,
}) {
  const result = await runCaptureContainer({
    artifactContract,
    dockerTarget,
    extraArguments: [
      "--network",
      "none",
      "--read-only",
      "--security-opt",
      "no-new-privileges",
      "--cap-drop",
      "ALL",
      "--mount",
      `type=bind,src=${archivePartialPath},dst=/evidence/database.dump,readonly`,
      "--entrypoint",
      "pg_restore",
    ],
    options: { maxOutputBytes: 1_048_576 },
    phase,
    runProcess,
    step: "pg-restore",
    tailArguments: ["--list", "/evidence/database.dump"],
    wait,
  });
  if (
    result.code !== 0 ||
    coveragePatterns.some(
      (pattern) => !result.stdout.split(/\r?\n/u).some((line) => pattern.test(line)),
    )
  ) {
    throw new Error("Hosted important-batch archive coverage is invalid.");
  }
}

export async function captureHostedImportantBatchBackup({
  administratorPassword,
  artifactContract = hostedPhase81ArtifactContract,
  caCertificate,
  candidateCommit,
  directorySync,
  phase,
  persistBackup = persistHostedImportantBatchBackup,
  privateModeMatches,
  repositoryRoot,
  resolveDockerTarget = resolveLocalDockerInspectionTarget,
  runProcess = runHostedImportantBatchProcess,
  wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds)),
}) {
  assertHostedImportantBatchArtifactContract(artifactContract);
  assertSecretMaterial(administratorPassword, caCertificate);
  if (!new Set(["post", "pre"]).has(phase)) {
    throw new Error("Hosted important-batch capture phase is invalid.");
  }
  const dockerTarget = await resolveDockerTarget();
  assertFixedLocalDockerTarget(dockerTarget);
  await persistBackup({
    artifactContract,
    candidateCommit,
    directorySync,
    phase,
    privateModeMatches,
    produceArchive: async ({ archivePartialPath, phaseRoot }) => {
      const pgpassPath = join(phaseRoot, ".capture.pgpass");
      const caPath = join(phaseRoot, ".capture-ca.crt");
      try {
        await writePrivateFile(pgpassPath, pgpassSource(administratorPassword));
        await writePrivateFile(caPath, caCertificate);
        await runDatabaseContract({
          artifactContract,
          caPath,
          dockerTarget,
          pgpassPath,
          phase,
          runProcess,
          wait,
        });
        await runCustomDump({
          archivePartialPath,
          artifactContract,
          caPath,
          dockerTarget,
          pgpassPath,
          phase,
          runProcess,
          wait,
        });
      } finally {
        await Promise.all([rm(pgpassPath, { force: true }), rm(caPath, { force: true })]);
      }
    },
    repositoryRoot,
    verifyArchive: ({ archivePartialPath }) =>
      verifyCustomDump({
        archivePartialPath,
        artifactContract,
        dockerTarget,
        phase,
        runProcess,
        wait,
      }),
  });
}
