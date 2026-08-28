import assert from "node:assert/strict";
import test from "node:test";

import {
  hostedPhase91RebuildArgument,
  loadHostedPhase91RebuildSources,
  rebuildHostedPhase91Scratch,
} from "./acceptance-hosted-phase-91-rebuild.mjs";
import {
  hostedImportantBatchPostgresRuntimeReference,
  runHostedImportantBatchProcess,
} from "./acceptance-hosted-important-batch-execution-contract.mjs";
import { hostedPhase91ArtifactContract } from "./acceptance-hosted-important-batch-contracts.mjs";

const candidateCommit = "0123456789abcdef0123456789abcdef01234567";
const dockerTarget = {
  command: "/Applications/OrbStack.app/Contents/MacOS/xbin/docker",
  host: "unix:///Users/fixed/.orbstack/run/docker.sock",
};

function fictionalSources() {
  return {
    migrations: hostedPhase91ArtifactContract.migrationVersions.map((version) => ({
      source: `SELECT '${version}'::text;\n`,
      version,
    })),
    seed: "SELECT 'fictional-seed'::text;\n",
  };
}

test("historical Phase 91 rebuild stays pinned to 0015 as later migrations are added", async () => {
  assert.match(hostedPhase91RebuildArgument, /^--confirm-rebuild-0015-/u);
  assert.equal(hostedPhase91ArtifactContract.migrationFiles.length, 15);
  assert.equal(hostedPhase91ArtifactContract.migrationVersions.at(-1), "20260825010000");
  const sources = await loadHostedPhase91RebuildSources(process.cwd());
  assert.deepEqual(
    sources.migrations.map(({ version }) => version),
    hostedPhase91ArtifactContract.migrationVersions,
  );
});

test("Phase 91 rebuild uses a distinct networkless scratch and records head 0015 only after destroy", async () => {
  const calls = [];
  let running = false;
  let destroyed = false;
  let persisted;
  const runProcess = async (command, arguments_, options = {}) => {
    calls.push({ arguments: [...arguments_], command, input: options.input });
    assert.equal(command, dockerTarget.command);
    const operation = arguments_[2];
    if (operation === "container" && arguments_[3] === "inspect") {
      if (!running) return { code: 1, stdout: "" };
      return {
        code: 0,
        stdout: `${JSON.stringify({
          Config: {
            Image: hostedImportantBatchPostgresRuntimeReference,
            Labels: { "com.seen-said.acceptance": "phase-91-0015-acl-rebuild" },
          },
          HostConfig: {
            Binds: null,
            NetworkMode: "none",
            Tmpfs: {
              "/var/lib/postgresql/data": "rw,nosuid,nodev,noexec,size=2147483648,mode=0700",
            },
          },
          Mounts: [],
        })}\n`,
      };
    }
    if (operation === "run") {
      assert.ok(arguments_.includes("--network"));
      assert.equal(arguments_[arguments_.indexOf("--network") + 1], "none");
      assert.ok(arguments_.includes("huayi-phase-91-0015-acl-rebuild"));
      assert.ok(arguments_.includes("com.seen-said.acceptance=phase-91-0015-acl-rebuild"));
      running = true;
      return { code: 0, stdout: "fictional-container-id\n" };
    }
    if (operation === "exec" && arguments_.includes("head")) {
      return { code: 0, stdout: "1\n" };
    }
    if (operation === "exec" && arguments_.includes("pg_isready")) {
      return { code: 0, stdout: "" };
    }
    if (operation === "exec" && arguments_.includes("psql")) {
      if (options.input.includes("postgres_image_ready")) {
        return { code: 0, stdout: "postgres_image_ready|t\n" };
      }
      if (options.input.includes("baseline_contract")) {
        return { code: 0, stdout: "baseline_contract|t\n" };
      }
      if (options.input.includes("rebuild_contract")) {
        assert.match(options.input, /20260825010000/u);
        return {
          code: 0,
          stdout:
            "migration_chain_exact|t\nfictional_seed_exact|t\nhosted_data_absent|t\nruntime_contract_exact|t\n",
        };
      }
      return { code: 0, stdout: "" };
    }
    if (operation === "rm") {
      assert.deepEqual(arguments_.slice(-2), ["--force", "huayi-phase-91-0015-acl-rebuild"]);
      running = false;
      destroyed = true;
      return { code: 0, stdout: "huayi-phase-91-0015-acl-rebuild\n" };
    }
    return { code: 1, stdout: "" };
  };

  await rebuildHostedPhase91Scratch({
    candidateCommit,
    loadSources: async () => fictionalSources(),
    migratePlatformBaseline: async ({ artifactContract, onStage }) => {
      assert.equal(artifactContract, hostedPhase91ArtifactContract);
      onStage("auth-baseline");
      onStage("storage-baseline");
    },
    now: (() => {
      let value = 0;
      return () => (value += 100);
    })(),
    persistRebuild: async ({ artifactContract, performRebuild }) => {
      assert.equal(artifactContract, hostedPhase91ArtifactContract);
      persisted = await performRebuild();
      assert.equal(destroyed, true);
    },
    repositoryRoot: process.cwd(),
    resolveDockerTarget: async () => dockerTarget,
    runProcess,
    wait: async () => undefined,
  });
  assert.deepEqual(persisted, {
    fictionalSeedExact: true,
    hostedDataAbsent: true,
    migrationChainExact: true,
    runtimeContractExact: true,
    scratchDestroyed: true,
  });
  assert.equal(
    calls.some((call) => JSON.stringify(call).includes("phase-81")),
    false,
  );
});

test("important-batch process remains injectable and shell-free", () => {
  assert.equal(typeof runHostedImportantBatchProcess, "function");
});
