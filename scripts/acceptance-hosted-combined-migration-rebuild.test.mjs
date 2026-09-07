import assert from "node:assert/strict";
import test from "node:test";
import { hostedCombinedMigrationArtifactContract as contract } from "./acceptance-hosted-important-batch-contracts.mjs";
import { hostedImportantBatchPostgresRuntimeReference } from "./acceptance-hosted-important-batch-execution-contract.mjs";
import { rebuildHostedCombinedMigrationScratch } from "./acceptance-hosted-combined-migration-rebuild.mjs";
import { hostedCombinedMigrationRebuildExtraSql } from "./acceptance-hosted-combined-migration-sql.mjs";

const target = {
  command: "/Applications/OrbStack.app/Contents/MacOS/xbin/docker",
  host: "unix:///Users/fixed/.orbstack/run/docker.sock",
};

test("combined rebuild applies 28 sources, checks new catalogs before destroy, and never persists on failure", async () => {
  for (const failExtra of [false, true]) {
    let started = false;
    let destroyed = false;
    let persisted = false;
    const order = [];
    const run = () =>
      rebuildHostedCombinedMigrationScratch({
        repositoryRoot: process.cwd(),
        resolveDockerTarget: async () => target,
        wait: async () => undefined,
        migratePlatformBaseline: async ({ artifactContract, onStage }) => {
          assert.equal(artifactContract, contract);
          onStage("auth-baseline");
          order.push("auth");
          onStage("storage-baseline");
          order.push("storage");
        },
        persistRebuild: async ({ performRebuild }) => {
          await performRebuild();
          assert.equal(destroyed, true);
          persisted = true;
        },
        runProcess: async (command, arguments_, options = {}) => {
          assert.equal(command, target.command);
          assert.deepEqual(arguments_.slice(0, 2), ["--host", target.host]);
          if (arguments_[2] === "container") {
            if (!started || destroyed) return { code: 1, stdout: "\n" };
            return {
              code: 0,
              stdout: JSON.stringify({
                Config: {
                  Image: hostedImportantBatchPostgresRuntimeReference,
                  Labels: { "com.seen-said.acceptance": contract.scratchLabel },
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
            assert.ok(arguments_.includes(contract.scratchContainer));
            assert.ok(arguments_.includes(hostedImportantBatchPostgresRuntimeReference));
            assert.ok(arguments_.includes("never"));
            assert.ok(arguments_.includes("none"));
            assert.equal(
              arguments_.some((value) =>
                ["--mount", "--volume", "-p", "--publish"].includes(value),
              ),
              false,
            );
            started = true;
            return { code: 0, stdout: "started\n" };
          }
          if (arguments_[2] === "rm") {
            destroyed = true;
            order.push("destroy");
            return { code: 0, stdout: `${contract.scratchContainer}\n` };
          }
          if (arguments_.includes("head")) return { code: 0, stdout: "1\n" };
          if (arguments_.includes("pg_isready")) return { code: 0, stdout: "" };
          if (options.input.includes("/* postgres_image_ready */"))
            return { code: 0, stdout: "postgres_image_ready|t\n" };
          if (options.input.includes("/* baseline_contract */"))
            return { code: 0, stdout: "baseline_contract|t\n" };
          if (options.input === hostedCombinedMigrationRebuildExtraSql) {
            order.push("extra-catalogs");
            return { code: failExtra ? 1 : 0, stdout: "" };
          }
          if (options.input.startsWith("/* rebuild_contract */")) {
            order.push("final-contract");
            return {
              code: 0,
              stdout:
                "migration_chain_exact|t\nfictional_seed_exact|t\nhosted_data_absent|t\nruntime_contract_exact|t\n",
            };
          }
          if (options.input.includes("INSERT INTO supabase_migrations.schema_migrations"))
            order.push("migration");
          return { code: 0, stdout: "" };
        },
      });
    if (failExtra) await assert.rejects(run(), (error) => error.stage === "final-contract");
    else await run();
    assert.equal(persisted, !failExtra);
    assert.equal(destroyed, true);
    assert.equal(order.filter((value) => value === "migration").length, 28);
    assert.deepEqual(order.slice(0, 2), ["auth", "storage"]);
    assert.deepEqual(
      order.slice(-(failExtra ? 2 : 3)),
      failExtra ? ["extra-catalogs", "destroy"] : ["extra-catalogs", "final-contract", "destroy"],
    );
  }
});
