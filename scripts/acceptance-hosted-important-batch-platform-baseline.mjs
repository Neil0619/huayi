import {
  assertFixedLocalDockerTarget,
  hostedImportantBatchScratchContainer,
  inspectHostedImportantBatchContainer,
  isHostedImportantBatchContainerAbsent,
  runHostedImportantBatchProcess,
  settleHostedImportantBatchContainer,
} from "./acceptance-hosted-important-batch-execution-contract.mjs";

const authDigest = "sha256:362659ca70eaa75ba05bbaf963caa84c1c5afe5e8fbf0777e17b830dd5f0f60a";
const storageDigest = "sha256:97ed68d33417d253a45fe0a70f84324d92250a3e239bf18aa6cf87269dbf6727";
const fictionalJwtSecret = "local-only-fictional-jwt-secret-32-chars";

export const hostedImportantBatchAuthRuntimeReference = `docker.io/supabase/gotrue@${authDigest}`;
export const hostedImportantBatchStorageRuntimeReference = `docker.io/supabase/storage-api@${storageDigest}`;
export const hostedImportantBatchAuthBaselineContainer = "huayi-phase-81-0014-auth-baseline";
export const hostedImportantBatchStorageBaselineContainer = "huayi-phase-81-0014-storage-baseline";

const runnerSpecs = Object.freeze([
  {
    command: ["auth", "migrate"],
    environment: [
      "GOTRUE_DB_DRIVER=postgres",
      "GOTRUE_DB_DATABASE_URL=postgresql://supabase_auth_admin@127.0.0.1:5432/postgres?sslmode=disable",
      "API_EXTERNAL_URL=http://127.0.0.1/auth/v1",
      "GOTRUE_SITE_URL=http://127.0.0.1",
      `GOTRUE_JWT_SECRET=${fictionalJwtSecret}`,
      "GOTRUE_JWT_EXP=3600",
    ],
    image: hostedImportantBatchAuthRuntimeReference,
    label: "phase-81-0014-auth-baseline",
    name: hostedImportantBatchAuthBaselineContainer,
    stage: "auth-baseline",
  },
  {
    command: ["/app/dist/scripts/migrate-call.js"],
    entrypoint: "node",
    environment: [
      "DATABASE_URL=postgresql://supabase_storage_admin@127.0.0.1:5432/postgres?sslmode=disable",
      `PGRST_JWT_SECRET=${fictionalJwtSecret}`,
    ],
    image: hostedImportantBatchStorageRuntimeReference,
    label: "phase-81-0014-storage-baseline",
    name: hostedImportantBatchStorageBaselineContainer,
    stage: "storage-baseline",
  },
]);

function runnerRuntimeIsExact(source, spec) {
  try {
    const inspected = JSON.parse(source);
    const expectedEntrypoint = spec.entrypoint === undefined ? null : [spec.entrypoint];
    const runtimeEnvironment = inspected?.Config?.Env;
    const environmentIsExact =
      Array.isArray(runtimeEnvironment) &&
      spec.environment.every((expected) => runtimeEnvironment.includes(expected)) &&
      spec.environment.every((expected) => {
        const separator = expected.indexOf("=");
        const prefix = expected.slice(0, separator + 1);
        return runtimeEnvironment.filter((value) => value.startsWith(prefix)).length === 1;
      });
    return (
      inspected?.Config?.Image === spec.image &&
      JSON.stringify(inspected?.Config?.Cmd) === JSON.stringify(spec.command) &&
      JSON.stringify(inspected?.Config?.Entrypoint) === JSON.stringify(expectedEntrypoint) &&
      environmentIsExact &&
      inspected?.Config?.Labels?.["com.seen-said.acceptance"] === spec.label &&
      inspected?.HostConfig?.NetworkMode === `container:${hostedImportantBatchScratchContainer}` &&
      (inspected?.HostConfig?.Binds === null || inspected?.HostConfig?.Binds?.length === 0) &&
      Array.isArray(inspected?.Mounts) &&
      inspected.Mounts.length === 0
    );
  } catch {
    return false;
  }
}

function runnerArguments(dockerTarget, spec) {
  const arguments_ = [
    "--host",
    dockerTarget.host,
    "run",
    "--rm",
    "--pull",
    "never",
    "--name",
    spec.name,
    "--label",
    `com.seen-said.acceptance=${spec.label}`,
    "--network",
    `container:${hostedImportantBatchScratchContainer}`,
  ];
  for (const value of spec.environment) arguments_.push("--env", value);
  if (spec.entrypoint !== undefined) arguments_.push("--entrypoint", spec.entrypoint);
  return [...arguments_, spec.image, ...spec.command];
}

async function runBaselineRunner({ dockerTarget, runProcess, spec, wait }) {
  const existing = await inspectHostedImportantBatchContainer(dockerTarget, spec.name, runProcess);
  if (!isHostedImportantBatchContainerAbsent(existing)) {
    throw new Error("Hosted important-batch platform baseline identity is occupied.");
  }
  let result;
  try {
    result = await runProcess(dockerTarget.command, runnerArguments(dockerTarget, spec), {
      maxOutputBytes: 256,
      timeoutMilliseconds: 300_000,
    });
  } catch {
    result = { code: null, stdout: "" };
  }
  const cleaned = await settleHostedImportantBatchContainer({
    dockerTarget,
    name: spec.name,
    runProcess,
    runtimeIsExact: (source) => runnerRuntimeIsExact(source, spec),
    wait,
    waitForLateAppearance: result.code === null,
  });
  if (result.code !== 0 || result.stdout !== "" || !cleaned) {
    throw new Error("Hosted important-batch platform baseline migration failed.");
  }
}

export async function migrateHostedImportantBatchPlatformBaseline({
  dockerTarget,
  onStage = () => undefined,
  runProcess = runHostedImportantBatchProcess,
  wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds)),
}) {
  assertFixedLocalDockerTarget(dockerTarget);
  for (const spec of runnerSpecs) {
    onStage(spec.stage);
    await runBaselineRunner({ dockerTarget, runProcess, spec, wait });
  }
}
