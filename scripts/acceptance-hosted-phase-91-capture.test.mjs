import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  captureHostedPhase91Backup,
  hostedPhase91CapturePostArgument,
  hostedPhase91CapturePreArgument,
} from "./acceptance-hosted-phase-91-capture.mjs";
import { hostedImportantBatchPostgresRuntimeReference } from "./acceptance-hosted-important-batch-execution-contract.mjs";
import { hostedPhase91BackupArtifactDirectory } from "./acceptance-hosted-phase-91-backup.mjs";

const candidateCommit = "0123456789abcdef0123456789abcdef01234567";
const dockerTarget = {
  command: "/Applications/OrbStack.app/Contents/MacOS/xbin/docker",
  host: "unix:///Users/fixed/.orbstack/run/docker.sock",
};
const caCertificate = "-----BEGIN CERTIFICATE-----\nfictional-ca\n-----END CERTIFICATE-----\n";
const temporaryRoots = [];

test.afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

function sourceFromMount(arguments_, destination) {
  const mount = arguments_.find(
    (value) =>
      value.startsWith("type=bind,") &&
      (value.includes(`dst=${destination},`) || value.endsWith(`dst=${destination}`)),
  );
  return /(?:^|,)src=([^,]+)(?:,|$)/u.exec(mount)?.[1];
}

test("Phase 91 capture exposes only its independent fixed pre and post arguments", () => {
  assert.match(hostedPhase91CapturePreArgument, /^--confirm-capture-pre-0015-/u);
  assert.match(hostedPhase91CapturePostArgument, /^--confirm-capture-post-0015-/u);
});

test("Phase 91 capture binds 14-to-15 heads, distinct container labels, and its own evidence", async () => {
  let directorySyncs = 0;
  let privateModeChecks = 0;
  for (const { expectedHead, phase } of [
    { expectedHead: "20260824010000", phase: "pre" },
    { expectedHead: "20260825010000", phase: "post" },
  ]) {
    const root = await mkdtemp(join(tmpdir(), `huayi-phase-91-capture-${phase}-`));
    temporaryRoots.push(root);
    const labels = [];
    const runProcess = async (command, arguments_) => {
      assert.equal(command, dockerTarget.command);
      if (arguments_[2] === "container" && arguments_[3] === "inspect") {
        return { code: 1, stdout: "" };
      }
      assert.ok(arguments_.includes(hostedImportantBatchPostgresRuntimeReference));
      const label = arguments_.find((value) => value.startsWith("com.seen-said.acceptance="));
      labels.push(label);
      assert.match(label, /^com\.seen-said\.acceptance=phase-91-0015-acl-capture-/u);
      assert.doesNotMatch(label, /phase-81/u);
      const entrypoint = arguments_[arguments_.indexOf("--entrypoint") + 1];
      if (entrypoint === "psql") {
        return {
          code: 0,
          stdout: `migration_head|${expectedHead}\nstorage_objects_zero|t\n`,
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
    await captureHostedPhase91Backup({
      administratorPassword: "fictional-administrator-password",
      caCertificate,
      candidateCommit,
      directorySync: async () => {
        directorySyncs += 1;
      },
      phase,
      privateModeMatches: () => {
        privateModeChecks += 1;
        return true;
      },
      repositoryRoot: root,
      resolveDockerTarget: async () => dockerTarget,
      runProcess,
    });
    assert.equal(labels.length, 3);
    const manifest = JSON.parse(
      await readFile(
        join(root, hostedPhase91BackupArtifactDirectory, phase, "backup-manifest.json"),
        "utf8",
      ),
    );
    assert.equal(manifest.migrationHead, expectedHead);
  }
  assert.equal(directorySyncs, 4);
  assert.equal(privateModeChecks, 10);
});
