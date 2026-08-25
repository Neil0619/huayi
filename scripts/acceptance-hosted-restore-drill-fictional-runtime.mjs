import { createHmac, randomBytes } from "node:crypto";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { resolveLocalDockerInspectionTarget } from "./acceptance-local-docker-inspection.mjs";
import {
  assertFixedLocalDockerTarget,
  runHostedImportantBatchProcess,
} from "./acceptance-hosted-important-batch-execution-contract.mjs";
import {
  assertFictionalIdentityAvailable,
  copyFictionalArchiveToHost,
  createFictionalArchive,
  destroyFictionalContainer,
  fictionalDockerArguments,
  fictionalPsqlArguments,
  fictionalRuntimeIsExact,
  hostedRestoreFictionalSourceContainer,
  hostedRestoreFictionalTargetContainer,
  inspectFictionalContainer,
  restoreFictionalArchive,
  runFictionalSql,
  startFictionalContainer,
  waitForFictionalContainer,
} from "./acceptance-hosted-restore-drill-fictional-docker.mjs";
import {
  hostedRestoreFictionalCountOutput,
  hostedRestoreFictionalCountSql,
  hostedRestoreFictionalFixtureSql,
  hostedRestoreFictionalTargetAclSql,
  hostedRestoreFictionalTargetBootstrapSql,
  hostedRestoreFictionalVerificationOutput,
  hostedRestoreFictionalVerificationSql,
} from "./acceptance-hosted-restore-drill-fictional-fixture.mjs";
import { assertHostedRestoreDrillSecretEnvironment } from "./acceptance-hosted-restore-drill-process.mjs";

export { hostedRestoreFictionalSourceContainer, hostedRestoreFictionalTargetContainer };

function fail() {
  throw new Error("Hosted restore-drill fictional archive failed.");
}

async function startVerifiedContainer(dockerTarget, name, runProcess, wait, now, recordLate) {
  let started;
  try {
    started = await startFictionalContainer(dockerTarget, name, runProcess);
  } catch (error) {
    recordLate(true);
    throw error;
  }
  recordLate(started.code === null);
  if (started.code !== 0) fail();
  const inspected = await inspectFictionalContainer(dockerTarget, name, runProcess);
  if (inspected.code !== 0 || !fictionalRuntimeIsExact(inspected.stdout, name)) fail();
  await waitForFictionalContainer(dockerTarget, name, runProcess, wait, now);
  return started.code === null;
}

function countDigest(value, key) {
  return createHmac("sha256", key).update(value).digest("hex");
}

async function readCountDigest(dockerTarget, name, runProcess, key) {
  const result = await runProcess(
    dockerTarget.command,
    fictionalDockerArguments(dockerTarget, fictionalPsqlArguments(name)),
    { input: hostedRestoreFictionalCountSql, maxOutputBytes: 256 },
  );
  if (result.code !== 0 || result.stdout !== hostedRestoreFictionalCountOutput) fail();
  return countDigest(result.stdout, key);
}

async function attemptDestroy(dockerTarget, name, runProcess, wait, late) {
  try {
    return await destroyFictionalContainer(dockerTarget, name, runProcess, wait, late);
  } catch {
    return false;
  }
}

export async function runHostedRestoreFictionalArchive({
  environment = process.env,
  now = () => performance.now(),
  onStage = () => undefined,
  privateModeMatches,
  resolveDockerTarget = resolveLocalDockerInspectionTarget,
  runProcess = runHostedImportantBatchProcess,
  wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds)),
} = {}) {
  let dockerTarget;
  let sourceCleanup = false;
  let sourceLate = false;
  let targetCleanup = false;
  let targetLate = false;
  let operationPassed = false;
  let sourceDestroyed = false;
  let targetDestroyed = false;
  let directory;
  const hmacKey = randomBytes(32);
  const markStage = (stage) => {
    if (typeof onStage !== "function") fail();
    onStage(stage);
  };
  try {
    markStage("environment");
    assertHostedRestoreDrillSecretEnvironment(environment);
    markStage("docker-target");
    dockerTarget = await resolveDockerTarget();
    assertFixedLocalDockerTarget(dockerTarget);
    markStage("identity");
    await assertFictionalIdentityAvailable(
      dockerTarget,
      hostedRestoreFictionalSourceContainer,
      runProcess,
    );
    await assertFictionalIdentityAvailable(
      dockerTarget,
      hostedRestoreFictionalTargetContainer,
      runProcess,
    );
    directory = await mkdtemp(join(tmpdir(), "huayi-hosted-fictional-restore-"));
    await chmod(directory, 0o700);
    const archivePath = join(directory, "fictional.dump");
    sourceCleanup = true;
    markStage("source-start");
    sourceLate = await startVerifiedContainer(
      dockerTarget,
      hostedRestoreFictionalSourceContainer,
      runProcess,
      wait,
      now,
      (late) => {
        sourceLate = late;
      },
    );
    markStage("source-fixture");
    await runFictionalSql(
      dockerTarget,
      hostedRestoreFictionalSourceContainer,
      runProcess,
      hostedRestoreFictionalFixtureSql,
    );
    markStage("archive-create");
    await createFictionalArchive(dockerTarget, runProcess);
    markStage("archive-copy");
    await copyFictionalArchiveToHost(dockerTarget, runProcess, archivePath, privateModeMatches);
    targetCleanup = true;
    markStage("target-start");
    targetLate = await startVerifiedContainer(
      dockerTarget,
      hostedRestoreFictionalTargetContainer,
      runProcess,
      wait,
      now,
      (late) => {
        targetLate = late;
      },
    );
    markStage("target-bootstrap");
    await runFictionalSql(
      dockerTarget,
      hostedRestoreFictionalTargetContainer,
      runProcess,
      hostedRestoreFictionalTargetBootstrapSql,
    );
    markStage("archive-restore");
    await restoreFictionalArchive(dockerTarget, runProcess, archivePath);
    markStage("target-acl");
    await runFictionalSql(
      dockerTarget,
      hostedRestoreFictionalTargetContainer,
      runProcess,
      hostedRestoreFictionalTargetAclSql,
    );
    markStage("count-digest");
    const sourceDigest = await readCountDigest(
      dockerTarget,
      hostedRestoreFictionalSourceContainer,
      runProcess,
      hmacKey,
    );
    const targetDigest = await readCountDigest(
      dockerTarget,
      hostedRestoreFictionalTargetContainer,
      runProcess,
      hmacKey,
    );
    if (sourceDigest !== targetDigest) fail();
    markStage("verification");
    await runFictionalSql(
      dockerTarget,
      hostedRestoreFictionalTargetContainer,
      runProcess,
      hostedRestoreFictionalVerificationSql,
      hostedRestoreFictionalVerificationOutput,
    );
    operationPassed = true;
  } catch {
    operationPassed = false;
  } finally {
    try {
      onStage("cleanup");
    } catch {
      operationPassed = false;
    }
    hmacKey.fill(0);
    if (dockerTarget !== undefined && targetCleanup) {
      targetDestroyed = await attemptDestroy(
        dockerTarget,
        hostedRestoreFictionalTargetContainer,
        runProcess,
        wait,
        targetLate,
      );
    }
    if (dockerTarget !== undefined && sourceCleanup) {
      sourceDestroyed = await attemptDestroy(
        dockerTarget,
        hostedRestoreFictionalSourceContainer,
        runProcess,
        wait,
        sourceLate,
      );
    }
    if (directory !== undefined) await rm(directory, { force: true, recursive: true });
  }
  if (!operationPassed || !sourceDestroyed || !targetDestroyed) fail();
  return {
    archiveFormatExact: true,
    countDigestEqual: true,
    sourceDestroyed: true,
    targetDestroyed: true,
    tocExact: true,
    verificationExact: true,
  };
}
