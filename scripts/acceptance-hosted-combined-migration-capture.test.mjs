import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { captureHostedCombinedMigrationBackup } from "./acceptance-hosted-combined-migration-capture.mjs";
import { hostedCombinedMigrationArtifactContract as contract } from "./acceptance-hosted-important-batch-contracts.mjs";
import { hostedImportantBatchPostgresRuntimeReference } from "./acceptance-hosted-important-batch-execution-contract.mjs";
import { loadHostedCombinedMigrationSources } from "./acceptance-hosted-combined-migration-sources.mjs";
import { renderHostedCombinedMigrationCaptureSql } from "./acceptance-hosted-combined-migration-sql.mjs";

const candidateCommit = "0123456789abcdef0123456789abcdef01234567";
const dockerTarget = {
  command: "/Applications/OrbStack.app/Contents/MacOS/xbin/docker",
  host: "unix:///Users/fixed/.orbstack/run/docker.sock",
};
const password = "fictional-administrator-password";
const caCertificate = "-----BEGIN CERTIFICATE-----\nfictional-ca\n-----END CERTIFICATE-----\n";
const baseToc =
  "1; 0 100 TABLE DATA auth users owner\n2; 0 101 TABLE DATA storage objects owner\n3; 0 102 TABLE DATA public user_profiles owner\n4; 0 103 TABLE DATA supabase_migrations schema_migrations owner\n";

const relevantTables = [
  "learning_tasks",
  "learning_task_submission_keys",
  "learning_task_events",
  "practice_sessions",
  "error_diagnostics",
];
const toc =
  baseToc +
  relevantTables
    .map((table, index) => `${index + 5}; 0 ${index + 104} TABLE DATA public ${table} owner\n`)
    .join("");

function mount(arguments_, destination) {
  return /src=([^,]+)/u.exec(arguments_.find((value) => value.includes(`dst=${destination}`)))?.[1];
}

async function runCapture(phase, failure = null) {
  const root = await mkdtemp(join(tmpdir(), "seen-said-combined-capture-"));
  const sources = await loadHostedCombinedMigrationSources(process.cwd());
  const calls = [];
  const phaseRoot = join(root, contract.artifactDirectory, phase);
  const capture = () =>
    captureHostedCombinedMigrationBackup({
      ...(process.platform === "win32"
        ? { directorySync: async () => undefined, privateModeMatches: () => true }
        : {}),
      administratorPassword: password,
      caCertificate,
      candidateCommit,
      phase,
      repositoryRoot: root,
      loadSources: async () => sources,
      resolveDockerTarget: async () => dockerTarget,
      runProcess: async (command, arguments_, options) => {
        assert.equal(command, dockerTarget.command);
        if (arguments_[2] === "container") return { code: 1, stdout: "\n" };
        const entrypoint = arguments_[arguments_.indexOf("--entrypoint") + 1];
        calls.push(entrypoint);
        assert.ok(arguments_.includes(hostedImportantBatchPostgresRuntimeReference));
        assert.ok(arguments_.includes("never"));
        assert.ok(
          arguments_.includes(
            `com.seen-said.acceptance=${contract.captureIdentityPrefix}-capture-${phase}-${entrypoint === "psql" ? "contract" : entrypoint.replaceAll("_", "-")}`,
          ),
        );
        assert.equal(JSON.stringify({ arguments_, options }).includes(password), false);
        assert.equal(JSON.stringify({ arguments_, options }).includes(caCertificate), false);
        if (entrypoint === "psql") {
          assert.equal(arguments_.at(-1), renderHostedCombinedMigrationCaptureSql(phase, sources));
          assert.ok(arguments_.includes("PGSSLMODE=verify-full"));
          assert.ok(arguments_.includes("5432"));
          assert.ok(arguments_.includes("postgres.kpadiulxkgckskcfydry"));
          assert.equal(
            await readFile(mount(arguments_, "/run/huayi/database-ca.crt"), "utf8"),
            caCertificate,
          );
          if (process.platform !== "win32")
            assert.equal((await stat(mount(arguments_, "/run/huayi/pgpass"))).mode & 0o777, 0o600);
          return {
            code: failure === "ledger" ? 1 : 0,
            stdout: `migration_head|${phase === "pre" ? contract.preMigrationHead : contract.postMigrationHead}\nstorage_objects_zero|${failure === "storage" ? "f" : "t"}\n`,
          };
        }
        if (entrypoint === "pg_dump") {
          assert.ok(arguments_.includes("custom"));
          assert.equal(
            arguments_.some((value) => value === "--schema" || value === "--table"),
            false,
          );
          await writeFile(mount(arguments_, "/evidence/database.dump"), "fictional opaque dump");
          return { code: 0, stdout: "" };
        }
        assert.equal(entrypoint, "pg_restore");
        assert.ok(arguments_.includes("none"));
        const archiveToc = failure?.startsWith("omit:")
          ? toc
              .split("\n")
              .filter((line) => !line.includes(`TABLE DATA public ${failure.slice(5)} `))
              .join("\n")
          : failure === "fragment"
            ? toc.replace(
                "9; 0 108 TABLE DATA public error_diagnostics owner",
                "untrusted 9; 0 108 TABLE DATA public error_diagnostics owner",
              )
            : failure === "coverage"
              ? toc.replace("auth users", "auth wrong")
              : toc;
        return { code: 0, stdout: archiveToc };
      },
    });
  try {
    if (failure) {
      await assert.rejects(capture());
      assert.deepEqual(await readdir(phaseRoot), []);
      if (failure === "ledger" || failure === "storage") assert.deepEqual(calls, ["psql"]);
    } else {
      await capture();
      assert.deepEqual(calls, ["psql", "pg_dump", "pg_restore"]);
      assert.deepEqual((await readdir(phaseRoot)).sort(), [
        "backup-manifest.json",
        "database.dump",
      ]);
      const manifest = JSON.parse(await readFile(join(phaseRoot, "backup-manifest.json"), "utf8"));
      assert.equal(manifest.batchId, contract.batchId);
      assert.equal(manifest.candidateCommit, candidateCommit);
      assert.equal(
        manifest.migrationHead,
        phase === "pre" ? contract.preMigrationHead : contract.postMigrationHead,
      );
      await assert.rejects(capture(), /directory is not empty/u);
      assert.equal(calls.length, 3);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("combined pre/post capture retain exact TLS/digest/archive/manifest/cleanup contracts", async () => {
  await runCapture("pre");
  await runCapture("post");
});
test("combined capture stops on ledger/storage/TOC failure and leaves no partial evidence", async () => {
  for (const failure of ["ledger", "storage", "coverage"]) await runCapture("pre", failure);
});

test("combined capture rejects every omitted new table and unanchored TOC fragments", async () => {
  for (const table of relevantTables.slice(0, 4)) await runCapture("pre", `omit:${table}`);
  for (const table of relevantTables) await runCapture("post", `omit:${table}`);
  await runCapture("post", "fragment");
});
