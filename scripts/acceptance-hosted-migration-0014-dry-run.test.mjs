import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  hostedMigration0014DryRunArgument,
  hostedMigration0014Filename,
  hostedMigration0014SuccessMessage,
  parseHostedMigration0014DryRunOutput,
  runHostedMigration0014DryRunCli,
} from "./acceptance-hosted-migration-0014-dry-run.mjs";

const validOutput = `DRY RUN: migrations will *not* be pushed to the database.
Connecting to remote database...
Would push these migrations:
 • 20260824010000_password_signup_otp_resend.sql
Finished supabase db push.
`;
const caCertificate =
  "-----BEGIN CERTIFICATE-----\n" + "a".repeat(64) + "\n-----END CERTIFICATE-----\n";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("package exposes only the exact pinned 0014 dry-run entrypoint", async () => {
  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:migration:0014:dry-run"],
    "node scripts/acceptance-hosted-migration-0014-dry-run.mjs --confirm-dry-run-20260824010000-password-signup-otp-resend-kpadiulxkgckskcfydry",
  );
  const implementation = await readFile(
    new URL("./acceptance-hosted-migration-0014-dry-run.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(implementation, /PGPASSFILE/u);
  assert.match(implementation, /writeFile\(rootCertificate, certificate/u);
  assert.match(implementation, /fetchHostedAcceptanceOfficialCaCertificate/u);
});

test("0014 dry-run parser accepts only the exact non-mutating single migration transcript", () => {
  assert.equal(parseHostedMigration0014DryRunOutput(validOutput), true);
  assert.equal(parseHostedMigration0014DryRunOutput(validOutput.replace(" • ", "• ")), true);

  for (const output of [
    validOutput.replace(" • ", " • 20260823010000_old.sql\n • "),
    validOutput.replace(` • ${hostedMigration0014Filename}\n`, ""),
    validOutput.replace("DRY RUN: migrations will *not* be pushed", "Applying migration"),
    validOutput.replace("Finished supabase db push.\n", ""),
    `${validOutput}unexpected private text\n`,
    validOutput.replace(" • ", "  • "),
  ]) {
    assert.equal(parseHostedMigration0014DryRunOutput(output), false);
  }
});

test("0014 dry-run CLI rejects inherited password variables and invalid confirmation before TTY input", async () => {
  for (const testCase of [
    {
      arguments_: [hostedMigration0014DryRunArgument],
      environment: {
        PGPASSWORD: "secret",
      },
    },
    {
      arguments_: [hostedMigration0014DryRunArgument],
      environment: {
        SUPABASE_DB_PASSWORD: "secret",
      },
    },
    {
      arguments_: ["--confirm-wrong-project"],
      environment: {},
    },
    { arguments_: [], environment: {} },
  ]) {
    let certificateFetches = 0;
    let passwordReads = 0;
    let processRuns = 0;
    let stderr = "";
    const code = await runHostedMigration0014DryRunCli({
      ...testCase,
      fetchCaCertificate: async () => {
        certificateFetches += 1;
        return caCertificate;
      },
      readPassword: async () => {
        passwordReads += 1;
        return "must-not-run";
      },
      runSupabase: async () => {
        processRuns += 1;
        return { code: 0, stdout: validOutput };
      },
      writeError: (value) => {
        stderr += value;
      },
      writeOutput: () => assert.fail("must not write stdout"),
    });
    assert.equal(code, 1);
    assert.equal(certificateFetches, 0);
    assert.equal(passwordReads, 0);
    assert.equal(processRuns, 0);
    assert.equal(
      stderr,
      "Hosted 0014 migration dry-run failed closed; database was not modified.\n",
    );
    assert.equal(stderr.includes("secret"), false);
  }
});

test("0014 dry-run CLI fails closed when the fixed CA cannot be fetched", async () => {
  let passwordReads = 0;
  let processRuns = 0;
  let stderr = "";
  const code = await runHostedMigration0014DryRunCli({
    arguments_: [hostedMigration0014DryRunArgument],
    environment: {},
    fetchCaCertificate: async () => {
      throw new Error("fictional CA detail");
    },
    readPassword: async () => {
      passwordReads += 1;
      return "fictional-password";
    },
    runSupabase: async () => {
      processRuns += 1;
      return { code: 0, stdout: validOutput };
    },
    writeError: (value) => {
      stderr += value;
    },
    writeOutput: () => assert.fail("must not write stdout"),
  });
  assert.equal(code, 1);
  assert.equal(passwordReads, 0);
  assert.equal(processRuns, 0);
  assert.equal(stderr, "Hosted 0014 migration dry-run failed closed; database was not modified.\n");
  assert.equal(stderr.includes("fictional"), false);
});

test("0014 dry-run CLI fails closed when the hidden password prompt is cancelled", async () => {
  let processRuns = 0;
  let certificateFetches = 0;
  let stderr = "";
  const code = await runHostedMigration0014DryRunCli({
    arguments_: [hostedMigration0014DryRunArgument],
    environment: {},
    fetchCaCertificate: async () => {
      certificateFetches += 1;
      return caCertificate;
    },
    readPassword: async () => {
      throw new Error("fictional prompt cancellation detail");
    },
    runSupabase: async () => {
      processRuns += 1;
      return { code: 0, stdout: validOutput };
    },
    writeError: (value) => {
      stderr += value;
    },
    writeOutput: () => assert.fail("must not write stdout"),
  });

  assert.equal(code, 1);
  assert.equal(certificateFetches, 1);
  assert.equal(processRuns, 0);
  assert.equal(stderr, "Hosted 0014 migration dry-run failed closed; database was not modified.\n");
  assert.equal(stderr.includes("cancellation"), false);
});

test(
  "real macOS package entry fails closed when Ctrl-C cancels the hidden password prompt",
  { skip: process.platform !== "darwin" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "huayi-hosted-0014-offline-fetch-"));
    const fetchAdapterPath = join(root, "offline-fetch.mjs");
    await writeFile(
      fetchAdapterPath,
      `const certificate = ${JSON.stringify(caCertificate)};
globalThis.fetch = async (url) => {
  const bytes = Buffer.from(certificate);
  let sent = false;
  return {
    body: {
      getReader() {
        return {
          async cancel() {},
          async read() {
            if (sent) return { done: true, value: undefined };
            sent = true;
            return { done: false, value: bytes };
          },
          releaseLock() {},
        };
      },
    },
    ok: true,
    status: 200,
    url,
  };
};
`,
      "utf8",
    );
    const expectSource = `set timeout 10
log_user 1
spawn pnpm acceptance:hosted:migration:0014:dry-run
expect "Supabase administrator database password: "
send -- "\\003"
expect eof
catch wait result
puts "HUAYI_CHILD_STATUS=[lindex $result 2]:[lindex $result 3]"
exit 0
`;
    try {
      const result = await new Promise((resolveResult) => {
        const child = spawn("/usr/bin/expect", ["-f", "-"], {
          cwd: repositoryRoot,
          env: {
            LANG: "C",
            LC_ALL: "C",
            NODE_OPTIONS: `--import=${pathToFileURL(fetchAdapterPath).href}`,
            PATH: process.env.PATH ?? "",
          },
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        });
        let stderr = "";
        let stdout = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
          stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
        });
        child.once("close", (code, signal) => resolveResult({ code, signal, stderr, stdout }));
        child.stdin.end(expectSource);
      });

      assert.equal(result.code, 0, JSON.stringify(result));
      assert.equal(result.signal, null);
      assert.equal(result.stderr, "");
      assert.match(
        result.stdout,
        /Hosted 0014 migration dry-run failed closed; database was not modified\./u,
      );
      assert.match(result.stdout, /HUAYI_CHILD_STATUS=0:1/u);
      assert.equal(
        result.stdout.match(
          /Hosted 0014 migration dry-run failed closed; database was not modified\./gu,
        )?.length,
        1,
      );
      assert.doesNotMatch(result.stdout, /DRY RUN:|Connecting to remote database/u);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  },
);

test("0014 dry-run CLI reports one fixed success and never reflects process output or password", async () => {
  let stdout = "";
  let stderr = "";
  const password = "fictional-secret";
  const code = await runHostedMigration0014DryRunCli({
    arguments_: [hostedMigration0014DryRunArgument],
    environment: {},
    fetchCaCertificate: async () => caCertificate,
    readPassword: async () => password,
    runSupabase: async (secrets) => {
      assert.deepEqual(secrets, { administratorPassword: password, caCertificate });
      return { code: 0, stdout: validOutput };
    },
    writeError: (value) => {
      stderr += value;
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });

  assert.equal(code, 0);
  assert.equal(stdout, `${hostedMigration0014SuccessMessage}\n`);
  assert.equal(stderr, "");
  assert.equal(stdout.includes(password), false);
  assert.equal(stdout.includes("Connecting"), false);
});

test("0014 dry-run CLI fails closed on invalid secret or every untrusted process result", async () => {
  const failures = [
    { password: "", result: { code: 0, stdout: validOutput } },
    { password: "x".repeat(513), result: { code: 0, stdout: validOutput } },
    { password: "bad\nsecret", result: { code: 0, stdout: validOutput } },
    { password: "valid", result: { code: 1, stdout: validOutput } },
    { password: "valid", result: { code: null, stdout: "" } },
    { password: "valid", result: { code: 0, stdout: `${validOutput}secret-output\n` } },
  ];
  for (const { password, result } of failures) {
    let processRuns = 0;
    let stderr = "";
    const code = await runHostedMigration0014DryRunCli({
      arguments_: [hostedMigration0014DryRunArgument],
      environment: {},
      fetchCaCertificate: async () => caCertificate,
      readPassword: async () => password,
      runSupabase: async () => {
        processRuns += 1;
        return result;
      },
      writeError: (value) => {
        stderr += value;
      },
      writeOutput: () => assert.fail("must not write stdout"),
    });
    assert.equal(code, 1);
    assert.equal(processRuns, password === "valid" ? 1 : 0);
    assert.equal(
      stderr,
      "Hosted 0014 migration dry-run failed closed; database was not modified.\n",
    );
    assert.equal(stderr.includes("secret"), false);
  }
});
