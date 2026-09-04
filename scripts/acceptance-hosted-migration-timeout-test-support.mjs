import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

export function registerMigrationTimeoutTests({ label, runApply, runDryRun, secrets }) {
  for (const cleanupDelayMs of [0, 100]) {
    for (const killResult of [false, true]) {
      for (const { mode, piped, runProcess } of [
        { mode: "dry-run", piped: true, runProcess: runDryRun },
        { mode: "apply", piped: false, runProcess: runApply },
      ]) {
        test(
          `${label} ${mode} timeout settles without close: kill=${killResult}, cleanup=${cleanupDelayMs}ms`,
          { timeout: 5_000 },
          async (context) => {
            const child = new EventEmitter();
            const killSignals = [];
            let closeObserved = false;
            let completed = false;
            let observed;
            child.once("close", () => {
              closeObserved = true;
            });
            child.kill = (signal) => {
              killSignals.push(signal);
              return killResult;
            };
            if (piped) {
              child.stdout = new EventEmitter();
              child.stderr = new EventEmitter();
              child.stdout.setEncoding = () => undefined;
              child.stderr.setEncoding = () => undefined;
            }
            const resultPromise = runProcess(secrets, {
              certificateIo: {
                chmod,
                mkdtemp,
                writeFile,
                async rm(...arguments_) {
                  if (cleanupDelayMs > 0) await delay(cleanupDelayMs);
                  await rm(...arguments_);
                },
              },
              spawnProcess(_command, _arguments, options) {
                observed = options;
                if (piped) {
                  queueMicrotask(() => {
                    child.stdout.emit("data", "fictional output before timeout");
                    child.stderr.emit("data", "fictional error before timeout");
                  });
                }
                return child;
              },
              timeoutMilliseconds: 1,
            });
            context.after(async () => {
              // Rescue a timed-out regression only after its watchdog has failed the test.
              if (!completed) child.emit("close", null, "SIGKILL");
              await resultPromise.catch(() => undefined);
            });

            // The public promise includes real credential cleanup, not just the child timeout.
            const result = await resultPromise;
            completed = true;
            assert.equal(closeObserved, false);
            assert.deepEqual(killSignals, ["SIGKILL"]);
            assert.deepEqual(
              result,
              piped ? { code: null, stderr: "", stdout: "" } : { code: null },
            );
            assert.ok(observed);
            await assert.rejects(stat(observed.env.PGSSLROOTCERT), { code: "ENOENT" });
            await assert.rejects(stat(observed.env.PGPASSFILE), { code: "ENOENT" });
            await assert.rejects(stat(dirname(observed.env.PGPASSFILE)), { code: "ENOENT" });
          },
        );
      }
    }
  }
}
