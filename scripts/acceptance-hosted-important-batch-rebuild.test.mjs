import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  hostedImportantBatchRebuildArgument,
  rebuildHostedImportantBatchScratch,
} from "./acceptance-hosted-important-batch-rebuild.mjs";
import {
  hostedImportantBatchMigrationVersions,
  hostedImportantBatchPostgresRuntimeReference,
  hostedImportantBatchScratchContainer,
} from "./acceptance-hosted-important-batch-execution-contract.mjs";
import { hostedImportantBatchId } from "./acceptance-hosted-important-batch-backup.mjs";

const candidateCommit = "0123456789abcdef0123456789abcdef01234567";
const dockerTarget = {
  command: "/Applications/OrbStack.app/Contents/MacOS/xbin/docker",
  host: "unix:///Users/fixed/.orbstack/run/docker.sock",
};
const temporaryRoots = [];

test.afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function temporaryRepository() {
  const root = await mkdtemp(join(tmpdir(), "huayi-hosted-backup-rebuild-"));
  temporaryRoots.push(root);
  return root;
}

function fictionalSources() {
  return {
    migrations: hostedImportantBatchMigrationVersions.map((version) => ({
      source: `SELECT '${version}'::text;\n`,
      version,
    })),
    seed: "SELECT 'fictional-seed'::text;\n",
  };
}

test("rebuild exposes one fixed confirmation-gated operation", () => {
  assert.equal(typeof rebuildHostedImportantBatchScratch, "function");
  assert.match(hostedImportantBatchRebuildArgument, /^--confirm-rebuild-0014-/u);
});

test("rebuild runs a networkless digest-only scratch, applies exact migrations and seed, then destroys it", async () => {
  const root = await temporaryRepository();
  const calls = [];
  let started = false;
  let destroyed = false;
  const runProcess = async (command, arguments_, options = {}) => {
    calls.push({ arguments: [...arguments_], command, input: options.input });
    assert.equal(command, dockerTarget.command);
    assert.deepEqual(arguments_.slice(0, 2), ["--host", dockerTarget.host]);
    assert.equal(
      arguments_.some((value) => /supabase\/postgres:/u.test(value)),
      false,
    );
    if (arguments_[2] === "container" && arguments_[3] === "inspect") {
      if (!started || destroyed) return { code: 1, stdout: "\n" };
      return {
        code: 0,
        stdout: JSON.stringify({
          Config: {
            Image: hostedImportantBatchPostgresRuntimeReference,
            Labels: { "com.seen-said.acceptance": "phase-81-0014-rebuild" },
          },
          HostConfig: {
            Binds: null,
            NetworkMode: "none",
            Tmpfs: {
              "/var/lib/postgresql/data": "rw,nosuid,nodev,noexec,size=2147483648,mode=0700",
            },
          },
          Mounts: [],
        }),
      };
    }
    if (arguments_[2] === "run") {
      started = true;
      assert.ok(arguments_.includes("--network"));
      assert.ok(arguments_.includes("none"));
      assert.ok(arguments_.includes("--pull"));
      assert.ok(arguments_.includes("never"));
      assert.ok(arguments_.includes("--tmpfs"));
      assert.equal(
        arguments_.some((value) => value.startsWith("PGDATA=")),
        false,
      );
      assert.ok(arguments_.includes(hostedImportantBatchPostgresRuntimeReference));
      return { code: 0, stdout: `${hostedImportantBatchScratchContainer}\n` };
    }
    if (arguments_[2] === "rm") {
      destroyed = true;
      return { code: 0, stdout: `${hostedImportantBatchScratchContainer}\n` };
    }
    if (arguments_[2] === "exec" && arguments_.includes("head")) {
      return { code: 0, stdout: "1\n" };
    }
    if (arguments_[2] === "exec" && arguments_.includes("pg_isready")) {
      return { code: 0, stdout: "" };
    }
    if (arguments_[2] === "exec" && options.input?.includes("baseline_contract")) {
      return { code: 0, stdout: "baseline_contract|t\n" };
    }
    if (arguments_[2] === "exec" && options.input?.includes("rebuild_contract")) {
      return {
        code: 0,
        stdout:
          "migration_chain_exact|t\nfictional_seed_exact|t\nhosted_data_absent|t\nruntime_contract_exact|t\n",
      };
    }
    if (arguments_[2] === "exec" && options.input !== undefined) {
      return { code: 0, stdout: "" };
    }
    return { code: 1, stdout: "" };
  };

  await rebuildHostedImportantBatchScratch({
    candidateCommit,
    loadSources: async () => fictionalSources(),
    repositoryRoot: root,
    resolveDockerTarget: async () => dockerTarget,
    runProcess,
    wait: async () => undefined,
  });

  assert.equal(started, true);
  assert.equal(destroyed, true);
  const sqlInputs = calls.map((call) => call.input).filter((value) => value !== undefined);
  for (const version of hostedImportantBatchMigrationVersions) {
    assert.equal(sqlInputs.filter((input) => input.includes(version)).length, 2);
  }
  assert.equal(sqlInputs.filter((input) => input.includes("fictional-seed")).length, 1);
  const rebuildRoot = join(
    root,
    "artifacts",
    "hosted-important-batch-backups",
    hostedImportantBatchId,
    "rebuild",
  );
  assert.deepEqual(await readdir(rebuildRoot), ["rebuild-verification.json"]);
  const manifest = JSON.parse(
    await readFile(join(rebuildRoot, "rebuild-verification.json"), "utf8"),
  );
  assert.equal(manifest.scratchDestroyed, true);
});

test("rebuild waits for the final PID 1 postmaster after early pg_isready success", async () => {
  const root = await temporaryRepository();
  let started = false;
  let destroyed = false;
  let postmasterChecks = 0;
  let finalPostmasterReady = false;
  await rebuildHostedImportantBatchScratch({
    candidateCommit,
    loadSources: async () => fictionalSources(),
    repositoryRoot: root,
    resolveDockerTarget: async () => dockerTarget,
    runProcess: async (_command, arguments_, options = {}) => {
      if (arguments_[2] === "container" && arguments_[3] === "inspect") {
        if (!started || destroyed) return { code: 1, stdout: "" };
        return {
          code: 0,
          stdout: JSON.stringify({
            Config: {
              Image: hostedImportantBatchPostgresRuntimeReference,
              Labels: { "com.seen-said.acceptance": "phase-81-0014-rebuild" },
            },
            HostConfig: {
              Binds: null,
              NetworkMode: "none",
              Tmpfs: {
                "/var/lib/postgresql/data": "rw,nosuid,nodev,noexec,size=2147483648,mode=0700",
              },
            },
            Mounts: [],
          }),
        };
      }
      if (arguments_[2] === "run") {
        started = true;
        return { code: 0, stdout: "started\n" };
      }
      if (arguments_[2] === "rm") {
        destroyed = true;
        return { code: 0, stdout: `${hostedImportantBatchScratchContainer}\n` };
      }
      if (arguments_[2] === "exec" && arguments_.includes("head")) {
        assert.deepEqual(arguments_.slice(2), [
          "exec",
          hostedImportantBatchScratchContainer,
          "head",
          "-n",
          "1",
          "/var/lib/postgresql/data/postmaster.pid",
        ]);
        postmasterChecks += 1;
        finalPostmasterReady = postmasterChecks >= 3;
        return {
          code: 0,
          stdout: ["44\n", "1\nextra", "1\n"][postmasterChecks - 1],
        };
      }
      if (arguments_[2] === "exec" && arguments_.includes("pg_isready")) {
        return { code: 0, stdout: "" };
      }
      if (arguments_[2] === "exec" && options.input?.includes("baseline_contract")) {
        assert.equal(finalPostmasterReady, true);
        return { code: 0, stdout: "baseline_contract|t\n" };
      }
      if (arguments_[2] === "exec" && options.input?.includes("rebuild_contract")) {
        return {
          code: 0,
          stdout:
            "migration_chain_exact|t\nfictional_seed_exact|t\nhosted_data_absent|t\nruntime_contract_exact|t\n",
        };
      }
      if (arguments_[2] === "exec" && options.input !== undefined) {
        return { code: 0, stdout: "" };
      }
      return { code: 1, stdout: "" };
    },
    wait: async () => undefined,
  });

  assert.equal(postmasterChecks, 3);
  assert.equal(destroyed, true);
});

test("rebuild destroys scratch and writes no evidence after any migration or verification failure", async () => {
  for (const failAt of ["migration", "verification", "destroy"]) {
    const root = await temporaryRepository();
    let started = false;
    let removed = false;
    let migrationAttempted = false;
    let verificationAttempted = false;
    await assert.rejects(
      rebuildHostedImportantBatchScratch({
        candidateCommit,
        loadSources: async () => fictionalSources(),
        repositoryRoot: root,
        resolveDockerTarget: async () => dockerTarget,
        runProcess: async (_command, arguments_, options = {}) => {
          if (arguments_[2] === "container" && arguments_[3] === "inspect") {
            return started && !removed
              ? {
                  code: 0,
                  stdout: JSON.stringify({
                    Config: {
                      Image: hostedImportantBatchPostgresRuntimeReference,
                      Labels: { "com.seen-said.acceptance": "phase-81-0014-rebuild" },
                    },
                    HostConfig: {
                      Binds: null,
                      NetworkMode: "none",
                      Tmpfs: {
                        "/var/lib/postgresql/data":
                          "rw,nosuid,nodev,noexec,size=2147483648,mode=0700",
                      },
                    },
                    Mounts: [],
                  }),
                }
              : { code: 1, stdout: "" };
          }
          if (arguments_[2] === "run") {
            started = true;
            return { code: 0, stdout: "started\n" };
          }
          if (arguments_[2] === "rm") {
            if (failAt === "destroy") return { code: 1, stdout: "" };
            removed = true;
            return { code: 0, stdout: `${hostedImportantBatchScratchContainer}\n` };
          }
          if (arguments_.includes("head")) return { code: 0, stdout: "1\n" };
          if (arguments_.includes("pg_isready")) return { code: 0, stdout: "" };
          if (options.input?.includes("baseline_contract")) {
            return { code: 0, stdout: "baseline_contract|t\n" };
          }
          if (options.input?.includes("rebuild_contract")) {
            verificationAttempted = true;
            return failAt === "verification"
              ? { code: 0, stdout: "hosted_data_absent|f\n" }
              : {
                  code: 0,
                  stdout:
                    "migration_chain_exact|t\nfictional_seed_exact|t\nhosted_data_absent|t\nruntime_contract_exact|t\n",
                };
          }
          if (options.input !== undefined) {
            const isMigration = /202608\d{8}/u.test(options.input);
            if (isMigration) migrationAttempted = true;
            return failAt === "migration" && isMigration
              ? { code: 1, stdout: "private migration error" }
              : { code: 0, stdout: "" };
          }
          return { code: 0, stdout: "" };
        },
        wait: async () => undefined,
      }),
    );
    const rebuildRoot = join(
      root,
      "artifacts",
      "hosted-important-batch-backups",
      hostedImportantBatchId,
      "rebuild",
    );
    assert.deepEqual(await readdir(rebuildRoot), []);
    if (failAt === "migration") assert.equal(migrationAttempted, true);
    if (failAt === "verification") assert.equal(verificationAttempted, true);
    if (failAt !== "destroy") assert.equal(removed, true);
  }
});

test("rebuild never removes an unknown same-name container created during the start race", async () => {
  const root = await temporaryRepository();
  let initialInspection = true;
  let removals = 0;
  await assert.rejects(
    rebuildHostedImportantBatchScratch({
      candidateCommit,
      loadSources: async () => fictionalSources(),
      repositoryRoot: root,
      resolveDockerTarget: async () => dockerTarget,
      runProcess: async (_command, arguments_) => {
        if (arguments_[2] === "container" && arguments_[3] === "inspect") {
          if (initialInspection) {
            initialInspection = false;
            return { code: 1, stdout: "" };
          }
          return {
            code: 0,
            stdout: JSON.stringify({
              Config: {
                Image: "docker.io/untrusted/postgres@sha256:fictional",
                Labels: { "com.seen-said.acceptance": "untrusted" },
              },
              HostConfig: { Binds: null, NetworkMode: "bridge", Tmpfs: {} },
              Mounts: [],
            }),
          };
        }
        if (arguments_[2] === "run") return { code: 1, stdout: "" };
        if (arguments_[2] === "rm") {
          removals += 1;
          return { code: 0, stdout: `${hostedImportantBatchScratchContainer}\n` };
        }
        return { code: 1, stdout: "" };
      },
      wait: async () => undefined,
    }),
    /rebuild failed/u,
  );

  assert.equal(removals, 0);
  assert.deepEqual(
    await readdir(
      join(root, "artifacts", "hosted-important-batch-backups", hostedImportantBatchId, "rebuild"),
    ),
    [],
  );
});

test("rebuild rejects nonlocal Docker targets and an inexact migration source set before start", async () => {
  for (const overrides of [
    {
      resolveDockerTarget: async () => ({
        command: "docker",
        host: "tcp://private.example.test:2376",
      }),
    },
    {
      loadSources: async () => ({
        ...fictionalSources(),
        migrations: fictionalSources().migrations.slice(1),
      }),
    },
  ]) {
    let calls = 0;
    await assert.rejects(
      rebuildHostedImportantBatchScratch({
        candidateCommit,
        loadSources: async () => fictionalSources(),
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
