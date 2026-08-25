import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { lstat, readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertHostedRestoreDrillSecretEnvironment,
  cleanupHostedRestoreDrillTarget,
  readHostedRestoreDrillSecrets,
  runHostedRestoreDrillProcess,
  withHostedRestoreDrillDatabaseChannel,
} from "./acceptance-hosted-restore-drill-process.mjs";

function fakeChild({ stdout = "stage passed\n" } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => undefined;
  child.kill = () => {
    child.killed = true;
  };
  queueMicrotask(() => {
    if (stdout !== undefined) child.stdout.emit("data", stdout);
    child.emit("close", 0, null);
  });
  return child;
}

test("restore secrets reject inherited secret environment before any TTY read", async () => {
  let reads = 0;
  let fetches = 0;
  await assert.rejects(
    readHostedRestoreDrillSecrets({
      environment: { PGPASSWORD: "inherited" },
      fetchCaCertificate: async () => {
        fetches += 1;
        return "ca";
      },
      readHiddenLine: async () => {
        reads += 1;
        return "secret";
      },
    }),
  );
  assert.equal(reads, 0);
  assert.equal(fetches, 0);
  assert.throws(() =>
    assertHostedRestoreDrillSecretEnvironment({ SUPABASE_ACCESS_TOKEN: "inherited" }),
  );
});

test("restore secrets fetch the strict official CA before three fixed hidden prompts", async () => {
  const events = [];
  const result = await readHostedRestoreDrillSecrets({
    environment: {},
    fetchCaCertificate: async () => {
      events.push("ca");
      return "strict-official-ca";
    },
    readHiddenLine: async (prompt) => {
      events.push(prompt);
      return `${events.length}-secret`;
    },
  });
  assert.deepEqual(events, [
    "ca",
    "Source archive administrator database password: ",
    "Recovery project administrator database password: ",
    "Supabase recovery management token: ",
  ]);
  assert.equal(result.caCertificate, "strict-official-ca");
});

test("restore child uses arrays, bounded output, closed child and only a single scoped token", async () => {
  const calls = [];
  const command = "/Applications/OrbStack.app/Contents/MacOS/xbin/docker";
  const result = await runHostedRestoreDrillProcess(command, ["projects", "delete"], {
    managementToken: "management-secret",
    secretValues: ["management-secret"],
    spawnProcess: (command, arguments_, options) => {
      calls.push({ arguments_, command, options });
      return fakeChild();
    },
  });
  assert.deepEqual(result, { code: 0, stdout: "stage passed\n" });
  assert.equal(calls[0].options.shell, false);
  assert.deepEqual(calls[0].options.env, {
    LANG: "C",
    LC_ALL: "C",
    SUPABASE_ACCESS_TOKEN: "management-secret",
  });
  assert.equal(JSON.stringify(calls[0].arguments_).includes("management-secret"), false);

  assert.throws(() =>
    runHostedRestoreDrillProcess(command, ["--password", "database-secret"], {
      secretValues: ["database-secret"],
      spawnProcess: () => fakeChild(),
    }),
  );
  await assert.rejects(
    runHostedRestoreDrillProcess(command, [], {
      extraEnvironment: { PGPASSWORD: "database-secret" },
      secretValues: ["database-secret"],
      spawnProcess: () => fakeChild(),
    }),
  );
});

test("restore child waits for close after overflow termination and discards output", async () => {
  const events = [];
  const command = "/Applications/OrbStack.app/Contents/MacOS/xbin/docker";
  const result = await runHostedRestoreDrillProcess(command, ["restore"], {
    maxOutputBytes: 4,
    spawnProcess: () => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stdout.setEncoding = () => undefined;
      child.kill = () => {
        events.push("kill");
        queueMicrotask(() => {
          events.push("close");
          child.emit("close", null, "SIGKILL");
        });
      };
      queueMicrotask(() => child.stdout.emit("data", "overflow"));
      return child;
    },
  });
  events.push("resolved");
  assert.deepEqual(result, { code: null, stdout: "" });
  assert.deepEqual(events, ["kill", "close", "resolved"]);
});

test("restore database channel creates private pgpass and CA then removes both", async () => {
  let directory;
  await withHostedRestoreDrillDatabaseChannel({
    caCertificate: "-----BEGIN CERTIFICATE-----\nZmFrZQ==\n-----END CERTIFICATE-----\n",
    connection: {
      database: "postgres",
      host: "fixed.pooler.example",
      port: "5432",
      user: "postgres.fixed",
    },
    password: "database-secret",
    run: async (channel) => {
      directory = channel.directory;
      if (process.platform !== "win32") {
        assert.equal((await lstat(channel.directory)).mode & 0o777, 0o700);
        assert.equal((await lstat(channel.pgpassPath)).mode & 0o777, 0o600);
        assert.equal((await lstat(channel.caPath)).mode & 0o777, 0o600);
      }
      assert.match(await readFile(channel.pgpassPath, "utf8"), /database-secret/u);
      assert.equal(JSON.stringify(channel).includes("database-secret"), false);
    },
  });
  await assert.rejects(lstat(directory), { code: "ENOENT" });
});

test("cleanup never deletes or revokes an unknown target identity", async () => {
  const events = [];
  await assert.rejects(
    cleanupHostedRestoreDrillTarget({
      deleteTarget: async () => events.push("delete"),
      expectedIdentityDigest: "a".repeat(64),
      observedIdentityDigest: "b".repeat(64),
      removeTemporaryArtifacts: async () => events.push("temp"),
      revokeCredentials: async () => events.push("revoke"),
      verifyTargetAbsent: async () => events.push("absent"),
    }),
  );
  assert.deepEqual(events, ["temp"]);
});
