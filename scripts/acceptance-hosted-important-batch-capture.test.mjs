import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  captureHostedImportantBatchBackup,
  hostedImportantBatchCapturePostArgument,
  hostedImportantBatchCapturePreArgument,
} from "./acceptance-hosted-important-batch-capture.mjs";
import { hostedImportantBatchId } from "./acceptance-hosted-important-batch-backup.mjs";
import { hostedImportantBatchPostgresRuntimeReference } from "./acceptance-hosted-important-batch-execution-contract.mjs";

const candidateCommit = "0123456789abcdef0123456789abcdef01234567";
const dockerTarget = {
  command: "/Applications/OrbStack.app/Contents/MacOS/xbin/docker",
  host: "unix:///Users/fixed/.orbstack/run/docker.sock",
};
const caCertificate = "-----BEGIN CERTIFICATE-----\nfictional-ca\n-----END CERTIFICATE-----\n";
const password = String.raw`fictional-password-with\:escapes-123456789`;
const temporaryRoots = [];

test.afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function temporaryRepository() {
  const root = await mkdtemp(join(tmpdir(), "huayi-hosted-backup-capture-"));
  temporaryRoots.push(root);
  return root;
}

function sourceFromMount(arguments_, destination) {
  const mount = arguments_.find(
    (value) =>
      value.startsWith("type=bind,") &&
      (value.includes(`dst=${destination},`) || value.endsWith(`dst=${destination}`)),
  );
  assert.ok(mount);
  return /(?:^|,)src=([^,]+)(?:,|$)/u.exec(mount)?.[1];
}

async function persistPortableBackup({ phase, produceArchive, repositoryRoot, verifyArchive }) {
  const phaseRoot = join(
    repositoryRoot,
    "artifacts",
    "hosted-important-batch-backups",
    hostedImportantBatchId,
    phase,
  );
  const archivePartialPath = join(phaseRoot, "database.dump.partial");
  const archivePath = join(phaseRoot, "database.dump");
  const manifestPath = join(phaseRoot, "backup-manifest.json");
  await mkdir(phaseRoot, { recursive: true });
  try {
    await writeFile(archivePartialPath, "");
    await produceArchive({ archivePartialPath, phaseRoot });
    await verifyArchive({ archivePartialPath });
    await rename(archivePartialPath, archivePath);
    await writeFile(manifestPath, "{}\n");
  } catch (error) {
    await Promise.all([
      rm(archivePartialPath, { force: true }),
      rm(archivePath, { force: true }),
      rm(manifestPath, { force: true }),
    ]);
    throw error;
  }
}

test("capture exposes only fixed pre and post operations", () => {
  assert.equal(typeof captureHostedImportantBatchBackup, "function");
  assert.match(hostedImportantBatchCapturePreArgument, /^--confirm-capture-pre-0014-/u);
  assert.match(hostedImportantBatchCapturePostArgument, /^--confirm-capture-post-0014-/u);
});

test("capture accepts Supabase administrator passwords from 12 through 31 characters", async () => {
  for (const administratorPassword of ["a".repeat(12), "b".repeat(31)]) {
    let resolverCalls = 0;
    await assert.rejects(
      captureHostedImportantBatchBackup({
        administratorPassword,
        caCertificate,
        candidateCommit,
        phase: "pre",
        repositoryRoot: await temporaryRepository(),
        resolveDockerTarget: async () => {
          resolverCalls += 1;
          throw new Error("fictional post-secret-gate stop");
        },
      }),
      /fictional post-secret-gate stop/u,
    );
    assert.equal(resolverCalls, 1);
  }
});

test("capture uses only the fixed local Docker target, digest runtime, and private mounted files", async () => {
  const root = await temporaryRepository();
  const calls = [];
  const runProcess = async (command, arguments_) => {
    assert.equal(command, dockerTarget.command);
    if (arguments_[2] === "container" && arguments_[3] === "inspect") {
      return { code: 1, stdout: "\n" };
    }
    calls.push({ arguments: [...arguments_], command });
    assert.deepEqual(arguments_.slice(0, 6), [
      "--host",
      dockerTarget.host,
      "run",
      "--rm",
      "--pull",
      "never",
    ]);
    assert.ok(arguments_.includes(hostedImportantBatchPostgresRuntimeReference));
    assert.equal(
      arguments_[arguments_.indexOf("--entrypoint") + 2],
      hostedImportantBatchPostgresRuntimeReference,
    );
    assert.equal(
      arguments_.some((value) => /supabase\/postgres:/u.test(value)),
      false,
    );
    assert.equal(
      arguments_.some((value) => value.includes(password)),
      false,
    );
    assert.equal(
      arguments_.some((value) => value.includes(caCertificate)),
      false,
    );
    const entrypoint = arguments_[arguments_.indexOf("--entrypoint") + 1];
    if (entrypoint === "psql") {
      const pgpassPath = sourceFromMount(arguments_, "/run/huayi/pgpass");
      const caPath = sourceFromMount(arguments_, "/run/huayi/database-ca.crt");
      if (process.platform !== "win32") {
        assert.equal((await stat(pgpassPath)).mode & 0o777, 0o600);
        assert.equal((await stat(caPath)).mode & 0o777, 0o600);
      }
      assert.equal(await readFile(caPath, "utf8"), caCertificate);
      assert.ok(
        (await readFile(pgpassPath, "utf8")).includes(
          String.raw`fictional-password-with\\\:escapes`,
        ),
      );
      return {
        code: 0,
        stdout: "migration_head|20260823010000\nstorage_objects_zero|t\n",
      };
    }
    if (entrypoint === "pg_dump") {
      assert.ok(sourceFromMount(arguments_, "/run/huayi/pgpass"));
      assert.ok(sourceFromMount(arguments_, "/run/huayi/database-ca.crt"));
      await writeFile(sourceFromMount(arguments_, "/evidence/database.dump"), "custom-archive");
      return { code: 0, stdout: "" };
    }
    if (entrypoint === "pg_restore") {
      return {
        code: 0,
        stdout: [
          "4100; 0 100 TABLE DATA auth users supabase_auth_admin",
          "4101; 0 101 TABLE DATA storage objects supabase_storage_admin",
          "4102; 0 102 TABLE DATA public user_profiles postgres",
          "4103; 0 103 TABLE DATA supabase_migrations schema_migrations postgres",
          "",
        ].join("\n"),
      };
    }
    return { code: 1, stdout: "" };
  };

  await captureHostedImportantBatchBackup({
    administratorPassword: password,
    caCertificate,
    candidateCommit,
    phase: "pre",
    persistBackup: persistPortableBackup,
    repositoryRoot: root,
    resolveDockerTarget: async () => dockerTarget,
    runProcess,
  });

  assert.equal(calls.length, 3);
  const phaseRoot = join(
    root,
    "artifacts",
    "hosted-important-batch-backups",
    hostedImportantBatchId,
    "pre",
  );
  assert.deepEqual((await readdir(phaseRoot)).sort(), ["backup-manifest.json", "database.dump"]);
});

test("capture validates the bounded precheck and archive coverage then cleans every local file on failure", async () => {
  for (const stdout of [
    "migration_head|20260823010000\nstorage_objects_zero|f\n",
    "migration_head|20260824010000\nstorage_objects_zero|t\n",
    "private-user@example.test\n",
  ]) {
    const root = await temporaryRepository();
    await assert.rejects(
      captureHostedImportantBatchBackup({
        administratorPassword: password,
        caCertificate,
        candidateCommit,
        phase: "pre",
        persistBackup: persistPortableBackup,
        repositoryRoot: root,
        resolveDockerTarget: async () => dockerTarget,
        runProcess: async (_command, arguments_) =>
          arguments_[2] === "container" && arguments_[3] === "inspect"
            ? { code: 1, stdout: "" }
            : { code: 0, stdout },
      }),
    );
    const phaseRoot = join(
      root,
      "artifacts",
      "hosted-important-batch-backups",
      hostedImportantBatchId,
      "pre",
    );
    assert.deepEqual(await readdir(phaseRoot), []);
  }
});

test("capture force-removes its exact labelled container after a timed-out pg_dump client", async () => {
  const root = await temporaryRepository();
  let activeContainer;
  let observedInitialLateAbsence = false;
  let removedContainer;
  await assert.rejects(
    captureHostedImportantBatchBackup({
      administratorPassword: password,
      caCertificate,
      candidateCommit,
      phase: "pre",
      persistBackup: persistPortableBackup,
      repositoryRoot: root,
      resolveDockerTarget: async () => dockerTarget,
      runProcess: async (_command, arguments_) => {
        if (arguments_[2] === "container" && arguments_[3] === "inspect") {
          if (arguments_.at(-1) !== activeContainer) return { code: 1, stdout: "" };
          if (!observedInitialLateAbsence) {
            observedInitialLateAbsence = true;
            return { code: 1, stdout: "" };
          }
          return {
            code: 0,
            stdout: JSON.stringify({
              Config: {
                Image: hostedImportantBatchPostgresRuntimeReference,
                Labels: {
                  "com.seen-said.acceptance": "phase-81-0014-capture-pre-pg-dump",
                },
              },
            }),
          };
        }
        if (arguments_[2] === "rm") {
          removedContainer = arguments_.at(-1);
          activeContainer = undefined;
          return { code: 0, stdout: `${removedContainer}\n` };
        }
        const entrypoint = arguments_[arguments_.indexOf("--entrypoint") + 1];
        activeContainer = arguments_[arguments_.indexOf("--name") + 1];
        if (entrypoint === "psql") {
          activeContainer = undefined;
          return {
            code: 0,
            stdout: "migration_head|20260823010000\nstorage_objects_zero|t\n",
          };
        }
        if (entrypoint === "pg_dump") return { code: null, stdout: "" };
        return { code: 1, stdout: "" };
      },
      wait: async () => undefined,
    }),
    /custom archive failed/u,
  );

  assert.equal(removedContainer, "huayi-phase-81-0014-capture-pre-pg-dump");
  assert.equal(observedInitialLateAbsence, true);
  assert.equal(activeContainer, undefined);
});

test("capture never removes an occupied or mismatched container identity", async () => {
  for (const scenario of ["occupied", "mismatched-after-timeout"]) {
    const root = await temporaryRepository();
    let runStarted = false;
    let removals = 0;
    await assert.rejects(
      captureHostedImportantBatchBackup({
        administratorPassword: password,
        caCertificate,
        candidateCommit,
        phase: "pre",
        persistBackup: persistPortableBackup,
        repositoryRoot: root,
        resolveDockerTarget: async () => dockerTarget,
        runProcess: async (_command, arguments_) => {
          if (arguments_[2] === "rm") {
            removals += 1;
            return { code: 0, stdout: `${arguments_.at(-1)}\n` };
          }
          if (arguments_[2] === "container" && arguments_[3] === "inspect") {
            if (scenario === "occupied" || runStarted) {
              return {
                code: 0,
                stdout: JSON.stringify({
                  Config: {
                    Image: "docker.io/untrusted/postgres@sha256:fictional",
                    Labels: { "com.seen-said.acceptance": "untrusted" },
                  },
                }),
              };
            }
            return { code: 1, stdout: "" };
          }
          runStarted = true;
          return { code: null, stdout: "" };
        },
      }),
      scenario === "occupied" ? /identity is occupied/u : /capture cleanup failed/u,
    );
    assert.equal(removals, 0);
  }
});

test("capture rejects prefixed text that only contains the required TOC fragments", async () => {
  const root = await temporaryRepository();
  const entrypoints = [];
  await assert.rejects(
    captureHostedImportantBatchBackup({
      administratorPassword: password,
      caCertificate,
      candidateCommit,
      phase: "pre",
      persistBackup: persistPortableBackup,
      repositoryRoot: root,
      resolveDockerTarget: async () => dockerTarget,
      runProcess: async (_command, arguments_) => {
        if (arguments_[2] === "container" && arguments_[3] === "inspect") {
          return { code: 1, stdout: "" };
        }
        const entrypoint = arguments_[arguments_.indexOf("--entrypoint") + 1];
        entrypoints.push(entrypoint);
        if (entrypoint === "psql") {
          return {
            code: 0,
            stdout: "migration_head|20260823010000\nstorage_objects_zero|t\n",
          };
        }
        if (entrypoint === "pg_dump") {
          await writeFile(sourceFromMount(arguments_, "/evidence/database.dump"), "custom-archive");
          return { code: 0, stdout: "" };
        }
        if (entrypoint === "pg_restore") {
          return {
            code: 0,
            stdout: [
              "NOT TABLE DATA auth users",
              "NOT TABLE DATA storage objects",
              "NOT TABLE DATA public user_profiles",
              "NOT TABLE DATA supabase_migrations schema_migrations",
              "",
            ].join("\n"),
          };
        }
        return { code: 1, stdout: "" };
      },
    }),
    /archive coverage is invalid/u,
  );
  assert.deepEqual(entrypoints, ["psql", "pg_dump", "pg_restore"]);
  assert.deepEqual(
    await readdir(
      join(root, "artifacts", "hosted-important-batch-backups", hostedImportantBatchId, "pre"),
    ),
    [],
  );
});

test("capture rejects untrusted Docker targets or malformed secret material before spawning", async () => {
  for (const overrides of [
    { administratorPassword: "a".repeat(11) },
    { administratorPassword: "a".repeat(513) },
    { administratorPassword: "valid-length\0password" },
    { administratorPassword: "valid-length\rpassword" },
    { administratorPassword: "valid-length\npassword" },
    { caCertificate: "not-a-certificate" },
    {
      resolveDockerTarget: async () => ({
        command: "docker",
        host: "tcp://private.example.test:2376",
      }),
    },
  ]) {
    let calls = 0;
    await assert.rejects(
      captureHostedImportantBatchBackup({
        administratorPassword: password,
        caCertificate,
        candidateCommit,
        phase: "pre",
        repositoryRoot: await temporaryRepository(),
        resolveDockerTarget: async () => dockerTarget,
        runProcess: async () => {
          calls += 1;
          return { code: 0, stdout: "" };
        },
        ...overrides,
      }),
    );
    assert.equal(calls, 0);
  }
});

for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
  test(`capture removes mounted credentials after its child closes and before re-raising ${signal}`, async () => {
    const root = await temporaryRepository();
    const phaseRoot = join(
      root,
      "artifacts",
      "hosted-important-batch-backups",
      hostedImportantBatchId,
      "pre",
    );
    const pgpassPath = join(phaseRoot, ".capture.pgpass");
    const caPath = join(phaseRoot, ".capture-ca.crt");
    const process_ = new EventEmitter();
    process_.pid = 43_000;
    let childClosed = false;
    let childKillSignal;
    let reRaised;
    process_.kill = (pid, reRaisedSignal) => {
      assert.equal(childClosed, true);
      assert.equal(existsSync(pgpassPath), false);
      assert.equal(existsSync(caPath), false);
      reRaised = { pid, signal: reRaisedSignal };
      return true;
    };
    let runStarted = false;

    await assert.rejects(
      captureHostedImportantBatchBackup({
        administratorPassword: password,
        caCertificate,
        candidateCommit,
        phase: "pre",
        persistBackup: persistPortableBackup,
        process_,
        repositoryRoot: root,
        resolveDockerTarget: async () => dockerTarget,
        runProcess: async (_command, arguments_, options = {}) => {
          if (arguments_[2] === "container" && arguments_[3] === "inspect") {
            return { code: 1, stdout: "" };
          }
          if (runStarted) return { code: 1, stdout: "" };
          runStarted = true;
          const child = new EventEmitter();
          child.kill = (killSignal) => {
            childKillSignal = killSignal;
            queueMicrotask(() => {
              childClosed = true;
              child.emit("close", null, killSignal);
            });
            return true;
          };
          options.registerChild(child);
          queueMicrotask(() => process_.emit(signal));
          return new Promise((resolveResult) => {
            child.once("close", () => resolveResult({ code: null, stdout: "" }));
          });
        },
        wait: async () => undefined,
      }),
      /Hosted signal-aware cleanup is terminating\./u,
    );

    assert.equal(childKillSignal, "SIGKILL");
    assert.deepEqual(reRaised, { pid: 43_000, signal });
    for (const registeredSignal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
      assert.equal(process_.listenerCount(registeredSignal), 0);
    }
  });
}
