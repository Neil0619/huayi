import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile, stat } from "node:fs/promises";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  hostedMigration0014DryRunArgument,
  runHostedMigration0014DryRunCli,
  runHostedMigration0014DryRunProcess,
} from "./acceptance-hosted-migration-0014-dry-run.mjs";
import { fetchHostedAcceptanceOfficialCaCertificate } from "./acceptance-hosted-official-ca.mjs";

const officialCaUrl =
  "https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt";
const caCertificate =
  "-----BEGIN CERTIFICATE-----\n" + "a".repeat(64) + "\n-----END CERTIFICATE-----\n";
const validOutput = `DRY RUN: migrations will *not* be pushed to the database.
Connecting to remote database...
Would push these migrations:
 • 20260824010000_password_signup_otp_resend.sql
Finished supabase db push.
`;

function createCaFetchResponse(chunks, { status = 200, url = officialCaUrl } = {}) {
  let index = 0;
  return {
    body: {
      getReader() {
        return {
          async cancel() {
            return undefined;
          },
          async read() {
            if (index >= chunks.length) return { done: true, value: undefined };
            const value = chunks[index];
            index += 1;
            return { done: false, value };
          },
          releaseLock() {
            return undefined;
          },
        };
      },
    },
    ok: status >= 200 && status < 300,
    status,
    url,
  };
}

function createChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.kill = () => true;
  return child;
}

test("hosted commands fetch only the fixed official CA without redirect", async () => {
  let observed;
  const certificate = await fetchHostedAcceptanceOfficialCaCertificate({
    fetchImplementation: async (url, options) => {
      observed = { options, url };
      return createCaFetchResponse([Buffer.from(caCertificate)]);
    },
  });

  assert.equal(certificate, caCertificate);
  assert.equal(observed.url, officialCaUrl);
  assert.equal(observed.options.method, "GET");
  assert.equal(observed.options.redirect, "error");
  assert.equal(observed.options.cache, "no-store");
  assert.equal(observed.options.credentials, "omit");
  assert.equal(observed.options.referrerPolicy, "no-referrer");
  assert.equal(observed.options.signal instanceof AbortSignal, true);
});

test("hosted official CA fetch rejects response, redirect, bytes, UTF-8, PEM, or timeout drift", async () => {
  const cases = [
    { fetchImplementation: async () => createCaFetchResponse([], { status: 500 }) },
    {
      fetchImplementation: async () =>
        createCaFetchResponse([Buffer.from(caCertificate)], {
          url: "https://redirected.example.test/prod-ca-2021.crt",
        }),
    },
    {
      fetchImplementation: async () => ({ body: null, ok: true, status: 200, url: officialCaUrl }),
    },
    {
      fetchImplementation: async () => createCaFetchResponse([Buffer.alloc(65, 0x61)]),
      maxOutputBytes: 64,
    },
    { fetchImplementation: async () => createCaFetchResponse([Buffer.from([0xff])]) },
    {
      fetchImplementation: async () => createCaFetchResponse([Buffer.from("not-a-certificate\n")]),
    },
    {
      fetchImplementation: async (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("fictional timeout detail")), {
            once: true,
          });
        }),
      timeoutMilliseconds: 1,
    },
    {
      fetchImplementation: async () => ({
        body: {
          getReader: () => ({
            async cancel() {
              throw new Error("private cancel detail");
            },
            async read() {
              throw new Error("private read detail");
            },
            releaseLock() {
              throw new Error("private release detail");
            },
          }),
        },
        ok: true,
        status: 200,
        url: officialCaUrl,
      }),
    },
  ];

  for (const testCase of cases) {
    await assert.rejects(fetchHostedAcceptanceOfficialCaCertificate(testCase), {
      message: "Hosted acceptance official CA download failed.",
    });
  }
});

test("0014 dry-run process pins verify-full to a private temporary CA and removes it", async () => {
  const child = createChild();
  let observed;
  const resultPromise = runHostedMigration0014DryRunProcess(
    { administratorPassword: "fictional-secret", caCertificate },
    {
      spawnProcess(command, arguments_, options) {
        observed = { arguments_, command, options };
        return child;
      },
    },
  );

  while (observed === undefined) {
    await new Promise((resolveWait) => setImmediate(resolveWait));
  }
  assert.match(observed.command, /\/node_modules\/\.bin\/supabase$/u);
  assert.deepEqual(observed.arguments_, [
    "db",
    "push",
    "--dry-run",
    "--skip-vault",
    "--db-url",
    "postgresql://postgres.kpadiulxkgckskcfydry@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=verify-full",
  ]);
  assert.deepEqual(Object.keys(observed.options.env).sort(), [
    "LANG",
    "LC_ALL",
    "PGPASSWORD",
    "PGSSLMODE",
    "PGSSLROOTCERT",
  ]);
  assert.equal(observed.options.env.PGPASSWORD, "fictional-secret");
  assert.equal(observed.options.env.PGSSLMODE, "verify-full");
  assert.match(observed.options.env.PGSSLROOTCERT, /\/huayi-hosted-0014-ca-[^/]+\/root\.crt$/u);
  assert.equal(observed.options.shell, false);
  assert.deepEqual(observed.options.stdio, ["ignore", "pipe", "ignore"]);
  const certificateStats = await stat(observed.options.env.PGSSLROOTCERT);
  assert.equal(certificateStats.mode & 0o777, 0o600);
  assert.equal(await readFile(observed.options.env.PGSSLROOTCERT, "utf8"), caCertificate);

  child.stdout.end(validOutput);
  child.emit("close", 0, null);
  assert.deepEqual(await resultPromise, { code: 0, stdout: validOutput });
  await assert.rejects(stat(observed.options.env.PGSSLROOTCERT), { code: "ENOENT" });
  assert.equal(JSON.stringify(observed.arguments_).includes("fictional-secret"), false);
});

test("0014 dry-run process suppresses overflow and waits for a timed-out child to close", async () => {
  const overflowChild = createChild();
  let overflowSpawned = false;
  const overflowPromise = runHostedMigration0014DryRunProcess(
    { administratorPassword: "fictional-secret", caCertificate },
    {
      maxOutputBytes: 8,
      spawnProcess: () => {
        overflowSpawned = true;
        return overflowChild;
      },
    },
  );
  while (!overflowSpawned) {
    await new Promise((resolveWait) => setImmediate(resolveWait));
  }
  overflowChild.stdout.write("123456789");
  overflowChild.emit("close", null, "SIGKILL");
  assert.deepEqual(await overflowPromise, { code: null, stdout: "" });

  const timeoutChild = createChild();
  let killed = false;
  timeoutChild.kill = () => {
    killed = true;
    return true;
  };
  let resolved = false;
  let timeoutSpawned = false;
  const timeoutPromise = runHostedMigration0014DryRunProcess(
    { administratorPassword: "fictional-secret", caCertificate },
    {
      spawnProcess: () => {
        timeoutSpawned = true;
        return timeoutChild;
      },
      timeoutMilliseconds: 1,
    },
  ).then((result) => {
    resolved = true;
    return result;
  });
  while (!timeoutSpawned) {
    await new Promise((resolveWait) => setImmediate(resolveWait));
  }
  await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  assert.equal(killed, true);
  assert.equal(resolved, false);
  timeoutChild.emit("close", null, "SIGKILL");
  assert.deepEqual(await timeoutPromise, { code: null, stdout: "" });
});

test("0014 dry-run CLI fixes every CA temp and spawn failure to one closed result", async () => {
  const cases = ["mkdtemp", "writeFile", "spawn", "rm"];
  for (const failureStage of cases) {
    const events = [];
    const certificateIo = {
      async mkdtemp() {
        events.push("mkdtemp");
        if (failureStage === "mkdtemp") throw new Error("private mkdtemp detail");
        return "/virtual/huayi-hosted-0014-ca-test";
      },
      async rm() {
        events.push("rm");
        if (failureStage === "rm") throw new Error("private rm detail");
      },
      async writeFile() {
        events.push("writeFile");
        if (failureStage === "writeFile") throw new Error("private write detail");
      },
    };
    let processRuns = 0;
    let stderr = "";
    const code = await runHostedMigration0014DryRunCli({
      arguments_: [hostedMigration0014DryRunArgument],
      environment: {},
      fetchCaCertificate: async () => caCertificate,
      readPassword: async () => "fictional-secret",
      runSupabase: async (secrets) => {
        processRuns += 1;
        const child = createChild();
        return runHostedMigration0014DryRunProcess(secrets, {
          certificateIo,
          spawnProcess: () => {
            events.push("spawn");
            if (failureStage === "spawn") throw new Error("private spawn detail");
            queueMicrotask(() => {
              child.stdout.end(validOutput);
              child.emit("close", 0, null);
            });
            return child;
          },
        });
      },
      writeError: (value) => {
        stderr += value;
      },
      writeOutput: () => assert.fail("must not write stdout"),
    });

    assert.equal(code, 1);
    assert.equal(processRuns, 1);
    assert.equal(
      stderr,
      "Hosted 0014 migration dry-run failed closed; database was not modified.\n",
    );
    assert.equal(stderr.includes("private"), false);
    assert.equal(events[0], "mkdtemp");
    if (failureStage !== "mkdtemp") assert.equal(events.at(-1), "rm");
  }
});
