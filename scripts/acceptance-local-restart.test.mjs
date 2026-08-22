import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const moduleUrl = new URL("./acceptance-local-restart.mjs", import.meta.url);
const repositoryRoot = new URL("../", import.meta.url);

const digest = "a".repeat(64);
const snapshotOutput = [
  `auth.identities|0|${digest}`,
  `auth.users|0|${digest}`,
  `public.invitations|1|${digest}`,
  `public.learning_items|0|${digest}`,
  `public.user_profiles|1|${digest}`,
  `public.word_entries|0|${digest}`,
  `storage.buckets|1|${digest}`,
  `storage.objects|0|${digest}`,
  `supabase_migrations.schema_migrations|2|${digest}`,
].join("\n");

async function restartModule() {
  return import(moduleUrl.href);
}

function successfulDependencies(overrides = {}) {
  return {
    arguments_: [],
    migrateRuntime: async () => true,
    snapshot: async () => snapshotOutput,
    startDev: async () => true,
    startRuntime: async () => true,
    stopDev: async () => true,
    stopRuntime: async () => true,
    verifyRuntime: async () => true,
    ...overrides,
  };
}

test("local persistence verification rejects every argument before any side effect", async () => {
  const { verifyRestartPersistence } = await restartModule();
  for (const arguments_ of [["unexpected"], ["--confirm-local-data-loss"], ["a", "b"]]) {
    let calls = 0;
    assert.equal(
      await verifyRestartPersistence(
        successfulDependencies({
          arguments_,
          verifyRuntime: async () => {
            calls += 1;
            return true;
          },
        }),
      ),
      "invalid-arguments",
    );
    assert.equal(calls, 0);
  }
});

test("local persistence verification runs the fixed non-destructive restart sequence", async () => {
  const { verifyRestartPersistence } = await restartModule();
  const events = [];
  let snapshotCall = 0;
  let verifyCall = 0;
  const record = (event) => {
    events.push(event);
    return true;
  };
  const result = await verifyRestartPersistence(
    successfulDependencies({
      migrateRuntime: async () => record("migrate"),
      snapshot: async () => {
        snapshotCall += 1;
        events.push(`snapshot:${snapshotCall}`);
        return snapshotOutput;
      },
      startDev: async () => record("dev:start"),
      startRuntime: async () => record("runtime:start"),
      stopDev: async () => record("dev:stop"),
      stopRuntime: async () => record("runtime:stop"),
      verifyRuntime: async () => {
        verifyCall += 1;
        events.push(`verify:${verifyCall}`);
        return true;
      },
    }),
  );

  assert.equal(result, "succeeded");
  assert.deepEqual(events, [
    "verify:1",
    "snapshot:1",
    "dev:stop",
    "runtime:stop",
    "runtime:start",
    "migrate",
    "verify:2",
    "snapshot:2",
    "dev:start",
  ]);
});

test("local persistence verification stops at every failed stage", async (context) => {
  const { verifyRestartPersistence } = await restartModule();
  const stages = [
    "verify:1",
    "snapshot:1",
    "dev:stop",
    "runtime:stop",
    "runtime:start",
    "migrate",
    "verify:2",
    "snapshot:2",
    "dev:start",
  ];

  for (const failedStage of stages) {
    await context.test(failedStage, async () => {
      const events = [];
      let snapshotCall = 0;
      let verifyCall = 0;
      const visit = (stage, success = true) => {
        events.push(stage);
        return stage === failedStage ? false : success;
      };
      const result = await verifyRestartPersistence(
        successfulDependencies({
          migrateRuntime: async () => visit("migrate"),
          snapshot: async () => {
            snapshotCall += 1;
            const stage = `snapshot:${snapshotCall}`;
            return visit(stage) ? snapshotOutput : null;
          },
          startDev: async () => visit("dev:start"),
          startRuntime: async () => visit("runtime:start"),
          stopDev: async () => visit("dev:stop"),
          stopRuntime: async () => visit("runtime:stop"),
          verifyRuntime: async () => {
            verifyCall += 1;
            return visit(`verify:${verifyCall}`);
          },
        }),
      );
      assert.equal(result, "failed");
      assert.equal(events.at(-1), failedStage);
    });
  }
});

test("local persistence verification keeps HTTPS stopped when the snapshots differ", async () => {
  const { verifyRestartPersistence } = await restartModule();
  let snapshotCall = 0;
  let startCalls = 0;
  const result = await verifyRestartPersistence(
    successfulDependencies({
      snapshot: async () => {
        snapshotCall += 1;
        return snapshotCall === 1 ? snapshotOutput : snapshotOutput.replace("|2|", "|3|");
      },
      startDev: async () => {
        startCalls += 1;
        return true;
      },
    }),
  );
  assert.equal(result, "mismatch");
  assert.equal(startCalls, 0);
});

test("persistence snapshot accepts only fixed relation, count, and digest records", async () => {
  const { parsePersistenceSnapshot } = await restartModule();
  assert.equal(parsePersistenceSnapshot(`${snapshotOutput}\n`), snapshotOutput);
  assert.equal(parsePersistenceSnapshot(snapshotOutput.replace(`|${digest}`, "|-1|bad")), null);
  assert.equal(
    parsePersistenceSnapshot(`${snapshotOutput}\npublic.user_profiles|1|${digest}`),
    null,
  );
  assert.equal(
    parsePersistenceSnapshot(snapshotOutput.replace(`storage.objects|0|${digest}\n`, "")),
    null,
  );
  assert.equal(parsePersistenceSnapshot(`public.user_profiles|1|${digest}\nsecret=value`), null);
});

test("persistence snapshot uses only fixed local Docker and server-side hashing", async () => {
  const { snapshotAcceptanceDatabase } = await restartModule();
  const calls = [];
  assert.equal(
    await snapshotAcceptanceDatabase({
      run: async (command, arguments_, options) => {
        calls.push({ arguments_, command, options });
        return { code: 0, stdout: snapshotOutput };
      },
    }),
    snapshotOutput,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "docker");
  assert.deepEqual(calls[0].arguments_.slice(0, 8), [
    "exec",
    "-i",
    "supabase_db_seen-and-said-local-acceptance",
    "psql",
    "-X",
    "-q",
    "-A",
    "-t",
  ]);
  assert.equal(calls[0].options.capture, true);
  const sql = calls[0].arguments_.at(-1);
  assert.match(sql, /pg_catalog\.pg_tables/u);
  assert.match(sql, /to_jsonb\(snapshot_row\)/u);
  assert.match(sql, /sha256/u);
  assert.match(sql, /auth.*users.*identities/su);
  assert.match(sql, /storage.*buckets.*objects/su);
  assert.match(sql, /supabase_migrations.*schema_migrations/su);
  assert.doesNotMatch(calls[0].arguments_.join(" "), /--db-url|--linked|--project-ref/u);
});

test("workspace exposes the fixed persistence command without broadening reset", async () => {
  const packageDocument = JSON.parse(
    await readFile(new URL("package.json", repositoryRoot), "utf8"),
  );
  assert.equal(
    packageDocument.scripts["acceptance:local:restart:verify"],
    "node scripts/acceptance-local-restart.mjs",
  );
  assert.equal(
    packageDocument.scripts["acceptance:local:reset"],
    "node scripts/acceptance-local-reset.mjs",
  );
});
