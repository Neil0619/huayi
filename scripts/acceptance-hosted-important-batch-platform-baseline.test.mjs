import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  hostedImportantBatchAuthBaselineContainer,
  hostedImportantBatchAuthRuntimeReference,
  hostedImportantBatchStorageBaselineContainer,
  hostedImportantBatchStorageRuntimeReference,
  migrateHostedImportantBatchPlatformBaseline,
} from "./acceptance-hosted-important-batch-platform-baseline.mjs";
import { hostedImportantBatchScratchContainer } from "./acceptance-hosted-important-batch-execution-contract.mjs";

const dockerTarget = {
  command: "/Applications/OrbStack.app/Contents/MacOS/xbin/docker",
  host: "unix:///Users/fixed/.orbstack/run/docker.sock",
};
const authEnvironment = [
  "GOTRUE_DB_DRIVER=postgres",
  "GOTRUE_DB_DATABASE_URL=postgresql://supabase_auth_admin@127.0.0.1:5432/postgres?sslmode=disable",
  "API_EXTERNAL_URL=http://127.0.0.1/auth/v1",
  "GOTRUE_SITE_URL=http://127.0.0.1",
  "GOTRUE_JWT_SECRET=local-only-fictional-jwt-secret-32-chars",
  "GOTRUE_JWT_EXP=3600",
];

function absent() {
  return { code: 1, stdout: "[]\n" };
}

function runnerInspection({ command, entrypoint = null, environment = [], image, label }) {
  return JSON.stringify({
    Config: {
      Cmd: command,
      Entrypoint: entrypoint,
      Env: environment,
      Image: image,
      Labels: { "com.seen-said.acceptance": label },
    },
    HostConfig: {
      Binds: null,
      NetworkMode: `container:${hostedImportantBatchScratchContainer}`,
    },
    Mounts: [],
  });
}

test("platform baseline runners match the pinned enabled service image lock", async () => {
  const lock = JSON.parse(
    await readFile(new URL("../supabase/platform-images.lock.json", import.meta.url), "utf8"),
  );
  const reference = (service) => {
    const entry = lock.services.find((candidate) => candidate.service === service);
    return `${entry.image.repository}@${entry.image.tagDigest}`;
  };

  assert.equal(hostedImportantBatchAuthRuntimeReference, reference("gotrue"));
  assert.equal(hostedImportantBatchStorageRuntimeReference, reference("storage"));
});

test("platform baseline runs only fixed migration commands inside the networkless scratch namespace", async () => {
  const inspections = new Map();
  const runs = [];
  const stages = [];
  await migrateHostedImportantBatchPlatformBaseline({
    dockerTarget,
    onStage: (stage) => stages.push(stage),
    runProcess: async (command, arguments_) => {
      assert.equal(command, dockerTarget.command);
      assert.deepEqual(arguments_.slice(0, 2), ["--host", dockerTarget.host]);
      if (arguments_[2] === "container" && arguments_[3] === "inspect") {
        const name = arguments_.at(-1);
        inspections.set(name, (inspections.get(name) ?? 0) + 1);
        return absent();
      }
      if (arguments_[2] === "run") {
        runs.push(arguments_);
        return { code: 0, stdout: "" };
      }
      return { code: 1, stdout: "" };
    },
    wait: async () => undefined,
  });

  assert.deepEqual(stages, ["auth-baseline", "storage-baseline"]);
  assert.equal(runs.length, 2);
  for (const arguments_ of runs) {
    assert.deepEqual(arguments_.slice(2, 7), ["run", "--rm", "--pull", "never", "--name"]);
    assert.ok(arguments_.includes("--network"));
    assert.ok(arguments_.includes(`container:${hostedImportantBatchScratchContainer}`));
    for (const forbidden of ["--publish", "-p", "--volume", "-v", "--mount"]) {
      assert.equal(arguments_.includes(forbidden), false);
    }
    assert.equal(
      arguments_.some((value) => /PGPASSWORD|PGPASSFILE/u.test(value)),
      false,
    );
  }
  assert.ok(runs[0].includes(hostedImportantBatchAuthBaselineContainer));
  assert.deepEqual(
    runs[0].filter((value, index) => runs[0][index - 1] === "--env"),
    [
      "GOTRUE_DB_DRIVER=postgres",
      "GOTRUE_DB_DATABASE_URL=postgresql://supabase_auth_admin@127.0.0.1:5432/postgres?sslmode=disable",
      "API_EXTERNAL_URL=http://127.0.0.1/auth/v1",
      "GOTRUE_SITE_URL=http://127.0.0.1",
      "GOTRUE_JWT_SECRET=local-only-fictional-jwt-secret-32-chars",
      "GOTRUE_JWT_EXP=3600",
    ],
  );
  assert.deepEqual(runs[0].slice(-3), [
    hostedImportantBatchAuthRuntimeReference,
    "auth",
    "migrate",
  ]);
  assert.ok(runs[1].includes(hostedImportantBatchStorageBaselineContainer));
  assert.deepEqual(
    runs[1].filter((value, index) => runs[1][index - 1] === "--env"),
    [
      "DATABASE_URL=postgresql://supabase_storage_admin@127.0.0.1:5432/postgres?sslmode=disable",
      "PGRST_JWT_SECRET=local-only-fictional-jwt-secret-32-chars",
    ],
  );
  assert.deepEqual(runs[1].slice(-2), [
    hostedImportantBatchStorageRuntimeReference,
    "/app/dist/scripts/migrate-call.js",
  ]);
  assert.deepEqual(
    [...inspections.entries()].sort(([left], [right]) => left.localeCompare(right)),
    [
      [hostedImportantBatchAuthBaselineContainer, 2],
      [hostedImportantBatchStorageBaselineContainer, 2],
    ],
  );
});

test("platform baseline removes only an exact timed-out runner and never starts the next runner", async () => {
  let runnerCreated = false;
  let runnerRemoved = false;
  let storageStarted = false;
  const stages = [];
  await assert.rejects(
    migrateHostedImportantBatchPlatformBaseline({
      dockerTarget,
      onStage: (stage) => stages.push(stage),
      runProcess: async (_command, arguments_) => {
        if (arguments_[2] === "container" && arguments_[3] === "inspect") {
          const name = arguments_.at(-1);
          if (
            name !== hostedImportantBatchAuthBaselineContainer ||
            !runnerCreated ||
            runnerRemoved
          ) {
            return absent();
          }
          return {
            code: 0,
            stdout: runnerInspection({
              command: ["auth", "migrate"],
              environment: authEnvironment,
              image: hostedImportantBatchAuthRuntimeReference,
              label: "phase-81-0014-auth-baseline",
            }),
          };
        }
        if (arguments_[2] === "run") {
          if (arguments_.includes(hostedImportantBatchStorageRuntimeReference)) {
            storageStarted = true;
          }
          runnerCreated = true;
          return { code: null, stdout: "" };
        }
        if (arguments_[2] === "rm") {
          runnerRemoved = true;
          return { code: 0, stdout: `${hostedImportantBatchAuthBaselineContainer}\n` };
        }
        return { code: 1, stdout: "" };
      },
      wait: async () => undefined,
    }),
  );

  assert.equal(runnerRemoved, true);
  assert.equal(storageStarted, false);
  assert.deepEqual(stages, ["auth-baseline"]);
});

test("platform baseline refuses an unknown same-name runner without removing it", async () => {
  let removals = 0;
  await assert.rejects(
    migrateHostedImportantBatchPlatformBaseline({
      dockerTarget,
      runProcess: async (_command, arguments_) => {
        if (arguments_[2] === "container" && arguments_[3] === "inspect") {
          return {
            code: 0,
            stdout: runnerInspection({
              command: ["untrusted"],
              image: "docker.io/untrusted/image@sha256:fictional",
              label: "untrusted",
            }),
          };
        }
        if (arguments_[2] === "rm") removals += 1;
        return { code: 1, stdout: "" };
      },
      wait: async () => undefined,
    }),
  );

  assert.equal(removals, 0);
});

test("platform baseline never removes a same-name runner with an inexact entrypoint", async () => {
  let runnerCreated = false;
  let removals = 0;
  await assert.rejects(
    migrateHostedImportantBatchPlatformBaseline({
      dockerTarget,
      runProcess: async (_command, arguments_) => {
        if (arguments_[2] === "container" && arguments_[3] === "inspect") {
          if (!runnerCreated) return absent();
          return {
            code: 0,
            stdout: runnerInspection({
              command: ["auth", "migrate"],
              entrypoint: ["untrusted-entrypoint"],
              environment: authEnvironment,
              image: hostedImportantBatchAuthRuntimeReference,
              label: "phase-81-0014-auth-baseline",
            }),
          };
        }
        if (arguments_[2] === "run") {
          runnerCreated = true;
          return { code: null, stdout: "" };
        }
        if (arguments_[2] === "rm") removals += 1;
        return { code: 1, stdout: "" };
      },
      wait: async () => undefined,
    }),
  );

  assert.equal(removals, 0);
});

test("platform baseline never removes a same-name runner missing a fixed environment value", async () => {
  let runnerCreated = false;
  let removals = 0;
  await assert.rejects(
    migrateHostedImportantBatchPlatformBaseline({
      dockerTarget,
      runProcess: async (_command, arguments_) => {
        if (arguments_[2] === "container" && arguments_[3] === "inspect") {
          if (!runnerCreated) return absent();
          return {
            code: 0,
            stdout: runnerInspection({
              command: ["auth", "migrate"],
              environment: authEnvironment.slice(1),
              image: hostedImportantBatchAuthRuntimeReference,
              label: "phase-81-0014-auth-baseline",
            }),
          };
        }
        if (arguments_[2] === "run") {
          runnerCreated = true;
          return { code: null, stdout: "" };
        }
        if (arguments_[2] === "rm") removals += 1;
        return { code: 1, stdout: "" };
      },
      wait: async () => undefined,
    }),
  );

  assert.equal(removals, 0);
});
