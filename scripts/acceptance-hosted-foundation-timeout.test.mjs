import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import { runHostedPsql } from "./acceptance-hosted-foundation.mjs";

const caCertificate =
  "-----BEGIN CERTIFICATE-----\n" + "a".repeat(64) + "\n-----END CERTIFICATE-----\n";

test("hosted psql optional process timeout kills the child and removes its private CA", async () => {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  let killed = false;
  let rootCertificate;
  child.kill = () => {
    killed = true;
    queueMicrotask(() => {
      child.emit("exit", null, "SIGKILL");
      child.emit("close", null, "SIGKILL");
    });
    return true;
  };

  const result = await runHostedPsql({
    captureErrorCode: true,
    captureOutput: true,
    databaseUrl: "postgresql://postgres@fictional.invalid/postgres?sslmode=verify-full",
    environment: {
      HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: caCertificate,
    },
    input: "SELECT true;\n",
    password: "fictional-password",
    spawnProcess: (_command, _arguments, options) => {
      rootCertificate = options.env.PGSSLROOTCERT;
      queueMicrotask(() => {
        child.stdout.write("private output");
        child.stderr.write("private error");
      });
      return child;
    },
    timeoutMilliseconds: 1,
  });

  assert.equal(killed, true);
  assert.deepEqual(result, { code: null, stderr: "", stdout: "" });
  await assert.rejects(stat(rootCertificate), { code: "ENOENT" });
});

test("hosted psql uses a private pgpass file and removes the whole credential channel", async () => {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  let passwordFile;
  let passwordFileMode;
  let passwordFileValue;
  let rootCertificate;
  let resolveExitObserved;
  const exitObserved = new Promise((resolve) => {
    resolveExitObserved = resolve;
  });

  const resultPromise = runHostedPsql({
    captureOutput: true,
    databaseUrl: "postgresql://user.name@database.example.test:6543/database?sslmode=verify-full",
    environment: { HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: caCertificate },
    input: "SELECT true;\n",
    password: String.raw`fictional:password\value`,
    spawnProcess: (_command, _arguments, options) => {
      passwordFile = options.env.PGPASSFILE;
      rootCertificate = options.env.PGSSLROOTCERT;
      assert.equal(options.env.PGPASSWORD, undefined);
      Promise.all([readFile(passwordFile, "utf8"), stat(passwordFile)]).then(
        ([value, metadata]) => {
          passwordFileValue = value;
          passwordFileMode = metadata.mode & 0o777;
          child.stdout.write("t");
          child.emit("exit", 0, null);
          resolveExitObserved();
        },
      );
      return child;
    },
  });
  let resultSettled = false;
  void resultPromise.then(() => {
    resultSettled = true;
  });

  await exitObserved;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resultSettled, false);
  await Promise.all([stat(passwordFile), stat(rootCertificate)]);

  child.stdout.end("\n");
  child.emit("close", 0, null);
  const result = await resultPromise;

  assert.deepEqual(result, { code: 0, stderr: "", stdout: "t\n" });
  assert.equal(
    passwordFileValue,
    String.raw`database.example.test:6543:database:user.name:fictional\:password\\value` + "\n",
  );
  assert.equal(passwordFileMode, 0o600);
  await assert.rejects(stat(passwordFile), { code: "ENOENT" });
  await assert.rejects(stat(rootCertificate), { code: "ENOENT" });
});

test("hosted psql removes its private channel before re-raising termination signals", async () => {
  for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let childClosed = false;
    let childKillSignal;
    child.kill = (killSignal) => {
      childKillSignal = killSignal;
      queueMicrotask(() => {
        child.emit("exit", null, killSignal);
        childClosed = true;
        child.emit("close", null, killSignal);
      });
      return true;
    };
    const process_ = new EventEmitter();
    process_.pid = 41_000;
    let passwordFile;
    let rootCertificate;
    let reRaised;
    process_.kill = (pid, reRaisedSignal) => {
      assert.equal(childClosed, true);
      reRaised = { pid, signal: reRaisedSignal };
      return true;
    };

    const resultPromise = runHostedPsql({
      captureOutput: false,
      databaseUrl: "postgresql://postgres@fictional.invalid/postgres?sslmode=verify-full",
      environment: { HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: caCertificate },
      input: "SELECT true;\n",
      password: "fictional-password",
      process_,
      spawnProcess: (_command, _arguments, options) => {
        passwordFile = options.env.PGPASSFILE;
        rootCertificate = options.env.PGSSLROOTCERT;
        queueMicrotask(() => process_.emit(signal));
        return child;
      },
    });

    assert.deepEqual(await resultPromise, { code: null, stderr: "", stdout: "" });
    assert.equal(childKillSignal, "SIGKILL");
    assert.deepEqual(reRaised, { pid: 41_000, signal });
    await Promise.all([
      assert.rejects(stat(passwordFile), { code: "ENOENT" }),
      assert.rejects(stat(rootCertificate), { code: "ENOENT" }),
      assert.rejects(stat(dirname(passwordFile)), { code: "ENOENT" }),
    ]);
    for (const registeredSignal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
      assert.equal(process_.listenerCount(registeredSignal), 0);
    }
  }
});
