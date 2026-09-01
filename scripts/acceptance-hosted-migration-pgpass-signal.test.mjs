import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import { runHostedDeepseekMigrationApplyProcess } from "./acceptance-hosted-deepseek-migration-apply.mjs";
import { runHostedDeepseekMigrationDryRunProcess } from "./acceptance-hosted-deepseek-migration-dry-run.mjs";
import { runHostedMigration0014ApplyProcess } from "./acceptance-hosted-migration-0014-apply.mjs";
import { runHostedMigration0014DryRunProcess } from "./acceptance-hosted-migration-0014-dry-run.mjs";
import { runHostedMigration0015ApplyProcess } from "./acceptance-hosted-migration-0015-apply.mjs";
import { runHostedMigration0015DryRunProcess } from "./acceptance-hosted-migration-0015-dry-run.mjs";
import { runHostedMigration0022ApplyProcess } from "./acceptance-hosted-migration-0022-apply.mjs";
import { runHostedMigration0022DryRunProcess } from "./acceptance-hosted-migration-0022-dry-run.mjs";

const caCertificate =
  "-----BEGIN CERTIFICATE-----\n" + "a".repeat(64) + "\n-----END CERTIFICATE-----\n";
const secrets = Object.freeze({
  administratorPassword: "fictional-administrator-password",
  caCertificate,
});

const runners = Object.freeze([
  ["0014 apply", runHostedMigration0014ApplyProcess],
  ["0014 dry-run", runHostedMigration0014DryRunProcess],
  ["0015 apply", runHostedMigration0015ApplyProcess],
  ["0015 dry-run", runHostedMigration0015DryRunProcess],
  ["DeepSeek apply", runHostedDeepseekMigrationApplyProcess],
  ["DeepSeek dry-run", runHostedDeepseekMigrationDryRunProcess],
  ["0022 apply", runHostedMigration0022ApplyProcess],
  ["0022 dry-run", runHostedMigration0022DryRunProcess],
]);

for (const [name, runProcess] of runners) {
  for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
    test(`${name} removes its pgpass channel before re-raising ${signal}`, async () => {
      const child = new EventEmitter();
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      let childClosed = false;
      let childKillSignal;
      child.kill = (killSignal) => {
        childKillSignal = killSignal;
        queueMicrotask(() => {
          childClosed = true;
          child.emit("close", null, killSignal);
        });
        return true;
      };
      const process_ = new EventEmitter();
      process_.pid = 42_000;
      let passwordFile;
      let rootCertificate;
      let reRaised;
      process_.kill = (pid, reRaisedSignal) => {
        assert.equal(childClosed, true);
        assert.equal(existsSync(passwordFile), false);
        assert.equal(existsSync(rootCertificate), false);
        assert.equal(existsSync(dirname(passwordFile)), false);
        reRaised = { pid, signal: reRaisedSignal };
        return true;
      };

      const result = await runProcess(secrets, {
        process_,
        spawnProcess: (_command, _arguments, options) => {
          passwordFile = options.env.PGPASSFILE;
          rootCertificate = options.env.PGSSLROOTCERT;
          assert.equal(options.env.PGPASSWORD, undefined);
          queueMicrotask(() => process_.emit(signal));
          return child;
        },
        timeoutMilliseconds: 1_000,
      });

      assert.equal(result.code, null);
      assert.equal(childKillSignal, "SIGKILL");
      assert.deepEqual(reRaised, { pid: 42_000, signal });
      for (const registeredSignal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
        assert.equal(process_.listenerCount(registeredSignal), 0);
      }
    });
  }
}
