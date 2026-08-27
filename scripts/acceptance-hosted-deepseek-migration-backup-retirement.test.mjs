import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  hostedDeepseekMigrationBackupRetirementArgument,
  hostedDeepseekMigrationBackupRetirementHistoryDirectory,
  readHostedDeepseekMigrationBackupRetirementRepositoryState,
  retireHostedDeepseekMigrationBackup,
  runHostedDeepseekMigrationBackupRetirementCli,
  verifyHostedDeepseekMigrationBackupRetirementHistoricalCommit,
} from "./acceptance-hosted-deepseek-migration-backup-retirement.mjs";
import {
  hostedDeepseekMigrationBackupArtifactDirectory,
  hostedDeepseekMigrationBackupId,
} from "./acceptance-hosted-deepseek-migration-backup.mjs";
import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";

const currentCommit = "0123456789abcdef0123456789abcdef01234567";
const staleCommit = "fedcba9876543210fedcba9876543210fedcba98";
const otherStaleCommit = "1111111111111111111111111111111111111111";
const portableFilesystemOptions =
  process.platform === "win32" ? { directorySync: async () => undefined } : {};

function canonical(value) {
  return `${JSON.stringify(value)}\n`;
}

function preManifest(candidateCommit = staleCommit) {
  const dump = Buffer.from("opaque-hosted-database-dump");
  return {
    dump,
    document: {
      batchId: hostedDeepseekMigrationBackupId,
      candidateCommit,
      capturedAt: "2026-08-27T08:00:00.000Z",
      connectionProfile: "verify-full-administrator",
      contract: "huayi-hosted-important-batch-logical-backup/v1",
      dumpBytes: dump.byteLength,
      dumpFile: "database.dump",
      dumpFormat: "postgres-custom",
      dumpSha256: createHash("sha256").update(dump).digest("hex"),
      migrationHead: "20260825010000",
      phase: "pre",
      projectRef: hostedAcceptanceProjectRef,
    },
  };
}

function rebuildManifest(candidateCommit = staleCommit) {
  return {
    batchId: hostedDeepseekMigrationBackupId,
    candidateCommit,
    completedAt: "2026-08-27T08:01:00.000Z",
    contract: "huayi-hosted-important-batch-rebuild-verification/v1",
    fictionalSeedExact: true,
    hostedDataAbsent: true,
    migrationChainExact: true,
    migrationHead: "20260827060000",
    projectRef: hostedAcceptanceProjectRef,
    rebuildSource: "repository-migrations-and-fictional-seed",
    runtimeContractExact: true,
    scratchDestroyed: true,
  };
}

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "seen-said-deepseek-retirement-"));
  const activeBatch = join(root, hostedDeepseekMigrationBackupArtifactDirectory);
  const pre = join(activeBatch, "pre");
  const rebuild = join(activeBatch, "rebuild");
  await mkdir(pre, { mode: 0o700, recursive: true });
  await mkdir(rebuild, { mode: 0o700 });
  await chmod(dirname(activeBatch), 0o700);
  await chmod(activeBatch, 0o700);
  const backup = preManifest();
  await writeFile(join(pre, "database.dump"), backup.dump, { mode: 0o600 });
  await writeFile(join(pre, "backup-manifest.json"), canonical(backup.document), { mode: 0o600 });
  await writeFile(join(rebuild, "rebuild-verification.json"), canonical(rebuildManifest()), {
    mode: 0o600,
  });
  const state = {
    activeRootIgnored: true,
    candidateCommit: currentCommit,
    historyRootIgnored: true,
    upstreamExact: true,
    worktreeClean: true,
  };
  return { activeBatch, pre, rebuild, root, state };
}

function retainedPaths(fixture) {
  const candidateRoot = join(
    fixture.root,
    hostedDeepseekMigrationBackupRetirementHistoryDirectory,
    hostedDeepseekMigrationBackupId,
    staleCommit,
  );
  return {
    candidateRoot,
    retainedBatch: join(candidateRoot, "evidence"),
  };
}

async function exists(path) {
  return lstat(path).then(
    () => true,
    (error) => {
      if (error?.code === "ENOENT") return false;
      throw error;
    },
  );
}

async function retire(fixture, overrides = {}) {
  return retireHostedDeepseekMigrationBackup({
    ...portableFilesystemOptions,
    readRepositoryState: async () => fixture.state,
    repositoryRoot: fixture.root,
    verifyHistoricalCommit: async () => true,
    ...overrides,
  });
}

test("retirement atomically retains stale pre and rebuild as one strict historical unit", async () => {
  const fixture = await createFixture();
  try {
    const originalPre = await readFile(join(fixture.pre, "backup-manifest.json"), "utf8");
    const originalRebuild = await readFile(
      join(fixture.rebuild, "rebuild-verification.json"),
      "utf8",
    );
    await retire(fixture);

    assert.equal(await exists(fixture.activeBatch), false);
    const retained = retainedPaths(fixture);
    assert.deepEqual((await readdir(retained.retainedBatch)).sort(), ["pre", "rebuild"]);
    assert.equal(
      await readFile(join(retained.retainedBatch, "pre", "backup-manifest.json"), "utf8"),
      originalPre,
    );
    assert.equal(
      await readFile(join(retained.retainedBatch, "rebuild", "rebuild-verification.json"), "utf8"),
      originalRebuild,
    );
    for (const directory of [retained.candidateRoot, retained.retainedBatch]) {
      assert.equal((await lstat(directory)).mode & 0o777, 0o700);
    }
  } finally {
    await rm(fixture.root, { force: true, recursive: true });
  }
});

test("retirement rejects current, mixed, malformed, post-present, extra, and symlink evidence", async () => {
  const cases = [
    async (fixture) => {
      fixture.state.candidateCommit = staleCommit;
    },
    async (fixture) => {
      const path = join(fixture.rebuild, "rebuild-verification.json");
      const document = JSON.parse(await readFile(path, "utf8"));
      document.candidateCommit = otherStaleCommit;
      await writeFile(path, canonical(document));
    },
    async (fixture) => {
      await writeFile(join(fixture.pre, "backup-manifest.json"), "{}\n");
    },
    async (fixture) => {
      await mkdir(join(fixture.activeBatch, "post"), { mode: 0o700 });
    },
    async (fixture) => {
      await writeFile(join(fixture.activeBatch, "unexpected"), "private", { mode: 0o600 });
    },
    async (fixture) => {
      const path = join(fixture.pre, "database.dump");
      await rm(path);
      await symlink(join(fixture.root, "outside"), path);
    },
  ];
  for (const arrange of cases) {
    const fixture = await createFixture();
    try {
      await arrange(fixture);
      await assert.rejects(retire(fixture));
      assert.equal(await exists(fixture.activeBatch), true);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }
});

test("retirement rejects unsafe permissions, occupied history, and unsafe repository state", async () => {
  const cases = [
    async (fixture) => chmod(join(fixture.pre, "backup-manifest.json"), 0o644),
    async (fixture) =>
      mkdir(retainedPaths(fixture).candidateRoot, { mode: 0o700, recursive: true }),
    async (fixture) => {
      fixture.state.worktreeClean = false;
    },
    async (fixture) => {
      fixture.state.upstreamExact = false;
    },
    async (fixture) => {
      fixture.state.activeRootIgnored = false;
    },
    async (fixture) => {
      fixture.state.historyRootIgnored = false;
    },
    async (fixture) => {
      let inspections = 0;
      Object.defineProperty(fixture.state, "worktreeClean", {
        get: () => (inspections += 1) < 3,
      });
    },
  ];
  for (const arrange of cases) {
    const fixture = await createFixture();
    try {
      await arrange(fixture);
      await assert.rejects(retire(fixture));
      assert.equal(await exists(fixture.activeBatch), true);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }
});

test("retirement rejects a missing or non-ancestor stale commit before mutation", async () => {
  for (const verdict of [false, undefined]) {
    const fixture = await createFixture();
    try {
      let checkedCommit = "";
      await assert.rejects(
        retire(fixture, {
          verifyHistoricalCommit: async (_root, candidate) => {
            checkedCommit = candidate;
            if (verdict === undefined) throw new Error("private-git-error");
            return verdict;
          },
        }),
      );
      assert.equal(checkedCommit, staleCommit);
      assert.equal(await exists(fixture.activeBatch), true);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }
});

test("rename, fsync, and post-move validation failures retain one complete unit", async () => {
  for (const failure of ["rename", "sync-before", "sync-after", "post-move"]) {
    const fixture = await createFixture();
    try {
      const retained = retainedPaths(fixture);
      await assert.rejects(
        retire(fixture, {
          directorySync: async (path) => {
            if (failure === "sync-before" && path === dirname(retained.candidateRoot)) {
              throw new Error("private-sync-before");
            }
            if (failure === "sync-after" && path === dirname(fixture.activeBatch)) {
              throw new Error("private-sync-after");
            }
          },
          postMoveAudit:
            failure === "post-move"
              ? async () => {
                  throw new Error("private-post-move");
                }
              : undefined,
          renameBatch:
            failure === "rename"
              ? async () => {
                  throw new Error("private-rename");
                }
              : undefined,
        }),
      );
      const activeComplete =
        (await exists(join(fixture.activeBatch, "pre", "database.dump"))) &&
        (await exists(join(fixture.activeBatch, "rebuild", "rebuild-verification.json")));
      const retainedComplete =
        (await exists(join(retained.retainedBatch, "pre", "database.dump"))) &&
        (await exists(join(retained.retainedBatch, "rebuild", "rebuild-verification.json")));
      assert.equal(activeComplete || retainedComplete, true);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  }
});

test("repository checks require clean pushed HEAD and both narrow roots ignored", async () => {
  const calls = [];
  const state = await readHostedDeepseekMigrationBackupRetirementRepositoryState("/repo", {
    runGit: async (arguments_) => {
      calls.push(arguments_);
      if (arguments_[0] === "status" || arguments_[0] === "check-ignore") {
        return { code: 0, stdout: "" };
      }
      return { code: 0, stdout: `${currentCommit}\n` };
    },
  });
  assert.deepEqual(state, {
    activeRootIgnored: true,
    candidateCommit: currentCommit,
    historyRootIgnored: true,
    upstreamExact: true,
    worktreeClean: true,
  });
  assert.equal(calls.filter((arguments_) => arguments_[0] === "check-ignore").length, 2);
});

test("historical commit verification requires an existing commit that is a HEAD ancestor", async () => {
  const calls = [];
  assert.equal(
    await verifyHostedDeepseekMigrationBackupRetirementHistoricalCommit("/repo", staleCommit, {
      runGit: async (arguments_) => {
        calls.push(arguments_);
        return { code: 0, stdout: "" };
      },
    }),
    true,
  );
  assert.deepEqual(calls, [
    ["cat-file", "-e", `${staleCommit}^{commit}`],
    ["merge-base", "--is-ancestor", staleCommit, "HEAD"],
  ]);
  assert.equal(
    await verifyHostedDeepseekMigrationBackupRetirementHistoricalCommit("/repo", staleCommit, {
      runGit: async (arguments_) => ({
        code: arguments_[0] === "cat-file" ? 0 : 1,
        stdout: "",
      }),
    }),
    false,
  );
});

test("retirement CLI is exact, body-free, and has no secret or hosted child surface", async () => {
  const secret = "private-password-value";
  let calls = 0;
  for (const arguments_ of [[], [hostedDeepseekMigrationBackupRetirementArgument, secret]]) {
    let stderr = "";
    const code = await runHostedDeepseekMigrationBackupRetirementCli({
      arguments_,
      retireEvidence: async () => {
        calls += 1;
      },
      writeError: (value) => {
        stderr += value;
      },
    });
    assert.equal(code, 1);
    assert.doesNotMatch(stderr, new RegExp(secret, "u"));
  }
  assert.equal(calls, 0);

  let stdout = "";
  const code = await runHostedDeepseekMigrationBackupRetirementCli({
    arguments_: [hostedDeepseekMigrationBackupRetirementArgument],
    retireEvidence: async () => {
      calls += 1;
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });
  assert.equal(code, 0);
  assert.equal(calls, 1);
  assert.equal(stdout, "Hosted DeepSeek migration stale backup evidence retired.\n");
});

test("package exposes only the dedicated fixed retirement confirmation", async () => {
  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:deepseek:migration:backup:retire"],
    `node scripts/acceptance-hosted-deepseek-migration-backup-retirement.mjs ${hostedDeepseekMigrationBackupRetirementArgument}`,
  );
});
