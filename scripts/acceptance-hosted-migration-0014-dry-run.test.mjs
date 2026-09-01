import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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
  assert.doesNotMatch(implementation, /PGPASSWORD:/u);
  assert.match(implementation, /PGPASSFILE/u);
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

test("0014 dry-run CLI accepts exact single-channel or whole-line distributed output", async () => {
  const splitIndex = validOutput.indexOf("Would push these migrations:");
  for (const processResult of [
    { code: 0, stderr: validOutput, stdout: "" },
    { code: 0, stderr: "", stdout: validOutput },
    {
      code: 0,
      stderr: validOutput.slice(0, splitIndex),
      stdout: validOutput.slice(splitIndex),
    },
  ]) {
    let stdout = "";
    let stderr = "";
    const code = await runHostedMigration0014DryRunCli({
      arguments_: [hostedMigration0014DryRunArgument],
      environment: {},
      fetchCaCertificate: async () => caCertificate,
      readPassword: async () => "fictional-secret",
      runSupabase: async () => processResult,
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

test("0014 dry-run CLI fails closed when the Keychain credential read fails", async () => {
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
  "real macOS package entry rejects plaintext env without prompting or reading Keychain",
  { skip: process.platform !== "darwin" },
  async () => {
    const result = await new Promise((resolveResult) => {
      const child = spawn("pnpm", ["acceptance:hosted:migration:0014:dry-run"], {
        cwd: repositoryRoot,
        env: {
          LANG: "C",
          LC_ALL: "C",
          PATH: process.env.PATH ?? "",
          PGPASSWORD: "forbidden-plaintext-secret",
        },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
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
    });

    assert.equal(result.code, 1, JSON.stringify(result));
    assert.equal(result.signal, null);
    assert.match(
      `${result.stdout}${result.stderr}`,
      /Hosted 0014 migration dry-run failed closed; database was not modified\./u,
    );
    assert.doesNotMatch(
      `${result.stdout}${result.stderr}`,
      /administrator database password:|forbidden-plaintext-secret|DRY RUN:/u,
    );
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
      return { code: 0, stderr: validOutput, stdout: "" };
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
    { password: "", result: { code: 0, stderr: validOutput, stdout: "" } },
    { password: "x".repeat(513), result: { code: 0, stderr: validOutput, stdout: "" } },
    { password: "bad\nsecret", result: { code: 0, stderr: validOutput, stdout: "" } },
    { password: "valid", result: { code: 1, stderr: validOutput, stdout: "" } },
    { password: "valid", result: { code: null, stderr: "", stdout: "" } },
    { password: "valid", result: { code: 0, stderr: validOutput, stdout: "unexpected" } },
    { password: "valid", result: { code: 0, stderr: validOutput, stdout: validOutput } },
    {
      password: "valid",
      result: {
        code: 0,
        stderr: validOutput.slice(5),
        stdout: validOutput.slice(0, 5),
      },
    },
    { password: "valid", result: { code: 0, stderr: `\u001b[31m${validOutput}`, stdout: "" } },
    {
      password: "valid",
      result: { code: 0, stderr: `${validOutput}secret-output\n`, stdout: "" },
    },
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
