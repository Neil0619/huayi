import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { stat } from "node:fs/promises";
import test from "node:test";

import { runHostedMigration0022ApplyProcess } from "./acceptance-hosted-migration-0022-apply.mjs";
import { runHostedMigration0022DryRunProcess } from "./acceptance-hosted-migration-0022-dry-run.mjs";

const caCertificate =
  "-----BEGIN CERTIFICATE-----\n" + "a".repeat(64) + "\n-----END CERTIFICATE-----\n";
const secrets = {
  administratorPassword: "fictional-administrator-password",
  caCertificate,
};
const validDryRunOutput = `DRY RUN: migrations will *not* be pushed to the database.
Connecting to remote database...
Would push these migrations:
 • 20260828010000_password_signup_expired_invitation_recovery.sql
Finished supabase db push.
`;

function createChild({ piped = false, kill = () => true } = {}) {
  const child = new EventEmitter();
  child.kill = kill;
  if (piped) {
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdout.setEncoding = () => undefined;
    child.stderr.setEncoding = () => undefined;
  }
  return child;
}

async function waitForObservation(readObservation) {
  while (readObservation() === undefined) {
    await new Promise((resolveWait) => setImmediate(resolveWait));
  }
  return readObservation();
}

test("0022 dry-run pins bounded CLI output and removes the private CA", async () => {
  const child = createChild({ piped: true });
  let observed;
  const resultPromise = runHostedMigration0022DryRunProcess(secrets, {
    spawnProcess(command, arguments_, options) {
      observed = { arguments_, command, options };
      return child;
    },
  });
  const actual = await waitForObservation(() => observed);
  assert.match(actual.command, /[\\/]node_modules[\\/]\.bin[\\/]supabase$/u);
  assert.deepEqual(actual.arguments_, [
    "db",
    "push",
    "--dry-run",
    "--skip-vault",
    "--db-url",
    "postgresql://postgres.kpadiulxkgckskcfydry@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=verify-full",
  ]);
  assert.deepEqual(actual.options.stdio, ["ignore", "pipe", "pipe"]);
  assert.equal(actual.options.shell, false);
  assert.equal(actual.options.env.PGPASSWORD, secrets.administratorPassword);
  assert.equal(actual.options.env.PGSSLMODE, "verify-full");
  assert.equal(actual.options.env.SUPABASE_NO_UPDATE_NOTIFIER, "1");
  const caPath = actual.options.env.PGSSLROOTCERT;
  if (process.platform !== "win32") assert.equal((await stat(caPath)).mode & 0o777, 0o600);
  child.stderr.emit("data", validDryRunOutput);
  child.emit("close", 0, null);
  assert.deepEqual(await resultPromise, { code: 0, stderr: validDryRunOutput, stdout: "" });
  await assert.rejects(stat(caPath), { code: "ENOENT" });
});

test("0022 apply pins --yes, suppresses output, and removes the private CA", async () => {
  const child = createChild();
  let observed;
  const resultPromise = runHostedMigration0022ApplyProcess(secrets, {
    spawnProcess(command, arguments_, options) {
      observed = { arguments_, command, options };
      return child;
    },
  });
  const actual = await waitForObservation(() => observed);
  assert.match(actual.command, /[\\/]node_modules[\\/]\.bin[\\/]supabase$/u);
  assert.deepEqual(actual.arguments_, [
    "db",
    "push",
    "--yes",
    "--skip-vault",
    "--db-url",
    "postgresql://postgres.kpadiulxkgckskcfydry@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=verify-full",
  ]);
  assert.deepEqual(actual.options.stdio, ["ignore", "ignore", "ignore"]);
  assert.equal(actual.options.shell, false);
  assert.equal(actual.options.env.SUPABASE_NO_UPDATE_NOTIFIER, "1");
  const caPath = actual.options.env.PGSSLROOTCERT;
  if (process.platform !== "win32") assert.equal((await stat(caPath)).mode & 0o777, 0o600);
  child.emit("close", 0, null);
  assert.deepEqual(await resultPromise, { code: 0 });
  await assert.rejects(stat(caPath), { code: "ENOENT" });
});

test("0022 migration processes settle immediately after timeout even without child close", async () => {
  for (const killResult of [false, true]) {
    for (const { piped, runProcess } of [
      { piped: true, runProcess: runHostedMigration0022DryRunProcess },
      { piped: false, runProcess: runHostedMigration0022ApplyProcess },
    ]) {
      const child = createChild({ piped, kill: () => killResult });
      let observed;
      const resultPromise = runProcess(secrets, {
        spawnProcess(command, arguments_, options) {
          observed = { arguments_, command, options };
          return child;
        },
        timeoutMilliseconds: 1,
      });
      const actual = await waitForObservation(() => observed);
      const result = await Promise.race([
        resultPromise,
        new Promise((resolveWait) => setTimeout(() => resolveWait("still-running"), 50)),
      ]);
      if (result === "still-running") child.emit("close", null, "SIGKILL");
      await resultPromise;
      assert.notEqual(result, "still-running");
      assert.equal(result.code, null);
      await assert.rejects(stat(actual.options.env.PGSSLROOTCERT), { code: "ENOENT" });
    }
  }
});
