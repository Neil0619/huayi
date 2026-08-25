import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { stat } from "node:fs/promises";
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
    queueMicrotask(() => child.emit("exit", null, "SIGKILL"));
    return true;
  };

  const result = await runHostedPsql({
    captureErrorCode: true,
    captureOutput: true,
    databaseUrl: "postgresql://fictional.invalid/postgres?sslmode=verify-full",
    environment: {
      HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: caCertificate,
      PGPASSWORD: "fictional-password",
    },
    input: "SELECT true;\n",
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
